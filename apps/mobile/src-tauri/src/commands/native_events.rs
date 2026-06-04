use serde::Deserialize;
use tauri::{AppHandle, Runtime};

use crate::error::{MobileError, MobileResult};
use crate::platform::native_events;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileNativeEventInput {
    kind: String,
    target: Option<String>,
    session_ulid: Option<String>,
    notification_id: Option<String>,
    reason: Option<String>,
    url: Option<String>,
}

#[tauri::command]
pub fn mobile_native_event_emit<R: Runtime>(
    app: AppHandle<R>,
    input: MobileNativeEventInput,
) -> MobileResult<()> {
    let kind = input.kind.trim();
    let result = match kind {
        "resume" | "app-resume" => native_events::emit_resume(
            &app,
            clean_optional(input.reason).unwrap_or_else(|| "native-command".to_string()),
        ),
        "push" => native_events::emit_push(
            &app,
            clean_optional(input.notification_id),
            clean_optional(input.session_ulid),
            clean_optional(input.target),
        ),
        "deep-link" => {
            let url = clean_required(input.url, "deep-link url must not be empty")?;
            native_events::emit_deep_link(&app, url)
        }
        "notification-tap" => native_events::emit_notification_tap(
            &app,
            clean_optional(input.notification_id),
            clean_optional(input.session_ulid),
            clean_optional(input.target),
        ),
        _ => {
            return Err(MobileError::invalid_input(format!(
                "unsupported native event kind: {kind}",
            )));
        }
    };

    result.map_err(|error| {
        MobileError::invalid_input(format!("failed to emit mobile native event: {error}"))
    })
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

fn clean_required(value: Option<String>, message: &'static str) -> MobileResult<String> {
    clean_optional(value).ok_or_else(|| MobileError::invalid_input(message))
}
