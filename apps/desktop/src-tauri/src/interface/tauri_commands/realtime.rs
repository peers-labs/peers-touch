//! Tauri commands for the unified realtime event stream.
//!
//! This is the public client-facing entry point for
//! `infrastructure::event_stream`. The frontend calls
//! `realtime_stream_start` once per logged-in window (right after the
//! session is unlocked) and `realtime_stream_stop` on logout / actor
//! switch / app shutdown.
//!
//! While the supervisor is running, the frontend receives:
//!   * `realtime:event` — every business / heartbeat / resync frame
//!   * `realtime:connection-state` — connection lifecycle hints
//!
//! The supervisor is internally idempotent (re-calling start with
//! the same actor cancels and replaces the existing supervisor), so
//! the frontend can safely call `realtime_stream_start` on every
//! mount of the chat shell without worrying about leaking
//! connections.

use std::sync::Arc;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State, Window};

use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::event_stream;
use crate::infrastructure::station_client;
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

/// Input for `realtime_signal_send`. The frontend has already
/// produced `payload_b64` by ratchet-encrypting the canonical
/// signaling JSON (see contract §2.7.2) using the chat session's
/// existing E2EE primitives, so this command is a thin RPC pass-
/// through — it does not touch crypto state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RealtimeSignalInput {
    pub recipient_actor_id: String,
    pub session_ulid: String,
    /// One of the realtime CallSignal kinds — the WebRTC primitives
    /// "OFFER" / "ANSWER" / "CANDIDATE" / "HANGUP", or the
    /// application-level ringing kinds
    /// "CALL_REQUEST" / "CALL_ACCEPT" / "CALL_REJECT" / "CALL_END"
    /// (the latter four wrap a JSON body inside the same sealed
    /// envelope so Station never sees the call metadata). Validated
    /// server-side; the TS layer also constrains the type, so a bad
    /// value here means a programmer error rather than user input.
    pub kind: String,
    /// base64(opaque ciphertext envelope). Station never decodes
    /// this beyond a length check.
    pub payload_b64: String,
}

/// Publishes a single WebRTC signaling event onto the recipient's
/// (and, for multi-device, sender's own) realtime SSE stream via
/// Station's `POST /realtime/signal` ingress (contract §2.7.1).
///
/// The whole encryption envelope lives in `payload_b64`. Station
/// never decrypts it; the receiver is the *only* party that can.
/// This command therefore deliberately holds no crypto state — keep
/// encryption in the TS layer where the chat session ratchet already
/// lives.
#[tauri::command]
pub fn realtime_signal_send(
    input: RealtimeSignalInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    if input.recipient_actor_id.trim().is_empty()
        || input.session_ulid.trim().is_empty()
        || input.kind.trim().is_empty()
        || input.payload_b64.is_empty()
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "recipient_actor_id, session_ulid, kind, payload_b64 are required",
            None,
        );
    }
    let body = json!({
        "recipient_actor_id": input.recipient_actor_id,
        "session_ulid":       input.session_ulid,
        "kind":               input.kind,
        "payload_b64":        input.payload_b64,
    });
    let resp = match station_client::request_json(
        Method::POST,
        "/realtime/signal",
        &token,
        None,
        Some(body),
    ) {
        Ok(v) => v,
        Err(reason) => {
            tracing::warn!(reason = %reason, "realtime_signal_send: station rejected publish");
            return reason.into_app_result("Failed to publish realtime signal");
        }
    };
    to_stub("realtime_signal_send", resp)
}

/// Input for `realtime_typing_send`. Typing is purely advisory — no
/// payload, no encryption — so this is the simplest possible RPC.
/// We deliberately do not coalesce or debounce here: that lives in
/// the TS layer next to the keystroke source so we don't double-
/// debounce across IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RealtimeTypingInput {
    pub recipient_actor_id: String,
    pub session_ulid: String,
    pub typing: bool,
}

/// Publishes a typing-state pulse onto the recipient's realtime SSE
/// stream via Station's `POST /realtime/typing` ingress.
///
/// Best-effort: a 5xx from Station is logged but surfaced to the
/// caller too, so the TS layer can decide whether to retry the next
/// pulse. Typing pulses self-heal — the very next keystroke (or the
/// idle timer's typing=false flip) will reach the peer regardless of
/// whether this one did.
#[tauri::command]
pub fn realtime_typing_send(
    input: RealtimeTypingInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    if input.recipient_actor_id.trim().is_empty() || input.session_ulid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "recipient_actor_id and session_ulid are required",
            None,
        );
    }
    let body = json!({
        "recipient_actor_id": input.recipient_actor_id,
        "session_ulid":       input.session_ulid,
        "typing":             input.typing,
    });
    let resp = match station_client::request_json_auth(
        Method::POST,
        "/realtime/typing",
        &token,
        None,
        Some(&body),
    ) {
        Ok(_) => json!({ "accepted": true }),
        Err(reason) => {
            // Typing failures are not user-visible — silently surface
            // them via tracing and a structured error so a debug
            // overlay can still see them, but the chat UI should
            // treat the result as "best effort".
            tracing::debug!(reason = %reason, "realtime_typing_send: station rejected publish");
            return reason.into_app_result("Failed to publish typing state");
        }
    };
    to_stub("realtime_typing_send", resp)
}
