use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use serde::Deserialize;
use tauri::Window;

#[derive(Debug, Deserialize)]
pub struct ModelInput {
    pub scope: Option<String>,
    pub id: Option<String>,
    pub model: Option<String>,
    pub mid: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    pub enabled: Option<bool>,
}

fn not_implemented(cmd: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InternalError, format!("{cmd} not yet implemented"), None)
}

#[tauri::command]
pub fn model_add(_window: Window, _input: ModelInput) -> AppResult<StubPayload> {
    not_implemented("model_add")
}

#[tauri::command]
pub fn model_update(_window: Window, _input: ModelInput) -> AppResult<StubPayload> {
    not_implemented("model_update")
}

#[tauri::command]
pub fn model_delete(_window: Window, _input: ModelInput) -> AppResult<StubPayload> {
    not_implemented("model_delete")
}

#[tauri::command]
pub fn model_fetch_remote(_window: Window, _input: ModelInput) -> AppResult<StubPayload> {
    not_implemented("model_fetch_remote")
}

#[tauri::command]
pub fn model_toggle(_window: Window, _input: ModelInput) -> AppResult<StubPayload> {
    not_implemented("model_toggle")
}

#[tauri::command]
pub fn model_toggle_all(_window: Window, _input: ModelInput) -> AppResult<StubPayload> {
    not_implemented("model_toggle_all")
}
