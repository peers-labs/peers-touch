// PR-1 stop-bleeding: broadcast identity changes so every window in the
// process (and every dev-server tab driven by the same backend) refreshes
// its in-memory caches. The frontend listens for `auth.identity_changed`
// and triggers a reload pipeline.
//
// This module is intentionally tiny — the long-term plan (M3/PR-3) is a
// per-window session registry that obsoletes broadcast-everywhere reloads.
// For now we accept the heavy hammer because it is the only correct fix
// while every command still reads from one shared AppState.session.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const IDENTITY_CHANGED_EVENT: &str = "auth.identity_changed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IdentityChangeReason {
    Login,
    Logout,
    Switch,
    Unlock,
    OauthBridge,
}

#[derive(Debug, Clone, Serialize)]
pub struct IdentityChangedPayload {
    pub reason: IdentityChangeReason,
    pub actor_id: Option<String>,
    pub login_method: Option<String>,
}

pub fn emit(app: &AppHandle, payload: IdentityChangedPayload) {
    if let Err(error) = app.emit(IDENTITY_CHANGED_EVENT, &payload) {
        tracing::warn!(
            event = IDENTITY_CHANGED_EVENT,
            error = %error,
            reason = ?payload.reason,
            "Failed to emit identity changed event",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_serialises_to_snake_case_reason() {
        let json = serde_json::to_string(&IdentityChangedPayload {
            reason: IdentityChangeReason::OauthBridge,
            actor_id: Some("123".to_string()),
            login_method: Some("oauth".to_string()),
        })
        .expect("serialize");
        assert!(json.contains("\"reason\":\"oauth_bridge\""));
        assert!(json.contains("\"actor_id\":\"123\""));
    }
}
