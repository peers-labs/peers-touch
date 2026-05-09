use crate::infrastructure::storage::{self, StorageError, StorageKind};
use ulid::Ulid;

/// Returns `auth/sessions/<sanitized_actor>/device_id` under app data.
fn device_id_path(actor_id: &str) -> Result<std::path::PathBuf, StorageError> {
    let scope = storage::resolve_user_scope(Some(actor_id));
    storage::app_file_path(
        "desktop",
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
