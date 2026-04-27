use std::sync::Arc;
use tauri::State;
use tauri::Window;

use crate::application::agent_growth as app;
use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::error::AppResult;
use crate::error::ErrorCode;
use crate::state::AppState;

#[tauri::command]
pub fn agent_growth_snapshot(
    input: app::AgentGrowthInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    app::agent_growth_snapshot(input, &token)
}

#[tauri::command]
pub fn agent_memory_list(
    input: app::AgentMemoryListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    app::agent_memory_list(input, &token)
}

#[tauri::command]
pub fn agent_skill_list(
    input: app::AgentSkillListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    app::agent_skill_list(input, &token)
}

#[tauri::command]
pub fn agent_submit_feedback(
    input: app::AgentFeedbackInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    app::agent_submit_feedback(input, &token)
}
