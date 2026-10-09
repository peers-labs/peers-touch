use serde::Deserialize;
use std::sync::Arc;
use tauri::{State, Window};

use crate::application::auth::service as auth_service;
use crate::application::session_resolver;
use crate::application::station_binding::{self, StationBindingError};
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
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
pub fn station_list() -> AppResult<StubPayload> {
    let registry = station_client::station_registry();
    station_list_result(
        registry.list(),
        registry.active_station_peer_id(),
        station_binding::service().state(),
    )
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
    let registry = station_client::station_registry();
    let binding_service = station_binding::service();
    let station_changes = binding_service.station_changes(registry, station_peer_id);
    let route_changes =
        binding_service.route_changes(registry, station_peer_id, input.route_id.as_deref());
    if route_changes {
        if let Err(error) = state.secure_content.shutdown() {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Could not fence Secure Content before switching Station route",
                Some(serde_json::json!({
                    "code": "station_secure_content_fence_failed",
                    "reason": error,
                })),
            );
        }
    }
    let binding = match binding_service.switch(registry, station_peer_id, input.route_id.as_deref())
    {
        Ok(binding) => binding,
        Err(error) => return binding_error(error),
    };
    if station_changes {
        if let Err(error) = auth_service::detach_for_station_switch(state) {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Could not clear the previous Station session",
                error.error.map(|error| {
                    serde_json::json!({
                        "code": "station_session_clear_failed",
                        "reason": error.message,
                    })
                }),
            );
        }
    }
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
        session_resolver::token_for_window(&state, &window).is_some(),
    )
}

pub(crate) fn station_binding_complete_authenticated(
    authenticated: bool,
) -> AppResult<StubPayload> {
    if !authenticated {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            Some(serde_json::json!({ "code": "station_authentication_required" })),
        );
    }
    if let Err(error) =
        station_binding::service().resume_persisted(station_client::station_registry())
    {
        return binding_error(error);
    }
    let binding = match station_binding::service().mark_bound() {
        Ok(binding) => binding,
        Err(error) => return binding_error(error),
    };
    AppResult::success(StubPayload {
        command: "station_binding_complete".to_string(),
        status: serde_json::to_string(&binding).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn station_add(input: StationDiscoveryInput) -> AppResult<StubPayload> {
    discover_and_store("station_add", &input.input)
}

#[tauri::command]
pub fn station_probe(input: StationDiscoveryInput) -> AppResult<StubPayload> {
    discover_and_store("station_probe", &input.input)
}

fn discover_and_store(command: &str, input: &str) -> AppResult<StubPayload> {
    if input.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "input is required", None);
    }
    let endpoint = match station_discovery::discover_station_input(input) {
        Ok(endpoint) => endpoint,
        Err(error) => return discovery_error(error),
    };
    let registry = station_client::station_registry();
    let mut entries = Vec::with_capacity(endpoint.routes.len());
    for route in &endpoint.routes {
        match registry.upsert_verified_route(route, None) {
            Ok(entry) => entries.push(entry),
            Err(error) => return registry_error(command, error),
        }
    }
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
    let registry = station_client::station_registry();
    let removing_active = registry.active_station_peer_id().as_deref() == Some(station_peer_id);
    if removing_active {
        if let Err(error) = state.secure_content.shutdown() {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Could not fence Secure Content before removing Station",
                Some(serde_json::json!({
                    "code": "station_secure_content_fence_failed",
                    "reason": error,
                })),
            );
        }
    }
    let (binding, was_selected) =
        match station_binding::service().remove_station(registry, station_peer_id) {
            Ok(result) => result,
            Err(error) => return binding_error(error),
        };
    if was_selected {
        if let Err(error) = auth_service::detach_for_station_switch(state) {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Could not clear the previous Station session",
                error.error.map(|error| {
                    serde_json::json!({
                        "code": "station_session_clear_failed",
                        "reason": error.message,
                    })
                }),
            );
        }
    }
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

fn registry_error(command: &str, error: std::io::Error) -> AppResult<StubPayload> {
    let code = match error.kind() {
        std::io::ErrorKind::InvalidInput => ErrorCode::InvalidArgument,
        std::io::ErrorKind::NotFound => ErrorCode::NotFound,
        std::io::ErrorKind::PermissionDenied => ErrorCode::Forbidden,
        _ => ErrorCode::InternalError,
    };
    AppResult::fail(
        code,
        format!("{command} could not persist the Station binding"),
        Some(serde_json::json!({
            "code": "station_registry_persist_failed",
            "reason": error.kind().to_string(),
        })),
    )
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
        let result = station_binding_complete_authenticated(false);
        assert!(!result.ok);
        assert_eq!(
            result.error.map(|error| error.code),
            Some(ErrorCode::Unauthorized)
        );
    }
}
