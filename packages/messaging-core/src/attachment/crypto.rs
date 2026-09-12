use crate::proto::chat::{EncryptedObjectDescriptor, EncryptedObjectUploadSpec};
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop};

pub use crate::codec::attachment_validation::{
    attachment_chunk_aad, attachment_chunk_nonce, validate_encrypted_object_upload_spec,
    ATTACHMENT_CHUNK_SIZE, ATTACHMENT_MAX_PLAINTEXT_SIZE, ATTACHMENT_TAG_SIZE,
};

pub fn validate_encrypted_object_descriptor(
    descriptor: &EncryptedObjectDescriptor,
) -> Result<(), String> {
    if descriptor.object_id.trim().is_empty() || descriptor.storage_ref.trim().is_empty() {
        return Err("messaging attachment descriptor is invalid".to_string());
    }
    validate_encrypted_object_upload_spec(&EncryptedObjectUploadSpec {
        ciphertext_size: descriptor.ciphertext_size,
        ciphertext_sha256: descriptor.ciphertext_sha256.clone(),
        media_type: descriptor.media_type.clone(),
        chunk_size: descriptor.chunk_size,
        chunk_count: descriptor.chunk_count,
        encryption_suite: descriptor.encryption_suite,
        tag_size: descriptor.tag_size,
        nonce_strategy: descriptor.nonce_strategy,
        chunk_ciphertext_sha256: descriptor.chunk_ciphertext_sha256.clone(),
    })
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct AttachmentCryptoMaterial {
    object_key: [u8; 32],
    base_nonce: [u8; 12],
    plaintext_size: u64,
    chunk_size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedAttachmentChunk {
    pub chunk_index: u32,
    pub ciphertext: Vec<u8>,
    pub ciphertext_sha256: [u8; 32],
}

impl AttachmentCryptoMaterial {
    pub fn generate(plaintext_size: u64) -> Result<Self, String> {
        if plaintext_size == 0 || plaintext_size > ATTACHMENT_MAX_PLAINTEXT_SIZE {
            return Err("messaging attachment plaintext size exceeds policy".to_string());
        }
        let mut object_key = [0u8; 32];
        let mut base_nonce = [0u8; 12];
        OsRng.fill_bytes(&mut object_key);
        OsRng.fill_bytes(&mut base_nonce[..8]);
        Ok(Self {
            object_key,
            base_nonce,
            plaintext_size,
            chunk_size: ATTACHMENT_CHUNK_SIZE,
        })
    }

    pub fn from_parts(
        object_key: [u8; 32],
        base_nonce: [u8; 12],
        plaintext_size: u64,
        chunk_size: u32,
    ) -> Result<Self, String> {
        if plaintext_size == 0
            || plaintext_size > ATTACHMENT_MAX_PLAINTEXT_SIZE
            || chunk_size == 0
            || chunk_size > ATTACHMENT_CHUNK_SIZE
        {
            return Err("messaging attachment crypto material is invalid".to_string());
        }
        if base_nonce[8..] != [0, 0, 0, 0] {
            return Err("messaging attachment base nonce counter must be zero".to_string());
        }
        Ok(Self {
            object_key,
            base_nonce,
            plaintext_size,
            chunk_size,
        })
    }

    pub fn object_key(&self) -> &[u8; 32] {
        &self.object_key
    }

    pub fn base_nonce(&self) -> &[u8; 12] {
        &self.base_nonce
    }

    pub fn plaintext_size(&self) -> u64 {
        self.plaintext_size
    }

    pub fn chunk_size(&self) -> u32 {
        self.chunk_size
    }

    pub fn chunk_count(&self) -> u32 {
        self.plaintext_size
            .div_ceil(u64::from(self.chunk_size))
            .try_into()
            .unwrap_or(u32::MAX)
    }
}

pub fn encrypt_attachment_chunk(
    material: &AttachmentCryptoMaterial,
    chunk_index: u32,
    plaintext: &[u8],
) -> Result<EncryptedAttachmentChunk, String> {
    validate_plaintext_chunk(material, chunk_index, plaintext.len())?;
    let cipher = Aes256Gcm::new_from_slice(material.object_key())
        .map_err(|_| "messaging attachment object key is invalid".to_string())?;
    let nonce = attachment_chunk_nonce(material.base_nonce(), chunk_index);
    let aad = attachment_chunk_aad(
        chunk_index,
        material.plaintext_size(),
        material.chunk_size(),
    );
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| "messaging attachment chunk encryption failed".to_string())?;
    let ciphertext_sha256: [u8; 32] = Sha256::digest(&ciphertext).into();
    Ok(EncryptedAttachmentChunk {
        chunk_index,
        ciphertext,
        ciphertext_sha256,
    })
}

pub fn decrypt_attachment_chunk(
    material: &AttachmentCryptoMaterial,
    chunk: &EncryptedAttachmentChunk,
) -> Result<Vec<u8>, String> {
    let actual_ciphertext_sha256: [u8; 32] = Sha256::digest(&chunk.ciphertext).into();
    if actual_ciphertext_sha256 != chunk.ciphertext_sha256 {
        return Err("messaging attachment chunk hash mismatch".to_string());
    }
    let expected_plaintext_size = expected_plaintext_chunk_size(material, chunk.chunk_index)?;
    if chunk.ciphertext.len() != expected_plaintext_size + ATTACHMENT_TAG_SIZE as usize {
        return Err("messaging attachment chunk size mismatch".to_string());
    }
    let cipher = Aes256Gcm::new_from_slice(material.object_key())
        .map_err(|_| "messaging attachment object key is invalid".to_string())?;
    let nonce = attachment_chunk_nonce(material.base_nonce(), chunk.chunk_index);
    let aad = attachment_chunk_aad(
        chunk.chunk_index,
        material.plaintext_size(),
        material.chunk_size(),
    );
    cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &chunk.ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| "messaging attachment chunk authentication failed".to_string())
}

fn validate_plaintext_chunk(
    material: &AttachmentCryptoMaterial,
    chunk_index: u32,
    actual_size: usize,
) -> Result<(), String> {
    let expected = expected_plaintext_chunk_size(material, chunk_index)?;
    if actual_size != expected {
        return Err("messaging attachment plaintext chunk size mismatch".to_string());
    }
    Ok(())
}

fn expected_plaintext_chunk_size(
    material: &AttachmentCryptoMaterial,
    chunk_index: u32,
) -> Result<usize, String> {
    if chunk_index >= material.chunk_count() {
        return Err("messaging attachment chunk index exceeds policy".to_string());
    }
    let offset = u64::from(chunk_index) * u64::from(material.chunk_size());
    usize::try_from((material.plaintext_size() - offset).min(u64::from(material.chunk_size())))
        .map_err(|_| "messaging attachment chunk size is invalid".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::attachment_validation::ATTACHMENT_MAX_CHUNK_COUNT;
    use crate::proto::chat::{AttachmentEncryptionSuite, AttachmentNonceStrategy};

    fn valid_spec() -> EncryptedObjectUploadSpec {
        EncryptedObjectUploadSpec {
            ciphertext_size: u64::from(ATTACHMENT_CHUNK_SIZE)
                + u64::from(2 * ATTACHMENT_TAG_SIZE)
                + 1,
            ciphertext_sha256: vec![0; 32],
            media_type: "application/octet-stream".to_string(),
            chunk_size: ATTACHMENT_CHUNK_SIZE,
            chunk_count: 2,
            encryption_suite: AttachmentEncryptionSuite::Aes256GcmChunked as i32,
            tag_size: ATTACHMENT_TAG_SIZE,
            nonce_strategy: AttachmentNonceStrategy::Counter32Be as i32,
            chunk_ciphertext_sha256: vec![vec![0; 32], vec![0; 32]],
        }
    }

    #[test]
    fn validates_bounded_chunk_commitments() {
        validate_encrypted_object_upload_spec(&valid_spec()).unwrap();
        let mut invalid = valid_spec();
        invalid.chunk_ciphertext_sha256.pop();
        assert!(validate_encrypted_object_upload_spec(&invalid).is_err());
        invalid = valid_spec();
        invalid.chunk_count = ATTACHMENT_MAX_CHUNK_COUNT + 1;
        invalid.chunk_ciphertext_sha256 = vec![vec![0; 32]; invalid.chunk_count as usize];
        assert_eq!(
            validate_encrypted_object_upload_spec(&invalid).unwrap_err(),
            "messaging attachment exceeds policy"
        );
        invalid = valid_spec();
        invalid.media_type = "image/png".to_string();
        assert!(validate_encrypted_object_upload_spec(&invalid).is_err());
    }

    #[test]
    fn matches_canonical_chunk_encryption_vector() {
        let key = std::array::from_fn::<_, 32, _>(|index| index as u8);
        let base_nonce = [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0, 0, 0, 0];
        let plaintext = (1u8..=32).collect::<Vec<_>>();
        let material = AttachmentCryptoMaterial::from_parts(key, base_nonce, 32, 16).unwrap();
        let mut ciphertext = Vec::new();
        for chunk_index in 0..2 {
            let start = chunk_index as usize * 16;
            let encrypted =
                encrypt_attachment_chunk(&material, chunk_index, &plaintext[start..start + 16])
                    .unwrap();
            assert_eq!(
                decrypt_attachment_chunk(&material, &encrypted).unwrap(),
                plaintext[start..start + 16]
            );
            ciphertext.extend(encrypted.ciphertext);
        }
        assert_eq!(
            hex::encode(ciphertext),
            "ff5bedac5434752dde75d19581783aba3d7bc55e59e876c386d1bfdc96e75c9d2291443061467fc9daaaaa2577931182d7f28a188af2467a6f3d39e06c407539"
        );
    }

    #[test]
    fn rejects_hash_and_aead_tampering_before_plaintext_release() {
        let material = AttachmentCryptoMaterial::from_parts([7; 32], [0; 12], 17, 16).unwrap();
        let first = encrypt_attachment_chunk(&material, 0, &[9; 16]).unwrap();
        let mut hash_tampered = first.clone();
        hash_tampered.ciphertext[0] ^= 1;
        assert_eq!(
            decrypt_attachment_chunk(&material, &hash_tampered).unwrap_err(),
            "messaging attachment chunk hash mismatch"
        );

        let mut aead_tampered = first;
        aead_tampered.ciphertext[0] ^= 1;
        aead_tampered.ciphertext_sha256 = Sha256::digest(&aead_tampered.ciphertext).into();
        assert_eq!(
            decrypt_attachment_chunk(&material, &aead_tampered).unwrap_err(),
            "messaging attachment chunk authentication failed"
        );
    }

    #[test]
    fn enforces_exact_chunk_boundaries() {
        let material = AttachmentCryptoMaterial::from_parts([3; 32], [0; 12], 17, 16).unwrap();
        assert_eq!(material.chunk_count(), 2);
        assert!(encrypt_attachment_chunk(&material, 0, &[1; 15]).is_err());
        assert!(encrypt_attachment_chunk(&material, 1, &[2]).is_ok());
        assert!(encrypt_attachment_chunk(&material, 2, &[]).is_err());
    }
}
