use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

use crate::infrastructure::station_client::session_revoked_details_from_text;
use crate::state::AppState;

pub const SESSION_KICKED_EVENT: &str = "auth:session-kicked";

fn is_current_session_token(state: &AppState, rejected_token: &str) -> bool {
    state
        .sessions
        .snapshot_all()
        .iter()
        .any(|session| session.jwt == rejected_token)
}

pub fn emit_if_session_revoked(
    app: &AppHandle,
    rejected_token: &str,
    status: u16,
    body: &str,
) -> bool {
    if status != 401 {
        return false;
    }

    let Some(details) = session_revoked_details_from_text(body) else {
        return false;
    };
    let state = app.state::<Arc<AppState>>();
    if !is_current_session_token(state.inner(), rejected_token) {
        tracing::info!("session_revocation: ignoring stale session revocation");
        return true;
    }
    let reason = details
        .get("reason")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");

    let payload = json!({
        "reason": reason,
        "details": details,
    });
    if let Err(error) = app.emit(SESSION_KICKED_EVENT, &payload) {
        tracing::warn!(error = %error, "session_revocation: emit failed");
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::i18n::I18nService;
    use crate::infrastructure::storage::{StorageKind, StorageLayout};
    use std::collections::HashMap;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state(name: &str, token: Option<&str>) -> AppState {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("session-revocation-{name}-{stamp}"));
        let mut dirs = HashMap::new();
        for kind in [
            StorageKind::Config,
            StorageKind::Data,
            StorageKind::Cache,
            StorageKind::Logs,
            StorageKind::Runtime,
            StorageKind::Temp,
        ] {
            let path = root.join(kind.as_str());
            std::fs::create_dir_all(&path).expect("test storage dir should be created");
            dirs.insert(kind, path);
        }
        let config_dir = dirs
            .get(&StorageKind::Config)
            .expect("test config directory should exist")
            .clone();
        let state = AppState::new(
            StorageLayout {
                app_name: format!("session-revocation-{name}"),
                root_source: "test".to_string(),
                root,
                dirs,
            },
            I18nService::new(&config_dir),
        );
        if let Some(token) = token {
            state
                .sessions
                .bind(crate::domain::identity::ActiveSession::new(
                    "main",
                    format!("account-{name}"),
                    crate::domain::identity::ActorRef::new_person(format!("ptid:test:{name}")),
                    token,
                ));
        }
        state
    }

    #[test]
    fn current_session_token_matches_the_rejected_stream_token() {
        let state = test_state("current", Some("current-token"));

        assert!(is_current_session_token(&state, "current-token"));
    }

    #[test]
    fn replaced_session_ignores_the_old_stream_token() {
        let state = test_state("replaced", Some("new-token"));

        assert!(!is_current_session_token(&state, "old-token"));
    }
}
