use std::sync::Arc;

use crate::contracts::{
    ChatCompletionInput, ChatConversationInput, ChatListMessagesInput, ChatMarkReadInput,
    ChatMessageInput, ChatRenameConversationInput, ChatSendMessageInput,
    ChatSetConversationModelInput, ChatUpdateMessageInput, StubPayload,
};
use crate::error::AppResult;

use crate::application::chat as application_chat;
use crate::application::session_resolver;
use crate::state::AppState;
use tauri::{Manager, State, Window};

#[tauri::command]
pub fn chat_list_conversations(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_chat::chat_list_conversations(&actor_id)
}

#[tauri::command]
pub fn chat_list_messages(
    state: State<'_, Arc<AppState>>,
    window: Window,
    _input: ChatListMessagesInput,
) -> AppResult<StubPayload> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_chat::chat_list_messages(&actor_id, _input)
}

#[tauri::command]
pub fn chat_send_message(
    state: State<'_, Arc<AppState>>,
    window: Window,
    _input: ChatSendMessageInput,
) -> AppResult<StubPayload> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_chat::chat_send_message(&actor_id, _input)
}

#[tauri::command]
pub fn chat_mark_read(
    state: State<'_, Arc<AppState>>,
    window: Window,
    _input: ChatMarkReadInput,
) -> AppResult<StubPayload> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_chat::chat_mark_read(&actor_id, _input)
}

#[tauri::command]
pub fn chat_delete_conversation(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: ChatConversationInput,
) -> AppResult<StubPayload> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_chat::chat_delete_conversation(&actor_id, input)
}

#[tauri::command]
pub fn chat_rename_conversation(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: ChatRenameConversationInput,
) -> AppResult<StubPayload> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_chat::chat_rename_conversation(&actor_id, input)
}

#[tauri::command]
pub fn chat_duplicate_conversation(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: ChatConversationInput,
) -> AppResult<StubPayload> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_chat::chat_duplicate_conversation(&actor_id, input)
}

#[tauri::command]
pub fn chat_smart_rename_conversation(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: ChatConversationInput,
) -> AppResult<StubPayload> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_chat::chat_smart_rename_conversation(&actor_id, input)
}

#[tauri::command]
pub fn chat_set_conversation_model(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: ChatSetConversationModelInput,
) -> AppResult<StubPayload> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_chat::chat_set_conversation_model(&actor_id, input)
}

#[tauri::command]
pub fn chat_delete_message(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: ChatMessageInput,
) -> AppResult<StubPayload> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_chat::chat_delete_message(&actor_id, input)
}

#[tauri::command]
pub fn chat_update_message(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: ChatUpdateMessageInput,
) -> AppResult<StubPayload> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_chat::chat_update_message(&actor_id, input)
}

#[tauri::command]
pub fn chat_stop(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: ChatConversationInput,
) -> AppResult<StubPayload> {
    let actor_id =
        session_resolver::actor_id_for_window(state.inner(), &window).unwrap_or_default();
    application_chat::chat_stop(&actor_id, input)
}

#[tauri::command]
pub async fn chat_completion_once(
    app: tauri::AppHandle,
    input: ChatCompletionInput,
    window: Window,
) -> AppResult<StubPayload> {
    let state: Arc<AppState> = app.state::<Arc<AppState>>().inner().clone();
    let actor_id = session_resolver::actor_id_for_window(&state, &window).unwrap_or_default();
    match tauri::async_runtime::spawn_blocking(move || {
        application_chat::chat_completion_once(&actor_id, input)
    })
    .await
    {
        Ok(result) => result,
        Err(e) => {
            tracing::error!(error = %e, "chat_completion_once task failed");
            AppResult::fail(
                crate::error::ErrorCode::InternalError,
                format!("Chat completion failed: {}", e),
                None,
            )
        }
    }
}

#[tauri::command]
pub async fn chat_completion_stream(
    app: tauri::AppHandle,
    input: ChatCompletionInput,
) -> AppResult<StubPayload> {
    let stream_id = format!("stream-{}", ulid::Ulid::new().to_string());
    let stream_id_clone = stream_id.clone();
    tauri::async_runtime::spawn(async move {
        application_chat::streaming::chat_completion_stream(app, stream_id_clone, input).await;
    });
    AppResult::success(StubPayload {
        command: "chat_completion_stream".to_string(),
        status: serde_json::json!({ "stream_id": stream_id }).to_string(),
    })
}
