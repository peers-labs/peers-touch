use crate::contracts::{SearchPrimaryInput, StubPayload};
use crate::error::{AppResult, ErrorCode};
use serde_json::json;

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

pub fn tools_list() -> AppResult<StubPayload> {
    success_payload(
        "tools_list",
        json!({
            "tools":[
                {
                    "name":"web_search",
                    "category":"web",
                    "source":"builtin",
                    "enabled":true,
                    "needs_approval":false,
                    "policy":"auto",
                    "schema":{"query":"string","limit":"number?"},
                    "audit_event":"tool.web_search",
                    "replayable":true
                },
                {
                    "name":"file_search",
                    "category":"filesystem",
                    "source":"builtin",
                    "enabled":true,
                    "needs_approval":false,
                    "policy":"workspace",
                    "schema":{"query":"string","root":"string?"},
                    "audit_event":"tool.file_search",
                    "replayable":true
                },
                {
                    "name":"memory.write",
                    "category":"memory",
                    "source":"bridge",
                    "enabled":true,
                    "needs_approval":true,
                    "policy":"approval",
                    "schema":{"target":"string","content":"string","evidence":"string"},
                    "audit_event":"bridge.memory.write",
                    "replayable":true
                },
                {
                    "name":"mcp.call",
                    "category":"mcp",
                    "source":"bridge",
                    "enabled":true,
                    "needs_approval":true,
                    "policy":"approval",
                    "schema":{"server":"string","tool":"string","arguments":"object"},
                    "audit_event":"bridge.mcp.call",
                    "replayable":true
                }
            ]
        }),
    )
}

pub(crate) fn tool_registry_index() -> Vec<serde_json::Value> {
    vec![
        json!({
            "name": "web_search",
            "kind": "builtin",
            "category": "web",
            "enabled": true,
            "needs_approval": false,
            "description": "Search public web sources when the agent needs fresh information.",
            "audit_event": "tool.web_search"
        }),
        json!({
            "name": "file_search",
            "kind": "builtin",
            "category": "filesystem",
            "enabled": true,
            "needs_approval": false,
            "description": "Search local workspace files that the user has made available.",
            "audit_event": "tool.file_search"
        }),
        json!({
            "name": "memory.write",
            "kind": "bridge",
            "category": "memory",
            "enabled": true,
            "needs_approval": true,
            "description": "Write governed memory records with evidence.",
            "audit_event": "bridge.memory.write"
        }),
        json!({
            "name": "mcp.call",
            "kind": "bridge",
            "category": "mcp",
            "enabled": true,
            "needs_approval": true,
            "description": "Call a projected MCP server tool through the governed bridge.",
            "audit_event": "bridge.mcp.call"
        }),
    ]
}

pub fn tools_search_providers() -> AppResult<StubPayload> {
    success_payload(
        "tools_search_providers",
        json!({
            "providers":[
                {"id":"all","name":"All"},
                {"id":"web","name":"Web"}
            ],
            "primary":"all"
        }),
    )
}

pub fn tools_set_search_primary(input: SearchPrimaryInput) -> AppResult<StubPayload> {
    if input.provider.trim().is_empty() {
        return invalid_argument("provider is required");
    }
    success_payload(
        "tools_set_search_primary",
        json!({
            "ok":true,
            "primary":input.provider
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_status(payload: &StubPayload) -> serde_json::Value {
        serde_json::from_str(&payload.status).expect("status should be valid json")
    }

    #[test]
    fn tools_list_should_include_policy_and_audit_metadata() {
        let result = tools_list();
        assert!(result.ok);
        let status = parse_status(&result.data.expect("payload"));
        let tools = status["tools"].as_array().expect("tools");
        assert!(tools.iter().any(|tool| {
            tool["name"] == "memory.write"
                && tool["needs_approval"] == true
                && tool["audit_event"] == "bridge.memory.write"
        }));
    }

    #[test]
    fn tool_registry_index_should_project_bridge_tools() {
        let tools = tool_registry_index();
        assert!(tools
            .iter()
            .any(|tool| { tool["kind"] == "bridge" && tool["audit_event"] == "bridge.mcp.call" }));
    }
}
