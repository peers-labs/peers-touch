use serde::Deserialize;
use std::sync::Arc;
use tauri::{State, Window};

use crate::application::auth::service as auth_service;
use crate::application::session_resolver;
use crate::application::station_binding::{self, StationBindingError};
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_discovery::{self, StationDiscoveryError};
use crate::infrastructure::station_registry::StationEntry;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct StationDiscoveryInput {
    pub input: String,
}

#[derive(Debug, Deserialize)]
pub struct StationSelectionInput {
    pub station_peer_id: String,
    #[serde(default)]
    pub route_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StationIdentityInput {
    pub station_peer_id: String,
}

#[tauri::command]
pub fn station_list(state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let registry = state.station.registry();
    let binding_service = state.station.binding();
    let binding = binding_service.state();
    let active_station_peer_id = binding.station_peer_id.clone();
    station_list_result(registry.list(), active_station_peer_id, binding)
}

fn station_list_result(
    entries: Vec<StationEntry>,
    active_station_peer_id: Option<String>,
    binding: station_binding::StationBindingState,
) -> AppResult<StubPayload> {
    let payload = serde_json::json!({
        "entries": entries,
        "active_station_peer_id": active_station_peer_id,
        "binding": binding,
    });
    AppResult::success(StubPayload {
        command: "station_list".to_string(),
        status: serde_json::to_string(&payload).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn station_set_active(
    input: StationSelectionInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    station_set_active_with_state(input, state.inner())
}

pub(crate) fn station_set_active_with_state(
    input: StationSelectionInput,
    state: &AppState,
) -> AppResult<StubPayload> {
    let station_peer_id = input.station_peer_id.trim();
    if station_peer_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "station_peer_id is required",
            None,
        );
    }
    let _transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    let binding = match state.station.switch_station_with_teardown(
        station_peer_id,
        input.route_id.as_deref(),
        &|station_changed| {
            if !station_changed {
                return Ok(());
            }
            auth_service::detach_for_station_switch(state).map_err(|error| {
                StationBindingError::new(
                    "station_session_clear_failed",
                    error
                        .error
                        .map(|error| error.message)
                        .unwrap_or_else(|| "Station session cleanup failed".to_string()),
                    true,
                )
            })?;
            Ok(())
        },
    ) {
        Ok(binding) => binding,
        Err(error) => return binding_error(error),
    };
    let payload = serde_json::json!({
        "active_station_peer_id": binding.station_peer_id,
        "active_route_id": binding.active_route_id,
        "binding": binding,
    });
    AppResult::success(StubPayload {
        command: "station_set_active".to_string(),
        status: serde_json::to_string(&payload).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn station_binding_complete(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    station_binding_complete_authenticated(
        state.inner(),
        session_resolver::token_for_window(&state, &window).is_some(),
    )
}

pub(crate) fn station_binding_complete_authenticated(
    state: &AppState,
    authenticated: bool,
) -> AppResult<StubPayload> {
    if !authenticated {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            Some(serde_json::json!({ "code": "station_authentication_required" })),
        );
    }
    if let Err(error) = state.station.resume_persisted() {
        return binding_error(error);
    }
    let binding = match state.station.binding().mark_bound() {
        Ok(binding) => binding,
        Err(error) => return binding_error(error),
    };
    AppResult::success(StubPayload {
        command: "station_binding_complete".to_string(),
        status: serde_json::to_string(&binding).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn station_add(
    input: StationDiscoveryInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    station_add_with_state(input, state.inner())
}

pub(crate) fn station_add_with_state(
    input: StationDiscoveryInput,
    state: &AppState,
) -> AppResult<StubPayload> {
    discover_and_store("station_add", &input.input, state)
}

#[tauri::command]
pub fn station_probe(
    input: StationDiscoveryInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    station_probe_with_state(input, state.inner())
}

pub(crate) fn station_probe_with_state(
    input: StationDiscoveryInput,
    state: &AppState,
) -> AppResult<StubPayload> {
    discover_and_store("station_probe", &input.input, state)
}

fn discover_and_store(command: &str, input: &str, state: &AppState) -> AppResult<StubPayload> {
    if input.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "input is required", None);
    }
    let identity_scope = match station_discovery::discovery_identity_scope(input) {
        Ok(scope) => scope,
        Err(error) => return discovery_error(error),
    };
    let source_peer_id = match state.station.prepare_transport_identity(identity_scope) {
        Ok(peer_id) => peer_id,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Could not prepare the scoped Station transport identity",
                Some(serde_json::json!({
                    "code": "station_discovery_unavailable",
                    "reason": error,
                })),
            )
        }
    };
    let endpoint = match station_discovery::discover_station_input(input, source_peer_id) {
        Ok(endpoint) => endpoint,
        Err(error) => return discovery_error(error),
    };
    let entries = match state.station.store_verified_routes(&endpoint.routes) {
        Ok(entries) => entries,
        Err(error) => return binding_error(error),
    };
    let payload = serde_json::json!({
        "role": endpoint.role,
        "endpoint_peer_id": endpoint.endpoint_peer_id,
        "canonical_origin": endpoint.canonical_origin,
        "entries": entries,
    });
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: serde_json::to_string(&payload).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn station_remove(
    input: StationIdentityInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    station_remove_with_state(input, state.inner())
}

pub(crate) fn station_remove_with_state(
    input: StationIdentityInput,
    state: &AppState,
) -> AppResult<StubPayload> {
    let station_peer_id = input.station_peer_id.trim();
    if station_peer_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "station_peer_id is required",
            None,
        );
    }
    let _transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    let removing_active =
        state.station.binding().state().station_peer_id.as_deref() == Some(station_peer_id);
    if removing_active {
        if let Err(error) = auth_service::detach_for_station_switch(state) {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Could not clear the Station session before removal",
                error.error.map(|error| {
                    serde_json::json!({
                        "code": "station_session_clear_failed",
                        "reason": error.message,
                    })
                }),
            );
        }
    }
    let (binding, was_selected) = match state.station.remove_station(station_peer_id) {
        Ok(result) => result,
        Err(error) => return binding_error(error),
    };
    let payload = serde_json::json!({
        "removed_station_peer_id": station_peer_id,
        "was_selected": was_selected,
        "binding": binding,
    });
    AppResult::success(StubPayload {
        command: "station_remove".to_string(),
        status: serde_json::to_string(&payload).unwrap_or_default(),
    })
}

fn discovery_error(error: StationDiscoveryError) -> AppResult<StubPayload> {
    let code = match error.code {
        "station_unreachable" | "station_discovery_unavailable" => ErrorCode::InternalError,
        "station_no_candidates" => ErrorCode::NotFound,
        "station_connection_grant_expired"
        | "station_connection_grant_replayed"
        | "station_connection_grant_wrong_relay"
        | "station_discovery_rejected"
        | "station_route_invalid" => ErrorCode::Forbidden,
        _ => ErrorCode::InvalidArgument,
    };
    AppResult::fail(
        code,
        error.message,
        Some(serde_json::json!({
            "code": error.code,
            "retryable": error.retryable,
        })),
    )
}

fn binding_error(error: StationBindingError) -> AppResult<StubPayload> {
    let code = match error.code.as_str() {
        "station_unselected" => ErrorCode::InvalidArgument,
        "station_not_registered" | "station_route_unavailable" => ErrorCode::NotFound,
        "station_switch_in_progress" | "station_selection_changed" => ErrorCode::Conflict,
        _ => ErrorCode::InternalError,
    };
    AppResult::fail(
        code,
        error.message,
        Some(serde_json::json!({
            "code": error.code,
            "retryable": error.retryable,
        })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn station_binding_complete_requires_authenticated_session() {
        let config_dir =
            std::env::temp_dir().join(format!("station-binding-auth-test-{}", std::process::id()));
        let station = crate::application::station_runtime::StationRuntime::start(&config_dir)
            .expect("test Station runtime");
        let layout =
            crate::infrastructure::storage::initialize_app_storage("test").expect("test storage");
        let i18n = crate::infrastructure::i18n::I18nService::new(&config_dir);
        let state = AppState::new(layout, i18n, station);
        let result = station_binding_complete_authenticated(&state, false);
        assert!(!result.ok);
        assert_eq!(
            result.error.map(|error| error.code),
            Some(ErrorCode::Unauthorized)
        );
    }
}
