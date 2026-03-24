use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{McpCreateInput, McpNameInput, McpToggleInput, McpUpdateInput, StubPayload};
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};

#[derive(Clone)]
struct McpServerRecord {
    name: String,
    data: Value,
    enabled: bool,
}

#[derive(Default)]
struct McpStore {
    servers: Vec<McpServerRecord>,
}

impl McpStore {
    fn seeded() -> Self {
        Self {
            servers: vec![McpServerRecord {
                name: "default-mcp".to_string(),
                enabled: true,
                data: json!({
                    "name": "default-mcp",
                    "title": "Default MCP",
                    "description": "Builtin MCP server",
                    "version": "1.0.0",
                    "type": "stdio",
                    "command": "mcp-server",
                    "args": [],
                    "env": {},
                    "url": "",
                    "headers": {},
                    "authType": "",
                    "authToken": "",
                    "authAccessToken": "",
                    "configSchema": {},
                    "settings": {},
                    "metaAvatar": "",
                    "metaTags": [],
                    "source": "user",
                    "homepage": "",
                    "repository": "",
                    "enabled": true,
                    "createdAt": "2026-03-24T00:00:00.000Z",
                    "updatedAt": "2026-03-24T00:00:00.000Z"
                }),
            }],
        }
    }
}

static MCP_STORE: OnceLock<Mutex<McpStore>> = OnceLock::new();

fn mcp_store() -> &'static Mutex<McpStore> {
    MCP_STORE.get_or_init(|| Mutex::new(McpStore::seeded()))
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

fn internal_error() -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InternalError, "failed to access mcp store", None)
}

pub fn mcp_list_servers() -> AppResult<StubPayload> {
    let guard = match mcp_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let servers = guard
        .servers
        .iter()
        .map(|item| {
            let data = &item.data;
            json!({
                "name": item.name,
                "title": data.get("title").and_then(Value::as_str).unwrap_or(""),
                "description": data.get("description").and_then(Value::as_str).unwrap_or(""),
                "type": data.get("type").and_then(Value::as_str).unwrap_or("stdio"),
                "source": data.get("source").and_then(Value::as_str).unwrap_or("user"),
                "enabled": item.enabled,
                "metaAvatar": data.get("metaAvatar").and_then(Value::as_str).unwrap_or(""),
                "metaTags": data.get("metaTags").cloned().unwrap_or_else(|| json!([])),
                "toolCount": 0
            })
        })
        .collect::<Vec<_>>();
    success_payload("mcp_list_servers", json!({ "servers": servers }))
}

pub fn mcp_get_server(input: McpNameInput) -> AppResult<StubPayload> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let guard = match mcp_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    if let Some(item) = guard.servers.iter().find(|item| item.name == name) {
        let mut data = item.data.clone();
        if let Some(obj) = data.as_object_mut() {
            obj.insert("enabled".to_string(), json!(item.enabled));
        }
        return success_payload("mcp_get_server", data);
    }
    AppResult::fail(ErrorCode::NotFound, "server not found", None)
}

pub fn mcp_create_server(input: McpCreateInput) -> AppResult<StubPayload> {
    let name = input
        .data
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let mut guard = match mcp_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    guard.servers.push(McpServerRecord {
        name: name.clone(),
        enabled: input.data.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        data: input.data,
    });
    success_payload("mcp_create_server", json!({ "ok": true, "name": name }))
}

pub fn mcp_update_server(input: McpUpdateInput) -> AppResult<StubPayload> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let mut guard = match mcp_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    if let Some(item) = guard.servers.iter_mut().find(|item| item.name == name) {
        item.enabled = input.data.get("enabled").and_then(Value::as_bool).unwrap_or(item.enabled);
        item.data = input.data;
        return success_payload("mcp_update_server", json!({ "ok": true }));
    }
    AppResult::fail(ErrorCode::NotFound, "server not found", None)
}

pub fn mcp_delete_server(input: McpNameInput) -> AppResult<StubPayload> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let mut guard = match mcp_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let before = guard.servers.len();
    guard.servers.retain(|item| item.name != name);
    success_payload("mcp_delete_server", json!({ "ok": before != guard.servers.len() }))
}

pub fn mcp_toggle_server(input: McpToggleInput) -> AppResult<StubPayload> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let mut guard = match mcp_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    if let Some(item) = guard.servers.iter_mut().find(|item| item.name == name) {
        item.enabled = input.enabled;
        return success_payload("mcp_toggle_server", json!({ "ok": true }));
    }
    AppResult::fail(ErrorCode::NotFound, "server not found", None)
}

pub fn mcp_test_server(input: McpNameInput) -> AppResult<StubPayload> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    success_payload("mcp_test_server", json!({ "ok": true, "tools": [] }))
}
