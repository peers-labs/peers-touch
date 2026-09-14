use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const PAYLOAD_KEY_SIZE: usize = 32;
pub const PAYLOAD_NONCE_SIZE: usize = 12;

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct PayloadKey([u8; PAYLOAD_KEY_SIZE]);

impl PayloadKey {
    pub fn from_bytes(bytes: [u8; PAYLOAD_KEY_SIZE]) -> Self {
        Self(bytes)
    }

    pub fn generate() -> Self {
        let mut bytes = [0_u8; PAYLOAD_KEY_SIZE];
        OsRng.fill_bytes(&mut bytes);
        Self(bytes)
    }

    fn as_bytes(&self) -> &[u8; PAYLOAD_KEY_SIZE] {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedPayload {
    pub nonce: [u8; PAYLOAD_NONCE_SIZE],
    pub ciphertext: Vec<u8>,
    pub ciphertext_sha256: [u8; 32],
    pub aad_sha256: [u8; 32],
}

pub fn encrypt_payload(
    key: &PayloadKey,
    plaintext: &[u8],
    aad: &[u8],
) -> Result<EncryptedPayload, String> {
    let mut nonce = [0_u8; PAYLOAD_NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce);
    encrypt_payload_with_nonce(key, nonce, plaintext, aad)
}

pub fn encrypt_payload_with_nonce(
    key: &PayloadKey,
    nonce: [u8; PAYLOAD_NONCE_SIZE],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<EncryptedPayload, String> {
    if plaintext.is_empty() || aad.is_empty() {
        return Err("secure content payload plaintext and AAD are required".to_string());
    }
    let cipher = Aes256Gcm::new_from_slice(key.as_bytes())
        .map_err(|_| "secure content payload key is invalid".to_string())?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| "secure content payload encryption failed".to_string())?;
    Ok(EncryptedPayload {
        nonce,
        ciphertext_sha256: Sha256::digest(&ciphertext).into(),
        aad_sha256: Sha256::digest(aad).into(),
        ciphertext,
    })
}

pub fn decrypt_payload(
    key: &PayloadKey,
    payload: &EncryptedPayload,
    aad: &[u8],
) -> Result<Vec<u8>, String> {
    if payload.aad_sha256 != Sha256::digest(aad).as_slice() {
        return Err("secure content payload AAD commitment mismatch".to_string());
    }
    if payload.ciphertext_sha256 != Sha256::digest(&payload.ciphertext).as_slice() {
        return Err("secure content payload ciphertext commitment mismatch".to_string());
    }
    let cipher = Aes256Gcm::new_from_slice(key.as_bytes())
        .map_err(|_| "secure content payload key is invalid".to_string())?;
    cipher
        .decrypt(
            Nonce::from_slice(&payload.nonce),
            Payload {
                msg: &payload.ciphertext,
                aad,
            },
        )
        .map_err(|_| "secure content payload authentication failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_vector_is_stable_and_tamper_fails_closed() {
        let key = PayloadKey::from_bytes([7; 32]);
        let encrypted =
            encrypt_payload_with_nonce(&key, [3; 12], b"private payload", b"binding").unwrap();
        assert_eq!(
            hex(&encrypted.ciphertext),
            "558cca753b5c3b620a213a3084369bb010584b41cb051d9be1df145ad397c1"
        );
        assert_eq!(
            decrypt_payload(&key, &encrypted, b"binding").unwrap(),
            b"private payload"
        );
        assert!(decrypt_payload(&key, &encrypted, b"other binding").is_err());

        let mut tampered = encrypted;
        tampered.ciphertext[0] ^= 1;
        assert!(decrypt_payload(&key, &tampered, b"binding").is_err());
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}
