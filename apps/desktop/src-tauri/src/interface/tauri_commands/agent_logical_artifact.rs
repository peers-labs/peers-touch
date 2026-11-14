// Tauri commands for TW-D3 logical artifacts. Thin parsing layer; the
// application functions are plain typed proto passthroughs.
use serde::Deserialize;
use std::sync::Arc;
use tauri::{State, Window};

use crate::application::agent_logical_artifact as app;
use crate::application::session_resolver;
use crate::error::{AppResult, ErrorCode};
use crate::model::agent::v1 as agent;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ClaimVersionInput {
    pub conversation_id: String,
    #[serde(default)]
    pub artifact_id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub expected_base_version_id: String,
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub source_turn_id: String,
    #[serde(default)]
    pub source_message_id: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub content_type: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub feedback_id: String,
    #[serde(default)]
    pub adopted_attachment_refs: Vec<String>,
    #[serde(default)]
    pub client_idempotency_key: String,
    #[serde(default)]
    pub source_tool_call_id: String,
}

#[derive(Deserialize)]
pub struct ConversationInput {
    pub conversation_id: String,
}

#[derive(Deserialize)]
pub struct ArtifactInput {
    pub artifact_id: String,
}

#[derive(Deserialize)]
pub struct VersionInput {
    pub version_id: String,
}

#[derive(Deserialize)]
pub struct FeedbackInput {
    pub artifact_id: String,
    pub base_version_id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub anchor_text: String,
    pub instruction: String,
    pub client_idempotency_key: String,
}

#[derive(Deserialize)]
pub struct RecordCheckInput {
    pub artifact_id: String,
    pub version_id: String,
    pub check_type: String,
    pub result: String,
    #[serde(default)]
    pub detail: String,
    #[serde(default)]
    pub environment: String,
    pub client_idempotency_key: String,
    #[serde(default)]
    pub source_tool_call_id: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub command_exit_code: i32,
    #[serde(default)]
    pub command_output_sha256: String,
}

#[derive(Deserialize)]
pub struct AcceptInput {
    pub artifact_id: String,
    pub version_id: String,
    pub client_idempotency_key: String,
}

fn token_for(state: &Arc<AppState>, window: &Window) -> Result<String, AppResult<Vec<u8>>> {
    let token = session_resolver::token_for_window(state, window).unwrap_or_default();
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
pub fn agent_task_artifact_claim_version(
    input: ClaimVersionInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_for(state.inner(), &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::ClaimArtifactVersionRequest {
        conversation_id: input.conversation_id,
        artifact_id: input.artifact_id,
        kind: agent::LogicalArtifactKind::from_str_name(&input.kind)
            .unwrap_or(agent::LogicalArtifactKind::Unspecified) as i32,
        name: input.name,
        expected_base_version_id: input.expected_base_version_id,
        origin: agent::ArtifactVersionOrigin::from_str_name(&input.origin)
            .unwrap_or(agent::ArtifactVersionOrigin::Unspecified) as i32,
        source_turn_id: input.source_turn_id,
        source_message_id: input.source_message_id,
        body: input.body,
        content_type: input.content_type,
        summary: input.summary,
        feedback_id: input.feedback_id,
        adopted_attachment_refs: input.adopted_attachment_refs,
        client_idempotency_key: input.client_idempotency_key,
        source_tool_call_id: input.source_tool_call_id,
    };
    app::claim_version(state.station.client(), &token, &request)
}

#[tauri::command]
pub fn agent_task_artifact_list(
    input: ConversationInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_for(state.inner(), &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::ListTaskArtifactsRequest {
        conversation_id: input.conversation_id,
    };
    app::list_task_artifacts(state.station.client(), &token, &request)
}

#[tauri::command]
pub fn agent_task_artifact_versions(
    input: ArtifactInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_for(state.inner(), &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::ListArtifactVersionsRequest {
        artifact_id: input.artifact_id,
    };
    app::list_versions(state.station.client(), &token, &request)
}

#[tauri::command]
pub fn agent_task_artifact_body_get(
    input: VersionInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_for(state.inner(), &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::GetArtifactVersionBodyRequest {
        version_id: input.version_id,
    };
    app::get_body(state.station.client(), &token, &request)
}

#[tauri::command]
pub fn agent_task_artifact_feedback_submit(
    input: FeedbackInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_for(state.inner(), &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::SubmitArtifactFeedbackRequest {
        artifact_id: input.artifact_id,
        base_version_id: input.base_version_id,
        kind: agent::ArtifactFeedbackKind::from_str_name(&input.kind)
            .unwrap_or(agent::ArtifactFeedbackKind::Unspecified) as i32,
        anchor_text: input.anchor_text,
        instruction: input.instruction,
        client_idempotency_key: input.client_idempotency_key,
    };
    app::submit_feedback(state.station.client(), &token, &request)
}

#[tauri::command]
pub fn agent_task_artifact_feedback_list(
    input: ArtifactInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_for(state.inner(), &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::ListArtifactFeedbackRequest {
        artifact_id: input.artifact_id,
    };
    app::list_feedback(state.station.client(), &token, &request)
}

#[tauri::command]
pub fn agent_task_artifact_check_record(
    input: RecordCheckInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_for(state.inner(), &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::RecordArtifactCheckRequest {
        artifact_id: input.artifact_id,
        version_id: input.version_id,
        check_type: agent::ArtifactCheckType::from_str_name(&input.check_type)
            .unwrap_or(agent::ArtifactCheckType::Unspecified) as i32,
        result: agent::ArtifactCheckResult::from_str_name(&input.result)
            .unwrap_or(agent::ArtifactCheckResult::Unspecified) as i32,
        detail: input.detail,
        environment: input.environment,
        client_idempotency_key: input.client_idempotency_key,
        source_tool_call_id: input.source_tool_call_id,
        command_exit_code: input.command_exit_code,
        command_output_sha256: input.command_output_sha256,
        command: input.command,
    };
    app::record_check(state.station.client(), &token, &request)
}

#[tauri::command]
pub fn agent_task_artifact_check_list(
    input: ArtifactInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_for(state.inner(), &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::ListArtifactChecksRequest {
        artifact_id: input.artifact_id,
    };
    app::list_checks(state.station.client(), &token, &request)
}

#[tauri::command]
pub fn agent_task_artifact_accept(
    input: AcceptInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_for(state.inner(), &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::AcceptArtifactVersionRequest {
        artifact_id: input.artifact_id,
        version_id: input.version_id,
        client_idempotency_key: input.client_idempotency_key,
    };
    app::accept_version(state.station.client(), &token, &request)
}

#[tauri::command]
pub fn agent_task_artifact_acceptance_list(
    input: ArtifactInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_for(state.inner(), &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::ListArtifactAcceptancesRequest {
        artifact_id: input.artifact_id,
    };
    app::list_acceptances(state.station.client(), &token, &request)
}
