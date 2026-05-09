use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::infrastructure::station_client::session_revoked_details_from_text;

pub const SESSION_KICKED_EVENT: &str = "auth:session-kicked";

pub fn emit_if_session_revoked(app: &AppHandle, status: u16, body: &str) -> bool {
    if status != 401 {
        return false;
    }

    let Some(details) = session_revoked_details_from_text(body) else {
        return false;
    };
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
