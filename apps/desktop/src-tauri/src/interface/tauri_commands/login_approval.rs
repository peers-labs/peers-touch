use crate::application::login_approval::{self, CreateInput, PendingList, Projection};
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;
use serde::Deserialize;
use tauri::{State, Window};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusInput {
    pub observed_revision: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionInput {
    pub approval_id: String,
    pub observed_revision: u64,
}

fn result<T: serde::Serialize>(value: Result<T, String>) -> Result<AppResult<T>, String> {
    Ok(match value {
        Ok(data) => AppResult::success(data),
        Err(error) => AppResult::fail(ErrorCode::Unavailable, error, None),
    })
}

#[tauri::command]
pub fn login_approval_create(
    input: CreateInput,
    state: State<'_, std::sync::Arc<AppState>>,
    window: Window,
) -> Result<AppResult<Projection>, String> {
    result(login_approval::create(
        &state,
        window.label(),
        input,
    ))
}

#[tauri::command]
pub fn login_approval_status(
    input: StatusInput,
    state: State<'_, std::sync::Arc<AppState>>,
    window: Window,
) -> Result<AppResult<Projection>, String> {
    result(login_approval::status(
        &state,
        window.label(),
        input.observed_revision,
    ))
}

#[tauri::command]
pub fn login_approval_cancel(
    input: StatusInput,
    state: State<'_, std::sync::Arc<AppState>>,
    window: Window,
) -> Result<AppResult<Projection>, String> {
    result(login_approval::cancel(
        &state,
        window.label(),
        input.observed_revision,
    ))
}

#[tauri::command]
pub fn login_approval_list_pending(
    input: StatusInput,
    state: State<'_, std::sync::Arc<AppState>>,
    window: Window,
) -> Result<AppResult<PendingList>, String> {
    result(login_approval::list_pending(
        &state,
        window.label(),
        input.observed_revision,
    ))
}

#[tauri::command]
pub fn login_approval_approve(
    input: DecisionInput,
    state: State<'_, std::sync::Arc<AppState>>,
    window: Window,
) -> Result<AppResult<Projection>, String> {
    result(login_approval::approve(
        &state,
        window.label(),
        &input.approval_id,
        input.observed_revision,
    ))
}

#[tauri::command]
pub fn login_approval_deny(
    input: DecisionInput,
    state: State<'_, std::sync::Arc<AppState>>,
    window: Window,
) -> Result<AppResult<Projection>, String> {
    result(login_approval::deny(
        &state,
        window.label(),
        &input.approval_id,
        input.observed_revision,
    ))
}
