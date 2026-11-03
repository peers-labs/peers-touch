// TW-D5: Tauri commands for device-held persistent terminal sessions.
// Process and output stay in the worker; these are lifecycle/control calls.

use std::sync::Arc;

use base64::Engine;
use serde::Deserialize;
use tauri::{AppHandle, State, Window};

use crate::application::agent_terminal_session as session_rpc;
use crate::application::session_resolver;
use crate::application::terminal::{
    self, CreateTerminal, TerminalMeta, TerminalRead,
};
use crate::error::{AppResult, ErrorCode};
use crate::model::agent::v1 as agent;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateInput {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    cwd: Option<String>,
    workspace_root: String,
    #[serde(default)]
    allowed_roots: Vec<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteInput {
    session_id: String,
    // UTF-8 bytes of the keystroke payload, base64 encoded so arbitrary
    // control bytes (Ctrl-C, escapes) survive the JSON boundary.
    data_b64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeInput {
    session_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInput {
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalReadInput {
    session_id: String,
    #[serde(default)]
    cursor: u64,
}

fn fail(error: terminal::TerminalError) -> AppResult<TerminalMeta> {
    AppResult::fail(
        ErrorCode::InvalidArgument,
        error.message.clone(),
        Some(serde_json::json!({ "code": error.code })),
    )
}

#[tauri::command]
pub fn terminal_session_create(
    app: AppHandle,
    input: TerminalCreateInput,
) -> AppResult<TerminalMeta> {
    match terminal::create_session(
        app,
        CreateTerminal {
            command: input.command,
            args: input.args,
            cwd: input.cwd,
            workspace_root: input.workspace_root,
            allowed_roots: input.allowed_roots,
            cols: input.cols,
            rows: input.rows,
        },
    ) {
        Ok(meta) => AppResult::success(meta),
        Err(error) => fail(error),
    }
}

#[tauri::command]
pub fn terminal_session_write(input: TerminalWriteInput) -> AppResult<bool> {
    let data = match base64::engine::general_purpose::STANDARD.decode(&input.data_b64) {
        Ok(bytes) => bytes,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("invalid terminal data encoding: {error}"),
                None,
            );
        }
    };
    match terminal::write_input(&input.session_id, &data) {
        Ok(()) => AppResult::success(true),
        Err(error) => AppResult::fail(
            ErrorCode::InternalError,
            error.message,
            Some(serde_json::json!({ "code": error.code })),
        ),
    }
}

#[tauri::command]
pub fn terminal_session_resize(input: TerminalResizeInput) -> AppResult<bool> {
    match terminal::resize(&input.session_id, input.cols, input.rows) {
        Ok(()) => AppResult::success(true),
        Err(error) => AppResult::fail(
            ErrorCode::InternalError,
            error.message,
            Some(serde_json::json!({ "code": error.code })),
        ),
    }
}

#[tauri::command]
pub fn terminal_session_kill(input: TerminalSessionInput) -> AppResult<TerminalMeta> {
    match terminal::kill_session(&input.session_id) {
        Ok(meta) => AppResult::success(meta),
        Err(error) => fail(error),
    }
}

#[tauri::command]
pub fn terminal_session_remove(input: TerminalSessionInput) -> AppResult<bool> {
    match terminal::remove_session(&input.session_id) {
        Ok(()) => AppResult::success(true),
        Err(error) => AppResult::fail(
            ErrorCode::InvalidArgument,
            error.message,
            Some(serde_json::json!({ "code": error.code })),
        ),
    }
}

#[tauri::command]
pub fn terminal_session_list() -> AppResult<Vec<TerminalMeta>> {
    AppResult::success(terminal::list_sessions())
}

#[tauri::command]
pub fn terminal_session_read(input: TerminalReadInput) -> AppResult<TerminalRead> {
    match terminal::read_session(&input.session_id, input.cursor) {
        Ok(read) => AppResult::success(read),
        Err(error) => AppResult::fail(
            ErrorCode::NotFound,
            error.message,
            Some(serde_json::json!({ "code": error.code })),
        ),
    }
}

#[derive(Debug, Deserialize)]
pub struct TerminalWorkspaceInput {
    #[serde(rename = "device_id")]
    device_id: String,
}

#[tauri::command]
pub fn terminal_default_workspace(
    input: TerminalWorkspaceInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<serde_json::Value> {
    let actor_ptid = session_resolver::ptid_for_window(state.inner(), &window).unwrap_or_default();
    if !actor_ptid.starts_with("ptid:") || input.device_id.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        );
    }
    match crate::application::desktop_executor_worker::workspace_grants::provision_actor_workspace(
        &actor_ptid,
        input.device_id.trim(),
    ) {
        Ok(root) => AppResult::success(serde_json::json!({
            "workspaceRoot": root.to_string_lossy(),
        })),
        Err(error) => AppResult::fail(
            ErrorCode::InternalError,
            format!("provision terminal workspace: {error}"),
            None,
        ),
    }
}

// ── Station metadata proxy (authenticated) ──────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AgentTerminalCreateInput {
    pub session_id: String,
    pub conversation_id: String,
    #[serde(default)]
    pub turn_id: String,
    pub device_id: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub pid: u32,
}

#[derive(Debug, Deserialize)]
pub struct AgentTerminalUpdateInput {
    pub session_id: String,
    pub status: String,
    #[serde(default)]
    pub exit_code: i32,
    #[serde(default)]
    pub output_bytes: u64,
}

#[derive(Debug, Deserialize)]
pub struct AgentTerminalListInput {
    pub conversation_id: String,
}

#[derive(Debug, Deserialize)]
pub struct AgentTerminalReconcileInput {
    pub device_id: String,
    #[serde(default)]
    pub live_session_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct AgentTerminalSessionInput {
    pub session_id: String,
}

fn terminal_status(name: &str) -> agent::TerminalSessionStatus {
    agent::TerminalSessionStatus::from_str_name(name)
        .unwrap_or(agent::TerminalSessionStatus::Unspecified)
}

fn station_token(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<String, AppResult<Vec<u8>>> {
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
pub fn agent_terminal_session_create(
    input: AgentTerminalCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match station_token(&state, &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::CreateTerminalSessionRequest {
        session_id: input.session_id,
        conversation_id: input.conversation_id,
        turn_id: input.turn_id,
        device_id: input.device_id,
        cwd: input.cwd,
        command: input.command,
        args: input.args,
        pid: input.pid,
    };
    session_rpc::create(state.station.client(), &token, &request)
}

#[tauri::command]
pub fn agent_terminal_session_update(
    input: AgentTerminalUpdateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match station_token(&state, &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::UpdateTerminalSessionRequest {
        session_id: input.session_id,
        status: terminal_status(&input.status) as i32,
        exit_code: input.exit_code,
        output_bytes: input.output_bytes,
    };
    session_rpc::update(state.station.client(), &token, &request)
}

#[tauri::command]
pub fn agent_terminal_session_list(
    input: AgentTerminalListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match station_token(&state, &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::ListTerminalSessionsRequest {
        conversation_id: input.conversation_id,
    };
    session_rpc::list(state.station.client(), &token, &request)
}

#[tauri::command]
pub fn agent_terminal_session_reconcile(
    input: AgentTerminalReconcileInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match station_token(&state, &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::ReconcileTerminalSessionsRequest {
        device_id: input.device_id,
        live_session_ids: input.live_session_ids,
    };
    session_rpc::reconcile(state.station.client(), &token, &request)
}

#[tauri::command]
pub fn agent_terminal_session_remove(
    input: AgentTerminalSessionInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match station_token(&state, &window) { Ok(token) => token, Err(error) => return error };
    let request = agent::RemoveTerminalSessionRequest {
        session_id: input.session_id,
    };
    session_rpc::remove(state.station.client(), &token, &request)
}
