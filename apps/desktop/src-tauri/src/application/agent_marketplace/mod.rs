use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Deserialize, Serialize)]
pub struct AgentMarketplaceListInput {
    pub kind: Option<String>,
    pub q: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AgentMarketplaceIdInput {
    pub id: String,
}

fn success_payload(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn marketplace_entries() -> Vec<Value> {
    vec![
        json!({
            "id": "agent.research-analyst",
            "kind": "agent",
            "name": "Research Analyst",
            "description": "Evidence-first research agent with source notes and review checkpoints.",
            "publisher": "Peers-Touch",
            "source": "builtin",
            "trust_level": "verified",
            "verified": true,
            "risk": "low",
            "tags": ["research", "analysis", "memory"],
            "install_hint": "Creates a local agent template.",
            "manifest": {
                "name": "research-analyst",
                "title": "Research Analyst",
                "description": "Evidence-first research agent with source notes and review checkpoints.",
                "avatar": "🔎",
                "tags": "[\"research\",\"analysis\"]",
                "systemPrompt": "You are a research analyst. State assumptions, cite local evidence, and separate facts from recommendations.",
                "toolsProfile": "standard"
            }
        }),
        json!({
            "id": "agent.operator-reviewer",
            "kind": "agent",
            "name": "Operator Reviewer",
            "description": "Reviews task outputs, acceptance criteria, policy risks, and missing artifacts.",
            "publisher": "Peers-Touch",
            "source": "builtin",
            "trust_level": "verified",
            "verified": true,
            "risk": "low",
            "tags": ["review", "governance", "a2a"],
            "install_hint": "Creates a local agent template.",
            "manifest": {
                "name": "operator-reviewer",
                "title": "Operator Reviewer",
                "description": "Reviews task outputs, acceptance criteria, policy risks, and missing artifacts.",
                "avatar": "✅",
                "tags": "[\"review\",\"governance\"]",
                "systemPrompt": "You are an operator reviewer. Check the work against acceptance criteria, call out risks, and produce concise review artifacts.",
                "toolsProfile": "review"
            }
        }),
        json!({
            "id": "mcp.local-files",
            "kind": "mcp",
            "name": "Local Files MCP",
            "description": "Local filesystem MCP template with explicit approval policy.",
            "publisher": "Peers-Touch",
            "source": "builtin",
            "trust_level": "reviewed",
            "verified": true,
            "risk": "medium",
            "tags": ["files", "mcp", "approval"],
            "install_hint": "Adds a disabled MCP server template for review before enabling.",
            "manifest": {
                "name": "local-files",
                "title": "Local Files",
                "description": "Local filesystem MCP template with explicit approval policy.",
                "type": "stdio",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
                "env": {},
                "enabled": false,
                "source": "marketplace",
                "policy": "approval_required",
                "needs_approval": true,
                "audit_event": "mcp.local-files.call",
                "replayable": true,
                "metaAvatar": "📁",
                "metaTags": ["files", "local"]
            }
        }),
        json!({
            "id": "mcp.browser-tools",
            "kind": "mcp",
            "name": "Browser Tools MCP",
            "description": "Browser automation MCP template for inspection workflows.",
            "publisher": "Peers-Touch",
            "source": "builtin",
            "trust_level": "reviewed",
            "verified": true,
            "risk": "medium",
            "tags": ["browser", "mcp", "automation"],
            "install_hint": "Adds a disabled MCP server template for review before enabling.",
            "manifest": {
                "name": "browser-tools",
                "title": "Browser Tools",
                "description": "Browser automation MCP template for inspection workflows.",
                "type": "stdio",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
                "env": {},
                "enabled": false,
                "source": "marketplace",
                "policy": "approval_required",
                "needs_approval": true,
                "audit_event": "mcp.browser-tools.call",
                "replayable": true,
                "metaAvatar": "🌐",
                "metaTags": ["browser", "automation"]
            }
        }),
    ]
}

pub fn agent_marketplace_list(input: AgentMarketplaceListInput) -> AppResult<StubPayload> {
    let kind = input.kind.unwrap_or_default().to_lowercase();
    let q = input.q.unwrap_or_default().to_lowercase();
    let entries = marketplace_entries()
        .into_iter()
        .filter(|entry| {
            kind.trim().is_empty()
                || entry
                    .get("kind")
                    .and_then(Value::as_str)
                    .map(|value| value == kind)
                    .unwrap_or(false)
        })
        .filter(|entry| {
            if q.trim().is_empty() {
                return true;
            }
            ["name", "description", "publisher", "trust_level"]
                .iter()
                .any(|key| {
                    entry
                        .get(*key)
                        .and_then(Value::as_str)
                        .map(|value| value.to_lowercase().contains(&q))
                        .unwrap_or(false)
                })
        })
        .collect::<Vec<_>>();
    success_payload(
        "agent_marketplace_list",
        json!({ "entries": entries, "source": "builtin" }),
    )
}

pub fn agent_marketplace_get(input: AgentMarketplaceIdInput) -> AppResult<StubPayload> {
    let id = input.id;
    if id.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }
    let Some(entry) = marketplace_entries()
        .into_iter()
        .find(|entry| entry.get("id").and_then(Value::as_str) == Some(id.as_str()))
    else {
        return AppResult::fail(ErrorCode::NotFound, "Marketplace entry not found", None);
    };
    success_payload("agent_marketplace_get", json!({ "entry": entry }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marketplace_should_filter_agent_and_mcp_entries() {
        let agents = agent_marketplace_list(AgentMarketplaceListInput {
            kind: Some("agent".to_string()),
            q: None,
        });
        assert!(agents.ok);
        let status: Value = serde_json::from_str(&agents.data.expect("payload").status).unwrap();
        assert!(status["entries"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| { entry["kind"] == "agent" && entry["trust_level"].as_str().is_some() }));

        let mcp = agent_marketplace_list(AgentMarketplaceListInput {
            kind: Some("mcp".to_string()),
            q: Some("browser".to_string()),
        });
        let status: Value = serde_json::from_str(&mcp.data.expect("payload").status).unwrap();
        assert_eq!(status["entries"][0]["id"], "mcp.browser-tools");
    }
}
