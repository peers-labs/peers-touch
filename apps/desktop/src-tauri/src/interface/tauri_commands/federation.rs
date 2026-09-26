// Tauri command shim — federation API (Tier A1).
//
// Read-only commands return `AppResult<Vec<u8>>` so the TS side decodes
// generated protobuf responses without exposing governance controls.
//
// Each shim:
//   1. Resolves the per-window auth token (when required) — health is
//      the lone public endpoint and skips this step.
//   2. Delegates to `application::federation` for the actual station
//      call.
//   3. Encodes the typed proto into bytes for the Tauri bridge.
//   4. Maps any gateway error into `AppResult::fail` with a stable
//      `ErrorCode`, preserving the typed Station error payload.

use std::sync::Arc;

use tauri::{State, Window};

use crate::application::federation;
use crate::application::session_resolver;
use crate::contracts::{FederationCatalogSearchInput, FederationResolveInput};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::state::AppState;

/// Resolve the per-window bearer token, returning a typed-bytes
/// `AppResult` failure when the window has no active session.
fn token_or_unauthorized(
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
pub fn federation_resolve(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: FederationResolveInput,
) -> AppResult<Vec<u8>> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(t) => t,
        Err(err) => return err,
    };
    match federation::resolve(&token, &input.federation_id, &input.handle) {
        Ok(view) => AppResult::success(federation::encode_resolve(&view)),
        Err(e) => e.into_app_result_proto("federation_resolve failed"),
    }
}

fn map_station_error(err: station_client::StationClientError, context: &str) -> AppResult<Vec<u8>> {
    err.into_app_result(context)
}

#[tauri::command]
pub fn federation_catalog_search(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: FederationCatalogSearchInput,
) -> AppResult<Vec<u8>> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(t) => t,
        Err(err) => return err,
    };
    match federation::catalog_search(
        &token,
        &input.federation_id,
        &input.prefix,
        input.station_id.as_deref(),
        input.page_size,
    ) {
        Ok(view) => AppResult::success(federation::encode_catalog_search(&view)),
        Err(e) => e.into_app_result_proto("federation_catalog_search failed"),
    }
}
#[tauri::command]
pub fn federation_list_contexts(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(t) => t,
        Err(err) => return err,
    };
    match federation::list_contexts(&token) {
        Ok(view) => AppResult::success(federation::encode_list_contexts(&view)),
        Err(e) => map_station_error(e, "federation_list_contexts failed"),
    }
}
