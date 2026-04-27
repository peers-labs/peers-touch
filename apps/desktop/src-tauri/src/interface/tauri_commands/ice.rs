use std::sync::Arc;

use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::state::AppState;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{State, Window};

fn token_from_state(state: &State<'_, Arc<AppState>>, window: &Window) -> Result<String, AppResult<StubPayload>> {
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

    let resp = match station_client::request_json(Method::GET, "/api/v1/turn/ice-servers", &token, None, None) {
        Ok(v) => v,
        Err(e) => return fail_station_request(e),
    };

    to_stub("ice_get_servers", resp)
}

// ============================================================================
// Signaling (WebRTC offer/answer/candidates exchange)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IcePeerRegisterInput {
    pub id: String,
    pub role: Option<String>,
    pub addrs: Option<Vec<String>>,
}

#[tauri::command]
pub fn ice_peer_register(input: IcePeerRegisterInput, state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }

    let body = json!({
        "id": input.id,
        "role": input.role.unwrap_or_else(|| "client".to_string()),
        "addrs": input.addrs.unwrap_or_default(),
    });

    let resp = match station_client::request_json(Method::POST, "/api/v1/ice/peer/register", &token, None, Some(body)) {
        Ok(v) => v,
        Err(e) => return fail_station_request(e),
    };
    to_stub("ice_peer_register", resp)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IcePeerUnregisterInput {
    pub id: String,
}

#[tauri::command]
pub fn ice_peer_unregister(input: IcePeerUnregisterInput, state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }
    let body = json!({ "id": input.id });
    let resp = match station_client::request_json(Method::POST, "/api/v1/ice/peer/unregister", &token, None, Some(body)) {
        Ok(v) => v,
        Err(e) => return fail_station_request(e),
    };
    to_stub("ice_peer_unregister", resp)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IceSessionNewInput {
    pub a: String,
    pub b: String,
}

#[tauri::command]
pub fn ice_session_new(input: IceSessionNewInput, state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.a.trim().is_empty() || input.b.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "a and b are required", None);
    }
    let body = json!({ "a": input.a, "b": input.b });
    let resp = match station_client::request_json(Method::POST, "/api/v1/ice/session/new", &token, None, Some(body)) {
        Ok(v) => v,
        Err(e) => return fail_station_request(e),
    };
    to_stub("ice_session_new", resp)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IceSessionIdInput {
    pub id: String,
}

#[tauri::command]
pub fn ice_session_get(input: IceSessionIdInput, state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }
    let query = vec![("id", input.id)];
    let resp = match station_client::request_json(Method::GET, "/api/v1/ice/session/get", &token, Some(&query), None) {
        Ok(v) => v,
        Err(e) => return fail_station_request(e),
    };
    to_stub("ice_session_get", resp)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IceSdpInput {
    pub id: String,
    pub sdp: String,
}

#[tauri::command]
pub fn ice_session_offer_post(input: IceSdpInput, state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.id.trim().is_empty() || input.sdp.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id and sdp are required", None);
    }
    let body = json!({ "id": input.id, "sdp": input.sdp });
    let resp = match station_client::request_json(Method::POST, "/api/v1/ice/session/offer", &token, None, Some(body)) {
        Ok(v) => v,
        Err(e) => return fail_station_request(e),
    };
    to_stub("ice_session_offer_post", resp)
}

#[tauri::command]
pub fn ice_session_offer_get(input: IceSessionIdInput, state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }
    let query = vec![("id", input.id)];
    let resp = match station_client::request_json(Method::GET, "/api/v1/ice/session/offer", &token, Some(&query), None) {
        Ok(v) => v,
        Err(e) => return fail_station_request(e),
    };
    to_stub("ice_session_offer_get", resp)
}

#[tauri::command]
pub fn ice_session_answer_post(input: IceSdpInput, state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.id.trim().is_empty() || input.sdp.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id and sdp are required", None);
    }
    let body = json!({ "id": input.id, "sdp": input.sdp });
    let resp = match station_client::request_json(Method::POST, "/api/v1/ice/session/answer", &token, None, Some(body)) {
        Ok(v) => v,
        Err(e) => return fail_station_request(e),
    };
    to_stub("ice_session_answer_post", resp)
}

#[tauri::command]
pub fn ice_session_answer_get(input: IceSessionIdInput, state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }
    let query = vec![("id", input.id)];
    let resp = match station_client::request_json(Method::GET, "/api/v1/ice/session/answer", &token, Some(&query), None) {
        Ok(v) => v,
        Err(e) => return fail_station_request(e),
    };
    to_stub("ice_session_answer_get", resp)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IceCandidateInput {
    pub id: String,
    pub candidate: String,
    pub mid: Option<String>,
    pub mline: Option<i32>,
    pub from: Option<String>,
}

#[tauri::command]
pub fn ice_session_candidate_post(input: IceCandidateInput, state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.id.trim().is_empty() || input.candidate.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id and candidate are required", None);
    }
    let body = json!({
        "id": input.id,
        "candidate": input.candidate,
        "mid": input.mid,
        "mline": input.mline.unwrap_or(0),
        "from": input.from.unwrap_or_default(),
    });
    let resp = match station_client::request_json(Method::POST, "/api/v1/ice/session/candidate", &token, None, Some(body)) {
        Ok(v) => v,
        Err(e) => return fail_station_request(e),
    };
    to_stub("ice_session_candidate_post", resp)
}

#[tauri::command]
pub fn ice_session_candidates_get(input: IceSessionIdInput, state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }
    let query = vec![("id", input.id)];
    let resp = match station_client::request_json(Method::GET, "/api/v1/ice/session/candidates", &token, Some(&query), None) {
        Ok(v) => v,
        Err(e) => return fail_station_request(e),
    };
    to_stub("ice_session_candidates_get", resp)
}

