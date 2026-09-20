use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const PAYLOAD_KEY_SIZE: usize = 32;
pub const PAYLOAD_NONCE_SIZE: usize = 12;
pub const PAYLOAD_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PayloadKeyContext<'a> {
    pub protocol_version: u32,
    pub owner_domain: u32,
    pub content_id: &'a str,
    pub generation: u64,
    pub payload_kind: u32,
}

impl PayloadKeyContext<'_> {
    fn validate(&self) -> Result<(), String> {
        if self.protocol_version == 0
            || self.owner_domain == 0
            || self.content_id.is_empty()
            || self.content_id.trim() != self.content_id
            || self.content_id.as_bytes().contains(&0)
            || self.content_id.len() > u32::MAX as usize
            || self.generation == 0
            || self.payload_kind == 0
        {
            return Err("secure content payload key context is invalid".to_string());
        }
        Ok(())
    }

    fn info(&self) -> Result<Vec<u8>, String> {
        self.validate()?;
        let content_id_len = u32::try_from(self.content_id.len())
            .map_err(|_| "secure content payload content ID is too long".to_string())?;
        let mut info = Vec::with_capacity(4 + 4 + 4 + self.content_id.len() + 8 + 4);
        info.extend_from_slice(&self.protocol_version.to_be_bytes());
        info.extend_from_slice(&self.owner_domain.to_be_bytes());
        info.extend_from_slice(&content_id_len.to_be_bytes());
        info.extend_from_slice(self.content_id.as_bytes());
        info.extend_from_slice(&self.generation.to_be_bytes());
        info.extend_from_slice(&self.payload_kind.to_be_bytes());
        Ok(info)
    }
}

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

pub fn derive_payload_key(
    content_key: &[u8; PAYLOAD_KEY_SIZE],
    authorization_snapshot_sha256: &[u8; 32],
    context: &PayloadKeyContext<'_>,
) -> Result<PayloadKey, String> {
    let info = context.info()?;
    let hkdf = Hkdf::<Sha256>::new(Some(authorization_snapshot_sha256), content_key);
    let mut payload_key = [0_u8; PAYLOAD_KEY_SIZE];
    hkdf.expand(&info, &mut payload_key)
        .map_err(|_| "secure content payload key derivation failed".to_string())?;
    Ok(PayloadKey::from_bytes(payload_key))
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

    #[test]
    fn secure_content_payload_key_matches_the_architecture_transcript() {
        let context = PayloadKeyContext {
            protocol_version: PAYLOAD_FORMAT_VERSION,
            owner_domain: 2,
            content_id: "01HX",
            generation: 7,
            payload_kind: 1,
        };
        assert_eq!(
            hex(&context.info().unwrap()),
            "00000001000000020000000430314858000000000000000700000001"
        );

        let key = derive_payload_key(&[0x42; 32], &[0x11; 32], &context).unwrap();
        assert_eq!(
            hex(key.as_bytes()),
            "6df64b3535cb706881c0157d8eda6b3cae82cee20037d9446ced5e05846ff45d"
        );
    }

    #[test]
    fn secure_content_payload_key_rejects_ambiguous_or_unscoped_contexts() {
        let valid = PayloadKeyContext {
            protocol_version: 1,
            owner_domain: 2,
            content_id: "content-1",
            generation: 1,
            payload_kind: 1,
        };
        for invalid in [
            PayloadKeyContext {
                protocol_version: 0,
                ..valid.clone()
            },
            PayloadKeyContext {
                owner_domain: 0,
                ..valid.clone()
            },
            PayloadKeyContext {
                content_id: " content-1",
                ..valid.clone()
            },
            PayloadKeyContext {
                content_id: "content\0-1",
                ..valid.clone()
            },
            PayloadKeyContext {
                generation: 0,
                ..valid.clone()
            },
            PayloadKeyContext {
                payload_kind: 0,
                ..valid.clone()
            },
        ] {
            assert!(derive_payload_key(&[1; 32], &[2; 32], &invalid).is_err());
        }
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}
