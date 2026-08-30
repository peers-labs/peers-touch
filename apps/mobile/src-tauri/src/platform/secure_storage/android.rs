use crate::error::MobileError;

pub type SecureStorage = tauri_plugin_peers_secure_storage::SecureStorage<tauri::Wry>;

impl From<tauri_plugin_peers_secure_storage::Error> for MobileError {
    fn from(error: tauri_plugin_peers_secure_storage::Error) -> Self {
        MobileError::secure_storage(error.to_string())
    }
}
