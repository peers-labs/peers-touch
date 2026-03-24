use crate::error::AppResult;
use crate::interface::contracts::{
    ChatCompletionInput, ChatConversationInput, ChatListMessagesInput, ChatMarkReadInput, ChatMessageInput,
    ChatRenameConversationInput, ChatSendMessageInput, ChatSetConversationModelInput, ChatUpdateMessageInput,
    StubPayload,
};

#[path = "../../domain/chat/mod.rs"]
mod domain_chat;
#[path = "../../infrastructure/realtime/mod.rs"]
mod infrastructure_realtime;
#[path = "../../infrastructure/p2p/mod.rs"]
mod infrastructure_p2p;
#[path = "../../application/chat/mod.rs"]
mod application_chat;

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

#[tauri::command]
pub fn chat_completion_once(input: ChatCompletionInput) -> AppResult<StubPayload> {
    application_chat::chat_completion_once(input)
}
