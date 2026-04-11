use std::sync::Arc;
use tauri::State;

use crate::application::agent_growth as app;
use crate::contracts::StubPayload;
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub fn agent_growth_snapshot(input: app::AgentGrowthInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    app::agent_growth_snapshot(input, &state)
}

#[tauri::command]
pub fn agent_memory_list(input: app::AgentMemoryListInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    app::agent_memory_list(input, &state)
}

#[tauri::command]
pub fn agent_skill_list(input: app::AgentSkillListInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    app::agent_skill_list(input, &state)
}

#[tauri::command]
pub fn agent_submit_feedback(input: app::AgentFeedbackInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    app::agent_submit_feedback(input, &state)
}
