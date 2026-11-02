use crate::domain::storage::key_management::{
    KeyErrorCode, KeyMaterial, KeyProvider, KeyProviderError,
};
use crate::infrastructure::storage;
use keyring::Entry;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// Configure the canonical profile-scoped storage-key directory. Called by
/// the composition root (which resolves the OS data dir) so this provider
/// never depends on layout details itself. When unset, keys persist through
/// the OS keychain, matching non-composition-root callers.
pub fn set_storage_key_file_root(root: PathBuf) -> Result<(), KeyProviderError> {
    PlatformKeyProvider::set_file_root(root)
}

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

    /// Bind the canonical `<profile>/data/secure-store` root once at startup.
    pub fn set_file_root(root: PathBuf) -> Result<(), KeyProviderError> {
        Self::canonical_root()
            .set(root)
            .map_err(|_| KeyProviderError::internal("<config>", "storage key root already set"))
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

    /// Composition root for the canonical profile-scoped file store.
    /// Configured by bootstrap as `<profile-data>/secure-store`; this
    /// provider appends `storage-keys/<sha256(key_ref)>`.
    fn canonical_root() -> &'static OnceLock<PathBuf> {
        static ROOT: OnceLock<PathBuf> = OnceLock::new();
        &ROOT
    }

    /// Sandboxed file store used when `PEERS_STORAGE_ROOT` is set.
    fn sandbox_file_store_path(key_ref: &str) -> Option<PathBuf> {
        let root = std::env::var("PEERS_STORAGE_ROOT").ok()?;
        let root = root.trim();
        if root.is_empty() {
            return None;
        }
        Some(Self::file_path_under_root(PathBuf::from(root), key_ref))
    }

    /// Canonical, upgrade-portable per-profile file location. Sandbox roots
    /// win so acceptance runs stay isolated; otherwise the bootstrap-provided
    /// profile data directory is used.
    fn canonical_file_store_path(key_ref: &str) -> Option<PathBuf> {
        if let Some(path) = Self::sandbox_file_store_path(key_ref) {
            return Some(path);
        }
        if let Some(root) = Self::canonical_root().get() {
            return Some(root.join("storage-keys").join(Self::key_file_name(key_ref)));
        }
        // Test builds must never reach the OS keychain: its ACL binds to the
        // ad-hoc signed, hash-suffixed `cargo test` binary which changes on
        // every rebuild, producing a fresh GUI authorization prompt per run.
        Self::test_fallback_file_store_path(key_ref)
    }

    /// Process-local file root used by `cargo test` when neither a sandbox nor
    /// a composition root was configured. Per-PID so parallel test processes
    /// never share state; key refs still get their own 0600 key files.
    #[cfg(test)]
    fn test_fallback_file_store_path(key_ref: &str) -> Option<PathBuf> {
        static TEST_ROOT: OnceLock<PathBuf> = OnceLock::new();
        let root = TEST_ROOT.get_or_init(|| {
            let dir = std::env::temp_dir().join(format!(
                "peers-touch-test-secure-store-{}",
                std::process::id()
            ));
            let _ = fs::create_dir_all(&dir);
            dir
        });
        Some(
            root.join("storage-keys")
                .join(Self::key_file_name(key_ref)),
        )
    }

    #[cfg(not(test))]
    fn test_fallback_file_store_path(_key_ref: &str) -> Option<PathBuf> {
        None
    }

    fn file_path_under_root(root: PathBuf, key_ref: &str) -> PathBuf {
        root.join("peers-touch")
            .join("desktop")
            .join("data")
            .join("secure-store")
            .join("storage-keys")
            .join(Self::key_file_name(key_ref))
    }

    /// Pre-profile debug builds persisted keys in a hardcoded default-profile
    /// location that ignored `PT_PROFILE`. Existing installations' working
    /// keys still live there, so it remains a read-only migration source.
    fn legacy_debug_file_store_path(key_ref: &str) -> Option<PathBuf> {
        storage::app_file_path(
            "desktop",
            storage::StorageKind::Data,
            &[
                "secure-store",
                "storage-keys",
                &Self::key_file_name(key_ref),
            ],
        )
        .ok()
    }

    fn key_file_name(key_ref: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(key_ref.as_bytes());
        let digest = hasher.finalize();
        digest.iter().map(|b| format!("{b:02x}")).collect()
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

    /// Read a key file, returning Ok(None) when it does not exist.
    fn read_key_file(
        key_ref: &str,
        path: &Path,
    ) -> Result<Option<KeyMaterial>, KeyProviderError> {
        match fs::read_to_string(path) {
            Ok(payload) => Ok(Self::decode_material(payload.trim())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(KeyProviderError::io_failure(
                key_ref,
                format!("file keystore read failed: {e}"),
            )),
        }
    }

    fn read_from_os_store(key_ref: &str) -> Result<Option<KeyMaterial>, KeyProviderError> {
        // 1. Canonical profile-scoped file store.
        if let Some(path) = Self::canonical_file_store_path(key_ref) {
            if let Some(item) = Self::read_key_file(key_ref, &path)? {
                return Ok(Some(item));
            }
            // 2. Legacy carrier A: the pre-profile debug file store that
            //    ignored PT_PROFILE. Migrate on first canonical miss.
            if let Some(legacy_path) = Self::legacy_debug_file_store_path(key_ref) {
                if legacy_path != path {
                    if let Some(item) = Self::read_key_file(key_ref, &legacy_path)? {
                        Self::write_key_file(key_ref, &path, &item)?;
                        return Ok(Some(item));
                    }
                }
            }
            // 3. Legacy carrier B: the OS keychain (release builds before the
            //    file store became canonical). Migrate on first miss. Test
            //    builds must never trigger the keychain ACL GUI prompt.
            #[cfg(not(test))]
            if let Some(item) = Self::read_from_keychain(key_ref)? {
                Self::write_key_file(key_ref, &path, &item)?;
                return Ok(Some(item));
            }
            return Ok(None);
        }
        // No file root configured (non-composition-root callers): keychain.
        #[cfg(not(test))]
        {
            Self::read_from_keychain(key_ref)
        }
        #[cfg(test)]
        {
            Ok(None)
        }
    }

    fn write_to_os_store(key_ref: &str, item: &KeyMaterial) -> Result<(), KeyProviderError> {
        match Self::canonical_file_store_path(key_ref) {
            Some(path) => Self::write_key_file(key_ref, &path, item),
            None => Self::write_to_keychain(key_ref, item),
        }
    }

    fn read_from_keychain(key_ref: &str) -> Result<Option<KeyMaterial>, KeyProviderError> {
        // Defense in depth: test binaries are hash-named and ad-hoc signed,
        // so any keychain call pops a GUI password prompt. Tests must use the
        // file stores above; reaching here means a test escaped isolation.
        #[cfg(test)]
        {
            let _ = key_ref;
            panic!("tests must not read from the OS keychain (key_ref={key_ref})");
        }
        #[cfg(not(test))]
        {
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
    }

    fn write_to_keychain(key_ref: &str, item: &KeyMaterial) -> Result<(), KeyProviderError> {
        #[cfg(test)]
        {
            let _ = (key_ref, item);
            panic!("tests must not write to the OS keychain (key_ref={key_ref})");
        }
        #[cfg(not(test))]
        {
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

    fn write_key_file(
        key_ref: &str,
        path: &PathBuf,
        item: &KeyMaterial,
    ) -> Result<(), KeyProviderError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                KeyProviderError::io_failure(key_ref, format!("file keystore mkdir failed: {e}"))
            })?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(parent, fs::Permissions::from_mode(0o700)).map_err(|e| {
                    KeyProviderError::io_failure(
                        key_ref,
                        format!("file keystore chmod dir failed: {e}"),
                    )
                })?;
            }
        }
        fs::write(path, Self::encode_material(item)).map_err(|e| {
            KeyProviderError::io_failure(key_ref, format!("file keystore write failed: {e}"))
        })?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|e| {
                KeyProviderError::io_failure(
                    key_ref,
                    format!("file keystore chmod file failed: {e}"),
                )
            })?;
        }
        Ok(())
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
    use std::path::{Path, PathBuf};

    use super::*;
    use crate::infrastructure::storage::test_storage_env_lock;

    #[test]
    fn production_targets_use_restart_persistent_key_storage() {
        let persistence = keyring::default::default_credential_builder().persistence();
        assert!(
            matches!(persistence, CredentialPersistence::UntilDelete),
            "SQLCipher keys must survive Desktop process restarts",
        );
    }

    /// Unique scratch dir under the system temp dir; no external crate needed.
    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "peers-touch-keyprov-{}-{}-{label}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos(),
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn sandbox_secure_key_path(root: &Path, key_ref: &str) -> PathBuf {
        let mut hasher = Sha256::new();
        hasher.update(key_ref.as_bytes());
        let file_name: String = hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        root.join("peers-touch")
            .join("desktop")
            .join("data")
            .join("secure-store")
            .join("storage-keys")
            .join(file_name)
    }

    #[test]
    fn canonical_file_store_persists_and_round_trips_without_the_keychain() {
        let _env = test_storage_env_lock();
        let sandbox = temp_dir("roundtrip");
        unsafe {
            std::env::set_var("PEERS_STORAGE_ROOT", &sandbox);
        }
        let key_ref = "chat/test-sandbox/main/actor-roundtrip";
        let expected_path = sandbox_secure_key_path(&sandbox, key_ref);

        let provider = PlatformKeyProvider::new();
        let created = provider
            .get_or_create_key(key_ref)
            .expect("key is created in the sandbox file store");
        assert_eq!(created.key_bytes.len(), 32);
        assert!(expected_path.is_file(), "key must be persisted as a 0600 file");

        // A fresh provider with an empty cache restores the exact key.
        let restored = PlatformKeyProvider::new()
            .get_or_create_key(key_ref)
            .expect("restored from file store");
        assert_eq!(restored.key_bytes, created.key_bytes);
        assert_eq!(restored.key_version, 1);

        unsafe {
            std::env::remove_var("PEERS_STORAGE_ROOT");
        }
        let _ = fs::remove_dir_all(&sandbox);
    }

    #[test]
    fn per_ref_files_isolate_distinct_actors() {
        let _env = test_storage_env_lock();
        let sandbox = temp_dir("isolation");
        unsafe {
            std::env::set_var("PEERS_STORAGE_ROOT", &sandbox);
        }
        let provider = PlatformKeyProvider::new();

        let actor_a = provider
            .get_or_create_key("chat/corpstable/main/actor-a")
            .expect("actor a key");
        let actor_b = provider
            .get_or_create_key("chat/corpstable/main/actor-b")
            .expect("actor b key");

        assert_ne!(actor_a.key_bytes, actor_b.key_bytes);
        let path_a = sandbox_secure_key_path(&sandbox, "chat/corpstable/main/actor-a");
        let path_b = sandbox_secure_key_path(&sandbox, "chat/corpstable/main/actor-b");
        assert_ne!(path_a, path_b);
        assert!(path_a.is_file() && path_b.is_file());

        unsafe {
            std::env::remove_var("PEERS_STORAGE_ROOT");
        }
        let _ = fs::remove_dir_all(&sandbox);
    }

    #[test]
    fn unconfigured_test_build_uses_a_file_store_and_never_the_keychain() {
        let _env = test_storage_env_lock();
        // No PEERS_STORAGE_ROOT and no composition root: a misconfigured test
        // used to fall through to the OS keychain and raise a GUI prompt from
        // the hash-suffixed cargo-test binary.
        unsafe {
            std::env::remove_var("PEERS_STORAGE_ROOT");
        }
        let key_ref = "chat/test-no-keychain/main/actor-fallback";
        let created = PlatformKeyProvider::new()
            .get_or_create_key(key_ref)
            .expect("key resolves through the test file fallback");
        assert_eq!(created.key_bytes.len(), 32);

        // A new provider with an empty cache restores the same key.
        let restored = PlatformKeyProvider::new()
            .get_or_create_key(key_ref)
            .expect("restored from file fallback");
        assert_eq!(restored.key_bytes, created.key_bytes);
    }

    #[test]
    fn migrates_legacy_default_profile_key_into_the_canonical_profile_store() {
        let _env = test_storage_env_lock();
        let fixture = temp_dir("legacy-migration");
        let canonical_root = fixture.join("corpstable-app/data/secure-store");
        // The process-wide root binds once; this is the only test configuring it.
        set_storage_key_file_root(canonical_root.clone()).expect("canonical root binds once");
        unsafe {
            std::env::set_var("HOME", &fixture);
            std::env::remove_var("PEERS_STORAGE_ROOT");
        }

        let key_ref = "chat/corpstable/main/actor-legacy";
        let legacy = PlatformKeyProvider::legacy_debug_file_store_path(key_ref)
            .expect("legacy default-profile path resolves");
        let legacy_item = KeyMaterial {
            key_id: key_ref.to_string(),
            key_version: 1,
            key_bytes: vec![0x42u8; 32],
        };
        if let Some(parent) = legacy.parent() {
            std::fs::create_dir_all(parent).expect("legacy dir");
        }
        std::fs::write(
            &legacy,
            PlatformKeyProvider::encode_material(&legacy_item),
        )
        .expect("seed legacy key file");

        let resolved = PlatformKeyProvider::new()
            .get_or_create_key(key_ref)
            .expect("legacy key migrates");
        assert_eq!(resolved.key_bytes, vec![0x42u8; 32]);

        let canonical = canonical_root
            .join("storage-keys")
            .join(PlatformKeyProvider::key_file_name(key_ref));
        assert!(
            canonical.is_file(),
            "migrated key must land in the canonical profile store",
        );

        unsafe {
            std::env::remove_var("HOME");
        }
        let _ = fs::remove_dir_all(&fixture);
    }
}
