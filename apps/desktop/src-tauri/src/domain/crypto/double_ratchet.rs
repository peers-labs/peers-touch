//! Full Signal Double Ratchet implementation with proper state persistence.
//!
//! Protocol overview:
//! - X25519 DH ratchet for forward secrecy (rotates on direction change).
//! - HKDF-SHA256 for root-key and chain-key derivation.
//! - Per-message AES-256-GCM with a chain-derived message key and random 12-byte nonce.
//!
//! Persistence contract:
//! - Every encrypt/decrypt produces an updated `DrSessionState` that the caller
//!   MUST persist (via SQLCipher `local_chat_store`) before the next operation.
//! - Skipped message keys are stored separately per (session, peer_dh, counter)
//!   so they survive restart.
//!
//! Key design decisions vs. the broken prior implementation:
//! 1. Responder initializes with peer_pub=None; the first received message
//!    triggers the initial DH ratchet step (no lost keys).
//! 2. Send-chain initialization always rotates the self DH keypair.
//! 3. MAX_SKIP bounds prevent memory exhaustion attacks.
//! 4. All secret bytes use `ZeroizeOnDrop`.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use rand::{rngs::OsRng, RngCore};
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop};

use super::error::CryptoError;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Wire version tag. Increment for breaking wire-format changes.
pub const WIRE_VERSION: u32 = 1;

/// Maximum number of message keys to skip in a single chain advance.
pub const MAX_SKIP: u32 = 1024;

/// Maximum total stored skipped-message keys per session across all chains.
pub const MAX_SKIPPED_TOTAL: u32 = 4096;

const NONCE_LEN: usize = 12;
const KDF_RK_INFO: &[u8] = b"peers-touch:dr:rk:v1";
const KDF_CK_INFO: &[u8] = b"peers-touch:dr:ck:v1";
const KDF_SK_ROOT_INFO: &[u8] = b"peers-touch:dr:sk-root:v1";

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

/// Full Double Ratchet session state. Must be persisted after every
/// encrypt or decrypt operation.
#[derive(Clone, ZeroizeOnDrop)]
pub struct DrSessionState {
    /// Unique session identifier (e.g. conversation_id:device_pair).
    pub session_id: String,
    /// Root key — ratcheted forward on every DH rotation.
    pub root_key: [u8; 32],
    /// Our current DH private key bytes.
    pub self_priv: [u8; 32],
    /// Our current DH public key bytes.
    pub self_pub: [u8; 32],
    /// Peer's most recently seen DH public key.
    pub peer_pub: Option<[u8; 32]>,
    /// Current sending chain key (None if we haven't sent since last receive).
    pub send_chain_key: Option<[u8; 32]>,
    /// Current receiving chain key (None until first message from peer).
    pub recv_chain_key: Option<[u8; 32]>,
    /// Number of messages sent in the current sending chain.
    pub n_send: u32,
    /// Number of messages received in the current receiving chain.
    pub n_recv: u32,
    /// Number of messages in the previous sending chain (communicated in header).
    pub n_prev: u32,
}

/// A skipped message key that must be persisted for out-of-order decryption.
#[derive(Clone, ZeroizeOnDrop)]
pub struct DrSkippedMessageKey {
    pub session_id: String,
    pub peer_pub: [u8; 32],
    pub counter: u32,
    pub message_key: [u8; 32],
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

/// The ciphertext and metadata sent on the wire.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DrCiphertextWire {
    pub version: u32,
    /// Sender's current DH ratchet public key.
    pub sender_dh: [u8; 32],
    /// Message counter within the current sending chain.
    pub n_send: u32,
    /// Number of messages in the previous sending chain.
    pub n_prev: u32,
    /// Random nonce for AES-256-GCM.
    pub nonce: [u8; NONCE_LEN],
    /// AES-256-GCM ciphertext (plaintext + 16-byte tag).
    pub ciphertext: Vec<u8>,
}

// ---------------------------------------------------------------------------
// Decrypt outcome
// ---------------------------------------------------------------------------

/// Result of a successful decryption including the new state to persist.
pub struct DrDecryptOutcome {
    pub plaintext: Vec<u8>,
    /// Updated session state — MUST be persisted.
    pub advanced_state: DrSessionState,
    /// Newly materialized skipped keys — MUST be persisted.
    pub new_skipped: Vec<DrSkippedMessageKey>,
    /// If a previously-stored skipped key was consumed, identifies it
    /// for deletion from the persistent store.
    pub consumed_skipped: Option<([u8; 32], u32)>,
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/// Derive the initial root key from the X3DH shared secret.
fn root_from_shared_secret(sk: &[u8; 32]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(None, sk.as_slice());
    let mut rk = [0u8; 32];
    // Safe: output length is 32 which is <= 255 * hash_len.
    hk.expand(KDF_SK_ROOT_INFO, &mut rk)
        .expect("HKDF expand for sk-root is infallible at 32 bytes");
    rk
}

/// Initialize the session as the initiator (Alice).
///
/// `peer_dh` is the peer's SPK public key from the X3DH bundle.
pub fn init_initiator(session_id: &str, sk: &[u8; 32], peer_dh: [u8; 32]) -> DrSessionState {
    let self_priv = StaticSecret::random_from_rng(&mut OsRng);
    let self_pub = PublicKey::from(&self_priv);

    let rk0 = root_from_shared_secret(sk);
    let dh_out = self_priv
        .diffie_hellman(&PublicKey::from(peer_dh))
        .to_bytes();
    let (rk, recv_ck, send_ck) = kdf_rk(&rk0, &dh_out);

    DrSessionState {
        session_id: session_id.to_string(),
        root_key: rk,
        self_priv: self_priv.to_bytes(),
        self_pub: self_pub.to_bytes(),
        peer_pub: Some(peer_dh),
        send_chain_key: Some(send_ck),
        recv_chain_key: Some(recv_ck),
        n_send: 0,
        n_recv: 0,
        n_prev: 0,
    }
}

/// Initialize the session as the responder (Bob).
///
/// `self_priv_bytes` is the SPK private key that was published in the bundle.
pub fn init_responder(
    session_id: &str,
    sk: &[u8; 32],
    self_priv_bytes: [u8; 32],
) -> DrSessionState {
    let priv_s = StaticSecret::from(self_priv_bytes);
    let self_pub = PublicKey::from(&priv_s);

    DrSessionState {
        session_id: session_id.to_string(),
        root_key: root_from_shared_secret(sk),
        self_priv: priv_s.to_bytes(),
        self_pub: self_pub.to_bytes(),
        peer_pub: None,
        send_chain_key: None,
        recv_chain_key: None,
        n_send: 0,
        n_recv: 0,
        n_prev: 0,
    }
}

// ---------------------------------------------------------------------------
// KDF chains
// ---------------------------------------------------------------------------

/// Root-key ratchet: derives (new_root_key, recv_chain_key, send_chain_key)
/// from the current root key and a DH output.
fn kdf_rk(root: &[u8; 32], dh_out: &[u8; 32]) -> ([u8; 32], [u8; 32], [u8; 32]) {
    let hk = Hkdf::<Sha256>::new(Some(root.as_ref()), dh_out.as_slice());
    let mut buf = [0u8; 96];
    hk.expand(KDF_RK_INFO, &mut buf)
        .expect("HKDF expand for rk is infallible at 96 bytes");
    let mut rk = [0u8; 32];
    let mut recv_ck = [0u8; 32];
    let mut send_ck = [0u8; 32];
    rk.copy_from_slice(&buf[..32]);
    recv_ck.copy_from_slice(&buf[32..64]);
    send_ck.copy_from_slice(&buf[64..96]);
    buf.zeroize();
    (rk, recv_ck, send_ck)
}

/// Chain-key ratchet: derives (message_key, next_chain_key) from the
/// current chain key.
fn kdf_ck(chain_key: &[u8; 32]) -> ([u8; 32], [u8; 32]) {
    let hk = Hkdf::<Sha256>::new(None, chain_key.as_slice());
    let mut buf = [0u8; 64];
    hk.expand(KDF_CK_INFO, &mut buf)
        .expect("HKDF expand for ck is infallible at 64 bytes");
    let mut mk = [0u8; 32];
    let mut next_ck = [0u8; 32];
    mk.copy_from_slice(&buf[..32]);
    next_ck.copy_from_slice(&buf[32..64]);
    buf.zeroize();
    (mk, next_ck)
}

// ---------------------------------------------------------------------------
// AAD construction
// ---------------------------------------------------------------------------

/// Build the Additional Authenticated Data for AEAD.
/// Binds ciphertext to (session_id, wire_version, sender_dh, extra).
fn build_aad(session_id: &str, version: u32, sender_dh: &[u8; 32], extra: &[u8]) -> Vec<u8> {
    const SEP: u8 = 0x1f;
    let mut v = Vec::with_capacity(session_id.len() + 4 + 32 + extra.len() + 8);
    v.extend_from_slice(session_id.as_bytes());
    v.push(SEP);
    v.extend_from_slice(&version.to_be_bytes());
    v.push(SEP);
    v.extend_from_slice(sender_dh.as_slice());
    v.extend_from_slice(extra);
    v
}

// ---------------------------------------------------------------------------
// Encrypt
// ---------------------------------------------------------------------------

/// Encrypt a plaintext message, advancing the session state.
///
/// If the sending chain is not yet established (responder's first send after
/// a receive, or after a DH ratchet rotation), this function performs a DH
/// ratchet step to establish it.
pub fn encrypt(
    state: &mut DrSessionState,
    plaintext: &[u8],
    aad_extra: &[u8],
) -> Result<DrCiphertextWire, CryptoError> {
    // If we have no send chain, perform a DH ratchet step.
    if state.send_chain_key.is_none() {
        let peer = state
            .peer_pub
            .ok_or(CryptoError::RatchetUninitializedReceive)?;

        // Generate new DH keypair.
        let new_priv = StaticSecret::random_from_rng(&mut OsRng);
        let new_pub = PublicKey::from(&new_priv);
        let dh_out = new_priv.diffie_hellman(&PublicKey::from(peer)).to_bytes();
        let (rk, recv_ck, send_ck) = kdf_rk(&state.root_key, &dh_out);

        state.root_key = rk;
        state.self_priv = new_priv.to_bytes();
        state.self_pub = new_pub.to_bytes();
        state.recv_chain_key = Some(recv_ck);
        state.send_chain_key = Some(send_ck);
        state.n_prev = state.n_send;
        state.n_send = 0;
        state.n_recv = 0;
    }

    let send_ck = state
        .send_chain_key
        .as_mut()
        .ok_or(CryptoError::RatchetUninitializedReceive)?;

    let (mut mk, next_ck) = kdf_ck(send_ck);

    // Generate random nonce.
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);

    // Build AAD and encrypt.
    let aad = build_aad(&state.session_id, WIRE_VERSION, &state.self_pub, aad_extra);
    let cipher = Aes256Gcm::new_from_slice(&mk).map_err(|_| CryptoError::RatchetAeadFailure)?;
    let ct = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| CryptoError::RatchetAeadFailure)?;

    mk.zeroize();

    let n_out = state.n_send;
    *send_ck = next_ck;
    state.n_send = state
        .n_send
        .checked_add(1)
        .ok_or_else(|| CryptoError::RatchetBadWireFormat("n_send overflow".into()))?;

    Ok(DrCiphertextWire {
        version: WIRE_VERSION,
        sender_dh: state.self_pub,
        n_send: n_out,
        n_prev: state.n_prev,
        nonce,
        ciphertext: ct,
    })
}

// ---------------------------------------------------------------------------
// Decrypt
// ---------------------------------------------------------------------------

/// Decrypt a received ciphertext, advancing the session state.
///
/// `pre_skipped` is the set of previously-stored skipped message keys
/// (loaded from the persistent store for this session).
pub fn decrypt(
    state: &DrSessionState,
    wire: &DrCiphertextWire,
    pre_skipped: &[DrSkippedMessageKey],
    aad_extra: &[u8],
) -> Result<DrDecryptOutcome, CryptoError> {
    if wire.version != WIRE_VERSION {
        return Err(CryptoError::RatchetBadWireFormat(format!(
            "unsupported version {}",
            wire.version
        )));
    }

    // 1. Try to decrypt from a previously stored skipped-message key.
    for sk in pre_skipped {
        if sk.session_id == state.session_id
            && sk.peer_pub == wire.sender_dh
            && sk.counter == wire.n_send
        {
            let aad = build_aad(&state.session_id, wire.version, &wire.sender_dh, aad_extra);
            let cipher = Aes256Gcm::new_from_slice(&sk.message_key)
                .map_err(|_| CryptoError::RatchetAeadFailure)?;
            let plain = cipher
                .decrypt(
                    Nonce::from_slice(&wire.nonce),
                    Payload {
                        msg: wire.ciphertext.as_slice(),
                        aad: &aad,
                    },
                )
                .map_err(|_| CryptoError::RatchetAeadFailure)?;
            return Ok(DrDecryptOutcome {
                plaintext: plain,
                advanced_state: state.clone(),
                new_skipped: Vec::new(),
                consumed_skipped: Some((wire.sender_dh, wire.n_send)),
            });
        }
    }

    // 2. Normal decryption path.
    let mut st = state.clone();
    let mut new_skipped: Vec<DrSkippedMessageKey> = Vec::new();

    let same_peer = st.peer_pub.map(|p| p == wire.sender_dh).unwrap_or(false);

    if !same_peer {
        // New DH ratchet key from peer — skip remaining messages in old chain.
        if let (Some(old_peer), Some(mut recv_ck)) = (st.peer_pub, st.recv_chain_key) {
            materialize_skipped(
                &st.session_id,
                old_peer,
                &mut recv_ck,
                &mut st.n_recv,
                wire.n_prev,
                &mut new_skipped,
                pre_skipped,
            )?;
        }

        // Perform DH ratchet step.
        let dh_out = dh_bytes(&st.self_priv, &wire.sender_dh);
        let (rk, _recv_ck, send_ck) = kdf_rk(&st.root_key, &dh_out);
        st.root_key = rk;
        // The peer's sending chain corresponds to our receive chain.
        // `send_ck` from kdf_rk with our old self_priv and peer's new pub gives
        // the chain we need to receive on.
        st.recv_chain_key = Some(send_ck);
        st.n_recv = 0;
        st.peer_pub = Some(wire.sender_dh);

        // Rotate our own DH keypair for future sends.
        let new_priv = StaticSecret::random_from_rng(&mut OsRng);
        let new_pub = PublicKey::from(&new_priv);
        st.self_priv = new_priv.to_bytes();
        st.self_pub = new_pub.to_bytes();
        st.send_chain_key = None;
    }

    let mut recv_ck = st
        .recv_chain_key
        .ok_or(CryptoError::RatchetUninitializedReceive)?;

    // Check for counter regression on same peer chain.
    if same_peer && wire.n_send < st.n_recv {
        return Err(CryptoError::RatchetCounterRegression);
    }

    // Skip forward to the target counter.
    materialize_skipped(
        &st.session_id,
        wire.sender_dh,
        &mut recv_ck,
        &mut st.n_recv,
        wire.n_send,
        &mut new_skipped,
        pre_skipped,
    )?;

    // Derive the message key for this counter.
    let (mut mk, next_ck) = kdf_ck(&recv_ck);
    let aad = build_aad(&st.session_id, wire.version, &wire.sender_dh, aad_extra);
    let cipher = Aes256Gcm::new_from_slice(&mk).map_err(|_| CryptoError::RatchetAeadFailure)?;
    let plain = cipher
        .decrypt(
            Nonce::from_slice(&wire.nonce),
            Payload {
                msg: wire.ciphertext.as_slice(),
                aad: &aad,
            },
        )
        .map_err(|_| CryptoError::RatchetAeadFailure)?;

    mk.zeroize();
    st.recv_chain_key = Some(next_ck);
    st.n_recv = st
        .n_recv
        .checked_add(1)
        .ok_or_else(|| CryptoError::RatchetBadWireFormat("n_recv overflow".into()))?;

    // Budget check.
    let total = count_skipped_for_session(pre_skipped, &st.session_id) + new_skipped.len() as u32;
    if total > MAX_SKIPPED_TOTAL {
        return Err(CryptoError::RatchetSkipBudgetExhausted);
    }

    Ok(DrDecryptOutcome {
        plaintext: plain,
        advanced_state: st,
        new_skipped,
        consumed_skipped: None,
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Perform X25519 DH from raw byte representations.
fn dh_bytes(priv_bytes: &[u8; 32], peer_pub_bytes: &[u8; 32]) -> [u8; 32] {
    let priv_s = StaticSecret::from(*priv_bytes);
    let peer = PublicKey::from(*peer_pub_bytes);
    priv_s.diffie_hellman(&peer).to_bytes()
}

/// Advance the chain and store skipped message keys until we reach `until`.
fn materialize_skipped(
    session_id: &str,
    peer_dh: [u8; 32],
    recv_ck: &mut [u8; 32],
    n_recv: &mut u32,
    until: u32,
    new_skipped: &mut Vec<DrSkippedMessageKey>,
    pre_existing: &[DrSkippedMessageKey],
) -> Result<(), CryptoError> {
    if until < *n_recv {
        return Err(CryptoError::RatchetBadWireFormat(format!(
            "target counter {until} < current n_recv {n_recv}",
            n_recv = *n_recv
        )));
    }
    let gap = until - *n_recv;
    if gap > MAX_SKIP {
        return Err(CryptoError::RatchetSkipTooFar);
    }
    let already = new_skipped.len() as u32 + count_skipped_for_session(pre_existing, session_id);
    if already.saturating_add(gap) > MAX_SKIPPED_TOTAL {
        return Err(CryptoError::RatchetSkipBudgetExhausted);
    }

    for _ in 0..gap {
        let (mk, next_ck) = kdf_ck(recv_ck);
        new_skipped.push(DrSkippedMessageKey {
            session_id: session_id.to_string(),
            peer_pub: peer_dh,
            counter: *n_recv,
            message_key: mk,
        });
        *recv_ck = next_ck;
        *n_recv = n_recv
            .checked_add(1)
            .ok_or_else(|| CryptoError::RatchetBadWireFormat("counter overflow".into()))?;
    }
    Ok(())
}

fn count_skipped_for_session(keys: &[DrSkippedMessageKey], session_id: &str) -> u32 {
    keys.iter().filter(|k| k.session_id == session_id).count() as u32
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_session_id() -> String {
        format!(
            "dr-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    fn random_sk() -> [u8; 32] {
        let mut s = [0u8; 32];
        OsRng.fill_bytes(&mut s);
        s
    }

    #[test]
    fn basic_round_trip() {
        let sk = random_sk();
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();
        let sid = make_session_id();

        let mut alice = init_initiator(&sid, &sk, bob_pub);
        let bob = init_responder(&sid, &sk, bob_priv.to_bytes());

        let wire = encrypt(&mut alice, b"hello bob", b"").expect("encrypt");
        let outcome = decrypt(&bob, &wire, &[], b"").expect("decrypt");
        assert_eq!(outcome.plaintext, b"hello bob");
    }

    #[test]
    fn multiple_messages_in_order() {
        let sk = random_sk();
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();
        let sid = make_session_id();

        let mut alice = init_initiator(&sid, &sk, bob_pub);
        let mut bob = init_responder(&sid, &sk, bob_priv.to_bytes());

        for i in 0..5u32 {
            let msg = format!("msg-{i}");
            let wire = encrypt(&mut alice, msg.as_bytes(), b"").expect("encrypt");
            let out = decrypt(&bob, &wire, &[], b"").expect("decrypt");
            assert_eq!(out.plaintext, msg.as_bytes());
            bob = out.advanced_state;
        }
    }

    #[test]
    fn bidirectional_communication() {
        let sk = random_sk();
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();
        let sid = make_session_id();

        let mut alice = init_initiator(&sid, &sk, bob_pub);
        let mut bob = init_responder(&sid, &sk, bob_priv.to_bytes());

        // Alice → Bob
        let w1 = encrypt(&mut alice, b"from alice", b"").expect("a encrypt");
        let o1 = decrypt(&bob, &w1, &[], b"").expect("b decrypt");
        assert_eq!(o1.plaintext, b"from alice");
        bob = o1.advanced_state;

        // Bob → Alice
        let w2 = encrypt(&mut bob, b"from bob", b"").expect("b encrypt");
        let o2 = decrypt(&alice, &w2, &[], b"").expect("a decrypt");
        assert_eq!(o2.plaintext, b"from bob");
        alice = o2.advanced_state;

        // Alice → Bob again (new DH ratchet)
        let w3 = encrypt(&mut alice, b"again", b"").expect("a encrypt 2");
        let o3 = decrypt(&bob, &w3, &[], b"").expect("b decrypt 2");
        assert_eq!(o3.plaintext, b"again");
    }

    #[test]
    fn out_of_order_with_skipped_keys() {
        let sk = random_sk();
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();
        let sid = make_session_id();

        let mut alice = init_initiator(&sid, &sk, bob_pub);
        let bob = init_responder(&sid, &sk, bob_priv.to_bytes());

        let w0 = encrypt(&mut alice, b"m0", b"").unwrap();
        let w1 = encrypt(&mut alice, b"m1", b"").unwrap();
        let w2 = encrypt(&mut alice, b"m2", b"").unwrap();

        // Receive w2 first — should produce skipped keys for m0, m1.
        let out2 = decrypt(&bob, &w2, &[], b"").expect("decrypt w2");
        assert_eq!(out2.plaintext, b"m2");
        assert_eq!(out2.new_skipped.len(), 2);

        // Now decrypt w0 using the skipped keys.
        let bob2 = out2.advanced_state;
        let out0 = decrypt(&bob2, &w0, &out2.new_skipped, b"").expect("decrypt w0");
        assert_eq!(out0.plaintext, b"m0");
        assert!(out0.consumed_skipped.is_some());

        // Decrypt w1 using remaining skipped keys.
        let remaining: Vec<_> = out2
            .new_skipped
            .iter()
            .filter(|k| k.counter != 0)
            .cloned()
            .collect();
        let out1 = decrypt(&bob2, &w1, &remaining, b"").expect("decrypt w1");
        assert_eq!(out1.plaintext, b"m1");
    }

    #[test]
    fn skip_too_far_rejected() {
        let sk = random_sk();
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();
        let sid = make_session_id();

        let mut alice = init_initiator(&sid, &sk, bob_pub);
        let mut bob = init_responder(&sid, &sk, bob_priv.to_bytes());

        // Bootstrap the session.
        let boot = encrypt(&mut alice, b"boot", b"").unwrap();
        bob = decrypt(&bob, &boot, &[], b"").unwrap().advanced_state;

        // Forge a wire message with a counter way beyond MAX_SKIP.
        let forged = DrCiphertextWire {
            version: WIRE_VERSION,
            sender_dh: alice.self_pub,
            n_send: bob.n_recv.saturating_add(MAX_SKIP + 1),
            n_prev: 0,
            nonce: [0u8; 12],
            ciphertext: vec![0u8; 32],
        };
        assert!(matches!(
            decrypt(&bob, &forged, &[], b""),
            Err(CryptoError::RatchetSkipTooFar)
        ));
    }

    #[test]
    fn counter_regression_rejected() {
        let sk = random_sk();
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();
        let sid = make_session_id();

        let mut alice = init_initiator(&sid, &sk, bob_pub);
        let bob = init_responder(&sid, &sk, bob_priv.to_bytes());

        let w0 = encrypt(&mut alice, b"m0", b"").unwrap();
        let _w1 = encrypt(&mut alice, b"m1", b"").unwrap();
        let w2 = encrypt(&mut alice, b"m2", b"").unwrap();

        // Receive w2, advancing n_recv past w0.
        let out2 = decrypt(&bob, &w2, &[], b"").unwrap();
        let bob2 = out2.advanced_state;

        // Attempt to decrypt w0 without the skipped key store should regress.
        assert!(matches!(
            decrypt(&bob2, &w0, &[], b""),
            Err(CryptoError::RatchetCounterRegression)
        ));
    }

    #[test]
    fn cross_session_replay_rejected() {
        let sk = random_sk();
        let bob_priv = StaticSecret::random_from_rng(&mut OsRng);
        let bob_pub = PublicKey::from(&bob_priv).to_bytes();
        let sid_a = make_session_id();
        let sid_b = format!("{sid_a}-other");

        let mut alice = init_initiator(&sid_a, &sk, bob_pub);
        let bob_a = init_responder(&sid_a, &sk, bob_priv.to_bytes());

        let wire = encrypt(&mut alice, b"secret", b"").unwrap();

        // Try to decrypt in a different session.
        let mut bob_b = bob_a.clone();
        bob_b.session_id = sid_b;
        assert!(matches!(
            decrypt(&bob_b, &wire, &[], b""),
            Err(CryptoError::RatchetAeadFailure)
        ));
    }
}
