use crate::application::agent_event_stream;
use crate::application::session_resolver;
use crate::contracts::{AgentEventCancelInput, AgentEventSubscribeInput, StubPayload};
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, State, Window};

const AGENT_EVENT_CHANNEL: &str = "agent:event";

#[tauri::command]
pub fn agent_events_subscribe(
    input: AgentEventSubscribeInput,
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
        .unwrap_or_else(|| format!("agent-events-{}", ulid::Ulid::new()));
    let cancel_flag = agent_event_stream::register_stream(&stream_id);
    let stream_id_for_task = stream_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = agent_event_stream::stream(
            &app,
            AGENT_EVENT_CHANNEL,
            &stream_id_for_task,
            &input.agent_id,
            None,
            0,
            &token,
            &cancel_flag,
        ) {
            agent_event_stream::emit_error(
                &app,
                AGENT_EVENT_CHANNEL,
                &stream_id_for_task,
                &input.agent_id,
                error,
            );
        }
        agent_event_stream::unregister_stream(&stream_id_for_task);
    });
    AppResult::success(StubPayload {
        command: "agent_events_subscribe".to_string(),
        status: serde_json::json!({ "stream_id": stream_id }).to_string(),
    })
}

#[tauri::command]
pub fn agent_events_cancel(input: AgentEventCancelInput) -> AppResult<StubPayload> {
    agent_event_stream::cancel_stream(&input.stream_id);
    AppResult::success(StubPayload {
        command: "agent_events_cancel".to_string(),
        status: serde_json::json!({ "stream_id": input.stream_id }).to_string(),
    })
}
