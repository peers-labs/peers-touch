use crate::contracts::{McpCreateInput, McpNameInput, McpToggleInput, McpUpdateInput, StubPayload};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::storage;
#[cfg(not(test))]
use crate::infrastructure::storage::StorageKind;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Serialize, Deserialize)]
struct McpServerRecord {
    name: String,
    data: Value,
    enabled: bool,
}

#[derive(Default, Serialize, Deserialize)]
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
                    "title": "i18n:mcp.default.title",
                    "description": "i18n:mcp.default.description",
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
                    "status": "unknown",
                    "lastTestedAt": "",
                    "lastError": "",
                    "tools": [],
                    "policy": "approval",
                    "needs_approval": true,
                    "audit_event": "bridge.mcp.call",
                    "replayable": true,
                    "createdAt": "2026-03-24T00:00:00.000Z",
                    "updatedAt": "2026-03-24T00:00:00.000Z"
                }),
            }],
        }
    }
}

static MCP_STORE: OnceLock<Mutex<McpStore>> = OnceLock::new();

fn mcp_store() -> &'static Mutex<McpStore> {
    MCP_STORE.get_or_init(|| Mutex::new(load_mcp_store()))
}

#[cfg(test)]
fn mcp_store_path() -> PathBuf {
    std::env::temp_dir().join(format!("peers-touch-agent-mcp-{}.json", std::process::id()))
}

#[cfg(not(test))]
fn mcp_store_path() -> PathBuf {
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["agent", "mcp", "servers.json"],
    )
    .unwrap_or_else(|_| PathBuf::from("agent.mcp.servers.json"))
}

fn load_mcp_store() -> McpStore {
    let path = mcp_store_path();
    if !path.exists() {
        return McpStore::seeded();
    }
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "Failed to read MCP store");
            return McpStore::seeded();
        }
    };
    serde_json::from_str::<McpStore>(&raw).unwrap_or_else(|err| {
        tracing::warn!(path = %path.display(), error = %err, "Failed to parse MCP store");
        McpStore::seeded()
    })
}

fn persist_mcp_store(store: &McpStore) -> Result<(), AppResult<StubPayload>> {
    let path = mcp_store_path();
    let serialized = serde_json::to_string(store).map_err(|err| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to serialize MCP store: {}", err),
            None,
        )
    })?;
    storage::write_string_atomic(&path, &serialized).map_err(|err| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist MCP store: {}", err),
            None,
        )
    })
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

fn store_lock_error(e: impl std::fmt::Display) -> AppResult<StubPayload> {
    tracing::error!(error = %e, "Failed to acquire MCP store lock");
    AppResult::fail(
        ErrorCode::InternalError,
        format!("Failed to access MCP store: {}", e),
        None,
    )
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn set_json_default(data: &mut Value, key: &str, value: Value) {
    if let Some(obj) = data.as_object_mut() {
        if !obj.contains_key(key) {
            obj.insert(key.to_string(), value);
        }
    }
}

fn normalize_server_data(mut data: Value, name: &str, enabled: bool) -> Value {
    if let Some(obj) = data.as_object_mut() {
        obj.insert("name".to_string(), json!(name));
        obj.insert("enabled".to_string(), json!(enabled));
        obj.insert("updatedAt".to_string(), json!(now_iso()));
    }
    set_json_default(&mut data, "createdAt", json!(now_iso()));
    set_json_default(&mut data, "status", json!("unknown"));
    set_json_default(&mut data, "lastTestedAt", json!(""));
    set_json_default(&mut data, "lastError", json!(""));
    set_json_default(&mut data, "tools", json!([]));
    set_json_default(&mut data, "policy", json!("approval"));
    set_json_default(&mut data, "needs_approval", json!(true));
    set_json_default(&mut data, "audit_event", json!("bridge.mcp.call"));
    set_json_default(&mut data, "replayable", json!(true));
    data
}

fn projected_tool_count(data: &Value) -> usize {
    data.get("tools")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}

fn validate_server_health(data: &Value) -> Result<Vec<String>, String> {
    match data.get("type").and_then(Value::as_str).unwrap_or("stdio") {
        "http" | "sse" => {
            let url = data.get("url").and_then(Value::as_str).unwrap_or("").trim();
            if url.is_empty() {
                Err("MCP HTTP URL is required".to_string())
            } else {
                Ok(vec![])
            }
        }
        _ => {
            let command = data
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            if command.is_empty() {
                Err("MCP stdio command is required".to_string())
            } else {
                Ok(data
                    .get("tools")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(ToString::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default())
            }
        }
    }
}

pub fn mcp_list_servers() -> AppResult<StubPayload> {
    let guard = match mcp_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
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
                "status": data.get("status").and_then(Value::as_str).unwrap_or("unknown"),
                "policy": data.get("policy").and_then(Value::as_str).unwrap_or("approval"),
                "needs_approval": data.get("needs_approval").and_then(Value::as_bool).unwrap_or(true),
                "audit_event": data.get("audit_event").and_then(Value::as_str).unwrap_or("bridge.mcp.call"),
                "replayable": data.get("replayable").and_then(Value::as_bool).unwrap_or(true),
                "lastTestedAt": data.get("lastTestedAt").and_then(Value::as_str).unwrap_or(""),
                "lastError": data.get("lastError").and_then(Value::as_str).unwrap_or(""),
                "metaAvatar": data.get("metaAvatar").and_then(Value::as_str).unwrap_or(""),
                "metaTags": data.get("metaTags").cloned().unwrap_or_else(|| json!([])),
                "toolCount": projected_tool_count(data)
            })
        })
        .collect::<Vec<_>>();
    success_payload("mcp_list_servers", json!({ "servers": servers }))
}

pub(crate) fn enabled_mcp_index() -> Vec<Value> {
    let guard = match mcp_store().lock() {
        Ok(guard) => guard,
        Err(e) => {
            tracing::error!(error = %e, "Failed to read MCP index");
            return vec![];
        }
    };
    guard
        .servers
        .iter()
        .filter(|item| item.enabled)
        .map(|item| {
            json!({
                "name": item.name,
                "title": item.data.get("title").and_then(Value::as_str).unwrap_or(""),
                "type": item.data.get("type").and_then(Value::as_str).unwrap_or("stdio"),
                "description": item.data.get("description").and_then(Value::as_str).unwrap_or(""),
                "source": item.data.get("source").and_then(Value::as_str).unwrap_or("user"),
                "status": item.data.get("status").and_then(Value::as_str).unwrap_or("unknown"),
                "policy": item.data.get("policy").and_then(Value::as_str).unwrap_or("approval"),
                "needs_approval": item.data.get("needs_approval").and_then(Value::as_bool).unwrap_or(true),
                "audit_event": item.data.get("audit_event").and_then(Value::as_str).unwrap_or("bridge.mcp.call"),
                "replayable": item.data.get("replayable").and_then(Value::as_bool).unwrap_or(true),
                "tool_count": projected_tool_count(&item.data),
            })
        })
        .collect()
}

pub fn mcp_get_server(input: McpNameInput) -> AppResult<StubPayload> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let guard = match mcp_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    if let Some(item) = guard.servers.iter().find(|item| item.name == name) {
        let mut data = item.data.clone();
        if let Some(obj) = data.as_object_mut() {
            obj.insert("enabled".to_string(), json!(item.enabled));
        }
        return success_payload("mcp_get_server", data);
    }
    AppResult::fail(ErrorCode::NotFound, "MCP server not found", None)
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
        Err(e) => return store_lock_error(e),
    };
    if guard.servers.iter().any(|item| item.name == name) {
        return AppResult::fail(ErrorCode::Conflict, "MCP server already exists", None);
    }
    let enabled = input
        .data
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let data = normalize_server_data(input.data, &name, enabled);
    guard.servers.push(McpServerRecord {
        name: name.clone(),
        enabled,
        data,
    });
    if let Err(err) = persist_mcp_store(&guard) {
        return err;
    }
    success_payload("mcp_create_server", json!({ "ok": true, "name": name }))
}

pub fn mcp_update_server(input: McpUpdateInput) -> AppResult<StubPayload> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let mut guard = match mcp_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    if let Some(item) = guard.servers.iter_mut().find(|item| item.name == name) {
        let enabled = input
            .data
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(item.enabled);
        item.enabled = enabled;
        item.data = normalize_server_data(input.data, &name, enabled);
        if let Err(err) = persist_mcp_store(&guard) {
            return err;
        }
        return success_payload("mcp_update_server", json!({ "ok": true }));
    }
    AppResult::fail(ErrorCode::NotFound, "MCP server not found", None)
}

pub fn mcp_delete_server(input: McpNameInput) -> AppResult<StubPayload> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let mut guard = match mcp_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let before = guard.servers.len();
    guard.servers.retain(|item| item.name != name);
    if let Err(err) = persist_mcp_store(&guard) {
        return err;
    }
    success_payload(
        "mcp_delete_server",
        json!({ "ok": before != guard.servers.len() }),
    )
}

pub fn mcp_toggle_server(input: McpToggleInput) -> AppResult<StubPayload> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let mut guard = match mcp_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    if let Some(item) = guard.servers.iter_mut().find(|item| item.name == name) {
        item.enabled = input.enabled;
        if let Some(obj) = item.data.as_object_mut() {
            obj.insert("enabled".to_string(), json!(input.enabled));
            obj.insert("updatedAt".to_string(), json!(now_iso()));
        }
        if let Err(err) = persist_mcp_store(&guard) {
            return err;
        }
        return success_payload("mcp_toggle_server", json!({ "ok": true }));
    }
    AppResult::fail(ErrorCode::NotFound, "MCP server not found", None)
}

pub fn mcp_test_server(input: McpNameInput) -> AppResult<StubPayload> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let mut guard = match mcp_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    if let Some(item) = guard.servers.iter_mut().find(|item| item.name == name) {
        let tested_at = now_iso();
        let health = validate_server_health(&item.data);
        if let Some(obj) = item.data.as_object_mut() {
            obj.insert("lastTestedAt".to_string(), json!(tested_at));
            match &health {
                Ok(tools) => {
                    obj.insert("status".to_string(), json!("ok"));
                    obj.insert("lastError".to_string(), json!(""));
                    if !tools.is_empty() {
                        obj.insert("tools".to_string(), json!(tools));
                    }
                }
                Err(error) => {
                    obj.insert("status".to_string(), json!("error"));
                    obj.insert("lastError".to_string(), json!(error));
                }
            }
        }
        if let Err(err) = persist_mcp_store(&guard) {
            return err;
        }
        return match health {
            Ok(tools) => success_payload(
                "mcp_test_server",
                json!({ "ok": true, "tools": tools, "status": "ok" }),
            ),
            Err(error) => success_payload(
                "mcp_test_server",
                json!({ "ok": false, "error": error, "tools": [], "status": "error" }),
            ),
        };
    }
    AppResult::fail(ErrorCode::NotFound, "MCP server not found", None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enabled_mcp_index_should_include_policy_metadata() {
        let servers = enabled_mcp_index();
        assert!(servers.iter().any(|server| {
            server["name"] == "default-mcp"
                && server["needs_approval"] == true
                && server["audit_event"] == "bridge.mcp.call"
        }));
    }

    #[test]
    fn mcp_test_server_should_persist_health_status() {
        let name = format!("health-{}", std::process::id());
        let _ = mcp_create_server(McpCreateInput {
            data: json!({
                "name": name,
                "type": "stdio",
                "command": "health-mcp",
                "enabled": true,
                "tools": ["ping"]
            }),
        });
        let result = mcp_test_server(McpNameInput { name: name.clone() });
        assert!(result.ok);
        let detail = mcp_get_server(McpNameInput { name }).data.expect("detail");
        let status: Value = serde_json::from_str(&detail.status).expect("json");
        assert_eq!(status["status"], "ok");
        assert_eq!(status["tools"][0], "ping");
    }
}
