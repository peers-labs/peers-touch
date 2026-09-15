use hpke_rs::hpke_types::{AeadAlgorithm, KdfAlgorithm, KemAlgorithm};
use hpke_rs::rustcrypto::HpkeRustCrypto;
use hpke_rs::{Hpke, HpkePrivateKey, HpkePublicKey, Mode};
use rand::{rngs::OsRng, RngCore};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::prekey::{ContentPreKeyPrivate, ContentPreKeyPublic};

pub const CONTENT_KEY_SIZE: usize = 32;

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct ContentKey([u8; CONTENT_KEY_SIZE]);

impl ContentKey {
    pub fn from_bytes(bytes: [u8; CONTENT_KEY_SIZE]) -> Self {
        Self(bytes)
    }

    pub fn generate() -> Self {
        let mut bytes = [0_u8; CONTENT_KEY_SIZE];
        OsRng.fill_bytes(&mut bytes);
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; CONTENT_KEY_SIZE] {
        &self.0
    }

    pub fn to_bytes(&self) -> [u8; CONTENT_KEY_SIZE] {
        self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SealedContentKey {
    pub encapsulated_key: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

pub fn seal_content_key(
    recipient: ContentPreKeyPublic,
    canonical_binding: &[u8],
    content_key: &ContentKey,
) -> Result<SealedContentKey, String> {
    if canonical_binding.is_empty() {
        return Err("secure content envelope binding is required".to_string());
    }
    let mut hpke = suite();
    let recipient = HpkePublicKey::new(recipient.as_bytes().to_vec());
    let (encapsulated_key, ciphertext) = hpke
        .seal(
            &recipient,
            canonical_binding,
            canonical_binding,
            content_key.as_bytes(),
            None,
            None,
            None,
        )
        .map_err(|_| "secure content envelope seal failed".to_string())?;
    Ok(SealedContentKey {
        encapsulated_key,
        ciphertext,
    })
}

pub fn open_content_key(
    recipient: &ContentPreKeyPrivate,
    canonical_binding: &[u8],
    envelope: &SealedContentKey,
) -> Result<ContentKey, String> {
    if canonical_binding.is_empty()
        || envelope.encapsulated_key.len() != 32
        || envelope.ciphertext.len() != CONTENT_KEY_SIZE + 16
    {
        return Err("secure content envelope is invalid".to_string());
    }
    let hpke = suite();
    let recipient = HpkePrivateKey::new(recipient.as_bytes().to_vec());
    let plaintext = hpke
        .open(
            &envelope.encapsulated_key,
            &recipient,
            canonical_binding,
            canonical_binding,
            &envelope.ciphertext,
            None,
            None,
            None,
        )
        .map_err(|_| "secure content envelope authentication failed".to_string())?;
    let key = plaintext
        .as_slice()
        .try_into()
        .map_err(|_| "secure content envelope plaintext is invalid".to_string())?;
    Ok(ContentKey::from_bytes(key))
}

fn suite() -> Hpke<HpkeRustCrypto> {
    Hpke::new(
        Mode::Base,
        KemAlgorithm::DhKem25519,
        KdfAlgorithm::HkdfSha256,
        AeadAlgorithm::Aes256Gcm,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hpke_round_trip_binds_info_and_aad_to_the_same_canonical_bytes() {
        let recipient = ContentPreKeyPrivate::from_bytes([11; 32]);
        let content_key = ContentKey::from_bytes([29; 32]);
        let envelope =
            seal_content_key(recipient.public_key(), b"canonical binding", &content_key).unwrap();

        let opened = open_content_key(&recipient, b"canonical binding", &envelope).unwrap();
        assert_eq!(opened.as_bytes(), content_key.as_bytes());
        assert!(open_content_key(&recipient, b"another binding", &envelope).is_err());

        let mut tampered = envelope;
        tampered.ciphertext[0] ^= 1;
        assert!(open_content_key(&recipient, b"canonical binding", &tampered).is_err());
    }
}
