use crate::error::AppResult;
use crate::interface::contracts::{
    CronCreateInput, CronIdInput, CronParseScheduleInput, CronRunsInput, CronToggleInput, CronUpdateInput, StubPayload,
};

#[path = "../../application/cron/mod.rs"]
mod application_cron;

#[tauri::command]
pub fn cron_status() -> AppResult<StubPayload> {
    application_cron::cron_status()
}

#[tauri::command]
pub fn cron_list_jobs() -> AppResult<StubPayload> {
    application_cron::cron_list_jobs()
}

#[tauri::command]
pub fn cron_create_job(input: CronCreateInput) -> AppResult<StubPayload> {
    application_cron::cron_create_job(input)
}

#[tauri::command]
pub fn cron_update_job(input: CronUpdateInput) -> AppResult<StubPayload> {
    application_cron::cron_update_job(input)
}

#[tauri::command]
pub fn cron_delete_job(input: CronIdInput) -> AppResult<StubPayload> {
    application_cron::cron_delete_job(input)
}

#[tauri::command]
pub fn cron_toggle_job(input: CronToggleInput) -> AppResult<StubPayload> {
    application_cron::cron_toggle_job(input)
}

#[tauri::command]
pub fn cron_run_job(input: CronIdInput) -> AppResult<StubPayload> {
    application_cron::cron_run_job(input)
}

#[tauri::command]
pub fn cron_list_runs(input: CronRunsInput) -> AppResult<StubPayload> {
    application_cron::cron_list_runs(input)
}

#[tauri::command]
pub fn cron_parse_schedule(input: CronParseScheduleInput) -> AppResult<StubPayload> {
    application_cron::cron_parse_schedule(input)
}
