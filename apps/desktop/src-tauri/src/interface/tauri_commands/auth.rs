use crate::error::AppResult;
use crate::contracts::{AuthLoginInput, AuthValidateTokenInput, StubPayload};
use crate::state::AppState;
use tauri::State;

use crate::application::auth::service as auth_service;

#[tauri::command]
pub fn auth_login(input: AuthLoginInput, state: State<AppState>) -> AppResult<StubPayload> {
    auth_service::auth_login(input, &state)
}

#[tauri::command]
pub fn auth_logout(state: State<AppState>) -> AppResult<StubPayload> {
    auth_service::auth_logout(&state)
}

#[tauri::command]
pub fn auth_restore_session(state: State<AppState>) -> AppResult<StubPayload> {
    auth_service::auth_restore_session(&state)
}

#[tauri::command]
pub fn auth_validate_token(
    input: AuthValidateTokenInput,
    state: State<AppState>,
) -> AppResult<StubPayload> {
    auth_service::auth_validate_token(input, &state)
}

/// Load a Station JWT (persisted during OAuth callback) into AppState
/// so the BFF session becomes immediately active.
#[tauri::command]
pub fn ensure_station_session(state: State<AppState>) -> AppResult<StubPayload> {
    auth_service::ensure_station_session(&state)
}
