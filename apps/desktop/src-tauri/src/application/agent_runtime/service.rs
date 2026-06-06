use crate::application::{chat, memory};
use crate::contracts::{AgentExecuteTurnInput, StubPayload};
use crate::error::AppResult;
use serde_json::json;
use std::time::Instant;

use super::{context, invalid_argument, prompt, provider, success_payload, trace};

fn provider_call_input<'a>(
    resolved_provider: &'a provider::ResolvedProvider,
    model: &'a str,
    latency_ms: u64,
    success: bool,
    error: Option<&crate::error::AppResult<StubPayload>>,
) -> trace::ProviderCallInput<'a> {
    let (error_code, error_message) = error
        .and_then(|result| result.error.as_ref())
        .map(|err| (Some(format!("{:?}", err.code)), Some(err.message.clone())))
        .unwrap_or((None, None));

    trace::ProviderCallInput {
        provider_id: &resolved_provider.provider_id,
        model,
        provider_kind: resolved_provider.kind.as_trace_label(),
        protocol: resolved_provider.protocol,
        latency_ms,
        success,
        stream: resolved_provider.capability.stream,
        cancel: resolved_provider.capability.cancel,
        tool_call: resolved_provider.capability.tool_call,
        black_box: resolved_provider.capability.black_box,
        error_code,
        error_message,
    }
}

fn record_failed_provider_trace(
    conversation_id: &str,
    agent_id: &str,
    resolved_provider: &provider::ResolvedProvider,
    assembled_prompt: &str,
    turn_context: &context::TurnContext,
    tool_count: usize,
    latency_ms: u64,
    provider_error: &AppResult<StubPayload>,
) {
    if let Err(trace_error) = trace::record(trace::TraceInput {
        conversation_id,
        agent_id,
        provider_id: &resolved_provider.provider_id,
        model: &resolved_provider.model_id,
        status: "failed",
        prompt: assembled_prompt,
        memory_count: turn_context.memories.len(),
        skill_count: turn_context.skills.len(),
        tool_count,
        provider_calls: vec![provider_call_input(
            resolved_provider,
            &resolved_provider.model_id,
            latency_ms,
            false,
            Some(provider_error),
        )],
    }) {
        tracing::error!(
            command = "agent_execute_turn",
            error = ?trace_error.error,
            "Failed to record failed provider trace"
        );
    }
}

pub(crate) fn execute_turn(actor_id: &str, input: AgentExecuteTurnInput) -> AppResult<StubPayload> {
    let conversation_id = input.conversation_id.trim().to_string();
    let agent_identifier = input.agent_id.trim().to_string();
    let user_input = input.user_input.trim().to_string();
    if conversation_id.is_empty() {
        return invalid_argument("conversation_id is required");
    }
    if agent_identifier.is_empty() {
        return invalid_argument("agent_id is required");
    }
    if user_input.is_empty() {
        return invalid_argument("user_input is required");
    }

    let turn_context = context::build_turn_context(actor_id, &agent_identifier, &user_input);
    let assembled_prompt = prompt::assemble_prompt(&turn_context, &user_input);
    let resolved_provider =
        match provider::resolve_provider(input.provider.as_deref(), input.model.as_deref()) {
            Ok(value) => value,
            Err(err) => return err,
        };

    tracing::info!(
        command = "agent_execute_turn",
        conversation_id = %conversation_id,
        agent_id = %turn_context.effective_agent_id,
        provider_id = %resolved_provider.provider_id,
        model = %resolved_provider.model_id,
        protocol = %resolved_provider.protocol,
        provider_kind = ?resolved_provider.kind,
        provider_black_box = resolved_provider.capability.black_box,
        provider_timeout_ms = ?resolved_provider.control.timeout_ms,
        provider_cwd = ?resolved_provider.control.cwd,
        "Executing agent turn"
    );

    let tool_count = turn_context.tools.len() + turn_context.mcp.len();
    let provider_started_at = Instant::now();
    let completion = match provider::complete(&resolved_provider, &assembled_prompt) {
        Ok(value) => value,
        Err(err) => {
            record_failed_provider_trace(
                &conversation_id,
                &turn_context.effective_agent_id,
                &resolved_provider,
                &assembled_prompt,
                &turn_context,
                tool_count,
                provider_started_at.elapsed().as_millis() as u64,
                &err,
            );
            return err;
        }
    };
    let provider_latency_ms = provider_started_at.elapsed().as_millis() as u64;

    let recorded_trace = match trace::record(trace::TraceInput {
        conversation_id: &conversation_id,
        agent_id: &turn_context.effective_agent_id,
        provider_id: &resolved_provider.provider_id,
        model: &completion.model,
        status: "completed",
        prompt: &assembled_prompt,
        memory_count: turn_context.memories.len(),
        skill_count: turn_context.skills.len(),
        tool_count,
        provider_calls: vec![provider_call_input(
            &resolved_provider,
            &completion.model,
            provider_latency_ms,
            true,
            None,
        )],
    }) {
        Ok(value) => value,
        Err(err) => return err,
    };
    let recorded_turn = chat::record_agent_turn(
        actor_id,
        &conversation_id,
        &turn_context.agent_display_id,
        &user_input,
        &completion.text,
        Some(completion.model.clone()),
    );
    let (user_message_id, assistant_message_id) = match recorded_turn.data {
        Some(ids) if recorded_turn.ok => ids,
        _ => {
            return AppResult {
                ok: false,
                data: None,
                error: recorded_turn.error,
            };
        }
    };

    memory::local_remember_turn(
        &turn_context.effective_agent_id,
        &conversation_id,
        &recorded_trace.id,
        &user_input,
        &completion.text,
    );

    success_payload(
        "agent_execute_turn",
        json!({
            "text": completion.text,
            "model": completion.model,
            "provider_id": resolved_provider.provider_id,
            "agent_id": turn_context.effective_agent_id,
            "conversation_id": conversation_id,
            "user_message_id": user_message_id,
            "assistant_message_id": assistant_message_id,
            "trace": {
                "id": recorded_trace.id,
                "prompt_hash": recorded_trace.prompt_hash,
                "memory_count": turn_context.memories.len(),
                "skill_count": turn_context.skills.len(),
                "tool_count": tool_count,
                "provider_calls": [{
                    "provider_id": resolved_provider.provider_id,
                    "model": completion.model,
                    "provider_kind": resolved_provider.kind.as_trace_label(),
                    "protocol": resolved_provider.protocol,
                    "latency_ms": provider_latency_ms,
                    "success": true,
                    "capability": {
                        "stream": resolved_provider.capability.stream,
                        "cancel": resolved_provider.capability.cancel,
                        "tool_call": resolved_provider.capability.tool_call,
                        "black_box": resolved_provider.capability.black_box,
                    },
                    "error_code": null,
                    "error_message": null,
                }],
            },
            "assets": {
                "memories": turn_context.memories,
                "skills": turn_context.skills,
                "tools": turn_context.tools,
                "mcp": turn_context.mcp,
            }
        }),
    )
}

pub(crate) fn list_traces() -> AppResult<StubPayload> {
    trace::list()
}
