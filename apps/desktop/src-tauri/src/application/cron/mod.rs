use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{
    CronCreateInput, CronIdInput, CronParseScheduleInput, CronRunsInput, CronToggleInput, CronUpdateInput, StubPayload,
};
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};

#[derive(Clone)]
struct CronJobRecord {
    id: String,
    data: Value,
    enabled: bool,
}

#[derive(Default)]
struct CronStore {
    jobs: Vec<CronJobRecord>,
}

impl CronStore {
    fn seeded() -> Self {
        Self {
            jobs: vec![CronJobRecord {
                id: "cron-1".to_string(),
                enabled: true,
                data: json!({
                    "id": "cron-1",
                    "name": "Daily Brief",
                    "description": "daily summary",
                    "schedule_kind": "cron",
                    "cron_expr": "0 9 * * *",
                    "timezone": "UTC",
                    "exec_kind": "agent",
                    "agent_prompt": "summarize my tasks",
                    "enabled": true,
                    "last_run_at": null,
                    "next_run_at": null,
                    "created_at": "2026-03-24T00:00:00.000Z",
                    "updated_at": "2026-03-24T00:00:00.000Z"
                }),
            }],
        }
    }
}

static CRON_STORE: OnceLock<Mutex<CronStore>> = OnceLock::new();

fn cron_store() -> &'static Mutex<CronStore> {
    CRON_STORE.get_or_init(|| Mutex::new(CronStore::seeded()))
}

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

fn internal_error() -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InternalError, "failed to access cron store", None)
}

pub fn cron_status() -> AppResult<StubPayload> {
    success_payload("cron_status", json!({ "enabled": true, "lastTick": "2026-03-24T00:00:00.000Z" }))
}

pub fn cron_list_jobs() -> AppResult<StubPayload> {
    let guard = match cron_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let jobs = guard
        .jobs
        .iter()
        .map(|item| {
            let mut data = item.data.clone();
            if let Some(obj) = data.as_object_mut() {
                obj.insert("enabled".to_string(), json!(item.enabled));
            }
            data
        })
        .collect::<Vec<_>>();
    success_payload("cron_list_jobs", json!({ "jobs": jobs }))
}

pub fn cron_create_job(input: CronCreateInput) -> AppResult<StubPayload> {
    let mut guard = match cron_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let id = format!("cron-{}", guard.jobs.len() + 1);
    let mut data = input.data;
    if let Some(obj) = data.as_object_mut() {
        obj.insert("id".to_string(), json!(id.clone()));
        if !obj.contains_key("enabled") {
            obj.insert("enabled".to_string(), json!(true));
        }
    }
    guard.jobs.push(CronJobRecord {
        id: id.clone(),
        enabled: data.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        data: data.clone(),
    });
    success_payload("cron_create_job", json!({ "job": data }))
}

pub fn cron_update_job(input: CronUpdateInput) -> AppResult<StubPayload> {
    let id = input.id.trim().to_string();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match cron_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    if let Some(item) = guard.jobs.iter_mut().find(|item| item.id == id) {
        item.enabled = input.data.get("enabled").and_then(Value::as_bool).unwrap_or(item.enabled);
        item.data = input.data;
        let mut data = item.data.clone();
        if let Some(obj) = data.as_object_mut() {
            obj.insert("enabled".to_string(), json!(item.enabled));
            obj.insert("id".to_string(), json!(id));
        }
        return success_payload("cron_update_job", json!({ "job": data }));
    }
    AppResult::fail(ErrorCode::NotFound, "cron job not found", None)
}

pub fn cron_delete_job(input: CronIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim().to_string();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match cron_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let before = guard.jobs.len();
    guard.jobs.retain(|item| item.id != id);
    success_payload("cron_delete_job", json!({ "ok": before != guard.jobs.len() }))
}

pub fn cron_toggle_job(input: CronToggleInput) -> AppResult<StubPayload> {
    let id = input.id.trim().to_string();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match cron_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    if let Some(item) = guard.jobs.iter_mut().find(|item| item.id == id) {
        item.enabled = input.enabled;
        return success_payload("cron_toggle_job", json!({ "ok": true }));
    }
    AppResult::fail(ErrorCode::NotFound, "cron job not found", None)
}

pub fn cron_run_job(input: CronIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("cron_run_job", json!({ "ok": true, "runId": format!("run-{}", id) }))
}

pub fn cron_list_runs(input: CronRunsInput) -> AppResult<StubPayload> {
    let job_id = input.job_id.trim();
    if job_id.is_empty() {
        return invalid_argument("job_id is required");
    }
    success_payload(
        "cron_list_runs",
        json!({
            "runs": [{
                "id": format!("run-{}", job_id),
                "job_id": job_id,
                "status": "success",
                "started_at": "2026-03-24T00:00:00.000Z",
                "finished_at": "2026-03-24T00:00:01.000Z",
                "error_message": null
            }]
        }),
    )
}

pub fn cron_parse_schedule(input: CronParseScheduleInput) -> AppResult<StubPayload> {
    let text = input.text.trim();
    if text.is_empty() {
        return invalid_argument("text is required");
    }
    success_payload(
        "cron_parse_schedule",
        json!({
            "scheduleKind": "cron",
            "cronExpr": text,
            "timezone": "UTC",
            "name": "Cron Task"
        }),
    )
}
