//! Tauri commands for the unified realtime event stream.
//!
//! This is the public client-facing entry point for
//! `infrastructure::event_stream`. The frontend calls
//! `realtime_stream_start` once per logged-in window (right after the
//! session is unlocked) and `realtime_stream_stop` on logout / actor
//! switch / app shutdown.
//!
//! While the supervisor is running, the frontend receives:
//!   * `realtime.event` — every business / heartbeat / resync frame
//!   * `realtime.connection-state` — connection lifecycle hints
//!
//! The supervisor is internally idempotent (re-calling start with
//! the same actor cancels and replaces the existing supervisor), so
//! the frontend can safely call `realtime_stream_start` on every
//! mount of the chat shell without worrying about leaking
//! connections.

use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, State, Window};

use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::event_stream;
use crate::state::AppState;

fn to_stub(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

/// Stable per-window device id derived from the Tauri label.
///
/// Two windows of the same actor must have distinct device ids so the
/// server tracks their cursors independently (each window has its own
/// SSE connection and its own pending replay frontier). The Tauri
/// window label is the only stable identifier we have at this layer
/// without forcing the frontend to mint and persist its own.
fn device_id_from(window: &Window) -> String {
    let label = window.label();
    if label.is_empty() {
        "default".into()
    } else {
        format!("win-{label}")
    }
}

#[tauri::command]
pub fn realtime_stream_start(
    state: State<'_, Arc<AppState>>,
    window: Window,
    app: AppHandle,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let Some(actor_id) = session_resolver::actor_id_for_window(state.inner(), &window) else {
        return AppResult::fail(ErrorCode::Unauthorized, "no active actor", None);
    };
    let device_id = device_id_from(&window);
    event_stream::start(app, actor_id.clone(), token, device_id.clone());
    to_stub(
        "realtime_stream_start",
        json!({ "actor_id": actor_id, "device_id": device_id }),
    )
}

#[tauri::command]
pub fn realtime_stream_stop(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if let Some(actor_id) = session_resolver::actor_id_for_window(state.inner(), &window) {
        event_stream::stop(&actor_id);
        return to_stub("realtime_stream_stop", json!({ "actor_id": actor_id }));
    }
    to_stub("realtime_stream_stop", json!({ "actor_id": null }))
}
