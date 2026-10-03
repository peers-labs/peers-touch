use std::sync::Arc;
use tauri::{State, Window};

use crate::contracts::{
    OAuthAuthorizeInput, OAuthIdInput, OAuthLoopbackPollInput, OAuthLoopbackStartInput,
    OAuthResourceInput, OAuthSetCredentialsInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;

use crate::application::oauth2 as application_oauth2;
use crate::application::session_resolver;

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
pub fn oauth2_list_connections(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let Some(actor_ptid) = session_resolver::ptid_for_window(state.inner(), &window) else {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    };
    application_oauth2::oauth2_list_connections(&actor_ptid)
}

#[tauri::command]
pub fn oauth2_sync_connector_manifests(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let Some(actor_ptid) = session_resolver::ptid_for_window(state.inner(), &window) else {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    };
    let Some(token) = session_resolver::token_for_window(state.inner(), &window) else {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    };
    application_oauth2::sync_connector_manifests(&actor_ptid, &token)
}

#[tauri::command]
pub fn oauth2_get_connection(
    input: OAuthIdInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let Some(actor_ptid) = session_resolver::ptid_for_window(state.inner(), &window) else {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    };
    application_oauth2::oauth2_get_connection(&actor_ptid, input)
}

#[tauri::command]
pub fn oauth2_disconnect(
    input: OAuthIdInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let Some(actor_ptid) = session_resolver::ptid_for_window(state.inner(), &window) else {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    };
    let Some(token) = session_resolver::token_for_window(state.inner(), &window) else {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    };
    application_oauth2::oauth2_disconnect(&actor_ptid, &token, input)
}

#[tauri::command]
pub fn oauth2_refresh_token(
    input: OAuthIdInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let Some(actor_ptid) = session_resolver::ptid_for_window(state.inner(), &window) else {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    };
    application_oauth2::oauth2_refresh_token(&actor_ptid, input)
}

#[tauri::command]
pub fn oauth2_call_resource(
    input: OAuthResourceInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let Some(actor_ptid) = session_resolver::ptid_for_window(state.inner(), &window) else {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    };
    application_oauth2::oauth2_call_resource(&actor_ptid, input)
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
pub fn oauth2_start_loopback(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: OAuthLoopbackStartInput,
) -> AppResult<StubPayload> {
    let connector_authorization = match input.purpose.as_str() {
        "account_login" => None,
        "connector_link" => {
            let Some(actor_ptid) = session_resolver::ptid_for_window(state.inner(), &window) else {
                return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
            };
            let Some(token) = session_resolver::token_for_window(state.inner(), &window) else {
                return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
            };
            Some(application_oauth2::OAuthConnectorAuthorization { actor_ptid, token })
        }
        _ => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "purpose must be account_login or connector_link",
                None,
            )
        }
    };
    application_oauth2::oauth2_start_loopback(input, state.i18n.clone(), connector_authorization)
}

#[tauri::command]
pub fn oauth2_poll_loopback(input: OAuthLoopbackPollInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_poll_loopback(input)
}

#[tauri::command]
pub fn oauth2_resume_loopback(input: OAuthLoopbackPollInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_resume_loopback(input)
}

#[tauri::command]
pub fn oauth2_cancel_loopback(input: OAuthLoopbackPollInput) -> AppResult<StubPayload> {
    application_oauth2::oauth2_cancel_loopback(input)
}
