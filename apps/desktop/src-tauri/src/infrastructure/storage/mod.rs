pub mod key_provider;

use crate::domain::storage::database::{DatabaseOpenSpec, EncryptionLevel};
use crate::domain::storage::key_management::{KeyMaterial, KeyProvider, KeyProviderError};
use rusqlite::{ffi, params, Connection};
use serde_json::Value;
#[cfg(not(target_os = "windows"))]
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::CStr;
#[cfg(target_os = "windows")]
use std::ffi::OsString;
use std::fmt;
use std::fs;
use std::io::Write;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(not(target_os = "windows"))]
const SQLITE_PATH_LIMIT_BYTES: usize = 512;
#[cfg(not(target_os = "windows"))]
const SQLITE_JOURNAL_SUFFIX_BYTES: usize = 8;
#[cfg(not(target_os = "windows"))]
const COMPACT_DATABASE_SCOPE_PREFIX: &str = "scope-";

/// SQLCipher accepts a textual passphrase the same way `PRAGMA key = '...'` does: passphrase
/// bytes are the UTF-8 encoding of this lossy string (see `sqlite3.c` pragma KEY branch,
/// which calls `sqlite3_key_v2` with `strlen(zRight)`). Building a single-quoted SQL literal
/// from that string breaks when the passphrase contains NULs, unescaped tokens, or bytes that
/// confuse the SQL tokenizer—so we call `sqlite3_key_v2` directly with an explicit length.
fn sqlcipher_passphrase_bytes(key: &KeyMaterial) -> Vec<u8> {
    String::from_utf8_lossy(&key.key_bytes)
        .into_owned()
        .into_bytes()
}

fn sqlcipher_errmsg(conn: &Connection) -> String {
    unsafe {
        let p = ffi::sqlite3_errmsg(conn.handle());
        if p.is_null() {
            return String::new();
        }
        CStr::from_ptr(p).to_string_lossy().into_owned()
    }
}

fn apply_sqlcipher_key(conn: &Connection, key: &KeyMaterial) -> Result<(), StorageError> {
    let pass = sqlcipher_passphrase_bytes(key);
    let n = i32::try_from(pass.len()).map_err(|_| {
        StorageError::WriteFailed("sqlcipher passphrase length exceeds i32::MAX".to_string())
    })?;
    let rc = unsafe {
        ffi::sqlite3_key_v2(
            conn.handle(),
            c"main".as_ptr().cast(),
            pass.as_ptr().cast(),
            n,
        )
    };
    if rc != ffi::SQLITE_OK {
        return Err(StorageError::WriteFailed(format!(
            "sqlite3_key_v2 failed (code {rc}): {}",
            sqlcipher_errmsg(conn)
        )));
    }
    Ok(())
}

fn apply_sqlcipher_rekey(conn: &Connection, new_key: &KeyMaterial) -> Result<(), StorageError> {
    let pass = sqlcipher_passphrase_bytes(new_key);
    let n = i32::try_from(pass.len()).map_err(|_| {
        StorageError::WriteFailed("sqlcipher passphrase length exceeds i32::MAX".to_string())
    })?;
    let rc = unsafe {
        ffi::sqlite3_rekey_v2(
            conn.handle(),
            c"main".as_ptr().cast(),
            pass.as_ptr().cast(),
            n,
        )
    };
    if rc != ffi::SQLITE_OK {
        return Err(StorageError::WriteFailed(format!(
            "sqlite3_rekey_v2 failed (code {rc}): {}",
            sqlcipher_errmsg(conn)
        )));
    }
    Ok(())
}

#[derive(Debug)]
pub enum StorageError {
    ResolveFailed(String),
    ReadFailed(String),
    WriteFailed(String),
    KeyError(KeyProviderError),
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StorageError::ResolveFailed(msg) => write!(f, "resolve_failed: {msg}"),
            StorageError::ReadFailed(msg) => write!(f, "read_failed: {msg}"),
            StorageError::WriteFailed(msg) => write!(f, "write_failed: {msg}"),
            StorageError::KeyError(e) => write!(f, "key_error: {e}"),
        }
    }
}

impl From<KeyProviderError> for StorageError {
    fn from(e: KeyProviderError) -> Self {
        StorageError::KeyError(e)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum StorageKind {
    Config,
    Data,
    Cache,
    Logs,
    Runtime,
    Temp,
}

impl StorageKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            StorageKind::Config => "config",
            StorageKind::Data => "data",
            StorageKind::Cache => "cache",
            StorageKind::Logs => "logs",
            StorageKind::Runtime => "runtime",
            StorageKind::Temp => "temp",
        }
    }
}

#[derive(Debug, Clone)]
pub struct StorageLayout {
    pub app_name: String,
    pub root_source: String,
    pub root: PathBuf,
    pub dirs: HashMap<StorageKind, PathBuf>,
}

pub fn initialize_app_storage(app_name: &str) -> Result<StorageLayout, StorageError> {
    tracing::info!(app_name = %app_name, "Initializing app storage");
    let layout = resolve_layout(app_name)?;
    tracing::info!(app_name = %app_name, root = %layout.root.display(), "Storage root resolved");
    for (kind, path) in &layout.dirs {
        tracing::debug!(kind = %kind.as_str(), path = %path.display(), "Creating storage directory");
        fs::create_dir_all(path).map_err(|error| StorageError::WriteFailed(error.to_string()))?;
    }
    Ok(layout)
}

pub fn resolve_layout(app_name: &str) -> Result<StorageLayout, StorageError> {
    let app = app_name.trim();
    if app.is_empty() {
        return Err(StorageError::ResolveFailed("app name is empty".to_string()));
    }
    let (root, source) = resolve_storage_root()?;
    let app_root = root.join(app);
    let mut dirs = HashMap::new();
    dirs.insert(StorageKind::Config, app_root.join("config"));
    dirs.insert(StorageKind::Data, app_root.join("data"));
    dirs.insert(StorageKind::Cache, app_root.join("cache"));
    dirs.insert(StorageKind::Logs, app_root.join("logs"));
    dirs.insert(StorageKind::Runtime, app_root.join("runtime"));
    dirs.insert(StorageKind::Temp, app_root.join("temp"));
    Ok(StorageLayout {
        app_name: app.to_string(),
        root_source: source,
        root,
        dirs,
    })
}

pub fn app_file_path(
    app_name: &str,
    kind: StorageKind,
    segments: &[&str],
) -> Result<PathBuf, StorageError> {
    let layout = resolve_layout(app_name)?;
    let mut path = layout
        .dirs
        .get(&kind)
        .cloned()
        .ok_or_else(|| StorageError::ResolveFailed("storage kind missing".to_string()))?;
    for segment in segments {
        path = path.join(segment);
    }
    Ok(path)
}

pub fn resolve_user_scope(actor_ptid: &str) -> String {
    sanitize_storage_segment(actor_ptid.trim())
}

pub fn resolve_database_path(
    app_name: &str,
    domain: &str,
    profile: &str,
    actor_ptid: &str,
) -> Result<PathBuf, StorageError> {
    let user_scope = resolve_user_scope(actor_ptid);
    let file_name = format!(
        "{}.{}.db",
        sanitize_storage_segment(domain),
        sanitize_storage_segment(profile)
    );
    let path = app_file_path(
        app_name,
        StorageKind::Data,
        &["db", "users", &user_scope, &file_name],
    )?;
    Ok(sqlite_compatible_path(compact_database_scope(
        path,
        &user_scope,
    )?))
}

#[cfg(not(target_os = "windows"))]
fn compact_database_scope(path: PathBuf, user_scope: &str) -> Result<PathBuf, StorageError> {
    if sqlite_path_has_journal_headroom(&path) {
        return Ok(path);
    }
    let file_name = path
        .file_name()
        .map(|value| value.to_os_string())
        .ok_or_else(|| StorageError::ResolveFailed("database file name is missing".to_string()))?;
    let users_dir = path
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            StorageError::ResolveFailed("database users directory is missing".to_string())
        })?;
    let compact_scope = format!(
        "{COMPACT_DATABASE_SCOPE_PREFIX}{}",
        hex::encode(Sha256::digest(user_scope.as_bytes()))
    );
    let compacted = users_dir.join(compact_scope).join(file_name);
    if !sqlite_path_has_journal_headroom(&compacted) {
        return Err(StorageError::ResolveFailed(
            "database path lacks SQLite journal suffix headroom after scope compaction".to_string(),
        ));
    }
    Ok(compacted)
}

#[cfg(not(target_os = "windows"))]
fn sqlite_path_has_journal_headroom(path: &Path) -> bool {
    path.as_os_str()
        .as_encoded_bytes()
        .len()
        .saturating_add(SQLITE_JOURNAL_SUFFIX_BYTES)
        <= SQLITE_PATH_LIMIT_BYTES
}

#[cfg(target_os = "windows")]
fn compact_database_scope(path: PathBuf, _user_scope: &str) -> Result<PathBuf, StorageError> {
    Ok(path)
}

#[cfg(target_os = "windows")]
fn sqlite_compatible_path(path: PathBuf) -> PathBuf {
    const WINDOWS_DIRECTORY_PATH_LIMIT: usize = 248;
    const BACKSLASH: u16 = b'\\' as u16;

    if !path.is_absolute() {
        return path;
    }
    let encoded = path.as_os_str().encode_wide().collect::<Vec<_>>();
    if encoded.len() < WINDOWS_DIRECTORY_PATH_LIMIT
        || encoded.starts_with(&[BACKSLASH, BACKSLASH, b'?' as u16, BACKSLASH])
    {
        return path;
    }

    let mut extended = if encoded.starts_with(&[BACKSLASH, BACKSLASH]) {
        "\\\\?\\UNC\\".encode_utf16().collect::<Vec<_>>()
    } else {
        "\\\\?\\".encode_utf16().collect::<Vec<_>>()
    };
    extended.extend_from_slice(if encoded.starts_with(&[BACKSLASH, BACKSLASH]) {
        &encoded[2..]
    } else {
        &encoded
    });
    PathBuf::from(OsString::from_wide(&extended))
}

#[cfg(not(target_os = "windows"))]
fn sqlite_compatible_path(path: PathBuf) -> PathBuf {
    path
}

pub fn open_database(
    spec: &DatabaseOpenSpec,
    key_provider: &dyn KeyProvider,
) -> Result<Connection, StorageError> {
    let path = resolve_database_path(
        &spec.app_name,
        &spec.domain,
        &spec.profile,
        spec.user_scope.as_str(),
    )?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| StorageError::WriteFailed(error.to_string()))?;
    }
    let conn =
        Connection::open(path).map_err(|error| StorageError::WriteFailed(error.to_string()))?;
    if spec.encryption_level != EncryptionLevel::L0 {
        let key = key_provider.get_or_create_key(&spec.key_ref)?;
        apply_sqlcipher_key(&conn, &key)?;
        conn.execute_batch("SELECT count(*) FROM sqlite_master;")
            .map_err(|_| {
                StorageError::WriteFailed(
                    "database key verification failed: wrong key or corrupted database".to_string(),
                )
            })?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS _db_key_meta (
                key_ref TEXT PRIMARY KEY,
                key_version INTEGER NOT NULL,
                schema_version INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            )",
            [],
        )
        .map_err(|error| StorageError::WriteFailed(error.to_string()))?;
        conn.execute(
            "INSERT INTO _db_key_meta(key_ref, key_version, schema_version, updated_at)
             VALUES(?1, ?2, ?3, strftime('%s','now'))
             ON CONFLICT(key_ref) DO UPDATE SET key_version=excluded.key_version, schema_version=excluded.schema_version, updated_at=excluded.updated_at",
            params![key.key_id, key.key_version, spec.schema_version],
        )
        .map_err(|error| StorageError::WriteFailed(error.to_string()))?;
    }
    Ok(conn)
}

pub fn get_database_key_version(
    spec: &DatabaseOpenSpec,
    key_provider: &dyn KeyProvider,
) -> Result<Option<i32>, StorageError> {
    let conn = open_database(spec, key_provider)?;
    let mut stmt = conn
        .prepare("SELECT key_version FROM _db_key_meta WHERE key_ref = ?1")
        .map_err(|error| StorageError::ReadFailed(error.to_string()))?;
    let mut rows = stmt
        .query(params![spec.key_ref.as_str()])
        .map_err(|error| StorageError::ReadFailed(error.to_string()))?;
    if let Some(row) = rows
        .next()
        .map_err(|error| StorageError::ReadFailed(error.to_string()))?
    {
        let key_version: i32 = row
            .get(0)
            .map_err(|error| StorageError::ReadFailed(error.to_string()))?;
        Ok(Some(key_version))
    } else {
        Ok(None)
    }
}

pub fn rotate_database_key(
    spec: &DatabaseOpenSpec,
    key_provider: &dyn KeyProvider,
    next_version: i32,
) -> Result<i32, StorageError> {
    if next_version <= 0 {
        return Err(StorageError::WriteFailed(
            "next key version must be positive".to_string(),
        ));
    }
    let prev_key = key_provider.get_or_create_key(&spec.key_ref)?;
    let conn = open_database(spec, key_provider)?;
    let rotated = key_provider.rotate_key(&spec.key_ref, next_version)?;
    let rekey_result = apply_sqlcipher_rekey(&conn, &rotated);
    if let Err(rekey_err) = rekey_result {
        tracing::error!(domain = %spec.domain, profile = %spec.profile, error = %rekey_err, "Database rekey failed, rolling back");
        let _ = key_provider.rotate_key(&spec.key_ref, prev_key.key_version);
        return Err(StorageError::WriteFailed(format!(
            "rekey failed, rolled back key to v{}: {rekey_err}",
            prev_key.key_version
        )));
    }
    conn.execute(
        "INSERT INTO _db_key_meta(key_ref, key_version, schema_version, updated_at)
         VALUES(?1, ?2, ?3, strftime('%s','now'))
         ON CONFLICT(key_ref) DO UPDATE SET key_version=excluded.key_version, schema_version=excluded.schema_version, updated_at=excluded.updated_at",
        params![rotated.key_id, rotated.key_version, spec.schema_version],
    )
    .map_err(|error| StorageError::WriteFailed(error.to_string()))?;
    append_migration_log(
        &spec.app_name,
        format!(
            "rekey_ok domain={} profile={} scope={} version={}",
            spec.domain, spec.profile, spec.user_scope, rotated.key_version
        )
        .as_str(),
    )?;
    Ok(rotated.key_version)
}

pub fn sanitize_storage_segment(input: &str) -> String {
    let trimmed = input.trim();
    let mut out = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "__default__".to_string()
    } else {
        out
    }
}

pub fn write_string_atomic(path: &Path, payload: &str) -> Result<(), StorageError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| StorageError::WriteFailed(error.to_string()))?;
    }
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| StorageError::WriteFailed("invalid target file name".to_string()))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| StorageError::WriteFailed(error.to_string()))?
        .as_nanos();
    let tmp = path.with_file_name(format!(".{file_name}.tmp-{timestamp}"));
    fs::write(&tmp, payload).map_err(|error| StorageError::WriteFailed(error.to_string()))?;
    fs::rename(&tmp, path).map_err(|error| StorageError::WriteFailed(error.to_string()))
}

pub fn load_settings() -> Result<HashMap<String, Value>, StorageError> {
    let file_path = settings_file_path();
    if !file_path.exists() {
        return Ok(HashMap::new());
    }
    let raw = fs::read_to_string(file_path)
        .map_err(|error| StorageError::ReadFailed(error.to_string()))?;
    let parsed = serde_json::from_str::<HashMap<String, Value>>(&raw)
        .map_err(|error| StorageError::ReadFailed(error.to_string()))?;
    Ok(parsed)
}

pub fn save_settings(settings: &HashMap<String, Value>) -> Result<(), StorageError> {
    let file_path = settings_file_path();
    let payload = serde_json::to_string(settings)
        .map_err(|error| StorageError::WriteFailed(error.to_string()))?;
    write_string_atomic(&file_path, &payload)
}

fn settings_file_path() -> PathBuf {
    app_file_path("desktop", StorageKind::Config, &["settings.json"])
        .unwrap_or_else(|_| PathBuf::from("settings.json"))
}

fn append_migration_log(app_name: &str, message: &str) -> Result<(), StorageError> {
    tracing::info!(app_name = %app_name, event = %message, "Appending migration log");
    let log_path = app_file_path(app_name, StorageKind::Logs, &["storage-migration.jsonl"])?;
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent).map_err(|error| StorageError::WriteFailed(error.to_string()))?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|error| StorageError::WriteFailed(error.to_string()))?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| StorageError::WriteFailed(error.to_string()))?
        .as_secs();
    let entry = serde_json::json!({
        "ts": ts,
        "event": message,
    });
    writeln!(file, "{}", entry).map_err(|error| StorageError::WriteFailed(error.to_string()))
}

fn resolve_storage_root() -> Result<(PathBuf, String), StorageError> {
    if let Ok(path) = std::env::var("PEERS_STORAGE_ROOT") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok((
                PathBuf::from(trimmed).join("peers-touch"),
                "env".to_string(),
            ));
        }
    }
    let root = default_platform_root()?;
    Ok((root, "platform_default".to_string()))
}

fn default_platform_root() -> Result<PathBuf, StorageError> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME")
            .map_err(|_| StorageError::ResolveFailed("HOME is not set".to_string()))?;
        return Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("peers-touch"));
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let trimmed = local_app_data.trim();
            if !trimmed.is_empty() {
                return Ok(PathBuf::from(trimmed).join("peers-touch"));
            }
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            let trimmed = user_profile.trim();
            if !trimmed.is_empty() {
                return Ok(PathBuf::from(trimmed)
                    .join("AppData")
                    .join("Local")
                    .join("peers-touch"));
            }
        }
        return Err(StorageError::ResolveFailed(
            "LOCALAPPDATA and USERPROFILE are not set".to_string(),
        ));
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Ok(xdg_data_home) = std::env::var("XDG_DATA_HOME") {
            let trimmed = xdg_data_home.trim();
            if !trimmed.is_empty() {
                return Ok(PathBuf::from(trimmed).join("peers-touch"));
            }
        }
        let home = std::env::var("HOME")
            .map_err(|_| StorageError::ResolveFailed("HOME is not set".to_string()))?;
        Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("peers-touch"))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        compact_database_scope, sqlite_compatible_path, sqlite_path_has_journal_headroom,
        SQLITE_JOURNAL_SUFFIX_BYTES, SQLITE_PATH_LIMIT_BYTES,
    };
    use std::path::PathBuf;

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn long_database_path_uses_a_bounded_stable_scope() {
        let data_root = PathBuf::from("/")
            .join("r".repeat(200))
            .join("s".repeat(95));
        let user_scope = "a".repeat(194);
        let direct = data_root
            .join("db")
            .join("users")
            .join(&user_scope)
            .join("chat.main.db");
        assert!(!sqlite_path_has_journal_headroom(&direct));

        let first = compact_database_scope(direct.clone(), &user_scope).unwrap();
        let second = compact_database_scope(direct, &user_scope).unwrap();
        let other = data_root
            .join("db")
            .join("users")
            .join("b".repeat(194))
            .join("chat.main.db");
        let other = compact_database_scope(other, &"b".repeat(194)).unwrap();
        let compact_scope = first
            .parent()
            .and_then(|path| path.file_name())
            .and_then(|value| value.to_str())
            .unwrap();

        assert_eq!(first, second);
        assert_ne!(first, other);
        assert!(sqlite_path_has_journal_headroom(&first));
        assert_eq!(compact_scope.len(), 70);
        assert!(compact_scope.starts_with("scope-"));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn database_path_reserves_sqlite_journal_suffix_headroom() {
        let users_dir = PathBuf::from("/tmp/db/users");
        let file_name = "secure-content.main.db";
        let fixed_length = users_dir.as_os_str().as_encoded_bytes().len() + 2 + file_name.len();
        let unsafe_main_path_length = 506;
        let user_scope = "a".repeat(unsafe_main_path_length - fixed_length);
        let direct = users_dir.join(&user_scope).join(file_name);

        assert!(unsafe_main_path_length + SQLITE_JOURNAL_SUFFIX_BYTES > SQLITE_PATH_LIMIT_BYTES);
        assert_eq!(
            direct.as_os_str().as_encoded_bytes().len(),
            unsafe_main_path_length
        );
        assert!(direct.as_os_str().as_encoded_bytes().len() < SQLITE_PATH_LIMIT_BYTES);
        assert!(!sqlite_path_has_journal_headroom(&direct));

        let compacted = compact_database_scope(direct.clone(), &user_scope).unwrap();
        assert_ne!(compacted, direct);
        assert!(sqlite_path_has_journal_headroom(&compacted));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn short_database_path_preserves_the_existing_scope() {
        let path = PathBuf::from("/tmp")
            .join("db")
            .join("users")
            .join("actor-1")
            .join("chat.main.db");

        assert_eq!(
            compact_database_scope(path.clone(), "actor-1").unwrap(),
            path
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn sqlite_path_is_unchanged_outside_windows() {
        let path = PathBuf::from("/tmp/peers-touch/chat.main.db");
        assert_eq!(sqlite_compatible_path(path.clone()), path);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn long_sqlite_path_uses_extended_length_syntax() {
        let path = PathBuf::from("C:\\")
            .join("acceptance")
            .join("x".repeat(260))
            .join("chat.main.db");
        let compatible = sqlite_compatible_path(path);

        assert!(compatible.to_string_lossy().starts_with("\\\\?\\C:\\"));
    }
}
