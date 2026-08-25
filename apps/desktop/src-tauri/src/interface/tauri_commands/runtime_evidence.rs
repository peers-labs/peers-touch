use crate::application::desktop_executor_worker::CapabilityWorkerSupervisor;
use crate::application::runtime_evidence as application_runtime_evidence;
use crate::application::session_resolver;
use crate::contracts::{
    AgentCapabilityReadinessInput, AgentRuntimeActivityInput, AgentRuntimeProfileInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;
use std::sync::Arc;
use tauri::{State, Window};

fn authenticated_token(
    state: &Arc<AppState>,
    window: &Window,
) -> Result<String, AppResult<StubPayload>> {
    let token = session_resolver::token_for_window(state, window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(token)
}

#[tauri::command]
pub fn agent_runtime_profile_effective(
    input: AgentRuntimeProfileInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    match authenticated_token(state.inner(), &window) {
        Ok(token) => application_runtime_evidence::effective_runtime_profile(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_capability_readiness(
    input: AgentCapabilityReadinessInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    match authenticated_token(state.inner(), &window) {
        Ok(token) => application_runtime_evidence::capability_readiness(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_capability_sessions(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    match authenticated_token(state.inner(), &window) {
        Ok(token) => application_runtime_evidence::station_capability_sessions(&token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_browser_capability_session_open(
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<StubPayload> {
    if let Err(error) = authenticated_token(state.inner(), &window) {
        return error;
    }
    application_runtime_evidence::open_browser_capability_session(supervisor.inner())
}

#[tauri::command]
pub fn agent_browser_capability_session_close(
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<StubPayload> {
    if let Err(error) = authenticated_token(state.inner(), &window) {
        return error;
    }
    application_runtime_evidence::close_browser_capability_session(supervisor.inner())
}

#[tauri::command]
pub fn agent_runtime_activity_station(
    input: AgentRuntimeActivityInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    match authenticated_token(state.inner(), &window) {
        Ok(token) => application_runtime_evidence::station_runtime_activity(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_runtime_activity_local(
    input: AgentRuntimeActivityInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    match authenticated_token(state.inner(), &window) {
        Ok(token) => application_runtime_evidence::local_runtime_activity(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_capability_session_snapshot(
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<StubPayload> {
    if let Err(error) = authenticated_token(state.inner(), &window) {
        return error;
    }
    match supervisor.snapshot() {
        Ok(snapshot) => application_runtime_evidence::capability_session_snapshot(snapshot),
        Err(error) => AppResult::fail(
            ErrorCode::InternalError,
            "agent.capabilitySessionSnapshotFailed",
            Some(serde_json::json!({ "cause": error })),
        ),
    }
}
