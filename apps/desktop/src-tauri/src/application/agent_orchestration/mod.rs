use crate::application::agents as application_agents;
use crate::contracts::{
    AgentCollaborationCancelInput, AgentCollaborationCancelTaskInput,
    AgentCollaborationClaimExecutorInput, AgentCollaborationCreateInput,
    AgentCollaborationGetInput, AgentCollaborationHeartbeatLeaseInput,
    AgentCollaborationListEventsInput, AgentCollaborationListInput,
    AgentCollaborationReleaseLeaseInput, AgentCollaborationResumeTaskInput,
    AgentCollaborationSubmitNodeResultInput, AgentCollaborationSubscribeInput, StubPayload,
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

fn resolve_station_agent_ids(
    agent_ids: &[String],
    token: &str,
    local_actor_id: &str,
) -> Result<Vec<String>, AppResult<StubPayload>> {
    let local_agents = local_agents_by_id(local_actor_id);
    let mut station_agents = match list_station_agents(token) {
        Ok(agents) => agents,
        Err(error) => return Err(error.into_app_result("Failed to list Station Agents")),
    };

    let mut resolved = Vec::with_capacity(agent_ids.len());
    for raw_id in agent_ids {
        let id = raw_id.trim();
        if id.is_empty() {
            continue;
        }
        if station_agent_id_exists(&station_agents, id) {
            resolved.push(id.to_string());
            continue;
        }
        let Some(local_agent) = local_agents.get(id) else {
            // Preserve already-Station ids and let Station return the precise runtime error.
            resolved.push(id.to_string());
            continue;
        };
        let name = value_string(local_agent, &["name"]).unwrap_or_else(|| id.to_string());
        if let Some(station_id) = find_station_agent_id_by_name(&station_agents, &name) {
            resolved.push(station_id);
            continue;
        }
        let created = match create_station_agent_from_local(local_agent, token) {
            Ok(agent) => agent,
            Err(error) => return Err(error.into_app_result("Failed to sync Agent to Station")),
        };
        let station_id = value_string(&created, &["agent_id", "agentId", "id"])
            .unwrap_or_else(|| id.to_string());
        station_agents.push(created);
        resolved.push(station_id);
    }

    Ok(resolved)
}

fn local_agents_by_id(local_actor_id: &str) -> HashMap<String, Value> {
    let result = application_agents::agents_list(local_actor_id);
    let Some(payload) = result.data else {
        return HashMap::new();
    };
    let Ok(status) = serde_json::from_str::<Value>(&payload.status) else {
        return HashMap::new();
    };
    status
        .get("agents")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|agent| value_string(agent, &["id"]).map(|id| (id, agent.clone())))
        .collect()
}

fn list_station_agents(token: &str) -> Result<Vec<Value>, station_client::StationClientError> {
    let result = station_client::request_json(
        Method::POST,
        "/sub-agent/agent/list",
        token,
        None,
        Some(json!({ "page": 1, "pageSize": 100 })),
    )?;
    Ok(result
        .get("agents")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

fn create_station_agent_from_local(
    local_agent: &Value,
    token: &str,
) -> Result<Value, station_client::StationClientError> {
    let name = value_string(local_agent, &["name"]).unwrap_or_else(|| "agent".to_string());
    let title = value_string(local_agent, &["title"]).unwrap_or_else(|| name.clone());
    let description = value_string(local_agent, &["description"]).unwrap_or_default();
    let provider_id = value_string(local_agent, &["provider", "providerId"]).unwrap_or_default();
    let model_name = value_string(local_agent, &["model", "modelName"]).unwrap_or_default();
    let effort = value_string(local_agent, &["effort"]).unwrap_or_else(|| "medium".to_string());
    let config_json = station_agent_config_from_local(local_agent).to_string();

    let result = station_client::request_json(
        Method::POST,
        "/sub-agent/agent/create",
        token,
        None,
        Some(json!({
            "name": name,
            "title": title,
            "description": description,
            "providerId": provider_id,
            "modelName": model_name,
            "effort": effort,
            "config_json": config_json,
        })),
    )?;
    Ok(result.get("agent").cloned().unwrap_or(result))
}

fn station_agent_config_from_local(local_agent: &Value) -> Value {
    let cli_command = value_string(local_agent, &["cliCommand", "cli_command"]).unwrap_or_default();
    let runtime_kind = if cli_command.is_empty() {
        value_string(local_agent, &["runtimeKind", "runtime_kind"]).unwrap_or_default()
    } else {
        "cli".to_string()
    };
    let executor_kind = if cli_command.is_empty() {
        "station_hosted"
    } else {
        "desktop_device"
    };
    json!({
        "systemPrompt": value_string(local_agent, &["systemPrompt"]).unwrap_or_default(),
        "soulMd": value_string(local_agent, &["soulMd"]).unwrap_or_default(),
        "agentsMd": value_string(local_agent, &["agentsMd"]).unwrap_or_default(),
        "rootfsPath": value_string(local_agent, &["rootfsPath"]).unwrap_or_default(),
        "workspaceMode": value_string(local_agent, &["workspaceMode"]).unwrap_or_default(),
        "runtimeBackend": value_string(local_agent, &["runtimeBackend"]).unwrap_or_default(),
        "runtimeKind": runtime_kind,
        "executorKind": executor_kind,
        "cliCommand": cli_command,
        "cli_command": cli_command,
    })
}

fn station_agent_id_exists(station_agents: &[Value], id: &str) -> bool {
    station_agents
        .iter()
        .any(|agent| value_string(agent, &["agent_id", "agentId", "id"]).as_deref() == Some(id))
}

fn find_station_agent_id_by_name(station_agents: &[Value], name: &str) -> Option<String> {
    station_agents.iter().find_map(|agent| {
        let agent_name = value_string(agent, &["name"])?;
        if agent_name == name {
            value_string(agent, &["agent_id", "agentId", "id"])
        } else {
            None
        }
    })
}

fn value_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

pub fn agent_collaboration_create(
    input: AgentCollaborationCreateInput,
    token: &str,
    local_actor_id: &str,
) -> AppResult<StubPayload> {
    if input.title.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "title is required", None);
    }
    if input.agent_ids.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "agent_ids is required", None);
    }
    let station_agent_ids = match resolve_station_agent_ids(&input.agent_ids, token, local_actor_id)
    {
        Ok(ids) => ids,
        Err(result) => return result,
    };
    let station_judge_agent_id = input
        .judge_agent_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .and_then(|judge_id| {
            input
                .agent_ids
                .iter()
                .position(|id| id.trim() == judge_id)
                .and_then(|index| station_agent_ids.get(index).cloned())
                .or_else(|| {
                    resolve_station_agent_ids(&[judge_id.to_string()], token, local_actor_id)
                        .ok()
                        .and_then(|ids| ids.into_iter().next())
                })
        })
        .unwrap_or_default();
    let body = json!({
        "title": input.title,
        "description": input.description,
        "engineType": input.engine_type,
        "workspaceId": input.workspace_id.unwrap_or_default(),
        "budgetTokens": input.budget_tokens.unwrap_or(0.0),
        "budgetMoney": input.budget_money.unwrap_or(0.0),
        "budgetTimeMs": input.budget_time_ms.unwrap_or(0),
        "meta": {
            "agent_ids": serde_json::to_string(&station_agent_ids).unwrap_or_default(),
            "desktop_agent_ids": serde_json::to_string(&input.agent_ids).unwrap_or_default(),
            "judge_agent_id": station_judge_agent_id,
            "desktop_judge_agent_id": input.judge_agent_id.unwrap_or_default(),
            "source": "desktop.agent_canvas"
        }
    });

    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/collaboration/create",
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
        "/sub-agent/agent/collaboration/cancel",
        token,
        None,
        Some(json!({ "taskId": task_id })),
    ) {
        Ok(result) => success_payload("agent_collaboration_cancel_task", result),
        Err(err) => err.into_app_result("Failed to cancel collaboration task"),
    }
}

pub fn agent_collaboration_resume_task(
    input: AgentCollaborationResumeTaskInput,
    token: &str,
) -> AppResult<StubPayload> {
    let task_id = input.task_id.trim();
    if task_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "task_id is required", None);
    }
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/collaboration/resume",
        token,
        None,
        Some(json!({ "taskId": task_id })),
    ) {
        Ok(result) => success_payload("agent_collaboration_resume_task", result),
        Err(err) => err.into_app_result("Failed to resume collaboration task"),
    }
}

pub fn agent_collaboration_submit_node_result(
    input: AgentCollaborationSubmitNodeResultInput,
    token: &str,
) -> AppResult<StubPayload> {
    let task_id = input.task_id.trim();
    let node_id = input.node_id.trim();
    let lease_id = input.lease_id.as_deref().unwrap_or_default().trim();
    let executor_id = input.executor_id.as_deref().unwrap_or_default().trim();
    if task_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "task_id is required", None);
    }
    if node_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "node_id is required", None);
    }
    if lease_id.is_empty() || executor_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "lease_id and executor_id are required",
            None,
        );
    }
    let body = json!({
        "taskId": task_id,
        "nodeId": node_id,
        "resultSummary": input.result_summary.trim(),
        "status": input.status.unwrap_or_else(|| "completed".to_string()),
        "turnId": input.turn_id.unwrap_or_default(),
        "leaseId": lease_id,
        "executorId": executor_id,
        "meta": {
            "source": "desktop.executor"
        }
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/collaboration/node/submit-result",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_collaboration_submit_node_result", result),
        Err(err) => err.into_app_result("Failed to submit collaboration node result"),
    }
}

pub fn agent_collaboration_claim_executor_task(
    input: AgentCollaborationClaimExecutorInput,
    token: &str,
) -> AppResult<StubPayload> {
    let executor_id = input.executor_id.trim();
    if executor_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "executor_id is required", None);
    }
    let body = json!({
        "executorId": executor_id,
        "leaseTtlMs": input.lease_ttl_ms.unwrap_or(0),
        "taskId": input.task_id.unwrap_or_default(),
        "agentId": input.agent_id.unwrap_or_default(),
        "nodeId": input.node_id.unwrap_or_default(),
        "capabilities": input.capabilities.unwrap_or_default(),
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/collaboration/executor/claim",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_collaboration_claim_executor_task", result),
        Err(err) => err.into_app_result("Failed to claim desktop executor task"),
    }
}

pub fn agent_collaboration_heartbeat_executor_lease(
    input: AgentCollaborationHeartbeatLeaseInput,
    token: &str,
) -> AppResult<StubPayload> {
    let lease_id = input.lease_id.trim();
    let executor_id = input.executor_id.trim();
    if lease_id.is_empty() || executor_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "lease_id and executor_id are required",
            None,
        );
    }
    let body = json!({
        "leaseId": lease_id,
        "executorId": executor_id,
        "leaseTtlMs": input.lease_ttl_ms.unwrap_or(0),
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/collaboration/executor/heartbeat",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_collaboration_heartbeat_executor_lease", result),
        Err(err) => err.into_app_result("Failed to heartbeat desktop executor lease"),
    }
}

pub fn agent_collaboration_release_executor_lease(
    input: AgentCollaborationReleaseLeaseInput,
    token: &str,
) -> AppResult<StubPayload> {
    let lease_id = input.lease_id.trim();
    let executor_id = input.executor_id.trim();
    if lease_id.is_empty() || executor_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "lease_id and executor_id are required",
            None,
        );
    }
    let body = json!({
        "leaseId": lease_id,
        "executorId": executor_id,
        "status": input.status.unwrap_or_else(|| "released".to_string()),
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/collaboration/executor/release",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_collaboration_release_executor_lease", result),
        Err(err) => err.into_app_result("Failed to release desktop executor lease"),
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
        "/sub-agent/agent/collaboration/get",
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
        "/sub-agent/agent/collaboration/list",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_collaboration_list", result),
        Err(err) => err.into_app_result("Failed to list collaboration tasks"),
    }
}

pub fn agent_collaboration_list_events(
    input: AgentCollaborationListEventsInput,
    token: &str,
) -> AppResult<StubPayload> {
    let task_id = input.task_id.trim();
    if task_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "task_id is required", None);
    }
    let body = json!({
        "taskId": task_id,
        "afterEventSeq": input.after_event_seq.unwrap_or(0),
        "pageSize": input.page_size.unwrap_or(100),
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/collaboration/events/list",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_collaboration_list_events", result),
        Err(err) => err.into_app_result("Failed to list collaboration events"),
    }
}

pub fn agent_collaboration_subscribe(
    app: AppHandle,
    stream_id: String,
    input: AgentCollaborationSubscribeInput,
    token: String,
    cancel_flag: Arc<AtomicBool>,
) {
    if let Err(error) = stream_station_agent_events(
        &app,
        &stream_id,
        &input.agent_id,
        input.task_id.as_deref(),
        input.after_event_seq.unwrap_or(0),
        &token,
        &cancel_flag,
    ) {
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
    task_id: Option<&str>,
    after_event_seq: i64,
    token: &str,
    cancel_flag: &AtomicBool,
) -> Result<(), String> {
    let url = format!(
        "{}{}",
        station_client::station_base_url(),
        "/sub-agent/agent/events/subscribe"
    );
    let client = Client::builder()
        .build()
        .map_err(|error| format!("failed to create Station event client: {error}"))?;
    let auth = format!("Bearer {}", token.trim());
    let mut body = json!({
        "agent_id": agent_id,
        "after_event_seq": after_event_seq.max(0),
    });
    if let Some(task_id) = task_id.map(str::trim).filter(|value| !value.is_empty()) {
        body["task_id"] = json!(task_id);
    }
    let mut response = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, auth)
        .header("Accept", "text/event-stream")
        .json(&body)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn station_agent_config_marks_cli_agent_as_desktop_executor() {
        let config = station_agent_config_from_local(&json!({
            "systemPrompt": "You are a CLI agent.",
            "provider": "trae-cli",
            "model": "trae-cli",
            "cliCommand": "traecli exec --skip-git-repo-check -",
            "runtimeBackend": "host"
        }));

        assert_eq!(config["runtimeKind"], "cli");
        assert_eq!(config["executorKind"], "desktop_device");
        assert_eq!(config["cliCommand"], "traecli exec --skip-git-repo-check -");
        assert_eq!(
            config["cli_command"],
            "traecli exec --skip-git-repo-check -"
        );
    }

    #[test]
    fn station_agent_config_defaults_to_station_hosted_without_cli_command() {
        let config = station_agent_config_from_local(&json!({
            "systemPrompt": "You are a hosted agent.",
            "provider": "openai",
            "model": "gpt-4.1"
        }));

        assert_eq!(config["executorKind"], "station_hosted");
        assert_eq!(config["cliCommand"], "");
    }
}
