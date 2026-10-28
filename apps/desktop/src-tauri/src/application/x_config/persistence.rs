use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use x_config_core::{
    SecureWatermark, SecureWatermarkStore, SnapshotCacheKey, SnapshotCacheStore, XConfigError,
    MAX_ENVELOPE_BYTES,
};

#[cfg(target_os = "macos")]
mod macos_keychain;

const WATERMARK_SERVICE: &str = "peers-touch.desktop.x-config";

pub struct DesktopWatermarkStore {
    channel: String,
    // Debug, test, and sandboxed acceptance runs persist the watermark in a
    // 0600 file. Debug binaries are recompiled constantly and each ad-hoc
    // signature invalidates the macOS Keychain item's access-control list,
    // which otherwise raises a login-password SecurityAgent prompt that owns
    // the frontmost window and blocks native panels. Release builds return
    // `None` and persist through the OS keychain, matching the chat-DB and
    // identity secret stores.
    file_path: Option<PathBuf>,
}

impl DesktopWatermarkStore {
    pub fn new(channel: &str, secure_store_dir: PathBuf) -> Self {
        #[cfg(debug_assertions)]
        let file_path = Some(secure_store_dir.join(format!("{channel}.watermark.json")));
        #[cfg(not(debug_assertions))]
        let file_path = {
            let _ = secure_store_dir;
            None
        };
        Self {
            channel: channel.to_string(),
            file_path,
        }
    }

    fn load_document(&self) -> Result<Option<WatermarkDocument>, XConfigError> {
        if let Some(path) = self.file_path.as_ref() {
            return match fs::read(path) {
                Ok(bytes) => serde_json::from_slice(&bytes)
                    .map(Some)
                    .map_err(|_| storage_error("watermark_decode")),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
                Err(_) => Err(storage_error("watermark_read")),
            };
        }
        match load_keychain_document(&self.channel)? {
            Some(value) => serde_json::from_slice(&value)
                .map(Some)
                .map_err(|_| storage_error("watermark_decode")),
            None => Ok(None),
        }
    }

    fn save_document(&self, document: &WatermarkDocument) -> Result<(), XConfigError> {
        let bytes = serde_json::to_vec(document).map_err(|_| storage_error("watermark_encode"))?;
        if let Some(path) = self.file_path.as_ref() {
            return atomic_write(path, &bytes).map_err(|_| storage_error("watermark_write"));
        }
        save_keychain_document(&self.channel, &bytes)
    }
}

#[cfg(target_os = "macos")]
fn load_keychain_document(channel: &str) -> Result<Option<Vec<u8>>, XConfigError> {
    macos_keychain::load(WATERMARK_SERVICE, &watermark_account(channel))
}

#[cfg(target_os = "macos")]
fn save_keychain_document(channel: &str, bytes: &[u8]) -> Result<(), XConfigError> {
    macos_keychain::save(WATERMARK_SERVICE, &watermark_account(channel), bytes)
}

#[cfg(not(target_os = "macos"))]
fn load_keychain_document(channel: &str) -> Result<Option<Vec<u8>>, XConfigError> {
    let entry = keyring::Entry::new(WATERMARK_SERVICE, &watermark_account(channel))
        .map_err(|_| storage_error("watermark_keyring"))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value.into_bytes())),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(storage_error("watermark_keyring")),
    }
}

#[cfg(not(target_os = "macos"))]
fn save_keychain_document(channel: &str, bytes: &[u8]) -> Result<(), XConfigError> {
    let value = std::str::from_utf8(bytes).map_err(|_| storage_error("watermark_encode"))?;
    keyring::Entry::new(WATERMARK_SERVICE, &watermark_account(channel))
        .map_err(|_| storage_error("watermark_keyring"))?
        .set_password(value)
        .map_err(|_| storage_error("watermark_keyring"))
}

impl SecureWatermarkStore for DesktopWatermarkStore {
    fn load(&self, channel: &str) -> Result<Option<SecureWatermark>, XConfigError> {
        if channel != self.channel {
            return Err(storage_error("watermark_channel"));
        }
        let Some(document) = self.load_document()? else {
            return Ok(None);
        };
        document.into_watermark(channel).map(Some)
    }

    fn save(&mut self, watermark: &SecureWatermark) -> Result<(), XConfigError> {
        if watermark.channel != self.channel {
            return Err(storage_error("watermark_channel"));
        }
        self.save_document(&WatermarkDocument::from_watermark(watermark))
    }
}

pub struct FileSnapshotCache {
    channel: String,
    directory: PathBuf,
}

impl FileSnapshotCache {
    pub fn new(cache_dir: PathBuf, channel: &str) -> Self {
        Self {
            channel: channel.to_string(),
            directory: cache_dir.join(channel),
        }
    }
}

impl SnapshotCacheStore for FileSnapshotCache {
    fn load_candidates(
        &self,
        channel: &str,
        committed: Option<&SnapshotCacheKey>,
    ) -> Result<Vec<Vec<u8>>, XConfigError> {
        if channel != self.channel {
            return Err(storage_error("snapshot_cache_channel"));
        }
        let Some(committed) = committed else {
            return Ok(Vec::new());
        };
        let path = self.path_for(committed);
        match fs::metadata(&path) {
            Ok(metadata) if metadata.len() == 0 || metadata.len() > MAX_ENVELOPE_BYTES as u64 => {
                return Ok(Vec::new());
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err(storage_error("snapshot_cache_read")),
        }
        match fs::read(path) {
            Ok(bytes) => Ok(vec![bytes]),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(_) => Err(storage_error("snapshot_cache_read")),
        }
    }

    fn save(
        &mut self,
        channel: &str,
        key: &SnapshotCacheKey,
        envelope_bytes: &[u8],
    ) -> Result<(), XConfigError> {
        if channel != self.channel || key.sequence == 0 {
            return Err(storage_error("snapshot_cache_channel"));
        }
        let path = self.path_for(key);
        match fs::read(&path) {
            Ok(existing) if existing == envelope_bytes => return Ok(()),
            Ok(_) => return Err(storage_error("snapshot_cache_conflict")),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err(storage_error("snapshot_cache_read")),
        }
        atomic_write(&path, envelope_bytes).map_err(|_| storage_error("snapshot_cache_write"))
    }
}

impl FileSnapshotCache {
    fn path_for(&self, key: &SnapshotCacheKey) -> PathBuf {
        self.directory.join(format!(
            "{:020}-{}.pb",
            key.sequence,
            hex::encode(key.generation_sha256),
        ))
    }
}

#[derive(Serialize, Deserialize)]
struct WatermarkDocument {
    schema_version: u32,
    channel: String,
    signing_key_id: String,
    sequence: u64,
    statement_sha256_hex: String,
}

impl WatermarkDocument {
    fn from_watermark(watermark: &SecureWatermark) -> Self {
        Self {
            schema_version: 1,
            channel: watermark.channel.clone(),
            signing_key_id: watermark.signing_key_id.clone(),
            sequence: watermark.sequence,
            statement_sha256_hex: hex::encode(watermark.statement_sha256),
        }
    }

    fn into_watermark(self, expected_channel: &str) -> Result<SecureWatermark, XConfigError> {
        let digest = hex::decode(self.statement_sha256_hex)
            .map_err(|_| storage_error("watermark_decode"))?;
        let statement_sha256: [u8; 32] = digest
            .try_into()
            .map_err(|_| storage_error("watermark_decode"))?;
        if self.schema_version != 1
            || self.channel != expected_channel
            || self.sequence == 0
            || self.signing_key_id.trim().is_empty()
        {
            return Err(storage_error("watermark_decode"));
        }
        Ok(SecureWatermark {
            channel: self.channel,
            signing_key_id: self.signing_key_id,
            sequence: self.sequence,
            statement_sha256,
        })
    }
}

fn watermark_account(channel: &str) -> String {
    format!("snapshot-watermark:{channel}")
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("storage path has no parent"))?;
    fs::create_dir_all(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
    }
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(temporary, path)
}

fn storage_error(code: &'static str) -> XConfigError {
    XConfigError::new(code)
}
