use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

pub const DESKTOP_RESUME_EVENT: &str = "desktop:resume";
pub const DESKTOP_TRAY_OPEN_EVENT: &str = "desktop:tray-open";
pub const DESKTOP_NOTIFICATION_TAP_EVENT: &str = "desktop:notification-tap";
pub const DESKTOP_NATIVE_EVENT_ERROR: &str = "desktop:native-event-error";

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopHostEventPayload {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_ulid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notification_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

#[derive(Clone, Serialize)]
struct DesktopHostEventError<'a> {
    operation: &'a str,
    message: &'a str,
}

pub fn emit_resume<R: Runtime>(
    app: &AppHandle<R>,
    reason: impl Into<String>,
) -> Result<(), tauri::Error> {
    app.emit(
        DESKTOP_RESUME_EVENT,
        DesktopHostEventPayload::resume(reason),
    )
}

pub fn emit_tray_open<R: Runtime>(
    app: &AppHandle<R>,
    reason: impl Into<String>,
) -> Result<(), tauri::Error> {
    app.emit(
        DESKTOP_TRAY_OPEN_EVENT,
        DesktopHostEventPayload::tray_open(reason),
    )
}

pub fn emit_notification_tap<R: Runtime>(
    app: &AppHandle<R>,
    notification_id: Option<String>,
    session_ulid: Option<String>,
    target: Option<String>,
) -> Result<(), tauri::Error> {
    app.emit(
        DESKTOP_NOTIFICATION_TAP_EVENT,
        DesktopHostEventPayload::notification_tap(notification_id, session_ulid, target),
    )
}

pub fn emit_native_event_error<R: Runtime>(
    app: &AppHandle<R>,
    operation: &'static str,
    message: &str,
) -> Result<(), tauri::Error> {
    app.emit(
        DESKTOP_NATIVE_EVENT_ERROR,
        DesktopHostEventError { operation, message },
    )
}

impl DesktopHostEventPayload {
    fn resume(reason: impl Into<String>) -> Self {
        Self {
            kind: "resume",
            reason: Some(reason.into()),
            ..Self::default()
        }
    }

    fn tray_open(reason: impl Into<String>) -> Self {
        Self {
            kind: "resume",
            target: Some("tray".to_string()),
            reason: Some(reason.into()),
            ..Self::default()
        }
    }

    fn notification_tap(
        notification_id: Option<String>,
        session_ulid: Option<String>,
        target: Option<String>,
    ) -> Self {
        Self {
            kind: "notification-tap",
            target,
            session_ulid,
            notification_id,
            ..Self::default()
        }
    }
}
