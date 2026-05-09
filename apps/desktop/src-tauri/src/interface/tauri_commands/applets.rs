use crate::application::applets as application_applets;
use crate::application::session_resolver;
use crate::contracts::{
    AppletActionInput, AppletConfigSetInput, AppletIdInput, AppletInvokeInput, StubPayload,
};
use crate::domain::applets::AccessContext;
use crate::error::AppResult;
use crate::error::ErrorCode;
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;
use tauri::Window;

fn applet_context(
    state: &Arc<AppState>,
    window: &Window,
) -> Result<AccessContext, AppResult<StubPayload>> {
    let token = session_resolver::token_for_window(state, window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    let actor_id = session_resolver::actor_id_for_window(state, window);
    Ok(AccessContext { actor_id })
}

#[tauri::command]
pub fn applets_list(state: State<'_, Arc<AppState>>, window: Window) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_list(context)
}

#[tauri::command]
pub fn applets_get(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletIdInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_get(context, input)
}

#[tauri::command]
pub fn applets_activate(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletIdInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_activate(context, input)
}

#[tauri::command]
pub fn applets_deactivate(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletIdInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_deactivate(context, input)
}

#[tauri::command]
pub fn applets_get_config(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletIdInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_get_config(context, input)
}

#[tauri::command]
pub fn applets_set_config(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletConfigSetInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_set_config(context, input)
}

#[tauri::command]
pub fn applets_action(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletActionInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_action(context, input)
}

#[tauri::command]
pub fn applets_invoke(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AppletInvokeInput,
) -> AppResult<StubPayload> {
    let context = match applet_context(state.inner(), &window) {
        Ok(c) => c,
        Err(e) => return e,
    };
    application_applets::applets_invoke(context, input)
}
