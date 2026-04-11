use crate::error::AppResult;
use crate::contracts::{
    AgentExecuteTurnInput, ChatCompletionInput, ChatConversationInput, ChatListMessagesInput,
    ChatMarkReadInput, ChatMessageInput, ChatRenameConversationInput, ChatSendMessageInput,
    ChatSetConversationModelInput, ChatUpdateMessageInput, StubPayload,
};

use crate::application::chat as application_chat;
use crate::application::agent_turn as application_agent_turn;

#[tauri::command]
pub fn chat_list_conversations() -> AppResult<StubPayload> {
    application_chat::chat_list_conversations()
}

#[tauri::command]
pub fn chat_list_messages(_input: ChatListMessagesInput) -> AppResult<StubPayload> {
    application_chat::chat_list_messages(_input)
}

#[tauri::command]
pub fn chat_send_message(_input: ChatSendMessageInput) -> AppResult<StubPayload> {
    application_chat::chat_send_message(_input)
}

#[tauri::command]
pub fn chat_mark_read(_input: ChatMarkReadInput) -> AppResult<StubPayload> {
    application_chat::chat_mark_read(_input)
}

#[tauri::command]
pub fn chat_delete_conversation(input: ChatConversationInput) -> AppResult<StubPayload> {
    application_chat::chat_delete_conversation(input)
}

#[tauri::command]
pub fn chat_rename_conversation(input: ChatRenameConversationInput) -> AppResult<StubPayload> {
    application_chat::chat_rename_conversation(input)
}

#[tauri::command]
pub fn chat_duplicate_conversation(input: ChatConversationInput) -> AppResult<StubPayload> {
    application_chat::chat_duplicate_conversation(input)
}

#[tauri::command]
pub fn chat_smart_rename_conversation(input: ChatConversationInput) -> AppResult<StubPayload> {
    application_chat::chat_smart_rename_conversation(input)
}

#[tauri::command]
pub fn chat_set_conversation_model(input: ChatSetConversationModelInput) -> AppResult<StubPayload> {
    application_chat::chat_set_conversation_model(input)
}

#[tauri::command]
pub fn chat_delete_message(input: ChatMessageInput) -> AppResult<StubPayload> {
    application_chat::chat_delete_message(input)
}

#[tauri::command]
pub fn chat_update_message(input: ChatUpdateMessageInput) -> AppResult<StubPayload> {
    application_chat::chat_update_message(input)
}

#[tauri::command]
pub fn chat_stop(input: ChatConversationInput) -> AppResult<StubPayload> {
    application_chat::chat_stop(input)
}

#[deprecated(note = "Use agent_execute_turn instead. This command will be removed in a future release.")]
#[tauri::command]
pub fn chat_completion_once(_input: ChatCompletionInput) -> AppResult<StubPayload> {
    tracing::warn!(
        command = "chat_completion_once",
        "DEPRECATED: chat_completion_once called, use agent_execute_turn instead"
    );
    AppResult::fail(
        crate::error::ErrorCode::InternalError,
        "error.chat.deprecated",
        Some(serde_json::json!({
            "message": "chat_completion_once is deprecated. Use agent_execute_turn instead."
        })),
    )
}
