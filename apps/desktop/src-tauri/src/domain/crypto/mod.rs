//! E2E crypto: Ed25519 identity, X25519 X3DH, AES-256-GCM, and symmetric ratchet chains.
//!
//! The signaling-only authenticated sealed-box envelope used by the
//! realtime plane lives in the sibling `signaling_envelope` module —
//! it is deliberately a separate primitive from the chat ratchet so
//! ICE candidate loss / reorder cannot stall text messages. See
//! `docs/architecture/realtime/event-stream.md` §2.7.2 for the
//! contract.

pub mod double_ratchet;
pub mod sender_keys;
pub mod signaling_envelope;
pub mod telemetry;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use curve25519_dalek::edwards::CompressedEdwardsY;
use ed25519_dalek::{Signature, SigningKey, Verifier, VerifyingKey};
use hkdf::Hkdf;
use keyring::Entry;
use rand::rngs::OsRng;
use sha2::{Digest, Sha256, Sha512};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop};

// --- Key types ----------------------------------------------------------------

#[derive(Clone)]
pub struct IdentityKeyPair {
    pub signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
}

pub struct X25519KeyPair {
    pub private: StaticSecret,
    pub public: PublicKey,
}

// --- Primitives ---------------------------------------------------------------

pub fn generate_identity_keypair() -> IdentityKeyPair {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    IdentityKeyPair {
        signing_key,
        verifying_key,
    }
}

/// Map an Ed25519 signing key to the X25519 key that corresponds to its
/// Edwards public key after Edwards->Montgomery conversion.
pub fn ed25519_to_x25519(signing_key: &SigningKey) -> X25519KeyPair {
    let seed = signing_key.to_bytes();
    let digest = Sha512::digest(seed);
    let mut scalar = [0u8; 32];
    scalar.copy_from_slice(&digest[..32]);
    scalar[0] &= 248;
    scalar[31] &= 127;
    scalar[31] |= 64;
    let private = StaticSecret::from(scalar);
    let public = PublicKey::from(&private);
    X25519KeyPair { private, public }
}

/// Convert Ed25519 verifying key to X25519 Montgomery public (Edwards → Montgomery).
pub fn ed25519_verifying_to_x25519_public(
    verifying_key: &VerifyingKey,
) -> Result<PublicKey, String> {
    let bytes = verifying_key.to_bytes();
    let comp = CompressedEdwardsY(bytes);
    let edwards = comp
        .decompress()
        .ok_or_else(|| "invalid Ed25519 public key".to_string())?;
    let mont = edwards.to_montgomery();
    Ok(PublicKey::from(mont.to_bytes()))
}

pub fn aes_gcm_encrypt(
    key: &[u8; 32],
    nonce: &[u8; 12],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let n = Nonce::from_slice(nonce.as_slice());
    cipher
        .encrypt(
            n,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|e| e.to_string())
}

pub fn aes_gcm_decrypt(
    key: &[u8; 32],
    nonce: &[u8; 12],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let n = Nonce::from_slice(nonce.as_slice());
    cipher
        .decrypt(
            n,
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|e| e.to_string())
}

pub fn hkdf_sha256(ikm: &[u8], salt: &[u8], info: &[u8], out_len: usize) -> Vec<u8> {
    let hk = Hkdf::<Sha256>::new(Some(salt), ikm);
    let mut okm = vec![0u8; out_len];
    let _ = hk.expand(info, &mut okm);
    okm
}

fn hkdf_sha256_array<const N: usize>(ikm: &[u8], salt: &[u8], info: &[u8]) -> [u8; N] {
    let mut out = [0u8; N];
    let hk = Hkdf::<Sha256>::new(Some(salt), ikm);
    let _ = hk.expand(info, &mut out);
    out
}

// --- X3DH ---------------------------------------------------------------------

pub struct X3DHBundle {
    /// Ed25519 identity public key bytes (used for signature verification and mapped to X25519 for DH).
    pub ik_pub: [u8; 32],
    pub spk_pub: [u8; 32],
    pub spk_sig: Vec<u8>,
    pub opk_pub: Option<[u8; 32]>,
}

pub struct X3DHResult {
    pub shared_secret: [u8; 32],
    pub ephemeral_pub: [u8; 32],
}

fn dh(secret: &StaticSecret, peer: &PublicKey) -> [u8; 32] {
    secret.diffie_hellman(peer).to_bytes()
}

/// Public wrapper around the package-private `dh` for the
/// `signaling_envelope` sibling. Kept narrow on purpose: the
/// signaling envelope is the only caller outside this module that
/// needs raw ECDH access, and we don't want to widen `dh`'s
/// visibility for general use.
pub fn dh_for_signaling(secret: &StaticSecret, peer: &PublicKey) -> [u8; 32] {
    dh(secret, peer)
}

/// Sender X3DH: verifies SPK signature, performs DH1..DH4, derives 32-byte secret.
pub fn x3dh_sender(
    our_ik: &IdentityKeyPair,
    their_bundle: &X3DHBundle,
) -> Result<X3DHResult, String> {
    let their_ik_ed = VerifyingKey::from_bytes(&their_bundle.ik_pub)
        .map_err(|_| "invalid peer identity Ed25519 public key".to_string())?;
    let spk_msg = their_bundle.spk_pub;
    let sig =
        Signature::from_slice(&their_bundle.spk_sig).map_err(|_| "invalid SPK signature length")?;
    their_ik_ed
        .verify(spk_msg.as_slice(), &sig)
        .map_err(|_| "SPK signature verification failed")?;

    let their_ik_x = ed25519_verifying_to_x25519_public(&their_ik_ed)?;
    let their_spk = PublicKey::from(their_bundle.spk_pub);
    let their_opk = their_bundle.opk_pub.map(PublicKey::from);

    let our_ik_x = ed25519_to_x25519(&our_ik.signing_key);
    let ephemeral_sk = StaticSecret::random_from_rng(OsRng);
    let ephemeral_pub = PublicKey::from(&ephemeral_sk);

    let dh1 = dh(&our_ik_x.private, &their_spk);
    let dh2 = dh(&ephemeral_sk, &their_ik_x);
    let dh3 = dh(&ephemeral_sk, &their_spk);

    let mut ikm: Vec<u8> = Vec::with_capacity(32 * 4);
    ikm.extend_from_slice(&dh1);
    ikm.extend_from_slice(&dh2);
    ikm.extend_from_slice(&dh3);
    if let Some(ref opk) = their_opk {
        let dh4 = dh(&ephemeral_sk, opk);
        ikm.extend_from_slice(&dh4);
    }

    let salt = [0u8; 32];
    let mut shared = [0u8; 32];
    let hk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
    hk.expand(b"X3DH", &mut shared)
        .map_err(|_| "HKDF expand failed for X3DH".to_string())?;

    Ok(X3DHResult {
        shared_secret: shared,
        ephemeral_pub: ephemeral_pub.to_bytes(),
    })
}

/// Receiver X3DH (complements `x3dh_sender`).
pub fn x3dh_receiver(
    our_ik: &IdentityKeyPair,
    our_spk: &X25519KeyPair,
    our_opk: Option<&X25519KeyPair>,
    their_ik_pub: &[u8; 32],
    their_ephemeral_pub: &[u8; 32],
) -> Result<[u8; 32], String> {
    let their_ik_ed =
        VerifyingKey::from_bytes(their_ik_pub).map_err(|_| "invalid sender IK".to_string())?;
    let their_ik_x = ed25519_verifying_to_x25519_public(&their_ik_ed)?;
    let their_eph = PublicKey::from(*their_ephemeral_pub);

    let our_ik_x = ed25519_to_x25519(&our_ik.signing_key);

    let dh1 = dh(&our_spk.private, &their_ik_x);
    let dh2 = dh(&our_ik_x.private, &their_eph);
    let dh3 = dh(&our_spk.private, &their_eph);

    let mut ikm: Vec<u8> = Vec::with_capacity(32 * 4);
    ikm.extend_from_slice(&dh1);
    ikm.extend_from_slice(&dh2);
    ikm.extend_from_slice(&dh3);
    if let Some(opk) = our_opk {
        let dh4 = dh(&opk.private, &their_eph);
        ikm.extend_from_slice(&dh4);
    }

    let salt = [0u8; 32];
    let mut shared = [0u8; 32];
    let hk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
    hk.expand(b"X3DH", &mut shared)
        .map_err(|_| "HKDF expand failed for X3DH receiver".to_string())?;

    Ok(shared)
}

// --- Symmetric ratchet --------------------------------------------------------

#[derive(Clone, Debug)]
pub struct MessageKeys {
    pub encryption_key: [u8; 32],
    pub nonce: [u8; 12],
    pub counter: u32,
}

#[derive(Clone, Debug, Zeroize, ZeroizeOnDrop)]
pub struct RatchetState {
    pub chain_key: [u8; 32],
    pub counter: u32,
}

impl RatchetState {
    pub fn init(shared_secret: [u8; 32]) -> Self {
        let chain_key = hkdf_sha256_array::<32>(&shared_secret, &[0u8; 32], b"ratchet-root");
        Self {
            chain_key,
            counter: 0,
        }
    }

    pub fn next_message_keys(&mut self) -> MessageKeys {
        let c = self.counter;
        let counter_bytes = c.to_be_bytes();
        let buf = hkdf_sha256(&self.chain_key, b"msg", &counter_bytes, 44);
        let encryption_key: [u8; 32] = buf[..32].try_into().expect("len 44");
        let nonce: [u8; 12] = buf[32..44].try_into().expect("len 12");

        let next_chain = hkdf_sha256(&self.chain_key, b"chain", b"advance", 32);
        self.chain_key.copy_from_slice(&next_chain[..32]);
        self.counter = self.counter.wrapping_add(1);

        MessageKeys {
            encryption_key,
            nonce,
            counter: c,
        }
    }
}

fn derive_send_recv_roots(shared: [u8; 32], initiator: bool) -> ([u8; 32], [u8; 32]) {
    let a = hkdf_sha256_array::<32>(&shared, &[0u8; 32], b"dir-a");
    let b = hkdf_sha256_array::<32>(&shared, &[0u8; 32], b"dir-b");
    if initiator {
        (a, b)
    } else {
        (b, a)
    }
}

// --- Session ------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct EncryptedMessage {
    pub ciphertext: Vec<u8>,
    pub counter: u32,
    pub ephemeral_key: Option<[u8; 32]>,
}

#[derive(Clone, Debug)]
pub struct CryptoSession {
    pub session_id: String,
    pub peer_did: String,
    pub send_ratchet: RatchetState,
    pub recv_ratchet: RatchetState,
    pub established: bool,
    pub is_initiator: bool,
    pub pending_ephemeral: Option<[u8; 32]>,
}

impl CryptoSession {
    pub fn from_x3dh_shared_secret(
        session_id: String,
        peer_did: String,
        shared_secret: [u8; 32],
        is_initiator: bool,
        pending_ephemeral: Option<[u8; 32]>,
    ) -> Self {
        let (send_root, recv_root) = derive_send_recv_roots(shared_secret, is_initiator);
        CryptoSession {
            session_id,
            peer_did,
            send_ratchet: RatchetState::init(send_root),
            recv_ratchet: RatchetState::init(recv_root),
            established: true,
            is_initiator,
            pending_ephemeral,
        }
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<EncryptedMessage, String> {
        let mk = self.send_ratchet.next_message_keys();
        let ct = aes_gcm_encrypt(&mk.encryption_key, &mk.nonce, plaintext, b"")?;
        let ephemeral_key = self.pending_ephemeral.take();
        Ok(EncryptedMessage {
            ciphertext: ct,
            counter: mk.counter,
            ephemeral_key,
        })
    }

    /// Decrypt using receive chain; `counter` must match the next expected receive counter.
    pub fn decrypt(&mut self, msg: &EncryptedMessage) -> Result<Vec<u8>, String> {
        if msg.counter != self.recv_ratchet.counter {
            return Err(format!(
                "ratchet counter mismatch: expected {}, got {}",
                self.recv_ratchet.counter, msg.counter
            ));
        }
        let mk = self.recv_ratchet.next_message_keys();
        let plain = aes_gcm_decrypt(
            &mk.encryption_key,
            &mk.nonce,
            msg.ciphertext.as_slice(),
            b"",
        )?;
        telemetry::record_legacy_decrypt();
        Ok(plain)
    }
}

/// Serializable session row for SQLCipher persistence.
#[derive(Clone, Debug)]
pub struct CryptoSessionState {
    pub session_id: String,
    pub peer_did: String,
    pub send_chain_key: [u8; 32],
    pub send_counter: u32,
    pub recv_chain_key: [u8; 32],
    pub recv_counter: u32,
    pub established: bool,
    pub is_initiator: bool,
    pub pending_ephemeral: Option<[u8; 32]>,
}

impl CryptoSession {
    pub fn to_state(&self) -> CryptoSessionState {
        CryptoSessionState {
            session_id: self.session_id.clone(),
            peer_did: self.peer_did.clone(),
            send_chain_key: self.send_ratchet.chain_key,
            send_counter: self.send_ratchet.counter,
            recv_chain_key: self.recv_ratchet.chain_key,
            recv_counter: self.recv_ratchet.counter,
            established: self.established,
            is_initiator: self.is_initiator,
            pending_ephemeral: self.pending_ephemeral,
        }
    }

    pub fn from_state(state: &CryptoSessionState) -> Self {
        CryptoSession {
            session_id: state.session_id.clone(),
            peer_did: state.peer_did.clone(),
            send_ratchet: RatchetState {
                chain_key: state.send_chain_key,
                counter: state.send_counter,
            },
            recv_ratchet: RatchetState {
                chain_key: state.recv_chain_key,
                counter: state.recv_counter,
            },
            established: state.established,
            is_initiator: state.is_initiator,
            pending_ephemeral: state.pending_ephemeral,
        }
    }
}

// --- Identity storage (OS keyring) --------------------------------------------

const CRYPTO_SERVICE: &str = "peers-touch.desktop.crypto";

fn identity_cache() -> &'static Mutex<HashMap<String, [u8; 32]>> {
    static CACHE: OnceLock<Mutex<HashMap<String, [u8; 32]>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn identity_from_seed(seed: [u8; 32]) -> IdentityKeyPair {
    let signing_key = SigningKey::from_bytes(&seed);
    let verifying_key = signing_key.verifying_key();
    IdentityKeyPair {
        signing_key,
        verifying_key,
    }
}

fn identity_entry(identity_key_ref: &str) -> Result<Entry, String> {
    let user = format!("identity-key:{identity_key_ref}");
    Entry::new(CRYPTO_SERVICE, user.as_str()).map_err(|e| e.to_string())
}

fn scoped_identity_file(identity_key_ref: &str) -> Option<PathBuf> {
    let root = std::env::var("PEERS_STORAGE_ROOT").ok()?;
    let root = root.trim();
    if root.is_empty() {
        return None;
    }
    let mut hasher = Sha256::new();
    hasher.update(identity_key_ref.as_bytes());
    let digest = hasher.finalize();
    let name: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    Some(
        PathBuf::from(root)
            .join("peers-touch")
            .join("desktop")
            .join("data")
            .join("secure-store")
            .join("identity-keys")
            .join(format!("{name}.key")),
    )
}

pub fn store_identity_key(identity_key_ref: &str, seed: &[u8; 32]) -> Result<(), String> {
    let hex_seed: String = seed.iter().map(|b| format!("{b:02x}")).collect();
    if let Some(path) = scoped_identity_file(identity_key_ref) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(path, hex_seed.as_str()).map_err(|e| e.to_string())?;
        return Ok(());
    }
    let entry = identity_entry(identity_key_ref)?;
    entry
        .set_password(hex_seed.as_str())
        .map_err(|e| e.to_string())
}

pub fn load_identity_key(identity_key_ref: &str) -> Result<Option<IdentityKeyPair>, String> {
    if let Ok(cache) = identity_cache().lock() {
        if let Some(seed) = cache.get(identity_key_ref) {
            return Ok(Some(identity_from_seed(*seed)));
        }
    }
    if let Some(path) = scoped_identity_file(identity_key_ref) {
        let pw = match fs::read_to_string(path) {
            Ok(p) => p,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.to_string()),
        };
        return identity_key_from_hex(identity_key_ref, pw.trim());
    }
    let entry = identity_entry(identity_key_ref)?;
    let pw = match entry.get_password() {
        Ok(p) => p,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    identity_key_from_hex(identity_key_ref, pw.as_str())
}

fn identity_key_from_hex(
    identity_key_ref: &str,
    pw: &str,
) -> Result<Option<IdentityKeyPair>, String> {
    if pw.len() != 64 || !pw.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("stored identity key has invalid format".to_string());
    }
    let mut seed = [0u8; 32];
    for i in 0..32 {
        seed[i] = u8::from_str_radix(&pw[i * 2..i * 2 + 2], 16)
            .map_err(|_| "identity key hex decode failed")?;
    }
    if let Ok(mut cache) = identity_cache().lock() {
        cache.insert(identity_key_ref.to_string(), seed);
    }
    Ok(Some(identity_from_seed(seed)))
}

pub fn get_or_create_identity(identity_key_ref: &str) -> Result<IdentityKeyPair, String> {
    if let Some(kp) = load_identity_key(identity_key_ref)? {
        return Ok(kp);
    }
    let kp = generate_identity_keypair();
    let seed = kp.signing_key.to_bytes();
    store_identity_key(identity_key_ref, &seed)?;
    if let Ok(mut cache) = identity_cache().lock() {
        cache.insert(identity_key_ref.to_string(), seed);
    }
    Ok(kp)
}

/// Hex-encoded SHA-256 of the Ed25519 public key (64 hex chars).
pub fn identity_fingerprint_hex(verifying_key: &VerifyingKey) -> String {
    let mut h = Sha256::new();
    h.update(verifying_key.as_bytes());
    let digest = h.finalize();
    hex::encode(digest)
}

// Group symmetric key primitives intentionally removed.
//
// The previous GroupKeyState / GroupEncryptedMessage primitives
// implemented a single shared symmetric key per group with no
// distribution mechanism -- GroupKeyState::generate() simply minted a
// fresh OsRng key per device, so two members would never agree on a
// key for the same group. The Tauri commands wrapping these
// primitives (crypto_group_encrypt / crypto_group_decrypt /
// crypto_group_rotate_key) were never registered in the
// invoke_handler and had zero JS callers, so removing them is purely
// dead-code cleanup with no behavioral change.
//
// The replacement is the Sender Keys protocol designed in
// peers-touch/docs/architecture/encryption/group-sender-keys.md;
// implementation lands per the G0..G5 phase plan in that doc.

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Signer;

    #[test]
    fn ed25519_private_and_public_map_to_same_x25519_public() {
        let identity = generate_identity_keypair();

        let from_private = ed25519_to_x25519(&identity.signing_key);
        let from_public = ed25519_verifying_to_x25519_public(&identity.verifying_key)
            .expect("Ed25519 verifying key should map to X25519 public");

        assert_eq!(from_private.public.as_bytes(), from_public.as_bytes());
    }

    #[test]
    fn x3dh_bootstrap_and_double_ratchet_two_client_round_trip() {
        let alice_identity = generate_identity_keypair();
        let bob_identity = generate_identity_keypair();
        let bob_spk_private = StaticSecret::random_from_rng(OsRng);
        let bob_spk = X25519KeyPair {
            public: PublicKey::from(&bob_spk_private),
            private: bob_spk_private,
        };
        let bob_opk_private = StaticSecret::random_from_rng(OsRng);
        let bob_opk = X25519KeyPair {
            public: PublicKey::from(&bob_opk_private),
            private: bob_opk_private,
        };
        let bundle = X3DHBundle {
            ik_pub: bob_identity.verifying_key.to_bytes(),
            spk_pub: bob_spk.public.to_bytes(),
            spk_sig: bob_identity
                .signing_key
                .sign(bob_spk.public.as_bytes())
                .to_bytes()
                .to_vec(),
            opk_pub: Some(bob_opk.public.to_bytes()),
        };

        let alice_x3dh = x3dh_sender(&alice_identity, &bundle).expect("alice X3DH");
        let bob_shared = x3dh_receiver(
            &bob_identity,
            &bob_spk,
            Some(&bob_opk),
            &alice_identity.verifying_key.to_bytes(),
            &alice_x3dh.ephemeral_pub,
        )
        .expect("bob X3DH");
        assert_eq!(alice_x3dh.shared_secret, bob_shared);

        let session_id = "two-client-e2e";
        let mut alice = double_ratchet::init_initiator(
            session_id,
            &alice_x3dh.shared_secret,
            bob_spk.public.to_bytes(),
        );
        let bob =
            double_ratchet::init_responder(session_id, &bob_shared, bob_spk.private.to_bytes());
        let wire =
            double_ratchet::encrypt(&mut alice, b"encrypted from alice", b"").expect("encrypt");
        let outcome = double_ratchet::decrypt(&bob, &wire, &[], b"").expect("decrypt");

        assert_eq!(outcome.plaintext, b"encrypted from alice");
    }
}
