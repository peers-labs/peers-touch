use crate::application::agent_scheduler;
use crate::contracts::StubPayload;
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub fn agent_scheduler_start(
    input: agent_scheduler::SchedulerStartInput,
    state: tauri::State<'_, AppState>,
) -> AppResult<StubPayload> {
    agent_scheduler::agent_scheduler_start(input, &state)
}

#[tauri::command]
pub fn agent_scheduler_stop(
    state: tauri::State<'_, AppState>,
) -> AppResult<StubPayload> {
    agent_scheduler::agent_scheduler_stop(&state)
}

#[tauri::command]
pub fn agent_scheduler_status(
    state: tauri::State<'_, AppState>,
) -> AppResult<StubPayload> {
    agent_scheduler::agent_scheduler_status(&state)
}

#[tauri::command]
pub fn agent_scheduler_add_job(
    input: agent_scheduler::SchedulerAddJobInput,
    state: tauri::State<'_, AppState>,
) -> AppResult<StubPayload> {
    agent_scheduler::agent_scheduler_add_job(input, &state)
}
