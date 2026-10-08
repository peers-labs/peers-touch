use crate::application::agent_orchestration as application_agent_orchestration;
use crate::application::session_resolver;
use crate::contracts::{
    AgentCollaborationCancelTaskInput, AgentCollaborationClaimExecutorInput,
    AgentCollaborationCreateInput, AgentCollaborationGetInput,
    AgentCollaborationHeartbeatLeaseInput, AgentCollaborationListEventsInput,
    AgentCollaborationListInput, AgentCollaborationReleaseLeaseInput,
    AgentCollaborationResumeTaskInput, AgentCollaborationSubmitNodeResultInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;
use std::sync::Arc;
use tauri::{State, Window};

#[tauri::command]
pub fn agent_collaboration_create(
    input: AgentCollaborationCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let actor_ptid = session_resolver::ptid_for_window(state.inner(), &window).unwrap_or_default();
    application_agent_orchestration::agent_collaboration_create(input, &token, &actor_ptid)
}

#[tauri::command]
pub fn agent_collaboration_get(
    input: AgentCollaborationGetInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_orchestration::agent_collaboration_get(input, &token)
}

#[tauri::command]
pub fn agent_collaboration_list(
    input: AgentCollaborationListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_orchestration::agent_collaboration_list(input, &token)
}

#[tauri::command]
pub fn agent_collaboration_list_events(
    input: AgentCollaborationListEventsInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_orchestration::agent_collaboration_list_events(input, &token)
}

#[tauri::command]
pub fn agent_collaboration_cancel_task(
    input: AgentCollaborationCancelTaskInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_orchestration::agent_collaboration_cancel_task(input, &token)
}

#[tauri::command]
pub fn agent_collaboration_resume_task(
    input: AgentCollaborationResumeTaskInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_orchestration::agent_collaboration_resume_task(input, &token)
}

#[tauri::command]
pub fn agent_collaboration_submit_node_result(
    input: AgentCollaborationSubmitNodeResultInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_orchestration::agent_collaboration_submit_node_result(input, &token)
}

#[tauri::command]
pub fn agent_collaboration_claim_executor_task(
    input: AgentCollaborationClaimExecutorInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_orchestration::agent_collaboration_claim_executor_task(input, &token)
}

#[tauri::command]
pub fn agent_collaboration_heartbeat_executor_lease(
    input: AgentCollaborationHeartbeatLeaseInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_orchestration::agent_collaboration_heartbeat_executor_lease(input, &token)
}

#[tauri::command]
pub fn agent_collaboration_release_executor_lease(
    input: AgentCollaborationReleaseLeaseInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_orchestration::agent_collaboration_release_executor_lease(input, &token)
}
