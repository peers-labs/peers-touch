use crate::contracts::{
    McpCreateInput, McpExecuteToolInput, McpNameInput, McpToggleInput, McpUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::storage::{self, StorageKind};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
const MCP_TEST_TIMEOUT: Duration = Duration::from_secs(8);

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
    fn load() -> Self {
        let path = match mcp_store_path() {
            Ok(path) => path,
            Err(error) => {
                tracing::warn!(error = %error, "Failed to resolve MCP store path; using seeded store");
                return Self::seeded();
            }
        };
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Self::seeded(),
            Err(error) => {
                tracing::warn!(error = %error, path = %path.display(), "Failed to read MCP store; using seeded store");
                return Self::seeded();
            }
        };
        let raw_servers = match serde_json::from_str::<Vec<Value>>(&content) {
            Ok(raw_servers) => raw_servers,
            Err(error) => {
                tracing::warn!(error = %error, path = %path.display(), "Failed to parse MCP store; using seeded store");
                return Self::seeded();
            }
        };
        let servers = raw_servers
            .into_iter()
            .filter_map(|data| record_from_value(data).ok())
            .collect::<Vec<_>>();
        Self { servers }
    }

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
                    "createdAt": "2026-03-24T00:00:00.000Z",
                    "updatedAt": "2026-03-24T00:00:00.000Z"
                }),
            }],
        }
    }
}

static MCP_STORE: OnceLock<Mutex<McpStore>> = OnceLock::new();

fn mcp_store() -> &'static Mutex<McpStore> {
    MCP_STORE.get_or_init(|| Mutex::new(McpStore::load()))
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

fn mcp_store_path() -> Result<PathBuf, String> {
    let dir = storage::app_file_path("desktop", StorageKind::Data, &["mcp"])
        .map_err(|error| format!("failed to resolve MCP store directory: {error:?}"))?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create MCP store directory: {error}"))?;
    Ok(dir.join("servers.json"))
}

fn persist_store(store: &McpStore) -> Result<(), String> {
    let path = mcp_store_path()?;
    let values = store
        .servers
        .iter()
        .map(|item| {
            let mut data = item.data.clone();
            if let Some(obj) = data.as_object_mut() {
                obj.insert("name".to_string(), json!(item.name));
                obj.insert("enabled".to_string(), json!(item.enabled));
            }
            data
        })
        .collect::<Vec<_>>();
    let content = serde_json::to_string_pretty(&values)
        .map_err(|error| format!("failed to serialize MCP store: {error}"))?;
    fs::write(path, content).map_err(|error| format!("failed to write MCP store: {error}"))
}

fn persist_error(error: impl std::fmt::Display) -> AppResult<StubPayload> {
    tracing::error!(error = %error, "Failed to persist MCP store");
    AppResult::fail(
        ErrorCode::InternalError,
        format!("Failed to persist MCP store: {error}"),
        None,
    )
}

fn record_from_value(mut data: Value) -> Result<McpServerRecord, String> {
    normalize_mcp_value(&mut data)?;
    let name = data
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() {
        return Err("name is required".to_string());
    }
    let enabled = data.get("enabled").and_then(Value::as_bool).unwrap_or(true);
    Ok(McpServerRecord {
        name,
        data,
        enabled,
    })
}

fn normalize_mcp_value(data: &mut Value) -> Result<(), String> {
    let obj = data
        .as_object_mut()
        .ok_or_else(|| "MCP server data must be an object".to_string())?;
    let now = now_rfc3339();
    let transport = obj
        .get("type")
        .or_else(|| obj.get("transport"))
        .and_then(Value::as_str)
        .unwrap_or("stdio")
        .trim()
        .to_ascii_lowercase();
    if !matches!(transport.as_str(), "stdio" | "http" | "sse") {
        return Err("MCP transport must be stdio, http, or sse".to_string());
    }
    obj.insert("type".to_string(), json!(transport));
    obj.entry("title".to_string()).or_insert_with(|| json!(""));
    obj.entry("description".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("version".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("command".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("args".to_string()).or_insert_with(|| json!([]));
    obj.entry("env".to_string()).or_insert_with(|| json!({}));
    obj.entry("url".to_string()).or_insert_with(|| json!(""));
    obj.entry("headers".to_string())
        .or_insert_with(|| json!({}));
    obj.entry("authType".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("authToken".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("authAccessToken".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("configSchema".to_string())
        .or_insert_with(|| json!({}));
    obj.entry("settings".to_string())
        .or_insert_with(|| json!({}));
    obj.entry("metaAvatar".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("metaTags".to_string())
        .or_insert_with(|| json!([]));
    obj.entry("source".to_string())
        .or_insert_with(|| json!("user"));
    obj.entry("homepage".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("repository".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("enabled".to_string())
        .or_insert_with(|| json!(true));
    obj.entry("status".to_string())
        .or_insert_with(|| json!("unknown"));
    obj.entry("lastTestedAt".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("lastError".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("tools".to_string()).or_insert_with(|| json!([]));
    obj.entry("createdAt".to_string())
        .or_insert_with(|| json!(now.clone()));
    obj.insert("updatedAt".to_string(), json!(now));
    Ok(())
}

fn now_rfc3339() -> String {
    let unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs() as i64;
    let dt =
        time::OffsetDateTime::from_unix_timestamp(unix).unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    dt.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn value_string(data: &Value, key: &str) -> String {
    data.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn value_string_array(data: &Value, key: &str) -> Vec<String> {
    data.get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn value_string_map(data: &Value, key: &str) -> Vec<(String, String)> {
    data.get(key)
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_string()))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
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
                "metaAvatar": data.get("metaAvatar").and_then(Value::as_str).unwrap_or(""),
                "metaTags": data.get("metaTags").cloned().unwrap_or_else(|| json!([])),
                "status": data.get("status").and_then(Value::as_str).unwrap_or("unknown"),
                "lastTestedAt": data.get("lastTestedAt").and_then(Value::as_str).unwrap_or(""),
                "lastError": data.get("lastError").and_then(Value::as_str).unwrap_or(""),
                "toolCount": data.get("tools").and_then(Value::as_array).map(|tools| tools.len()).unwrap_or(0)
            })
        })
        .collect::<Vec<_>>();
    success_payload("mcp_list_servers", json!({ "servers": servers }))
}

pub fn mcp_tool_registry_entries() -> Result<Vec<Value>, String> {
    let guard = mcp_store()
        .lock()
        .map_err(|error| format!("failed to access MCP store: {error}"))?;
    let mut entries = Vec::new();
    for server in guard.servers.iter().filter(|server| server.enabled) {
        let transport = value_string(&server.data, "type");
        let tools = server
            .data
            .get("tools")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for tool in tools {
            let name = tool
                .as_str()
                .map(str::to_string)
                .or_else(|| tool.get("name").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            entries.push(json!({
                "name": format!("mcp.{}.{}", server.name, name),
                "displayName": name,
                "source": "mcp",
                "serverName": server.name,
                "transport": transport,
                "category": "mcp",
                "enabled": true,
                "needs_approval": true,
                "executable": true
            }));
        }
    }
    Ok(entries)
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
    let record = match record_from_value(input.data) {
        Ok(record) => record,
        Err(error) => return invalid_argument(&error),
    };
    let name = record.name.clone();
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
    guard.servers.push(record);
    if let Err(error) = persist_store(&guard) {
        return persist_error(error);
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
    let mut next_data = input.data;
    if let Some(obj) = next_data.as_object_mut() {
        obj.insert("name".to_string(), json!(name.clone()));
    }
    let record = match record_from_value(next_data) {
        Ok(record) => record,
        Err(error) => return invalid_argument(&error),
    };
    if let Some(item) = guard.servers.iter_mut().find(|item| item.name == name) {
        item.enabled = record.enabled;
        item.data = record.data;
        if let Err(error) = persist_store(&guard) {
            return persist_error(error);
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
    if let Err(error) = persist_store(&guard) {
        return persist_error(error);
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
            obj.insert("updatedAt".to_string(), json!(now_rfc3339()));
        }
        if let Err(error) = persist_store(&guard) {
            return persist_error(error);
        }
        return success_payload("mcp_toggle_server", json!({ "ok": true }));
    }
    AppResult::fail(ErrorCode::NotFound, "MCP server not found", None)
}

pub fn mcp_test_server(input: McpNameInput) -> AppResult<StubPayload> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let mut guard = match mcp_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let Some(item) = guard.servers.iter_mut().find(|item| item.name == name) else {
        return AppResult::fail(ErrorCode::NotFound, "MCP server not found", None);
    };
    let test_result = probe_server(&item.data);
    let now = now_rfc3339();
    if let Some(obj) = item.data.as_object_mut() {
        obj.insert("lastTestedAt".to_string(), json!(now));
        match &test_result {
            Ok(tools) => {
                obj.insert("status".to_string(), json!("connected"));
                obj.insert("lastError".to_string(), json!(""));
                obj.insert("tools".to_string(), json!(tools));
            }
            Err(error) => {
                obj.insert("status".to_string(), json!("failed"));
                obj.insert("lastError".to_string(), json!(error));
                obj.insert("tools".to_string(), json!([]));
            }
        }
    }
    if let Err(error) = persist_store(&guard) {
        return persist_error(error);
    }
    match test_result {
        Ok(tools) => success_payload("mcp_test_server", json!({ "ok": true, "tools": tools })),
        Err(error) => success_payload(
            "mcp_test_server",
            json!({ "ok": false, "error": error, "tools": [] }),
        ),
    }
}

pub fn mcp_execute_tool(input: McpExecuteToolInput) -> AppResult<StubPayload> {
    let server_name = input.server_name.trim();
    let tool_name = input.tool_name.trim();
    if server_name.is_empty() {
        return invalid_argument("server_name is required");
    }
    if tool_name.is_empty() {
        return invalid_argument("tool_name is required");
    }
    let record = {
        let guard = match mcp_store().lock() {
            Ok(guard) => guard,
            Err(e) => return store_lock_error(e),
        };
        let Some(item) = guard.servers.iter().find(|item| item.name == server_name) else {
            return AppResult::fail(ErrorCode::NotFound, "MCP server not found", None);
        };
        if !item.enabled {
            return AppResult::fail(ErrorCode::InvalidArgument, "MCP server is disabled", None);
        }
        item.clone()
    };
    let started_at = SystemTime::now();
    let arguments = input.arguments.unwrap_or_else(|| json!({}));
    let result = execute_tool_on_server(&record.data, tool_name, arguments.clone());
    let duration_ms = started_at
        .elapsed()
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64;
    match result {
        Ok(output) => success_payload(
            "mcp_execute_tool",
            json!({
                "ok": true,
                "serverName": server_name,
                "toolName": tool_name,
                "callId": input.call_id.unwrap_or_default(),
                "arguments": arguments,
                "durationMs": duration_ms,
                "output": output,
                "audit": {
                    "source": "mcp",
                    "serverName": server_name,
                    "toolName": tool_name,
                    "transport": value_string(&record.data, "type"),
                    "executedAt": now_rfc3339()
                }
            }),
        ),
        Err(error) => success_payload(
            "mcp_execute_tool",
            json!({
                "ok": false,
                "serverName": server_name,
                "toolName": tool_name,
                "callId": input.call_id.unwrap_or_default(),
                "arguments": arguments,
                "durationMs": duration_ms,
                "error": error,
                "audit": {
                    "source": "mcp",
                    "serverName": server_name,
                    "toolName": tool_name,
                    "transport": value_string(&record.data, "type"),
                    "executedAt": now_rfc3339()
                }
            }),
        ),
    }
}

fn probe_server(data: &Value) -> Result<Vec<String>, String> {
    match value_string(data, "type").as_str() {
        "stdio" => probe_stdio_server(data),
        "http" => probe_http_like_server(data, false),
        "sse" => probe_http_like_server(data, true),
        other => Err(format!("unsupported MCP transport: {other}")),
    }
}

fn tool_call_request(id: i64, tool_name: &str, arguments: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments
        }
    })
}

fn initialize_request(id: i64) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "initialize",
        "params": {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": "peers-touch-desktop",
                "version": "0.1.0"
            }
        }
    })
}

fn initialized_notification() -> Value {
    json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
        "params": {}
    })
}

fn tools_list_request(id: i64) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "tools/list",
        "params": {}
    })
}

fn extract_tools(response: &Value) -> Result<Vec<String>, String> {
    if let Some(error) = response.get("error") {
        return Err(format!("MCP server returned error: {error}"));
    }
    let tools = response
        .get("result")
        .and_then(|result| result.get("tools"))
        .and_then(Value::as_array)
        .ok_or_else(|| "MCP tools/list response did not include result.tools".to_string())?;
    Ok(tools
        .iter()
        .filter_map(|tool| tool.get("name").and_then(Value::as_str))
        .map(str::to_string)
        .collect())
}

fn execute_tool_on_server(
    data: &Value,
    tool_name: &str,
    arguments: Value,
) -> Result<Value, String> {
    match value_string(data, "type").as_str() {
        "stdio" => execute_stdio_tool(data, tool_name, arguments),
        "http" => execute_http_like_tool(data, tool_name, arguments, false),
        "sse" => execute_http_like_tool(data, tool_name, arguments, true),
        other => Err(format!("unsupported MCP transport: {other}")),
    }
}

fn probe_stdio_server(data: &Value) -> Result<Vec<String>, String> {
    let command = value_string(data, "command");
    if command.is_empty() {
        return Err("stdio MCP command is required".to_string());
    }
    let args = value_string_array(data, "args");
    let env = value_string_map(data, "env");
    let mut child = Command::new(command)
        .args(args)
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("failed to spawn stdio MCP server: {error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to open MCP server stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to open MCP server stdout".to_string())?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let init = read_stdio_response_for_id(&mut reader, 1);
        let tools = init.and_then(|_| read_stdio_response_for_id(&mut reader, 2));
        let _ = tx.send(tools);
    });

    write_stdio_message(&mut stdin, &initialize_request(1))?;
    write_stdio_message(&mut stdin, &initialized_notification())?;
    write_stdio_message(&mut stdin, &tools_list_request(2))?;
    let result = rx
        .recv_timeout(MCP_TEST_TIMEOUT)
        .map_err(|_| "stdio MCP server test timed out".to_string())
        .and_then(|response| response)
        .and_then(|response| extract_tools(&response));
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn execute_stdio_tool(data: &Value, tool_name: &str, arguments: Value) -> Result<Value, String> {
    let command = value_string(data, "command");
    if command.is_empty() {
        return Err("stdio MCP command is required".to_string());
    }
    let args = value_string_array(data, "args");
    let env = value_string_map(data, "env");
    let mut child = Command::new(command)
        .args(args)
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("failed to spawn stdio MCP server: {error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to open MCP server stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to open MCP server stdout".to_string())?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let init = read_stdio_response_for_id(&mut reader, 1);
        let call = init.and_then(|_| read_stdio_response_for_id(&mut reader, 2));
        let _ = tx.send(call);
    });

    write_stdio_message(&mut stdin, &initialize_request(1))?;
    write_stdio_message(&mut stdin, &initialized_notification())?;
    write_stdio_message(&mut stdin, &tool_call_request(2, tool_name, arguments))?;
    let result = rx
        .recv_timeout(MCP_TEST_TIMEOUT)
        .map_err(|_| "stdio MCP tool call timed out".to_string())
        .and_then(|response| response)
        .and_then(|response| extract_tool_result(&response));
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn write_stdio_message(stdin: &mut impl Write, message: &Value) -> Result<(), String> {
    let body = serde_json::to_string(message)
        .map_err(|error| format!("failed to serialize MCP request: {error}"))?;
    let frame = format!("Content-Length: {}\r\n\r\n{}", body.as_bytes().len(), body);
    stdin
        .write_all(frame.as_bytes())
        .map_err(|error| format!("failed to write MCP request: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("failed to flush MCP request: {error}"))
}

fn read_stdio_response_for_id(reader: &mut impl BufRead, id: i64) -> Result<Value, String> {
    let deadline = SystemTime::now() + MCP_TEST_TIMEOUT;
    loop {
        if SystemTime::now() > deadline {
            return Err(format!("timed out waiting for MCP response id {id}"));
        }
        let value = read_stdio_frame(reader)?;
        if value.get("id").and_then(Value::as_i64) == Some(id) {
            return Ok(value);
        }
    }
}

fn read_stdio_frame(reader: &mut impl BufRead) -> Result<Value, String> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .map_err(|error| format!("failed to read MCP frame header: {error}"))?;
        if read == 0 {
            return Err("MCP server closed stdout".to_string());
        }
        let header = line.trim_end_matches(['\r', '\n']);
        if header.is_empty() {
            break;
        }
        if let Some(raw_len) = header.strip_prefix("Content-Length:") {
            content_length = Some(
                raw_len
                    .trim()
                    .parse::<usize>()
                    .map_err(|error| format!("invalid MCP content length: {error}"))?,
            );
        }
    }
    let len = content_length.ok_or_else(|| "MCP frame missing Content-Length".to_string())?;
    let mut body = vec![0_u8; len];
    reader
        .read_exact(&mut body)
        .map_err(|error| format!("failed to read MCP frame body: {error}"))?;
    serde_json::from_slice(&body).map_err(|error| format!("invalid MCP JSON response: {error}"))
}

fn probe_http_like_server(data: &Value, expect_sse: bool) -> Result<Vec<String>, String> {
    let url = value_string(data, "url");
    if url.is_empty() {
        return Err("HTTP/SSE MCP URL is required".to_string());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(MCP_TEST_TIMEOUT)
        .build()
        .map_err(|error| format!("failed to create MCP HTTP client: {error}"))?;
    let initialize = post_json_rpc(&client, data, &url, initialize_request(1), expect_sse)?;
    if initialize.get("error").is_some() {
        return Err(format!("MCP initialize failed: {initialize}"));
    }
    let _ = post_json_rpc(&client, data, &url, initialized_notification(), expect_sse);
    let tools = post_json_rpc(&client, data, &url, tools_list_request(2), expect_sse)?;
    extract_tools(&tools)
}

fn execute_http_like_tool(
    data: &Value,
    tool_name: &str,
    arguments: Value,
    expect_sse: bool,
) -> Result<Value, String> {
    let url = value_string(data, "url");
    if url.is_empty() {
        return Err("HTTP/SSE MCP URL is required".to_string());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(MCP_TEST_TIMEOUT)
        .build()
        .map_err(|error| format!("failed to create MCP HTTP client: {error}"))?;
    let initialize = post_json_rpc(&client, data, &url, initialize_request(1), expect_sse)?;
    if initialize.get("error").is_some() {
        return Err(format!("MCP initialize failed: {initialize}"));
    }
    let _ = post_json_rpc(&client, data, &url, initialized_notification(), expect_sse);
    let call = post_json_rpc(
        &client,
        data,
        &url,
        tool_call_request(2, tool_name, arguments),
        expect_sse,
    )?;
    extract_tool_result(&call)
}

fn post_json_rpc(
    client: &reqwest::blocking::Client,
    data: &Value,
    url: &str,
    body: Value,
    expect_sse: bool,
) -> Result<Value, String> {
    let mut request = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(
            reqwest::header::ACCEPT,
            if expect_sse {
                "application/json, text/event-stream"
            } else {
                "application/json"
            },
        )
        .json(&body);
    for (key, value) in value_string_map(data, "headers") {
        request = request.header(key, value);
    }
    let auth_type = value_string(data, "authType");
    let token = value_string(data, "authAccessToken");
    let fallback_token = value_string(data, "authToken");
    if auth_type.eq_ignore_ascii_case("bearer") && (!token.is_empty() || !fallback_token.is_empty())
    {
        request = request.bearer_auth(if token.is_empty() {
            fallback_token
        } else {
            token
        });
    }
    let response = request
        .send()
        .map_err(|error| format!("MCP HTTP request failed: {error}"))?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let text = response
        .text()
        .map_err(|error| format!("failed to read MCP HTTP response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "MCP HTTP request failed with status {status}: {text}"
        ));
    }
    if content_type.contains("text/event-stream")
        || text.lines().any(|line| line.starts_with("data:"))
    {
        return parse_sse_json(&text);
    }
    serde_json::from_str(&text).map_err(|error| format!("invalid MCP HTTP JSON response: {error}"))
}

fn parse_sse_json(text: &str) -> Result<Value, String> {
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(data) = trimmed.strip_prefix("data:") {
            let payload = data.trim();
            if payload.is_empty() || payload == "[DONE]" {
                continue;
            }
            return serde_json::from_str(payload)
                .map_err(|error| format!("invalid MCP SSE JSON response: {error}"));
        }
    }
    Err("MCP SSE response did not include data payload".to_string())
}

fn extract_tool_result(response: &Value) -> Result<Value, String> {
    if let Some(error) = response.get("error") {
        return Err(format!("MCP server returned error: {error}"));
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| "MCP tools/call response did not include result".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn normalize_accepts_all_supported_transports() {
        for transport in ["stdio", "http", "sse"] {
            let mut data = json!({
                "name": format!("server-{transport}"),
                "type": transport,
            });
            normalize_mcp_value(&mut data).expect("supported transport should normalize");
            assert_eq!(data.get("type").and_then(Value::as_str), Some(transport));
            assert!(data.get("createdAt").and_then(Value::as_str).is_some());
            assert!(data.get("updatedAt").and_then(Value::as_str).is_some());
        }
    }

    #[test]
    fn normalize_rejects_unknown_transport() {
        let mut data = json!({
            "name": "bad-server",
            "type": "websocket",
        });
        let err = normalize_mcp_value(&mut data).expect_err("unknown transport should fail");
        assert!(err.contains("stdio, http, or sse"));
    }

    #[test]
    fn parse_sse_json_reads_first_data_payload() {
        let parsed = parse_sse_json(
            "event: message\n\
             data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"read_file\"}]}}\n\n",
        )
        .expect("SSE payload should parse");
        assert_eq!(parsed.get("id").and_then(Value::as_i64), Some(2));
    }

    #[test]
    fn extract_tools_returns_tool_names() {
        let response = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": {
                "tools": [
                    { "name": "read_file", "description": "Read file" },
                    { "name": "write_file", "description": "Write file" }
                ]
            }
        });
        let tools = extract_tools(&response).expect("tools/list response should parse");
        assert_eq!(
            tools,
            vec!["read_file".to_string(), "write_file".to_string()]
        );
    }

    #[test]
    fn test_probe_server_discovers_stdio_mcp_tools_bits_ut() {
        let script_path = write_stdio_mcp_fixture("stdio");
        let server = json!({
            "type": "stdio",
            "command": "python3",
            "args": [script_path.to_string_lossy().to_string()]
        });

        let tools = probe_server(&server).expect("stdio MCP fixture should expose tools");

        assert_eq!(tools, vec!["stdio_fixture_tool".to_string()]);
    }

    #[test]
    fn test_probe_server_discovers_http_mcp_tools_bits_ut() {
        let url = start_http_mcp_fixture(false, "http_fixture_tool");
        let server = json!({
            "type": "http",
            "url": url,
        });

        let tools = probe_server(&server).expect("HTTP MCP fixture should expose tools");

        assert_eq!(tools, vec!["http_fixture_tool".to_string()]);
    }

    #[test]
    fn test_probe_server_discovers_sse_mcp_tools_bits_ut() {
        let url = start_http_mcp_fixture(true, "sse_fixture_tool");
        let server = json!({
            "type": "sse",
            "url": url,
        });

        let tools = probe_server(&server).expect("SSE MCP fixture should expose tools");

        assert_eq!(tools, vec!["sse_fixture_tool".to_string()]);
    }

    #[test]
    fn test_execute_stdio_mcp_tool_closes_loop_bits_ut() {
        let script_path = write_stdio_mcp_fixture("stdio-execute");
        let output = execute_tool_on_server(
            &json!({
                "type": "stdio",
                "command": "python3",
                "args": [script_path.to_string_lossy().to_string()]
            }),
            "stdio_fixture_tool",
            json!({ "query": "alpha" }),
        )
        .expect("stdio MCP fixture tool should execute");

        assert_eq!(
            output
                .get("content")
                .and_then(Value::as_array)
                .and_then(|items| {
                    items
                        .first()
                        .and_then(|item| item.get("text"))
                        .and_then(Value::as_str)
                }),
            Some("stdio_fixture_tool:alpha")
        );
    }

    #[test]
    fn test_execute_http_mcp_tool_closes_loop_bits_ut() {
        let url = start_http_mcp_fixture(false, "http_fixture_tool");
        let output = execute_tool_on_server(
            &json!({
                "type": "http",
                "url": url,
            }),
            "http_fixture_tool",
            json!({ "query": "beta" }),
        )
        .expect("HTTP MCP fixture tool should execute");

        assert_eq!(
            output
                .get("content")
                .and_then(Value::as_array)
                .and_then(|items| {
                    items
                        .first()
                        .and_then(|item| item.get("text"))
                        .and_then(Value::as_str)
                }),
            Some("http_fixture_tool:beta")
        );
    }

    #[test]
    fn test_execute_sse_mcp_tool_closes_loop_bits_ut() {
        let url = start_http_mcp_fixture(true, "sse_fixture_tool");
        let output = execute_tool_on_server(
            &json!({
                "type": "sse",
                "url": url,
            }),
            "sse_fixture_tool",
            json!({ "query": "gamma" }),
        )
        .expect("SSE MCP fixture tool should execute");

        assert_eq!(
            output
                .get("content")
                .and_then(Value::as_array)
                .and_then(|items| {
                    items
                        .first()
                        .and_then(|item| item.get("text"))
                        .and_then(Value::as_str)
                }),
            Some("sse_fixture_tool:gamma")
        );
    }

    fn write_stdio_mcp_fixture(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "peers-touch-mcp-{name}-{}.py",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_else(|_| Duration::from_secs(0))
                .as_nanos()
        ));
        let script = r#"
import json
import sys

def read_frame():
    content_length = None
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        line = line.decode("utf-8").strip()
        if not line:
            break
        if line.lower().startswith("content-length:"):
            content_length = int(line.split(":", 1)[1].strip())
    if content_length is None:
        return None
    body = sys.stdin.buffer.read(content_length)
    return json.loads(body.decode("utf-8"))

def write_frame(message):
    body = json.dumps(message, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(f"Content-Length: {len(body)}\r\n\r\n".encode("utf-8"))
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()

while True:
    request = read_frame()
    if request is None:
        break
    method = request.get("method")
    if method == "initialize":
        write_frame({
            "jsonrpc": "2.0",
            "id": request.get("id"),
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "stdio-fixture", "version": "1.0.0"}
            }
        })
    elif method == "tools/list":
        write_frame({
            "jsonrpc": "2.0",
            "id": request.get("id"),
            "result": {
                "tools": [{"name": "stdio_fixture_tool", "description": "stdio fixture tool"}]
            }
        })
    elif method == "tools/call":
        params = request.get("params", {})
        arguments = params.get("arguments", {})
        query = arguments.get("query", "")
        write_frame({
            "jsonrpc": "2.0",
            "id": request.get("id"),
            "result": {
                "content": [
                    {"type": "text", "text": f"{params.get('name', 'stdio_fixture_tool')}:{query}"}
                ],
                "isError": False
            }
        })
"#;
        fs::write(&path, script).expect("stdio MCP fixture should be written");
        path
    }

    fn start_http_mcp_fixture(use_sse: bool, tool_name: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("MCP HTTP fixture should bind");
        let address = listener
            .local_addr()
            .expect("MCP HTTP fixture should expose address");
        thread::spawn(move || {
            for _ in 0..6 {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let request = read_http_request_body(&mut stream)
                    .and_then(|body| serde_json::from_str::<Value>(&body).ok())
                    .unwrap_or_else(|| json!({}));
                let method = request
                    .get("method")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let response = match method.as_str() {
                    "initialize" => json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "result": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {"tools": {}},
                            "serverInfo": {"name": "http-fixture", "version": "1.0.0"}
                        }
                    }),
                    "tools/list" => json!({
                        "jsonrpc": "2.0",
                        "id": 2,
                        "result": {
                            "tools": [{ "name": tool_name, "description": "fixture tool" }]
                        }
                    }),
                    "tools/call" => {
                        let arguments = request
                            .get("params")
                            .and_then(|params| params.get("arguments"))
                            .cloned()
                            .unwrap_or_else(|| json!({}));
                        let query = arguments.get("query").and_then(Value::as_str).unwrap_or("");
                        json!({
                            "jsonrpc": "2.0",
                            "id": 2,
                            "result": {
                                "content": [
                                    { "type": "text", "text": format!("{tool_name}:{query}") }
                                ],
                                "isError": false
                            }
                        })
                    }
                    _ => json!({
                        "jsonrpc": "2.0",
                        "result": {}
                    }),
                };
                write_http_response(&mut stream, use_sse, &response);
            }
        });
        format!("http://{address}/mcp")
    }

    fn read_http_request_body(stream: &mut impl Read) -> Option<String> {
        let mut buffer = Vec::new();
        let mut byte = [0_u8; 1];
        while stream.read(&mut byte).ok()? == 1 {
            buffer.push(byte[0]);
            if buffer.ends_with(b"\r\n\r\n") {
                break;
            }
        }
        let headers = String::from_utf8_lossy(&buffer);
        let content_length = headers
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .and_then(|value| value.trim().parse::<usize>().ok())
            })
            .unwrap_or(0);
        let mut body = vec![0_u8; content_length];
        stream.read_exact(&mut body).ok()?;
        String::from_utf8(body).ok()
    }

    fn write_http_response(stream: &mut impl Write, use_sse: bool, response: &Value) {
        let json = serde_json::to_string(response).expect("MCP response should serialize");
        let (content_type, body) = if use_sse {
            (
                "text/event-stream",
                format!("event: message\ndata: {json}\n\n"),
            )
        } else {
            ("application/json", json)
        };
        let raw = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.as_bytes().len()
        );
        stream
            .write_all(raw.as_bytes())
            .expect("MCP HTTP fixture should respond");
    }
}
