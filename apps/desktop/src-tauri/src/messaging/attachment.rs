use crate::model::chat::{
    AttachmentEncryptionSuite, AttachmentNonceStrategy, EncryptedObjectDescriptor,
    EncryptedObjectUploadSpec,
};

pub const ATTACHMENT_CHUNK_SIZE: u32 = 1024 * 1024;
pub const ATTACHMENT_TAG_SIZE: u32 = 16;
pub const ATTACHMENT_MAX_CHUNK_COUNT: u32 = 2048;
pub const ATTACHMENT_MAX_PLAINTEXT_SIZE: u64 = 2 * 1024 * 1024 * 1024;

pub fn validate_encrypted_object_upload_spec(
    spec: &EncryptedObjectUploadSpec,
) -> Result<(), String> {
    if spec.ciphertext_sha256.len() != 32
        || spec.media_type.trim().is_empty()
        || spec.media_type.len() > 255
        || spec.chunk_size != ATTACHMENT_CHUNK_SIZE
        || spec.chunk_count == 0
        || spec.tag_size != ATTACHMENT_TAG_SIZE
        || spec.encryption_suite != AttachmentEncryptionSuite::Aes256GcmChunked as i32
        || spec.nonce_strategy != AttachmentNonceStrategy::Counter32Be as i32
        || spec.chunk_ciphertext_sha256.len() != spec.chunk_count as usize
        || spec
            .chunk_ciphertext_sha256
            .iter()
            .any(|hash| hash.len() != 32)
    {
        return Err("messaging attachment descriptor is invalid".to_string());
    }
    if spec.chunk_count > ATTACHMENT_MAX_CHUNK_COUNT {
        return Err("messaging attachment exceeds policy".to_string());
    }
    let minimum_size = u64::from(spec.chunk_count - 1)
        .saturating_mul(u64::from(spec.chunk_size + spec.tag_size))
        .saturating_add(u64::from(spec.tag_size) + 1);
    let maximum_size =
        u64::from(spec.chunk_count).saturating_mul(u64::from(spec.chunk_size + spec.tag_size));
    let maximum_policy_size = ATTACHMENT_MAX_PLAINTEXT_SIZE
        .saturating_add(u64::from(ATTACHMENT_MAX_CHUNK_COUNT * ATTACHMENT_TAG_SIZE));
    if spec.ciphertext_size < minimum_size || spec.ciphertext_size > maximum_size {
        return Err("messaging attachment descriptor is invalid".to_string());
    }
    if spec.ciphertext_size > maximum_policy_size {
        return Err("messaging attachment exceeds policy".to_string());
    }
    Ok(())
}

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

pub fn attachment_chunk_nonce(base_nonce: &[u8; 12], chunk_index: u32) -> [u8; 12] {
    let mut nonce = *base_nonce;
    nonce[8..12].copy_from_slice(&chunk_index.to_be_bytes());
    nonce
}

pub fn attachment_chunk_aad(chunk_index: u32, plaintext_size: u64, chunk_size: u32) -> Vec<u8> {
    format!(
        "peers-touch:attachment:aes-256-gcm-chunked:1:{chunk_index}:{plaintext_size}:{chunk_size}"
    )
    .into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    use aes_gcm::{Aes256Gcm, Nonce};

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
    }

    #[test]
    fn matches_canonical_chunk_encryption_vector() {
        let key = std::array::from_fn::<_, 32, _>(|index| index as u8);
        let base_nonce = [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0, 0, 0, 0];
        let plaintext = (1u8..=32).collect::<Vec<_>>();
        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let mut ciphertext = Vec::new();
        for chunk_index in 0..2 {
            let start = chunk_index as usize * 16;
            let nonce = attachment_chunk_nonce(&base_nonce, chunk_index);
            let aad = attachment_chunk_aad(chunk_index, plaintext.len() as u64, 16);
            ciphertext.extend(
                cipher
                    .encrypt(
                        Nonce::from_slice(&nonce),
                        Payload {
                            msg: &plaintext[start..start + 16],
                            aad: &aad,
                        },
                    )
                    .unwrap(),
            );
        }
        assert_eq!(
            hex::encode(ciphertext),
            "ff5bedac5434752dde75d19581783aba3d7bc55e59e876c386d1bfdc96e75c9d2291443061467fc9daaaaa2577931182d7f28a188af2467a6f3d39e06c407539"
        );
    }
}
