// Tauri command shim — federation API (Tier A1).
//
// Four commands, all returning `AppResult<Vec<u8>>` so the TS side
// can decode through `invokeRustProto` with a proto-es schema:
//
//   federation_get_self          → FederationSelfView
//   federation_update_visibility → FederationSelfView (post-mutation echo)
//   federation_resolve           → FederationResolveView
//   federation_health            → FederationHealthView   (public)
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
use crate::contracts::{
    FederationCatalogSearchInput, FederationCreateInput, FederationJoinInput,
    FederationLeaveInput, FederationListMemberStationsInput, FederationResolveInput,
    FederationVisibilityInput,
};
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
pub fn federation_get_self(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<Vec<u8>> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(t) => t,
        Err(err) => return err,
    };
    match federation::get_self(&token) {
        Ok(view) => AppResult::success(federation::encode_self(&view)),
        Err(e) => map_station_error(e, "federation_get_self failed"),
    }
}

#[tauri::command]
pub fn federation_update_visibility(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: FederationVisibilityInput,
) -> AppResult<Vec<u8>> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(t) => t,
        Err(err) => return err,
    };
    match federation::set_visibility(&token, &input.visibility) {
        Ok(view) => AppResult::success(federation::encode_self(&view)),
        Err(e) => e.into_app_result_proto("federation_update_visibility failed"),
    }
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
    match federation::resolve(&token, &input.handle) {
        Ok(view) => AppResult::success(federation::encode_resolve(&view)),
        Err(e) => e.into_app_result_proto("federation_resolve failed"),
    }
}

/// Public — no auth required. Splash / Settings panel polls this to
/// drive the federation-readiness banner.
#[tauri::command]
pub fn federation_health() -> AppResult<Vec<u8>> {
    match federation::health() {
        Ok(view) => AppResult::success(federation::encode_health(&view)),
        Err(e) => map_station_error(e, "federation_health failed"),
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

// ─── Federation Lifecycle Commands ──────────────────────────────────────────

#[tauri::command]
pub fn federation_list_federations(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(t) => t,
        Err(err) => return err,
    };
    match federation::list_federations(&token) {
        Ok(view) => AppResult::success(federation::encode_list_federations(&view)),
        Err(e) => map_station_error(e, "federation_list_federations failed"),
    }
}

#[tauri::command]
pub fn federation_create(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: FederationCreateInput,
) -> AppResult<Vec<u8>> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(t) => t,
        Err(err) => return err,
    };
    match federation::create_federation(
        &token,
        &input.name,
        &input.description,
        &input.policy_type,
    ) {
        Ok(view) => AppResult::success(federation::encode_create_federation(&view)),
        Err(e) => e.into_app_result_proto("federation_create failed"),
    }
}

#[tauri::command]
pub fn federation_join(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: FederationJoinInput,
) -> AppResult<Vec<u8>> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(t) => t,
        Err(err) => return err,
    };
    match federation::join_federation(
        &token,
        &input.federation_endpoint,
        &input.federation_id,
        &input.message,
    ) {
        Ok(view) => AppResult::success(federation::encode_join_federation(&view)),
        Err(e) => e.into_app_result_proto("federation_join failed"),
    }
}

#[tauri::command]
pub fn federation_leave(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: FederationLeaveInput,
) -> AppResult<Vec<u8>> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(t) => t,
        Err(err) => return err,
    };
    match federation::leave_federation(&token, &input.federation_id, &input.reason) {
        Ok(view) => AppResult::success(federation::encode_leave_federation(&view)),
        Err(e) => e.into_app_result_proto("federation_leave failed"),
    }
}

#[tauri::command]
pub fn federation_list_member_stations(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: FederationListMemberStationsInput,
) -> AppResult<Vec<u8>> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(t) => t,
        Err(err) => return err,
    };
    match federation::list_member_stations(&token, &input.federation_id) {
        Ok(view) => AppResult::success(federation::encode_list_member_stations(&view)),
        Err(e) => e.into_app_result_proto("federation_list_member_stations failed"),
    }
}
