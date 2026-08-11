use crate::infrastructure::storage::{self, StorageError, StorageKind};
use ulid::Ulid;

/// Returns `auth/sessions/<station_actor_scope>/device_id` under app data.
fn device_id_path(actor_id: &str) -> Result<std::path::PathBuf, StorageError> {
    let scope = crate::infrastructure::local_scope::user_scope_for_actor(Some(actor_id));
    let profile = std::env::var("PT_PROFILE").unwrap_or_else(|_| "desktop".to_string());
    storage::app_file_path(
        &profile,
        StorageKind::Data,
        &["auth", "sessions", &scope, "device_id"],
    )
}

/// Stable per-install opaque id (ULID), minted once per actor scope.
pub fn get_or_create_device_id(actor_id: &str) -> Result<String, StorageError> {
    let path = device_id_path(actor_id)?;
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
pub fn rotate_device_id(actor_id: &str) -> Result<String, StorageError> {
    let path = device_id_path(actor_id)?;
    let id = Ulid::new().to_string();
    storage::write_string_atomic(&path, &id)?;
    Ok(id)
}
