use crate::application::agent_orchestration as application_agent_orchestration;
use crate::application::session_resolver;
use crate::contracts::{
    AgentCollaborationCancelInput, AgentCollaborationCancelTaskInput,
    AgentCollaborationClaimExecutorInput, AgentCollaborationCreateInput,
    AgentCollaborationGetInput, AgentCollaborationHeartbeatLeaseInput,
    AgentCollaborationListEventsInput, AgentCollaborationListInput,
    AgentCollaborationReleaseLeaseInput, AgentCollaborationSubmitNodeResultInput,
    AgentCollaborationSubscribeInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, State, Window};

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
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_agent_orchestration::agent_collaboration_create(input, &token, &actor_id)
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
pub fn agent_collaboration_subscribe(
    input: AgentCollaborationSubscribeInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
    app: AppHandle,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    if input.agent_id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "agent_id is required", None);
    }
    let stream_id = input
        .stream_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("agent-collaboration-{}", ulid::Ulid::new()));
    let cancel_flag = application_agent_orchestration::register_collaboration_stream(&stream_id);
    let stream_id_for_task = stream_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        application_agent_orchestration::agent_collaboration_subscribe(
            app,
            stream_id_for_task.clone(),
            input,
            token,
            cancel_flag,
        );
        application_agent_orchestration::unregister_collaboration_stream(&stream_id_for_task);
    });
    AppResult::success(StubPayload {
        command: "agent_collaboration_subscribe".to_string(),
        status: serde_json::json!({ "stream_id": stream_id }).to_string(),
    })
}

#[tauri::command]
pub fn agent_collaboration_cancel_stream(
    input: AgentCollaborationCancelInput,
) -> AppResult<StubPayload> {
    application_agent_orchestration::cancel_collaboration_stream(input)
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

#[tauri::command]
pub fn agent_collaboration_resume_task(
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
