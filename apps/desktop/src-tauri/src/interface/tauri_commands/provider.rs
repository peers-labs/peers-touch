use crate::error::AppResult;
use crate::interface::contracts::{ProviderCheckInput, ProviderCreateInput, ProviderIdInput, ProviderUpdateInput, StubPayload};

#[path = "../../application/provider/mod.rs"]
mod application_provider;

#[tauri::command]
pub fn provider_list() -> AppResult<StubPayload> {
    application_provider::provider_list()
}

#[tauri::command]
pub fn provider_get(input: ProviderIdInput) -> AppResult<StubPayload> {
    application_provider::provider_get(input)
}

#[tauri::command]
pub fn provider_update(input: ProviderUpdateInput) -> AppResult<StubPayload> {
    application_provider::provider_update(input)
}

#[tauri::command]
pub fn provider_check(input: ProviderCheckInput) -> AppResult<StubPayload> {
    application_provider::provider_check(input)
}

#[tauri::command]
pub fn provider_create(input: ProviderCreateInput) -> AppResult<StubPayload> {
    application_provider::provider_create(input)
}

#[tauri::command]
pub fn provider_delete(input: ProviderIdInput) -> AppResult<StubPayload> {
    application_provider::provider_delete(input)
}

#[tauri::command]
pub fn provider_apply_preset(input: ProviderIdInput) -> AppResult<StubPayload> {
    application_provider::provider_apply_preset(input)
}

#[tauri::command]
pub fn provider_list_available_models() -> AppResult<StubPayload> {
    application_provider::provider_list_available_models()
}
