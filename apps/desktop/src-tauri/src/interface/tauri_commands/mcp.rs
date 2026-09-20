use std::sync::Arc;

use prost::Message;
use tauri::{State, Window};

use crate::application::capability_authority::{self, EncodedRequestInput};
use crate::application::desktop_executor_worker::CapabilityWorkerSupervisor;
use crate::application::mcp as application_mcp;
use crate::application::session_resolver;
use crate::contracts::{
    McpCreateInput, McpLifecycleOperationInput, McpNameInput, McpToggleInput, McpUpdateInput,
    StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::model::agent::{
    CancelCapabilityOperationRequest, TakeOverCapabilityCleanupRequest,
    TakeOverCapabilityOperationRequest,
};
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

fn authenticated_operation_actor(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<(String, String), AppResult<Vec<u8>>> {
    authenticated_actor(state, window).map_err(|error| AppResult {
        ok: error.ok,
        data: None,
        error: error.error,
    })
}

fn start_lifecycle(
    actor_ptid: &str,
    token: &str,
    supervisor: &CapabilityWorkerSupervisor,
    input: McpLifecycleOperationInput,
) -> AppResult<Vec<u8>> {
    let target = match supervisor.operation_target(actor_ptid) {
        Ok(target) => target,
        Err(error) => {
            return AppResult::fail(ErrorCode::InvalidArgument, error, None);
        }
    };
    application_mcp::mcp_start_lifecycle_operation(
        actor_ptid,
        token,
        &target.device_id,
        &target.capability_session_id,
        input,
    )
}

#[tauri::command]
pub fn mcp_list_servers(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    match authenticated_actor(&state, &window) {
        Ok((actor_ptid, _)) => application_mcp::mcp_list_servers(&actor_ptid),
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
        Ok((actor_ptid, _)) => application_mcp::mcp_get_server(&actor_ptid, input),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn mcp_create_server(
    input: McpCreateInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let (actor_ptid, token) = match authenticated_operation_actor(&state, &window) {
        Ok(identity) => identity,
        Err(error) => return error,
    };
    let target = match supervisor.operation_target(&actor_ptid) {
        Ok(target) => target,
        Err(error) => {
            return AppResult::fail(ErrorCode::InvalidArgument, error, None);
        }
    };
    application_mcp::mcp_create_server_with_lifecycle(
        &actor_ptid,
        &token,
        &target.device_id,
        &target.capability_session_id,
        input,
    )
}

#[tauri::command]
pub fn mcp_update_server(
    input: McpUpdateInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let (actor_ptid, token) = match authenticated_operation_actor(&state, &window) {
        Ok(identity) => identity,
        Err(error) => return error,
    };
    let target = match supervisor.operation_target(&actor_ptid) {
        Ok(target) => target,
        Err(error) => {
            return AppResult::fail(ErrorCode::InvalidArgument, error, None);
        }
    };
    application_mcp::mcp_update_server_with_lifecycle(
        &actor_ptid,
        &token,
        &target.device_id,
        &target.capability_session_id,
        input,
    )
}

#[tauri::command]
pub fn mcp_delete_server(
    input: McpNameInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let (actor_ptid, token) = match authenticated_operation_actor(&state, &window) {
        Ok(identity) => identity,
        Err(error) => return error,
    };
    start_lifecycle(
        &actor_ptid,
        &token,
        &supervisor,
        McpLifecycleOperationInput {
            name: input.name,
            operation_kind: "uninstall".to_string(),
            idempotency_key: None,
        },
    )
}

#[tauri::command]
pub fn mcp_toggle_server(
    input: McpToggleInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let (actor_ptid, token) = match authenticated_operation_actor(&state, &window) {
        Ok(identity) => identity,
        Err(error) => return error,
    };
    let target = match supervisor.operation_target(&actor_ptid) {
        Ok(target) => target,
        Err(error) => {
            return AppResult::fail(ErrorCode::InvalidArgument, error, None);
        }
    };
    application_mcp::mcp_toggle_server_with_lifecycle(
        &actor_ptid,
        &token,
        &target.device_id,
        &target.capability_session_id,
        input,
    )
}

#[tauri::command]
pub fn mcp_start_lifecycle_operation(
    input: McpLifecycleOperationInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let (actor_ptid, token) = match authenticated_operation_actor(&state, &window) {
        Ok(identity) => identity,
        Err(error) => return error,
    };
    start_lifecycle(&actor_ptid, &token, &supervisor, input)
}

#[tauri::command]
pub fn agent_capability_operation_get(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_operation_actor(&state, &window) {
        Ok((_, token)) => capability_authority::get_operation(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_capability_operation_cancel(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let request = match CancelCapabilityOperationRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "agent.capabilityOperationRequestInvalid",
                None,
            );
        }
    };
    match authenticated_operation_actor(&state, &window) {
        Ok((_, token)) => {
            let result = capability_authority::cancel_operation(input, &token);
            if result.ok {
                if let Err(error) =
                    application_mcp::cancel_lifecycle_operation(&request.operation_id)
                {
                    tracing::warn!(
                        operation_id = %request.operation_id,
                        error = %error,
                        "Failed to interrupt cancelled MCP lifecycle process"
                    );
                }
            }
            result
        }
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_capability_operation_reconcile(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_operation_actor(&state, &window) {
        Ok((_, token)) => capability_authority::reconcile_operation(input, &token),
        Err(error) => error,
    }
}

#[tauri::command]
pub fn agent_capability_operation_takeover(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let (actor_ptid, _) = match authenticated_operation_actor(&state, &window) {
        Ok(identity) => identity,
        Err(error) => return error,
    };
    let request = match TakeOverCapabilityOperationRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "agent.capabilityOperationRequestInvalid",
                None,
            );
        }
    };
    match supervisor.take_over_operation(&actor_ptid, request) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => AppResult::fail(ErrorCode::InternalError, error, None),
    }
}

#[tauri::command]
pub fn agent_capability_operation_cleanup_takeover(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let (actor_ptid, _) = match authenticated_operation_actor(&state, &window) {
        Ok(identity) => identity,
        Err(error) => return error,
    };
    let request = match TakeOverCapabilityCleanupRequest::decode(input.request_bytes.as_slice()) {
        Ok(request) => request,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "agent.capabilityOperationRequestInvalid",
                None,
            );
        }
    };
    match supervisor.take_over_cleanup(&actor_ptid, request) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(error) => AppResult::fail(ErrorCode::InternalError, error, None),
    }
}
