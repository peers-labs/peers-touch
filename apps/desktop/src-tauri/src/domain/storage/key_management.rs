use std::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyErrorCode {
    NotFound,
    PermissionDenied,
    BackendLocked,
    IoFailure,
    VersionConflict,
    Internal,
}

impl fmt::Display for KeyErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            KeyErrorCode::NotFound => write!(f, "KEY_NOT_FOUND"),
            KeyErrorCode::PermissionDenied => write!(f, "KEY_PERMISSION_DENIED"),
            KeyErrorCode::BackendLocked => write!(f, "KEY_BACKEND_LOCKED"),
            KeyErrorCode::IoFailure => write!(f, "KEY_IO_FAILURE"),
            KeyErrorCode::VersionConflict => write!(f, "KEY_VERSION_CONFLICT"),
            KeyErrorCode::Internal => write!(f, "KEY_INTERNAL"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct KeyProviderError {
    pub code: KeyErrorCode,
    pub key_ref_hash: String,
    pub message: String,
}

impl fmt::Display for KeyProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "[{}] ref={} {}",
            self.code, self.key_ref_hash, self.message
        )
    }
}

impl KeyProviderError {
    pub fn not_found(key_ref: &str, message: impl Into<String>) -> Self {
        Self {
            code: KeyErrorCode::NotFound,
            key_ref_hash: sanitize_key_ref(key_ref),
            message: message.into(),
        }
    }
    pub fn permission_denied(key_ref: &str, message: impl Into<String>) -> Self {
        Self {
            code: KeyErrorCode::PermissionDenied,
            key_ref_hash: sanitize_key_ref(key_ref),
            message: message.into(),
        }
    }
    pub fn backend_locked(key_ref: &str, message: impl Into<String>) -> Self {
        Self {
            code: KeyErrorCode::BackendLocked,
            key_ref_hash: sanitize_key_ref(key_ref),
            message: message.into(),
        }
    }
    pub fn io_failure(key_ref: &str, message: impl Into<String>) -> Self {
        Self {
            code: KeyErrorCode::IoFailure,
            key_ref_hash: sanitize_key_ref(key_ref),
            message: message.into(),
        }
    }
    pub fn version_conflict(key_ref: &str, message: impl Into<String>) -> Self {
        Self {
            code: KeyErrorCode::VersionConflict,
            key_ref_hash: sanitize_key_ref(key_ref),
            message: message.into(),
        }
    }
    pub fn internal(key_ref: &str, message: impl Into<String>) -> Self {
        Self {
            code: KeyErrorCode::Internal,
            key_ref_hash: sanitize_key_ref(key_ref),
            message: message.into(),
        }
    }
}

fn sanitize_key_ref(key_ref: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    key_ref.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[derive(Debug, Clone, Zeroize, ZeroizeOnDrop)]
pub struct KeyMaterial {
    pub key_id: String,
    pub key_version: i32,
    pub key_bytes: Vec<u8>,
}

pub trait KeyProvider: Send + Sync {
    fn get_or_create_key(&self, key_ref: &str) -> Result<KeyMaterial, KeyProviderError>;
    fn rotate_key(&self, key_ref: &str, next_version: i32)
        -> Result<KeyMaterial, KeyProviderError>;
}
