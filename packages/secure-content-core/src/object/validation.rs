pub const OBJECT_CHUNK_SIZE: u32 = 1024 * 1024;
pub const OBJECT_TAG_SIZE: u32 = 16;
pub const OBJECT_MAX_CHUNK_COUNT: u32 = 2048;
pub const OBJECT_MAX_PLAINTEXT_SIZE: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum ObjectEncryptionSuite {
    Aes256GcmChunked = 1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum ObjectNonceStrategy {
    Counter32Be = 1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectUploadSpec {
    pub ciphertext_size: u64,
    pub ciphertext_sha256: Vec<u8>,
    pub media_type: Option<String>,
    pub chunk_size: u32,
    pub chunk_count: u32,
    pub encryption_suite: ObjectEncryptionSuite,
    pub tag_size: u32,
    pub nonce_strategy: ObjectNonceStrategy,
    pub chunk_ciphertext_sha256: Vec<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectDescriptor {
    pub object_id: String,
    pub storage_ref: String,
    pub commitment: ObjectUploadSpec,
}

pub fn validate_object_upload_spec(spec: &ObjectUploadSpec) -> Result<(), String> {
    if spec.ciphertext_sha256.len() != 32
        || spec
            .media_type
            .as_ref()
            .is_some_and(|value| value.trim().is_empty() || value.len() > 255)
        || spec.chunk_size != OBJECT_CHUNK_SIZE
        || spec.chunk_count == 0
        || spec.tag_size != OBJECT_TAG_SIZE
        || spec.encryption_suite != ObjectEncryptionSuite::Aes256GcmChunked
        || spec.nonce_strategy != ObjectNonceStrategy::Counter32Be
        || spec.chunk_ciphertext_sha256.len() != spec.chunk_count as usize
        || spec
            .chunk_ciphertext_sha256
            .iter()
            .any(|hash| hash.len() != 32)
    {
        return Err("secure content object descriptor is invalid".to_string());
    }
    if spec.chunk_count > OBJECT_MAX_CHUNK_COUNT {
        return Err("secure content object exceeds policy".to_string());
    }
    let minimum_size = u64::from(spec.chunk_count - 1)
        .saturating_mul(u64::from(spec.chunk_size + spec.tag_size))
        .saturating_add(u64::from(spec.tag_size) + 1);
    let maximum_size =
        u64::from(spec.chunk_count).saturating_mul(u64::from(spec.chunk_size + spec.tag_size));
    let maximum_policy_size = OBJECT_MAX_PLAINTEXT_SIZE
        .saturating_add(u64::from(OBJECT_MAX_CHUNK_COUNT * OBJECT_TAG_SIZE));
    if spec.ciphertext_size < minimum_size || spec.ciphertext_size > maximum_size {
        return Err("secure content object descriptor is invalid".to_string());
    }
    if spec.ciphertext_size > maximum_policy_size {
        return Err("secure content object exceeds policy".to_string());
    }
    Ok(())
}

pub fn validate_object_descriptor(descriptor: &ObjectDescriptor) -> Result<(), String> {
    if descriptor.object_id.trim().is_empty() || descriptor.storage_ref.trim().is_empty() {
        return Err("secure content object descriptor is invalid".to_string());
    }
    validate_object_upload_spec(&descriptor.commitment)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_spec() -> ObjectUploadSpec {
        ObjectUploadSpec {
            ciphertext_size: u64::from(OBJECT_CHUNK_SIZE) + u64::from(2 * OBJECT_TAG_SIZE) + 1,
            ciphertext_sha256: vec![0; 32],
            media_type: None,
            chunk_size: OBJECT_CHUNK_SIZE,
            chunk_count: 2,
            encryption_suite: ObjectEncryptionSuite::Aes256GcmChunked,
            tag_size: OBJECT_TAG_SIZE,
            nonce_strategy: ObjectNonceStrategy::Counter32Be,
            chunk_ciphertext_sha256: vec![vec![0; 32], vec![0; 32]],
        }
    }

    #[test]
    fn validates_bounded_object_commitments() {
        validate_object_upload_spec(&valid_spec()).unwrap();
        let mut invalid = valid_spec();
        invalid.chunk_ciphertext_sha256.pop();
        assert!(validate_object_upload_spec(&invalid).is_err());
        invalid = valid_spec();
        invalid.chunk_count = OBJECT_MAX_CHUNK_COUNT + 1;
        invalid.chunk_ciphertext_sha256 = vec![vec![0; 32]; invalid.chunk_count as usize];
        assert_eq!(
            validate_object_upload_spec(&invalid).unwrap_err(),
            "secure content object exceeds policy"
        );
    }
}
