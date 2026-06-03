use crate::error::{MobileError, MobileResult};

#[derive(Clone, Default)]
pub struct SecureStorage;

impl SecureStorage {
    pub fn new() -> Self {
        Self
    }

    pub fn set(&self, _key: &str, _value: &str) -> MobileResult<()> {
        Err(MobileError::unsupported(
            "secure storage is only implemented for the iOS Tauri Mobile target",
        ))
    }

    pub fn get(&self, _key: &str) -> MobileResult<Option<String>> {
        Err(MobileError::unsupported(
            "secure storage is only implemented for the iOS Tauri Mobile target",
        ))
    }

    pub fn remove(&self, _key: &str) -> MobileResult<()> {
        Err(MobileError::unsupported(
            "secure storage is only implemented for the iOS Tauri Mobile target",
        ))
    }
}
