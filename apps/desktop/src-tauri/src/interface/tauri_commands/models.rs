use crate::error::AppResult;
use crate::interface::contracts::{
    ProviderModelAddInput, ProviderModelDeleteInput, ProviderModelFetchInput, ProviderModelToggleAllInput,
    ProviderModelToggleInput, ProviderModelUpdateInput, StubPayload,
};

#[path = "../../application/models/mod.rs"]
mod application_models;

#[tauri::command]
pub fn model_add(input: ProviderModelAddInput) -> AppResult<StubPayload> {
    application_models::model_add(input)
}

#[tauri::command]
pub fn model_update(input: ProviderModelUpdateInput) -> AppResult<StubPayload> {
    application_models::model_update(input)
}

#[tauri::command]
pub fn model_delete(input: ProviderModelDeleteInput) -> AppResult<StubPayload> {
    application_models::model_delete(input)
}

#[tauri::command]
pub fn model_fetch_remote(input: ProviderModelFetchInput) -> AppResult<StubPayload> {
    application_models::model_fetch_remote(input)
}

#[tauri::command]
pub fn model_toggle(input: ProviderModelToggleInput) -> AppResult<StubPayload> {
    application_models::model_toggle(input)
}

#[tauri::command]
pub fn model_toggle_all(input: ProviderModelToggleAllInput) -> AppResult<StubPayload> {
    application_models::model_toggle_all(input)
}
