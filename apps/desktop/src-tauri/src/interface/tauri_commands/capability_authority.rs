use std::sync::Arc;

use prost::Message;
use tauri::{AppHandle, Manager, State, Window};

use crate::application::capability_authority::{
    self, CapabilityBindingDeleteInput, CapabilityBindingListInput, CapabilityBindingUpsertInput,
    CapabilityManifestListInput, CapabilityReadinessInput, EncodedRequestInput,
};
#[cfg(feature = "acceptance-webdriver")]
use crate::application::desktop_executor_worker::CapabilityWorkerSupervisor;
use crate::application::session_resolver;
use crate::error::{AppResult, ErrorCode};
#[cfg(feature = "acceptance-webdriver")]
use crate::model::agent::{
    ArmCapabilityAcceptanceExecutorHookRequest, ArmCapabilityAcceptanceExecutorHookResponse,
    CleanupCapabilityAcceptanceScenarioRequest,
};
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

#[cfg(feature = "acceptance-webdriver")]
fn authenticated_actor_and_token(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<(String, String), AppResult<Vec<u8>>> {
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
pub async fn agent_capability_binding_upsert(
    input: CapabilityBindingUpsertInput,
    app: AppHandle,
    window: Window,
) -> AppResult<Vec<u8>> {
    let state: Arc<AppState> = app.state::<Arc<AppState>>().inner().clone();
    let token = session_resolver::token_for_window(&state, &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    match tauri::async_runtime::spawn_blocking(move || {
        capability_authority::upsert_binding(input, &token)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => AppResult::fail(
            ErrorCode::InternalError,
            "agent.capabilityBindingUpsertFailed",
            Some(serde_json::json!({ "reason": error.to_string() })),
        ),
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

#[cfg(feature = "acceptance-webdriver")]
#[tauri::command]
pub fn agent_capability_acceptance_scenario_prepare(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::prepare_acceptance_scenario(input, &token),
        Err(error) => error,
    }
}

#[cfg(feature = "acceptance-webdriver")]
#[tauri::command]
pub fn agent_capability_acceptance_scenario_arm(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let request =
        match ArmCapabilityAcceptanceExecutorHookRequest::decode(input.request_bytes.as_slice()) {
            Ok(request) => request,
            Err(_) => {
                return AppResult::fail(
                    ErrorCode::InvalidArgument,
                    "agent.capabilityAcceptanceScenarioRequestInvalid",
                    None,
                )
            }
        };
    let (actor_ptid, token) = match authenticated_actor_and_token(&state, &window) {
        Ok(identity) => identity,
        Err(error) => return error,
    };
    let response = capability_authority::arm_acceptance_scenario_hook(input, &token);
    if !response.ok {
        return response;
    }
    let Some(response_bytes) = response.data.as_ref() else {
        return AppResult::fail(
            ErrorCode::InternalError,
            "agent.capabilityAcceptanceScenarioArmFailed",
            None,
        );
    };
    let armed = match ArmCapabilityAcceptanceExecutorHookResponse::decode(response_bytes.as_slice())
    {
        Ok(armed) => armed,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "agent.capabilityAcceptanceScenarioArmFailed",
                None,
            )
        }
    };
    if let Err(error) = supervisor.arm_acceptance_hook(
        &actor_ptid,
        &armed.scenario_handle,
        &armed.barrier,
        armed.family,
    ) {
        let _ = capability_authority::cleanup_acceptance_scenario(
            EncodedRequestInput {
                request_bytes: CleanupCapabilityAcceptanceScenarioRequest {
                    scenario_handle: request.scenario_handle,
                }
                .encode_to_vec(),
            },
            &token,
        );
        return AppResult::fail(ErrorCode::Conflict, error, None);
    }
    response
}

#[cfg(feature = "acceptance-webdriver")]
#[tauri::command]
pub async fn agent_capability_acceptance_scenario_wait(
    input: EncodedRequestInput,
    app: AppHandle,
    window: Window,
) -> AppResult<Vec<u8>> {
    let state: Arc<AppState> = app.state::<Arc<AppState>>().inner().clone();
    let token = session_resolver::token_for_window(&state, &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    match tauri::async_runtime::spawn_blocking(move || {
        capability_authority::wait_acceptance_scenario_barrier(input, &token)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => AppResult::fail(
            ErrorCode::InternalError,
            "agent.capabilityAcceptanceScenarioWaitFailed",
            Some(serde_json::json!({ "reason": error.to_string() })),
        ),
    }
}

#[cfg(feature = "acceptance-webdriver")]
#[tauri::command]
pub fn agent_capability_acceptance_scenario_release(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::release_acceptance_scenario_barrier(input, &token),
        Err(error) => error,
    }
}

#[cfg(feature = "acceptance-webdriver")]
#[tauri::command]
pub fn agent_capability_acceptance_scenario_clock_advance(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::advance_acceptance_scenario_clock(input, &token),
        Err(error) => error,
    }
}

#[cfg(feature = "acceptance-webdriver")]
#[tauri::command]
pub fn agent_capability_acceptance_scenario_interrupt(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    match authenticated_token(&state, &window) {
        Ok(token) => capability_authority::interrupt_acceptance_scenario_worker(input, &token),
        Err(error) => error,
    }
}

#[cfg(feature = "acceptance-webdriver")]
#[tauri::command]
pub fn agent_capability_acceptance_scenario_cleanup(
    input: EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let request =
        match CleanupCapabilityAcceptanceScenarioRequest::decode(input.request_bytes.as_slice()) {
            Ok(request) => request,
            Err(_) => {
                return AppResult::fail(
                    ErrorCode::InvalidArgument,
                    "agent.capabilityAcceptanceScenarioRequestInvalid",
                    None,
                )
            }
        };
    let (actor_ptid, token) = match authenticated_actor_and_token(&state, &window) {
        Ok(identity) => identity,
        Err(error) => return error,
    };
    let response = capability_authority::cleanup_acceptance_scenario(input, &token);
    if !response.ok {
        return response;
    }
    if let Err(error) = supervisor.clear_acceptance_hook(&actor_ptid, &request.scenario_handle) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    response
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
