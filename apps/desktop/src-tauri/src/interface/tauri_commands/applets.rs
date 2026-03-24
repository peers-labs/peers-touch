use crate::error::AppResult;
use crate::interface::contracts::{
    AppletActionInput, AppletConfigSetInput, AppletIdInput, StubPayload,
};

#[path = "../../application/applets/mod.rs"]
mod application_applets;

#[tauri::command]
pub fn applets_list() -> AppResult<StubPayload> {
    application_applets::applets_list()
}

#[tauri::command]
pub fn applets_get(input: AppletIdInput) -> AppResult<StubPayload> {
    application_applets::applets_get(input)
}

#[tauri::command]
pub fn applets_activate(input: AppletIdInput) -> AppResult<StubPayload> {
    application_applets::applets_activate(input)
}

#[tauri::command]
pub fn applets_deactivate(input: AppletIdInput) -> AppResult<StubPayload> {
    application_applets::applets_deactivate(input)
}

#[tauri::command]
pub fn applets_get_config(input: AppletIdInput) -> AppResult<StubPayload> {
    application_applets::applets_get_config(input)
}

#[tauri::command]
pub fn applets_set_config(input: AppletConfigSetInput) -> AppResult<StubPayload> {
    application_applets::applets_set_config(input)
}

#[tauri::command]
pub fn applets_action(input: AppletActionInput) -> AppResult<StubPayload> {
    application_applets::applets_action(input)
}
