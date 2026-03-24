use crate::error::AppResult;
use crate::interface::contracts::{ModelConfigKeyInput, ModelConfigSetInput, ProviderIdInputV2, StubPayload};

#[path = "../../application/model_config/mod.rs"]
mod application_model_config;

#[tauri::command]
pub fn model_config_list() -> AppResult<StubPayload> {
    application_model_config::model_config_list()
}

#[tauri::command]
pub fn model_config_get(input: ModelConfigKeyInput) -> AppResult<StubPayload> {
    application_model_config::model_config_get(input)
}

#[tauri::command]
pub fn model_config_set(input: ModelConfigSetInput) -> AppResult<StubPayload> {
    application_model_config::model_config_set(input)
}

#[tauri::command]
pub fn model_config_delete(input: ModelConfigKeyInput) -> AppResult<StubPayload> {
    application_model_config::model_config_delete(input)
}

#[tauri::command]
pub fn model_config_provider_references(input: ProviderIdInputV2) -> AppResult<StubPayload> {
    application_model_config::model_config_provider_references(input)
}
