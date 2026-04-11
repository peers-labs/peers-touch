use std::sync::Arc;
use crate::error::AppResult;
use crate::contracts::{AuthLoginInput, AuthSessionPayload, AuthValidateTokenInput};
use crate::state::AppState;
use tauri::State;

use crate::application::auth::service as auth_service;

#[tauri::command]
pub fn auth_login(input: AuthLoginInput, state: State<'_, Arc<AppState>>) -> AppResult<AuthSessionPayload> {
    auth_service::auth_login(input, state.inner())
}

#[tauri::command]
pub fn auth_logout(state: State<'_, Arc<AppState>>) -> AppResult<AuthSessionPayload> {
    auth_service::auth_logout(state.inner())
}

#[tauri::command]
pub fn auth_restore_session(state: State<'_, Arc<AppState>>) -> AppResult<AuthSessionPayload> {
    auth_service::auth_restore_session(state.inner())
}

#[tauri::command]
pub fn auth_validate_token(
    input: AuthValidateTokenInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<AuthSessionPayload> {
    auth_service::auth_validate_token(input, state.inner())
}

/// Load a Station JWT (persisted during OAuth callback) into AppState
/// so the BFF session becomes immediately active.
#[tauri::command]
pub fn ensure_station_session(state: State<'_, Arc<AppState>>) -> AppResult<AuthSessionPayload> {
    auth_service::ensure_station_session(state.inner())
}
