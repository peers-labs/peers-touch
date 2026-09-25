use crate::infrastructure::storage::{self, StorageError, StorageKind};
use ulid::Ulid;

/// Returns the canonical installation device identity under app data.
fn device_id_path() -> Result<std::path::PathBuf, StorageError> {
    let profile = std::env::var("PT_PROFILE").unwrap_or_else(|_| "desktop".to_string());
    storage::app_file_path(&profile, StorageKind::Data, &["auth", "device_id"])
}

/// Stable per-install opaque id shared by Access, Session, and Messaging.
pub fn get_or_create_device_id() -> Result<String, StorageError> {
    let path = device_id_path()?;
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let s = existing.trim();
        if !s.is_empty() {
            return Ok(s.to_string());
        }
    }
    let id = Ulid::new().to_string();
    storage::write_string_atomic(&path, &id)?;
    Ok(id)
}

/// Mint a fresh current-device identity after history recovery.
///
/// Recovery never reuses the previous install's device address or sessions.
pub fn rotate_device_id() -> Result<String, StorageError> {
    let path = device_id_path()?;
    let id = Ulid::new().to_string();
    storage::write_string_atomic(&path, &id)?;
    Ok(id)
}
