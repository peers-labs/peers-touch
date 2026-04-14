use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::state::AppState;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Deserialize, Serialize)]
pub struct AgentGrowthInput {
    pub agent_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AgentMemoryListInput {
    pub agent_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AgentSkillListInput {
    pub agent_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AgentFeedbackInput {
    pub agent_id: String,
    pub turn_id: String,
    pub conversation_id: String,
    pub signal: String,
    pub comment: Option<String>,
}

pub fn agent_growth_snapshot(input: AgentGrowthInput, state: &AppState) -> AppResult<StubPayload> {
    let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e, };

    match station_client::request_json(
        Method::GET,
        &format!("/agent/growth/snapshot?agent_id={}", input.agent_id),
        &token,
        None,
        None,
    ) {
        Ok(result) => {
            let status = serde_json::to_string(&result)
                .unwrap_or_else(|_| r#"{"status":"ok"}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_growth_snapshot".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_growth_snapshot", error = %err);
            AppResult::fail(
                ErrorCode::InternalError,
                "error.agent.growthSnapshotFailed",
                Some(json!({ "detail": err })),
            )
        }
    }
}

pub fn agent_memory_list(input: AgentMemoryListInput, state: &AppState) -> AppResult<StubPayload> {
    let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e, };

    match station_client::request_json(
        Method::GET,
        &format!("/agent/memory/list?agent_id={}", input.agent_id),
        &token,
        None,
        None,
    ) {
        Ok(result) => {
            let status = serde_json::to_string(&result)
                .unwrap_or_else(|_| r#"[]"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_memory_list".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_memory_list", error = %err);
            AppResult::fail(
                ErrorCode::InternalError,
                "error.agent.memoryListFailed",
                Some(json!({ "detail": err })),
            )
        }
    }
}

pub fn agent_skill_list(input: AgentSkillListInput, state: &AppState) -> AppResult<StubPayload> {
    let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e, };

    match station_client::request_json(
        Method::GET,
        &format!("/agent/skill/list?agent_id={}", input.agent_id),
        &token,
        None,
        None,
    ) {
        Ok(result) => {
            let status = serde_json::to_string(&result)
                .unwrap_or_else(|_| r#"[]"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_skill_list".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_skill_list", error = %err);
            AppResult::fail(
                ErrorCode::InternalError,
                "error.agent.skillListFailed",
                Some(json!({ "detail": err })),
            )
        }
    }
}

pub fn agent_submit_feedback(input: AgentFeedbackInput, state: &AppState) -> AppResult<StubPayload> {
    let token = match token_from_state(state) { Ok(t) => t, Err(e) => return e, };

    let body = json!({
        "agent_id": input.agent_id,
        "turn_id": input.turn_id,
        "conversation_id": input.conversation_id,
        "signal": input.signal,
        "comment": input.comment,
    });

    match station_client::request_json(
        Method::POST,
        "/agent/growth/feedback",
        &token,
        None,
        Some(body),
    ) {
        Ok(result) => {
            let status = serde_json::to_string(&result)
                .unwrap_or_else(|_| r#"{"status":"ok"}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_submit_feedback".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_submit_feedback", error = %err);
            AppResult::fail(
                ErrorCode::InternalError,
                "error.agent.feedbackFailed",
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
