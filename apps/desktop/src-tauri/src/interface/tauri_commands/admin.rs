use crate::error::AppResult;
use crate::contracts::{AdminExecuteActionInput, AdminNetworkProbeInput, StubPayload};
use crate::state::AppState;
use tauri::State;

use crate::application::admin as application_admin;

#[tauri::command]
pub fn admin_health(state: State<'_, AppState>) -> AppResult<StubPayload> {
    application_admin::admin_health(state.inner())
}

#[tauri::command]
pub fn admin_network_probe(
    state: State<'_, AppState>,
    input: AdminNetworkProbeInput,
) -> AppResult<StubPayload> {
    application_admin::admin_network_probe(state.inner(), input)
}

#[tauri::command]
pub fn admin_execute_action(
    state: State<'_, AppState>,
    input: AdminExecuteActionInput,
) -> AppResult<StubPayload> {
    application_admin::admin_execute_action(state.inner(), input)
}
