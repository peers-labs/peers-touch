use crate::proto::chat::{
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
