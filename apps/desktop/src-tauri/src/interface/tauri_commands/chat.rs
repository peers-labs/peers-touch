use crate::error::AppResult;
use crate::interface::contracts::{ChatListMessagesInput, ChatMarkReadInput, ChatSendMessageInput, StubPayload};

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
