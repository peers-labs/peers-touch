use crate::application::agent_scheduler::{self, ScheduledJobInput, ScheduledJobPatch};
use crate::application::session_resolver;
use crate::contracts::{
    CronCreateInput, CronIdInput, CronRunsInput, CronToggleInput, CronUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;
use serde::Deserialize;
use std::sync::Arc;
use tauri::{State, Window};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronListInput {
    #[serde(default)]
    pub include_paused: bool,
    #[serde(default)]
    pub agent_id: Option<String>,
}

fn token_or_unauthorized(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<String, AppResult<StubPayload>> {
    let token = session_resolver::token_for_window(state.inner(), window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(token)
}

#[tauri::command]
pub fn cron_list_jobs(
    input: Option<CronListInput>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    let input = input.unwrap_or(CronListInput {
        include_paused: true,
        agent_id: None,
    });
    agent_scheduler::scheduled_job_list(
        state.station.client(),
        &token,
        input.include_paused,
        input.agent_id,
    )
}

#[tauri::command]
pub fn cron_create_job(
    input: CronCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    let parsed: ScheduledJobInput = match serde_json::from_value(input.data) {
        Ok(parsed) => parsed,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("invalid scheduled job payload: {error}"),
                None,
            )
        }
    };
    agent_scheduler::scheduled_job_create(state.station.client(), &token, parsed)
}

#[tauri::command]
pub fn cron_update_job(
    input: CronUpdateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    let patch: ScheduledJobPatch = match serde_json::from_value(input.data) {
        Ok(patch) => patch,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("invalid scheduled job patch: {error}"),
                None,
            )
        }
    };
    agent_scheduler::scheduled_job_update(state.station.client(), &token, input.id, patch)
}

#[tauri::command]
pub fn cron_delete_job(
    input: CronIdInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    agent_scheduler::scheduled_job_delete(state.station.client(), &token, input.id)
}

#[tauri::command]
pub fn cron_toggle_job(
    input: CronToggleInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    agent_scheduler::scheduled_job_toggle(state.station.client(), &token, input.id, input.enabled)
}

#[tauri::command]
pub fn cron_run_job(
    input: CronIdInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    agent_scheduler::scheduled_job_trigger(state.station.client(), &token, input.id)
}

#[tauri::command]
pub fn cron_list_runs(
    input: CronRunsInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_or_unauthorized(&state, &window) {
        Ok(token) => token,
        Err(result) => return result,
    };
    agent_scheduler::scheduled_job_list_runs(state.station.client(), &token, input.job_id, 20)
}
