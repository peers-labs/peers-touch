use std::sync::Arc;

use tauri::{State, Window};

use crate::application::capability_authority::{
    self, CapabilityBindingDeleteInput, CapabilityBindingListInput, CapabilityBindingUpsertInput,
    CapabilityManifestListInput, CapabilityReadinessInput, EncodedRequestInput,
};
use crate::application::session_resolver;
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;

fn authenticated_token(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<String, AppResult<Vec<u8>>> {
    let token = session_resolver::token_for_window(state.inner(), window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(token)
}

#[tauri::command]
pub fn agent_capability_manifest_list(
    input: CapabilityManifestListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::list_manifests(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_capability_binding_list(
    input: CapabilityBindingListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::list_bindings(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_capability_binding_upsert(
    input: CapabilityBindingUpsertInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::upsert_binding(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_capability_binding_delete(
    input: CapabilityBindingDeleteInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::delete_binding(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_capability_readiness(
    input: CapabilityReadinessInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::readiness(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_connector_manifest_list(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::list_connector_manifests(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_knowledge_descriptor_create(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::create_knowledge_descriptor(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_knowledge_descriptor_update(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::update_knowledge_descriptor(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_knowledge_descriptor_list(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::list_knowledge_descriptors(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_knowledge_descriptor_tombstone(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::tombstone_knowledge_descriptor(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_package_export(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::export_agent_package(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_package_import(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::import_agent_package(input, &token),
        Err(error) => error,
    }
}
