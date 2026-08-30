// Broadcast PTID-scoped identity changes so every renderer closes its
// identity projection through the frontend lifecycle pipeline.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const IDENTITY_CHANGED_EVENT: &str = "auth:identity-changed";

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
    pub actor_ptid: Option<String>,
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
            actor_ptid: Some("ptid:test:alice".to_string()),
            login_method: Some("oauth".to_string()),
        })
        .expect("serialize");
        assert!(json.contains("\"reason\":\"oauth_bridge\""));
        assert!(json.contains("\"actor_ptid\":\"ptid:test:alice\""));
    }
}
