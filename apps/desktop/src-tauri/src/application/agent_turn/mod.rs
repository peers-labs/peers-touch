use crate::application::{
    agents, chat, mcp, memory,
    provider::{remote as provider_remote, state as provider_state},
    skills, tools,
};
use crate::contracts::{AgentExecuteTurnInput, StubPayload};
use crate::error::{AppResult, ErrorCode};
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};

#[derive(Clone)]
struct TurnTraceRecord {
    id: String,
    conversation_id: String,
    agent_id: String,
    provider_id: String,
    model: String,
    prompt_hash: String,
    memory_count: usize,
    skill_count: usize,
    tool_count: usize,
    created_at: String,
}

#[derive(Default)]
struct TurnTraceStore {
    sequence: u64,
    traces: Vec<TurnTraceRecord>,
}

static TURN_TRACE_STORE: OnceLock<Mutex<TurnTraceStore>> = OnceLock::new();

fn turn_trace_store() -> &'static Mutex<TurnTraceStore> {
    TURN_TRACE_STORE.get_or_init(|| Mutex::new(TurnTraceStore::default()))
}

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn value_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn first_value_string(value: &Value, keys: &[&str]) -> String {
    keys.iter()
        .map(|key| value_string(value, key))
        .find(|item| !item.is_empty())
        .unwrap_or_default()
}

fn parse_json_object(raw: &str) -> Value {
    serde_json::from_str(raw).unwrap_or_else(|_| json!({}))
}

fn parse_api_key(raw: &str) -> String {
    parse_json_object(raw)
        .get("api_key")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn stable_hash(input: &str) -> String {
    let mut hash: u64 = 1469598103934665603;
    for byte in input.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("{hash:016x}")
}

fn agent_system_prompt(agent: &Value) -> String {
    let prompt = value_string(agent, "systemPrompt");
    if prompt.is_empty() {
        "You are a helpful Peers-Touch agent. Use available memory, skills, and tools deliberately. When a capability is unavailable, explain the limitation and continue with the best direct answer.".to_string()
    } else {
        prompt
    }
}

fn json_lines_block(title: &str, values: &[Value]) -> String {
    if values.is_empty() {
        return format!("{title}: none");
    }
    let lines = values
        .iter()
        .map(|value| format!("- {}", value))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{title}:\n{lines}")
}

fn assemble_prompt(
    agent: &Value,
    memories: &[Value],
    skill_index: &[Value],
    tool_index: &[Value],
    mcp_index: &[Value],
    user_input: &str,
) -> String {
    [
        "# System".to_string(),
        agent_system_prompt(agent),
        "# Memory Snapshot".to_string(),
        json_lines_block("Relevant memories", memories),
        "# Skills".to_string(),
        json_lines_block("Enabled skills", skill_index),
        "# Tools".to_string(),
        json_lines_block("Available tools", tool_index),
        "# MCP".to_string(),
        json_lines_block("Enabled MCP servers", mcp_index),
        "# User".to_string(),
        user_input.to_string(),
    ]
    .join("\n\n")
}

fn resolve_provider(
    provider_hint: Option<&str>,
    model_hint: Option<&str>,
) -> Result<(provider_state::ProviderRecord, String), AppResult<StubPayload>> {
    let provider_hint = provider_hint.unwrap_or("").trim();
    let model_hint = model_hint.unwrap_or("").trim();
    let provider = provider_state::with_provider_store(None, |store| {
        if !provider_hint.is_empty() {
            return store
                .providers
                .iter()
                .find(|provider| provider.id == provider_hint)
                .cloned();
        }
        if !model_hint.is_empty() {
            return store
                .providers
                .iter()
                .find(|provider| {
                    provider.enabled
                        && (provider.check_model == model_hint
                            || provider.models.iter().any(|model| model.id == model_hint))
                })
                .cloned();
        }
        store
            .providers
            .iter()
            .find(|provider| provider.enabled)
            .cloned()
    })
    .ok()
    .flatten()
    .ok_or_else(|| AppResult::fail(ErrorCode::NotFound, "Provider not found", None))?;

    if !provider.enabled {
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            "Provider is disabled",
            None,
        ));
    }
    let model = if model_hint.is_empty() {
        provider
            .models
            .iter()
            .find(|model| model.enabled)
            .map(|model| model.id.clone())
            .unwrap_or_else(|| provider.check_model.clone())
    } else {
        model_hint.to_string()
    };
    if model.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            "Model is required",
            None,
        ));
    }
    Ok((provider, model))
}

pub fn agent_execute_turn(actor_id: &str, input: AgentExecuteTurnInput) -> AppResult<StubPayload> {
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

    let agent = agents::agent_data_by_identifier(actor_id, &agent_identifier)
        .unwrap_or_else(|| json!({ "id": agent_identifier, "name": agent_identifier }));
    let agent_id = value_string(&agent, "id");
    let agent_name = value_string(&agent, "name");
    let effective_agent_id = if agent_id.is_empty() {
        agent_identifier.as_str()
    } else {
        agent_id.as_str()
    };

    let memories = memory::local_memory_snapshot(effective_agent_id, &user_input, 8);
    let skill_index = skills::enabled_skill_index();
    let tool_index = tools::tool_registry_index();
    let mcp_index = mcp::enabled_mcp_index();
    let prompt = assemble_prompt(
        &agent,
        &memories,
        &skill_index,
        &tool_index,
        &mcp_index,
        &user_input,
    );

    let (provider, model_id) =
        match resolve_provider(input.provider.as_deref(), input.model.as_deref()) {
            Ok(value) => value,
            Err(err) => return err,
        };
    let config = parse_json_object(&provider.config_json);
    let api_key = parse_api_key(&provider.key_vaults);
    let provider_protocol = value_string(&config, "protocol");
    let model_record = provider.models.iter().find(|model| model.id == model_id);
    let protocol = provider_remote::resolve_model_protocol(
        model_record.and_then(|model| model.protocol_override.as_deref()),
        Some(provider_protocol.as_str()),
    );
    let endpoint = if protocol == "cli-wrapped" {
        first_value_string(&config, &["cli_command", "command", "base_url"])
    } else {
        value_string(&config, "base_url")
    };
    if endpoint.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            if protocol == "cli-wrapped" {
                "CLI provider command is required"
            } else {
                "Provider base URL is required"
            },
            None,
        );
    }

    tracing::info!(
        command = "agent_execute_turn",
        conversation_id = %conversation_id,
        agent_id = %effective_agent_id,
        provider_id = %provider.id,
        model = %model_id,
        protocol = %protocol,
        "Executing agent turn"
    );

    let completion = match provider_remote::chat_completion(
        &endpoint,
        &api_key,
        &model_id,
        Some(protocol),
        &prompt,
    ) {
        Ok(result) => result,
        Err(err) => {
            tracing::error!(command = "agent_execute_turn", error = %err, "Provider execution failed");
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Agent provider execution failed: {}", err),
                None,
            );
        }
    };

    let recorded_turn = chat::record_agent_turn(
        actor_id,
        &conversation_id,
        if agent_name.is_empty() {
            effective_agent_id
        } else {
            agent_name.as_str()
        },
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

    let trace_id = {
        let mut guard = match turn_trace_store().lock() {
            Ok(guard) => guard,
            Err(e) => {
                tracing::error!(error = %e, "Failed to write turn trace");
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("Failed to write turn trace: {}", e),
                    None,
                );
            }
        };
        guard.sequence = guard.sequence.saturating_add(1);
        let trace_id = format!("turn-{}", guard.sequence);
        guard.traces.push(TurnTraceRecord {
            id: trace_id.clone(),
            conversation_id: conversation_id.clone(),
            agent_id: effective_agent_id.to_string(),
            provider_id: provider.id.clone(),
            model: completion.model.clone(),
            prompt_hash: stable_hash(&prompt),
            memory_count: memories.len(),
            skill_count: skill_index.len(),
            tool_count: tool_index.len() + mcp_index.len(),
            created_at: now_iso(),
        });
        trace_id
    };

    memory::local_remember_turn(
        effective_agent_id,
        &conversation_id,
        &trace_id,
        &user_input,
        &completion.text,
    );

    success_payload(
        "agent_execute_turn",
        json!({
            "text": completion.text,
            "model": completion.model,
            "provider_id": provider.id,
            "agent_id": effective_agent_id,
            "conversation_id": conversation_id,
            "user_message_id": user_message_id,
            "assistant_message_id": assistant_message_id,
            "trace": {
                "id": trace_id,
                "prompt_hash": stable_hash(&prompt),
                "memory_count": memories.len(),
                "skill_count": skill_index.len(),
                "tool_count": tool_index.len() + mcp_index.len(),
            },
            "assets": {
                "memories": memories,
                "skills": skill_index,
                "tools": tool_index,
                "mcp": mcp_index,
            }
        }),
    )
}

pub fn agent_turn_traces() -> AppResult<StubPayload> {
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
                "prompt_hash": trace.prompt_hash,
                "memory_count": trace.memory_count,
                "skill_count": trace.skill_count,
                "tool_count": trace.tool_count,
                "created_at": trace.created_at,
            })
        })
        .collect::<Vec<_>>();
    success_payload("agent_turn_traces", json!({ "traces": traces }))
}
