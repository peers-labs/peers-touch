use crate::application::station_runtime::client::StationClient;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::model;
use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Value as JsonValue};

// ===========================================================================
// Persistent user scheduled jobs (V11)
//
// Desktop never persists or schedules jobs locally. These proxies target the
// single Station-authoritative scheduler; the legacy in-memory system
// scheduler controls were removed when the Growth surface switched over.
// ===========================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledJobInput {
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub schedule_kind: String,
    #[serde(default)]
    pub cron_expr: String,
    #[serde(default)]
    pub interval_sec: i64,
    #[serde(default)]
    pub run_at: String,
    #[serde(default)]
    pub timezone: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub runtime_override: Option<ScheduledRuntimeOverrideInput>,
    #[serde(default)]
    pub delete_after_run: bool,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledRuntimeOverrideInput {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub timeout_sec: u32,
}

fn default_enabled() -> bool {
    true
}

fn schedule_kind_from_text(value: &str) -> model::agent::ScheduledJobScheduleKind {
    match value.trim() {
        "cron" => model::agent::ScheduledJobScheduleKind::Cron,
        "interval" => model::agent::ScheduledJobScheduleKind::Interval,
        "once" => model::agent::ScheduledJobScheduleKind::Once,
        _ => model::agent::ScheduledJobScheduleKind::Unspecified,
    }
}

fn schedule_kind_text(kind: i32) -> &'static str {
    match model::agent::ScheduledJobScheduleKind::try_from(kind).unwrap_or_default() {
        model::agent::ScheduledJobScheduleKind::Cron => "cron",
        model::agent::ScheduledJobScheduleKind::Interval => "interval",
        model::agent::ScheduledJobScheduleKind::Once => "once",
        _ => "unspecified",
    }
}

fn proto_override(
    value: Option<&ScheduledRuntimeOverrideInput>,
) -> Option<model::agent::ScheduledRuntimeOverride> {
    value.map(|override_value| model::agent::ScheduledRuntimeOverride {
        model: override_value.model.clone(),
        provider: override_value.provider.clone(),
        effort: override_value.effort.clone(),
        timeout_sec: if override_value.timeout_sec > 0 {
            Some(override_value.timeout_sec)
        } else {
            None
        },
    })
}

fn timestamp_rfc3339(value: Option<&prost_types::Timestamp>) -> String {
    value.map(unix_rfc3339).unwrap_or_default()
}

// unix_rfc3339 formats a UTC unix instant as RFC3339 without adding a date
// dependency. Sub-second precision is retained only when nanos are nonzero.
fn unix_rfc3339(ts: &prost_types::Timestamp) -> String {
    let (year, month, day, hour, minute, second) = civil_from_unix(ts.seconds);
    let base = format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}");
    if ts.nanos == 0 {
        format!("{base}Z")
    } else {
        format!("{base}.{:09}Z", ts.nanos)
    }
}

fn civil_from_unix(seconds: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = seconds.div_euclid(86_400);
    let remainder = seconds.rem_euclid(86_400);
    let hour = (remainder / 3600) as u32;
    let minute = ((remainder % 3600) / 60) as u32;
    let second = (remainder % 60) as u32;
    // Howard Hinnant's civil-from-days algorithm.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (
        year + i64::from(month <= 2),
        month,
        day,
        hour,
        minute,
        second,
    )
}

fn scheduled_job_json(job: &model::agent::ScheduledJob) -> JsonValue {
    let mut json = json!({
        "id": job.job_id,
        "agentId": job.agent_id,
        "name": job.name,
        "description": job.description,
        "enabled": job.enabled,
        "scheduleKind": schedule_kind_text(job.schedule_kind),
        "cronExpr": job.cron_expr,
        "intervalSec": job.interval_sec,
        "runAt": job.run_at,
        "timezone": job.timezone,
        "execKind": "agent",
        "agentPrompt": job.prompt,
        "deleteAfterRun": job.delete_after_run,
        "conversationId": job.conversation_id,
        "nextRunAt": timestamp_rfc3339(job.next_due_at.as_ref()),
        "lastRunAt": timestamp_rfc3339(job.last_run_at.as_ref()),
        "lastStatus": scheduled_job_status_text(job.last_status.as_str()),
        "lastError": job.last_error,
        "lastDurationMs": 0,
        "consecErrors": 0,
        "createdAt": timestamp_rfc3339(job.created_at.as_ref()),
        "revision": job.revision,
    });
    if let Some(object) = json.as_object_mut() {
        if let Some(over) = &job.runtime_override {
            object.insert(
                "modelOverride".to_string(),
                json!(over.model.clone().unwrap_or_default()),
            );
            object.insert(
                "providerOverride".to_string(),
                json!(over.provider.clone().unwrap_or_default()),
            );
            object.insert(
                "effortOverride".to_string(),
                json!(over.effort.clone().unwrap_or_default()),
            );
            object.insert(
                "timeoutSec".to_string(),
                json!(over.timeout_sec.unwrap_or(0)),
            );
        } else {
            object.insert("modelOverride".to_string(), json!(""));
            object.insert("providerOverride".to_string(), json!(""));
            object.insert("effortOverride".to_string(), json!(""));
            object.insert("timeoutSec".to_string(), json!(0));
        }
    }
    json
}

fn scheduled_job_status_text(status: &str) -> &'static str {
    match status {
        "success" => "ok",
        "failed" => "error",
        "running" => "running",
        "pending" => "running",
        "invalid" => "error",
        _ => "",
    }
}

fn scheduled_run_status_text(status: i32) -> &'static str {
    match model::agent::ScheduledJobRunStatus::try_from(status).unwrap_or_default() {
        model::agent::ScheduledJobRunStatus::Success => "ok",
        model::agent::ScheduledJobRunStatus::Failed => "error",
        model::agent::ScheduledJobRunStatus::Running => "running",
        model::agent::ScheduledJobRunStatus::Pending => "running",
        _ => "",
    }
}

fn scheduled_run_json(run: &model::agent::ScheduledJobRun) -> JsonValue {
    json!({
        "id": run.run_id,
        "jobId": run.job_id,
        "agentId": run.agent_id,
        "conversationId": run.conversation_id,
        "turnId": run.turn_id,
        "status": scheduled_run_status_text(run.status),
        "trigger": run.trigger,
        "error": run.error_message,
        "output": "",
        "startedAt": timestamp_rfc3339(run.started_at.as_ref()),
        "endedAt": timestamp_rfc3339(run.finished_at.as_ref()),
        "scheduledFor": timestamp_rfc3339(run.scheduled_for.as_ref()),
        "durationMs": run.duration_ms,
    })
}

fn scheduled_success(command: &str, data: JsonValue) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn scheduled_error(
    command: &str,
    err: crate::application::station_runtime::client::StationClientError,
) -> AppResult<StubPayload> {
    tracing::error!(command = command, error = %err);
    err.into_app_result(format!("{command} failed"))
}

pub fn scheduled_job_list(
    station_client: &StationClient,
    token: &str,
    include_paused: bool,
    agent_id: Option<String>,
) -> AppResult<StubPayload> {
    let req = model::agent::ListScheduledJobsRequest {
        agent_id: agent_id.unwrap_or_default(),
        include_paused,
    };
    match station_client.request_proto::<
        model::agent::ListScheduledJobsRequest,
        model::agent::ListScheduledJobsResponse,
    >(Method::POST, "/sub-agent/agent/scheduled-job/list", token, None, Some(&req))
    {
        Ok(resp) => scheduled_success(
            "cron_list_jobs",
            json!({
                "jobs": resp.jobs.iter().map(scheduled_job_json).collect::<Vec<_>>()
            }),
        ),
        Err(err) => scheduled_error("cron_list_jobs", err),
    }
}

pub fn scheduled_job_create(
    station_client: &StationClient,
    token: &str,
    input: ScheduledJobInput,
) -> AppResult<StubPayload> {
    let req = model::agent::CreateScheduledJobRequest {
        agent_id: input.agent_id.clone().unwrap_or_default(),
        name: input.name,
        description: input.description,
        schedule_kind: schedule_kind_from_text(&input.schedule_kind) as i32,
        cron_expr: input.cron_expr,
        interval_sec: input.interval_sec,
        timezone: input.timezone,
        run_at: input.run_at,
        prompt: input.prompt,
        runtime_override: proto_override(input.runtime_override.as_ref()),
        delete_after_run: input.delete_after_run,
        enabled: input.enabled,
        idempotency_key: if input.idempotency_key.trim().is_empty() {
            format!("scheduled-job:{}", ulid::Ulid::new())
        } else {
            input.idempotency_key
        },
    };
    match station_client.request_proto::<
        model::agent::CreateScheduledJobRequest,
        model::agent::CreateScheduledJobResponse,
    >(Method::POST, "/sub-agent/agent/scheduled-job/create", token, None, Some(&req))
    {
        Ok(resp) => match resp.job {
            Some(job) => scheduled_success("cron_create_job", json!({ "job": scheduled_job_json(&job) })),
            None => AppResult::fail(
                ErrorCode::InternalError,
                "Station returned no scheduled job",
                None,
            ),
        },
        Err(err) => scheduled_error("cron_create_job", err),
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ScheduledJobPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub schedule_kind: Option<String>,
    pub cron_expr: Option<String>,
    pub interval_sec: Option<i64>,
    pub run_at: Option<String>,
    pub timezone: Option<String>,
    pub prompt: Option<String>,
    pub runtime_override: Option<ScheduledRuntimeOverrideInput>,
    pub delete_after_run: Option<bool>,
    pub enabled: Option<bool>,
    pub expected_revision: Option<u64>,
}

pub fn scheduled_job_update(
    station_client: &StationClient,
    token: &str,
    job_id: String,
    patch: ScheduledJobPatch,
) -> AppResult<StubPayload> {
    let req = model::agent::UpdateScheduledJobRequest {
        job_id,
        name: patch.name,
        description: patch.description,
        schedule_kind: patch
            .schedule_kind
            .as_deref()
            .map(schedule_kind_from_text)
            .map(|kind| kind as i32),
        cron_expr: patch.cron_expr,
        interval_sec: patch.interval_sec,
        timezone: patch.timezone,
        run_at: patch.run_at,
        prompt: patch.prompt,
        runtime_override: proto_override(patch.runtime_override.as_ref()),
        delete_after_run: patch.delete_after_run,
        enabled: patch.enabled,
        expected_revision: patch.expected_revision.unwrap_or(0),
    };
    match station_client.request_proto::<
        model::agent::UpdateScheduledJobRequest,
        model::agent::UpdateScheduledJobResponse,
    >(Method::POST, "/sub-agent/agent/scheduled-job/update", token, None, Some(&req))
    {
        Ok(resp) => match resp.job {
            Some(job) => scheduled_success("cron_update_job", json!({ "job": scheduled_job_json(&job) })),
            None => AppResult::fail(
                ErrorCode::InternalError,
                "Station returned no scheduled job",
                None,
            ),
        },
        Err(err) => scheduled_error("cron_update_job", err),
    }
}

pub fn scheduled_job_delete(
    station_client: &StationClient,
    token: &str,
    job_id: String,
) -> AppResult<StubPayload> {
    let req = model::agent::DeleteScheduledJobRequest { job_id };
    match station_client.request_proto::<
        model::agent::DeleteScheduledJobRequest,
        model::agent::DeleteScheduledJobResponse,
    >(Method::POST, "/sub-agent/agent/scheduled-job/delete", token, None, Some(&req))
    {
        Ok(resp) => scheduled_success("cron_delete_job", json!({ "ok": resp.ok })),
        Err(err) => scheduled_error("cron_delete_job", err),
    }
}

pub fn scheduled_job_toggle(
    station_client: &StationClient,
    token: &str,
    job_id: String,
    enabled: bool,
) -> AppResult<StubPayload> {
    let req = model::agent::ToggleScheduledJobRequest { job_id, enabled };
    match station_client.request_proto::<
        model::agent::ToggleScheduledJobRequest,
        model::agent::ToggleScheduledJobResponse,
    >(Method::POST, "/sub-agent/agent/scheduled-job/toggle", token, None, Some(&req))
    {
        Ok(resp) => match resp.job {
            Some(job) => scheduled_success("cron_toggle_job", json!({ "ok": true, "job": scheduled_job_json(&job) })),
            None => AppResult::fail(
                ErrorCode::InternalError,
                "Station returned no scheduled job",
                None,
            ),
        },
        Err(err) => scheduled_error("cron_toggle_job", err),
    }
}

pub fn scheduled_job_trigger(
    station_client: &StationClient,
    token: &str,
    job_id: String,
) -> AppResult<StubPayload> {
    let req = model::agent::TriggerScheduledJobRequest {
        job_id,
        idempotency_key: String::new(),
    };
    match station_client.request_proto::<
        model::agent::TriggerScheduledJobRequest,
        model::agent::TriggerScheduledJobResponse,
    >(Method::POST, "/sub-agent/agent/scheduled-job/trigger", token, None, Some(&req))
    {
        Ok(resp) => match resp.run {
            Some(run) => scheduled_success(
                "cron_run_job",
                json!({ "ok": true, "runId": run.run_id, "run": scheduled_run_json(&run) }),
            ),
            None => AppResult::fail(
                ErrorCode::InternalError,
                "Station returned no scheduled run",
                None,
            ),
        },
        Err(err) => scheduled_error("cron_run_job", err),
    }
}

pub fn scheduled_job_list_runs(
    station_client: &StationClient,
    token: &str,
    job_id: String,
    limit: i32,
) -> AppResult<StubPayload> {
    let req = model::agent::ListScheduledJobRunsRequest {
        job_id,
        limit: if limit > 0 { limit } else { 20 },
    };
    match station_client.request_proto::<
        model::agent::ListScheduledJobRunsRequest,
        model::agent::ListScheduledJobRunsResponse,
    >(Method::POST, "/sub-agent/agent/scheduled-job/runs/list", token, None, Some(&req))
    {
        Ok(resp) => scheduled_success(
            "cron_list_runs",
            json!({
                "runs": resp.runs.iter().map(scheduled_run_json).collect::<Vec<_>>()
            }),
        ),
        Err(err) => scheduled_error("cron_list_runs", err),
    }
}
