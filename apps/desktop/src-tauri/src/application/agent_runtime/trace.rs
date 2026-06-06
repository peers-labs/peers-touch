use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use serde_json::json;
use std::sync::{Mutex, OnceLock};

use super::{now_iso, stable_hash, success_payload};

#[derive(Clone)]
struct TurnTraceRecord {
    id: String,
    conversation_id: String,
    agent_id: String,
    provider_id: String,
    model: String,
    status: String,
    prompt_hash: String,
    memory_count: usize,
    skill_count: usize,
    tool_count: usize,
    provider_calls: Vec<ProviderCallRecord>,
    created_at: String,
}

#[derive(Clone)]
struct ProviderCallRecord {
    provider_id: String,
    model: String,
    provider_kind: String,
    protocol: String,
    latency_ms: u64,
    success: bool,
    stream: bool,
    cancel: bool,
    tool_call: bool,
    black_box: bool,
    error_code: Option<String>,
    error_message: Option<String>,
}

#[derive(Default)]
struct TurnTraceStore {
    sequence: u64,
    traces: Vec<TurnTraceRecord>,
}

pub(crate) struct ProviderCallInput<'a> {
    pub(crate) provider_id: &'a str,
    pub(crate) model: &'a str,
    pub(crate) provider_kind: &'a str,
    pub(crate) protocol: &'a str,
    pub(crate) latency_ms: u64,
    pub(crate) success: bool,
    pub(crate) stream: bool,
    pub(crate) cancel: bool,
    pub(crate) tool_call: bool,
    pub(crate) black_box: bool,
    pub(crate) error_code: Option<String>,
    pub(crate) error_message: Option<String>,
}

pub(crate) struct TraceInput<'a> {
    pub(crate) conversation_id: &'a str,
    pub(crate) agent_id: &'a str,
    pub(crate) provider_id: &'a str,
    pub(crate) model: &'a str,
    pub(crate) status: &'a str,
    pub(crate) prompt: &'a str,
    pub(crate) memory_count: usize,
    pub(crate) skill_count: usize,
    pub(crate) tool_count: usize,
    pub(crate) provider_calls: Vec<ProviderCallInput<'a>>,
}

pub(crate) struct RecordedTrace {
    pub(crate) id: String,
    pub(crate) prompt_hash: String,
}

static TURN_TRACE_STORE: OnceLock<Mutex<TurnTraceStore>> = OnceLock::new();

fn turn_trace_store() -> &'static Mutex<TurnTraceStore> {
    TURN_TRACE_STORE.get_or_init(|| Mutex::new(TurnTraceStore::default()))
}

pub(crate) fn record(input: TraceInput<'_>) -> Result<RecordedTrace, AppResult<StubPayload>> {
    let mut guard = match turn_trace_store().lock() {
        Ok(guard) => guard,
        Err(e) => {
            tracing::error!(error = %e, "Failed to write turn trace");
            return Err(AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to write turn trace: {}", e),
                None,
            ));
        }
    };
    guard.sequence = guard.sequence.saturating_add(1);
    let trace_id = format!("turn-{}", guard.sequence);
    let prompt_hash = stable_hash(input.prompt);
    guard.traces.push(TurnTraceRecord {
        id: trace_id.clone(),
        conversation_id: input.conversation_id.to_string(),
        agent_id: input.agent_id.to_string(),
        provider_id: input.provider_id.to_string(),
        model: input.model.to_string(),
        status: input.status.to_string(),
        prompt_hash: prompt_hash.clone(),
        memory_count: input.memory_count,
        skill_count: input.skill_count,
        tool_count: input.tool_count,
        provider_calls: input
            .provider_calls
            .into_iter()
            .map(|call| ProviderCallRecord {
                provider_id: call.provider_id.to_string(),
                model: call.model.to_string(),
                provider_kind: call.provider_kind.to_string(),
                protocol: call.protocol.to_string(),
                latency_ms: call.latency_ms,
                success: call.success,
                stream: call.stream,
                cancel: call.cancel,
                tool_call: call.tool_call,
                black_box: call.black_box,
                error_code: call.error_code,
                error_message: call.error_message,
            })
            .collect(),
        created_at: now_iso(),
    });
    Ok(RecordedTrace {
        id: trace_id,
        prompt_hash,
    })
}

pub(crate) fn list() -> AppResult<StubPayload> {
    let guard = match turn_trace_store().lock() {
        Ok(guard) => guard,
        Err(e) => {
            tracing::error!(error = %e, "Failed to read turn traces");
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to read turn traces: {}", e),
                None,
            );
        }
    };
    let traces = guard
        .traces
        .iter()
        .rev()
        .map(|trace| {
            json!({
                "id": trace.id,
                "conversation_id": trace.conversation_id,
                "agent_id": trace.agent_id,
                "provider_id": trace.provider_id,
                "model": trace.model,
                "status": trace.status,
                "prompt_hash": trace.prompt_hash,
                "memory_count": trace.memory_count,
                "skill_count": trace.skill_count,
                "tool_count": trace.tool_count,
                "provider_calls": trace.provider_calls.iter().map(|call| {
                    json!({
                        "provider_id": call.provider_id,
                        "model": call.model,
                        "provider_kind": call.provider_kind,
                        "protocol": call.protocol,
                        "latency_ms": call.latency_ms,
                        "success": call.success,
                        "capability": {
                            "stream": call.stream,
                            "cancel": call.cancel,
                            "tool_call": call.tool_call,
                            "black_box": call.black_box,
                        },
                        "error_code": call.error_code,
                        "error_message": call.error_message,
                    })
                }).collect::<Vec<_>>(),
                "created_at": trace.created_at,
            })
        })
        .collect::<Vec<_>>();
    success_payload("agent_turn_traces", json!({ "traces": traces }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_should_increment_trace_ids_and_keep_prompt_hash_stable() {
        let first = record(TraceInput {
            conversation_id: "conversation-1",
            agent_id: "agent-1",
            provider_id: "provider-1",
            model: "model-1",
            status: "completed",
            prompt: "same prompt",
            memory_count: 1,
            skill_count: 2,
            tool_count: 3,
            provider_calls: vec![ProviderCallInput {
                provider_id: "provider-1",
                model: "model-1",
                provider_kind: "HttpLlm",
                protocol: "openai-compatible",
                latency_ms: 12,
                success: true,
                stream: false,
                cancel: false,
                tool_call: false,
                black_box: false,
                error_code: None,
                error_message: None,
            }],
        })
        .expect("first trace should record");
        let second = record(TraceInput {
            conversation_id: "conversation-1",
            agent_id: "agent-1",
            provider_id: "provider-1",
            model: "model-1",
            status: "completed",
            prompt: "same prompt",
            memory_count: 1,
            skill_count: 2,
            tool_count: 3,
            provider_calls: vec![],
        })
        .expect("second trace should record");

        assert_ne!(first.id, second.id);
        assert_eq!(first.prompt_hash, second.prompt_hash);
    }

    #[test]
    fn list_should_return_recent_traces_first() {
        let recorded = record(TraceInput {
            conversation_id: "conversation-list",
            agent_id: "agent-list",
            provider_id: "provider-list",
            model: "model-list",
            status: "failed",
            prompt: "listed prompt",
            memory_count: 4,
            skill_count: 5,
            tool_count: 6,
            provider_calls: vec![ProviderCallInput {
                provider_id: "provider-list",
                model: "model-list",
                provider_kind: "CliWrapped",
                protocol: "cli-wrapped",
                latency_ms: 25,
                success: false,
                stream: false,
                cancel: false,
                tool_call: false,
                black_box: true,
                error_code: Some("InternalError".to_string()),
                error_message: Some("provider failed".to_string()),
            }],
        })
        .expect("trace should record");

        let payload = list();
        assert!(payload.ok);
        let data = payload.data.expect("payload");
        let status: serde_json::Value = serde_json::from_str(&data.status).expect("json status");
        let traces = status
            .get("traces")
            .and_then(serde_json::Value::as_array)
            .expect("traces");
        let first = traces.first().expect("at least one trace");

        assert_eq!(first["id"], recorded.id);
        assert_eq!(first["memory_count"], 4);
        assert_eq!(first["skill_count"], 5);
        assert_eq!(first["tool_count"], 6);
        assert_eq!(first["status"], "failed");
        assert_eq!(first["provider_calls"][0]["provider_kind"], "CliWrapped");
        assert_eq!(first["provider_calls"][0]["capability"]["black_box"], true);
        assert_eq!(first["provider_calls"][0]["error_code"], "InternalError");
    }
}
