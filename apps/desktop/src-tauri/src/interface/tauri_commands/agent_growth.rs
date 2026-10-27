use std::sync::Arc;
use tauri::State;
use tauri::Window;

use crate::application::agent_growth as app;
use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::error::AppResult;
use crate::error::ErrorCode;
use crate::model;
use crate::state::AppState;
use prost::Message;
use reqwest::Method;
use serde::{Deserialize, Serialize};

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
    app::agent_growth_snapshot(state.station.client(), input, &token)
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
    app::agent_memory_list(state.station.client(), input, &token)
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
    app::agent_skill_list(state.station.client(), input, &token)
}

#[tauri::command]
pub fn agent_submit_feedback(
    input: app::AgentFeedbackInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    app::agent_submit_feedback(state.station.client(), input, &token)
}

#[tauri::command]
pub fn agent_list_turn_feedback(
    input: app::AgentTurnFeedbackListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    app::agent_list_turn_feedback(state.station.client(), input, &token)
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
) -> AppResult<Vec<u8>> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let body = model::agent::QuickCompletionRequest {
        agent_id: input.agent_id,
        prompt: input.prompt,
    };
    match state.station.client().request_proto::<
        model::agent::QuickCompletionRequest,
        model::agent::QuickCompletionResponse,
    >(
        Method::POST,
        "/sub-agent/agent/quick-completion",
        &token,
        None,
        Some(&body),
    ) {
        Ok(resp) => AppResult::success(resp.encode_to_vec()),
        Err(e) => e.into_app_result("quick completion failed"),
    }
}
