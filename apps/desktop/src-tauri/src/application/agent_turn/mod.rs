// `ExecuteTurnRequest` / `ExecuteTurnResponse` exist in `model::agent`, but Station's
// `HandleExecuteTurn` binds JSON to ad-hoc Go structs (not generated protos) and the JSON
// payload includes fields not present on the proto (identity, platform, workspace_root, …).
// `TypedHandler` protobuf mode requires `proto.Message` request types. Keep JSON until the
// subserver handler and proto definitions are aligned with the desktop contract.
// TODO(agent): align `agent.proto` + Station `HandleExecuteTurn` with the full turn payload, then use `request_proto`.
use crate::application::{agent_workspace, chat, mcp, tools};
use crate::contracts::{
    AgentExecuteTurnInput, AgentLocalToolRequestInput, AgentToolApprovalDecisionInput,
    AgentTurnTraceGetInput, AgentTurnTraceListInput, McpExecuteToolInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use reqwest::blocking::Client;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::Method;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
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
}

pub fn cancel_agent_turn_stream(stream_id: &str) -> AppResult<StubPayload> {
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
    success_payload(
        "agent_cancel_turn_stream",
        json!({
            "stream_id": stream_id,
            "stopped": stopped
        }),
    )
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentTurnStreamEventPayload {
    stream_id: String,
    event: String,
    data: Value,
}

pub fn agent_execute_turn(
    mut input: AgentExecuteTurnInput,
    token: &str,
    actor_id: &str,
) -> AppResult<StubPayload> {
    if let Err(error) = apply_resolved_agent_workspace(&mut input) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    let cli_command = input.cli_command.clone().unwrap_or_default();
    if !cli_command.trim().is_empty() {
        return execute_cli_turn(input, actor_id);
    }

    tracing::info!(
        command = "agent_execute_turn",
        agent_id = %input.agent_id,
        conversation_id = %input.conversation_id,
        "Executing agent turn via Station"
    );

    let body = json!({
        "conversation_id": input.conversation_id,
        "agent_id": input.agent_id,
        "user_input": input.user_input,
        "provider": input.provider.unwrap_or_default(),
        "model": input.model.unwrap_or_default(),
        "cliCommand": input.cli_command.unwrap_or_default(),
        "identity": input.identity.unwrap_or_default(),
        "agentConfigPrompt": input.agent_config_prompt.unwrap_or_default(),
        "effort": input.effort.unwrap_or_else(|| "medium".to_string()),
        "platform": input.platform.unwrap_or("desktop".to_string()),
        "workspace_root": input.workspace_root.unwrap_or_default(),
        "context_window_size": input.context_window_size.unwrap_or(128000),
        "max_retries": input.max_retries.unwrap_or(3),
        "knowledge_resources": input.knowledge_resources.unwrap_or_default(),
    });

    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/turn/execute",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => {
            tracing::info!(command = "agent_execute_turn", "Turn execution succeeded");
            let status =
                serde_json::to_string(&result).unwrap_or_else(|_| r#"{"status":"ok"}"#.to_string());
            AppResult::success(StubPayload {
                command: "agent_execute_turn".to_string(),
                status,
            })
        }
        Err(err) => {
            tracing::error!(command = "agent_execute_turn", error = %err, "Turn execution failed");
            err.into_app_result("Failed to execute agent turn")
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
    actor_id: String,
    cancel_flag: Arc<AtomicBool>,
) {
    if let Err(error) = apply_resolved_agent_workspace(&mut input) {
        emit_turn_stream_event(
            &app,
            &stream_id,
            "error",
            json!({
                "type": "error",
                "error": error
            }),
        );
        return;
    }
    if input
        .cli_command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        execute_cli_turn_stream(&app, &stream_id, input, &actor_id, &cancel_flag);
        return;
    }
    let agent_allowed_roots = input.allowed_roots.clone();
    let body = build_turn_request_body(input, true);
    let result = stream_station_turn(
        &app,
        &stream_id,
        &body,
        agent_allowed_roots.as_deref(),
        &token,
        &cancel_flag,
    );
    if let Err(error) = result {
        emit_turn_stream_event(
            &app,
            &stream_id,
            "error",
            json!({
                "type": "error",
                "error": error
            }),
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
    json!({
        "conversation_id": input.conversation_id,
        "agent_id": input.agent_id,
        "user_input": input.user_input,
        "attachments": input.attachments.unwrap_or_default(),
        "stream": stream,
        "provider": input.provider.unwrap_or_default(),
        "model": input.model.unwrap_or_default(),
        "cliCommand": input.cli_command.unwrap_or_default(),
        "identity": input.identity.unwrap_or_default(),
        "agentConfigPrompt": input.agent_config_prompt.unwrap_or_default(),
        "effort": input.effort.unwrap_or_else(|| "medium".to_string()),
        "platform": input.platform.unwrap_or("desktop".to_string()),
        "workspace_root": input.workspace_root.unwrap_or_default(),
        "context_window_size": input.context_window_size.unwrap_or(128000),
        "max_retries": input.max_retries.unwrap_or(3),
        "knowledge_resources": input.knowledge_resources.unwrap_or_default(),
    })
}

fn apply_resolved_agent_workspace(input: &mut AgentExecuteTurnInput) -> Result<(), String> {
    let workspace = agent_workspace::resolve_agent_workspace(input)?;
    input.workspace_root = Some(workspace.path.to_string_lossy().to_string());
    Ok(())
}

fn execute_cli_turn(input: AgentExecuteTurnInput, actor_id: &str) -> AppResult<StubPayload> {
    let command_line = input.cli_command.clone().unwrap_or_default();
    tracing::info!(
        command = "agent_execute_turn",
        agent_id = %input.agent_id,
        provider = %input.provider.clone().unwrap_or_default(),
        model = %input.model.clone().unwrap_or_default(),
        "Executing agent turn via local CLI provider"
    );
    match run_cli_command(&input, &command_line) {
        Ok(output) => {
            let provider = input.provider.clone().unwrap_or_else(|| "cli".to_string());
            let model = input.model.clone().unwrap_or_else(|| "cli".to_string());
            let persisted = chat::record_agent_turn_messages(
                actor_id,
                &input.conversation_id,
                &input.agent_id,
                &input.user_input,
                &output,
                Some(&model),
            );
            if !persisted.ok {
                let message = persisted
                    .error
                    .as_ref()
                    .map(|error| error.message.clone())
                    .unwrap_or_else(|| "failed to persist CLI turn messages".to_string());
                tracing::error!(
                    command = "agent_execute_turn",
                    conversation_id = %input.conversation_id,
                    error = %message,
                    "CLI provider turn succeeded but message persistence failed"
                );
                return AppResult::fail(ErrorCode::InternalError, message, None);
            }
            success_payload(
                "agent_execute_turn",
                json!({
                    "result": output,
                    "provider": provider,
                    "model": model,
                    "executionOwner": "desktop-rust"
                }),
            )
        }
        Err(error) => {
            tracing::error!(command = "agent_execute_turn", error = %error, "CLI provider turn failed");
            AppResult::fail(ErrorCode::InternalError, error, None)
        }
    }
}

fn execute_cli_turn_stream(
    app: &AppHandle,
    stream_id: &str,
    input: AgentExecuteTurnInput,
    actor_id: &str,
    cancel_flag: &AtomicBool,
) {
    if cancel_flag.load(Ordering::SeqCst) {
        return;
    }
    emit_turn_stream_event(
        app,
        stream_id,
        "progress",
        json!({
            "type": "progress",
            "stage": "cli_provider_started",
            "message": "agent.progress.cliProviderStarted"
        }),
    );
    let provider = input.provider.clone().unwrap_or_else(|| "cli".to_string());
    let model = input.model.clone().unwrap_or_else(|| "cli".to_string());
    let command_line = input.cli_command.clone().unwrap_or_default();
    match run_cli_command(&input, &command_line) {
        Ok(output) => {
            let persisted = chat::record_agent_turn_messages(
                actor_id,
                &input.conversation_id,
                &input.agent_id,
                &input.user_input,
                &output,
                Some(&model),
            );
            if !persisted.ok {
                let message = persisted
                    .error
                    .as_ref()
                    .map(|error| error.message.clone())
                    .unwrap_or_else(|| "failed to persist CLI turn messages".to_string());
                tracing::error!(
                    command = "agent_execute_turn_stream",
                    conversation_id = %input.conversation_id,
                    error = %message,
                    "CLI provider stream succeeded but message persistence failed"
                );
                emit_turn_stream_event(
                    app,
                    stream_id,
                    "error",
                    json!({
                        "type": "error",
                        "error": message
                    }),
                );
                return;
            }
            if cancel_flag.load(Ordering::SeqCst) {
                return;
            }
            if !output.is_empty() {
                emit_turn_stream_event(
                    app,
                    stream_id,
                    "text",
                    json!({
                        "type": "text",
                        "text": output
                    }),
                );
            }
            emit_turn_stream_event(
                app,
                stream_id,
                "done",
                json!({
                    "type": "done",
                    "provider": provider,
                    "model": model,
                    "executionOwner": "desktop-rust"
                }),
            );
        }
        Err(error) => {
            tracing::error!(command = "agent_execute_turn_stream", error = %error, "CLI provider stream failed");
            emit_turn_stream_event(
                app,
                stream_id,
                "error",
                json!({
                    "type": "error",
                    "error": error
                }),
            );
        }
    }
}

fn run_cli_command(input: &AgentExecuteTurnInput, command_line: &str) -> Result<String, String> {
    let mut parts = normalize_cli_command(command_line)?;
    if parts.is_empty() {
        return Err("CLI command is empty".to_string());
    };
    let program = parts.remove(0);
    let mut args = parts;
    let prompt = build_cli_prompt(input);
    let adapter_name = cli_adapter_name(&program);
    let prompt_delivery = cli_prompt_delivery(adapter_name);
    if matches!(prompt_delivery, CliPromptDelivery::Argument) {
        args.push(prompt.clone());
    }
    let workspace_root = input
        .workspace_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let Some(workspace_root) = workspace_root else {
        return Err("agent workspace_root is required for CLI execution".to_string());
    };
    if !Path::new(&workspace_root).is_dir() {
        return Err("agent workspace_root does not exist".to_string());
    }

    let mut command = if input.runtime_backend.as_deref() == Some("proot") {
        build_proot_command(input, &workspace_root, &program, &args)?
    } else {
        let mut command = Command::new(&program);
        command.args(&args).current_dir(&workspace_root);
        command
    };
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PEERS_TOUCH_AGENT_ID", &input.agent_id)
        .env("PEERS_TOUCH_CONVERSATION_ID", &input.conversation_id)
        .env(
            "PEERS_TOUCH_PROVIDER",
            input.provider.as_deref().unwrap_or("cli"),
        )
        .env("PEERS_TOUCH_MODEL", input.model.as_deref().unwrap_or("cli"))
        .env(
            "PEERS_TOUCH_EFFORT",
            input.effort.as_deref().unwrap_or("medium"),
        )
        .env("PEERS_TOUCH_CLI_ADAPTER", adapter_name)
        .env("PEERS_TOUCH_AGENT_WORKSPACE", &workspace_root);
    if let Some(allowed_roots) = input.allowed_roots.as_ref() {
        if !allowed_roots.is_empty() {
            command.env("PEERS_TOUCH_ALLOWED_ROOTS", allowed_roots.join(":"));
        }
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to start CLI provider: {error}"))?;
    if matches!(prompt_delivery, CliPromptDelivery::Stdin) {
        let Some(stdin) = child.stdin.as_mut() else {
            return Err("failed to open CLI provider stdin".to_string());
        };
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|error| format!("failed to write prompt to CLI provider: {error}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to wait for CLI provider: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let code = output
            .status
            .code()
            .map(|value| value.to_string())
            .unwrap_or_else(|| "signal".to_string());
        return Err(format!(
            "CLI provider exited with status {code}: {}",
            if stderr.is_empty() { stdout } else { stderr }
        ));
    }
    Ok(stdout)
}

fn normalize_cli_command(command_line: &str) -> Result<Vec<String>, String> {
    let parts = split_command_line(command_line)?;
    if parts.len() != 1 {
        return Ok(parts);
    }
    let program = parts[0].trim();
    let executable_name = Path::new(program)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(program)
        .to_ascii_lowercase();
    match executable_name.as_str() {
        "codex" => split_command_line("codex exec --skip-git-repo-check -"),
        "cursor" | "cursor-agent" => {
            split_command_line("cursor-agent --print --output-format text --trust")
        }
        "claude" => split_command_line("claude -p"),
        "trae" | "traecli" | "traex" => split_command_line("traecli exec --skip-git-repo-check -"),
        "trae-agent" => split_command_line("trae-agent --print -"),
        _ => Ok(parts),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CliPromptDelivery {
    Stdin,
    Argument,
}

fn cli_prompt_delivery(adapter_name: &str) -> CliPromptDelivery {
    match adapter_name {
        "cursor" => CliPromptDelivery::Argument,
        _ => CliPromptDelivery::Stdin,
    }
}

fn cli_adapter_name(program: &str) -> &'static str {
    let executable_name = Path::new(program)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(program)
        .to_ascii_lowercase();
    match executable_name.as_str() {
        "codex" => "codex",
        "cursor" | "cursor-agent" => "cursor",
        "claude" => "claude",
        "trae" | "traecli" | "traex" | "trae-agent" => "trae",
        _ => "custom",
    }
}

fn build_proot_command(
    input: &AgentExecuteTurnInput,
    workspace_root: &str,
    program: &str,
    args: &[String],
) -> Result<Command, String> {
    if !cfg!(target_os = "linux") {
        return Err("PRoot backend is only supported on Linux hosts".to_string());
    }
    if !agent_workspace::proot_available() {
        return Err("PRoot backend is selected but proot is not available in PATH".to_string());
    }
    let rootfs_path = input
        .rootfs_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "PRoot backend requires rootfs_path".to_string())?;
    if !Path::new(rootfs_path).is_dir() {
        return Err("PRoot rootfs_path does not exist".to_string());
    }

    let mut command = Command::new("proot");
    command
        .arg("-R")
        .arg(rootfs_path)
        .arg("-b")
        .arg(format!("{workspace_root}:/workspace"))
        .arg("-w")
        .arg("/workspace")
        .arg(program)
        .args(args);
    Ok(command)
}

fn build_cli_prompt(input: &AgentExecuteTurnInput) -> String {
    let mut sections = Vec::new();
    if let Some(identity) = input
        .identity
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sections.push(format!("# SOUL.md\n{identity}"));
    }
    if let Some(instructions) = input
        .agent_config_prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        sections.push(format!("# AGENTS.md\n{instructions}"));
    }
    sections.push(format!("# User\n{}", input.user_input.trim()));
    sections.join("\n\n")
}

fn split_command_line(command_line: &str) -> Result<Vec<String>, String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for ch in command_line.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }
        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            continue;
        }
        if ch.is_whitespace() {
            if !current.is_empty() {
                parts.push(current.clone());
                current.clear();
            }
            continue;
        }
        current.push(ch);
    }
    if escaped {
        current.push('\\');
    }
    if quote.is_some() {
        return Err("CLI command has an unterminated quote".to_string());
    }
    if !current.is_empty() {
        parts.push(current);
    }
    Ok(parts)
}

fn stream_station_turn(
    app: &AppHandle,
    stream_id: &str,
    body: &Value,
    agent_allowed_roots: Option<&[String]>,
    token: &str,
    cancel_flag: &AtomicBool,
) -> Result<(), String> {
    let url = format!(
        "{}{}",
        station_client::station_base_url(),
        "/sub-agent/agent/turn/stream"
    );
    let client = Client::builder()
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
                        emit_turn_stream_event(
                            app,
                            stream_id,
                            "error",
                            json!({
                                "type": "error",
                                "error": error
                            }),
                        );
                    }
                    continue;
                }
                emit_turn_stream_event(app, stream_id, &event, data);
            }
        }
    }
    if !buffer.trim().is_empty() {
        if let Some((event, data)) = parse_sse_frame(&buffer) {
            emit_turn_stream_event(app, stream_id, &event, data);
        }
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
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
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

fn emit_turn_stream_event(app: &AppHandle, stream_id: &str, event: &str, data: Value) {
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
    fn normalize_cli_command_expands_codex_adapter() {
        let parts = normalize_cli_command("codex").expect("codex adapter should normalize");

        assert_eq!(parts, vec!["codex", "exec", "--skip-git-repo-check", "-"]);
    }

    #[test]
    fn normalize_cli_command_expands_cursor_adapter() {
        let parts = normalize_cli_command("cursor-agent").expect("cursor adapter should normalize");

        assert_eq!(
            parts,
            vec![
                "cursor-agent",
                "--print",
                "--output-format",
                "text",
                "--trust"
            ]
        );
        assert_eq!(cli_prompt_delivery("cursor"), CliPromptDelivery::Argument);
    }

    #[test]
    fn normalize_cli_command_expands_trae_adapter() {
        let parts = normalize_cli_command("traecli").expect("trae adapter should normalize");

        assert_eq!(parts, vec!["traecli", "exec", "--skip-git-repo-check", "-"]);
        assert_eq!(cli_prompt_delivery("trae"), CliPromptDelivery::Stdin);
    }

    #[test]
    fn normalize_cli_command_keeps_custom_command_args() {
        let parts = normalize_cli_command("codex exec --model gpt-5 -")
            .expect("custom command should parse");

        assert_eq!(parts, vec!["codex", "exec", "--model", "gpt-5", "-"]);
    }

    #[test]
    fn cli_adapter_name_detects_known_program() {
        assert_eq!(cli_adapter_name("/usr/local/bin/claude"), "claude");
        assert_eq!(
            cli_adapter_name("<user-home>/.local/bin/cursor-agent"),
            "cursor"
        );
        assert_eq!(cli_adapter_name("traecli"), "trae");
        assert_eq!(cli_adapter_name("custom-agent"), "custom");
    }

    #[test]
    fn run_cli_command_delivers_cursor_prompt_as_argument() {
        let test_root = std::env::temp_dir().join(format!(
            "peers-touch-cli-provider-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&test_root).expect("test root should be created");
        let fake_cursor = test_root.join("cursor-agent");
        std::fs::write(
            &fake_cursor,
            "#!/bin/sh\nlast=''\nfor arg do last=\"$arg\"; done\nprintf '%s\\n' \"$PEERS_TOUCH_CLI_ADAPTER\"\nprintf '%s\\n' \"$#\"\nprintf '%s' \"$last\"\n",
        )
        .expect("fake cursor should be written");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&fake_cursor)
                .expect("fake cursor metadata should exist")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&fake_cursor, permissions)
                .expect("fake cursor should be executable");
        }

        let input = AgentExecuteTurnInput {
            stream_id: None,
            conversation_id: "conversation-1".to_string(),
            agent_id: "agent-1".to_string(),
            user_input: "reply with PT_CURSOR_OK".to_string(),
            attachments: None,
            provider: Some("cursor-cli".to_string()),
            model: Some("cursor-cli".to_string()),
            cli_command: None,
            workspace_mode: None,
            runtime_backend: None,
            rootfs_path: None,
            allowed_roots: None,
            identity: None,
            agent_config_prompt: None,
            effort: None,
            platform: None,
            workspace_root: Some(test_root.to_string_lossy().to_string()),
            context_window_size: None,
            max_retries: None,
            knowledge_resources: None,
        };

        let output = run_cli_command(
            &input,
            &format!(
                "{} --print --output-format text --trust",
                fake_cursor.to_string_lossy()
            ),
        )
        .expect("fake cursor command should run");

        assert!(output.contains("cursor"));
        assert!(output.contains("reply with PT_CURSOR_OK"));
    }

    #[test]
    fn agent_execute_turn_routes_cli_provider_to_desktop_runner() {
        let test_root = std::env::temp_dir().join(format!(
            "peers-touch-agent-turn-cli-test-{}",
            std::process::id()
        ));
        let agent_home = test_root.join("agent-home");
        std::fs::create_dir_all(&test_root).expect("test root should be created");
        let fake_cli = test_root.join("fake-cli");
        std::fs::write(
            &fake_cli,
            "#!/bin/sh\nprompt=$(cat)\nprintf 'owner=%s\\nprovider=%s\\n%s' \"$PEERS_TOUCH_CLI_ADAPTER\" \"$PEERS_TOUCH_PROVIDER\" \"$prompt\"\n",
        )
        .expect("fake cli should be written");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&fake_cli)
                .expect("fake cli metadata should exist")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&fake_cli, permissions)
                .expect("fake cli should be executable");
        }

        let previous_agent_home = std::env::var("PEERS_TOUCH_AGENT_HOME").ok();
        std::env::set_var("PEERS_TOUCH_AGENT_HOME", &agent_home);
        let result = agent_execute_turn(
            AgentExecuteTurnInput {
                stream_id: None,
                conversation_id: "conversation-cli".to_string(),
                agent_id: "agent-cli".to_string(),
                user_input: "reply with PT_AGENT_TURN_CLI_OK".to_string(),
                attachments: None,
                provider: Some("custom-cli".to_string()),
                model: Some("fake-cli".to_string()),
                cli_command: Some(fake_cli.to_string_lossy().to_string()),
                workspace_mode: None,
                runtime_backend: None,
                rootfs_path: None,
                allowed_roots: None,
                identity: None,
                agent_config_prompt: None,
                effort: None,
                platform: None,
                workspace_root: None,
                context_window_size: None,
                max_retries: None,
                knowledge_resources: None,
            },
            "unused-token",
            "actor-cli-test",
        );
        if let Some(value) = previous_agent_home {
            std::env::set_var("PEERS_TOUCH_AGENT_HOME", value);
        } else {
            std::env::remove_var("PEERS_TOUCH_AGENT_HOME");
        }

        assert!(result.ok);
        let payload = result.data.expect("payload should exist");
        let status: Value = serde_json::from_str(&payload.status).expect("status should be json");
        assert_eq!(status["executionOwner"], "desktop-rust");
        assert_eq!(status["provider"], "custom-cli");
        assert!(status["result"]
            .as_str()
            .unwrap_or_default()
            .contains("reply with PT_AGENT_TURN_CLI_OK"));
    }

    /// Opt-in real CLI end-to-end check against a locally logged-in `traecli`.
    ///
    /// This test spends real model tokens, so it stays inert during normal runs and only
    /// executes when `PEERS_TOUCH_CLI_E2E=1` is set. It drives the production runner
    /// (`agent_execute_turn` -> `run_cli_command`) through the same `traecli exec` command
    /// template used by the `trae-cli` provider, proving the full
    /// `Agent turn -> Desktop Rust CLI runner -> real traecli -> model reply` closure.
    #[test]
    fn agent_execute_turn_runs_real_traecli_when_opted_in() {
        if std::env::var("PEERS_TOUCH_CLI_E2E").as_deref() != Ok("1") {
            return;
        }

        let result = agent_execute_turn(
            AgentExecuteTurnInput {
                stream_id: None,
                conversation_id: "conversation-traecli-e2e".to_string(),
                agent_id: "agent-traecli-e2e".to_string(),
                user_input: "Reply with exactly this token and nothing else: PT_TRAE_E2E_OK"
                    .to_string(),
                attachments: None,
                provider: Some("trae-cli".to_string()),
                model: Some("trae-cli".to_string()),
                cli_command: Some("traecli exec --skip-git-repo-check -".to_string()),
                workspace_mode: None,
                runtime_backend: None,
                rootfs_path: None,
                allowed_roots: None,
                identity: None,
                agent_config_prompt: None,
                effort: None,
                platform: None,
                workspace_root: None,
                context_window_size: None,
                max_retries: None,
                knowledge_resources: None,
            },
            "unused-token",
            "actor-traecli-e2e-test",
        );

        assert!(result.ok, "traecli turn should succeed: {:?}", result.error);
        let payload = result.data.expect("payload should exist");
        let status: Value = serde_json::from_str(&payload.status).expect("status should be json");
        assert_eq!(status["executionOwner"], "desktop-rust");
        assert_eq!(status["provider"], "trae-cli");
        let output = status["result"].as_str().unwrap_or_default();
        assert!(
            output.contains("PT_TRAE_E2E_OK"),
            "expected model reply to contain PT_TRAE_E2E_OK, got: {output}"
        );
    }

    #[test]
    fn cancel_agent_turn_stream_marks_registered_flag() {
        let stream_id = "agent-turn-test-cancel";
        let flag = register_agent_turn_stream(stream_id);
        let result = cancel_agent_turn_stream(stream_id);
        unregister_agent_turn_stream(stream_id);

        assert!(result.ok);
        assert!(flag.load(Ordering::SeqCst));
    }
}
