use crate::application::agent_turn as application_agent_turn;
use crate::application::session_resolver;
use crate::contracts::{
    AgentConversationArchiveInput, AgentConversationCreateInput, AgentConversationGetInput,
    AgentConversationListInput, AgentConversationMessagesInput, AgentExecuteTurnInput,
    AgentLocalToolRequestInput, AgentToolApprovalDecisionInput, AgentTurnStreamCancelInput,
    AgentTurnTraceGetInput, AgentTurnTraceListInput, StubPayload,
};
use crate::error::AppResult;
use crate::error::ErrorCode;
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;
use tauri::Window;

#[tauri::command]
pub fn agent_execute_turn(
    input: AgentExecuteTurnInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let actor_ptid = session_resolver::ptid_for_window(state.inner(), &window).unwrap_or_default();
    application_agent_turn::agent_execute_turn(input, &token, &actor_ptid)
}

#[tauri::command]
pub fn agent_resolve_local_tool_request(
    input: AgentLocalToolRequestInput,
) -> AppResult<StubPayload> {
    application_agent_turn::agent_resolve_local_tool_request(input)
}

#[tauri::command]
pub fn agent_execute_turn_stream(
    input: AgentExecuteTurnInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
    app: tauri::AppHandle,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let actor_ptid = session_resolver::ptid_for_window(state.inner(), &window).unwrap_or_default();
    let stream_id = input
        .stream_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("agent-turn-{}", ulid::Ulid::new()));
    let cancel_flag = application_agent_turn::register_agent_turn_stream(&stream_id);
    let stream_id_for_task = stream_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        application_agent_turn::agent_execute_turn_stream(
            app,
            stream_id_for_task.clone(),
            input,
            token,
            actor_ptid,
            cancel_flag,
        );
        application_agent_turn::unregister_agent_turn_stream(&stream_id_for_task);
    });
    AppResult::success(StubPayload {
        command: "agent_execute_turn_stream".to_string(),
        status: serde_json::json!({ "stream_id": stream_id }).to_string(),
    })
}

#[tauri::command]
pub fn agent_cancel_turn_stream(input: AgentTurnStreamCancelInput) -> AppResult<StubPayload> {
    application_agent_turn::cancel_agent_turn_stream(&input.stream_id)
}

#[tauri::command]
pub fn agent_turn_trace_list(
    input: AgentTurnTraceListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_turn_trace_list(input, &token)
}

#[tauri::command]
pub fn agent_turn_trace_get(
    input: AgentTurnTraceGetInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_turn_trace_get(input, &token)
}

#[tauri::command]
pub fn agent_decide_tool_approval(input: AgentToolApprovalDecisionInput) -> AppResult<StubPayload> {
    application_agent_turn::decide_tool_approval(input)
}

#[tauri::command]
pub fn agent_conversation_list(
    input: AgentConversationListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_conversation_list(input, &token)
}

#[tauri::command]
pub fn agent_conversation_get(
    input: AgentConversationGetInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_conversation_get(input, &token)
}

#[tauri::command]
pub fn agent_conversation_create(
    input: AgentConversationCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_conversation_create(input, &token)
}

#[tauri::command]
pub fn agent_conversation_messages(
    input: AgentConversationMessagesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_conversation_messages(input, &token)
}

#[tauri::command]
pub fn agent_conversation_archive(
    input: AgentConversationArchiveInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_conversation_archive(input, &token)
}
