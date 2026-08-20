use crate::domain::storage::key_management::{
    KeyErrorCode, KeyMaterial, KeyProvider, KeyProviderError,
};
use keyring::Entry;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlatformBackend {
    MacOSKeychain,
    WindowsDpapi,
    LinuxSecretService,
    GenericFallback,
}

#[derive(Default)]
pub struct PlatformKeyProvider {
    store: Mutex<HashMap<String, KeyMaterial>>,
}

impl PlatformKeyProvider {
    pub fn new() -> Self {
        Self::default()
    }

    /// Process-wide shared instance. Caches resolved keys in-memory so the
    /// hot path for chat-DB opens (every poll cycle, every command) does not
    /// hammer the OS keychain. The first lookup per `key_ref` still hits the
    /// OS keystore; subsequent calls return the cached `KeyMaterial`.
    ///
    /// Background: the previous implementation built a fresh provider with
    /// an empty cache on every `open_connection`, causing 3+ keychain RPCs
    /// per messaging sync × N sessions × every 5s polling cycle. Under
    /// load macOS would intermittently fail these calls, surfacing as
    /// keychain lookup errors during message sync.
    pub fn shared() -> &'static Self {
        static INSTANCE: OnceLock<PlatformKeyProvider> = OnceLock::new();
        INSTANCE.get_or_init(PlatformKeyProvider::default)
    }

    pub fn backend() -> PlatformBackend {
        #[cfg(target_os = "macos")]
        {
            PlatformBackend::MacOSKeychain
        }
        #[cfg(target_os = "windows")]
        {
            PlatformBackend::WindowsDpapi
        }
        #[cfg(target_os = "linux")]
        {
            PlatformBackend::LinuxSecretService
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            PlatformBackend::GenericFallback
        }
    }

    fn backend_name() -> &'static str {
        match Self::backend() {
            PlatformBackend::MacOSKeychain => "macos-keychain",
            PlatformBackend::WindowsDpapi => "windows-dpapi",
            PlatformBackend::LinuxSecretService => "linux-secret-service",
            PlatformBackend::GenericFallback => "generic-fallback",
        }
    }

    fn service_name() -> &'static str {
        "peers-touch.desktop.storage"
    }

    fn username_for_ref(key_ref: &str) -> String {
        format!("chat-db-key:{key_ref}")
    }

    fn encode_material(item: &KeyMaterial) -> String {
        let key_hex: String = item.key_bytes.iter().map(|b| format!("{b:02x}")).collect();
        format!("v{}|{}|{}", item.key_version, item.key_id, key_hex)
    }

    fn decode_material(payload: &str) -> Option<KeyMaterial> {
        let mut parts = payload.splitn(3, '|');
        let version_part = parts.next()?;
        let key_id = parts.next()?.to_string();
        let key_text = parts.next()?;
        let key_version = version_part
            .strip_prefix('v')
            .and_then(|s| s.parse::<i32>().ok())?;
        // Try hex decode first (new format), fall back to raw bytes (legacy format)
        let key_bytes = if key_text.len() == 64 && key_text.chars().all(|c| c.is_ascii_hexdigit()) {
            (0..key_text.len())
                .step_by(2)
                .filter_map(|i| u8::from_str_radix(&key_text[i..i + 2], 16).ok())
                .collect()
        } else {
            key_text.as_bytes().to_vec()
        };
        Some(KeyMaterial {
            key_id,
            key_version,
            key_bytes,
        })
    }

    fn generate_key_material(key_ref: &str, key_version: i32) -> KeyMaterial {
        use rand::RngCore;
        let mut key_bytes = vec![0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut key_bytes);
        KeyMaterial {
            key_id: key_ref.to_string(),
            key_version,
            key_bytes,
        }
    }

    fn scoped_file_store_path(key_ref: &str) -> Option<PathBuf> {
        let root = std::env::var("PEERS_STORAGE_ROOT").ok()?;
        let root = root.trim();
        if root.is_empty() {
            return None;
        }
        let mut hasher = Sha256::new();
        hasher.update(key_ref.as_bytes());
        let digest = hasher.finalize();
        let name: String = digest.iter().map(|b| format!("{b:02x}")).collect();
        Some(
            PathBuf::from(root)
                .join("peers-touch")
                .join("desktop")
                .join("data")
                .join("secure-store")
                .join("storage-keys")
                .join(format!("{name}.key")),
        )
    }

    fn classify_keyring_error(key_ref: &str, err: &keyring::Error) -> KeyProviderError {
        match err {
            keyring::Error::NoEntry => {
                KeyProviderError::not_found(key_ref, "no entry in os keystore")
            }
            keyring::Error::Ambiguous(_) => {
                KeyProviderError::internal(key_ref, "ambiguous keystore entry")
            }
            keyring::Error::NoStorageAccess(_) => {
                KeyProviderError::permission_denied(key_ref, "os keystore access denied")
            }
            _ => {
                let msg = format!("os keystore error: {err}");
                if msg.contains("locked") || msg.contains("Locked") {
                    KeyProviderError::backend_locked(key_ref, "os keystore is locked")
                } else {
                    KeyProviderError::io_failure(key_ref, "os keystore I/O failure")
                }
            }
        }
    }

    fn read_from_os_store(key_ref: &str) -> Result<Option<KeyMaterial>, KeyProviderError> {
        if let Some(path) = Self::scoped_file_store_path(key_ref) {
            match fs::read_to_string(path) {
                Ok(payload) => return Ok(Self::decode_material(payload.trim())),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(e) => {
                    return Err(KeyProviderError::io_failure(
                        key_ref,
                        format!("file keystore read failed: {e}"),
                    ));
                }
            }
        }
        let entry = Entry::new(
            Self::service_name(),
            Self::username_for_ref(key_ref).as_str(),
        )
        .map_err(|e| Self::classify_keyring_error(key_ref, &e))?;
        match entry.get_password() {
            Ok(payload) => Ok(Self::decode_material(payload.as_str())),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(Self::classify_keyring_error(key_ref, &e)),
        }
    }

    fn write_to_os_store(key_ref: &str, item: &KeyMaterial) -> Result<(), KeyProviderError> {
        if let Some(path) = Self::scoped_file_store_path(key_ref) {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    KeyProviderError::io_failure(
                        key_ref,
                        format!("file keystore mkdir failed: {e}"),
                    )
                })?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(parent, fs::Permissions::from_mode(0o700)).map_err(
                        |e| {
                            KeyProviderError::io_failure(
                                key_ref,
                                format!("file keystore chmod failed: {e}"),
                            )
                        },
                    )?;
                }
            }
            fs::write(&path, Self::encode_material(item)).map_err(|e| {
                KeyProviderError::io_failure(key_ref, format!("file keystore write failed: {e}"))
            })?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| {
                    KeyProviderError::io_failure(
                        key_ref,
                        format!("file keystore chmod failed: {e}"),
                    )
                })?;
            }
            return Ok(());
        }
        let entry = Entry::new(
            Self::service_name(),
            Self::username_for_ref(item.key_id.as_str()).as_str(),
        )
        .map_err(|e| Self::classify_keyring_error(key_ref, &e))?;
        entry
            .set_password(Self::encode_material(item).as_str())
            .map_err(|e| Self::classify_keyring_error(key_ref, &e))
    }
}

impl KeyProvider for PlatformKeyProvider {
    fn get_or_create_key(&self, key_ref: &str) -> Result<KeyMaterial, KeyProviderError> {
        // 1. Hot path: in-memory cache.
        {
            let guard = self.store.lock().map_err(|_| {
                KeyProviderError::internal(key_ref, "key provider state lock poisoned")
            })?;
            if let Some(item) = guard.get(key_ref) {
                return Ok(item.clone());
            }
        }
        // 2. Cold path: OS keystore. Populate the cache so subsequent
        //    requests for the same key avoid the keychain RPC entirely.
        match Self::read_from_os_store(key_ref) {
            Ok(Some(item)) => {
                if let Ok(mut guard) = self.store.lock() {
                    guard.insert(key_ref.to_string(), item.clone());
                }
                return Ok(item);
            }
            Ok(None) => {}
            Err(e) if e.code == KeyErrorCode::NotFound => {}
            Err(e) => return Err(e),
        }
        // 3. Generate-and-persist a fresh key.
        let mut guard = self
            .store
            .lock()
            .map_err(|_| KeyProviderError::internal(key_ref, "key provider state lock poisoned"))?;
        if let Some(item) = guard.get(key_ref) {
            return Ok(item.clone());
        }
        let created = Self::generate_key_material(key_ref, 1);
        Self::write_to_os_store(key_ref, &created).map_err(|e| {
            KeyProviderError::io_failure(
                key_ref,
                format!("failed to persist newly generated key to os store: {e}"),
            )
        })?;
        guard.insert(key_ref.to_string(), created.clone());
        Ok(created)
    }

    fn rotate_key(
        &self,
        key_ref: &str,
        next_version: i32,
    ) -> Result<KeyMaterial, KeyProviderError> {
        let prev = self.get_or_create_key(key_ref)?;
        if next_version <= prev.key_version {
            return Err(KeyProviderError::version_conflict(
                key_ref,
                format!(
                    "next_version({next_version}) <= current({})",
                    prev.key_version
                ),
            ));
        }
        let mut guard = self
            .store
            .lock()
            .map_err(|_| KeyProviderError::internal(key_ref, "key provider state lock poisoned"))?;
        let rotated = Self::generate_key_material(key_ref, next_version);
        if let Err(e) = Self::write_to_os_store(key_ref, &rotated) {
            return Err(KeyProviderError::io_failure(
                key_ref,
                format!("failed to persist rotated key to os store: {e}"),
            ));
        }
        guard.insert(key_ref.to_string(), rotated.clone());
        Ok(rotated)
    }
}

#[cfg(test)]
mod tests {
    use keyring::credential::CredentialPersistence;

    #[test]
    fn production_targets_use_restart_persistent_key_storage() {
        let persistence = keyring::default::default_credential_builder().persistence();
        assert!(
            matches!(persistence, CredentialPersistence::UntilDelete),
            "SQLCipher keys must survive Desktop process restarts",
        );
    }
}
