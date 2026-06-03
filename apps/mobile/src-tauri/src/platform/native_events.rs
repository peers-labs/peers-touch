use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

pub const MOBILE_RESUME_EVENT: &str = "mobile:resume";
pub const MOBILE_NATIVE_EVENT_ERROR: &str = "mobile:native-event-error";

#[derive(Clone, Serialize)]
struct NativeRuntimeEventPayload<'a> {
    kind: &'a str,
    reason: &'a str,
}

#[derive(Clone, Serialize)]
struct NativeRuntimeEventError<'a> {
    operation: &'a str,
    message: &'a str,
}

pub fn emit_resume<R: Runtime>(app: &AppHandle<R>, reason: &'static str) -> Result<(), tauri::Error> {
    app.emit(
        MOBILE_RESUME_EVENT,
        NativeRuntimeEventPayload {
            kind: "resume",
            reason,
        },
    )
}

pub fn emit_native_event_error<R: Runtime>(
    app: &AppHandle<R>,
    operation: &'static str,
    message: &str,
) -> Result<(), tauri::Error> {
    app.emit(
        MOBILE_NATIVE_EVENT_ERROR,
        NativeRuntimeEventError {
            operation,
            message,
        },
    )
}
