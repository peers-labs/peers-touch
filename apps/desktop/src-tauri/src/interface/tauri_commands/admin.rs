use crate::application::admin as application_admin;
use crate::application::session_resolver;
use crate::contracts::{AdminExecuteActionInput, AdminNetworkProbeInput, StubPayload};
use crate::domain::admin::AccessContext;
use crate::error::AppResult;
use crate::error::ErrorCode;
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;
use tauri::Window;

#[tauri::command]
pub fn admin_health(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
    let context = AccessContext {
        actor_id,
        token: Some(token),
    };
    application_admin::admin_health(context)
}

#[tauri::command]
pub fn admin_network_probe(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AdminNetworkProbeInput,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
    let context = AccessContext {
        actor_id,
        token: Some(token),
    };
    application_admin::admin_network_probe(context, input)
}

#[tauri::command]
pub fn admin_execute_action(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AdminExecuteActionInput,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let actor_id = session_resolver::actor_id_for_window(state.inner(), &window);
    let context = AccessContext {
        actor_id,
        token: Some(token),
    };
    application_admin::admin_execute_action(context, input)
}
