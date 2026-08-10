//! End-to-end chat cryptography.
//!
//! Module structure:
//! - `error`           — Typed CryptoError enum for all crypto operations.
//! - `identity`        — IK and DSK management, OS keyring, fingerprints.
//! - `x3dh`            — X3DH sender/receiver key agreement.
//! - `double_ratchet`  — Full Double Ratchet with proper state persistence.
//! - `session_manager` — Multi-device session resolution and lifecycle.
//! - `device_registry` — Local cache of peer device lists.
//! - `backup`          — Backup key derivation (Argon2id), encrypt/decrypt.
//! - `recovery`        — Recovery secret (BIP39 24-word mnemonic), restoration.
//! - `signaling_envelope` — Stateless authenticated sealed-box for WebRTC signaling.
//! - `telemetry`          — Process-wide decrypt counter.
//!
//! The signaling envelope is deliberately separate from the chat ratchet:
//! ICE candidate loss/reorder must not stall text messages. See
//! `docs/architecture/realtime/event-stream.md` §2.7.2 for the contract.

pub mod backup;
pub mod device_registry;
pub mod double_ratchet;
pub mod error;
pub mod identity;
pub mod recovery;
pub mod session_manager;
pub mod x3dh;

pub mod signaling_envelope;
pub mod telemetry;

pub use device_registry::{DeviceInfo, DeviceRegistry, PeerDeviceList};
pub use double_ratchet::{
    DrCiphertextWire, DrDecryptOutcome, DrSessionState, DrSkippedMessageKey, MAX_SKIP,
    MAX_SKIPPED_TOTAL, WIRE_VERSION,
};
pub use error::CryptoError;
pub use identity::{
    fingerprint_hex, fingerprint_numeric, get_or_create_identity, load_identity_key,
    store_identity_key, DeviceSigningKey, IdentityKeyPair, X25519KeyPair,
};
pub use recovery::{generate_recovery_mnemonic, validate_mnemonic};
pub use session_manager::{
    CryptoEndpoint, DirectSession, DirectSessionKey, PreparedDeviceCiphertext, PreparedFanOut,
    SessionManager,
};
pub use x3dh::{PreKeyBundle, X3dhReceiverInput, X3dhSenderResult};

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use ed25519_dalek::{SigningKey, VerifyingKey};
use hkdf::Hkdf;
use sha2::{Digest, Sha256, Sha512};
use x25519_dalek::{PublicKey, StaticSecret};

/// Map an Ed25519 signing key to the corresponding X25519 keypair.
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

/// Convert Ed25519 verifying key to X25519 public.
pub fn ed25519_verifying_to_x25519_public(
    verifying_key: &VerifyingKey,
) -> Result<PublicKey, String> {
    identity::ed25519_verifying_to_x25519_public(verifying_key).map_err(|e| e.to_string())
}

/// Hex-encoded SHA-256 fingerprint of an Ed25519 public key.
pub fn identity_fingerprint_hex(verifying_key: &VerifyingKey) -> String {
    fingerprint_hex(verifying_key)
}

// ---------------------------------------------------------------------------
// Low-level cryptographic primitives (used by signaling_envelope and tests)
// ---------------------------------------------------------------------------

/// AES-256-GCM encryption with associated data.
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

/// AES-256-GCM decryption with associated data.
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

/// HKDF-SHA256 key derivation.
pub fn hkdf_sha256(ikm: &[u8], salt: &[u8], info: &[u8], out_len: usize) -> Vec<u8> {
    let hk = Hkdf::<Sha256>::new(Some(salt), ikm);
    let mut okm = vec![0u8; out_len];
    let _ = hk.expand(info, &mut okm);
    okm
}

/// Raw X25519 Diffie-Hellman — exposed narrowly for signaling_envelope.
pub fn dh_for_signaling(secret: &StaticSecret, peer: &PublicKey) -> [u8; 32] {
    secret.diffie_hellman(peer).to_bytes()
}

// ---------------------------------------------------------------------------
// Tests — Integration across modules
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Signer;

    #[test]
    fn full_x3dh_to_double_ratchet_round_trip() {
        let alice_ik = IdentityKeyPair::generate();
        let bob_ik = IdentityKeyPair::generate();
        let bob_spk = X25519KeyPair::generate();
        let bob_opk = X25519KeyPair::generate();

        let spk_sig = bob_ik.signing_key.sign(&bob_spk.public_bytes());
        let bundle = PreKeyBundle {
            ik_pub: bob_ik.verifying_key.to_bytes(),
            spk_pub: bob_spk.public_bytes(),
            spk_sig: spk_sig.to_bytes().to_vec(),
            opk_pub: Some(bob_opk.public_bytes()),
            spk_id: 7,
            opk_id: Some(11),
        };

        // Alice performs sender X3DH.
        let alice_x3dh = x3dh::x3dh_sender(&alice_ik, &bundle).expect("alice x3dh");

        // Bob performs receiver X3DH.
        let bob_secret = x3dh::x3dh_receiver(
            &bob_ik,
            &bob_spk,
            Some(&bob_opk),
            &X3dhReceiverInput {
                sender_ik_pub: alice_ik.verifying_key.to_bytes(),
                sender_ephemeral_pub: alice_x3dh.ephemeral_pub,
                spk_id: 7,
                opk_id: Some(11),
            },
        )
        .expect("bob x3dh");

        assert_eq!(alice_x3dh.shared_secret, bob_secret);

        // Initialize Double Ratchet sessions.
        let session_id = "integration-test-session";
        let mut alice_dr = double_ratchet::init_initiator(
            session_id,
            &alice_x3dh.shared_secret,
            bob_spk.public_bytes(),
        );
        let bob_dr =
            double_ratchet::init_responder(session_id, &bob_secret, bob_spk.private_bytes());

        // Alice encrypts, Bob decrypts.
        let wire =
            double_ratchet::encrypt(&mut alice_dr, b"hello from alice", b"").expect("encrypt");
        let outcome = double_ratchet::decrypt(&bob_dr, &wire, &[], b"").expect("decrypt");
        assert_eq!(outcome.plaintext, b"hello from alice");

        // Bob replies.
        let mut bob_dr = outcome.advanced_state;
        let wire2 =
            double_ratchet::encrypt(&mut bob_dr, b"hello from bob", b"").expect("bob encrypt");
        let outcome2 = double_ratchet::decrypt(&alice_dr, &wire2, &[], b"").expect("alice decrypt");
        assert_eq!(outcome2.plaintext, b"hello from bob");
    }

    #[test]
    fn ed25519_private_and_public_map_to_same_x25519_public() {
        let identity = IdentityKeyPair::generate();
        let from_private = ed25519_to_x25519(&identity.signing_key);
        let from_public = ed25519_verifying_to_x25519_public(&identity.verifying_key)
            .expect("Ed25519 verifying key should map to X25519 public");
        assert_eq!(from_private.public.as_bytes(), from_public.as_bytes());
    }

    #[test]
    fn aes_gcm_round_trip() {
        let key = [0xAA; 32];
        let nonce = [0xBB; 12];
        let plaintext = b"test message";
        let aad = b"extra data";

        let ct = aes_gcm_encrypt(&key, &nonce, plaintext, aad).expect("encrypt");
        let pt = aes_gcm_decrypt(&key, &nonce, &ct, aad).expect("decrypt");
        assert_eq!(pt, plaintext);
    }
}
