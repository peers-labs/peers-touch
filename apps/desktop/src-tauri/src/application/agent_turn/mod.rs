// `ExecuteTurnRequest` / `ExecuteTurnResponse` exist in `model::agent`, but Station's
// `HandleExecuteTurn` binds JSON to ad-hoc Go structs (not generated protos) and the JSON
// payload includes fields not present on the proto (identity, platform, workspace_root, …).
// `TypedHandler` protobuf mode requires `proto.Message` request types. Keep JSON until the
// subserver handler and proto definitions are aligned with the desktop contract.
// TODO(agent): align `agent.proto` + Station `HandleExecuteTurn` with the full turn payload, then use `request_proto`.
use crate::application::error_resolver::ProviderKind;
use crate::application::{agent_workspace, error_resolver, mcp, tools};
use crate::contracts::{
    AgentConversationArchiveInput, AgentConversationCreateInput, AgentConversationGetInput,
    AgentConversationListInput, AgentConversationMessagesInput, AgentConversationReplayEventsInput,
    AgentExecuteTurnInput, AgentGroupCreateInput, AgentGroupDeleteInput, AgentGroupUpdateInput,
    AgentKnowledgeBindingCreateInput, AgentKnowledgeBindingDeleteInput,
    AgentKnowledgeBindingListInput, AgentKnowledgeBindingUpdateInput, AgentLocalToolRequestInput,
    AgentMessageTranslateInput, AgentTaskCreateInput, AgentTaskDeleteInput, AgentTaskListInput,
    AgentTaskStatusInput, AgentTaskSubtaskAddInput, AgentTaskSubtaskCompleteInput,
    AgentThreadCreateInput, AgentThreadListInput, AgentThreadMessagesInput,
    AgentToolApprovalDecisionInput, AgentTurnTraceGetInput, AgentTurnTraceListInput,
    McpExecuteToolInput, StubPayload, TopicCommentCreateInput, TopicCommentDeleteInput,
    TopicCommentListInput,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model::agent;
use reqwest::blocking::Client;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::Method;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const AGENT_TURN_STREAM_EVENT: &str = "agent:turn-stream-event";
const TOOL_APPROVAL_TIMEOUT: Duration = Duration::from_secs(300);

type ApprovalWaiter = Arc<(Mutex<Option<ToolApprovalDecision>>, Condvar)>;

#[derive(Clone)]
struct ToolApprovalDecision {
    approved: bool,
    actor: String,
    decided_at: String,
}

fn stream_cancel_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn stream_turn_registry() -> &'static Mutex<HashMap<String, String>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn tool_approval_registry() -> &'static Mutex<HashMap<String, ApprovalWaiter>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, ApprovalWaiter>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn decide_tool_approval(input: AgentToolApprovalDecisionInput) -> AppResult<StubPayload> {
    let approval_id = input.approval_id.trim().to_string();
    if approval_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "approval_id is required", None);
    }
    let Some(waiter) = tool_approval_registry()
        .lock()
        .ok()
        .and_then(|registry| registry.get(&approval_id).cloned())
    else {
        return AppResult::fail(ErrorCode::NotFound, "tool approval request not found", None);
    };
    let decision = ToolApprovalDecision {
        approved: input.approved,
        actor: input
            .actor
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("desktop-user")
            .to_string(),
        decided_at: now_iso_utc(),
    };
    let (lock, cvar) = &*waiter;
    if let Ok(mut state) = lock.lock() {
        *state = Some(decision.clone());
        cvar.notify_all();
    }
    success_payload(
        "agent_decide_tool_approval",
        json!({
            "ok": true,
            "approvalId": approval_id,
            "approved": decision.approved,
            "actor": decision.actor,
            "decidedAt": decision.decided_at
        }),
    )
}

pub fn register_agent_turn_stream(stream_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut registry) = stream_cancel_registry().lock() {
        registry.insert(stream_id.to_string(), Arc::clone(&flag));
    }
    flag
}

pub fn unregister_agent_turn_stream(stream_id: &str) {
    if let Ok(mut registry) = stream_cancel_registry().lock() {
        registry.remove(stream_id);
    }
    if let Ok(mut registry) = stream_turn_registry().lock() {
        registry.remove(stream_id);
    }
}

pub fn cancel_agent_turn_stream(stream_id: &str, token: &str) -> AppResult<StubPayload> {
    let stopped = if let Ok(registry) = stream_cancel_registry().lock() {
        registry
            .get(stream_id)
            .map(|flag| {
                flag.store(true, Ordering::SeqCst);
                true
            })
            .unwrap_or(false)
    } else {
        false
    };
    let turn_id = stream_turn_registry()
        .lock()
        .ok()
        .and_then(|registry| registry.get(stream_id).cloned())
        .unwrap_or_default();
    let station_cancelled = if !turn_id.is_empty() && !token.trim().is_empty() {
        station_client::request_json_auth(
            Method::POST,
            "/sub-agent/agent/turn/cancel",
            token,
            None,
            Some(&json!({ "turn_id": turn_id })),
        )
        .is_ok()
    } else {
        false
    };
    success_payload(
        "agent_cancel_turn_stream",
        json!({
            "stream_id": stream_id,
            "turn_id": turn_id,
            "stopped": stopped,
            "station_cancelled": station_cancelled
        }),
    )
}

fn remember_stream_turn(stream_id: &str, data: &Value) {
    let turn_id = data
        .get("turnId")
        .or_else(|| data.get("turn_id"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if turn_id.is_empty() {
        return;
    }
    if let Ok(mut registry) = stream_turn_registry().lock() {
        registry.insert(stream_id.to_string(), turn_id.to_string());
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentTurnStreamEventPayload {
    stream_id: String,
    event: String,
    data: Value,
}

struct CollectedTurn {
    text: String,
    model: String,
    done: bool,
    error: Option<String>,
}

impl CollectedTurn {
    fn new() -> Self {
        Self {
            text: String::new(),
            model: String::new(),
            done: false,
            error: None,
        }
    }

    fn apply_event(&mut self, event: &str, data: &Value) {
        match event {
            "text" => {
                if let Some(text) = string_field(data, "text")
                    .or_else(|| string_field(data, "content"))
                    .or_else(|| string_field(data, "result"))
                {
                    self.text.push_str(&text);
                }
                if let Some(m) = string_field(data, "model") {
                    self.model = m;
                }
            }
            "thinking" => {}
            "done" => {
                if let Some(m) = string_field(data, "model") {
                    self.model = m;
                }
                self.done = true;
            }
            "error" => {
                self.error = Some(
                    string_field(data, "error")
                        .or_else(|| string_field(data, "message"))
                        .unwrap_or_else(|| "Unknown stream error".to_string()),
                );
            }
            _ => {}
        }
    }
}

fn collect_turn_text_via_stream(body: &Value, token: &str) -> Result<(String, String), String> {
    let url = format!(
        "{}{}",
        station_client::station_base_url(),
        "/sub-agent/agent/turn/stream"
    );
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("failed to create Station stream client: {error}"))?;
    let auth = format!("Bearer {}", token.trim());
    let mut response = client
        .post(&url)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, auth)
        .header("Accept", "text/event-stream")
        .json(body)
        .send()
        .map_err(|error| format!("Station turn stream request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Station turn stream returned HTTP {}",
            response.status()
        ));
    }

    let mut bytes = [0_u8; 4096];
    let mut buffer = String::new();
    let mut collected = CollectedTurn::new();

    loop {
        let read = response
            .read(&mut bytes)
            .map_err(|error| format!("failed to read Station turn stream: {error}"))?;
        if read == 0 {
            break;
        }
        buffer.push_str(&String::from_utf8_lossy(&bytes[..read]));
        while let Some(frame_end) = buffer.find("\n\n") {
            let frame = buffer[..frame_end].to_string();
            buffer = buffer[frame_end + 2..].to_string();
            if let Some((event, data)) = parse_sse_frame(&frame) {
                collected.apply_event(&event, &data);
            }
        }
        if collected.done {
            break;
        }
    }

    if !buffer.trim().is_empty() {
        if let Some((event, data)) = parse_sse_frame(&buffer) {
            collected.apply_event(&event, &data);
        }
    }

    if let Some(err) = collected.error {
        return Err(err);
    }

    if collected.text.is_empty() {
        return Err("agent turn produced no text response".to_string());
    }

    Ok((collected.text, collected.model))
}

pub fn agent_execute_turn(
    mut input: AgentExecuteTurnInput,
    token: &str,
    _actor_id: &str,
) -> AppResult<StubPayload> {
    if let Err(error) = apply_resolved_agent_workspace(&mut input) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }

    let provider = input.provider.as_deref().unwrap_or("").trim().to_string();
    let provider_normalized = provider.to_ascii_lowercase();
    let is_cli = matches!(
        provider_normalized.as_str(),
        "trae-cli"
            | "codex-cli"
            | "claude-cli"
            | "cursor-cli"
            | "trae"
            | "codex"
            | "claude"
            | "cursor"
    ) || input.runtime_backend.as_deref().unwrap_or("") == "cli"
        || input.cli_command.is_some();

    if is_cli && input.cli_command.is_none() {
        input.cli_command = Some(default_cli_command(&provider_normalized));
    }
    if is_cli && input.runtime_backend.is_none() {
        input.runtime_backend = Some("cli".to_string());
    }

    tracing::info!(
        command = "agent_execute_turn",
        agent_id = %input.agent_id,
        conversation_id = %input.conversation_id,
        is_cli = is_cli,
        "Executing agent turn via Station"
    );

    let body = build_turn_request_body(input.clone(), true);

    let cli_binary = if is_cli {
        input
            .cli_command
            .as_deref()
            .unwrap_or("")
            .split_whitespace()
            .next()
            .unwrap_or("")
    } else {
        ""
    };

    match collect_turn_text_via_stream(&body, token) {
        Ok((content, model_name)) => {
            let effective_model = if model_name.is_empty() {
                input.model.as_deref().unwrap_or("").to_string()
            } else {
                model_name
            };
            tracing::info!(
                command = "agent_execute_turn",
                content_len = content.len(),
                model = %effective_model,
                "Turn execution succeeded"
            );
            let result = json!({
                "response_message": {
                    "role": "assistant",
                    "content": content,
                },
                "turn": {
                    "agent_id": input.agent_id,
                    "conversation_id": input.conversation_id,
                    "final_response": content,
                    "status": "TURN_STATUS_COMPLETED",
                    "model": effective_model,
                },
                "trace": {
                    "model": effective_model,
                },
            });
            let status =
                serde_json::to_string(&result).unwrap_or_else(|_| r#"{"status":"ok"}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_execute_turn".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_execute_turn", error = %err, "Turn execution failed, falling back to non-streaming");
            let body_fallback = build_turn_request_body(input.clone(), false);
            match station_client::request_json(
                Method::POST,
                "/sub-agent/agent/turn/execute",
                token,
                None,
                Some(body_fallback),
            ) {
                Ok(result) => {
                    let status = serde_json::to_string(&result)
                        .unwrap_or_else(|_| r#"{"status":"ok"}"#.to_string());
                    AppResult::success(StubPayload {
                        command: "agent_execute_turn".to_string(),
                        status,
                    })
                }
                Err(fb_err) => {
                    tracing::error!(command = "agent_execute_turn", error = %fb_err, "Fallback also failed");
                    resolved_turn_failure(
                        &provider,
                        is_cli,
                        cli_binary,
                        &fb_err.to_string(),
                        fb_err.details.as_ref(),
                    )
                }
            }
        }
    }
}

pub fn agent_turn_trace_list(
    input: AgentTurnTraceListInput,
    token: &str,
) -> AppResult<StubPayload> {
    let agent_id = input.agent_id.trim().to_string();
    if agent_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "agent_id is required", None);
    }
    let body = json!({
        "agent_id": agent_id,
        "conversation_id": input.conversation_id.unwrap_or_default(),
        "page": input.page.unwrap_or(1),
        "page_size": input.page_size.unwrap_or(20),
    });

    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/turn/trace/list",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_turn_trace_list", result),
        Err(err) => {
            tracing::error!(command = "agent_turn_trace_list", error = %err, "Turn trace list query failed");
            err.into_app_result("Failed to list agent turn traces")
        }
    }
}

pub fn agent_turn_trace_get(input: AgentTurnTraceGetInput, token: &str) -> AppResult<StubPayload> {
    let trace_id = input.trace_id.unwrap_or_default().trim().to_string();
    let turn_id = input.turn_id.unwrap_or_default().trim().to_string();
    if trace_id.is_empty() && turn_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "trace_id or turn_id is required",
            None,
        );
    }
    let body = json!({
        "trace_id": trace_id,
        "turn_id": turn_id,
    });

    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/turn/trace/get",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_turn_trace_get", result),
        Err(err) => {
            tracing::error!(command = "agent_turn_trace_get", error = %err, "Turn trace get query failed");
            err.into_app_result("Failed to get agent turn trace")
        }
    }
}

pub fn agent_execute_turn_stream(
    app: AppHandle,
    stream_id: String,
    mut input: AgentExecuteTurnInput,
    token: String,
    _actor_id: String,
    cancel_flag: Arc<AtomicBool>,
) {
    let provider = input.provider.as_deref().unwrap_or("").trim().to_string();
    let provider_normalized = provider.trim().to_ascii_lowercase();
    let is_cli_provider = matches!(
        provider_normalized.as_str(),
        "trae-cli"
            | "codex-cli"
            | "claude-cli"
            | "cursor-cli"
            | "trae"
            | "codex"
            | "claude"
            | "cursor"
    ) || input.runtime_backend.as_deref().unwrap_or("") == "cli"
        || input.cli_command.is_some();

    if is_cli_provider && input.cli_command.is_none() {
        input.cli_command = Some(default_cli_command(&provider_normalized));
    }
    if is_cli_provider && input.runtime_backend.is_none() {
        input.runtime_backend = Some("cli".to_string());
    }

    if let Err(error) = apply_resolved_agent_workspace(&mut input) {
        emit_resolved_error(
            &app,
            &stream_id,
            &provider,
            ProviderKind::Direct,
            None,
            &error,
        );
        return;
    }

    let agent_allowed_roots = input.allowed_roots.clone();
    if input.available_tools.is_none() {
        if let Ok(tool_entries) = tools::tools_list_entries() {
            input.available_tools = Some(tool_entries);
        }
    }
    let body = build_turn_request_body(input, true);
    let result = stream_station_turn(
        &app,
        &stream_id,
        &body,
        agent_allowed_roots.as_deref(),
        &token,
        &cancel_flag,
        provider.as_str(),
    );
    if let Err(error) = result {
        emit_resolved_error(
            &app,
            &stream_id,
            &provider,
            ProviderKind::Direct,
            None,
            &error,
        );
    }
}

pub fn agent_resolve_local_tool_request(
    input: AgentLocalToolRequestInput,
) -> AppResult<StubPayload> {
    let source = input.source.trim().to_ascii_lowercase();
    if source != "mcp" && source != "builtin" && source != "plugin" {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            format!("unsupported local tool source: {}", input.source),
            None,
        );
    }
    let tool_name = input.tool_name.trim().to_string();
    if tool_name.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "tool_name is required", None);
    }
    let arguments = input.arguments.unwrap_or_else(|| json!({}));
    let call_id = input.call_id.unwrap_or_default();
    let turn_id = input.turn_id.unwrap_or_default();
    let (server_name, execution_value) = if source == "mcp" {
        let Some(server_name) = input
            .server_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
        else {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "server_name is required for MCP tool requests",
                None,
            );
        };
        let execution = mcp::mcp_execute_tool(McpExecuteToolInput {
            server_name: server_name.clone(),
            tool_name: tool_name.clone(),
            arguments: Some(arguments),
            call_id: if call_id.is_empty() {
                None
            } else {
                Some(call_id.clone())
            },
            workspace_root: input.workspace_root.clone(),
            allowed_roots: input.allowed_roots.clone(),
        });
        let Some(payload) = execution.data else {
            return AppResult {
                ok: false,
                data: None,
                error: execution.error,
            };
        };
        let value = serde_json::from_str::<Value>(&payload.status).unwrap_or_else(|error| {
            json!({
                "ok": false,
                "error": format!("failed to decode MCP execution payload: {error}")
            })
        });
        (server_name, value)
    } else if source == "plugin" {
        let Some(plugin_id) = input
            .server_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
        else {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "server_name is required for plugin tool requests",
                None,
            );
        };
        let value = match crate::application::plugins::execute_plugin_tool(
            &plugin_id,
            &tool_name,
            arguments,
            if call_id.is_empty() {
                None
            } else {
                Some(&call_id)
            },
        ) {
            Ok(value) => value,
            Err(error) => json!({
                "ok": false,
                "error": error,
                "audit": {
                    "source": "plugin",
                    "pluginId": plugin_id,
                    "toolName": tool_name,
                    "executionOwner": "desktop-rust",
                    "approvalRequired": true,
                    "deniedAt": now_iso_utc()
                }
            }),
        };
        (plugin_id, value)
    } else {
        let value = match tools::execute_builtin_local_tool(
            &tool_name,
            arguments,
            input.workspace_root.as_deref(),
            input.allowed_roots.as_deref(),
            if call_id.is_empty() {
                None
            } else {
                Some(&call_id)
            },
        ) {
            Ok(value) => value,
            Err(error) => json!({
                "ok": false,
                "error": error,
                "audit": {
                    "source": "builtin",
                    "toolName": tool_name,
                    "executionOwner": "desktop-rust",
                    "approvalRequired": true,
                    "deniedAt": now_iso_utc()
                }
            }),
        };
        ("desktop".to_string(), value)
    };
    success_payload(
        "agent_resolve_local_tool_request",
        build_local_tool_result_event(
            &turn_id,
            &call_id,
            &source,
            &server_name,
            &tool_name,
            execution_value,
        ),
    )
}

fn build_turn_request_body(input: AgentExecuteTurnInput, stream: bool) -> Value {
    let mut body = json!({
        "conversation_id": input.conversation_id,
        "agent_id": input.agent_id,
        "user_input": input.user_input,
        "attachments": input.attachments.unwrap_or_default(),
        "stream": stream,
        "effort": input.effort.unwrap_or_else(|| "medium".to_string()),
        "platform": input.platform.unwrap_or("desktop".to_string()),
        "context_window_size": input.context_window_size.unwrap_or(128000),
        "max_retries": input.max_retries.unwrap_or(3),
        "knowledge_resources": input.knowledge_resources.unwrap_or_default(),
    });
    if let Some(provider) = input.provider.filter(|v| !v.trim().is_empty()) {
        body["provider"] = json!(provider);
    }
    if let Some(model) = input.model.filter(|v| !v.trim().is_empty()) {
        body["model"] = json!(model);
    }
    if let Some(cli_cmd) = input.cli_command.filter(|v| !v.trim().is_empty()) {
        body["cli_command"] = json!(cli_cmd);
    }
    if let Some(runtime) = input.runtime_backend.filter(|v| !v.trim().is_empty()) {
        body["runtime_backend"] = json!(runtime);
    }
    if let Some(roots) = input.allowed_roots.filter(|v| !v.is_empty()) {
        body["allowed_roots"] = json!(roots);
    }
    if let Some(identity) = input.identity.filter(|v| !v.trim().is_empty()) {
        body["identity"] = json!(identity);
    }
    if let Some(prompt) = input.agent_config_prompt.filter(|v| !v.trim().is_empty()) {
        body["agent_config_prompt"] = json!(prompt);
    }
    if let Some(ws_root) = input.workspace_root.filter(|v| !v.trim().is_empty()) {
        body["workspace_root"] = json!(ws_root);
    }
    if let Some(tools) = input.available_tools.filter(|v| !v.is_empty()) {
        body["available_tools"] = json!(tools);
    }
    if let Some(true) = input.memory_disabled {
        body["memory_disabled"] = json!(true);
    }
    body
}

fn apply_resolved_agent_workspace(input: &mut AgentExecuteTurnInput) -> Result<(), String> {
    let workspace = agent_workspace::resolve_agent_workspace(input)?;
    input.workspace_root = Some(workspace.path.to_string_lossy().to_string());
    Ok(())
}

fn stream_station_turn(
    app: &AppHandle,
    stream_id: &str,
    body: &Value,
    agent_allowed_roots: Option<&[String]>,
    token: &str,
    cancel_flag: &AtomicBool,
    provider_id: &str,
) -> Result<(), String> {
    let effective_provider = body
        .get("provider")
        .and_then(|v| v.as_str())
        .unwrap_or(provider_id);
    let cli_command = body
        .get("cli_command")
        .and_then(|v| v.as_str())
        .or_else(|| body.get("cliCommand").and_then(|v| v.as_str()))
        .unwrap_or("");
    let runtime_backend = body
        .get("runtime_backend")
        .and_then(|v| v.as_str())
        .or_else(|| body.get("runtimeBackend").and_then(|v| v.as_str()))
        .unwrap_or("");
    let is_cli_turn = !cli_command.is_empty() || runtime_backend == "cli";
    let cli_binary = if is_cli_turn {
        cli_command.split_whitespace().next().unwrap_or("")
    } else {
        ""
    };

    let url = format!(
        "{}{}",
        station_client::station_base_url(),
        "/sub-agent/agent/turn/stream"
    );
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("failed to create Station stream client: {error}"))?;
    let auth = format!("Bearer {}", token.trim());
    let mut response = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, auth)
        .header("Accept", "text/event-stream")
        .json(body)
        .send()
        .map_err(|error| format!("Station turn stream request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Station turn stream returned HTTP {}",
            response.status()
        ));
    }

    let mut bytes = [0_u8; 4096];
    let mut buffer = String::new();
    let mut error_emitted = false;
    let mut terminal_received = false;
    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            return Ok(());
        }
        let read = response
            .read(&mut bytes)
            .map_err(|error| format!("failed to read Station turn stream: {error}"))?;
        if cancel_flag.load(Ordering::SeqCst) {
            return Ok(());
        }
        if read == 0 {
            break;
        }
        buffer.push_str(&String::from_utf8_lossy(&bytes[..read]));
        while let Some(frame_end) = buffer.find("\n\n") {
            let frame = buffer[..frame_end].to_string();
            buffer = buffer[frame_end + 2..].to_string();
            if let Some((event, data)) = parse_sse_frame(&frame) {
                remember_stream_turn(stream_id, &data);
                if matches!(event.as_str(), "done" | "error" | "cancelled") {
                    terminal_received = true;
                }
                if event == "local_tool_request" {
                    emit_turn_stream_event(app, stream_id, &event, data.clone());
                    if let Err(error) = resolve_and_submit_local_tool_request(
                        app,
                        stream_id,
                        &client,
                        token,
                        &data,
                        agent_allowed_roots,
                    ) {
                        emit_resolved_error(
                            app,
                            stream_id,
                            effective_provider,
                            ProviderKind::Direct,
                            None,
                            &error,
                        );
                        error_emitted = true;
                    }
                    continue;
                }
                if event == "error" {
                    if error_emitted {
                        continue;
                    }
                    error_emitted = true;
                    let raw = data
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error");
                    if is_cli_turn {
                        emit_resolved_error(
                            app,
                            stream_id,
                            effective_provider,
                            ProviderKind::Cli,
                            Some(cli_binary),
                            raw,
                        );
                    } else {
                        emit_resolved_error(
                            app,
                            stream_id,
                            effective_provider,
                            ProviderKind::Direct,
                            None,
                            raw,
                        );
                    }
                } else {
                    emit_turn_stream_event(app, stream_id, &event, data);
                }
            }
        }
    }
    if !buffer.trim().is_empty() {
        if let Some((event, data)) = parse_sse_frame(&buffer) {
            remember_stream_turn(stream_id, &data);
            if matches!(event.as_str(), "done" | "error" | "cancelled") {
                terminal_received = true;
            }
            if event == "error" {
                if !error_emitted {
                    let raw = data
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error");
                    if is_cli_turn {
                        emit_resolved_error(
                            app,
                            stream_id,
                            effective_provider,
                            ProviderKind::Cli,
                            Some(cli_binary),
                            raw,
                        );
                    } else {
                        emit_resolved_error(
                            app,
                            stream_id,
                            effective_provider,
                            ProviderKind::Direct,
                            None,
                            raw,
                        );
                    }
                }
            } else {
                emit_turn_stream_event(app, stream_id, &event, data);
            }
        }
    }
    if !terminal_received && !cancel_flag.load(Ordering::SeqCst) {
        emit_turn_stream_event(
            app,
            stream_id,
            "reconciling",
            json!({
                "type": "reconciling",
                "reason": "transport_closed_without_terminal"
            }),
        );
    }
    Ok(())
}

fn resolve_and_submit_local_tool_request(
    app: &AppHandle,
    stream_id: &str,
    client: &Client,
    token: &str,
    data: &Value,
    agent_allowed_roots: Option<&[String]>,
) -> Result<(), String> {
    let turn_id = string_field(data, "turnId")
        .ok_or_else(|| "local tool request missing turnId".to_string())?;
    let call_id = string_field(data, "toolCallId")
        .ok_or_else(|| "local tool request missing toolCallId".to_string())?;
    let tool_name = string_field(data, "toolName")
        .ok_or_else(|| "local tool request missing toolName".to_string())?;
    let arguments = value_field(data, "arguments").unwrap_or_else(|| json!({}));
    let server_name = string_field(data, "serverName");
    let source = string_field(data, "source").unwrap_or_else(|| "mcp".to_string());
    let workspace_root = string_field(data, "workspaceRoot");
    let allowed_roots = string_array_field(data, "allowedRoots")
        .or_else(|| string_array_field(data, "allowed_roots"))
        .or_else(|| agent_allowed_roots.map(|roots| roots.to_vec()));
    let approval_id = format!("{}:{}", turn_id, call_id);
    let approval = match wait_for_tool_approval(
        app,
        stream_id,
        &approval_id,
        &turn_id,
        &call_id,
        &source,
        server_name.as_deref().unwrap_or(""),
        &tool_name,
        &arguments,
    ) {
        Ok(decision) => decision,
        Err(error) => {
            return submit_local_tool_result(client, token, &turn_id, &call_id, &error, true);
        }
    };
    emit_turn_stream_event(
        app,
        stream_id,
        "tool_approval_decision",
        json!({
            "type": "tool_approval_decision",
            "approvalId": approval_id,
            "turnId": turn_id,
            "toolCallId": call_id,
            "toolName": tool_name,
            "serverName": server_name.clone().unwrap_or_default(),
            "approved": approval.approved,
            "actor": approval.actor,
            "decidedAt": approval.decided_at
        }),
    );
    if !approval.approved {
        return submit_local_tool_result(
            client,
            token,
            &turn_id,
            &call_id,
            "tool.error.approvalDenied",
            true,
        );
    }
    let input = AgentLocalToolRequestInput {
        source: string_field(data, "source").unwrap_or_else(|| "mcp".to_string()),
        server_name,
        tool_name,
        arguments: Some(arguments),
        call_id: Some(call_id.clone()),
        turn_id: Some(turn_id.clone()),
        workspace_root,
        allowed_roots,
    };
    let result = agent_resolve_local_tool_request(input);
    let (content, is_error) = match result.data {
        Some(payload) => {
            let value = serde_json::from_str::<Value>(&payload.status).unwrap_or_else(|error| {
                json!({
                    "status": "error",
                    "error": format!("failed to decode local tool result: {error}")
                })
            });
            let failed = value
                .get("status")
                .and_then(Value::as_str)
                .map(|status| status == "error")
                .unwrap_or(false);
            (local_tool_result_content(&value), failed)
        }
        None => {
            let message = result
                .error
                .map(|error| error.message)
                .unwrap_or_else(|| "local tool execution failed".to_string());
            (message, true)
        }
    };
    submit_local_tool_result(client, token, &turn_id, &call_id, &content, is_error)
}

fn wait_for_tool_approval(
    app: &AppHandle,
    stream_id: &str,
    approval_id: &str,
    turn_id: &str,
    call_id: &str,
    source: &str,
    server_name: &str,
    tool_name: &str,
    arguments: &Value,
) -> Result<ToolApprovalDecision, String> {
    let waiter: ApprovalWaiter = Arc::new((Mutex::new(None), Condvar::new()));
    {
        let mut registry = tool_approval_registry()
            .lock()
            .map_err(|_| "failed to register tool approval waiter".to_string())?;
        registry.insert(approval_id.to_string(), Arc::clone(&waiter));
    }

    emit_turn_stream_event(
        app,
        stream_id,
        "tool_approval_required",
        json!({
            "type": "tool_approval_required",
            "approvalId": approval_id,
            "turnId": turn_id,
            "toolCallId": call_id,
            "source": source,
            "serverName": server_name,
            "toolName": tool_name,
            "arguments": arguments,
            "requestedAt": now_iso_utc()
        }),
    );

    let (lock, cvar) = &*waiter;
    let decision = match lock.lock() {
        Ok(state) => {
            let wait_result = cvar
                .wait_timeout_while(state, TOOL_APPROVAL_TIMEOUT, |decision| decision.is_none())
                .map_err(|_| "failed while waiting for tool approval".to_string())?;
            wait_result.0.clone()
        }
        Err(_) => None,
    };
    if let Ok(mut registry) = tool_approval_registry().lock() {
        registry.remove(approval_id);
    }
    decision.ok_or_else(|| "tool approval timed out".to_string())
}

fn submit_local_tool_result(
    client: &Client,
    token: &str,
    turn_id: &str,
    call_id: &str,
    content: &str,
    is_error: bool,
) -> Result<(), String> {
    let url = format!(
        "{}{}",
        station_client::station_base_url(),
        "/sub-agent/agent/turn/local-tool-result"
    );
    let auth = format!("Bearer {}", token.trim());
    let response = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, auth)
        .json(&json!({
            "turn_id": turn_id,
            "call_id": call_id,
            "content": content,
            "is_error": is_error
        }))
        .send()
        .map_err(|error| format!("failed to submit local tool result: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "local tool result submit returned HTTP {}",
            response.status()
        ));
    }
    Ok(())
}

fn string_field(data: &Value, key: &str) -> Option<String> {
    data.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.is_empty())
}

fn string_array_field(data: &Value, key: &str) -> Option<Vec<String>> {
    let value = data.get(key)?;
    let parsed = if let Some(raw) = value.as_str() {
        serde_json::from_str::<Value>(raw).ok()?
    } else {
        value.clone()
    };
    let values = parsed
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    Some(values)
}

fn value_field(data: &Value, key: &str) -> Option<Value> {
    let value = data.get(key)?;
    if let Some(raw) = value.as_str() {
        return serde_json::from_str::<Value>(raw)
            .ok()
            .or_else(|| Some(json!(raw)));
    }
    Some(value.clone())
}

fn now_iso_utc() -> String {
    let unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs() as i64;
    let dt =
        time::OffsetDateTime::from_unix_timestamp(unix).unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    dt.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn local_tool_result_content(value: &Value) -> String {
    let Some(output) = value.get("data").and_then(|data| data.get("output")) else {
        return value.to_string();
    };
    if let Some(content) = output.get("content") {
        return content
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| content.to_string());
    }
    output.to_string()
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

fn default_cli_command(provider: &str) -> String {
    match provider {
        "trae" | "trae-cli" => "traecli exec --skip-git-repo-check -".to_string(),
        "codex" | "codex-cli" => "codex exec --skip-git-repo-check -".to_string(),
        "claude" | "claude-cli" => "claude -p".to_string(),
        "cursor" | "cursor-cli" => "cursor-agent --print --output-format text --trust".to_string(),
        _ => "traecli exec --skip-git-repo-check -".to_string(),
    }
}

fn resolved_turn_failure(
    provider_id: &str,
    is_cli: bool,
    cli_binary: &str,
    raw_message: &str,
    details: Option<&Value>,
) -> AppResult<StubPayload> {
    let error_text = extract_station_error_message(raw_message, details);
    let resolved = if is_cli && !cli_binary.is_empty() {
        error_resolver::resolve_cli_error(cli_binary, &error_text)
    } else {
        error_resolver::resolve_error(provider_id, &error_text)
    };
    let mut details_obj = json!({});
    if let Some(detail) = resolved.detail {
        details_obj["detail"] = json!(detail);
    }
    if let Some(action) = resolved.action {
        details_obj["resolution"] = json!(action);
    }
    if let Some(pid) = resolved.provider_id {
        details_obj["providerId"] = json!(pid);
    }
    AppResult::fail(
        ErrorCode::InternalError,
        resolved.message,
        Some(details_obj),
    )
}

fn extract_station_error_message(raw: &str, details: Option<&Value>) -> String {
    if let Some(d) = details {
        if let Some(body) = d.get("body").and_then(|v| v.as_str()) {
            let trimmed = body.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    raw.to_string()
}

fn emit_resolved_error(
    app: &AppHandle,
    stream_id: &str,
    provider_id: &str,
    kind: ProviderKind,
    cli_command: Option<&str>,
    raw_error: &str,
) {
    let wrapped = error_resolver::wrap_stream_error(provider_id, kind, raw_error, cli_command);
    emit_turn_stream_event(app, stream_id, "error", wrapped);
}

pub fn emit_turn_stream_event(app: &AppHandle, stream_id: &str, event: &str, data: Value) {
    if let Err(error) = app.emit(
        AGENT_TURN_STREAM_EVENT,
        AgentTurnStreamEventPayload {
            stream_id: stream_id.to_string(),
            event: event.to_string(),
            data,
        },
    ) {
        tracing::warn!(error = %error, "Failed to emit Agent turn stream event");
    }
}

fn success_payload(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn build_local_tool_result_event(
    turn_id: &str,
    call_id: &str,
    source: &str,
    server_name: &str,
    tool_name: &str,
    execution: Value,
) -> Value {
    let ok = execution
        .get("ok")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    json!({
        "type": "tool_result",
        "turnId": turn_id,
        "callId": call_id,
        "source": source,
        "serverName": server_name,
        "toolName": tool_name,
        "status": if ok { "success" } else { "error" },
        "data": execution,
        "trace": {
            "owner": "desktop-rust",
            "bridge": "agent_turn.local_tool_request",
            "audit": execution.get("audit").cloned().unwrap_or_else(|| json!({}))
        }
    })
}

pub fn agent_conversation_list(
    input: AgentConversationListInput,
    token: &str,
) -> AppResult<StubPayload> {
    let agent_id = input.agent_id.trim().to_string();
    if agent_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "agent_id is required", None);
    }
    let body = json!({
        "agent_id": agent_id,
        "status": input.status.unwrap_or_default(),
        "page": input.page.unwrap_or(1),
        "page_size": input.page_size.unwrap_or(50),
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/conversation/list",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_conversation_list", result),
        Err(err) => {
            tracing::error!(command = "agent_conversation_list", error = %err, "Conversation list failed");
            err.into_app_result("Failed to list agent conversations")
        }
    }
}

pub fn agent_conversation_get(
    input: AgentConversationGetInput,
    token: &str,
) -> AppResult<StubPayload> {
    let conversation_id = input.conversation_id.trim().to_string();
    if conversation_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id is required",
            None,
        );
    }
    let body = json!({ "conversation_id": conversation_id });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/conversation/get",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_conversation_get", result),
        Err(err) => {
            tracing::error!(command = "agent_conversation_get", error = %err, "Conversation get failed");
            err.into_app_result("Failed to get agent conversation")
        }
    }
}

pub fn agent_conversation_create(
    input: AgentConversationCreateInput,
    token: &str,
) -> AppResult<StubPayload> {
    let agent_id = input.agent_id.trim().to_string();
    if agent_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "agent_id is required", None);
    }
    let mut body = json!({
        "agent_id": agent_id,
    });
    if let Some(title) = input.title.filter(|s| !s.trim().is_empty()) {
        body["title"] = json!(title);
    }
    if let Some(desc) = input.description.filter(|s| !s.trim().is_empty()) {
        body["description"] = json!(desc);
    }
    if let Some(model) = input.model_name.filter(|s| !s.trim().is_empty()) {
        body["model_name"] = json!(model);
    }
    if let Some(provider) = input.provider_id.filter(|s| !s.trim().is_empty()) {
        body["provider_id"] = json!(provider);
    }
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/conversation/create",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_conversation_create", result),
        Err(err) => {
            tracing::error!(command = "agent_conversation_create", error = %err, "Conversation create failed");
            err.into_app_result("Failed to create agent conversation")
        }
    }
}

pub fn agent_conversation_messages(
    input: AgentConversationMessagesInput,
    token: &str,
) -> AppResult<StubPayload> {
    let conversation_id = input.conversation_id.trim().to_string();
    if conversation_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id is required",
            None,
        );
    }
    let body = json!({
        "conversation_id": conversation_id,
        "after_seq": input.after_seq.unwrap_or(0),
        "before_seq": input.before_seq.unwrap_or(0),
        "limit": input.limit.unwrap_or(50),
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/conversation/messages",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_conversation_messages", result),
        Err(err) => {
            tracing::error!(command = "agent_conversation_messages", error = %err, "Conversation messages failed");
            err.into_app_result("Failed to list agent conversation messages")
        }
    }
}

pub fn agent_thread_create(input: AgentThreadCreateInput, token: &str) -> AppResult<StubPayload> {
    let conversation_id = input.conversation_id.trim().to_string();
    let source_message_id = input.source_message_id.trim().to_string();
    if conversation_id.is_empty() || source_message_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id and source_message_id are required",
            None,
        );
    }
    let body = json!({
        "conversation_id": conversation_id,
        "source_message_id": source_message_id,
        "title": input.title.unwrap_or_default(),
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/thread/create",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_thread_create", result),
        Err(err) => {
            tracing::error!(command = "agent_thread_create", error = %err, "Thread create failed");
            err.into_app_result("Failed to create agent thread")
        }
    }
}

pub fn agent_thread_list(input: AgentThreadListInput, token: &str) -> AppResult<StubPayload> {
    let conversation_id = input.conversation_id.trim().to_string();
    if conversation_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id is required",
            None,
        );
    }
    let body = json!({ "conversation_id": conversation_id });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/thread/list",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_thread_list", result),
        Err(err) => {
            tracing::error!(command = "agent_thread_list", error = %err, "Thread list failed");
            err.into_app_result("Failed to list agent threads")
        }
    }
}

pub fn agent_thread_messages(
    input: AgentThreadMessagesInput,
    token: &str,
) -> AppResult<StubPayload> {
    let thread_id = input.thread_id.trim().to_string();
    if thread_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "thread_id is required", None);
    }
    let body = json!({
        "thread_id": thread_id,
        "after_seq": input.after_seq.unwrap_or(0),
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/thread/messages",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_thread_messages", result),
        Err(err) => {
            tracing::error!(command = "agent_thread_messages", error = %err, "Thread messages failed");
            err.into_app_result("Failed to list agent thread messages")
        }
    }
}

fn agent_group_member_ids_json(ids: Option<Vec<String>>) -> String {
    serde_json::to_string(&ids.unwrap_or_default()).unwrap_or_else(|_| "[]".to_string())
}

pub fn agent_group_create(input: AgentGroupCreateInput, token: &str) -> AppResult<StubPayload> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "name is required", None);
    }
    let body = json!({
        "name": name,
        "description": input.description.unwrap_or_default(),
        "member_agent_ids": agent_group_member_ids_json(input.member_agent_ids),
        "orchestration_mode": input.orchestration_mode.unwrap_or_else(|| "sequential".to_string()),
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/ecosystem/group/create",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_group_create", result),
        Err(err) => {
            tracing::error!(command = "agent_group_create", error = %err, "Agent group create failed");
            err.into_app_result("Failed to create agent group")
        }
    }
}

pub fn agent_group_update(input: AgentGroupUpdateInput, token: &str) -> AppResult<StubPayload> {
    let id = input.id.trim().to_string();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }
    let body = json!({
        "id": id,
        "name": input.name.unwrap_or_default(),
        "description": input.description.unwrap_or_default(),
        "member_agent_ids": agent_group_member_ids_json(input.member_agent_ids),
        "orchestration_mode": input.orchestration_mode.unwrap_or_else(|| "sequential".to_string()),
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/ecosystem/group/update",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_group_update", result),
        Err(err) => {
            tracing::error!(command = "agent_group_update", error = %err, "Agent group update failed");
            err.into_app_result("Failed to update agent group")
        }
    }
}

pub fn agent_group_delete(input: AgentGroupDeleteInput, token: &str) -> AppResult<StubPayload> {
    let id = input.id.trim().to_string();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }
    let body = json!({ "id": id });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/ecosystem/group/delete",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_group_delete", result),
        Err(err) => {
            tracing::error!(command = "agent_group_delete", error = %err, "Agent group delete failed");
            err.into_app_result("Failed to delete agent group")
        }
    }
}

pub fn agent_group_list(token: &str) -> AppResult<StubPayload> {
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/ecosystem/group/list",
        token,
        None,
        Some(json!({})),
    ) {
        Ok(result) => success_payload("agent_group_list", result),
        Err(err) => {
            tracing::error!(command = "agent_group_list", error = %err, "Agent group list failed");
            err.into_app_result("Failed to list agent groups")
        }
    }
}

pub fn topic_comment_create(input: TopicCommentCreateInput, token: &str) -> AppResult<StubPayload> {
    let topic_key = input.topic_key.trim().to_string();
    let content = input.content.trim().to_string();
    if topic_key.is_empty() || content.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "topic_key and content are required",
            None,
        );
    }
    let body = json!({ "topic_key": topic_key, "content": content });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/ecosystem/comment/create",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("topic_comment_create", result),
        Err(err) => {
            tracing::error!(command = "topic_comment_create", error = %err, "Topic comment create failed");
            err.into_app_result("Failed to create topic comment")
        }
    }
}

pub fn topic_comment_delete(input: TopicCommentDeleteInput, token: &str) -> AppResult<StubPayload> {
    let topic_key = input.topic_key.trim().to_string();
    let comment_id = input.comment_id.trim().to_string();
    if topic_key.is_empty() || comment_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "topic_key and comment_id are required",
            None,
        );
    }
    let body = json!({ "topic_key": topic_key, "comment_id": comment_id });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/ecosystem/comment/delete",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("topic_comment_delete", result),
        Err(err) => {
            tracing::error!(command = "topic_comment_delete", error = %err, "Topic comment delete failed");
            err.into_app_result("Failed to delete topic comment")
        }
    }
}

pub fn topic_comment_list(input: TopicCommentListInput, token: &str) -> AppResult<StubPayload> {
    let topic_key = input.topic_key.trim().to_string();
    if topic_key.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "topic_key is required", None);
    }
    let body = json!({ "topic_key": topic_key });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/ecosystem/comment/list",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("topic_comment_list", result),
        Err(err) => {
            tracing::error!(command = "topic_comment_list", error = %err, "Topic comment list failed");
            err.into_app_result("Failed to list topic comments")
        }
    }
}

// ── C6 Knowledge bindings (Station `agent_knowledge_bindings`) ──
// The resource descriptor catalog remains in agent `config_json`; these protobuf commands
// persist the first-class agent↔resource join relation, mirroring LobeHub `createAgentFiles`.
fn knowledge_binding_json(binding: &agent::AgentKnowledgeBinding) -> Value {
    json!({
        "id": binding.id,
        "agentId": binding.agent_id,
        "resourceId": binding.resource_id,
        "policy": binding.policy,
        "enabled": binding.enabled,
    })
}

pub fn agent_knowledge_binding_list(
    input: AgentKnowledgeBindingListInput,
    token: &str,
) -> AppResult<StubPayload> {
    let agent_id = input.agent_id.trim().to_string();
    if agent_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "agent_id is required", None);
    }
    let request = agent::ListAgentKnowledgeBindingsRequest { agent_id };
    match station_client::request_proto::<
        agent::ListAgentKnowledgeBindingsRequest,
        agent::ListAgentKnowledgeBindingsResponse,
    >(
        Method::POST,
        "/sub-agent/config/knowledge/list",
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => success_payload(
            "agent_knowledge_binding_list",
            json!({
                "bindings": response
                    .bindings
                    .iter()
                    .map(knowledge_binding_json)
                    .collect::<Vec<_>>()
            }),
        ),
        Err(err) => {
            tracing::error!(command = "agent_knowledge_binding_list", error = %err, "Knowledge binding list failed");
            err.into_app_result("Failed to list knowledge bindings")
        }
    }
}

pub fn agent_knowledge_binding_create(
    input: AgentKnowledgeBindingCreateInput,
    token: &str,
) -> AppResult<StubPayload> {
    let agent_id = input.agent_id.trim().to_string();
    let resource_id = input.resource_id.trim().to_string();
    if agent_id.is_empty() || resource_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "agent_id and resource_id are required",
            None,
        );
    }
    let request = agent::CreateAgentKnowledgeBindingRequest {
        binding: Some(agent::AgentKnowledgeBinding {
            id: String::new(),
            agent_id,
            resource_id,
            policy: input.policy.unwrap_or_else(|| "manual".to_string()),
            enabled: input.enabled.unwrap_or(true),
            created_at: None,
            updated_at: None,
        }),
    };
    match station_client::request_proto::<
        agent::CreateAgentKnowledgeBindingRequest,
        agent::CreateAgentKnowledgeBindingResponse,
    >(
        Method::POST,
        "/sub-agent/config/knowledge/create",
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => match response.binding.as_ref() {
            Some(binding) => success_payload(
                "agent_knowledge_binding_create",
                json!({ "binding": knowledge_binding_json(binding) }),
            ),
            None => AppResult::fail(
                ErrorCode::InternalError,
                "Station created knowledge binding without a binding payload",
                None,
            ),
        },
        Err(err) => {
            tracing::error!(command = "agent_knowledge_binding_create", error = %err, "Knowledge binding create failed");
            err.into_app_result("Failed to create knowledge binding")
        }
    }
}

pub fn agent_knowledge_binding_update(
    input: AgentKnowledgeBindingUpdateInput,
    token: &str,
) -> AppResult<StubPayload> {
    let id = input.id.trim().to_string();
    let agent_id = input.agent_id.trim().to_string();
    let resource_id = input.resource_id.trim().to_string();
    if id.is_empty() || resource_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "id and resource_id are required",
            None,
        );
    }
    let request = agent::UpdateAgentKnowledgeBindingRequest {
        binding: Some(agent::AgentKnowledgeBinding {
            id,
            agent_id,
            resource_id,
            policy: input.policy.unwrap_or_else(|| "manual".to_string()),
            enabled: input.enabled.unwrap_or(true),
            created_at: None,
            updated_at: None,
        }),
    };
    match station_client::request_proto::<
        agent::UpdateAgentKnowledgeBindingRequest,
        agent::UpdateAgentKnowledgeBindingResponse,
    >(
        Method::POST,
        "/sub-agent/config/knowledge/update",
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => match response.binding.as_ref() {
            Some(binding) => success_payload(
                "agent_knowledge_binding_update",
                json!({ "binding": knowledge_binding_json(binding) }),
            ),
            None => AppResult::fail(
                ErrorCode::InternalError,
                "Station updated knowledge binding without a binding payload",
                None,
            ),
        },
        Err(err) => {
            tracing::error!(command = "agent_knowledge_binding_update", error = %err, "Knowledge binding update failed");
            err.into_app_result("Failed to update knowledge binding")
        }
    }
}

pub fn agent_knowledge_binding_delete(
    input: AgentKnowledgeBindingDeleteInput,
    token: &str,
) -> AppResult<StubPayload> {
    let id = input.id.trim().to_string();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }
    let request = agent::DeleteAgentKnowledgeBindingRequest { id };
    match station_client::request_proto::<
        agent::DeleteAgentKnowledgeBindingRequest,
        agent::DeleteAgentKnowledgeBindingResponse,
    >(
        Method::POST,
        "/sub-agent/config/knowledge/delete",
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => success_payload(
            "agent_knowledge_binding_delete",
            json!({ "success": response.success }),
        ),
        Err(err) => {
            tracing::error!(command = "agent_knowledge_binding_delete", error = %err, "Knowledge binding delete failed");
            err.into_app_result("Failed to delete knowledge binding")
        }
    }
}

pub fn agent_task_create(input: AgentTaskCreateInput, token: &str) -> AppResult<StubPayload> {
    let title = input.title.trim().to_string();
    let agent_id = input.agent_id.trim().to_string();
    if title.is_empty() || agent_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "title and agent_id are required",
            None,
        );
    }
    let body = json!({
        "title": title,
        "description": input.description.unwrap_or_default(),
        "agent_id": agent_id,
        "priority": input.priority.unwrap_or_else(|| "medium".to_string()),
        "topic_key": input.topic_key.unwrap_or_default(),
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/task/create",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_task_create", result),
        Err(err) => {
            tracing::error!(command = "agent_task_create", error = %err, "Agent task create failed");
            err.into_app_result("Failed to create agent task")
        }
    }
}

pub fn agent_task_list(input: AgentTaskListInput, token: &str) -> AppResult<StubPayload> {
    let body = json!({ "agent_id": input.agent_id.unwrap_or_default() });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/task/list",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_task_list", result),
        Err(err) => {
            tracing::error!(command = "agent_task_list", error = %err, "Agent task list failed");
            err.into_app_result("Failed to list agent tasks")
        }
    }
}

pub fn agent_task_status(input: AgentTaskStatusInput, token: &str) -> AppResult<StubPayload> {
    let id = input.id.trim().to_string();
    let status = input.status.trim().to_string();
    if id.is_empty() || status.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "id and status are required",
            None,
        );
    }
    let body = json!({
        "id": id,
        "status": status,
        "result": input.result.unwrap_or_default(),
        "error": input.error.unwrap_or_default(),
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/task/status",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_task_status", result),
        Err(err) => {
            tracing::error!(command = "agent_task_status", error = %err, "Agent task status failed");
            err.into_app_result("Failed to update agent task status")
        }
    }
}

pub fn agent_task_delete(input: AgentTaskDeleteInput, token: &str) -> AppResult<StubPayload> {
    let id = input.id.trim().to_string();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }
    let body = json!({ "id": id });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/task/delete",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_task_delete", result),
        Err(err) => {
            tracing::error!(command = "agent_task_delete", error = %err, "Agent task delete failed");
            err.into_app_result("Failed to delete agent task")
        }
    }
}

pub fn agent_task_subtask_add(
    input: AgentTaskSubtaskAddInput,
    token: &str,
) -> AppResult<StubPayload> {
    let task_id = input.task_id.trim().to_string();
    let title = input.title.trim().to_string();
    if task_id.is_empty() || title.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "task_id and title are required",
            None,
        );
    }
    let body = json!({ "task_id": task_id, "title": title });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/task/subtask/add",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_task_subtask_add", result),
        Err(err) => {
            tracing::error!(command = "agent_task_subtask_add", error = %err, "Agent task subtask add failed");
            err.into_app_result("Failed to add subtask")
        }
    }
}

pub fn agent_task_subtask_complete(
    input: AgentTaskSubtaskCompleteInput,
    token: &str,
) -> AppResult<StubPayload> {
    let task_id = input.task_id.trim().to_string();
    let subtask_id = input.subtask_id.trim().to_string();
    if task_id.is_empty() || subtask_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "task_id and subtask_id are required",
            None,
        );
    }
    let body = json!({ "task_id": task_id, "subtask_id": subtask_id });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/task/subtask/complete",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_task_subtask_complete", result),
        Err(err) => {
            tracing::error!(command = "agent_task_subtask_complete", error = %err, "Agent task subtask complete failed");
            err.into_app_result("Failed to complete subtask")
        }
    }
}

pub fn agent_message_translate(
    input: AgentMessageTranslateInput,
    token: &str,
) -> AppResult<StubPayload> {
    let message_id = input.message_id.trim().to_string();
    if message_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "message_id is required", None);
    }
    let body = json!({ "message_id": message_id, "translation": input.translation });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/conversation/message/translate",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_message_translate", result),
        Err(err) => {
            tracing::error!(command = "agent_message_translate", error = %err, "Message translate persist failed");
            err.into_app_result("Failed to persist message translation")
        }
    }
}

pub fn agent_conversation_archive(
    input: AgentConversationArchiveInput,
    token: &str,
) -> AppResult<StubPayload> {
    let conversation_id = input.conversation_id.trim().to_string();
    if conversation_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id is required",
            None,
        );
    }
    let body = json!({
        "conversation_id": conversation_id,
        "permanent": input.permanent.unwrap_or(false),
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/conversation/archive",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_conversation_archive", result),
        Err(err) => {
            tracing::error!(command = "agent_conversation_archive", error = %err, "Conversation archive failed");
            err.into_app_result("Failed to archive agent conversation")
        }
    }
}

pub fn replay_conversation_events_stream(
    app: &AppHandle,
    input: AgentConversationReplayEventsInput,
    token: &str,
) -> Result<(), String> {
    let conversation_id = input.conversation_id.trim().to_string();
    if conversation_id.is_empty() {
        return Err("conversation_id is required".to_string());
    }
    let stream_id = input.stream_id.trim().to_string();
    if stream_id.is_empty() {
        return Err("stream_id is required".to_string());
    }
    let after_seq = input.after_seq.unwrap_or(0);

    let url = format!(
        "{}{}",
        station_client::station_base_url(),
        "/sub-agent/agent/conversation/events"
    );
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("failed to create Station replay client: {error}"))?;
    let auth = format!("Bearer {}", token.trim());
    let body = json!({
        "conversation_id": conversation_id,
        "after_seq": after_seq,
    });
    let mut response = client
        .post(&url)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, auth)
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .map_err(|error| format!("Station conversation events request failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let err_body = response.text().unwrap_or_default();
        return Err(format!(
            "Station conversation events returned HTTP {}: {}",
            status, err_body
        ));
    }

    let mut bytes = [0_u8; 4096];
    let mut buffer = String::new();
    loop {
        let read = response
            .read(&mut bytes)
            .map_err(|error| format!("failed to read Station replay stream: {error}"))?;
        if read == 0 {
            break;
        }
        buffer.push_str(&String::from_utf8_lossy(&bytes[..read]));
        while let Some(frame_end) = buffer.find("\n\n") {
            let frame = buffer[..frame_end].to_string();
            buffer = buffer[frame_end + 2..].to_string();
            if let Some((event, data)) = parse_sse_frame(&frame) {
                let is_terminal = event == "catchup_done"
                    || event == "done"
                    || event == "error"
                    || event == "cancelled";
                emit_turn_stream_event(app, &stream_id, &event, data);
                if is_terminal {
                    return Ok(());
                }
            }
        }
    }
    if !buffer.trim().is_empty() {
        if let Some((event, data)) = parse_sse_frame(&buffer) {
            emit_turn_stream_event(app, &stream_id, &event, data);
        }
    }
    emit_turn_stream_event(
        app,
        &stream_id,
        "catchup_done",
        json!({
            "type": "catchup_done",
            "seq": after_seq,
            "reason": "stream_ended"
        }),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_tool_result_event_keeps_trace_metadata() {
        let event = build_local_tool_result_event(
            "turn_1",
            "call_1",
            "mcp",
            "local-server",
            "read_context",
            json!({
                "ok": true,
                "output": {"content": [{"type": "text", "text": "done"}]},
                "audit": {
                    "source": "mcp",
                    "serverName": "local-server",
                    "toolName": "read_context",
                    "transport": "stdio",
                    "executedAt": "2026-06-16T00:00:00Z"
                }
            }),
        );

        assert_eq!(
            event.get("type").and_then(Value::as_str),
            Some("tool_result")
        );
        assert_eq!(event.get("status").and_then(Value::as_str), Some("success"));
        assert_eq!(
            event
                .get("trace")
                .and_then(|trace| trace.get("owner"))
                .and_then(Value::as_str),
            Some("desktop-rust")
        );
        assert_eq!(
            event
                .get("data")
                .and_then(|data| data.get("audit"))
                .and_then(|audit| audit.get("transport"))
                .and_then(Value::as_str),
            Some("stdio")
        );
    }

    #[test]
    fn builtin_local_tool_error_keeps_audit_metadata() {
        let result = agent_resolve_local_tool_request(AgentLocalToolRequestInput {
            source: "builtin".to_string(),
            server_name: None,
            tool_name: "local_file_read".to_string(),
            arguments: Some(json!({"path": "README.md"})),
            call_id: Some("call_1".to_string()),
            turn_id: Some("turn_1".to_string()),
            workspace_root: None,
            allowed_roots: None,
        });

        let payload = result.data.expect("result payload should be present");
        let event: Value = serde_json::from_str(&payload.status).expect("payload should be json");
        assert_eq!(event.get("status").and_then(Value::as_str), Some("error"));
        assert_eq!(
            event
                .get("trace")
                .and_then(|trace| trace.get("audit"))
                .and_then(|audit| audit.get("approvalRequired"))
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            event
                .get("trace")
                .and_then(|trace| trace.get("audit"))
                .and_then(|audit| audit.get("toolName"))
                .and_then(Value::as_str),
            Some("local_file_read")
        );
    }

    #[test]
    fn parse_sse_frame_reads_event_and_json_payload() {
        let parsed = parse_sse_frame("event: text\ndata: {\"type\":\"text\",\"text\":\"hello\"}");

        let Some((event, data)) = parsed else {
            panic!("expected SSE frame to parse");
        };
        assert_eq!(event, "text");
        assert_eq!(data.get("type").and_then(Value::as_str), Some("text"));
        assert_eq!(data.get("text").and_then(Value::as_str), Some("hello"));
    }

    #[test]
    fn value_field_parses_json_string_arguments() {
        let data = json!({
            "arguments": "{\"path\":\"README.md\"}"
        });

        let value = value_field(&data, "arguments").expect("arguments should parse");
        assert_eq!(value.get("path").and_then(Value::as_str), Some("README.md"));
    }

    #[test]
    fn local_tool_result_content_extracts_mcp_content() {
        let content = local_tool_result_content(&json!({
            "status": "success",
            "data": {
                "output": {
                    "content": [
                        {"type": "text", "text": "done"}
                    ]
                }
            }
        }));

        assert!(content.contains("done"));
    }

    #[test]
    fn local_tool_result_content_extracts_builtin_text_content() {
        let content = local_tool_result_content(&json!({
            "status": "success",
            "data": {
                "output": {
                    "content": "allowed"
                }
            }
        }));

        assert_eq!(content, "allowed");
    }

    #[test]
    fn cancel_agent_turn_stream_marks_registered_flag() {
        let stream_id = "agent-turn-test-cancel";
        let flag = register_agent_turn_stream(stream_id);
        remember_stream_turn(stream_id, &json!({ "turnId": "turn_1" }));
        let result = cancel_agent_turn_stream(stream_id, "");
        let payload: Value =
            serde_json::from_str(&result.data.as_ref().expect("cancel payload").status)
                .expect("cancel payload json");
        unregister_agent_turn_stream(stream_id);

        assert!(result.ok);
        assert!(flag.load(Ordering::SeqCst));
        assert_eq!(payload["turn_id"], "turn_1");
    }
}
