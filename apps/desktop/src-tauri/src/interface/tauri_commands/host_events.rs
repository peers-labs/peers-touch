use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Runtime};

use crate::application::host_events;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopHostEventInput {
    kind: String,
    target: Option<String>,
    session_ulid: Option<String>,
    notification_id: Option<String>,
    reason: Option<String>,
}

#[tauri::command]
pub fn desktop_native_event_emit<R: Runtime>(
    app: AppHandle<R>,
    input: DesktopHostEventInput,
) -> AppResult<StubPayload> {
    let kind = input.kind.trim();
    let result = match kind {
        "resume" | "app-resume" => host_events::emit_resume(
            &app,
            clean_optional(input.reason).unwrap_or_else(|| "native-command".to_string()),
        ),
        "tray-open" => host_events::emit_tray_open(
            &app,
            clean_optional(input.reason).unwrap_or_else(|| "native-command".to_string()),
        ),
        "notification-tap" => host_events::emit_notification_tap(
            &app,
            clean_optional(input.notification_id),
            clean_optional(input.session_ulid),
            clean_optional(input.target),
        ),
        _ => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("unsupported desktop native event kind: {kind}"),
                None,
            );
        }
    };

    match result {
        Ok(()) => AppResult::success(StubPayload {
            command: "desktop_native_event_emit".to_string(),
            status: json!({ "emitted": true, "kind": kind }).to_string(),
        }),
        Err(error) => AppResult::fail(
            ErrorCode::InternalError,
            "failed to emit desktop native event",
            Some(json!({ "kind": kind, "error": error.to_string() })),
        ),
    }
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}
