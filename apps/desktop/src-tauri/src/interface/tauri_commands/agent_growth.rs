use std::sync::Arc;
use tauri::State;
use tauri::Window;

use crate::application::agent_growth as app;
use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::error::AppResult;
use crate::error::ErrorCode;
use crate::infrastructure::station_client;
use crate::state::AppState;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentQuickCompletionInput {
    pub agent_id: String,
    pub prompt: String,
}

#[tauri::command]
pub fn agent_quick_completion(
    input: AgentQuickCompletionInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let body = json!({
        "agent_id": input.agent_id,
        "prompt": input.prompt,
    });
    match station_client::request_json_auth(
        Method::POST,
        "/agent/quick-completion",
        &token,
        None,
        Some(&body),
    ) {
        Ok(resp) => AppResult::success(resp),
        Err(e) => AppResult::fail(
            ErrorCode::InternalError,
            "quick completion failed",
            Some(json!({"error": e.to_string()})),
        ),
    }
}
