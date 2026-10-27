use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use x_config_core::XConfigError;

use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_discovery;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct XConfigRefreshInput {
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Deserialize)]
pub struct XConfigSuggestionInput {
    pub seed_id: String,
}

#[tauri::command]
pub fn x_config_projection(state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    projection_result("x_config_projection", state.x_config.projection())
}

#[tauri::command]
pub async fn x_config_refresh(
    input: XConfigRefreshInput,
    app: AppHandle,
) -> AppResult<StubPayload> {
    let state = Arc::clone(app.state::<Arc<AppState>>().inner());
    match tauri::async_runtime::spawn_blocking(move || state.x_config.refresh(input.force)).await {
        Ok(result) => projection_result("x_config_refresh", result),
        Err(error) => AppResult::fail(
            ErrorCode::InternalError,
            "X Config refresh task failed",
            Some(serde_json::json!({
                "code": "x_config_refresh_task",
                "reason": error.to_string(),
            })),
        ),
    }
}

#[tauri::command]
pub async fn x_config_discover_suggestion(
    input: XConfigSuggestionInput,
    app: AppHandle,
) -> AppResult<StubPayload> {
    let seed_id = input.seed_id.trim().to_string();
    if seed_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "seed_id is required",
            Some(serde_json::json!({ "code": "x_config_seed_id" })),
        );
    }
    let state = Arc::clone(app.state::<Arc<AppState>>().inner());
    match tauri::async_runtime::spawn_blocking(move || {
        let material = state.x_config.suggestion_material(&seed_id)?;
        let endpoint =
            station_discovery::discover_station_public_material(&material, |scope, message| {
                state
                    .station
                    .sign_transport_identity_proof(scope, message)
                    .map(|proof| (proof.public_key, proof.signature))
            })
            .map_err(DiscoveryFailure::Station)?;
        let entries = state
            .station
            .store_verified_routes(&endpoint.routes)
            .map_err(DiscoveryFailure::Binding)?;
        Ok::<_, DiscoveryFailure>((endpoint, entries))
    })
    .await
    {
        Ok(Ok((endpoint, entries))) => AppResult::success(StubPayload {
            command: "x_config_discover_suggestion".to_string(),
            status: serde_json::json!({
                "role": endpoint.role,
                "endpoint_peer_id": endpoint.endpoint_peer_id,
                "canonical_origin": endpoint.canonical_origin,
                "entries": entries,
            })
            .to_string(),
        }),
        Ok(Err(DiscoveryFailure::XConfig(error))) => {
            x_config_error("x_config_discover_suggestion", error)
        }
        Ok(Err(DiscoveryFailure::Station(error))) => {
            crate::interface::tauri_commands::station::discovery_error(error)
        }
        Ok(Err(DiscoveryFailure::Binding(error))) => {
            crate::interface::tauri_commands::station::binding_error(error)
        }
        Err(error) => AppResult::fail(
            ErrorCode::InternalError,
            "X Config discovery task failed",
            Some(serde_json::json!({
                "code": "x_config_discovery_task",
                "reason": error.to_string(),
            })),
        ),
    }
}

enum DiscoveryFailure {
    XConfig(XConfigError),
    Station(station_discovery::StationDiscoveryError),
    Binding(crate::application::station_binding::StationBindingError),
}

impl From<XConfigError> for DiscoveryFailure {
    fn from(error: XConfigError) -> Self {
        Self::XConfig(error)
    }
}

fn projection_result(
    command: &str,
    result: Result<crate::application::x_config::XConfigProjection, XConfigError>,
) -> AppResult<StubPayload> {
    match result {
        Ok(projection) => AppResult::success(StubPayload {
            command: command.to_string(),
            status: serde_json::to_string(&projection).unwrap_or_default(),
        }),
        Err(error) => x_config_error(command, error),
    }
}

fn x_config_error(command: &str, error: XConfigError) -> AppResult<StubPayload> {
    let code = match error.code {
        "x_config_suggestion_not_found" => ErrorCode::NotFound,
        "x_config_suggestion_not_actionable" => ErrorCode::Conflict,
        _ => ErrorCode::InternalError,
    };
    AppResult::fail(
        code,
        "X Config is unavailable",
        Some(serde_json::json!({
            "command": command,
            "code": error.code,
        })),
    )
}
