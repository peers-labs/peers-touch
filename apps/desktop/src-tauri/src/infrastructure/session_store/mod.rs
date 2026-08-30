//! PTID-keyed session blobs under `auth/sessions/{ptid}.json`.
//!
//! TODO: Move raw token storage to the OS keyring (or keyring + PIN) and use
//! this module only for non-secret metadata, aligning with
//! `infrastructure::auth_identity` encrypted session handling.

use crate::infrastructure::storage::{self, StorageError, StorageKind};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Origin of a persisted session (password login vs OAuth bridge to Station).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionSource {
    Password,
    OauthBridge,
}

/// A persisted session record written to `auth/sessions/{account_id}.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersistedSession {
    pub actor_ptid: String,
    pub token: String,
    pub saved_at: u64,
    pub source: SessionSource,
}

/// Errors from reading/writing the per-actor session store.
#[derive(Debug)]
pub enum SessionStoreError {
    Storage(StorageError),
    Serde(String),
    Io(String),
}

impl std::fmt::Display for SessionStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SessionStoreError::Storage(e) => write!(f, "{e}"),
            SessionStoreError::Serde(msg) => write!(f, "serde: {msg}"),
            SessionStoreError::Io(msg) => write!(f, "io: {msg}"),
        }
    }
}

impl std::error::Error for SessionStoreError {}

impl From<StorageError> for SessionStoreError {
    fn from(value: StorageError) -> Self {
        SessionStoreError::Storage(value)
    }
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn sessions_dir() -> Result<PathBuf, SessionStoreError> {
    storage::app_file_path("desktop", StorageKind::Data, &["auth", "sessions"])
        .map_err(SessionStoreError::from)
}

fn session_file_path(actor_ptid: &str) -> Result<PathBuf, SessionStoreError> {
    let file_name = format!("{}.json", storage::resolve_user_scope(actor_ptid));
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["auth", "sessions", &file_name],
    )
    .map_err(SessionStoreError::from)
}

pub fn save(actor_ptid: &str, token: &str, source: SessionSource) -> Result<(), SessionStoreError> {
    if !actor_ptid.trim().starts_with("ptid:") {
        return Err(SessionStoreError::Serde(
            "canonical actor_ptid is required".to_string(),
        ));
    }
    let path = session_file_path(actor_ptid)?;
    let payload = PersistedSession {
        actor_ptid: actor_ptid.to_string(),
        token: token.to_string(),
        saved_at: now_unix_secs(),
        source,
    };
    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| SessionStoreError::Serde(e.to_string()))?;
    storage::write_string_atomic(&path, &json).map_err(SessionStoreError::from)
}

pub fn load(actor_ptid: &str) -> Option<PersistedSession> {
    if !actor_ptid.trim().starts_with("ptid:") {
        return None;
    }
    let path = session_file_path(actor_ptid).ok()?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn delete(actor_ptid: &str) -> Result<(), SessionStoreError> {
    if !actor_ptid.trim().starts_with("ptid:") {
        return Err(SessionStoreError::Serde(
            "canonical actor_ptid is required".to_string(),
        ));
    }
    let path = session_file_path(actor_ptid)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| SessionStoreError::Io(e.to_string()))?;
    }
    Ok(())
}

/// Returns distinct `actor_ptid` values from all well-formed session blobs.
pub fn list_actor_ptids() -> Vec<String> {
    let dir = match sessions_dir() {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    let Ok(read_dir) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for ent in read_dir.flatten() {
        let path = ent.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        if let Ok(s) = serde_json::from_str::<PersistedSession>(&raw) {
            if !s.actor_ptid.is_empty() {
                out.push(s.actor_ptid);
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static TEST_ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_temp_storage_root(f: impl FnOnce()) {
        let _g = TEST_ENV_LOCK.lock().expect("lock");
        let base = std::env::temp_dir().join(format!(
            "peers-session-store-test-{}-{}",
            std::process::id(),
            now_unix_secs()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("mkdir");
        let previous_storage_root = std::env::var_os("PEERS_STORAGE_ROOT");
        std::env::set_var("PEERS_STORAGE_ROOT", base.to_str().unwrap());
        f();
        match previous_storage_root {
            Some(value) => std::env::set_var("PEERS_STORAGE_ROOT", value),
            None => std::env::remove_var("PEERS_STORAGE_ROOT"),
        }
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn save_load_delete_round_trip() {
        with_temp_storage_root(|| {
            let ptid = "ptid:test:actor-save-load-1";
            save(ptid, "tok-abc", SessionSource::Password).expect("save");
            let s = load(ptid).expect("load");
            assert_eq!(s.actor_ptid, ptid);
            assert_eq!(s.token, "tok-abc");
            assert_eq!(s.source, SessionSource::Password);

            delete(ptid).expect("delete");
            assert!(load(ptid).is_none());
        });
    }

    #[test]
    fn list_actor_ptids_aggregates_files() {
        with_temp_storage_root(|| {
            save("ptid:test:a-1", "t1", SessionSource::Password).unwrap();
            save("ptid:test:b-2", "t2", SessionSource::OauthBridge).unwrap();
            let mut ids = list_actor_ptids();
            ids.sort();
            assert_eq!(
                ids,
                vec!["ptid:test:a-1".to_string(), "ptid:test:b-2".to_string()]
            );
        });
    }
}
