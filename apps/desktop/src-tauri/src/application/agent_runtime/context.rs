use crate::application::{agents, mcp, memory, skills, tools};
use serde_json::{json, Value};

use super::value_string;

pub(crate) struct TurnContext {
    pub(crate) agent: Value,
    pub(crate) effective_agent_id: String,
    pub(crate) agent_display_id: String,
    pub(crate) memories: Vec<Value>,
    pub(crate) skills: Vec<Value>,
    pub(crate) tools: Vec<Value>,
    pub(crate) mcp: Vec<Value>,
}

pub(crate) fn build_turn_context(
    actor_id: &str,
    agent_identifier: &str,
    user_input: &str,
) -> TurnContext {
    let agent = agents::agent_data_by_identifier(actor_id, agent_identifier)
        .unwrap_or_else(|| json!({ "id": agent_identifier, "name": agent_identifier }));
    let agent_id = value_string(&agent, "id");
    let agent_name = value_string(&agent, "name");
    let effective_agent_id = if agent_id.is_empty() {
        agent_identifier.to_string()
    } else {
        agent_id
    };
    let agent_display_id = if agent_name.is_empty() {
        effective_agent_id.clone()
    } else {
        agent_name
    };

    TurnContext {
        agent,
        memories: memory::local_memory_snapshot(&effective_agent_id, user_input, 8),
        skills: skills::enabled_skill_index(),
        tools: tools::tool_registry_index(),
        mcp: mcp::enabled_mcp_index(),
        effective_agent_id,
        agent_display_id,
    }
}
