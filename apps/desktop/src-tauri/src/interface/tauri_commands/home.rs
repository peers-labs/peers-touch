use std::sync::Arc;

use tauri::{State, Window};

use crate::application::{home, session_resolver};
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;

#[tauri::command]
pub fn agent_home_projection_get(
    input: home::EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    home::get_projection(input, &token)
}

#[tauri::command]
pub fn agent_home_chat_submit(
    input: home::EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    home::submit_chat(input, &token)
}

#[tauri::command]
pub fn agent_home_task_submit(
    input: home::EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    home::submit_task(input, &token)
}

#[tauri::command]
pub fn agent_home_goal_draft_create(
    input: home::EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    home::create_goal(input, &token)
}

#[tauri::command]
pub fn agent_home_goal_get(
    input: home::EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    home::get_goal(input, &token)
}

#[tauri::command]
pub fn agent_home_goal_update(
    input: home::EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    home::update_goal(input, &token)
}

#[tauri::command]
pub fn agent_home_goal_review(
    input: home::EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    home::review_goal(input, &token)
}

#[tauri::command]
pub fn agent_home_goal_admit(
    input: home::EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    home::admit_goal(input, &token)
}

#[tauri::command]
pub fn agent_home_goal_start(
    input: home::EncodedRequestInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    home::start_goal(input, &token)
}
