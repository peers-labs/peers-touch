use std::sync::Arc;
use tauri::State;
use tauri::Window;

use crate::application::agent_scheduler;
use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::error::AppResult;
use crate::error::ErrorCode;
use crate::state::AppState;

#[tauri::command]
pub fn agent_scheduler_start(
    input: agent_scheduler::SchedulerStartInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    agent_scheduler::agent_scheduler_start(input, &token)
}

#[tauri::command]
pub fn agent_scheduler_stop(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    agent_scheduler::agent_scheduler_stop(&token)
}

#[tauri::command]
pub fn agent_scheduler_status(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    agent_scheduler::agent_scheduler_status(&token)
}

#[tauri::command]
pub fn agent_scheduler_add_job(
    input: agent_scheduler::SchedulerAddJobInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    agent_scheduler::agent_scheduler_add_job(input, &token)
}
