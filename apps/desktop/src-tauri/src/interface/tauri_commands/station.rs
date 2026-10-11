// Station registry tauri commands — dynamic URL picker for testnet/multi-node setups.

use serde::Deserialize;
use std::sync::Arc;
use tauri::{State, Window};

use crate::application::auth::service as auth_service;
use crate::application::session_resolver;
use crate::application::station_binding::{self, StationBindingError};
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::infrastructure::station_registry::{normalize_station_url, StationEntry};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct StationUrlInput {
    pub url: String,
}

#[tauri::command]
pub fn station_list() -> AppResult<StubPayload> {
    let reg = station_client::station_registry();
    let entries = reg.list();
    let active = reg.active_url();
    let payload = serde_json::json!({
        "entries": entries,
        "active_url": active,
        "binding": station_binding::service().state(),
    });
    AppResult::success(StubPayload {
        command: "station_list".to_string(),
        status: serde_json::to_string(&payload).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn station_set_active(
    input: StationUrlInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    station_set_active_with_state(input, state.inner())
}

pub(crate) fn station_set_active_with_state(
    input: StationUrlInput,
    state: &AppState,
) -> AppResult<StubPayload> {
    let requested_url = normalize_station_url(&input.url);
    if requested_url.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "url is required", None);
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
    let selection_changes = binding_service.selection_changes(registry, &requested_url);
    if selection_changes {
        if let Err(error) = state.secure_content.shutdown() {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Could not fence Secure Content before switching Station",
                Some(serde_json::json!({
                    "code": "station_secure_content_fence_failed",
                    "reason": error,
                })),
            );
        }
    }
    let binding = match binding_service.switch(registry, &requested_url) {
        Ok(binding) => binding,
        Err(error) => return binding_error(error),
    };
    if selection_changes {
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
        "active_url": binding.selected_url,
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
pub fn station_add(input: StationUrlInput) -> AppResult<StubPayload> {
    let url = normalize_station_url(&input.url);
    if url.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "url is required", None);
    }
    let (online, label, peer_id, peers_count) = station_client::probe_station(&url);
    let now = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string());
    let entry = StationEntry {
        url,
        label,
        peer_id,
        peers_count,
        last_probe: Some(now),
        online,
    };
    let reg = station_client::station_registry();
    if let Err(error) = reg.add(entry.clone()) {
        return registry_error("station_add", error);
    }
    // Auto-select a reachable Station when the user has no active one yet.
    // Run it through the binding switch (not just registry.set_active) so the
    // identity handshake completes and the login gate reaches AccessGate;
    // otherwise the Station is reachable-but-unverified and login stays stuck.
    let mut binding = station_binding::service().state();
    if online && reg.active_url().is_none() {
        match station_binding::service().switch(reg, &entry.url) {
            Ok(switched) => binding = switched,
            Err(error) => {
                tracing::warn!(url = %entry.url, error = %error.message,
                    "failed to auto-verify added Station");
            }
        }
    }
    let payload = serde_json::json!({
        "entry": entry,
        "active_url": binding.bound_url,
        "binding": binding,
    });
    AppResult::success(StubPayload {
        command: "station_add".to_string(),
        status: serde_json::to_string(&payload).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn station_remove(
    input: StationUrlInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    station_remove_with_state(input, state.inner())
}

pub(crate) fn station_remove_with_state(
    input: StationUrlInput,
    state: &AppState,
) -> AppResult<StubPayload> {
    let url = normalize_station_url(&input.url);
    if url.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "url is required", None);
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
    let removing_active = registry.active_url().is_some_and(|active| active == url);
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
    let (binding, was_selected) = match station_binding::service().remove_station(registry, &url) {
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
        "removed": url,
        "was_selected": was_selected,
        "binding": binding,
    });
    AppResult::success(StubPayload {
        command: "station_remove".to_string(),
        status: serde_json::to_string(&payload).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn station_probe(input: StationUrlInput) -> AppResult<StubPayload> {
    let url = normalize_station_url(&input.url);
    if url.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "url is required", None);
    }
    let (online, label, peer_id, peers_count) = station_client::probe_station(&url);
    let reg = station_client::station_registry();
    if let Err(error) = reg.update_probe(&url, label.clone(), peer_id.clone(), peers_count, online)
    {
        return registry_error("station_probe", error);
    }
    let payload = serde_json::json!({
        "url": url,
        "online": online,
        "label": label,
        "peer_id": peer_id,
        "peers_count": peers_count,
    });
    AppResult::success(StubPayload {
        command: "station_probe".to_string(),
        status: serde_json::to_string(&payload).unwrap_or_default(),
    })
}

fn registry_error(command: &str, error: std::io::Error) -> AppResult<StubPayload> {
    let code = match error.kind() {
        std::io::ErrorKind::InvalidInput => ErrorCode::InvalidArgument,
        std::io::ErrorKind::NotFound => ErrorCode::NotFound,
        _ => ErrorCode::InternalError,
    };
    AppResult::fail(
        code,
        format!("{command} could not persist the Station selection"),
        Some(serde_json::json!({
            "code": "station_registry_persist_failed",
            "reason": error.kind().to_string(),
        })),
    )
}

fn binding_error(error: StationBindingError) -> AppResult<StubPayload> {
    let code = match error.code.as_str() {
        "station_unselected" => ErrorCode::InvalidArgument,
        "station_not_registered" => ErrorCode::NotFound,
        "station_switch_in_progress" => ErrorCode::Conflict,
        _ => ErrorCode::InternalError,
    };
    AppResult::fail(
        code,
        error.message.clone(),
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
