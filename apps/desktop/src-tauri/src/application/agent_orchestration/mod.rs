use crate::contracts::{
    AgentCollaborationCancelInput, AgentCollaborationCancelTaskInput,
    AgentCollaborationCreateInput, AgentCollaborationGetInput, AgentCollaborationListInput,
    AgentCollaborationSubscribeInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use reqwest::blocking::Client;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::Method;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

const AGENT_COLLABORATION_EVENT: &str = "agent:collaboration-event";

#[derive(Clone, Serialize)]
struct AgentCollaborationEventPayload {
    #[serde(rename = "streamId")]
    stream_id: String,
    #[serde(rename = "agentId")]
    agent_id: String,
    event: String,
    data: Value,
}

fn stream_cancel_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

pub fn agent_collaboration_create(
    input: AgentCollaborationCreateInput,
    token: &str,
) -> AppResult<StubPayload> {
    if input.title.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "title is required", None);
    }
    if input.agent_ids.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "agent_ids is required", None);
    }
    let body = json!({
        "title": input.title,
        "description": input.description,
        "engineType": input.engine_type,
        "workspaceId": input.workspace_id.unwrap_or_default(),
        "budgetTokens": input.budget_tokens.unwrap_or(0.0),
        "budgetMoney": input.budget_money.unwrap_or(0.0),
        "budgetTimeMs": input.budget_time_ms.unwrap_or(0),
        "meta": {
            "agent_ids": serde_json::to_string(&input.agent_ids).unwrap_or_default(),
            "source": "desktop.agent_canvas"
        }
    });

    match station_client::request_json(
        Method::POST,
        "/agent/collaboration/create",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_collaboration_create", result),
        Err(err) => err.into_app_result("Failed to create collaboration task"),
    }
}

pub fn register_collaboration_stream(stream_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut registry) = stream_cancel_registry().lock() {
        registry.insert(stream_id.to_string(), Arc::clone(&flag));
    }
    flag
}

pub fn unregister_collaboration_stream(stream_id: &str) {
    if let Ok(mut registry) = stream_cancel_registry().lock() {
        registry.remove(stream_id);
    }
}

pub fn cancel_collaboration_stream(input: AgentCollaborationCancelInput) -> AppResult<StubPayload> {
    if let Ok(registry) = stream_cancel_registry().lock() {
        if let Some(flag) = registry.get(input.stream_id.trim()) {
            flag.store(true, Ordering::SeqCst);
        }
    }
    success_payload(
        "agent_collaboration_cancel_stream",
        json!({ "stream_id": input.stream_id }),
    )
}

pub fn agent_collaboration_cancel_task(
    input: AgentCollaborationCancelTaskInput,
    token: &str,
) -> AppResult<StubPayload> {
    let task_id = input.task_id.trim();
    if task_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "task_id is required", None);
    }
    match station_client::request_json(
        Method::POST,
        "/agent/collaboration/cancel",
        token,
        None,
        Some(json!({ "taskId": task_id })),
    ) {
        Ok(result) => success_payload("agent_collaboration_cancel_task", result),
        Err(err) => err.into_app_result("Failed to cancel collaboration task"),
    }
}

pub fn agent_collaboration_get(
    input: AgentCollaborationGetInput,
    token: &str,
) -> AppResult<StubPayload> {
    let task_id = input.task_id.trim();
    if task_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "task_id is required", None);
    }
    match station_client::request_json(
        Method::POST,
        "/agent/collaboration/get",
        token,
        None,
        Some(json!({ "taskId": task_id })),
    ) {
        Ok(result) => success_payload("agent_collaboration_get", result),
        Err(err) => err.into_app_result("Failed to get collaboration task"),
    }
}

pub fn agent_collaboration_list(
    input: AgentCollaborationListInput,
    token: &str,
) -> AppResult<StubPayload> {
    let body = json!({
        "status": input.status.unwrap_or(0),
        "page": input.page.unwrap_or(1),
        "pageSize": input.page_size.unwrap_or(20),
    });
    match station_client::request_json(
        Method::POST,
        "/agent/collaboration/list",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_collaboration_list", result),
        Err(err) => err.into_app_result("Failed to list collaboration tasks"),
    }
}

pub fn agent_collaboration_subscribe(
    app: AppHandle,
    stream_id: String,
    input: AgentCollaborationSubscribeInput,
    token: String,
    cancel_flag: Arc<AtomicBool>,
) {
    if let Err(error) =
        stream_station_agent_events(&app, &stream_id, &input.agent_id, &token, &cancel_flag)
    {
        emit_collaboration_event(
            &app,
            &stream_id,
            &input.agent_id,
            "error",
            json!({ "error": error }),
        );
    }
}

fn stream_station_agent_events(
    app: &AppHandle,
    stream_id: &str,
    agent_id: &str,
    token: &str,
    cancel_flag: &AtomicBool,
) -> Result<(), String> {
    let url = format!(
        "{}{}",
        station_client::station_base_url(),
        "/agent/events/subscribe"
    );
    let client = Client::builder()
        .build()
        .map_err(|error| format!("failed to create Station event client: {error}"))?;
    let auth = format!("Bearer {}", token.trim());
    let mut response = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, auth)
        .header("Accept", "text/event-stream")
        .json(&json!({ "agent_id": agent_id }))
        .send()
        .map_err(|error| format!("Station agent event stream request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Station agent event stream returned HTTP {}",
            response.status()
        ));
    }

    let mut bytes = [0_u8; 4096];
    let mut buffer = String::new();
    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            return Ok(());
        }
        let read = response
            .read(&mut bytes)
            .map_err(|error| format!("failed to read Station agent event stream: {error}"))?;
        if read == 0 {
            break;
        }
        buffer.push_str(&String::from_utf8_lossy(&bytes[..read]));
        while let Some(frame_end) = buffer.find("\n\n") {
            let frame = buffer[..frame_end].to_string();
            buffer = buffer[frame_end + 2..].to_string();
            if let Some((event, data)) = parse_sse_frame(&frame) {
                emit_collaboration_event(app, stream_id, agent_id, &event, data);
            }
        }
    }
    Ok(())
}

fn parse_sse_frame(frame: &str) -> Option<(String, Value)> {
    let mut event = "message".to_string();
    let mut data_lines = Vec::new();
    for line in frame.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(value) = line.strip_prefix("event:") {
            event = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("data:") {
            data_lines.push(value.trim_start().to_string());
        }
    }
    if data_lines.is_empty() {
        return None;
    }
    let data = data_lines.join("\n");
    let parsed = serde_json::from_str::<Value>(&data).unwrap_or_else(|_| json!({ "raw": data }));
    Some((event, parsed))
}

fn emit_collaboration_event(
    app: &AppHandle,
    stream_id: &str,
    agent_id: &str,
    event: &str,
    data: Value,
) {
    if let Err(error) = app.emit(
        AGENT_COLLABORATION_EVENT,
        AgentCollaborationEventPayload {
            stream_id: stream_id.to_string(),
            agent_id: agent_id.to_string(),
            event: event.to_string(),
            data,
        },
    ) {
        tracing::warn!(error = %error, "Failed to emit Agent collaboration event");
    }
}
