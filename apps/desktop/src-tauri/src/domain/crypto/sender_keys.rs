//! Sender Keys — group-chat E2EE primitive.
//!
//! See `peers-touch/docs/architecture/encryption/group-sender-keys.md`
//! for the full design (threat model, distribution, rotation,
//! migration). This module implements the per-(group, sender) hash
//! ratchet, the AES-256-GCM seal with the documented AAD bind, and
//! the Ed25519 signature attribution on top.
//!
//! # Why a separate primitive
//!
//! Friend-chat uses a 1:1 Double-Ratchet-style chain (`mod.rs`).
//! Group chat fans out a single sender chain to N receivers and so
//! cannot be a pairwise ratchet — every receiver would need its own
//! send chain on the sender's side, and rotation would scale with
//! `O(group_size)`. Sender Keys collapses that to one chain per
//! `(group, sender)` pair, plus pairwise distribution of the seed
//! over the existing friend-chat E2EE envelope.
//!
//! # Layering
//!
//! Wire form is the proto `peers_touch.model.chat.v1.GroupCiphertext`,
//! built and consumed by the Tauri command layer. This module deals
//! purely in raw bytes / typed state structs; it does not depend on
//! prost or any storage backend so it can be unit-tested in
//! isolation.
//!
//! # Out of scope (intentional)
//!
//! * **Persistence**: SQLCipher schema for `group_sender_keys` and
//!   `group_skipped_message_keys` lives in
//!   `infrastructure/local_chat_store.rs`. This module exposes
//!   serializable state structs (`SenderChainState`,
//!   `SkippedMessageKey`) the storage layer can map to rows.
//! * **Distribution**: emitting / consuming
//!   `SenderKeyDistributionMessage` is wired in the friend-chat
//!   tauri command path. We expose `seed_from_skdm` /
//!   `chain_snapshot_for_skdm` here so that wiring stays trivial.
//! * **Identity**: the Ed25519 signing key used to attribute
//!   ciphertext is sender-local and lives alongside the chain state
//!   in the `SenderChainState`. Only the *public* half is
//!   distributed via the SKDM.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use hkdf::Hkdf;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use zeroize::{Zeroize, ZeroizeOnDrop};

// --- Constants ----------------------------------------------------------------

/// Wire format version stamped into every `GroupCiphertext`. A non-1
/// value MUST be a hard error on the receiver — there is no graceful
/// fallback. Bumped whenever the AAD layout, KDF labels, or
/// signature cover-bytes change.
pub const WIRE_VERSION: u32 = 1;

/// Maximum number of receive-chain steps we will fast-forward to
/// catch up with a remote sender on a single message. Caps the
/// number of `SkippedMessageKey` rows produced by a single decrypt
/// — a malicious sender claiming counter = `u32::MAX` cannot make
/// us materialise 4 billion skipped keys. Mirrors Signal's MAX_SKIP.
pub const MAX_SKIP: u32 = 1_024;

/// HKDF label for deriving the per-message AES key + nonce from the
/// current chain key. Versioned so a future ratchet rev can ride on
/// the same chain without colliding on derivations.
const KDF_INFO_MSG: &[u8] = b"peers-touch:group-sk:msg:v1";

/// HKDF label for advancing the chain key to its next state.
const KDF_INFO_CHAIN: &[u8] = b"peers-touch:group-sk:chain:v1";

const AES_KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const SIG_LEN: usize = 64;

// --- AAD ----------------------------------------------------------------------

/// AAD bound by AES-GCM on every message.
///
/// Layout (NUL-free fields are joined with the unit-separator byte
/// 0x1F so a malicious peer cannot inject `||` or other ambiguous
/// separators in DIDs / group IDs):
///
/// ```text
/// "peers-touch:group-sk:v1" 0x1F
///   group_ulid              0x1F
///   sender_did              0x1F
///   sender_key_id (BE u32)  0x1F
///   counter       (BE u32)
/// ```
///
/// Also returned to callers because the Ed25519 signature covers
/// `sha256(aad || ciphertext)`; we want one source of truth.
fn aad_for(group_ulid: &str, sender_did: &str, sender_key_id: u32, counter: u32) -> Vec<u8> {
    const SEP: u8 = 0x1F;
    let mut buf =
        Vec::with_capacity(24 + 1 + group_ulid.len() + 1 + sender_did.len() + 1 + 4 + 1 + 4);
    buf.extend_from_slice(b"peers-touch:group-sk:v1");
    buf.push(SEP);
    buf.extend_from_slice(group_ulid.as_bytes());
    buf.push(SEP);
    buf.extend_from_slice(sender_did.as_bytes());
    buf.push(SEP);
    buf.extend_from_slice(&sender_key_id.to_be_bytes());
    buf.push(SEP);
    buf.extend_from_slice(&counter.to_be_bytes());
    buf
}

/// Cover-bytes for the Ed25519 signature: `sha256(aad || ciphertext)`.
///
/// Hashing first keeps the signature input bounded (32 bytes) regardless
/// of message size — Ed25519 internally hashes anyway, so this costs us
/// one extra SHA-256 in exchange for a stable, easy-to-reason-about
/// signing surface.
fn sig_cover(aad: &[u8], ciphertext: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(aad);
    h.update(ciphertext);
    h.finalize().into()
}

// --- Key derivation -----------------------------------------------------------

/// Derive the AES-256-GCM key + nonce for a single message from the
/// current chain key. Counter is bound into the AAD (and via that
/// into the ciphertext) so it does **not** need to be salted into
/// the KDF — that would force every receiver to re-derive when they
/// already know the counter.
fn message_keys(chain_key: &[u8; 32]) -> ([u8; AES_KEY_LEN], [u8; NONCE_LEN]) {
    let hk = Hkdf::<Sha256>::new(None, chain_key);
    let mut okm = [0u8; AES_KEY_LEN + NONCE_LEN];
    hk.expand(KDF_INFO_MSG, &mut okm)
        .expect("HKDF expand for sender-keys message keys");
    let mut key = [0u8; AES_KEY_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    key.copy_from_slice(&okm[..AES_KEY_LEN]);
    nonce.copy_from_slice(&okm[AES_KEY_LEN..]);
    (key, nonce)
}

/// Advance the chain key one step.
///
/// One-way hash chain — given `chain_key_n` it is computationally
/// infeasible to recover `chain_key_{n-1}`. This gives us forward
/// secrecy within a (sender, sender_key_id) generation: a device
/// compromised at time T cannot decrypt messages it had already
/// processed and dropped before T.
fn advance_chain(chain_key: &mut [u8; 32]) {
    let hk = Hkdf::<Sha256>::new(None, chain_key.as_slice());
    let mut next = [0u8; 32];
    hk.expand(KDF_INFO_CHAIN, &mut next)
        .expect("HKDF expand for sender-keys chain advance");
    chain_key.copy_from_slice(&next);
    next.zeroize();
}

// --- Public state -------------------------------------------------------------

/// A serializable snapshot of one (group, sender) chain.
///
/// On the **sender** side, this carries the full keypair (since the
/// sender produces signatures). On the **receiver** side, callers
/// MUST clear `signing_seed` (set to `None`) before persisting —
/// receivers only need the verifying key. This type does not enforce
/// that distinction; the storage layer in
/// `infrastructure/local_chat_store.rs` is the authoritative gate.
#[derive(Clone, Debug, Zeroize, ZeroizeOnDrop)]
pub struct SenderChainState {
    pub group_ulid: String,
    pub sender_did: String,
    /// Generation. Bumps on every forced rotation
    /// (member add/remove, "Reset group encryption" UI, etc.).
    pub sender_key_id: u32,
    pub chain_key: [u8; 32],
    /// Counter of the **next** message produced (sender) or the
    /// **next** message expected (receiver). Always strictly
    /// increasing within a single (sender_did, sender_key_id) pair.
    pub counter: u32,
    /// Sender's Ed25519 signing seed, present iff this is the local
    /// sender's own chain. `None` for chains that came in over an
    /// SKDM (we only have the public verifying key for those).
    pub signing_seed: Option<[u8; 32]>,
    /// Sender's Ed25519 verifying key. Always present — receivers
    /// use it to authenticate every ciphertext attributed to this
    /// (sender_did, sender_key_id) pair.
    pub verifying_key: [u8; 32],
}

/// A single skipped message key, kept on the receiver side when an
/// out-of-order ciphertext arrives ahead of intermediate messages.
/// Each row is consumed exactly once and then deleted from storage.
#[derive(Clone, Debug, Zeroize, ZeroizeOnDrop)]
pub struct SkippedMessageKey {
    pub group_ulid: String,
    pub sender_did: String,
    pub sender_key_id: u32,
    pub counter: u32,
    pub key: [u8; AES_KEY_LEN],
    pub nonce: [u8; NONCE_LEN],
}

/// The wire form of an encrypted group message body. Mirrors the
/// proto `peers_touch.model.chat.v1.GroupCiphertext`; we mirror
/// rather than depend on the proto crate so this module is
/// pure-Rust testable in isolation. Conversions to/from the proto
/// type live in the Tauri command layer.
#[derive(Clone, Debug)]
pub struct GroupCiphertextWire {
    pub version: u32,
    pub sender_did: String,
    pub sender_key_id: u32,
    pub counter: u32,
    pub ciphertext: Vec<u8>,
    pub signature: [u8; SIG_LEN],
}

// --- Errors -------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SenderKeyError {
    /// Chain state is missing the local signing seed (callers tried
    /// to encrypt with a received-only chain).
    MissingSigningSeed,
    /// Wire-format version not understood.
    UnsupportedVersion(u32),
    /// Ciphertext attributed to a different sender / generation than
    /// the chain state we have on hand.
    AttributionMismatch,
    /// Counter rewinds (replay attempt) — rejected.
    CounterRegression { have: u32, got: u32 },
    /// Counter is so far ahead of our chain that catching up would
    /// blow past `MAX_SKIP`. Caller should treat this as "skdm lost,
    /// request retransmit".
    SkipTooFar { have: u32, got: u32 },
    /// Ed25519 signature did not verify against the bound
    /// verifying key. MUST surface in UI as "possibly forged" — no
    /// silent fallback to plaintext.
    BadSignature,
    /// AES-GCM authentication failed (bad ciphertext / wrong AAD).
    Aead(String),
    /// Ed25519 key bytes were not a valid point.
    BadVerifyingKey,
    /// Signing seed was not a valid Ed25519 seed (this should be
    /// impossible — every 32-byte sequence is a valid seed — but
    /// kept for type-system completeness).
    BadSigningSeed,
}

impl std::fmt::Display for SenderKeyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SenderKeyError::MissingSigningSeed => write!(f, "sender-keys: missing signing seed"),
            SenderKeyError::UnsupportedVersion(v) => {
                write!(f, "sender-keys: unsupported wire version {v}")
            }
            SenderKeyError::AttributionMismatch => write!(f, "sender-keys: attribution mismatch"),
            SenderKeyError::CounterRegression { have, got } => write!(
                f,
                "sender-keys: counter regression (have={have}, got={got})"
            ),
            SenderKeyError::SkipTooFar { have, got } => write!(
                f,
                "sender-keys: skip too far (have={have}, got={got}, max={MAX_SKIP})"
            ),
            SenderKeyError::BadSignature => write!(f, "sender-keys: bad signature"),
            SenderKeyError::Aead(e) => write!(f, "sender-keys: aead failure: {e}"),
            SenderKeyError::BadVerifyingKey => write!(f, "sender-keys: bad verifying key"),
            SenderKeyError::BadSigningSeed => write!(f, "sender-keys: bad signing seed"),
        }
    }
}

impl std::error::Error for SenderKeyError {}

// --- Public API ---------------------------------------------------------------

/// Mint a fresh local sender chain for a group. Called when:
/// 1. We create a new group, or
/// 2. We rotate (member added/removed, "Reset group encryption").
///
/// `sender_key_id` is the new generation number; callers are
/// expected to allocate it monotonically on top of any known
/// previous generation for the same `(group_ulid, sender_did)` pair.
/// The function does not consult storage on its own — see the
/// design doc §4 for the rotation policy that decides when to call
/// it and what to do with the resulting state.
pub fn create_local_chain(
    group_ulid: &str,
    sender_did: &str,
    sender_key_id: u32,
) -> SenderChainState {
    let mut chain_key = [0u8; 32];
    OsRng.fill_bytes(&mut chain_key);
    let mut signing_seed = [0u8; 32];
    OsRng.fill_bytes(&mut signing_seed);
    let signing = SigningKey::from_bytes(&signing_seed);
    let verifying = signing.verifying_key().to_bytes();

    SenderChainState {
        group_ulid: group_ulid.to_string(),
        sender_did: sender_did.to_string(),
        sender_key_id,
        chain_key,
        counter: 0,
        signing_seed: Some(signing_seed),
        verifying_key: verifying,
    }
}

/// Build the bytes that make up a `SenderKeyDistributionMessage`
/// payload from a sender chain we own. Receivers consume the same
/// fields via `consume_skdm`.
///
/// The chain's *current* counter is exported so a sender that has
/// already advanced (e.g. it published 5 messages then a new member
/// joined) can hand the newcomer a chain that picks up from message
/// 5. The newcomer cannot decrypt messages 0..4 — that is by
/// design; it hadn't joined yet.
pub fn snapshot_for_skdm(chain: &SenderChainState) -> SenderKeyDistributionPayload {
    SenderKeyDistributionPayload {
        group_ulid: chain.group_ulid.clone(),
        sender_did: chain.sender_did.clone(),
        sender_key_id: chain.sender_key_id,
        chain_key: chain.chain_key,
        counter: chain.counter,
        sender_sig_pub: chain.verifying_key,
    }
}

/// Logical content of a `SenderKeyDistributionMessage`. Independent
/// of the proto type so this module stays prost-free.
#[derive(Clone, Debug, Zeroize, ZeroizeOnDrop)]
pub struct SenderKeyDistributionPayload {
    pub group_ulid: String,
    pub sender_did: String,
    pub sender_key_id: u32,
    pub chain_key: [u8; 32],
    pub counter: u32,
    pub sender_sig_pub: [u8; 32],
}

/// Consume a received SKDM into a receive-side chain state.
///
/// Returns `Err(BadVerifyingKey)` when `sender_sig_pub` is not a
/// valid Ed25519 point. The caller should treat that as a fatal
/// distribution failure — rejecting the SKDM rather than silently
/// falling back to plaintext.
pub fn consume_skdm(
    payload: &SenderKeyDistributionPayload,
) -> Result<SenderChainState, SenderKeyError> {
    VerifyingKey::from_bytes(&payload.sender_sig_pub)
        .map_err(|_| SenderKeyError::BadVerifyingKey)?;
    Ok(SenderChainState {
        group_ulid: payload.group_ulid.clone(),
        sender_did: payload.sender_did.clone(),
        sender_key_id: payload.sender_key_id,
        chain_key: payload.chain_key,
        counter: payload.counter,
        // Receiver — no signing seed.
        signing_seed: None,
        verifying_key: payload.sender_sig_pub,
    })
}

/// Encrypt one plaintext under the local sender chain.
///
/// Mutates `chain` to advance the chain key and bump the counter.
/// The caller is responsible for atomically persisting the new
/// chain state with the message it just produced — partial failure
/// (message sent, chain not advanced) would let the same key get
/// reused on the next call, which is catastrophic for AES-GCM.
pub fn encrypt(
    chain: &mut SenderChainState,
    plaintext: &[u8],
) -> Result<GroupCiphertextWire, SenderKeyError> {
    let seed = chain
        .signing_seed
        .ok_or(SenderKeyError::MissingSigningSeed)?;
    let signing = SigningKey::from_bytes(&seed);

    let counter = chain.counter;
    let aad = aad_for(
        &chain.group_ulid,
        &chain.sender_did,
        chain.sender_key_id,
        counter,
    );
    let (key, nonce) = message_keys(&chain.chain_key);

    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|e| SenderKeyError::Aead(e.to_string()))?;
    let n = Nonce::from_slice(&nonce);
    let ciphertext = cipher
        .encrypt(
            n,
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|e| SenderKeyError::Aead(e.to_string()))?;

    let cover = sig_cover(&aad, &ciphertext);
    let signature: Signature = signing.sign(&cover);

    advance_chain(&mut chain.chain_key);
    // Counter wraps at u32::MAX -- design doc §4 mandates a forced
    // rotation well before that point; if we ever genuinely reach
    // u32::MAX the encrypt will panic on overflow which is the
    // intentional fail-loud behaviour (silent wraparound would let
    // counters and AAD collide).
    chain.counter = chain
        .counter
        .checked_add(1)
        .expect("sender-keys counter overflow; rotation policy violated");

    Ok(GroupCiphertextWire {
        version: WIRE_VERSION,
        sender_did: chain.sender_did.clone(),
        sender_key_id: chain.sender_key_id,
        counter,
        ciphertext,
        signature: signature.to_bytes(),
    })
}

/// Result of a successful decrypt. Carries the plaintext alongside
/// any skipped message keys the receiver materialised while
/// catching up, so the caller can persist them in the same
/// transaction that persists the new chain counter (atomicity).
#[derive(Debug)]
pub struct DecryptOutcome {
    pub plaintext: Vec<u8>,
    /// Newly skipped keys produced by fast-forwarding. Caller MUST
    /// persist these atomically with the chain state — losing them
    /// will make the corresponding intermediate messages
    /// permanently undecryptable when they finally arrive.
    pub new_skipped: Vec<SkippedMessageKey>,
    /// New chain counter / chain-key the caller MUST persist.
    /// (Intentional: we don't mutate `chain` in-place because the
    /// caller may want to roll back on storage failure.)
    pub advanced_counter: u32,
    pub advanced_chain_key: [u8; 32],
}

/// Decrypt one ciphertext against the local receive-side chain
/// state, materialising skipped-message-keys for any intermediate
/// counters we leapfrogged.
///
/// `pre_skipped` is the set of already-stored skipped keys for this
/// (group, sender, sender_key_id) — the caller should pre-load
/// them, indexed by counter, so we can hit the fast path when an
/// out-of-order message arrives. We never mutate `pre_skipped`
/// here; the caller deletes the consumed row from storage based on
/// the returned counter.
///
/// On error this function leaves all caller-side state unchanged
/// (the chain is borrowed immutably; any output is in the
/// `DecryptOutcome` the caller chooses to persist).
pub fn decrypt(
    chain: &SenderChainState,
    wire: &GroupCiphertextWire,
    pre_skipped: &BTreeMap<u32, SkippedMessageKey>,
) -> Result<DecryptOutcome, SenderKeyError> {
    if wire.version != WIRE_VERSION {
        return Err(SenderKeyError::UnsupportedVersion(wire.version));
    }
    if wire.sender_did != chain.sender_did || wire.sender_key_id != chain.sender_key_id {
        return Err(SenderKeyError::AttributionMismatch);
    }

    let verifying = VerifyingKey::from_bytes(&chain.verifying_key)
        .map_err(|_| SenderKeyError::BadVerifyingKey)?;

    let aad = aad_for(
        &chain.group_ulid,
        &chain.sender_did,
        chain.sender_key_id,
        wire.counter,
    );
    let cover = sig_cover(&aad, &wire.ciphertext);
    let sig = Signature::from_bytes(&wire.signature);
    verifying
        .verify(&cover, &sig)
        .map_err(|_| SenderKeyError::BadSignature)?;

    // Replay path: the message's counter is *behind* our chain.
    // Either it's a stored skipped key (legitimate OOO catch-up)
    // or it's a replay attempt (no matching skipped row).
    if wire.counter < chain.counter {
        let stored = pre_skipped
            .get(&wire.counter)
            .ok_or(SenderKeyError::CounterRegression {
                have: chain.counter,
                got: wire.counter,
            })?;
        let cipher = Aes256Gcm::new_from_slice(&stored.key)
            .map_err(|e| SenderKeyError::Aead(e.to_string()))?;
        let n = Nonce::from_slice(&stored.nonce);
        let plaintext = cipher
            .decrypt(
                n,
                Payload {
                    msg: wire.ciphertext.as_slice(),
                    aad: &aad,
                },
            )
            .map_err(|e| SenderKeyError::Aead(e.to_string()))?;
        return Ok(DecryptOutcome {
            plaintext,
            new_skipped: Vec::new(),
            advanced_counter: chain.counter,
            advanced_chain_key: chain.chain_key,
        });
    }

    // Fast-forward path: we may need to skip 0..N intermediate
    // counters before reaching the requested one. Each skip
    // materialises one SkippedMessageKey row.
    let skip_count = wire.counter - chain.counter;
    if skip_count > MAX_SKIP {
        return Err(SenderKeyError::SkipTooFar {
            have: chain.counter,
            got: wire.counter,
        });
    }

    let mut work_chain = chain.chain_key;
    let mut work_counter = chain.counter;
    let mut new_skipped: Vec<SkippedMessageKey> = Vec::with_capacity(skip_count as usize);
    for _ in 0..skip_count {
        let (k, n) = message_keys(&work_chain);
        new_skipped.push(SkippedMessageKey {
            group_ulid: chain.group_ulid.clone(),
            sender_did: chain.sender_did.clone(),
            sender_key_id: chain.sender_key_id,
            counter: work_counter,
            key: k,
            nonce: n,
        });
        advance_chain(&mut work_chain);
        work_counter += 1;
    }

    let (key, nonce) = message_keys(&work_chain);
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|e| SenderKeyError::Aead(e.to_string()))?;
    let n = Nonce::from_slice(&nonce);
    let plaintext = cipher
        .decrypt(
            n,
            Payload {
                msg: wire.ciphertext.as_slice(),
                aad: &aad,
            },
        )
        .map_err(|e| SenderKeyError::Aead(e.to_string()))?;

    advance_chain(&mut work_chain);
    work_counter += 1;

    Ok(DecryptOutcome {
        plaintext,
        new_skipped,
        advanced_counter: work_counter,
        advanced_chain_key: work_chain,
    })
}

// --- Tests --------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_pair(gid: &str, sid: &str) -> (SenderChainState, SenderChainState) {
        let local = create_local_chain(gid, sid, 1);
        let payload = snapshot_for_skdm(&local);
        let remote = consume_skdm(&payload).expect("consume_skdm");
        (local, remote)
    }

    #[test]
    fn round_trip_in_order() {
        let (mut local, remote) = fresh_pair("g-1", "did:peers:alice");
        let mut recv = remote;
        let pre = BTreeMap::new();
        for i in 0..5 {
            let msg = format!("hello {i}");
            let wire = encrypt(&mut local, msg.as_bytes()).expect("encrypt");
            let out = decrypt(&recv, &wire, &pre).expect("decrypt");
            assert_eq!(out.plaintext, msg.as_bytes());
            assert_eq!(out.new_skipped.len(), 0);
            recv.chain_key = out.advanced_chain_key;
            recv.counter = out.advanced_counter;
        }
    }

    #[test]
    fn out_of_order_materialises_skipped() {
        let (mut local, remote) = fresh_pair("g-2", "did:peers:bob");
        let mut recv = remote;

        let m0 = encrypt(&mut local, b"m0").expect("e0");
        let m1 = encrypt(&mut local, b"m1").expect("e1");
        let m2 = encrypt(&mut local, b"m2").expect("e2");

        // Receive m2 first; m0 and m1 become skipped.
        let pre = BTreeMap::new();
        let out2 = decrypt(&recv, &m2, &pre).expect("d2 fast-forward");
        assert_eq!(out2.plaintext, b"m2");
        assert_eq!(out2.new_skipped.len(), 2);
        assert_eq!(out2.new_skipped[0].counter, 0);
        assert_eq!(out2.new_skipped[1].counter, 1);

        recv.chain_key = out2.advanced_chain_key;
        recv.counter = out2.advanced_counter;

        // Now m0 + m1 arrive late and must decrypt from the
        // skipped store.
        let mut store: BTreeMap<u32, SkippedMessageKey> = BTreeMap::new();
        for s in out2.new_skipped {
            store.insert(s.counter, s);
        }
        let out0 = decrypt(&recv, &m0, &store).expect("d0 from skipped");
        assert_eq!(out0.plaintext, b"m0");
        let out1 = decrypt(&recv, &m1, &store).expect("d1 from skipped");
        assert_eq!(out1.plaintext, b"m1");
    }

    #[test]
    fn replay_without_skipped_is_rejected() {
        let (mut local, remote) = fresh_pair("g-3", "did:peers:carol");
        let mut recv = remote;
        let pre = BTreeMap::new();

        let w = encrypt(&mut local, b"once").expect("e");
        let out = decrypt(&recv, &w, &pre).expect("d");
        recv.chain_key = out.advanced_chain_key;
        recv.counter = out.advanced_counter;

        // Replay attempt: counter has advanced past 0 and the
        // skipped store is empty -> regression error.
        let err = decrypt(&recv, &w, &pre).unwrap_err();
        assert!(matches!(err, SenderKeyError::CounterRegression { .. }));
    }

    #[test]
    fn skip_too_far_is_rejected() {
        let (mut local, remote) = fresh_pair("g-4", "did:peers:dave");
        let recv = remote;
        let pre = BTreeMap::new();

        // Forge a wire ciphertext claiming counter = MAX_SKIP + 1
        // ahead. We have to actually encrypt-and-skip at the sender
        // to get a well-signed wire, so the test simulates the
        // attacker by advancing the *local* state past MAX_SKIP +
        // 1 before sending.
        for _ in 0..(MAX_SKIP + 2) {
            // Use a tiny payload to keep the test fast.
            encrypt(&mut local, b".").expect("e");
        }
        let w = encrypt(&mut local, b"too-far").expect("e-far");

        let err = decrypt(&recv, &w, &pre).unwrap_err();
        assert!(matches!(err, SenderKeyError::SkipTooFar { .. }));
    }

    #[test]
    fn forged_signature_is_rejected() {
        let (mut local, remote) = fresh_pair("g-5", "did:peers:eve");
        let mut w = encrypt(&mut local, b"genuine").expect("e");
        // Flip a byte in the signature.
        w.signature[0] ^= 0x01;
        let pre = BTreeMap::new();
        let err = decrypt(&remote, &w, &pre).unwrap_err();
        assert_eq!(err, SenderKeyError::BadSignature);
    }

    #[test]
    fn cross_group_replay_is_rejected() {
        // Same sender, same chain, but the receiver believes the
        // chain belongs to a *different* group. The AAD bind covers
        // group_ulid AND the signature covers AAD, so we trip the
        // signature gate first -- which is the cleaner failure
        // (signature rejection precedes any decryption attempt and
        // can be surfaced in the UI as "possibly forged" without
        // burning AEAD work).
        let (mut local, mut remote) = fresh_pair("g-6", "did:peers:frank");
        let w = encrypt(&mut local, b"cross").expect("e");
        remote.group_ulid = "g-7".to_string();
        let pre = BTreeMap::new();
        let err = decrypt(&remote, &w, &pre).unwrap_err();
        assert_eq!(err, SenderKeyError::BadSignature);
    }

    #[test]
    fn receiver_cannot_encrypt() {
        let (local, _remote) = fresh_pair("g-8", "did:peers:grace");
        let payload = snapshot_for_skdm(&local);
        let mut recv = consume_skdm(&payload).expect("consume");
        let err = encrypt(&mut recv, b"forbidden").unwrap_err();
        assert_eq!(err, SenderKeyError::MissingSigningSeed);
    }
}
