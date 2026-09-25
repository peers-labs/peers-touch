use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::runtime::oauth::OAuthPublicProjection;

pub const MOBILE_PUSH_EVENT: &str = "mobile:push";
pub const MOBILE_DEEP_LINK_EVENT: &str = "mobile:deep-link";
pub const MOBILE_OAUTH_PROJECTION_EVENT: &str = "mobile:oauth-projection";
pub const MOBILE_NOTIFICATION_TAP_EVENT: &str = "mobile:notification-tap";
#[cfg(feature = "acceptance-harness")]
pub const MOBILE_RESUME_EVENT: &str = "mobile:resume";
pub const MOBILE_NATIVE_EVENT_ERROR: &str = "mobile:native-event-error";

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRuntimeEventPayload {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_ulid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notification_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    category: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lifecycle_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    native_sequence: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
}

#[derive(Clone, Serialize)]
struct NativeRuntimeEventError<'a> {
    operation: &'a str,
    message: &'a str,
}

#[cfg(feature = "acceptance-harness")]
pub fn emit_resume<R: Runtime>(
    app: &AppHandle<R>,
    reason: impl Into<String>,
) -> Result<(), tauri::Error> {
    app.emit(
        MOBILE_RESUME_EVENT,
        NativeRuntimeEventPayload::resume(reason),
    )
}

#[cfg(feature = "acceptance-harness")]
pub fn emit_push<R: Runtime>(
    app: &AppHandle<R>,
    notification_id: Option<String>,
    session_ulid: Option<String>,
    target: Option<String>,
) -> Result<(), tauri::Error> {
    app.emit(
        MOBILE_PUSH_EVENT,
        NativeRuntimeEventPayload::push(notification_id, session_ulid, target),
    )
}

pub fn emit_deep_link<R: Runtime>(app: &AppHandle<R>, url: String) -> Result<(), tauri::Error> {
    app.emit(
        MOBILE_DEEP_LINK_EVENT,
        NativeRuntimeEventPayload::deep_link(url),
    )
}

pub fn emit_oauth_projection<R: Runtime>(
    app: &AppHandle<R>,
    projection: OAuthPublicProjection,
) -> Result<(), tauri::Error> {
    app.emit(MOBILE_OAUTH_PROJECTION_EVENT, projection)
}

#[cfg(feature = "acceptance-harness")]
pub fn emit_notification_tap<R: Runtime>(
    app: &AppHandle<R>,
    notification_id: Option<String>,
    session_ulid: Option<String>,
    target: Option<String>,
) -> Result<(), tauri::Error> {
    app.emit(
        MOBILE_NOTIFICATION_TAP_EVENT,
        NativeRuntimeEventPayload::notification_tap(notification_id, session_ulid, target),
    )
}

pub fn emit_push_reconcile<R: Runtime>(
    app: &AppHandle<R>,
    notification_id: String,
    category: i32,
    target: String,
    lifecycle_generation: u64,
    native_sequence: u64,
) -> Result<(), tauri::Error> {
    app.emit(
        MOBILE_PUSH_EVENT,
        NativeRuntimeEventPayload::push_reconcile(
            notification_id,
            category,
            target,
            lifecycle_generation,
            native_sequence,
        ),
    )
}

pub fn emit_notification_tap_reconcile<R: Runtime>(
    app: &AppHandle<R>,
    notification_id: String,
    category: i32,
    target: String,
    lifecycle_generation: u64,
    native_sequence: u64,
) -> Result<(), tauri::Error> {
    app.emit(
        MOBILE_NOTIFICATION_TAP_EVENT,
        NativeRuntimeEventPayload::notification_tap_reconcile(
            notification_id,
            category,
            target,
            lifecycle_generation,
            native_sequence,
        ),
    )
}

pub fn emit_native_event_error<R: Runtime>(
    app: &AppHandle<R>,
    operation: &'static str,
    message: &str,
) -> Result<(), tauri::Error> {
    app.emit(
        MOBILE_NATIVE_EVENT_ERROR,
        NativeRuntimeEventError { operation, message },
    )
}

impl NativeRuntimeEventPayload {
    #[cfg(feature = "acceptance-harness")]
    fn resume(reason: impl Into<String>) -> Self {
        Self {
            kind: "resume",
            reason: Some(reason.into()),
            ..Self::default()
        }
    }

    #[cfg(feature = "acceptance-harness")]
    fn push(
        notification_id: Option<String>,
        session_ulid: Option<String>,
        target: Option<String>,
    ) -> Self {
        Self {
            kind: "push",
            target,
            session_ulid,
            notification_id,
            ..Self::default()
        }
    }

    fn deep_link(url: String) -> Self {
        Self {
            kind: "deep-link",
            url: Some(url),
            ..Self::default()
        }
    }

    #[cfg(feature = "acceptance-harness")]
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

    fn push_reconcile(
        notification_id: String,
        category: i32,
        target: String,
        lifecycle_generation: u64,
        native_sequence: u64,
    ) -> Self {
        Self {
            kind: "push",
            target: Some(target),
            notification_id: Some(notification_id),
            category: Some(category),
            lifecycle_generation: Some(lifecycle_generation),
            native_sequence: Some(native_sequence),
            ..Self::default()
        }
    }

    fn notification_tap_reconcile(
        notification_id: String,
        category: i32,
        target: String,
        lifecycle_generation: u64,
        native_sequence: u64,
    ) -> Self {
        Self {
            kind: "notification-tap",
            target: Some(target),
            notification_id: Some(notification_id),
            category: Some(category),
            lifecycle_generation: Some(lifecycle_generation),
            native_sequence: Some(native_sequence),
            ..Self::default()
        }
    }
}
