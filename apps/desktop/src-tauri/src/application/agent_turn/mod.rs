// `ExecuteTurnRequest` / `ExecuteTurnResponse` exist in `model::agent`, but Station's
// `HandleExecuteTurn` binds JSON to ad-hoc Go structs (not generated protos) and the JSON
// payload includes fields not present on the proto (identity, platform, workspace_root, …).
// `TypedHandler` protobuf mode requires `proto.Message` request types. Keep JSON until the
// subserver handler and proto definitions are aligned with the desktop contract.
// TODO(agent): align `agent.proto` + Station `HandleExecuteTurn` with the full turn payload, then use `request_proto`.
use crate::application::error_resolver::ProviderKind;
use crate::application::{agent_workspace, error_resolver, tools};
use crate::contracts::{
    AgentConversationArchiveInput, AgentConversationCreateInput, AgentConversationGetInput,
    AgentConversationListInput, AgentConversationMessagesInput, AgentConversationRestoreInput,
    AgentConversationUpdateInput, AgentEditAndResendInput, AgentExecuteTurnInput,
    AgentGroupCreateInput, AgentGroupDeleteInput, AgentGroupUpdateInput,
    AgentMessageTranslateInput, AgentRegenerateTurnInput, AgentRetryTurnInput,
    AgentSelectActiveBranchInput, AgentTaskCreateInput, AgentTaskDeleteInput, AgentTaskListInput,
    AgentTaskStatusInput, AgentTaskSubtaskAddInput, AgentTaskSubtaskCompleteInput,
    AgentThreadCreateInput, AgentThreadListInput, AgentThreadMessagesInput,
    AgentTombstoneMessageInput, AgentToolDecisionIntentInput, AgentTurnDiagnosticsInput,
    AgentTurnQueueCancelInput, AgentTurnQueueListInput, AgentTurnTraceGetInput,
    AgentTurnTraceListInput, StubPayload, TopicCommentCreateInput, TopicCommentDeleteInput,
    TopicCommentListInput,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model::agent;
use prost::Message;
use reqwest::blocking::Client;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::Method;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const AGENT_TURN_STREAM_EVENT: &str = "agent:turn-stream-event";
const AGENT_REPLAY_BACKOFF_MS: [u64; 5] = [500, 1_000, 2_000, 4_000, 8_000];
pub fn submit_tool_decision(
    input: AgentToolDecisionIntentInput,
    token: &str,
) -> AppResult<StubPayload> {
    if input.approval_id.trim().is_empty()
        || input.tool_call_id.trim().is_empty()
        || input.decision_id.trim().is_empty()
        || input.idempotency_key.trim().is_empty()
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "agent.toolDecisionInvalid",
            None,
        );
    }

    let payload_hash = tool_decision_payload_hash(
        &input.approval_id,
        &input.tool_call_id,
        &input.decision_id,
        input.expected_revision,
        input.approved,
    );
    let request = agent::SubmitToolApprovalDecisionRequest {
        approval_id: input.approval_id,
        tool_call_id: input.tool_call_id,
        decision_id: input.decision_id,
        expected_revision: input.expected_revision,
        approved: input.approved,
        idempotency_key: input.idempotency_key,
        payload_hash,
    };
    let response = match station_client::request_proto::<_, agent::SubmitToolApprovalDecisionResponse>(
        Method::POST,
        "/sub-agent/agent/tool/decision",
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("agent.toolDecisionSubmitFailed"),
    };

    if response.approval_id != request.approval_id
        || response.tool_call_id != request.tool_call_id
        || response.decision_id != request.decision_id
        || response.approved != request.approved
        || response.idempotency_key != request.idempotency_key
        || response.payload_hash != request.payload_hash
    {
        return AppResult::fail(
            ErrorCode::InternalError,
            "agent.toolDecisionResponseMismatch",
            None,
        );
    }

    let error_code = agent::ToolApprovalDecisionErrorCode::try_from(response.error_code)
        .unwrap_or(agent::ToolApprovalDecisionErrorCode::Unspecified)
        .as_str_name();
    success_payload(
        "agent_submit_tool_decision",
        json!({
            "accepted": response.accepted,
            "decision_revision": response.decision_revision,
            "approval_id": response.approval_id,
            "tool_call_id": response.tool_call_id,
            "decision_id": response.decision_id,
            "approved": response.approved,
            "idempotency_key": response.idempotency_key,
            "payload_hash": response.payload_hash,
            "error_code": error_code,
        }),
    )
}

fn tool_decision_payload_hash(
    approval_id: &str,
    tool_call_id: &str,
    decision_id: &str,
    expected_revision: u64,
    approved: bool,
) -> String {
    let canonical = format!(
        "{}\0{}\0{}\0{}\0{}",
        approval_id, tool_call_id, decision_id, expected_revision, approved,
    );
    hex::encode(Sha256::digest(canonical.as_bytes()))
}

pub fn cancel_agent_turn(turn_id: &str, token: &str) -> AppResult<StubPayload> {
    let turn_id = turn_id.trim();
    if turn_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "turn_id is required", None);
    }
    match station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/turn/cancel",
        token,
        None,
        Some(&json!({ "turn_id": turn_id })),
    ) {
        Ok(_) => success_payload(
            "agent_cancel_turn",
            json!({ "turn_id": turn_id, "status": "cancelling" }),
        ),
        Err(error) => error.into_app_result("Failed to cancel Agent turn"),
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
    tracing::info!(
        command = "agent_execute_turn",
        agent_id = %input.agent_id,
        conversation_id = %input.conversation_id,
        "Executing agent turn via Station"
    );

    let body = build_turn_request_body(input.clone(), true);

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
            tracing::error!(command = "agent_execute_turn", error = %err, "Station turn stream failed");
            resolved_turn_failure(&provider, &err, None)
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

pub fn agent_turn_queue_list(
    input: AgentTurnQueueListInput,
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
    let request = agent::ListQueuedTurnsRequest { conversation_id };
    match station_client::request_proto::<_, agent::ListQueuedTurnsResponse>(
        Method::POST,
        "/sub-agent/agent/turn/queue/list",
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => success_payload(
            "agent_turn_queue_list",
            json!({
                "entries": response.entries.iter().map(turn_queue_entry_json).collect::<Vec<_>>(),
                "queue_capacity": response.queue_capacity,
                "conversation_version": response.conversation_version,
            }),
        ),
        Err(error) => error.into_app_result("agent.turnQueueListFailed"),
    }
}

pub fn agent_turn_queue_cancel(
    input: AgentTurnQueueCancelInput,
    token: &str,
) -> AppResult<StubPayload> {
    let request = agent::CancelQueuedTurnRequest {
        conversation_id: input.conversation_id,
        queue_entry_id: input.queue_entry_id,
        idempotency_key: input.idempotency_key,
        expected_conversation_version: input.expected_conversation_version,
    };
    match station_client::request_proto::<_, agent::CancelQueuedTurnResponse>(
        Method::POST,
        "/sub-agent/agent/turn/queue/cancel",
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => success_payload(
            "agent_turn_queue_cancel",
            json!({
                "entry": response.entry.as_ref().map(turn_queue_entry_json),
                "conversation_version": response.conversation_version,
                "replayed": response.replayed,
            }),
        ),
        Err(error) => error.into_app_result("agent.turnQueueCancelFailed"),
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

pub fn agent_turn_diagnostics_export(
    input: AgentTurnDiagnosticsInput,
    token: &str,
) -> AppResult<Vec<u8>> {
    let turn_id = input.turn_id.trim().to_string();
    if turn_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "turn_id is required", None);
    }
    let request = agent::ExportTurnDiagnosticsRequest { turn_id };
    match station_client::request_proto::<_, agent::ExportTurnDiagnosticsResponse>(
        Method::POST,
        "/sub-agent/agent/turn/diagnostics/export",
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => AppResult::success(response.encode_to_vec()),
        Err(err) => {
            tracing::error!(command = "agent_turn_diagnostics_export", error = %err);
            err.into_app_result("Failed to export agent turn diagnostics")
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
    if let Err(error) = apply_resolved_agent_workspace(&mut input) {
        emit_resolved_error(&app, &stream_id, &provider, &error);
        return;
    }

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
        &token,
        &cancel_flag,
        provider.as_str(),
    );
    if let Err(error) = result {
        emit_resolved_error(&app, &stream_id, &provider, &error);
    }
}

fn build_turn_request_body(input: AgentExecuteTurnInput, stream: bool) -> Value {
    let mut body = json!({
        "client_idempotency_key": input.client_idempotency_key,
        "conversation_id": input.conversation_id,
        "agent_id": input.agent_id,
        "user_input": input.user_input,
        "attachments": input.attachments.unwrap_or_default(),
        "stream": stream,
        "effort": input.effort.unwrap_or_else(|| "medium".to_string()),
        "context_window_size": input.context_window_size.unwrap_or(128000),
        "max_retries": input.max_retries.unwrap_or(3),
    });
    if let Some(provider) = input.provider.filter(|value| !value.trim().is_empty()) {
        body["provider"] = json!(provider);
    }
    if let Some(model) = input.model.filter(|value| !value.trim().is_empty()) {
        body["model"] = json!(model);
    }
    if let Some(identity) = input.identity.filter(|value| !value.trim().is_empty()) {
        body["identity"] = json!(identity);
    }
    if let Some(prompt) = input
        .agent_config_prompt
        .filter(|value| !value.trim().is_empty())
    {
        body["agent_config_prompt"] = json!(prompt);
    }
    if let Some(thinking_mode) = input.thinking_mode.filter(|value| !value.trim().is_empty()) {
        body["thinking_mode"] = json!(thinking_mode);
    }
    if let Some(session_id) = input
        .client_capability_session_id
        .filter(|value| !value.trim().is_empty())
    {
        body["client_capability_session_id"] = json!(session_id);
    }
    if let Some(tools) = input.available_tools.filter(|value| !value.is_empty()) {
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
    token: &str,
    cancel_flag: &AtomicBool,
    provider_id: &str,
) -> Result<(), String> {
    let effective_provider = body
        .get("provider")
        .and_then(|v| v.as_str())
        .unwrap_or(provider_id);

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

    let mut error_emitted = false;
    let mut terminal_received = false;
    let mut last_sequence = 0_i64;
    let mut turn_id = String::new();
    let mut transport_error: Option<String> = None;
    let mut conversation_id = body
        .get("conversation_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut reader = BufReader::new(response);
    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            return Ok(());
        }
        let frame = match read_sse_frame(&mut reader) {
            Ok(frame) => frame,
            Err(error) => {
                transport_error = Some(format!("failed to read Station turn stream: {error}"));
                break;
            }
        };
        if cancel_flag.load(Ordering::SeqCst) {
            return Ok(());
        }
        let Some((event, data)) = frame else {
            break;
        };
        update_turn_cursor(
            &data,
            &mut turn_id,
            &mut conversation_id,
            &mut last_sequence,
        );
        if matches!(event.as_str(), "done" | "error" | "cancelled") {
            terminal_received = true;
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
            emit_resolved_error(app, stream_id, effective_provider, raw);
        } else {
            emit_turn_stream_event(app, stream_id, &event, data);
        }
        if terminal_received {
            return Ok(());
        }
    }
    if !terminal_received && !cancel_flag.load(Ordering::SeqCst) {
        if (turn_id.is_empty() || conversation_id.is_empty()) && transport_error.is_some() {
            return Err(transport_error.unwrap_or_else(|| {
                "Station stream closed before turn identity was received".to_string()
            }));
        }
        emit_turn_stream_event(
            app,
            stream_id,
            "reconciling",
            json!({
                "type": "reconciling",
                "reason": "station_cursor_replay_required"
            }),
        );
        replay_station_turn_events_with_retry(
            app,
            stream_id,
            token,
            &conversation_id,
            &turn_id,
            last_sequence,
            cancel_flag,
        )?;
    }
    Ok(())
}

fn update_turn_cursor(
    data: &Value,
    turn_id: &mut String,
    conversation_id: &mut String,
    last_sequence: &mut i64,
) {
    if let Some(value) = data
        .get("turnId")
        .or_else(|| data.get("turn_id"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        *turn_id = value.to_string();
    }
    if let Some(value) = data
        .get("conversationId")
        .or_else(|| data.get("conversation_id"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        *conversation_id = value.to_string();
    }
    let sequence = data
        .get("seq")
        .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()))
        .unwrap_or_default();
    if sequence > *last_sequence {
        *last_sequence = sequence;
    }
}

fn replay_station_turn_events_with_retry(
    app: &AppHandle,
    stream_id: &str,
    token: &str,
    conversation_id: &str,
    turn_id: &str,
    after_sequence: i64,
    cancel_flag: &AtomicBool,
) -> Result<(), String> {
    let mut last_error = None;
    let mut replay_cursor = after_sequence;
    for attempt in 0..=AGENT_REPLAY_BACKOFF_MS.len() {
        if cancel_flag.load(Ordering::SeqCst) {
            return Ok(());
        }
        if attempt > 0 {
            let delay_ms = AGENT_REPLAY_BACKOFF_MS[attempt - 1];
            let mut waited_ms = 0;
            while waited_ms < delay_ms {
                if cancel_flag.load(Ordering::SeqCst) {
                    return Ok(());
                }
                let slice_ms = (delay_ms - waited_ms).min(100);
                std::thread::sleep(Duration::from_millis(slice_ms));
                waited_ms += slice_ms;
            }
        }
        match replay_station_turn_events(
            app,
            stream_id,
            token,
            conversation_id,
            turn_id,
            replay_cursor,
            cancel_flag,
        ) {
            Ok(ReplayOutcome::Terminal) => return Ok(()),
            Ok(ReplayOutcome::CaughtUp(sequence)) => {
                replay_cursor = replay_cursor.max(sequence);
                last_error = Some(format!(
                    "turn remains non-terminal at replay cursor {replay_cursor}"
                ));
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(format!(
        "Station turn replay failed after {} attempts: {}",
        AGENT_REPLAY_BACKOFF_MS.len() + 1,
        last_error.unwrap_or_else(|| "unknown replay failure".to_string())
    ))
}

#[derive(Debug, PartialEq, Eq)]
enum ReplayOutcome {
    Terminal,
    CaughtUp(i64),
}

fn replay_event_is_terminal(event: &str, data: &Value) -> bool {
    if matches!(event, "done" | "error" | "cancelled") {
        return true;
    }
    if event != "snapshot" {
        return false;
    }
    matches!(
        data.get("status")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "completed" | "failed" | "cancelled" | "interrupted"
    )
}

fn replay_station_turn_events(
    app: &AppHandle,
    stream_id: &str,
    token: &str,
    conversation_id: &str,
    turn_id: &str,
    after_sequence: i64,
    cancel_flag: &AtomicBool,
) -> Result<ReplayOutcome, String> {
    if conversation_id.trim().is_empty() || turn_id.trim().is_empty() {
        return Err("Station stream closed before turn identity was received".to_string());
    }
    let url = format!(
        "{}{}",
        station_client::station_base_url(),
        "/sub-agent/agent/conversation/events"
    );
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("failed to create Station replay client: {error}"))?;
    let response = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
        .header("Accept", "text/event-stream")
        .json(&json!({
            "conversation_id": conversation_id,
            "turn_id": turn_id,
            "after_seq": after_sequence,
        }))
        .send()
        .map_err(|error| format!("Station turn replay request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Station turn replay returned HTTP {}",
            response.status()
        ));
    }
    let mut reader = BufReader::new(response);
    let mut last_sequence = after_sequence;
    let mut replay_turn_id = turn_id.to_string();
    let mut replay_conversation_id = conversation_id.to_string();
    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            return Ok(ReplayOutcome::Terminal);
        }
        let Some((event, data)) = read_sse_frame(&mut reader)
            .map_err(|error| format!("failed to read Station turn replay: {error}"))?
        else {
            break;
        };
        update_turn_cursor(
            &data,
            &mut replay_turn_id,
            &mut replay_conversation_id,
            &mut last_sequence,
        );
        let terminal = replay_event_is_terminal(&event, &data);
        let caught_up = event == "catchup_done";
        emit_turn_stream_event(app, stream_id, &event, data);
        if terminal {
            return Ok(ReplayOutcome::Terminal);
        }
        if caught_up {
            return Ok(ReplayOutcome::CaughtUp(last_sequence));
        }
    }
    Err("Station turn replay closed without catchup_done".to_string())
}

fn read_sse_frame<R: BufRead>(reader: &mut R) -> Result<Option<(String, Value)>, String> {
    let mut frame = String::new();
    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .map_err(|error| format!("failed to read SSE frame: {error}"))?;
        if read == 0 {
            return Ok(parse_sse_frame(&frame));
        }
        if line == "\n" || line == "\r\n" {
            if let Some(parsed) = parse_sse_frame(&frame) {
                return Ok(Some(parsed));
            }
            frame.clear();
            continue;
        }
        frame.push_str(&line);
    }
}

fn string_field(data: &Value, key: &str) -> Option<String> {
    data.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.is_empty())
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

fn resolved_turn_failure(
    provider_id: &str,
    raw_message: &str,
    details: Option<&Value>,
) -> AppResult<StubPayload> {
    let error_text = extract_station_error_message(raw_message, details);
    let resolved = error_resolver::resolve_error(provider_id, &error_text);
    let mut details_obj = json!({});
    if let Some(detail) = resolved.detail {
        details_obj["detail"] = json!(detail);
    }
    if let Some(action) = resolved.action {
        details_obj["resolution"] = json!(action);
    }
    if let Some(provider_id) = resolved.provider_id {
        details_obj["providerId"] = json!(provider_id);
    }
    AppResult::fail(
        ErrorCode::InternalError,
        resolved.message,
        Some(details_obj),
    )
}

fn extract_station_error_message(raw: &str, details: Option<&Value>) -> String {
    if let Some(body) = details
        .and_then(|value| value.get("body"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return body.to_string();
    }
    raw.to_string()
}

fn emit_resolved_error(app: &AppHandle, stream_id: &str, provider_id: &str, raw_error: &str) {
    let wrapped =
        error_resolver::wrap_stream_error(provider_id, ProviderKind::Direct, raw_error, None);
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

pub fn agent_conversation_update(
    input: AgentConversationUpdateInput,
    token: &str,
) -> AppResult<StubPayload> {
    let conversation_id = input.conversation_id.trim().to_string();
    if conversation_id.is_empty() || input.expected_version == 0 {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id and expected_version are required",
            None,
        );
    }
    let body = json!({
        "conversation_id": conversation_id,
        "expected_version": input.expected_version,
        "title": input.title.unwrap_or_default(),
        "description": input.description.unwrap_or_default(),
        "model_name": input.model_name.unwrap_or_default(),
        "meta": input.meta.unwrap_or_default(),
        "active_branch_message_id": input.active_branch_message_id,
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/conversation/update",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_conversation_update", result),
        Err(err) => err.into_app_result("Failed to update agent conversation"),
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
    if conversation_id.is_empty() || input.expected_version == 0 {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id and expected_version are required",
            None,
        );
    }
    let body = json!({
        "conversation_id": conversation_id,
        "permanent": input.permanent.unwrap_or(false),
        "expected_version": input.expected_version,
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

pub fn agent_conversation_restore(
    input: AgentConversationRestoreInput,
    token: &str,
) -> AppResult<StubPayload> {
    let conversation_id = input.conversation_id.trim().to_string();
    if conversation_id.is_empty() || input.expected_version == 0 {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id and expected_version are required",
            None,
        );
    }
    let body = json!({
        "conversation_id": conversation_id,
        "expected_version": input.expected_version,
    });
    match station_client::request_json(
        Method::POST,
        "/sub-agent/agent/conversation/restore",
        token,
        None,
        Some(body),
    ) {
        Ok(result) => success_payload("agent_conversation_restore", result),
        Err(err) => {
            tracing::error!(command = "agent_conversation_restore", error = %err, "Conversation restore failed");
            err.into_app_result("Failed to restore agent conversation")
        }
    }
}

fn revision_command<Input: Serialize>(
    command: &str,
    path: &str,
    input: Input,
    token: &str,
) -> AppResult<StubPayload> {
    let body = match serde_json::to_value(input) {
        Ok(body) => body,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("invalid revision command: {error}"),
                None,
            )
        }
    };
    match station_client::request_json(Method::POST, path, token, None, Some(body)) {
        Ok(result) => success_payload(command, result),
        Err(error) => error.into_app_result(format!("{command} failed")),
    }
}

pub fn agent_retry_turn(input: AgentRetryTurnInput, token: &str) -> AppResult<StubPayload> {
    revision_command(
        "agent_retry_turn",
        "/sub-agent/agent/turn/retry",
        input,
        token,
    )
}

pub fn agent_regenerate_turn(
    input: AgentRegenerateTurnInput,
    token: &str,
) -> AppResult<StubPayload> {
    revision_command(
        "agent_regenerate_turn",
        "/sub-agent/agent/turn/regenerate",
        input,
        token,
    )
}

pub fn agent_edit_and_resend(
    input: AgentEditAndResendInput,
    token: &str,
) -> AppResult<StubPayload> {
    revision_command(
        "agent_edit_and_resend",
        "/sub-agent/agent/message/edit-resend",
        input,
        token,
    )
}

pub fn agent_select_active_branch(
    input: AgentSelectActiveBranchInput,
    token: &str,
) -> AppResult<StubPayload> {
    revision_command(
        "agent_select_active_branch",
        "/sub-agent/agent/conversation/select-branch",
        input,
        token,
    )
}

pub fn agent_tombstone_message(
    input: AgentTombstoneMessageInput,
    token: &str,
) -> AppResult<StubPayload> {
    revision_command(
        "agent_tombstone_message",
        "/sub-agent/agent/message/tombstone",
        input,
        token,
    )
}

fn turn_queue_entry_json(entry: &agent::TurnQueueEntry) -> Value {
    json!({
        "queue_entry_id": entry.queue_entry_id,
        "conversation_id": entry.conversation_id,
        "agent_id": entry.agent_id,
        "client_idempotency_key": entry.client_idempotency_key,
        "status": agent::TurnQueueStatus::try_from(entry.status)
            .unwrap_or(agent::TurnQueueStatus::Unspecified)
            .as_str_name(),
        "queue_sequence": entry.queue_sequence,
        "queue_position": entry.queue_position,
        "admitted_turn_id": entry.admitted_turn_id,
        "user_input": entry.user_input,
        "created_at": entry.created_at.as_ref().map(|value| json!({
            "seconds": value.seconds,
            "nanos": value.nanos,
        })),
        "updated_at": entry.updated_at.as_ref().map(|value| json!({
            "seconds": value.seconds,
            "nanos": value.nanos,
        })),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_decision_hash_matches_station_canonical_contract() {
        assert_eq!(
            tool_decision_payload_hash("approval-1", "tool-call-1", "decision-1", 0, true,),
            "4d8f48896d7fc4b24b44328c4d59f2938a5cb5a0db8fcea7f5afcdfdbfbca9ef",
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
    fn replay_backoff_is_bounded() {
        assert_eq!(AGENT_REPLAY_BACKOFF_MS, [500, 1_000, 2_000, 4_000, 8_000]);
        assert_eq!(AGENT_REPLAY_BACKOFF_MS.iter().sum::<u64>(), 15_500);
    }

    #[test]
    fn catchup_done_is_not_a_terminal_turn_event() {
        assert!(!replay_event_is_terminal(
            "catchup_done",
            &json!({"type": "catchup_done", "seq": 4}),
        ));
        assert!(!replay_event_is_terminal(
            "snapshot",
            &json!({"status": "running", "seq": 4}),
        ));
        assert!(replay_event_is_terminal(
            "snapshot",
            &json!({"status": "completed", "seq": 9}),
        ));
        assert!(replay_event_is_terminal("done", &json!({"seq": 9}),));
    }

    #[test]
    fn turn_request_preserves_selected_capability_session() {
        let input: AgentExecuteTurnInput = serde_json::from_value(json!({
            "client_idempotency_key": "request-1",
            "conversation_id": "conversation-1",
            "agent_id": "agent-1",
            "user_input": "read the selected resource",
            "client_capability_session_id": "capability-session-1"
        }))
        .expect("turn input should deserialize");

        let body = build_turn_request_body(input, true);

        assert_eq!(
            body.get("client_capability_session_id")
                .and_then(Value::as_str),
            Some("capability-session-1"),
        );
    }

    #[test]
    fn turn_request_preserves_explicit_thinking_mode() {
        let input: AgentExecuteTurnInput = serde_json::from_value(json!({
            "client_idempotency_key": "request-1",
            "conversation_id": "conversation-1",
            "agent_id": "agent-1",
            "user_input": "answer directly",
            "thinking_mode": "disabled"
        }))
        .expect("turn input should deserialize");

        let body = build_turn_request_body(input, true);

        assert_eq!(
            body.get("thinking_mode").and_then(Value::as_str),
            Some("disabled"),
        );
    }

    #[test]
    fn sse_reader_returns_each_frame_without_waiting_for_stream_eof() {
        let payload = b"event: text\ndata: {\"text\":\"hello\",\"seq\":1}\n\nevent: catchup_done\ndata: {\"seq\":1}\n\n";
        let mut reader = std::io::BufReader::new(&payload[..]);

        let first = read_sse_frame(&mut reader)
            .expect("first frame read should succeed")
            .expect("first frame should exist");
        assert_eq!(first.0, "text");

        let second = read_sse_frame(&mut reader)
            .expect("second frame read should succeed")
            .expect("second frame should exist");
        assert_eq!(second.0, "catchup_done");
    }
}
