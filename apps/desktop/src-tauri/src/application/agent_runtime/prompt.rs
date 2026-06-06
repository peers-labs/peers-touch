use serde_json::Value;

use super::context::TurnContext;
use super::value_string;

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

pub(crate) fn assemble_prompt(context: &TurnContext, user_input: &str) -> String {
    [
        "# System".to_string(),
        agent_system_prompt(&context.agent),
        "# Memory Snapshot".to_string(),
        json_lines_block("Relevant memories", &context.memories),
        "# Skills".to_string(),
        json_lines_block("Enabled skills", &context.skills),
        "# Tools".to_string(),
        json_lines_block("Available tools", &context.tools),
        "# MCP".to_string(),
        json_lines_block("Enabled MCP servers", &context.mcp),
        "# User".to_string(),
        user_input.to_string(),
    ]
    .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn context(agent: Value) -> TurnContext {
        TurnContext {
            agent,
            effective_agent_id: "agent-1".to_string(),
            agent_display_id: "Assistant".to_string(),
            memories: vec![json!({ "summary": "likes concise reports" })],
            skills: vec![json!({ "id": "skill-1", "name": "Report Writer" })],
            tools: vec![json!({ "name": "file_search" })],
            mcp: vec![json!({ "name": "workspace" })],
        }
    }

    #[test]
    fn assemble_prompt_should_include_all_context_sections() {
        let prompt = assemble_prompt(
            &context(json!({ "systemPrompt": "Be precise." })),
            "Draft a plan",
        );

        assert!(prompt.contains("# System\n\nBe precise."));
        assert!(prompt.contains("# Memory Snapshot"));
        assert!(prompt.contains("likes concise reports"));
        assert!(prompt.contains("# Skills"));
        assert!(prompt.contains("Report Writer"));
        assert!(prompt.contains("# Tools"));
        assert!(prompt.contains("file_search"));
        assert!(prompt.contains("# MCP"));
        assert!(prompt.contains("workspace"));
        assert!(prompt.ends_with("# User\n\nDraft a plan"));
    }

    #[test]
    fn assemble_prompt_should_use_default_system_prompt_when_agent_prompt_missing() {
        let prompt = assemble_prompt(&context(json!({})), "Hello");

        assert!(prompt.contains("You are a helpful Peers-Touch agent."));
    }
}
