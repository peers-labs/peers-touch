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
    let Some(actor_ptid) = session_resolver::ptid_for_window(state.inner(), &window) else {
        return AppResult::fail(ErrorCode::Unauthorized, "no active actor", None);
    };
    let device_id = device_id_from(&window);
    event_stream::start(app, actor_ptid.clone(), token, device_id.clone());
    to_stub(
        "realtime_stream_start",
        json!({ "actor_ptid": actor_ptid, "device_id": device_id }),
    )
}

#[tauri::command]
pub fn realtime_stream_stop(
    state: State<'_, Arc<AppState>>,
    window: Window,
    app: AppHandle,
) -> AppResult<StubPayload> {
    if let Some(actor_ptid) = session_resolver::ptid_for_window(state.inner(), &window) {
        event_stream::stop_and_notify(&app, &actor_ptid);
        return to_stub("realtime_stream_stop", json!({ "actor_ptid": actor_ptid }));
    }
    to_stub("realtime_stream_stop", json!({ "actor_ptid": null }))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupCallJoinInput {
    pub group_ulid: String,
}

#[tauri::command]
pub fn group_call_join(
    input: GroupCallJoinInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    if input.group_ulid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "group_ulid is required", None);
    }
    let response = match station_client::request_json_auth(
        Method::POST,
        "/group-call/join",
        &token,
        None,
        Some(&json!({ "group_ulid": input.group_ulid })),
    ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("Failed to join group call"),
    };
    to_stub("group_call_join", response)
}

/// Input for `realtime_signal_send`. The frontend has already
/// produced `payload_b64` by ratchet-encrypting the canonical
/// signaling JSON (see contract §2.7.2) using the chat session's
/// existing E2EE primitives, so this command is a thin RPC pass-
/// through — it does not touch crypto state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RealtimeSignalInput {
    pub recipient_actor_ptid: String,
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
    /// Plaintext call identifier for Station-side first-terminal-action-wins
    /// arbitration (CCU-D06). Populated for call-lifecycle signals only.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub call_id: String,
    /// Device identifier so Station can stamp the winning device on
    /// the fan-out frame.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RealtimeCallResolutionInput {
    pub call_id: String,
    pub peer_actor_ptid: String,
}

fn signal_request_body(input: RealtimeSignalInput) -> Value {
    let mut body = json!({
        "recipient_ptid": input.recipient_actor_ptid,
        "session_ulid": input.session_ulid,
        "kind": input.kind,
        "payload_b64": input.payload_b64,
    });
    if !input.call_id.is_empty() {
        body["call_id"] = Value::String(input.call_id);
    }
    if !input.device_id.is_empty() {
        body["device_id"] = Value::String(input.device_id);
    }
    body
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
    if input.recipient_actor_ptid.trim().is_empty()
        || input.session_ulid.trim().is_empty()
        || input.kind.trim().is_empty()
        || input.payload_b64.is_empty()
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "recipient_actor_ptid, session_ulid, kind, payload_b64 are required",
            None,
        );
    }
    let mut input = input;
    if input.device_id.is_empty() && !input.call_id.is_empty() {
        input.device_id = device_id_from(&window);
    }
    let body = signal_request_body(input);
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

#[tauri::command]
pub fn realtime_call_resolution_get(
    input: RealtimeCallResolutionInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let call_id = input.call_id.trim();
    let peer_actor_ptid = input.peer_actor_ptid.trim();
    if call_id.is_empty() || peer_actor_ptid.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "call_id and peer_actor_ptid are required",
            None,
        );
    }
    match station_client::request_json(
        Method::GET,
        "/realtime/call-resolution",
        &token,
        Some(&[
            ("call_id", call_id.to_string()),
            ("peer_actor_ptid", peer_actor_ptid.to_string()),
        ]),
        None,
    ) {
        Ok(response) => to_stub("realtime_call_resolution_get", response),
        Err(reason) => reason.into_app_result("Failed to read call resolution"),
    }
}

#[cfg(test)]
mod tests {
    use super::{signal_request_body, RealtimeSignalInput};

    #[test]
    fn signal_request_uses_station_wire_field_names() {
        let body = signal_request_body(RealtimeSignalInput {
            recipient_actor_ptid: "ptid:bob".to_string(),
            session_ulid: "session-1".to_string(),
            kind: "OFFER".to_string(),
            payload_b64: "cGF5bG9hZA==".to_string(),
            call_id: String::new(),
            device_id: String::new(),
        });

        assert_eq!(body["recipient_ptid"], "ptid:bob");
        assert!(body.get("recipient_actor_ptid").is_none());
        assert!(body.get("call_id").is_none());
    }

    #[test]
    fn signal_request_includes_call_id_when_present() {
        let body = signal_request_body(RealtimeSignalInput {
            recipient_actor_ptid: "ptid:bob".to_string(),
            session_ulid: "session-1".to_string(),
            kind: "CALL_ACCEPT".to_string(),
            payload_b64: "cGF5bG9hZA==".to_string(),
            call_id: "01JTEST".to_string(),
            device_id: "win-main".to_string(),
        });

        assert_eq!(body["call_id"], "01JTEST");
        assert_eq!(body["device_id"], "win-main");
    }
}
