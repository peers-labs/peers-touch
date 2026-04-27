use crate::contracts::StubPayload;
use crate::error::AppResult;
use crate::infrastructure::station_client;
use crate::model;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Deserialize, Serialize)]
pub struct SchedulerStartInput {
    pub agent_id: String,
    pub review_interval_minutes: Option<i32>,
    pub dogfood_interval_minutes: Option<i32>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SchedulerAddJobInput {
    pub kind: String,
    pub agent_id: String,
    pub interval_minutes: Option<i32>,
}

fn scheduler_start_response_to_json(r: &model::agent::SchedulerStartResponse) -> serde_json::Value {
    json!({
        "ok": r.ok,
        "message": r.message,
    })
}

fn scheduler_stop_response_to_json(r: &model::agent::SchedulerStopResponse) -> serde_json::Value {
    json!({
        "ok": r.ok,
        "message": r.message,
    })
}

fn scheduler_status_response_to_json(r: &model::agent::SchedulerStatusResponse) -> serde_json::Value {
    json!({
        "running": r.running,
        "agentId": r.agent_id,
        "reviewIntervalMinutes": r.review_interval_minutes,
        "dogfoodIntervalMinutes": r.dogfood_interval_minutes,
        "activeJobs": r.active_jobs,
    })
}

fn scheduler_add_job_response_to_json(r: &model::agent::SchedulerAddJobResponse) -> serde_json::Value {
    json!({
        "ok": r.ok,
    })
}

pub fn agent_scheduler_start(input: SchedulerStartInput, token: &str) -> AppResult<StubPayload> {
    let req = model::agent::SchedulerStartRequest {
        agent_id: input.agent_id,
        review_interval_minutes: input.review_interval_minutes.unwrap_or(120),
        dogfood_interval_minutes: input.dogfood_interval_minutes.unwrap_or(360),
    };

    match station_client::request_proto::<model::agent::SchedulerStartRequest, model::agent::SchedulerStartResponse>(
        Method::POST,
        "/agent/scheduler/start",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => {
            let status = serde_json::to_string(&scheduler_start_response_to_json(&resp))
                .unwrap_or_else(|_| r#"{"ok":false}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_scheduler_start".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_scheduler_start", error = %err);
            err.into_app_result("Failed to start agent scheduler")
        }
    }
}

pub fn agent_scheduler_stop(token: &str) -> AppResult<StubPayload> {
    let req = model::agent::SchedulerStopRequest {};
    match station_client::request_proto::<model::agent::SchedulerStopRequest, model::agent::SchedulerStopResponse>(
        Method::POST,
        "/agent/scheduler/stop",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => {
            let status = serde_json::to_string(&scheduler_stop_response_to_json(&resp))
                .unwrap_or_else(|_| r#"{"ok":false}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_scheduler_stop".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_scheduler_stop", error = %err);
            err.into_app_result("Failed to stop agent scheduler")
        }
    }
}

pub fn agent_scheduler_status(token: &str) -> AppResult<StubPayload> {
    match station_client::request_proto::<model::agent::SchedulerStatusRequest, model::agent::SchedulerStatusResponse>(
        Method::GET,
        "/agent/scheduler/status",
        token,
        None,
        None,
    ) {
        Ok(resp) => {
            let status = serde_json::to_string(&scheduler_status_response_to_json(&resp))
                .unwrap_or_else(|_| r#"{"running":false}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_scheduler_status".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_scheduler_status", error = %err);
            err.into_app_result("Failed to get agent scheduler status")
        }
    }
}

pub fn agent_scheduler_add_job(input: SchedulerAddJobInput, token: &str) -> AppResult<StubPayload> {
    let req = model::agent::SchedulerAddJobRequest {
        kind: input.kind,
        agent_id: input.agent_id,
        interval_minutes: input.interval_minutes.unwrap_or(60),
    };

    match station_client::request_proto::<model::agent::SchedulerAddJobRequest, model::agent::SchedulerAddJobResponse>(
        Method::POST,
        "/agent/scheduler/add-job",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => {
            let status = serde_json::to_string(&scheduler_add_job_response_to_json(&resp))
                .unwrap_or_else(|_| r#"{"ok":false}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_scheduler_add_job".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_scheduler_add_job", error = %err);
            err.into_app_result("Failed to add agent scheduler job")
        }
    }
}
