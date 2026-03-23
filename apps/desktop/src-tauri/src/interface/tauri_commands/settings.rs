use crate::error::AppResult;
use crate::interface::contracts::{SettingsGetInput, SettingsSetInput, StubPayload};
use crate::state::AppState;
use tauri::State;

#[path = "../../domain/settings/mod.rs"]
mod domain_settings;
#[path = "../../infrastructure/storage/mod.rs"]
mod storage_infrastructure;
#[path = "../../application/settings/mod.rs"]
mod application_settings;

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>, input: SettingsGetInput) -> AppResult<StubPayload> {
    application_settings::settings_get(state.inner(), input)
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, input: SettingsSetInput) -> AppResult<StubPayload> {
    application_settings::settings_set(state.inner(), input)
}

#[tauri::command]
pub fn settings_reset(state: State<'_, AppState>) -> AppResult<StubPayload> {
    application_settings::settings_reset(state.inner())
}
