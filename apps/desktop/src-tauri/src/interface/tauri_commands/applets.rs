use crate::error::AppResult;
use crate::contracts::{
    AppletActionInput, AppletConfigSetInput, AppletIdInput, AppletInvokeInput, StubPayload,
};
use crate::state::AppState;
use tauri::State;

use crate::application::applets as application_applets;

#[tauri::command]
pub fn applets_list(state: State<'_, AppState>) -> AppResult<StubPayload> {
    application_applets::applets_list(state.inner())
}

#[tauri::command]
pub fn applets_get(state: State<'_, AppState>, input: AppletIdInput) -> AppResult<StubPayload> {
    application_applets::applets_get(state.inner(), input)
}

#[tauri::command]
pub fn applets_activate(
    state: State<'_, AppState>,
    input: AppletIdInput,
) -> AppResult<StubPayload> {
    application_applets::applets_activate(state.inner(), input)
}

#[tauri::command]
pub fn applets_deactivate(
    state: State<'_, AppState>,
    input: AppletIdInput,
) -> AppResult<StubPayload> {
    application_applets::applets_deactivate(state.inner(), input)
}

#[tauri::command]
pub fn applets_get_config(
    state: State<'_, AppState>,
    input: AppletIdInput,
) -> AppResult<StubPayload> {
    application_applets::applets_get_config(state.inner(), input)
}

#[tauri::command]
pub fn applets_set_config(
    state: State<'_, AppState>,
    input: AppletConfigSetInput,
) -> AppResult<StubPayload> {
    application_applets::applets_set_config(state.inner(), input)
}

#[tauri::command]
pub fn applets_action(
    state: State<'_, AppState>,
    input: AppletActionInput,
) -> AppResult<StubPayload> {
    application_applets::applets_action(state.inner(), input)
}

#[tauri::command]
pub fn applets_invoke(
    state: State<'_, AppState>,
    input: AppletInvokeInput,
) -> AppResult<StubPayload> {
    application_applets::applets_invoke(state.inner(), input)
}
