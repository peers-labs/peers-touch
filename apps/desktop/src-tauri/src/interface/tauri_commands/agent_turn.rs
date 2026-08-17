use crate::application::agent_turn as application_agent_turn;
use crate::application::session_resolver;
use crate::contracts::{
    AgentConversationArchiveInput, AgentConversationCreateInput, AgentConversationGetInput,
    AgentConversationListInput, AgentConversationMessagesInput, AgentConversationReplayEventsInput,
    AgentExecuteTurnInput, AgentGroupCreateInput, AgentGroupDeleteInput, AgentGroupUpdateInput,
    AgentKnowledgeBindingCreateInput, AgentKnowledgeBindingDeleteInput,
    AgentKnowledgeBindingListInput, AgentKnowledgeBindingUpdateInput, AgentLocalToolRequestInput,
    AgentMessageTranslateInput, AgentTaskCreateInput, AgentTaskDeleteInput, AgentTaskListInput,
    AgentTaskStatusInput, AgentTaskSubtaskAddInput, AgentTaskSubtaskCompleteInput,
    AgentThreadCreateInput, AgentThreadListInput, AgentThreadMessagesInput,
    AgentToolApprovalDecisionInput, AgentTurnStreamCancelInput, AgentTurnTraceGetInput,
    AgentTurnTraceListInput, StubPayload, TopicCommentCreateInput, TopicCommentDeleteInput,
    TopicCommentListInput,
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
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_agent_turn::agent_execute_turn(input, &token, &actor_id)
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
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
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
            actor_id,
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
pub fn agent_cancel_turn_stream(
    input: AgentTurnStreamCancelInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    application_agent_turn::cancel_agent_turn_stream(&input.stream_id, &token)
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

#[tauri::command]
pub fn agent_thread_create(
    input: AgentThreadCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_thread_create(input, &token)
}

#[tauri::command]
pub fn agent_thread_list(
    input: AgentThreadListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_thread_list(input, &token)
}

#[tauri::command]
pub fn agent_thread_messages(
    input: AgentThreadMessagesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_thread_messages(input, &token)
}

#[tauri::command]
pub fn agent_group_create(
    input: AgentGroupCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_group_create(input, &token)
}

#[tauri::command]
pub fn agent_group_update(
    input: AgentGroupUpdateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_group_update(input, &token)
}

#[tauri::command]
pub fn agent_group_delete(
    input: AgentGroupDeleteInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_group_delete(input, &token)
}

#[tauri::command]
pub fn agent_group_list(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_group_list(&token)
}

#[tauri::command]
pub fn topic_comment_create(
    input: TopicCommentCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::topic_comment_create(input, &token)
}

#[tauri::command]
pub fn topic_comment_delete(
    input: TopicCommentDeleteInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::topic_comment_delete(input, &token)
}

#[tauri::command]
pub fn topic_comment_list(
    input: TopicCommentListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::topic_comment_list(input, &token)
}

#[tauri::command]
pub fn agent_knowledge_binding_list(
    input: AgentKnowledgeBindingListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_knowledge_binding_list(input, &token)
}

#[tauri::command]
pub fn agent_knowledge_binding_create(
    input: AgentKnowledgeBindingCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_knowledge_binding_create(input, &token)
}

#[tauri::command]
pub fn agent_knowledge_binding_update(
    input: AgentKnowledgeBindingUpdateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_knowledge_binding_update(input, &token)
}

#[tauri::command]
pub fn agent_knowledge_binding_delete(
    input: AgentKnowledgeBindingDeleteInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_knowledge_binding_delete(input, &token)
}

#[tauri::command]
pub fn agent_task_create(
    input: AgentTaskCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_task_create(input, &token)
}

#[tauri::command]
pub fn agent_task_list(
    input: AgentTaskListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_task_list(input, &token)
}

#[tauri::command]
pub fn agent_task_status(
    input: AgentTaskStatusInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_task_status(input, &token)
}

#[tauri::command]
pub fn agent_task_delete(
    input: AgentTaskDeleteInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_task_delete(input, &token)
}

#[tauri::command]
pub fn agent_task_subtask_add(
    input: AgentTaskSubtaskAddInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_task_subtask_add(input, &token)
}

#[tauri::command]
pub fn agent_task_subtask_complete(
    input: AgentTaskSubtaskCompleteInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_task_subtask_complete(input, &token)
}

#[tauri::command]
pub fn agent_message_translate(
    input: AgentMessageTranslateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    application_agent_turn::agent_message_translate(input, &token)
}

#[tauri::command]
pub fn agent_replay_conversation_events(
    input: AgentConversationReplayEventsInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
    app: tauri::AppHandle,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let stream_id = input.stream_id.trim().to_string();
    let stream_id_for_task = stream_id.clone();
    let app_for_task = app.clone();
    let input_for_task = input.clone();
    let token_for_task = token.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = application_agent_turn::replay_conversation_events_stream(
            &app_for_task,
            input_for_task,
            &token_for_task,
        ) {
            tracing::error!(command = "agent_replay_conversation_events", error = %error, "Conversation events replay failed");
            application_agent_turn::emit_turn_stream_event(
                &app_for_task,
                &stream_id_for_task,
                "error",
                serde_json::json!({
                    "type": "error",
                    "error": error,
                }),
            );
        }
    });
    AppResult::success(StubPayload {
        command: "agent_replay_conversation_events".to_string(),
        status: serde_json::json!({ "stream_id": stream_id }).to_string(),
    })
}
