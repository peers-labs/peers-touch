use crate::error::AppResult;
use crate::interface::contracts::{
    ChannelCreateInput, ChannelEventsInput, ChannelIdInput, ChannelSendMessageInput, ChannelUpdateInput, StubPayload,
};

#[path = "../../application/channels/mod.rs"]
mod application_channels;

#[tauri::command]
pub fn channels_list() -> AppResult<StubPayload> {
    application_channels::channels_list()
}

#[tauri::command]
pub fn channels_get(input: ChannelIdInput) -> AppResult<StubPayload> {
    application_channels::channels_get(input)
}

#[tauri::command]
pub fn channels_create(input: ChannelCreateInput) -> AppResult<StubPayload> {
    application_channels::channels_create(input)
}

#[tauri::command]
pub fn channels_update(input: ChannelUpdateInput) -> AppResult<StubPayload> {
    application_channels::channels_update(input)
}

#[tauri::command]
pub fn channels_delete(input: ChannelIdInput) -> AppResult<StubPayload> {
    application_channels::channels_delete(input)
}

#[tauri::command]
pub fn channels_test(input: ChannelIdInput) -> AppResult<StubPayload> {
    application_channels::channels_test(input)
}

#[tauri::command]
pub fn channels_send(input: ChannelSendMessageInput) -> AppResult<StubPayload> {
    application_channels::channels_send(input)
}

#[tauri::command]
pub fn channels_list_chats(input: ChannelIdInput) -> AppResult<StubPayload> {
    application_channels::channels_list_chats(input)
}

#[tauri::command]
pub fn channels_start_bot(input: ChannelIdInput) -> AppResult<StubPayload> {
    application_channels::channels_start_bot(input)
}

#[tauri::command]
pub fn channels_stop_bot(input: ChannelIdInput) -> AppResult<StubPayload> {
    application_channels::channels_stop_bot(input)
}

#[tauri::command]
pub fn channels_bot_status(input: ChannelIdInput) -> AppResult<StubPayload> {
    application_channels::channels_bot_status(input)
}

#[tauri::command]
pub fn channels_list_events(input: ChannelEventsInput) -> AppResult<StubPayload> {
    application_channels::channels_list_events(input)
}

#[tauri::command]
pub fn channels_stats(input: ChannelIdInput) -> AppResult<StubPayload> {
    application_channels::channels_stats(input)
}
