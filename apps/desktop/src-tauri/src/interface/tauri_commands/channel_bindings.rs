use crate::application::channel_bindings as application_channel_bindings;
use crate::contracts::StubPayload;
use crate::error::AppResult;

#[tauri::command]
pub fn agent_channel_bindings_list(
    input: application_channel_bindings::ChannelBindingListInput,
) -> AppResult<StubPayload> {
    application_channel_bindings::agent_channel_bindings_list(input)
}

#[tauri::command]
pub fn agent_channel_binding_upsert(
    input: application_channel_bindings::ChannelBindingUpsertInput,
) -> AppResult<StubPayload> {
    application_channel_bindings::agent_channel_binding_upsert(input)
}

#[tauri::command]
pub fn agent_channel_binding_toggle(
    input: application_channel_bindings::ChannelBindingToggleInput,
) -> AppResult<StubPayload> {
    application_channel_bindings::agent_channel_binding_toggle(input)
}

#[tauri::command]
pub fn agent_channel_binding_delete(
    input: application_channel_bindings::ChannelBindingDeleteInput,
) -> AppResult<StubPayload> {
    application_channel_bindings::agent_channel_binding_delete(input)
}
