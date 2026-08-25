//! X3DH (Extended Triple Diffie-Hellman) key agreement.
//!
//! Implements both the sender (Alice) and receiver (Bob) sides of the
//! X3DH protocol as specified by the Signal protocol documentation:
//!
//! - Sender verifies the SPK signature on the peer's bundle, performs
//!   DH1..DH4, and derives a 32-byte shared secret via HKDF-SHA256.
//! - Receiver mirrors the DH operations using their own SPK/OPK
//!   private keys and the sender's ephemeral public key.
//!
//! The resulting shared secret is used to bootstrap a Double Ratchet session.

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use hkdf::Hkdf;
use rand::rngs::OsRng;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroize;

use super::identity::{ed25519_verifying_to_x25519_public, IdentityKeyPair, X25519KeyPair};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// A peer's pre-key bundle fetched from the Station key-distribution server.
pub struct PreKeyBundle {
    /// Ed25519 identity public key (32 bytes).
    pub ik_pub: [u8; 32],
    /// X25519 signed pre-key public (32 bytes).
    pub spk_pub: [u8; 32],
    /// Ed25519 signature over `spk_pub` by `ik_pub`.
    pub spk_sig: Vec<u8>,
    /// Optional one-time pre-key public (32 bytes). Consumed on first use.
    pub opk_pub: Option<[u8; 32]>,
    /// SPK identifier for the receiver to locate the corresponding private key.
    pub spk_id: u32,
    /// OPK identifier (if present) for the receiver to locate the corresponding private key.
    pub opk_id: Option<u32>,
}

/// Output of the sender-side X3DH computation.
#[derive(Debug)]
pub struct X3dhSenderResult {
    /// 32-byte shared secret to bootstrap the Double Ratchet.
    pub shared_secret: [u8; 32],
    /// Ephemeral public key that must be transmitted to the receiver.
    pub ephemeral_pub: [u8; 32],
    /// SPK id from the bundle (so receiver knows which SPK was used).
    pub spk_id: u32,
    /// OPK id from the bundle (so receiver knows which OPK was consumed).
    pub opk_id: Option<u32>,
}

/// Input to the receiver-side X3DH computation — the initial message header.
pub struct X3dhReceiverInput {
    /// Sender's Ed25519 identity public key.
    pub sender_ik_pub: [u8; 32],
    /// Sender's ephemeral X25519 public key.
    pub sender_ephemeral_pub: [u8; 32],
    /// Which SPK the sender used.
    pub spk_id: u32,
    /// Which OPK the sender used (if any).
    pub opk_id: Option<u32>,
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const X3DH_INFO: &[u8] = b"peers-touch:x3dh:v1";

// ---------------------------------------------------------------------------
// Sender side
// ---------------------------------------------------------------------------

/// Perform sender-side X3DH: verify the peer's bundle, compute DH1..DH4,
/// and derive the shared secret.
pub fn x3dh_sender(
    our_ik: &IdentityKeyPair,
    bundle: &PreKeyBundle,
) -> Result<X3dhSenderResult, String> {
    // 1. Verify SPK signature.
    let their_ik_ed = VerifyingKey::from_bytes(&bundle.ik_pub)
        .map_err(|_| format!("X3DH bundle malformed: invalid peer IK Ed25519 bytes"))?;
    let sig = Signature::from_slice(&bundle.spk_sig)
        .map_err(|_| format!("X3DH bundle malformed: SPK signature wrong length"))?;
    their_ik_ed
        .verify(&bundle.spk_pub, &sig)
        .map_err(|_| "X3DH SPK signature invalid".to_string())?;

    // 2. Convert keys to X25519.
    let their_ik_x = ed25519_verifying_to_x25519_public(&their_ik_ed)?;
    let their_spk = PublicKey::from(bundle.spk_pub);
    let their_opk = bundle.opk_pub.map(PublicKey::from);

    let our_ik_x_secret = our_ik.to_x25519_secret();
    let ephemeral_sk = StaticSecret::random_from_rng(OsRng);
    let ephemeral_pub = PublicKey::from(&ephemeral_sk);

    // 3. Compute DH values.
    let mut dh1 = our_ik_x_secret.diffie_hellman(&their_spk).to_bytes();
    let mut dh2 = ephemeral_sk.diffie_hellman(&their_ik_x).to_bytes();
    let mut dh3 = ephemeral_sk.diffie_hellman(&their_spk).to_bytes();

    let mut ikm = Vec::with_capacity(128);
    ikm.extend_from_slice(&dh1);
    ikm.extend_from_slice(&dh2);
    ikm.extend_from_slice(&dh3);

    if let Some(ref opk) = their_opk {
        let mut dh4 = ephemeral_sk.diffie_hellman(opk).to_bytes();
        ikm.extend_from_slice(&dh4);
        dh4.zeroize();
    }

    dh1.zeroize();
    dh2.zeroize();
    dh3.zeroize();

    // 4. HKDF to derive the shared secret.
    let salt = [0u8; 32];
    let hk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
    let mut shared_secret = [0u8; 32];
    hk.expand(X3DH_INFO, &mut shared_secret)
        .map_err(|_| "X3DH key derivation failed".to_string())?;

    ikm.zeroize();

    Ok(X3dhSenderResult {
        shared_secret,
        ephemeral_pub: ephemeral_pub.to_bytes(),
        spk_id: bundle.spk_id,
        opk_id: bundle.opk_id,
    })
}

// ---------------------------------------------------------------------------
// Receiver side
// ---------------------------------------------------------------------------

/// Perform receiver-side X3DH: mirror the sender's DH operations to derive
/// the same shared secret.
pub fn x3dh_receiver(
    our_ik: &IdentityKeyPair,
    our_spk: &X25519KeyPair,
    our_opk: Option<&X25519KeyPair>,
    input: &X3dhReceiverInput,
) -> Result<[u8; 32], String> {
    // Convert sender's IK to X25519.
    let sender_ik_ed = VerifyingKey::from_bytes(&input.sender_ik_pub)
        .map_err(|_| format!("X3DH bundle malformed: invalid sender IK bytes"))?;
    let sender_ik_x = ed25519_verifying_to_x25519_public(&sender_ik_ed)?;
    let sender_eph = PublicKey::from(input.sender_ephemeral_pub);

    let our_ik_x_secret = our_ik.to_x25519_secret();

    // Mirror the DH operations (note the swapped roles).
    let mut dh1 = our_spk.private().diffie_hellman(&sender_ik_x).to_bytes();
    let mut dh2 = our_ik_x_secret.diffie_hellman(&sender_eph).to_bytes();
    let mut dh3 = our_spk.private().diffie_hellman(&sender_eph).to_bytes();

    let mut ikm = Vec::with_capacity(128);
    ikm.extend_from_slice(&dh1);
    ikm.extend_from_slice(&dh2);
    ikm.extend_from_slice(&dh3);

    if let Some(opk) = our_opk {
        let mut dh4 = opk.private().diffie_hellman(&sender_eph).to_bytes();
        ikm.extend_from_slice(&dh4);
        dh4.zeroize();
    }

    dh1.zeroize();
    dh2.zeroize();
    dh3.zeroize();

    let salt = [0u8; 32];
    let hk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
    let mut shared_secret = [0u8; 32];
    hk.expand(X3DH_INFO, &mut shared_secret)
        .map_err(|_| "X3DH key derivation failed".to_string())?;

    ikm.zeroize();

    Ok(shared_secret)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn x3dh_sender_receiver_derive_same_secret() {
        let alice_ik = IdentityKeyPair::generate();
        let bob_ik = IdentityKeyPair::generate();
        let bob_spk = X25519KeyPair::generate();
        let bob_opk = X25519KeyPair::generate();

        // Build Bob's bundle signed by his IK.
        let spk_sig = bob_ik.sign(&bob_spk.public_bytes());
        let bundle = PreKeyBundle {
            ik_pub: bob_ik.verifying_key().to_bytes(),
            spk_pub: bob_spk.public_bytes(),
            spk_sig: spk_sig.to_bytes().to_vec(),
            opk_pub: Some(bob_opk.public_bytes()),
            spk_id: 1,
            opk_id: Some(42),
        };

        let sender_result = x3dh_sender(&alice_ik, &bundle).expect("sender X3DH");

        let receiver_input = X3dhReceiverInput {
            sender_ik_pub: alice_ik.verifying_key().to_bytes(),
            sender_ephemeral_pub: sender_result.ephemeral_pub,
            spk_id: 1,
            opk_id: Some(42),
        };
        let receiver_secret = x3dh_receiver(&bob_ik, &bob_spk, Some(&bob_opk), &receiver_input)
            .expect("receiver X3DH");

        assert_eq!(sender_result.shared_secret, receiver_secret);
    }

    #[test]
    fn x3dh_without_opk() {
        let alice_ik = IdentityKeyPair::generate();
        let bob_ik = IdentityKeyPair::generate();
        let bob_spk = X25519KeyPair::generate();

        let spk_sig = bob_ik.sign(&bob_spk.public_bytes());
        let bundle = PreKeyBundle {
            ik_pub: bob_ik.verifying_key().to_bytes(),
            spk_pub: bob_spk.public_bytes(),
            spk_sig: spk_sig.to_bytes().to_vec(),
            opk_pub: None,
            spk_id: 5,
            opk_id: None,
        };

        let sender_result = x3dh_sender(&alice_ik, &bundle).expect("sender X3DH no OPK");

        let receiver_input = X3dhReceiverInput {
            sender_ik_pub: alice_ik.verifying_key().to_bytes(),
            sender_ephemeral_pub: sender_result.ephemeral_pub,
            spk_id: 5,
            opk_id: None,
        };
        let receiver_secret =
            x3dh_receiver(&bob_ik, &bob_spk, None, &receiver_input).expect("receiver X3DH no OPK");

        assert_eq!(sender_result.shared_secret, receiver_secret);
    }

    #[test]
    fn x3dh_bad_spk_signature_rejected() {
        let alice_ik = IdentityKeyPair::generate();
        let bob_ik = IdentityKeyPair::generate();
        let bob_spk = X25519KeyPair::generate();

        // Sign with a different key — forgery.
        let eve_ik = IdentityKeyPair::generate();
        let bad_sig = eve_ik.sign(&bob_spk.public_bytes());
        let bundle = PreKeyBundle {
            ik_pub: bob_ik.verifying_key().to_bytes(),
            spk_pub: bob_spk.public_bytes(),
            spk_sig: bad_sig.to_bytes().to_vec(),
            opk_pub: None,
            spk_id: 1,
            opk_id: None,
        };

        let result = x3dh_sender(&alice_ik, &bundle);
        assert!(result.is_err());
        let err_msg = result.unwrap_err();
        assert!(
            err_msg.contains("SPK signature invalid"),
            "unexpected error: {err_msg}"
        );
    }
}
