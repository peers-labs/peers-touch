use std::sync::Arc;

use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::state::AppState;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{State, Window};

// ---------------------------------------------------------------------
// What this module is (and what it deliberately is NOT) anymore.
//
// Until commit f6ac7929 this file fronted Station's HTTP-polling
// signaling subserver: `POST/GET /api/v1/ice/session/{new,get,offer,
// answer,candidate,candidates}` plus a peer-presence registry at
// `/api/v1/ice/peer/{register,unregister,get}`. Every active
// conversation paid ~1 req/s for candidate polling, the offer/answer
// SDPs flowed in plaintext through Station, and one polling loop per
// peer pair did not survive offline → online transitions cleanly.
//
// Phase 8 of the realtime architecture (see
// docs/architecture/realtime/event-stream.md §2.7 and §3.4) replaced
// that surface with:
//
//   - `POST /realtime/signal` — single ingress, JWT-gated, opaque
//     ciphertext payload (the standalone signaling envelope from
//     §2.7.2 — X25519 + AES-256-GCM, AAD-bound to session_ulid+kind).
//   - SSE fan-out via `GET /events/stream` — Station publishes onto
//     the same EventBus that already carries chat traffic, so a
//     receiver gets signals on every active session of every active
//     device with zero new wire surface.
//   - SSE PresenceFlip events — the role-hint publisher
//     (`/api/v1/ice/peer/register`) is gone; a peer's online/offline
//     liveness is now carried by PresenceSupervisor + the realtime
//     PresenceFlip event.
//
// What survives in this module is intentionally minimal:
//
//   - `ice_get_servers` → `/api/v1/turn/ice-servers`. WebRTC media
//     plane still needs ICE servers; the `turn` subserver was never
//     part of the deprecated signaling subserver and stays untouched.
//
// Anything that smells like an ICE *session* — offer/answer/candidate
// exchange — must NOT come back here. New code should use
// `realtime_signal_send` (interface/tauri_commands/realtime.rs) and
// the SSE call-signal stream.
// ---------------------------------------------------------------------

fn token_from_state(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<String, AppResult<StubPayload>> {
    let token = session_resolver::token_for_window(state.inner(), window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "Authentication required — please log in",
            None,
        ));
    }
    Ok(token)
}

fn fail_station_request(reason: station_client::StationClientError) -> AppResult<StubPayload> {
    tracing::error!(reason = %reason, "Station request failed");
    reason.into_app_result("Station request failed")
}

fn to_stub(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

// ============================================================================
// TURN (ICE servers)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IceServersResponse {
    pub ice_servers: Vec<Value>,
    pub ttl: Option<i64>,
}

#[tauri::command]
pub fn ice_get_servers(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let resp = match station_client::request_json(
        Method::GET,
        "/api/v1/turn/ice-servers",
        &token,
        None,
        None,
    ) {
        Ok(v) => v,
        Err(e) => return fail_station_request(e),
    };

    to_stub("ice_get_servers", resp)
}
