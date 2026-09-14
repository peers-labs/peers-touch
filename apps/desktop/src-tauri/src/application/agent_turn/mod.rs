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
use futures_lite::StreamExt;
use prost::Message;
use reqwest::blocking::Client as BlockingClient;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Client, Method};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::future::Future;
use std::io::{BufRead, Read};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

const AGENT_TURN_STREAM_EVENT: &str = "agent:turn-stream-event";
const AGENT_REPLAY_BACKOFF_MS: [u64; 5] = [500, 1_000, 2_000, 4_000, 8_000];
const AGENT_STREAM_ADMISSION_TIMEOUT: Duration = Duration::from_secs(30);

// #region debug-point B-D:native-replay-transport
fn report_native_replay_debug(
    hypothesis_id: &'static str,
    location: &'static str,
    message: &'static str,
    data: Value,
) {
    let Ok(url) = std::env::var("DEBUG_SERVER_URL") else {
        return;
    };
    let session_id =
        std::env::var("DEBUG_SESSION_ID").unwrap_or_else(|_| "native-replay-timeout".to_string());
    let run_id = std::env::var("DEBUG_RUN_ID").unwrap_or_else(|_| "post-fix".to_string());
    tauri::async_runtime::spawn(async move {
        let _ = Client::new()
            .post(url)
            .json(&json!({
                "sessionId": session_id,
                "runId": run_id,
                "hypothesisId": hypothesis_id,
                "location": location,
                "msg": format!("[DEBUG] {message}"),
                "data": data,
            }))
            .send()
            .await;
    });
}
// #endregion

struct ReplayStreamRegistration {
    generation: u64,
    cancel: watch::Sender<bool>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LiveStreamControl {
    Active,
    CancelTurn,
    DisconnectTransport,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct AgentStreamKey {
    window_label: String,
    ptid: String,
    stream_id: String,
}

pub struct ReplayCancellation {
    key: AgentStreamKey,
    generation: u64,
    receiver: watch::Receiver<bool>,
}

struct LiveStreamRegistration {
    generation: u64,
    control: watch::Sender<LiveStreamControl>,
}

pub struct LiveStreamCancellation {
    key: AgentStreamKey,
    generation: u64,
    receiver: watch::Receiver<LiveStreamControl>,
}

fn replay_stream_registry() -> &'static Mutex<HashMap<AgentStreamKey, ReplayStreamRegistration>> {
    static REGISTRY: OnceLock<Mutex<HashMap<AgentStreamKey, ReplayStreamRegistration>>> =
        OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn live_stream_registry() -> &'static Mutex<HashMap<AgentStreamKey, LiveStreamRegistration>> {
    static REGISTRY: OnceLock<Mutex<HashMap<AgentStreamKey, LiveStreamRegistration>>> =
        OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn stream_key(window_label: &str, ptid: &str, stream_id: &str) -> AgentStreamKey {
    AgentStreamKey {
        window_label: window_label.to_string(),
        ptid: ptid.to_string(),
        stream_id: stream_id.to_string(),
    }
}

pub fn register_agent_turn_replay_stream(
    window_label: &str,
    ptid: &str,
    stream_id: &str,
) -> ReplayCancellation {
    static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);
    let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);
    let (cancel, receiver) = watch::channel(false);
    let key = stream_key(window_label, ptid, stream_id);
    if let Ok(mut registry) = replay_stream_registry().lock() {
        let previous_key = registry
            .keys()
            .find(|candidate| {
                candidate.window_label == window_label && candidate.stream_id == stream_id
            })
            .cloned();
        if let Some(previous) = previous_key.and_then(|key| registry.remove(&key)) {
            let _ = previous.cancel.send(true);
        }
        registry.insert(key.clone(), ReplayStreamRegistration { generation, cancel });
    }
    ReplayCancellation {
        key,
        generation,
        receiver,
    }
}

pub fn cancel_agent_turn_replay_stream(window_label: &str, stream_id: &str) {
    if let Ok(mut registry) = replay_stream_registry().lock() {
        let key = registry
            .keys()
            .find(|key| key.window_label == window_label && key.stream_id == stream_id)
            .cloned();
        if let Some(registration) = key.and_then(|key| registry.remove(&key)) {
            let _ = registration.cancel.send(true);
        }
    }
}

fn unregister_agent_turn_replay_stream(key: &AgentStreamKey, generation: u64) {
    if let Ok(mut registry) = replay_stream_registry().lock() {
        if registry
            .get(key)
            .is_some_and(|registration| registration.generation == generation)
        {
            registry.remove(key);
        }
    }
}

pub fn register_agent_turn_live_stream(
    window_label: &str,
    ptid: &str,
    stream_id: &str,
) -> LiveStreamCancellation {
    static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);
    let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);
    let (control, receiver) = watch::channel(LiveStreamControl::Active);
    let key = stream_key(window_label, ptid, stream_id);
    if let Ok(mut registry) = live_stream_registry().lock() {
        let previous_key = registry
            .keys()
            .find(|candidate| {
                candidate.window_label == window_label && candidate.stream_id == stream_id
            })
            .cloned();
        if let Some(previous) = previous_key.and_then(|key| registry.remove(&key)) {
            let _ = previous.control.send(LiveStreamControl::CancelTurn);
        }
        registry.insert(
            key.clone(),
            LiveStreamRegistration {
                generation,
                control,
            },
        );
    }
    LiveStreamCancellation {
        key,
        generation,
        receiver,
    }
}

pub fn cancel_agent_turn_live_stream(window_label: &str, stream_id: &str) {
    if let Ok(mut registry) = live_stream_registry().lock() {
        let key = registry
            .keys()
            .find(|key| key.window_label == window_label && key.stream_id == stream_id)
            .cloned();
        if let Some(registration) = key.and_then(|key| registry.remove(&key)) {
            let _ = registration.control.send(LiveStreamControl::CancelTurn);
        }
    }
}

pub fn disconnect_agent_turn_live_stream(window_label: &str, stream_id: &str) {
    if let Ok(mut registry) = live_stream_registry().lock() {
        let key = registry
            .keys()
            .find(|key| key.window_label == window_label && key.stream_id == stream_id)
            .cloned();
        if let Some(registration) = key.and_then(|key| registry.remove(&key)) {
            let _ = registration
                .control
                .send(LiveStreamControl::DisconnectTransport);
        }
    }
}

fn unregister_agent_turn_live_stream(key: &AgentStreamKey, generation: u64) {
    if let Ok(mut registry) = live_stream_registry().lock() {
        if registry
            .get(key)
            .is_some_and(|registration| registration.generation == generation)
        {
            registry.remove(key);
        }
    }
}
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
    let outcome_error = tool_decision_outcome_json(response.outcome_error.as_ref());
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
            "outcome_error": outcome_error,
        }),
    )
}

fn tool_decision_outcome_json(error: Option<&agent::ErrorPayload>) -> Option<Value> {
    error.map(|error| {
        json!({
            "error": error.error,
            "error_type": error.error_type,
            "locale_key": error.locale_key,
            "retryable": error.retryable,
            "terminal": error.terminal,
            "details": error.details,
        })
    })
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
        Ok(result) => success_payload("agent_cancel_turn", result),
        Err(error) => error.into_app_result("agent.turnCancelFailed"),
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentTurnStreamEventPayload {
    stream_id: String,
    ptid: String,
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
    let client = BlockingClient::builder()
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
    // #region debug-point A-E:diagnostics-export-boundary
    let turn_id_hash = hex::encode(Sha256::digest(turn_id.as_bytes()));
    let request_started = Instant::now();
    report_native_replay_debug(
        "E",
        "agent_turn/mod.rs:agent_turn_diagnostics_export:entry",
        "diagnostics export started",
        json!({
            "turnIdHash": turn_id_hash,
            "tokenPresent": !token.trim().is_empty(),
        }),
    );
    // #endregion
    let request = agent::ExportTurnDiagnosticsRequest { turn_id };
    match station_client::request_proto::<_, agent::ExportTurnDiagnosticsResponse>(
        Method::POST,
        "/sub-agent/agent/turn/diagnostics/export",
        token,
        None,
        Some(&request),
    ) {
        Ok(response) => {
            // #region debug-point A-D:diagnostics-export-success
            let encoded = response.encode_to_vec();
            let replay = response.replay.as_ref();
            report_native_replay_debug(
                "A-D",
                "agent_turn/mod.rs:agent_turn_diagnostics_export:success",
                "diagnostics export decoded",
                json!({
                    "turnIdHash": turn_id_hash,
                    "durationMs": request_started.elapsed().as_millis(),
                    "encodedBytes": encoded.len(),
                    "replayPresent": replay.is_some(),
                    "attemptCount": replay.map(|value| value.attempts.len()).unwrap_or_default(),
                    "toolCallCount": replay.map(|value| value.tool_calls.len()).unwrap_or_default(),
                    "messageCount": replay.map(|value| value.messages.len()).unwrap_or_default(),
                }),
            );
            // #endregion
            AppResult::success(encoded)
        }
        Err(err) => {
            // #region debug-point A-E:diagnostics-export-error
            report_native_replay_debug(
                "A-E",
                "agent_turn/mod.rs:agent_turn_diagnostics_export:error",
                "diagnostics export failed",
                json!({
                    "turnIdHash": turn_id_hash,
                    "durationMs": request_started.elapsed().as_millis(),
                    "error": err.to_string(),
                    "errorType": std::any::type_name_of_val(&err),
                }),
            );
            // #endregion
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
    ptid: String,
    mut cancellation: LiveStreamCancellation,
) {
    let provider = input.provider.as_deref().unwrap_or("").trim().to_string();
    let window_label = cancellation.key.window_label.clone();
    let result = match apply_resolved_agent_workspace(&mut input) {
        Err(error) => Err(error),
        Ok(()) => {
            if input.available_tools.is_none() {
                if let Ok(tool_entries) = tools::tools_list_entries() {
                    input.available_tools = Some(tool_entries);
                }
            }
            let body = build_turn_request_body(input, true);
            tauri::async_runtime::block_on(stream_station_turn(
                &app,
                &window_label,
                &stream_id,
                &body,
                &token,
                &ptid,
                &mut cancellation.receiver,
                provider.as_str(),
            ))
        }
    };
    if let Err(error) = result {
        emit_resolved_error_to(&app, &window_label, &stream_id, &ptid, &provider, &error);
    }
    unregister_agent_turn_live_stream(&cancellation.key, cancellation.generation);
}

pub async fn agent_replay_turn_stream(
    app: AppHandle,
    window_label: String,
    stream_id: String,
    token: String,
    ptid: String,
    conversation_id: String,
    turn_id: String,
    attempt_id: String,
    after_sequence: i64,
    mut cancellation: ReplayCancellation,
) {
    if let Err(error) = replay_station_turn_events_with_retry(
        &app,
        &window_label,
        &stream_id,
        &token,
        &ptid,
        &conversation_id,
        &turn_id,
        &attempt_id,
        after_sequence,
        &mut cancellation.receiver,
    )
    .await
    {
        emit_turn_stream_event_to(
            &app,
            &window_label,
            &stream_id,
            &ptid,
            "recovery_failed",
            json!({
                "type": "recovery_failed",
                "error": error,
                "turnId": turn_id,
                "conversationId": conversation_id,
                "seq": after_sequence
            }),
        );
    }
    unregister_agent_turn_replay_stream(&cancellation.key, cancellation.generation);
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
    if let Some(requested_budget) = input.requested_budget {
        body["requested_budget"] = json!(requested_budget);
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

async fn stream_station_turn(
    app: &AppHandle,
    window_label: &str,
    stream_id: &str,
    body: &Value,
    token: &str,
    ptid: &str,
    cancellation: &mut watch::Receiver<LiveStreamControl>,
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
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("failed to create Station stream client: {error}"))?;
    let auth = format!("Bearer {}", token.trim());
    let (response, admission_control) = await_stream_admission(
        client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .header(AUTHORIZATION, auth)
            .header("Accept", "text/event-stream")
            .json(body)
            .send(),
        cancellation,
        AGENT_STREAM_ADMISSION_TIMEOUT,
    )
    .await?;
    let response =
        response.map_err(|error| format!("Station turn stream request failed: {error}"))?;
    let admitted_turn_id = response
        .headers()
        .get("x-agent-turn-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string();
    if !response.status().is_success() {
        return Err(format!(
            "Station turn stream returned HTTP {}",
            response.status()
        ));
    }
    if admission_control == LiveStreamControl::CancelTurn {
        if admitted_turn_id.is_empty() {
            return Err("agent.error.streamIdentityMissing".to_string());
        }
        return cancel_live_stream_turn(&admitted_turn_id, token);
    }
    if admission_control == LiveStreamControl::DisconnectTransport && admitted_turn_id.is_empty() {
        return Err("agent.error.streamIdentityMissing".to_string());
    }

    let mut error_emitted = false;
    let mut terminal_received = false;
    let mut last_sequence = 0_i64;
    let mut turn_id = admitted_turn_id;
    let mut transport_error: Option<String> = None;
    let mut transport_disconnect_requested =
        admission_control == LiveStreamControl::DisconnectTransport;
    let mut conversation_id = body
        .get("conversation_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut body = response.bytes_stream();
    let mut buffer = Vec::new();
    'stream: loop {
        if transport_disconnect_requested {
            break;
        }
        let chunk = match next_live_stream_item_or_control(body.next(), cancellation).await {
            LiveStreamItem::Control(LiveStreamControl::CancelTurn) => {
                if turn_id.is_empty() {
                    return Ok(());
                }
                return cancel_live_stream_turn(&turn_id, token);
            }
            LiveStreamItem::Control(LiveStreamControl::DisconnectTransport) => {
                transport_disconnect_requested = true;
                break;
            }
            LiveStreamItem::Control(LiveStreamControl::Active) => continue,
            LiveStreamItem::Item(chunk) => chunk,
        };
        let Some(chunk) = chunk else {
            break;
        };
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                transport_error = Some(format!("failed to read Station turn stream: {error}"));
                break;
            }
        };
        buffer.extend_from_slice(&chunk);
        while let Some((event, data)) = take_sse_frame(&mut buffer)? {
            update_turn_cursor(
                &data,
                &mut turn_id,
                &mut conversation_id,
                &mut last_sequence,
            );
            let data = bind_turn_stream_identity(data, &turn_id, &conversation_id);
            match live_stream_control(cancellation) {
                LiveStreamControl::CancelTurn => {
                    if turn_id.is_empty() {
                        return Ok(());
                    }
                    return cancel_live_stream_turn(&turn_id, token);
                }
                LiveStreamControl::DisconnectTransport => {
                    transport_disconnect_requested = true;
                    break 'stream;
                }
                LiveStreamControl::Active => {}
            }
            if matches!(event.as_str(), "done" | "error" | "cancelled") {
                terminal_received = true;
            }
            if event == "error" {
                if error_emitted {
                    continue;
                }
                error_emitted = true;
                let payload = station_stream_error_payload(effective_provider, data);
                emit_turn_stream_event_to(app, window_label, stream_id, ptid, "error", payload);
            } else {
                emit_turn_stream_event_to(app, window_label, stream_id, ptid, &event, data);
            }
            if terminal_received {
                return Ok(());
            }
        }
    }
    if should_flush_live_stream_tail(transport_disconnect_requested, &buffer) {
        let frame = String::from_utf8(buffer)
            .map_err(|error| format!("Station turn stream returned invalid UTF-8: {error}"))?;
        if let Some((event, data)) = parse_sse_frame(&frame) {
            update_turn_cursor(
                &data,
                &mut turn_id,
                &mut conversation_id,
                &mut last_sequence,
            );
            let data = bind_turn_stream_identity(data, &turn_id, &conversation_id);
            if matches!(event.as_str(), "done" | "error" | "cancelled") {
                terminal_received = true;
            }
            if event == "error" {
                let payload = station_stream_error_payload(effective_provider, data);
                emit_turn_stream_event_to(app, window_label, stream_id, ptid, "error", payload);
            } else {
                emit_turn_stream_event_to(app, window_label, stream_id, ptid, &event, data);
            }
        }
    }
    if !terminal_received && live_stream_control(cancellation) != LiveStreamControl::CancelTurn {
        if (turn_id.is_empty() || conversation_id.is_empty()) && transport_error.is_some() {
            return Err(transport_error.unwrap_or_else(|| {
                "Station stream closed before turn identity was received".to_string()
            }));
        }
        emit_turn_stream_event_to(
            app,
            window_label,
            stream_id,
            ptid,
            "connection_lost",
            json!({
                "type": "connection_lost",
                "reason": if transport_disconnect_requested {
                    "transport_disconnect_requested".to_string()
                } else {
                    transport_error.unwrap_or_else(|| "station_stream_closed".to_string())
                },
                "turnId": turn_id,
                "conversationId": conversation_id,
                "seq": last_sequence,
                "recoveryHandoff": true
            }),
        );
    }
    Ok(())
}

enum CancellableStreamItem<T> {
    Item(T),
    Cancelled,
}

enum LiveStreamItem<T> {
    Item(T),
    Control(LiveStreamControl),
}

async fn await_stream_admission<F, T>(
    response: F,
    cancellation: &mut watch::Receiver<LiveStreamControl>,
    timeout: Duration,
) -> Result<(T, LiveStreamControl), String>
where
    F: Future<Output = T>,
{
    tokio::pin!(response);
    let deadline = tokio::time::Instant::now() + timeout;
    let mut requested_control = live_stream_control(cancellation);
    loop {
        tokio::select! {
            output = &mut response => {
                let current_control = live_stream_control(cancellation);
                return Ok((output, if current_control == LiveStreamControl::Active {
                    requested_control
                } else {
                    current_control
                }));
            }
            _ = tokio::time::sleep_until(deadline) => {
                return Err("agent.error.streamAdmissionTimeout".to_string());
            }
            changed = cancellation.changed() => {
                if changed.is_err() {
                    requested_control = LiveStreamControl::CancelTurn;
                } else {
                    requested_control = live_stream_control(cancellation);
                }
            }
        }
    }
}

async fn next_live_stream_item_or_control<F, T>(
    item: F,
    cancellation: &mut watch::Receiver<LiveStreamControl>,
) -> LiveStreamItem<T>
where
    F: Future<Output = T>,
{
    let current_control = live_stream_control(cancellation);
    if current_control != LiveStreamControl::Active {
        return LiveStreamItem::Control(current_control);
    }
    tokio::select! {
        item = item => LiveStreamItem::Item(item),
        changed = cancellation.changed() => {
            if changed.is_err() {
                LiveStreamItem::Control(LiveStreamControl::CancelTurn)
            } else {
                LiveStreamItem::Control(live_stream_control(cancellation))
            }
        }
    }
}

fn live_stream_control(cancellation: &watch::Receiver<LiveStreamControl>) -> LiveStreamControl {
    *cancellation.borrow()
}

async fn next_stream_item_or_cancel<F, T>(
    item: F,
    cancellation: &mut watch::Receiver<bool>,
) -> CancellableStreamItem<T>
where
    F: Future<Output = T>,
{
    if replay_is_cancelled(cancellation) {
        return CancellableStreamItem::Cancelled;
    }
    tokio::select! {
        item = item => CancellableStreamItem::Item(item),
        changed = cancellation.changed() => {
            let _ = changed;
            CancellableStreamItem::Cancelled
        }
    }
}

fn cancel_live_stream_turn(turn_id: &str, token: &str) -> Result<(), String> {
    let result = cancel_agent_turn(turn_id, token);
    if result.ok {
        return Ok(());
    }
    let message = result
        .error
        .map(|error| error.message)
        .unwrap_or_else(|| "Agent turn cancellation failed".to_string());
    Err(message)
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

fn bind_turn_stream_identity(mut data: Value, turn_id: &str, conversation_id: &str) -> Value {
    let Some(payload) = data.as_object_mut() else {
        return data;
    };
    if !turn_id.is_empty() && !payload.contains_key("turnId") && !payload.contains_key("turn_id") {
        payload.insert("turnId".to_string(), json!(turn_id));
    }
    if !conversation_id.is_empty()
        && !payload.contains_key("conversationId")
        && !payload.contains_key("conversation_id")
    {
        payload.insert("conversationId".to_string(), json!(conversation_id));
    }
    data
}

fn replay_is_cancelled(cancellation: &watch::Receiver<bool>) -> bool {
    *cancellation.borrow()
}

async fn wait_for_replay_retry(delay: Duration, cancellation: &mut watch::Receiver<bool>) -> bool {
    if replay_is_cancelled(cancellation) {
        return true;
    }
    tokio::select! {
        _ = tokio::time::sleep(delay) => false,
        changed = cancellation.changed() => {
            changed.is_err() || replay_is_cancelled(cancellation)
        }
    }
}

async fn replay_station_turn_events_with_retry(
    app: &AppHandle,
    window_label: &str,
    stream_id: &str,
    token: &str,
    ptid: &str,
    conversation_id: &str,
    turn_id: &str,
    attempt_id: &str,
    after_sequence: i64,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let mut last_error = None;
    for attempt in 0..=AGENT_REPLAY_BACKOFF_MS.len() {
        if replay_is_cancelled(cancellation) {
            return Ok(());
        }
        if attempt > 0
            && wait_for_replay_retry(
                Duration::from_millis(AGENT_REPLAY_BACKOFF_MS[attempt - 1]),
                cancellation,
            )
            .await
        {
            return Ok(());
        }
        emit_turn_stream_event_to(
            app,
            window_label,
            stream_id,
            ptid,
            "reconnecting",
            json!({
                "type": "reconnecting",
                "attempt": attempt + 1,
                "turnId": turn_id,
                "conversationId": conversation_id,
                "seq": after_sequence
            }),
        );
        emit_turn_stream_event_to(
            app,
            window_label,
            stream_id,
            ptid,
            "replaying",
            json!({
                "type": "replaying",
                "turnId": turn_id,
                "conversationId": conversation_id,
                "seq": after_sequence
            }),
        );
        match replay_station_turn_events(
            app,
            window_label,
            stream_id,
            token,
            ptid,
            conversation_id,
            turn_id,
            attempt_id,
            after_sequence,
            cancellation,
        )
        .await
        {
            Ok(ReplayOutcome::Terminal | ReplayOutcome::Cancelled) => return Ok(()),
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
    Cancelled,
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

fn replay_event_closes_stream(event: &str, data: &Value, live_tail_established: bool) -> bool {
    replay_event_is_terminal(event, data) && (live_tail_established || event == "snapshot")
}

fn build_replay_request_body(
    conversation_id: &str,
    turn_id: &str,
    attempt_id: &str,
    after_sequence: i64,
) -> Value {
    let mut body = json!({
        "conversation_id": conversation_id,
        "turn_id": turn_id,
        "afterSequence": after_sequence,
    });
    if !attempt_id.trim().is_empty() {
        body["attempt_id"] = json!(attempt_id.trim());
    }
    body
}

fn take_sse_frame(buffer: &mut Vec<u8>) -> Result<Option<(String, Value)>, String> {
    let lf_boundary = buffer.windows(2).position(|window| window == b"\n\n");
    let crlf_boundary = buffer.windows(4).position(|window| window == b"\r\n\r\n");
    let boundary = match (lf_boundary, crlf_boundary) {
        (Some(lf), Some(crlf)) if lf <= crlf => Some((lf, 2)),
        (Some(_), Some(crlf)) => Some((crlf, 4)),
        (Some(lf), None) => Some((lf, 2)),
        (None, Some(crlf)) => Some((crlf, 4)),
        (None, None) => None,
    };
    let Some((index, delimiter_len)) = boundary else {
        return Ok(None);
    };
    let remainder = buffer.split_off(index + delimiter_len);
    let frame = std::mem::replace(buffer, remainder);
    let frame = String::from_utf8(frame[..index].to_vec())
        .map_err(|error| format!("Station turn replay returned invalid UTF-8: {error}"))?;
    Ok(parse_sse_frame(&frame))
}

fn should_flush_live_stream_tail(transport_disconnect_requested: bool, buffer: &[u8]) -> bool {
    !transport_disconnect_requested && !buffer.is_empty()
}

fn emit_replay_event(
    app: &AppHandle,
    window_label: &str,
    stream_id: &str,
    ptid: &str,
    event: String,
    data: Value,
    replay_turn_id: &mut String,
    replay_conversation_id: &mut String,
    last_sequence: &mut i64,
    live_tail_established: &mut bool,
) -> bool {
    update_turn_cursor(&data, replay_turn_id, replay_conversation_id, last_sequence);
    let terminal = replay_event_is_terminal(&event, &data);
    if event == "snapshot" && terminal && !*live_tail_established {
        *live_tail_established = true;
        emit_turn_stream_event_to(
            app,
            window_label,
            stream_id,
            ptid,
            "reconciling",
            json!({
                "type": "reconciling",
                "turnId": replay_turn_id,
                "conversationId": replay_conversation_id,
                "seq": last_sequence
            }),
        );
        emit_turn_stream_event_to(
            app,
            window_label,
            stream_id,
            ptid,
            "connected",
            json!({
                "type": "connected",
                "turnId": replay_turn_id,
                "conversationId": replay_conversation_id,
                "seq": last_sequence
            }),
        );
        emit_turn_stream_event_to(app, window_label, stream_id, ptid, &event, data);
        return true;
    }
    if event == "catchup_done" && !*live_tail_established {
        *live_tail_established = true;
        emit_turn_stream_event_to(
            app,
            window_label,
            stream_id,
            ptid,
            "reconciling",
            json!({
                "type": "reconciling",
                "turnId": replay_turn_id,
                "conversationId": replay_conversation_id,
                "seq": last_sequence
            }),
        );
        emit_turn_stream_event_to(app, window_label, stream_id, ptid, &event, data);
        emit_turn_stream_event_to(
            app,
            window_label,
            stream_id,
            ptid,
            "connected",
            json!({
                "type": "connected",
                "turnId": replay_turn_id,
                "conversationId": replay_conversation_id,
                "seq": last_sequence
            }),
        );
        return false;
    }
    let closes_stream = replay_event_closes_stream(&event, &data, *live_tail_established);
    emit_turn_stream_event_to(app, window_label, stream_id, ptid, &event, data);
    closes_stream
}

async fn replay_station_turn_events(
    app: &AppHandle,
    window_label: &str,
    stream_id: &str,
    token: &str,
    ptid: &str,
    conversation_id: &str,
    turn_id: &str,
    attempt_id: &str,
    after_sequence: i64,
    cancellation: &mut watch::Receiver<bool>,
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
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("failed to create Station replay client: {error}"))?;
    let response = match next_stream_item_or_cancel(
        tokio::time::timeout(
            AGENT_STREAM_ADMISSION_TIMEOUT,
            client
                .post(url)
                .header(CONTENT_TYPE, "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
                .header("Accept", "text/event-stream")
                .json(&build_replay_request_body(
                    conversation_id,
                    turn_id,
                    attempt_id,
                    after_sequence,
                ))
                .send(),
        ),
        cancellation,
    )
    .await
    {
        CancellableStreamItem::Cancelled => return Ok(ReplayOutcome::Cancelled),
        CancellableStreamItem::Item(result) => result
            .map_err(|_| "Station turn replay admission timed out".to_string())?
            .map_err(|error| format!("Station turn replay request failed: {error}"))?,
    };
    if !response.status().is_success() {
        return Err(format!(
            "Station turn replay returned HTTP {}",
            response.status()
        ));
    }
    // #region debug-point D:station-replay-response
    report_native_replay_debug(
        "D",
        "agent_turn::replay_station_turn_events",
        "Station replay response accepted",
        json!({ "status": response.status().as_u16() }),
    );
    // #endregion
    let mut body = response.bytes_stream();
    let mut buffer = Vec::new();
    let mut last_sequence = after_sequence;
    let mut live_tail_established = false;
    let catchup_deadline = tokio::time::Instant::now() + AGENT_STREAM_ADMISSION_TIMEOUT;
    let mut replay_turn_id = turn_id.to_string();
    let mut replay_conversation_id = conversation_id.to_string();
    loop {
        let chunk = if live_tail_established {
            next_stream_item_or_cancel(body.next(), cancellation).await
        } else {
            tokio::select! {
                chunk = next_stream_item_or_cancel(body.next(), cancellation) => chunk,
                _ = tokio::time::sleep_until(catchup_deadline) => {
                    return Err("Station turn replay catchup timed out".to_string());
                }
            }
        };
        let chunk = match chunk {
            CancellableStreamItem::Cancelled => return Ok(ReplayOutcome::Cancelled),
            CancellableStreamItem::Item(chunk) => chunk,
        };
        let Some(chunk) = chunk else {
            break;
        };
        let chunk =
            chunk.map_err(|error| format!("failed to read Station turn replay: {error}"))?;
        buffer.extend_from_slice(&chunk);
        while let Some((event, data)) = take_sse_frame(&mut buffer)? {
            if emit_replay_event(
                app,
                window_label,
                stream_id,
                ptid,
                event,
                data,
                &mut replay_turn_id,
                &mut replay_conversation_id,
                &mut last_sequence,
                &mut live_tail_established,
            ) {
                return Ok(ReplayOutcome::Terminal);
            }
        }
    }
    if !buffer.is_empty() {
        let frame = String::from_utf8(buffer)
            .map_err(|error| format!("Station turn replay returned invalid UTF-8: {error}"))?;
        if let Some((event, data)) = parse_sse_frame(&frame) {
            if emit_replay_event(
                app,
                window_label,
                stream_id,
                ptid,
                event,
                data,
                &mut replay_turn_id,
                &mut replay_conversation_id,
                &mut last_sequence,
                &mut live_tail_established,
            ) {
                return Ok(ReplayOutcome::Terminal);
            }
        }
    }
    let state = if live_tail_established {
        "after live tail establishment"
    } else {
        "before catchup_done"
    };
    Err(format!("Station turn replay closed {state}"))
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

fn emit_resolved_error_to(
    app: &AppHandle,
    window_label: &str,
    stream_id: &str,
    ptid: &str,
    provider_id: &str,
    raw_error: &str,
) {
    let wrapped =
        error_resolver::wrap_stream_error(provider_id, ProviderKind::Direct, raw_error, None);
    emit_turn_stream_event_to(app, window_label, stream_id, ptid, "error", wrapped);
}

fn station_stream_error_payload(provider_id: &str, data: Value) -> Value {
    let has_error_type = |payload: &Value| {
        payload
            .get("error_type")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    };
    let typed = has_error_type(&data) || data.get("outcome_error").is_some_and(has_error_type);
    if typed {
        return data;
    }
    let raw = data
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("Unknown error");
    error_resolver::wrap_stream_error(provider_id, ProviderKind::Direct, raw, None)
}

fn emit_turn_stream_event_to(
    app: &AppHandle,
    window_label: &str,
    stream_id: &str,
    ptid: &str,
    event: &str,
    data: Value,
) {
    let emit_result = app.emit_to(
        window_label,
        AGENT_TURN_STREAM_EVENT,
        AgentTurnStreamEventPayload {
            stream_id: stream_id.to_string(),
            ptid: ptid.to_string(),
            event: event.to_string(),
            data,
        },
    );
    // #region debug-point B:event-emission
    if matches!(
        event,
        "reconnecting" | "replaying" | "reconciling" | "connected" | "snapshot" | "catchup_done"
    ) {
        report_native_replay_debug(
            "B",
            "agent_turn::emit_turn_stream_event_to",
            "Native replay event emitted",
            json!({
                "eventType": event,
                "windowLabel": window_label,
                "emitOk": emit_result.is_ok(),
            }),
        );
    }
    // #endregion
    if let Err(error) = emit_result {
        tracing::warn!(
            error = %error,
            window_label,
            "Failed to emit Agent replay stream event"
        );
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RevisionCommand {
    RetryTurn,
    RegenerateTurn,
    EditAndResend,
    SelectActiveBranch,
    TombstoneMessage,
}

impl RevisionCommand {
    fn route(
        self,
    ) -> (
        &'static str,
        &'static str,
        station_client::StationTransportPolicy,
    ) {
        use station_client::StationTransportPolicy::{Interactive, TurnExecution};

        match self {
            Self::RetryTurn => (
                "agent_retry_turn",
                "/sub-agent/agent/turn/retry",
                TurnExecution,
            ),
            Self::RegenerateTurn => (
                "agent_regenerate_turn",
                "/sub-agent/agent/turn/regenerate",
                TurnExecution,
            ),
            Self::EditAndResend => (
                "agent_edit_and_resend",
                "/sub-agent/agent/message/edit-resend",
                TurnExecution,
            ),
            Self::SelectActiveBranch => (
                "agent_select_active_branch",
                "/sub-agent/agent/conversation/select-branch",
                Interactive,
            ),
            Self::TombstoneMessage => (
                "agent_tombstone_message",
                "/sub-agent/agent/message/tombstone",
                Interactive,
            ),
        }
    }
}

fn revision_command<Input: Serialize>(
    revision: RevisionCommand,
    input: Input,
    token: &str,
) -> AppResult<StubPayload> {
    let (command, path, transport_policy) = revision.route();
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
    match station_client::request_json_with_policy(
        Method::POST,
        path,
        token,
        None,
        Some(body),
        transport_policy,
    ) {
        Ok(result) => success_payload(command, result),
        Err(error) => error.into_app_result(format!("{command} failed")),
    }
}

pub fn agent_retry_turn(input: AgentRetryTurnInput, token: &str) -> AppResult<StubPayload> {
    revision_command(RevisionCommand::RetryTurn, input, token)
}

pub fn agent_regenerate_turn(
    input: AgentRegenerateTurnInput,
    token: &str,
) -> AppResult<StubPayload> {
    revision_command(RevisionCommand::RegenerateTurn, input, token)
}

pub fn agent_edit_and_resend(
    input: AgentEditAndResendInput,
    token: &str,
) -> AppResult<StubPayload> {
    revision_command(RevisionCommand::EditAndResend, input, token)
}

pub fn agent_select_active_branch(
    input: AgentSelectActiveBranchInput,
    token: &str,
) -> AppResult<StubPayload> {
    revision_command(RevisionCommand::SelectActiveBranch, input, token)
}

pub fn agent_tombstone_message(
    input: AgentTombstoneMessageInput,
    token: &str,
) -> AppResult<StubPayload> {
    revision_command(RevisionCommand::TombstoneMessage, input, token)
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
    fn revision_commands_route_by_execution_semantics() {
        use station_client::StationTransportPolicy::{Interactive, TurnExecution};

        for (revision, expected) in [
            (
                RevisionCommand::RetryTurn,
                (
                    "agent_retry_turn",
                    "/sub-agent/agent/turn/retry",
                    TurnExecution,
                ),
            ),
            (
                RevisionCommand::RegenerateTurn,
                (
                    "agent_regenerate_turn",
                    "/sub-agent/agent/turn/regenerate",
                    TurnExecution,
                ),
            ),
            (
                RevisionCommand::EditAndResend,
                (
                    "agent_edit_and_resend",
                    "/sub-agent/agent/message/edit-resend",
                    TurnExecution,
                ),
            ),
            (
                RevisionCommand::SelectActiveBranch,
                (
                    "agent_select_active_branch",
                    "/sub-agent/agent/conversation/select-branch",
                    Interactive,
                ),
            ),
            (
                RevisionCommand::TombstoneMessage,
                (
                    "agent_tombstone_message",
                    "/sub-agent/agent/message/tombstone",
                    Interactive,
                ),
            ),
        ] {
            assert_eq!(revision.route(), expected);
        }
    }

    #[test]
    fn tool_decision_hash_matches_station_canonical_contract() {
        assert_eq!(
            tool_decision_payload_hash("approval-1", "tool-call-1", "decision-1", 0, true,),
            "4d8f48896d7fc4b24b44328c4d59f2938a5cb5a0db8fcea7f5afcdfdbfbca9ef",
        );
    }

    #[test]
    fn tool_decision_outcome_preserves_typed_denial_contract() {
        let outcome = agent::ErrorPayload {
            error: "agent.errors.toolApprovalDenied".to_string(),
            error_type: "TOOL_APPROVAL_DENIED".to_string(),
            locale_key: "agent.errors.toolApprovalDenied".to_string(),
            retryable: false,
            terminal: true,
            details: HashMap::from([
                ("tool_call_id".to_string(), "tool-call-1".to_string()),
                ("decision_id".to_string(), "decision-1".to_string()),
            ]),
        };

        assert_eq!(
            tool_decision_outcome_json(Some(&outcome)),
            Some(json!({
                "error": "agent.errors.toolApprovalDenied",
                "error_type": "TOOL_APPROVAL_DENIED",
                "locale_key": "agent.errors.toolApprovalDenied",
                "retryable": false,
                "terminal": true,
                "details": {
                    "tool_call_id": "tool-call-1",
                    "decision_id": "decision-1",
                },
            })),
        );
    }

    #[test]
    fn station_stream_error_preserves_typed_attachment_contract() {
        let payload = json!({
            "type": "error",
            "error": "agent.errors.attachmentRejected",
            "error_type": "CONTEXT_ATTACHMENT_REJECTED",
            "locale_key": "agent.errors.attachmentRejected",
            "retryable": false,
            "terminal": true,
            "details": {
                "attachment_id": "attachment-1",
                "reason_code": "attachment_content_does_not_match_mime",
            },
        });

        assert_eq!(
            station_stream_error_payload("bytedance-ark", payload.clone()),
            payload,
        );
    }

    #[test]
    fn station_stream_error_preserves_nested_typed_outcome_contract() {
        let payload = json!({
            "type": "error",
            "error": "CLIENT_INVALID_RESOURCE_REFERENCE",
            "outcome_error": {
                "error": "agent.errors.invalidResourceReference",
                "error_type": "CLIENT_INVALID_RESOURCE_REFERENCE",
                "locale_key": "agent.errors.invalidResourceReference",
                "retryable": false,
                "terminal": true,
                "details": {
                    "resource_kind": "file",
                    "resource_ref_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                },
            },
        });

        assert_eq!(
            station_stream_error_payload("bytedance-ark", payload.clone()),
            payload,
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
    fn live_stream_identity_binds_header_turn_to_forwarded_payload() {
        let payload = bind_turn_stream_identity(
            json!({ "type": "done", "model": "model-1" }),
            "turn-1",
            "conversation-1",
        );

        assert_eq!(
            payload.get("turnId").and_then(Value::as_str),
            Some("turn-1")
        );
        assert_eq!(
            payload.get("conversationId").and_then(Value::as_str),
            Some("conversation-1"),
        );
    }

    #[test]
    fn live_stream_identity_preserves_station_payload_identity() {
        let payload = bind_turn_stream_identity(
            json!({
                "turn_id": "turn-station",
                "conversationId": "conversation-station",
            }),
            "turn-header",
            "conversation-request",
        );

        assert_eq!(
            payload.get("turn_id").and_then(Value::as_str),
            Some("turn-station"),
        );
        assert_eq!(
            payload.get("conversationId").and_then(Value::as_str),
            Some("conversation-station"),
        );
        assert!(payload.get("turnId").is_none());
        assert!(payload.get("conversation_id").is_none());
    }

    #[test]
    fn replay_backoff_is_bounded() {
        assert_eq!(AGENT_REPLAY_BACKOFF_MS, [500, 1_000, 2_000, 4_000, 8_000]);
        assert_eq!(AGENT_REPLAY_BACKOFF_MS.iter().sum::<u64>(), 15_500);
        assert_eq!(AGENT_REPLAY_BACKOFF_MS.len() + 1, 6);
    }

    #[test]
    fn stream_payload_carries_the_authenticated_ptid() {
        let payload = AgentTurnStreamEventPayload {
            stream_id: "stream-1".to_string(),
            ptid: "ptid:person:alice".to_string(),
            event: "snapshot".to_string(),
            data: json!({"status": "completed"}),
        };

        assert_eq!(
            serde_json::to_value(payload).unwrap()["ptid"],
            "ptid:person:alice"
        );
    }

    #[test]
    fn replay_request_uses_the_canonical_protojson_cursor_name() {
        assert_eq!(
            build_replay_request_body("conversation-1", "turn-1", "", 4),
            json!({
                "conversation_id": "conversation-1",
                "turn_id": "turn-1",
                "afterSequence": 4,
            }),
        );
    }

    #[test]
    fn replay_request_can_select_a_retained_source_attempt() {
        assert_eq!(
            build_replay_request_body("conversation-1", "turn-1", "attempt-1", 0),
            json!({
                "conversation_id": "conversation-1",
                "turn_id": "turn-1",
                "attempt_id": "attempt-1",
                "afterSequence": 0,
            }),
        );
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
    fn replay_terminal_rows_close_only_after_catchup() {
        let terminal = json!({"seq": 9, "error": "station_restart_interrupted"});
        assert!(!replay_event_closes_stream("error", &terminal, false));
        assert!(replay_event_closes_stream("error", &terminal, true));
        assert!(replay_event_closes_stream(
            "snapshot",
            &json!({"status": "interrupted", "seq": 9}),
            false,
        ));
    }

    #[test]
    fn replay_stream_registration_replaces_and_cancels_the_previous_generation() {
        let first = register_agent_turn_replay_stream("main", "ptid:person:one", "stream-1");
        let second = register_agent_turn_replay_stream("main", "ptid:person:one", "stream-1");

        assert!(*first.receiver.borrow());
        assert!(!*second.receiver.borrow());
        cancel_agent_turn_replay_stream("main", "stream-1");
        assert!(*second.receiver.borrow());
    }

    #[test]
    fn replay_stream_registration_isolated_by_window_and_actor() {
        let first = register_agent_turn_replay_stream("main", "ptid:person:one", "shared");
        let second = register_agent_turn_replay_stream("secondary", "ptid:person:two", "shared");

        cancel_agent_turn_replay_stream("main", "shared");

        assert!(*first.receiver.borrow());
        assert!(!*second.receiver.borrow());
        cancel_agent_turn_replay_stream("secondary", "shared");
    }

    #[test]
    fn replay_stream_actor_switch_replaces_the_same_window_stream() {
        let first = register_agent_turn_replay_stream("main", "ptid:person:one", "switched");
        let second = register_agent_turn_replay_stream("main", "ptid:person:two", "switched");

        assert!(*first.receiver.borrow());
        assert!(!*second.receiver.borrow());
        cancel_agent_turn_replay_stream("main", "switched");
        assert!(*second.receiver.borrow());
    }

    #[test]
    fn live_stream_registration_can_be_cancelled_before_turn_identity_arrives() {
        let mut cancellation =
            register_agent_turn_live_stream("main", "ptid:person:one", "live-stream-1");

        cancel_agent_turn_live_stream("main", "live-stream-1");

        assert_eq!(
            *cancellation.receiver.borrow_and_update(),
            LiveStreamControl::CancelTurn
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn live_stream_cancellation_unblocks_a_pending_sse_read() {
        let mut cancellation =
            register_agent_turn_live_stream("main", "ptid:person:one", "live-stream-pending");
        cancel_agent_turn_live_stream("main", "live-stream-pending");

        let read = tokio::time::timeout(
            Duration::from_millis(50),
            next_live_stream_item_or_control(
                std::future::pending::<Option<Result<Vec<u8>, String>>>(),
                &mut cancellation.receiver,
            ),
        )
        .await
        .expect("cancellation should unblock the pending stream read");

        assert!(matches!(
            read,
            LiveStreamItem::Control(LiveStreamControl::CancelTurn)
        ));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn live_stream_disconnect_unblocks_read_without_requesting_turn_cancel() {
        let mut cancellation =
            register_agent_turn_live_stream("main", "ptid:person:one", "live-stream-disconnect");
        disconnect_agent_turn_live_stream("main", "live-stream-disconnect");

        let read = tokio::time::timeout(
            Duration::from_millis(50),
            next_live_stream_item_or_control(
                std::future::pending::<Option<Result<Vec<u8>, String>>>(),
                &mut cancellation.receiver,
            ),
        )
        .await
        .expect("transport disconnect should unblock the pending stream read");

        assert!(matches!(
            read,
            LiveStreamItem::Control(LiveStreamControl::DisconnectTransport)
        ));
    }

    #[test]
    fn live_stream_disconnect_discards_buffered_tail() {
        let buffered_terminal = b"event: done\ndata: {\"seq\":4}\n\n";

        assert!(!should_flush_live_stream_tail(true, buffered_terminal));
        assert!(should_flush_live_stream_tail(false, buffered_terminal));
        assert!(!should_flush_live_stream_tail(false, &[]));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn live_stream_cancellation_waits_for_admission_identity_before_semantic_cancel() {
        let mut cancellation =
            register_agent_turn_live_stream("main", "ptid:person:one", "live-stream-admission");
        let (admission_sender, admission_receiver) =
            tokio::sync::oneshot::channel::<&'static str>();
        let admission = await_stream_admission(
            async move {
                admission_receiver
                    .await
                    .expect("admission identity source must remain alive")
            },
            &mut cancellation.receiver,
            Duration::from_secs(1),
        );
        tokio::pin!(admission);

        assert!(
            tokio::time::timeout(Duration::from_millis(10), &mut admission)
                .await
                .is_err(),
            "admission should still be pending before cancellation"
        );
        cancel_agent_turn_live_stream("main", "live-stream-admission");
        assert!(
            tokio::time::timeout(Duration::from_millis(10), &mut admission)
                .await
                .is_err(),
            "cancellation must not drop the only future carrying X-Agent-Turn-ID"
        );

        admission_sender
            .send("turn-admitted")
            .expect("admission receiver must remain attached");
        let (turn_id, control) = admission.await.expect("admission identity should arrive");

        assert_eq!(turn_id, "turn-admitted");
        assert_eq!(control, LiveStreamControl::CancelTurn);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn live_stream_admission_is_bounded_when_identity_never_arrives() {
        let mut cancellation =
            register_agent_turn_live_stream("main", "ptid:person:one", "live-stream-timeout");

        let result = await_stream_admission(
            std::future::pending::<()>(),
            &mut cancellation.receiver,
            Duration::from_millis(10),
        )
        .await;

        assert_eq!(
            result.expect_err("pending admission must time out"),
            "agent.error.streamAdmissionTimeout",
        );
        cancel_agent_turn_live_stream("main", "live-stream-timeout");
    }

    #[test]
    fn live_stream_cancellation_preserves_window_and_actor_ownership() {
        let mut first = register_agent_turn_live_stream("main", "ptid:person:one", "shared-live");
        let mut second =
            register_agent_turn_live_stream("secondary", "ptid:person:two", "shared-live");

        cancel_agent_turn_live_stream("main", "shared-live");

        assert_eq!(
            *first.receiver.borrow_and_update(),
            LiveStreamControl::CancelTurn
        );
        assert_eq!(*second.receiver.borrow(), LiveStreamControl::Active);
        cancel_agent_turn_live_stream("secondary", "shared-live");
        assert_eq!(
            *second.receiver.borrow_and_update(),
            LiveStreamControl::CancelTurn
        );
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
    fn turn_request_preserves_requested_runtime_budget() {
        let input: AgentExecuteTurnInput = serde_json::from_value(json!({
            "client_idempotency_key": "request-1",
            "conversation_id": "conversation-1",
            "agent_id": "agent-1",
            "user_input": "exercise the bounded tool loop",
            "requested_budget": {
                "max_tool_calls": 2
            }
        }))
        .expect("turn input should deserialize");

        let body = build_turn_request_body(input, true);

        assert_eq!(body["requested_budget"], json!({"max_tool_calls": 2}));
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
