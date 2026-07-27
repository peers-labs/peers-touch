use crate::application::provider as application_provider;
use crate::application::session_resolver;
use crate::contracts::{
    ProviderCheckInput, ProviderCreateInput, ProviderIdInput, ProviderUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tauri::{State, Window};

fn resolve_auth(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<(String, String), AppResult<StubPayload>> {
    let scope = session_resolver::actor_id_for_window(state.inner(), window).unwrap_or_default();
    let scope = scope.trim().to_string();
    if scope.is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "No active session",
            None,
        ));
    }

    let token = session_resolver::token_for_window(state.inner(), window).unwrap_or_default();
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "No auth token available",
            None,
        ));
    }

    Ok((scope, token))
}

#[tauri::command]
pub fn provider_list(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let (scope, token) = match resolve_auth(&state, &window) {
        Ok(auth) => auth,
        Err(error) => return error,
    };
    application_provider::provider_list(&scope, &token)
}

#[tauri::command]
pub fn provider_get(
    input: ProviderIdInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (scope, token) = match resolve_auth(&state, &window) {
        Ok(auth) => auth,
        Err(error) => return error,
    };
    application_provider::provider_get(&scope, &token, input)
}

#[tauri::command]
pub fn provider_update(
    input: ProviderUpdateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (scope, token) = match resolve_auth(&state, &window) {
        Ok(auth) => auth,
        Err(error) => return error,
    };
    application_provider::provider_update(&scope, &token, input)
}

#[tauri::command]
pub fn provider_check(
    input: ProviderCheckInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (scope, token) = match resolve_auth(&state, &window) {
        Ok(auth) => auth,
        Err(error) => return error,
    };
    application_provider::provider_check(&scope, &token, input)
}

#[tauri::command]
pub fn provider_create(
    input: ProviderCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (scope, token) = match resolve_auth(&state, &window) {
        Ok(auth) => auth,
        Err(error) => return error,
    };
    application_provider::provider_create(&scope, &token, input)
}

#[tauri::command]
pub fn provider_delete(
    input: ProviderIdInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (scope, token) = match resolve_auth(&state, &window) {
        Ok(auth) => auth,
        Err(error) => return error,
    };
    application_provider::provider_delete(&scope, &token, input)
}

#[tauri::command]
pub fn provider_apply_preset(
    _input: ProviderIdInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (_scope, _token) = match resolve_auth(&state, &window) {
        Ok(auth) => auth,
        Err(error) => return error,
    };
    AppResult::fail(
        ErrorCode::InvalidArgument,
        "provider_apply_preset is deprecated; providers are managed on Station",
        None,
    )
}

#[tauri::command]
pub fn provider_list_available_models(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (scope, token) = match resolve_auth(&state, &window) {
        Ok(auth) => auth,
        Err(error) => return error,
    };
    application_provider::provider_list_available_models(&scope, &token)
}

#[derive(Debug, Deserialize)]
pub struct ModelFetchRemoteInput {
    pub provider_id: String,
    pub data: Option<serde_json::Value>,
}

#[tauri::command]
pub fn model_fetch_remote(
    input: ModelFetchRemoteInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (scope, token) = match resolve_auth(&state, &window) {
        Ok(auth) => auth,
        Err(error) => return error,
    };
    application_provider::model_fetch_remote(&scope, &token, &input.provider_id)
}

#[derive(Debug, Deserialize)]
pub struct ModelToggleInput {
    pub provider_id: String,
    pub model_id: String,
    pub enabled: bool,
}

#[tauri::command]
pub fn model_toggle(
    input: ModelToggleInput,
    _state: State<'_, Arc<AppState>>,
    _window: Window,
) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: "model_toggle".to_string(),
        status: json!({ "ok": true, "provider_id": input.provider_id, "model_id": input.model_id, "enabled": input.enabled }).to_string(),
    })
}

#[derive(Debug, Deserialize)]
pub struct ModelDeleteInput {
    pub provider_id: String,
    pub model_id: String,
}

#[tauri::command]
pub fn model_delete(
    input: ModelDeleteInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (_scope, token) = match resolve_auth(&state, &window) {
        Ok(auth) => auth,
        Err(error) => return error,
    };
    application_provider::model_delete(&token, &input.provider_id, &input.model_id)
}
