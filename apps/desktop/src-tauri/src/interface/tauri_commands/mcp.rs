use std::sync::Arc;

use tauri::{State, Window};

use crate::application::capability_authority::{self, EncodedRequestInput};
use crate::application::mcp as application_mcp;
use crate::application::session_resolver;
use crate::contracts::{McpCreateInput, McpNameInput, McpToggleInput, McpUpdateInput, StubPayload};
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;

fn authenticated_actor(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<(String, String), AppResult<StubPayload>> {
    let token = session_resolver::token_for_window(state.inner(), window).unwrap_or_default();
    let actor_ptid = session_resolver::ptid_for_window(state.inner(), window).unwrap_or_default();
    if token.trim().is_empty() || !actor_ptid.starts_with("ptid:") {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok((actor_ptid, token))
}

#[tauri::command]
pub fn mcp_list_servers(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    match authenticated_actor(&state, &window) {
        Ok((actor_ptid, token)) => application_mcp::mcp_station_list_servers(&actor_ptid, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn mcp_get_server(
    input: McpNameInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    match authenticated_actor(&state, &window) {
        Ok((actor_ptid, token)) => {
            application_mcp::mcp_station_get_server(&actor_ptid, &token, input)
        }
        Err(error) => error,
    }
}

#[tauri::command]
pub fn mcp_create_server(
    input: McpCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (actor_ptid, token) = match authenticated_actor(&state, &window) {
        Ok(identity) => identity,
        Err(error) => return error,
    };
    application_mcp::mcp_station_create_server(&actor_ptid, &token, input)
}

#[tauri::command]
pub fn mcp_update_server(
    input: McpUpdateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (actor_ptid, token) = match authenticated_actor(&state, &window) {
        Ok(identity) => identity,
        Err(error) => return error,
    };
    application_mcp::mcp_station_update_server(&actor_ptid, &token, input)
}

#[tauri::command]
pub fn mcp_delete_server(
    input: McpNameInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (actor_ptid, token) = match authenticated_actor(&state, &window) {
        Ok(identity) => identity,
        Err(error) => return error,
    };
    application_mcp::mcp_station_delete_server(&actor_ptid, &token, input)
}

#[tauri::command]
pub fn mcp_toggle_server(
    input: McpToggleInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (actor_ptid, token) = match authenticated_actor(&state, &window) {
        Ok(identity) => identity,
        Err(error) => return error,
    };
    application_mcp::mcp_station_toggle_server(&actor_ptid, &token, input)
}

#[tauri::command]
pub fn mcp_refresh_server(
    input: McpNameInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (actor_ptid, token) = match authenticated_actor(&state, &window) {
        Ok(identity) => identity,
        Err(error) => return error,
    };
    application_mcp::mcp_station_refresh_server(&actor_ptid, &token, input)
}

#[tauri::command]
pub fn agent_capability_operation_get(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_actor(&state, &window) {
        Ok((_, token)) => capability_authority::get_operation(input, &token),
        Err(error) => AppResult {
            ok: error.ok,
            data: None,
            error: error.error,
        },
    }
}

#[tauri::command]
pub fn agent_capability_operation_cancel(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_actor(&state, &window) {
        Ok((_, token)) => capability_authority::cancel_operation(input, &token),
        Err(error) => AppResult {
            ok: error.ok,
            data: None,
            error: error.error,
        },
    }
}

#[tauri::command]
pub fn agent_capability_operation_reconcile(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_actor(&state, &window) {
        Ok((_, token)) => capability_authority::reconcile_operation(input, &token),
        Err(error) => AppResult {
            ok: error.ok,
            data: None,
            error: error.error,
        },
    }
}

#[tauri::command]
pub fn agent_capability_operation_takeover(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_actor(&state, &window) {
        Ok((_, token)) => capability_authority::take_over_operation(input, &token),
        Err(error) => AppResult {
            ok: error.ok,
            data: None,
            error: error.error,
        },
    }
}

#[tauri::command]
pub fn agent_capability_operation_cleanup_takeover(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_actor(&state, &window) {
        Ok((_, token)) => capability_authority::take_over_operation_cleanup(input, &token),
        Err(error) => AppResult {
            ok: error.ok,
            data: None,
            error: error.error,
        },
    }
}
