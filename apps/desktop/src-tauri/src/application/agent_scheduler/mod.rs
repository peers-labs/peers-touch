use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::state::AppState;
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

pub fn agent_scheduler_start(input: SchedulerStartInput, state: &AppState) -> AppResult<StubPayload> {
    let token = token_from_state(state)?;

    let body = json!({
        "agent_id": input.agent_id,
        "review_interval_minutes": input.review_interval_minutes.unwrap_or(120),
        "dogfood_interval_minutes": input.dogfood_interval_minutes.unwrap_or(360),
    });

    match station_client::request_json(
        Method::POST,
        "/agent/scheduler/start",
        &token,
        None,
        Some(body),
    ) {
        Ok(result) => {
            let status = serde_json::to_string(&result)
                .unwrap_or_else(|_| r#"{"status":"ok"}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_scheduler_start".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_scheduler_start", error = %err);
            AppResult::fail(
                ErrorCode::InternalError,
                "error.agent.schedulerStartFailed",
                Some(json!({ "detail": err })),
            )
        }
    }
}

pub fn agent_scheduler_stop(state: &AppState) -> AppResult<StubPayload> {
    let token = token_from_state(state)?;

    match station_client::request_json(
        Method::POST,
        "/agent/scheduler/stop",
        &token,
        None,
        Some(json!({})),
    ) {
        Ok(result) => {
            let status = serde_json::to_string(&result)
                .unwrap_or_else(|_| r#"{"status":"ok"}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_scheduler_stop".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_scheduler_stop", error = %err);
            AppResult::fail(
                ErrorCode::InternalError,
                "error.agent.schedulerStopFailed",
                Some(json!({ "detail": err })),
            )
        }
    }
}

pub fn agent_scheduler_status(state: &AppState) -> AppResult<StubPayload> {
    let token = token_from_state(state)?;

    match station_client::request_json(
        Method::GET,
        "/agent/scheduler/status",
        &token,
        None,
        None,
    ) {
        Ok(result) => {
            let status = serde_json::to_string(&result)
                .unwrap_or_else(|_| r#"{"running":false}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_scheduler_status".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_scheduler_status", error = %err);
            AppResult::fail(
                ErrorCode::InternalError,
                "error.agent.schedulerStatusFailed",
                Some(json!({ "detail": err })),
            )
        }
    }
}

pub fn agent_scheduler_add_job(input: SchedulerAddJobInput, state: &AppState) -> AppResult<StubPayload> {
    let token = token_from_state(state)?;

    let body = json!({
        "kind": input.kind,
        "agent_id": input.agent_id,
        "interval_minutes": input.interval_minutes.unwrap_or(60),
    });

    match station_client::request_json(
        Method::POST,
        "/agent/scheduler/add-job",
        &token,
        None,
        Some(body),
    ) {
        Ok(result) => {
            let status = serde_json::to_string(&result)
                .unwrap_or_else(|_| r#"{"status":"ok"}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_scheduler_add_job".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_scheduler_add_job", error = %err);
            AppResult::fail(
                ErrorCode::InternalError,
                "error.agent.schedulerAddJobFailed",
                Some(json!({ "detail": err })),
            )
        }
    }
}

fn token_from_state(state: &AppState) -> Result<String, AppResult<StubPayload>> {
    let guard = state.session.lock().map_err(|_| {
        AppResult::fail(ErrorCode::InternalError, "error.auth.sessionLockFailed", None)
    })?;
    let token = guard.token.clone().unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "error.auth.authenticationRequired",
            None,
        ));
    }
    Ok(token)
}
