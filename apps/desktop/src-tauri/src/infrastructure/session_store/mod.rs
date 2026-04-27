//! On-disk per-actor session blobs under `auth/sessions/`.
//!
//! This replaces the legacy single-file `auth/session.json` and
//! `auth/station_session.json` so concurrent processes do not clobber each
//! other's tokens.
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

/// A persisted session record written to `auth/sessions/{actor_id}.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersistedSession {
    pub actor_id: String,
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

/// Returns the on-disk path for a given `actor_id` (filename is sanitized).
fn session_file_path(actor_id: &str) -> Result<PathBuf, SessionStoreError> {
    let file_name = format!("{}.json", storage::resolve_user_scope(Some(actor_id)));
    storage::app_file_path("desktop", StorageKind::Data, &["auth", "sessions", &file_name])
        .map_err(SessionStoreError::from)
}

/// Persists a token for `actor_id`, replacing any previous blob for that actor.
pub fn save(actor_id: &str, token: &str, source: SessionSource) -> Result<(), SessionStoreError> {
    if actor_id.trim().is_empty() {
        return Err(SessionStoreError::Serde("actor_id is empty".to_string()));
    }
    let path = session_file_path(actor_id)?;
    let payload = PersistedSession {
        actor_id: actor_id.to_string(),
        token: token.to_string(),
        saved_at: now_unix_secs(),
        source,
    };
    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| SessionStoreError::Serde(e.to_string()))?;
    storage::write_string_atomic(&path, &json).map_err(SessionStoreError::from)
}

/// Loads the persisted session for `actor_id`, if present and valid JSON.
pub fn load(actor_id: &str) -> Option<PersistedSession> {
    if actor_id.trim().is_empty() {
        return None;
    }
    let path = session_file_path(actor_id).ok()?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Deletes the persisted session file for `actor_id`, if it exists.
pub fn delete(actor_id: &str) -> Result<(), SessionStoreError> {
    if actor_id.trim().is_empty() {
        return Ok(());
    }
    let path = session_file_path(actor_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| SessionStoreError::Io(e.to_string()))?;
    }
    Ok(())
}

/// Returns distinct `actor_id` values from all well-formed session blobs.
pub fn list_actor_ids() -> Vec<String> {
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
            if !s.actor_id.is_empty() {
                out.push(s.actor_id);
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

#[derive(Deserialize)]
struct LegacyPasswordSession {
    actor_id: String,
    token: String,
}

/// Migrates legacy `auth/session.json` and `auth/station_session.json` into
/// per-actor files. Returns the number of successfully migrated records.
/// Malformed legacy files are skipped with a warning (files are not deleted).
pub fn migrate_legacy() -> Result<usize, SessionStoreError> {
    let mut migrated: usize = 0;

    let legacy_password = storage::app_file_path("desktop", StorageKind::Data, &["auth", "session.json"])?;
    if legacy_password.exists() {
        match fs::read_to_string(&legacy_password) {
            Ok(raw) => match serde_json::from_str::<LegacyPasswordSession>(&raw) {
                Ok(v) => {
                    if !v.actor_id.is_empty() && !v.token.is_empty() {
                        save(&v.actor_id, &v.token, SessionSource::Password)?;
                        migrated += 1;
                        if let Err(e) = fs::remove_file(&legacy_password) {
                            tracing::warn!(path = %legacy_password.display(), error = %e, "session_store: failed to remove legacy session.json");
                        }
                    } else {
                        tracing::warn!(
                            path = %legacy_password.display(),
                            "session_store: legacy session.json has empty fields; leaving file in place"
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        path = %legacy_password.display(),
                        "session_store: could not parse legacy session.json; skipping"
                    );
                }
            },
            Err(e) => {
                tracing::warn!(error = %e, path = %legacy_password.display(), "session_store: could not read legacy session.json; skipping");
            }
        }
    }

    let legacy_station = storage::app_file_path("desktop", StorageKind::Data, &["auth", "station_session.json"])?;
    if legacy_station.exists() {
        match fs::read_to_string(&legacy_station) {
            Ok(raw) => {
                // Legacy shape: { "actor_id", "token" } (no saved_at / source)
                let parsed: Result<serde_json::Value, _> = serde_json::from_str(&raw);
                match parsed
                    .ok()
                    .and_then(|v| {
                        let actor_id = v.get("actor_id")?.as_str()?.to_string();
                        let token = v.get("token")?.as_str()?.to_string();
                        if actor_id.is_empty() || token.is_empty() {
                            return None;
                        }
                        Some((actor_id, token))
                    }) {
                    Some((actor_id, token)) => {
                        save(&actor_id, &token, SessionSource::OauthBridge)?;
                        migrated += 1;
                        if let Err(e) = fs::remove_file(&legacy_station) {
                            tracing::warn!(path = %legacy_station.display(), error = %e, "session_store: failed to remove legacy station_session.json");
                        }
                    }
                    None => {
                        tracing::warn!(
                            path = %legacy_station.display(),
                            "session_store: could not parse legacy station_session.json; skipping"
                        );
                    }
                }
            }
            Err(e) => {
                tracing::warn!(error = %e, path = %legacy_station.display(), "session_store: could not read legacy station_session.json; skipping");
            }
        }
    }

    Ok(migrated)
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
        std::env::set_var("PEERS_STORAGE_ROOT", base.to_str().unwrap());
        f();
        std::env::remove_var("PEERS_STORAGE_ROOT");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn save_load_delete_round_trip() {
        with_temp_storage_root(|| {
            let aid = "actor-save-load-1";
            save(aid, "tok-abc", SessionSource::Password).expect("save");
            let s = load(aid).expect("load");
            assert_eq!(s.actor_id, aid);
            assert_eq!(s.token, "tok-abc");
            assert_eq!(s.source, SessionSource::Password);

            delete(aid).expect("delete");
            assert!(load(aid).is_none());
        });
    }

    #[test]
    fn list_actor_ids_aggregates_files() {
        with_temp_storage_root(|| {
            save("a-1", "t1", SessionSource::Password).unwrap();
            save("b-2", "t2", SessionSource::OauthBridge).unwrap();
            let mut ids = list_actor_ids();
            ids.sort();
            assert_eq!(ids, vec!["a-1".to_string(), "b-2".to_string()]);
        });
    }

    #[test]
    fn migrate_legacy_password_file() {
        with_temp_storage_root(|| {
            let legacy = storage::app_file_path("desktop", StorageKind::Data, &["auth", "session.json"])
                .expect("path");
            fs::create_dir_all(legacy.parent().unwrap()).expect("mkdir auth");
            fs::write(
                &legacy,
                r#"{"actor_id":"legacy-a","token":"legacy-tok"}"#,
            )
            .expect("write legacy");
            let n = migrate_legacy().expect("migrate");
            assert_eq!(n, 1);
            assert!(!legacy.exists());
            let p = load("legacy-a").expect("loaded");
            assert_eq!(p.token, "legacy-tok");
            assert_eq!(p.source, SessionSource::Password);
        });
    }
}
