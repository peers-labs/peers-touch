use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);
static APPLET_SESSIONS: OnceLock<Mutex<HashMap<String, ActiveAppletSession>>> = OnceLock::new();
static APPLET_AUDIT_RECORDS: OnceLock<Mutex<Vec<AppletAuditRecord>>> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AppletAuditRecord {
    pub request_id: String,
    pub command: String,
    pub applet_id: String,
    pub capability: String,
    pub actor_id: String,
    pub outcome: String,
}

#[derive(Debug, Clone)]
pub struct AccessContext {
    pub actor_id: Option<String>,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActiveAppletSession {
    applet_id: String,
    actor_id: Option<String>,
    destroyed: bool,
    #[serde(default)]
    manifest: Option<AppletSessionManifestSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppletSessionManifestSnapshot {
    pub permissions: Vec<String>,
    #[serde(default)]
    pub services: Vec<Value>,
    #[serde(default)]
    pub skills: Vec<Value>,
}

#[derive(Debug, Clone)]
pub struct TrustedAppletSession {
    pub manifest: AppletSessionManifestSnapshot,
}

pub fn build_request_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let counter = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("apl-{millis}-{counter}")
}

pub fn normalize_capability(capability: &str) -> String {
    capability.trim().to_ascii_lowercase()
}

fn sessions() -> &'static Mutex<HashMap<String, ActiveAppletSession>> {
    APPLET_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn session_store_path(data_dir: &Path) -> PathBuf {
    data_dir
        .join("applets")
        .join("runtime")
        .join("sessions.json")
}

fn load_persisted_sessions(data_dir: Option<&Path>) -> Result<(), String> {
    let Some(data_dir) = data_dir else {
        return Ok(());
    };
    let path = session_store_path(data_dir);
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path).map_err(|error| {
        format!(
            "Failed to read applet session store {}: {}",
            path.display(),
            error
        )
    })?;
    if content.trim().is_empty() {
        return Ok(());
    }
    let persisted = serde_json::from_str::<HashMap<String, ActiveAppletSession>>(&content)
        .map_err(|error| {
            format!(
                "Failed to parse applet session store {}: {}",
                path.display(),
                error
            )
        })?;
    let mut guard = sessions()
        .lock()
        .map_err(|_| "applet session registry is unavailable".to_string())?;
    for (session_id, session) in persisted {
        if session.destroyed {
            guard.insert(session_id, session);
        } else {
            guard.entry(session_id).or_insert(session);
        }
    }
    Ok(())
}

fn persist_sessions(data_dir: Option<&Path>) -> Result<(), String> {
    let Some(data_dir) = data_dir else {
        return Ok(());
    };
    let path = session_store_path(data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create applet session store directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }
    let guard = sessions()
        .lock()
        .map_err(|_| "applet session registry is unavailable".to_string())?;
    let content = serde_json::to_string_pretty(&*guard)
        .map_err(|error| format!("Failed to serialize applet session store: {}", error))?;
    fs::write(&path, content).map_err(|error| {
        format!(
            "Failed to write applet session store {}: {}",
            path.display(),
            error
        )
    })
}

fn audit_records() -> &'static Mutex<Vec<AppletAuditRecord>> {
    APPLET_AUDIT_RECORDS.get_or_init(|| Mutex::new(Vec::new()))
}

pub fn ensure_active_session(
    context: &AccessContext,
    applet_id: &str,
    session_id: &str,
    data_dir: Option<&Path>,
    manifest: AppletSessionManifestSnapshot,
) -> Result<TrustedAppletSession, String> {
    let manifest = normalize_session_manifest_snapshot(manifest);
    if applet_id.trim().is_empty() || session_id.trim().is_empty() {
        return Err("applet session requires applet id and session id".to_string());
    }
    load_persisted_sessions(data_dir)?;

    let guard = sessions()
        .lock()
        .map_err(|_| "applet session registry is unavailable".to_string())?;
    match guard.get(session_id) {
        Some(session) => {
            if session.destroyed {
                return Err("applet session has been destroyed".to_string());
            }
            if session.applet_id != applet_id {
                return Err("applet session does not belong to requested applet".to_string());
            }
            if session.actor_id != context.actor_id {
                return Err("applet session actor mismatch".to_string());
            }
            let Some(trusted_manifest) = session.manifest.as_ref() else {
                return Err(
                    "applet session manifest is unavailable; reload the applet session".to_string(),
                );
            };
            let trusted_manifest = normalize_session_manifest_snapshot(trusted_manifest.clone());
            if trusted_manifest != manifest {
                return Err("applet session manifest changed after registration".to_string());
            }
            return Ok(TrustedAppletSession { manifest });
        }
        None => Err("applet session is not registered".to_string()),
    }
}

pub fn register_active_session(
    context: &AccessContext,
    applet_id: &str,
    session_id: &str,
    data_dir: Option<&Path>,
    manifest: AppletSessionManifestSnapshot,
) -> Result<TrustedAppletSession, String> {
    let manifest = normalize_session_manifest_snapshot(manifest);
    if applet_id.trim().is_empty() || session_id.trim().is_empty() {
        return Err("applet session requires applet id and session id".to_string());
    }
    load_persisted_sessions(data_dir)?;

    let mut guard = sessions()
        .lock()
        .map_err(|_| "applet session registry is unavailable".to_string())?;
    match guard.get(session_id) {
        Some(session) => {
            if session.destroyed {
                return Err("applet session has been destroyed".to_string());
            }
            if session.applet_id != applet_id {
                return Err("applet session does not belong to requested applet".to_string());
            }
            if session.actor_id != context.actor_id {
                return Err("applet session actor mismatch".to_string());
            }
            let Some(trusted_manifest) = session.manifest.as_ref() else {
                return Err("applet session manifest is unavailable".to_string());
            };
            let trusted_manifest = normalize_session_manifest_snapshot(trusted_manifest.clone());
            if trusted_manifest != manifest {
                return Err("applet session manifest changed after registration".to_string());
            }
            return Ok(TrustedAppletSession { manifest });
        }
        None => {
            guard.insert(
                session_id.to_string(),
                ActiveAppletSession {
                    applet_id: applet_id.to_string(),
                    actor_id: context.actor_id.clone(),
                    destroyed: false,
                    manifest: Some(manifest.clone()),
                },
            );
            drop(guard);
            persist_sessions(data_dir)?;
            Ok(TrustedAppletSession { manifest })
        }
    }
}

fn normalize_session_manifest_snapshot(
    mut snapshot: AppletSessionManifestSnapshot,
) -> AppletSessionManifestSnapshot {
    for skill in &mut snapshot.skills {
        if let Value::Object(map) = skill {
            if map.get("executor").is_some_and(Value::is_null) {
                map.remove("executor");
            }
        }
    }
    snapshot
}

pub fn destroy_session(
    applet_id: &str,
    session_id: &str,
    data_dir: Option<&Path>,
) -> Result<(), String> {
    load_persisted_sessions(data_dir)?;
    let mut guard = sessions()
        .lock()
        .map_err(|_| "applet session registry is unavailable".to_string())?;
    let session = guard
        .get_mut(session_id)
        .ok_or_else(|| "applet session is not registered".to_string())?;
    if session.applet_id != applet_id {
        return Err("applet session does not belong to requested applet".to_string());
    }
    session.destroyed = true;
    drop(guard);
    persist_sessions(data_dir)?;
    Ok(())
}

#[cfg(test)]
pub(crate) fn remove_session_record_for_test(session_id: &str) {
    if let Ok(mut guard) = sessions().lock() {
        guard.remove(session_id);
    }
}

pub fn capability_method(capability: &str, action: Option<&str>) -> Option<String> {
    let action = action?.trim();
    if action.is_empty() {
        return None;
    }
    Some(format!("{}.{}", normalize_capability(capability), action))
}

pub fn authorize_manifest_permission(permissions: &[String], method: &str) -> bool {
    permissions.iter().any(|permission| permission == method)
}

pub fn emit_audit(
    request_id: &str,
    command: &str,
    applet_id: Option<&str>,
    capability: &str,
    actor_id: Option<&str>,
    outcome: &str,
) {
    let actor = actor_id.unwrap_or("anonymous");
    let target = applet_id.unwrap_or("*");
    if let Ok(mut guard) = audit_records().lock() {
        guard.push(AppletAuditRecord {
            request_id: request_id.to_string(),
            command: command.to_string(),
            applet_id: target.to_string(),
            capability: capability.to_string(),
            actor_id: actor.to_string(),
            outcome: outcome.to_string(),
        });
        if guard.len() > 512 {
            let overflow = guard.len() - 512;
            guard.drain(0..overflow);
        }
    }
    tracing::info!(request_id = %request_id, command = %command, applet_id = %target, capability = %capability, actor = %actor, outcome = %outcome, "applet audit log");
}

pub(crate) fn drain_audit_records() -> Vec<AppletAuditRecord> {
    audit_records()
        .lock()
        .map(|mut guard| guard.drain(..).collect())
        .unwrap_or_default()
}

pub(crate) fn requeue_audit_records(records: Vec<AppletAuditRecord>) {
    if records.is_empty() {
        return;
    }
    if let Ok(mut guard) = audit_records().lock() {
        let mut restored = records;
        restored.append(&mut guard);
        if restored.len() > 512 {
            let overflow = restored.len() - 512;
            restored.drain(0..overflow);
        }
        *guard = restored;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requeue_audit_records_restores_failed_upload_batch_before_new_records() {
        let _ = drain_audit_records();
        emit_audit(
            "audit-original",
            "applets_invoke",
            Some("big-a"),
            "network.request",
            Some("actor-test"),
            "ok",
        );
        let failed_batch = drain_audit_records();

        emit_audit(
            "audit-new",
            "applets_invoke",
            Some("peers.note"),
            "network.request",
            Some("actor-test"),
            "permission_denied",
        );
        requeue_audit_records(failed_batch);

        let restored = drain_audit_records();
        assert_eq!(restored.len(), 2);
        assert_eq!(restored[0].request_id, "audit-original");
        assert_eq!(restored[1].request_id, "audit-new");
    }
}
