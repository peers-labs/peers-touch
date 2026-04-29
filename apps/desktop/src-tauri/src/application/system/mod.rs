use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::auth_identity;
use crate::infrastructure::storage::{self, StorageKind};
use crate::contracts::{
    ContextActionDispatchInput, ContextSnapshotGetInput,
    ConfigFieldResetInput, ConfigPostgresTestInput, ConfigSectionInput, ConfigSectionSetInput,
    ExternalUrlInput, LogsTailInput, OAuthCreateBotSessionInput, OAuthSessionInput, OAuthSimulateStartInput,
    OnboardingSetInput, PreferencesSetInput, ShareIdInput, ShareSessionInput, StubPayload,
    WizardExecuteApiInput, WizardStepInput,
};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};

static GLOBAL_CONTEXT_STATE: OnceLock<Mutex<serde_json::Value>> = OnceLock::new();

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

fn context_storage_path() -> Result<PathBuf, String> {
    storage::app_file_path("desktop", StorageKind::Data, &["system", "global_context.json"])
        .map_err(|err| format!("failed to resolve global context path: {err:?}"))
}

fn default_global_context_snapshot() -> serde_json::Value {
    json!({
        "identity": {
            "userId": null,
            "displayName": null,
            "provider": null,
            "email": null,
            "avatarUrl": null,
            "profileUrl": null,
            "registerTime": null,
            "lastLoginAt": null
        },
        "session": {
            "loginStatus": "unknown",
            "authenticated": false,
            "activeAccountId": null,
            "lastAuthAt": null
        },
        "oauth": {
            "connectedAccounts": [],
            "connectedCount": 0
        },
        "runtime": {
            "appState": "booting",
            "online": true,
            "networkMode": "online"
        },
        "network": {
            "online": true,
            "mode": "online",
            "degraded": false,
            "lastChangedAt": 0
        },
        "capability": {
            "oauth": false,
            "chat": true,
            "groupChat": true,
            "timeline": true,
            "settings": true
        },
        "workspace": {
            "id": null,
            "name": null,
            "environment": null
        },
        "task": {
            "items": {}
        },
        "notification": {
            "items": []
        },
        "meta": {
            "version": 1,
            "updatedAt": 0
        }
    })
}

fn load_global_context_state() -> serde_json::Value {
    let path = match context_storage_path() {
        Ok(v) => v,
        Err(_) => return default_global_context_snapshot(),
    };
    if !path.exists() {
        return default_global_context_snapshot();
    }
    let text = match fs::read_to_string(&path) {
        Ok(v) => v,
        Err(_) => return default_global_context_snapshot(),
    };
    if text.trim().is_empty() {
        return default_global_context_snapshot();
    }
    serde_json::from_str::<serde_json::Value>(&text).unwrap_or_else(|_| default_global_context_snapshot())
}

fn persist_global_context_state(state: &serde_json::Value) -> Result<(), String> {
    let path = context_storage_path()?;
    let body = serde_json::to_string_pretty(state)
        .map_err(|err| format!("failed to serialize global context: {err}"))?;
    storage::write_string_atomic(&path, &body)
        .map_err(|err| format!("failed to write global context: {err:?}"))
}

fn global_context_state() -> &'static Mutex<serde_json::Value> {
    GLOBAL_CONTEXT_STATE.get_or_init(|| Mutex::new(load_global_context_state()))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|v| v.as_millis() as i64)
        .unwrap_or(0)
}

pub fn system_health() -> AppResult<StubPayload> {
    success_payload("system_health", json!({ "status": "ok" }))
}

pub fn open_external_url(input: ExternalUrlInput) -> AppResult<StubPayload> {
    let url = input.url.trim();
    if url.is_empty() {
        return invalid_argument("url is required");
    }
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = Command::new("cmd");
        c.arg("/C").arg("start").arg("").arg(url);
        c
    };
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = {
        let mut c = Command::new("xdg-open");
        c.arg(url);
        c
    };

    if let Err(err) = command.spawn() {
        tracing::error!(error = %err, "Failed to spawn command to open external URL");
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to open URL: {}", err),
            None,
        );
    }
    success_payload("open_external_url", json!({ "ok": true }))
}

pub fn onboarding_get() -> AppResult<StubPayload> {
    success_payload("onboarding_get", json!({"completed": false, "step": "welcome"}))
}

pub fn onboarding_set(_input: OnboardingSetInput) -> AppResult<StubPayload> {
    success_payload("onboarding_set", json!({"ok": true}))
}

pub fn wizard_get() -> AppResult<StubPayload> {
    success_payload("wizard_get", json!({
        "steps": [],
        "current_step": null,
        "completed": false
    }))
}

pub fn wizard_state_get() -> AppResult<StubPayload> {
    success_payload("wizard_state_get", json!({
        "current_step": null,
        "completed_steps": [],
        "data": {}
    }))
}

pub fn wizard_step_save(_input: WizardStepInput) -> AppResult<StubPayload> {
    success_payload("wizard_step_save", json!({"ok": true}))
}

pub fn wizard_complete() -> AppResult<StubPayload> {
    success_payload("wizard_complete", json!({"ok": true}))
}

pub fn wizard_api_execute(_input: WizardExecuteApiInput) -> AppResult<StubPayload> {
    success_payload("wizard_api_execute", json!({"ok": true, "result": null}))
}

pub fn onboarding_reset() -> AppResult<StubPayload> {
    // Only clear the *active* account — never wipe other accounts' data.
    let mut identity_state = match auth_identity::read_state() {
        Ok(s) => s,
        Err(err) => {
            tracing::error!(error = %err, "onboarding_reset: failed to read identity state");
            return AppResult::fail(ErrorCode::InternalError, err, None);
        }
    };

    let active_id = match &identity_state.active_account_id {
        Some(id) => id.clone(),
        None => {
            // No active account — nothing to reset.
            return success_payload("onboarding_reset", json!({ "ok": true }));
        }
    };

    // Extract the provider portion from account id ("{provider}:{provider_user_id}")
    let active_provider = active_id.split(':').next().unwrap_or("").to_string();

    // Remove only the active account from identities; keep all others intact.
    identity_state.accounts.retain(|a| a.id != active_id);
    identity_state.active_account_id = None;
    if let Err(err) = auth_identity::write_state(&identity_state) {
        tracing::error!(error = %err, "onboarding_reset: failed to write identity state");
        return AppResult::fail(ErrorCode::InternalError, err, None);
    }

    // Remove only the matching provider entry from OAuth connections.
    if !active_provider.is_empty() {
        let conn_path = storage::app_file_path(
            "desktop",
            StorageKind::Data,
            &["oauth2", "connections.json"],
        );
        if let Ok(path) = conn_path {
            if path.exists() {
                if let Ok(text) = fs::read_to_string(&path) {
                    if let Ok(mut map) =
                        serde_json::from_str::<std::collections::HashMap<String, serde_json::Value>>(&text)
                    {
                        map.remove(&active_provider);
                        if let Ok(json) = serde_json::to_string_pretty(&map) {
                            let _ = storage::write_string_atomic(&path, &json);
                        }
                    }
                }
            }
        }
    }

    success_payload("onboarding_reset", json!({ "ok": true }))
}

pub fn statistics_get() -> AppResult<StubPayload> {
    success_payload(
        "statistics_get",
        json!({
            "agents":0,
            "sessions":0,
            "messages":0
        }),
    )
}

pub fn preferences_get() -> AppResult<StubPayload> {
    success_payload("preferences_get", json!({}))
}

pub fn preferences_set(input: PreferencesSetInput) -> AppResult<StubPayload> {
    let _ = input.prefs;
    success_payload("preferences_set", json!({ "ok": true }))
}

pub fn share_create(input: ShareSessionInput) -> AppResult<StubPayload> {
    if input.session_key.trim().is_empty() {
        return invalid_argument("session_key is required");
    }
    success_payload(
        "share_create",
        json!({
            "share_id":"share-1",
            "session_key":input.session_key,
            "title":"Shared Session",
            "visibility":"public"
        }),
    )
}

pub fn share_delete(input: ShareSessionInput) -> AppResult<StubPayload> {
    if input.session_key.trim().is_empty() {
        return invalid_argument("session_key is required");
    }
    success_payload("share_delete", json!({ "ok": true }))
}

pub fn share_get(input: ShareIdInput) -> AppResult<StubPayload> {
    if input.share_id.trim().is_empty() {
        return invalid_argument("share_id is required");
    }
    success_payload(
        "share_get",
        json!({
            "share_id":input.share_id,
            "title":"Shared Session",
            "messages":[]
        }),
    )
}

pub fn logs_tail(input: LogsTailInput) -> AppResult<StubPayload> {
    let limit = input.limit.unwrap_or(200) as usize;
    let max_bytes = input.max_bytes.unwrap_or(512_000) as usize;

    let log_dir = match storage::app_file_path("desktop", StorageKind::Logs, &[]) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(error = %e, "Failed to resolve logs directory path");
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to resolve logs directory: {}", e),
                None,
            );
        }
    };

    let mut log_files: Vec<_> = fs::read_dir(&log_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.ends_with(".log") || name.ends_with(".jsonl") || name.starts_with("app.log.")
        })
        .collect();
    log_files.sort_by_key(|e| std::cmp::Reverse(e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH)));

    let file_name = log_files.first()
        .map(|f| f.file_name().to_string_lossy().to_string())
        .unwrap_or_else(|| "app.log".to_string());

    let file_path = log_dir.join(&file_name);
    if !file_path.exists() {
        return success_payload("logs_tail", json!({
            "file": file_name, "cursor": input.cursor, "size": 0,
            "lines": [], "truncated": false, "reset": false,
            "limit": limit, "max_bytes": max_bytes
        }));
    }

    let content = fs::read_to_string(&file_path).unwrap_or_default();
    let file_size = content.len();
    let cursor = if input.cursor < 0 { 0 } else { (input.cursor as usize).min(file_size) };

    let reset = input.cursor > 0 && (input.cursor as usize) > file_size;
    let effective = if cursor < file_size { &content[cursor..] } else { "" };
    let truncated = effective.len() > max_bytes;
    let byte_limited = if truncated { &effective[..max_bytes] } else { effective };

    let lines: Vec<&str> = byte_limited.lines().collect();
    let output_lines: Vec<&str> = if lines.len() > limit {
        lines[lines.len() - limit..].to_vec()
    } else {
        lines
    };
    let new_cursor = if truncated { cursor + max_bytes } else { file_size };

    success_payload("logs_tail", json!({
        "file": file_name, "cursor": new_cursor, "size": file_size,
        "lines": output_lines, "truncated": truncated,
        "reset": reset,
        "limit": limit, "max_bytes": max_bytes
    }))
}

pub fn oauth_simulate_lark_start(input: OAuthSimulateStartInput) -> AppResult<StubPayload> {
    success_payload(
        "oauth_simulate_lark_start",
        json!({
            "status":"pending",
            "session_id":"sim-1",
            "qr_url":"https://example.com/qr",
            "create_bot":input.create_bot.unwrap_or(false),
            "app_name":input.app_name.unwrap_or_else(|| "Lark Bot".to_string())
        }),
    )
}

pub fn oauth_simulate_lark_poll(input: OAuthSessionInput) -> AppResult<StubPayload> {
    if input.session_id.trim().is_empty() {
        return invalid_argument("session_id is required");
    }
    success_payload(
        "oauth_simulate_lark_poll",
        json!({
            "status":"done",
            "session_id":input.session_id
        }),
    )
}

pub fn oauth_simulate_lark_create_bot_session(
    input: OAuthCreateBotSessionInput,
) -> AppResult<StubPayload> {
    success_payload(
        "oauth_simulate_lark_create_bot_session",
        json!({
            "status":"ok",
            "bot":{"app_id":"app-1","app_secret":"secret"},
            "channel_id":"channel-1",
            "app_name":input.app_name.unwrap_or_else(|| "Lark Bot".to_string())
        }),
    )
}

pub fn config_section_get(input: ConfigSectionInput) -> AppResult<StubPayload> {
    if input.section.trim().is_empty() {
        return invalid_argument("section is required");
    }
    success_payload("config_section_get", json!({}))
}

pub fn config_section_set(input: ConfigSectionSetInput) -> AppResult<StubPayload> {
    if input.section.trim().is_empty() {
        return invalid_argument("section is required");
    }
    let _ = input.values;
    success_payload("config_section_set", json!({ "ok": true }))
}

pub fn config_field_reset(input: ConfigFieldResetInput) -> AppResult<StubPayload> {
    if input.section.trim().is_empty() || input.field.trim().is_empty() {
        return invalid_argument("section and field are required");
    }
    success_payload("config_field_reset", json!({ "ok": true }))
}

pub fn config_test_postgres(input: ConfigPostgresTestInput) -> AppResult<StubPayload> {
    if input.dsn.trim().is_empty() {
        return invalid_argument("dsn is required");
    }
    success_payload(
        "config_test_postgres",
        json!({ "ok": true, "has_pgvector": true }),
    )
}

pub fn embedding_models_list() -> AppResult<StubPayload> {
    success_payload(
        "embedding_models_list",
        json!({
            "models":[],
            "resolved":{"provider_id":"", "provider_name":"", "model":""},
            "configured":{"provider":"", "model":""}
        }),
    )
}

pub fn visitor_heartbeat() -> AppResult<StubPayload> {
    success_payload(
        "visitor_heartbeat",
        json!({ "online": 1, "ip": "127.0.0.1" }),
    )
}

pub fn visitor_online() -> AppResult<StubPayload> {
    success_payload("visitor_online", json!({ "online": 1 }))
}

pub fn context_snapshot_get(input: Option<ContextSnapshotGetInput>) -> AppResult<StubPayload> {
    let mut snapshot = match global_context_state().lock() {
        Ok(v) => v.clone(),
        Err(e) => {
            tracing::error!(error = %e, "Failed to acquire global context lock");
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to access application context: {}", e),
                None,
            );
        }
    };
    if let Ok(account_state) = auth_identity::read_state() {
        let active = match account_state.active_account_id {
            Some(ref active_id) => account_state.accounts.iter().find(|item| item.id == *active_id),
            None => account_state.accounts.first(),
        };
        if let Some(account) = active {
            snapshot["identity"]["userId"] = json!(account.id);
            snapshot["identity"]["displayName"] = json!(account.name);
            snapshot["identity"]["provider"] = json!(account.provider);
            snapshot["identity"]["email"] = json!(account.email);
            snapshot["identity"]["avatarUrl"] = json!(account.avatar_url);
            snapshot["identity"]["profileUrl"] = json!(account.profile_url);
            snapshot["identity"]["registerTime"] = json!(
                if account.created_at.is_empty() {
                    account.last_login_at.clone()
                } else {
                    account.created_at.clone()
                }
            );
            snapshot["identity"]["lastLoginAt"] = json!(account.last_login_at);
            snapshot["session"]["loginStatus"] = json!("authenticated");
            snapshot["session"]["authenticated"] = json!(true);
            snapshot["session"]["activeAccountId"] = json!(account.id);
            snapshot["session"]["lastAuthAt"] = json!(account.last_login_at);
        } else {
            snapshot["session"]["loginStatus"] = json!("unauthenticated");
            snapshot["session"]["authenticated"] = json!(false);
            snapshot["session"]["activeAccountId"] = serde_json::Value::Null;
            snapshot["session"]["lastAuthAt"] = serde_json::Value::Null;
        }
    }
    if let Some(req) = input {
        if let Some(slices) = req.slices {
            let mut scoped = serde_json::Map::new();
            for key in slices {
                if let Some(v) = snapshot.get(&key) {
                    scoped.insert(key, v.clone());
                }
            }
            return success_payload("context_snapshot_get", serde_json::Value::Object(scoped));
        }
    }
    success_payload("context_snapshot_get", snapshot)
}

pub fn context_action_dispatch(input: ContextActionDispatchInput) -> AppResult<StubPayload> {
    if input.action.trim().is_empty() {
        return invalid_argument("action is required");
    }
    let mut state = match global_context_state().lock() {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "Failed to acquire global context lock");
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to access application context: {}", e),
                None,
            );
        }
    };
    let payload = input.payload.unwrap_or_else(|| json!({}));
    if input.action == "set_runtime_state" {
        if let Some(app_state) = payload.get("appState").and_then(|v: &serde_json::Value| v.as_str()) {
            state["runtime"]["appState"] = json!(app_state);
        }
    } else if input.action == "set_network_mode" {
        if let Some(online) = payload.get("online").and_then(|v: &serde_json::Value| v.as_bool()) {
            state["runtime"]["online"] = json!(online);
            state["runtime"]["networkMode"] = json!(if online { "online" } else { "offline" });
            state["network"]["online"] = json!(online);
            state["network"]["mode"] = json!(if online { "online" } else { "offline" });
            state["network"]["degraded"] = json!(!online);
            state["network"]["lastChangedAt"] = json!(now_ms());
        }
    } else if input.action == "merge_snapshot" {
        if let Some(obj) = payload.as_object() {
            for (k, v) in obj {
                let k: &String = k;
                let v: &serde_json::Value = v;
                state[k] = v.clone();
            }
        }
    } else {
        return AppResult::fail(ErrorCode::InvalidArgument, "Unsupported system action", None);
    }
    state["meta"]["updatedAt"] = json!(now_ms());
    if let Err(err) = persist_global_context_state(&state) {
        tracing::error!(error = %err, "Failed to persist global application context");
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist application context: {}", err),
            None,
        );
    }
    success_payload(
        "context_action_dispatch",
        json!({
            "ok": true,
            "action": input.action,
            "snapshot": state.clone()
        }),
    )
}

pub fn context_capabilities() -> AppResult<StubPayload> {
    let state = match global_context_state().lock() {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "Failed to acquire global context lock");
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to access application context: {}", e),
                None,
            );
        }
    };
    success_payload(
        "context_capabilities",
        json!({
            "capability": state["capability"].clone(),
            "updatedAt": state["meta"]["updatedAt"].clone()
        }),
    )
}

pub fn context_health() -> AppResult<StubPayload> {
    let state = match global_context_state().lock() {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "Failed to acquire global context lock");
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to access application context: {}", e),
                None,
            );
        }
    };
    let app_state = state["runtime"]["appState"].as_str().unwrap_or("unknown");
    let network_online = state["network"]["online"].as_bool().unwrap_or(true);
    let degraded = state["network"]["degraded"].as_bool().unwrap_or(false) || app_state == "degraded";
    let status = if degraded {
        "degraded"
    } else if app_state == "booting" {
        "booting"
    } else {
        "ready"
    };
    let mut issues = Vec::<String>::new();
    if !network_online {
        issues.push("network_offline".to_string());
    }
    if app_state == "shutdown" {
        issues.push("runtime_shutdown".to_string());
    }
    success_payload(
        "context_health",
        json!({
            "status": status,
            "runtimeState": app_state,
            "networkOnline": network_online,
            "degraded": degraded,
            "issues": issues,
            "updatedAt": state["meta"]["updatedAt"].clone()
        }),
    )
}
