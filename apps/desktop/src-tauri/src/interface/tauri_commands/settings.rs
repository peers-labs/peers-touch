use std::sync::Arc;
use crate::error::AppResult;
use crate::contracts::{SettingsGetInput, SettingsSetInput, StubPayload};
use crate::state::AppState;
use tauri::State;

use crate::application::settings as application_settings;

#[tauri::command]
pub fn settings_get(state: State<'_, Arc<AppState>>, input: SettingsGetInput) -> AppResult<StubPayload> {
    application_settings::settings_get(state.inner(), input)
}

#[tauri::command]
pub fn settings_set(state: State<'_, Arc<AppState>>, input: SettingsSetInput) -> AppResult<StubPayload> {
    application_settings::settings_set(state.inner(), input)
}

#[tauri::command]
pub fn settings_reset(state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    application_settings::settings_reset(state.inner())
}
