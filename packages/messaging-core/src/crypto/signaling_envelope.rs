use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use ed25519_dalek::VerifyingKey;
use hkdf::Hkdf;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroize;

use super::identity::{ed25519_verifying_to_x25519_public, IdentityKeyPair};

const EPH_PUB_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const GCM_TAG_LEN: usize = 16;
const ENVELOPE_HEADER_LEN: usize = EPH_PUB_LEN + NONCE_LEN;
const HKDF_INFO: &[u8] = b"peers-touch:signaling:v1";

pub fn seal(
    sender: &IdentityKeyPair,
    recipient: &VerifyingKey,
    session_ulid: &str,
    kind: &str,
    plaintext: &[u8],
) -> Result<Vec<u8>, String> {
    validate_context(session_ulid, kind)?;
    let recipient_public = ed25519_verifying_to_x25519_public(recipient)?;
    let sender_private = sender.to_x25519_secret();
    let sender_public = sender.to_x25519_public();
    let ephemeral_private = StaticSecret::random_from_rng(OsRng);
    let ephemeral_public = PublicKey::from(&ephemeral_private);
    let mut shared_ephemeral = ephemeral_private
        .diffie_hellman(&recipient_public)
        .to_bytes();
    let mut shared_identity = sender_private.diffie_hellman(&recipient_public).to_bytes();
    let mut key = derive_key(
        &shared_ephemeral,
        &shared_identity,
        ephemeral_public.as_bytes(),
        sender_public.as_bytes(),
    )?;
    shared_ephemeral.zeroize();
    shared_identity.zeroize();

    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "signaling envelope key is invalid".to_string())?
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad_for(session_ulid, kind),
            },
        )
        .map_err(|_| "signaling envelope encryption failed".to_string())?;
    key.zeroize();

    let mut envelope = Vec::with_capacity(ENVELOPE_HEADER_LEN + encrypted.len());
    envelope.extend_from_slice(ephemeral_public.as_bytes());
    envelope.extend_from_slice(&nonce);
    envelope.extend_from_slice(&encrypted);
    Ok(envelope)
}

pub fn open(
    recipient: &IdentityKeyPair,
    sender: &VerifyingKey,
    session_ulid: &str,
    kind: &str,
    envelope: &[u8],
) -> Result<Vec<u8>, String> {
    validate_context(session_ulid, kind)?;
    if envelope.len() < ENVELOPE_HEADER_LEN + GCM_TAG_LEN {
        return Err("signaling envelope is truncated".to_string());
    }

    let sender_public = ed25519_verifying_to_x25519_public(sender)?;
    let recipient_private = recipient.to_x25519_secret();
    let mut ephemeral_bytes = [0u8; EPH_PUB_LEN];
    ephemeral_bytes.copy_from_slice(&envelope[..EPH_PUB_LEN]);
    let ephemeral_public = PublicKey::from(ephemeral_bytes);
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&envelope[EPH_PUB_LEN..ENVELOPE_HEADER_LEN]);
    let mut shared_ephemeral = recipient_private
        .diffie_hellman(&ephemeral_public)
        .to_bytes();
    let mut shared_identity = recipient_private.diffie_hellman(&sender_public).to_bytes();
    let mut key = derive_key(
        &shared_ephemeral,
        &shared_identity,
        ephemeral_public.as_bytes(),
        sender_public.as_bytes(),
    )?;
    shared_ephemeral.zeroize();
    shared_identity.zeroize();

    let opened = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "signaling envelope key is invalid".to_string())?
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &envelope[ENVELOPE_HEADER_LEN..],
                aad: &aad_for(session_ulid, kind),
            },
        )
        .map_err(|_| "signaling envelope authentication failed".to_string());
    key.zeroize();
    opened
}

fn validate_context(session_ulid: &str, kind: &str) -> Result<(), String> {
    if session_ulid.trim().is_empty() || kind.trim().is_empty() {
        return Err("signaling envelope context is incomplete".to_string());
    }
    Ok(())
}

fn aad_for(session_ulid: &str, kind: &str) -> Vec<u8> {
    format!("signaling:v1|{session_ulid}|{kind}").into_bytes()
}

fn derive_key(
    shared_ephemeral: &[u8; 32],
    shared_identity: &[u8; 32],
    ephemeral_public: &[u8; 32],
    sender_public: &[u8; 32],
) -> Result<[u8; 32], String> {
    let mut input = [0u8; 64];
    input[..32].copy_from_slice(shared_ephemeral);
    input[32..].copy_from_slice(shared_identity);
    let mut salt = [0u8; 64];
    salt[..32].copy_from_slice(ephemeral_public);
    salt[32..].copy_from_slice(sender_public);
    let mut key = [0u8; 32];
    Hkdf::<Sha256>::new(Some(&salt), &input)
        .expand(HKDF_INFO, &mut key)
        .map_err(|_| "signaling envelope key derivation failed".to_string())?;
    input.zeroize();
    salt.zeroize();
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_context_binding() {
        let alice = IdentityKeyPair::generate();
        let bob = IdentityKeyPair::generate();
        let envelope = seal(
            &alice,
            bob.verifying_key(),
            "session-1",
            "CALL_REQUEST",
            br#"{"callId":"01TEST"}"#,
        )
        .unwrap();

        assert_eq!(
            open(
                &bob,
                alice.verifying_key(),
                "session-1",
                "CALL_REQUEST",
                &envelope,
            )
            .unwrap(),
            br#"{"callId":"01TEST"}"#,
        );
        assert!(open(
            &bob,
            alice.verifying_key(),
            "session-1",
            "CALL_ACCEPT",
            &envelope,
        )
        .is_err());
    }

    #[test]
    fn every_envelope_uses_fresh_ephemeral_material() {
        let alice = IdentityKeyPair::generate();
        let bob = IdentityKeyPair::generate();
        let first = seal(&alice, bob.verifying_key(), "session-1", "OFFER", b"same").unwrap();
        let second = seal(&alice, bob.verifying_key(), "session-1", "OFFER", b"same").unwrap();
        assert_ne!(first, second);
    }
}
