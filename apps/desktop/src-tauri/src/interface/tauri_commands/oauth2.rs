use crate::error::AppResult;
use crate::contracts::{
    OAuthAuthorizeInput, OAuthCallbackInput, OAuthIdInput, OAuthLoopbackPollInput,
    OAuthLoopbackStartInput, OAuthResourceInput, OAuthSetCredentialsInput, StubPayload,
};

use crate::application::oauth2 as application_oauth2;

#[tauri::command]
pub fn oauth2_list_providers() -> AppResult<StubPayload> {
    application_oauth2::oauth2_list_providers()
}

#[tauri::command]
pub fn oauth2_get_provider(input: OAuthIdInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_get_provider(input)
}

#[tauri::command]
pub fn oauth2_get_credential_info(input: OAuthIdInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_get_credential_info(input)
}

#[tauri::command]
pub fn oauth2_set_credentials(input: OAuthSetCredentialsInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_set_credentials(input)
}

#[tauri::command]
pub fn oauth2_authorize(input: OAuthAuthorizeInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_authorize(input)
}

#[tauri::command]
pub fn oauth2_handle_callback(input: OAuthCallbackInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_handle_callback(input)
}

#[tauri::command]
pub fn oauth2_list_connections() -> AppResult<StubPayload> {
    application_oauth2::oauth2_list_connections()
}

#[tauri::command]
pub fn oauth2_get_connection(input: OAuthIdInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_get_connection(input)
}

#[tauri::command]
pub fn oauth2_disconnect(input: OAuthIdInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_disconnect(input)
}

#[tauri::command]
pub fn oauth2_refresh_token(input: OAuthIdInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_refresh_token(input)
}

#[tauri::command]
pub fn oauth2_call_resource(input: OAuthResourceInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_call_resource(input)
}

#[tauri::command]
pub fn oauth2_reload() -> AppResult<StubPayload> {
    application_oauth2::oauth2_reload()
}

#[tauri::command]
pub fn oauth2_get_page(input: OAuthIdInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_get_page(input)
}

#[tauri::command]
pub fn oauth2_start_loopback(input: OAuthLoopbackStartInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_start_loopback(input)
}

#[tauri::command]
pub fn oauth2_poll_loopback(input: OAuthLoopbackPollInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_poll_loopback(input)
}
