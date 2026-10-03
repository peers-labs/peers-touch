use crate::contracts::{
    McpCreateInput, McpExecuteToolInput, McpNameInput, McpToggleInput, McpUpdateInput, StubPayload,
};
use crate::domain::storage::database::{DatabaseOpenSpec, EncryptionLevel};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::storage;
use crate::infrastructure::storage::key_provider::PlatformKeyProvider;
use crate::model::agent::{
    DeleteMcpServerRequest, DeleteMcpServerResponse, GetMcpServerRequest, GetMcpServerResponse,
    ListMcpServersRequest, ListMcpServersResponse, McpServer, McpServerSecrets, McpServerStatus,
    McpToolDescriptor, McpTransport, RefreshMcpServerRequest, RefreshMcpServerResponse,
    ToolExecutionOwner, UpsertMcpServerRequest, UpsertMcpServerResponse,
};
use reqwest::Method;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

mod station_projection;
pub use station_projection::*;

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
const MCP_TEST_TIMEOUT: Duration = Duration::from_secs(8);
const MCP_RESERVED_ENV_PREFIX: &str = "PEERS_TOUCH_";
const MCP_MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const MCP_MAX_HTTP_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;
const MCP_STORE_SCHEMA_VERSION: i32 = 1;
const MCP_CONFIG_REVISION_KEY: &str = "configRevision";
const MCP_SERVER_LIST_PATH: &str = "/sub-agent/agent/mcp/server/list";
const MCP_SERVER_GET_PATH: &str = "/sub-agent/agent/mcp/server/get";
const MCP_SERVER_UPSERT_PATH: &str = "/sub-agent/agent/mcp/server/upsert";
const MCP_SERVER_REFRESH_PATH: &str = "/sub-agent/agent/mcp/server/refresh";
const MCP_SERVER_DELETE_PATH: &str = "/sub-agent/agent/mcp/server/delete";

#[derive(Clone, Default)]
struct McpToolExecutionPolicy {
    workspace_root: Option<PathBuf>,
    allowed_roots: Vec<PathBuf>,
}

#[derive(Clone)]
struct McpServerRecord {
    name: String,
    data: Value,
    enabled: bool,
}

struct McpStore {
    actor_ptid: String,
    servers: Vec<McpServerRecord>,
}

#[derive(Clone)]
struct McpServerSnapshot {
    index: Option<usize>,
    record: Option<McpServerRecord>,
}

impl McpStore {
    fn load(actor_ptid: &str) -> Result<Self, String> {
        let actor_ptid = require_actor_ptid(actor_ptid)?;
        let connection = mcp_store_connection(&actor_ptid)?;
        let content = connection
            .query_row(
                "SELECT payload FROM mcp_store_state WHERE singleton = 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("read encrypted MCP store: {error}"))?;
        let raw_servers = match content {
            Some(content) => serde_json::from_str::<Vec<Value>>(&content)
                .map_err(|error| format!("parse encrypted MCP store: {error}"))?,
            None => migrate_legacy_store(&connection)?,
        };
        let mut servers = raw_servers
            .into_iter()
            .map(record_from_value)
            .collect::<Result<Vec<_>, _>>()?;
        let runtime_epoch = mcp_runtime_epoch();
        let mut changed = false;
        for server in &mut servers {
            let Some(data) = server.data.as_object_mut() else {
                continue;
            };
            if data.get("status").and_then(Value::as_str) == Some("connected")
                && data.get("runtimeEpoch").and_then(Value::as_str) != Some(runtime_epoch)
            {
                data.insert("status".to_string(), json!("disconnected"));
                data.insert("lastError".to_string(), json!("MCP_RUNTIME_RESTARTED"));
                changed = true;
            }
        }
        let store = Self {
            actor_ptid,
            servers,
        };
        if changed {
            persist_store(&store)?;
        }
        Ok(store)
    }
}

static MCP_STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static MCP_RUNTIME_EPOCH: OnceLock<String> = OnceLock::new();
static MCP_PROJECTION_EPOCH: AtomicU64 = AtomicU64::new(1);
struct ManagedMcpChild {
    child: Arc<Mutex<Child>>,
}

impl ManagedMcpChild {
    fn new(child: Child) -> Self {
        Self {
            child: Arc::new(Mutex::new(child)),
        }
    }

    fn take_stdio(&self) -> Result<(ChildStdin, ChildStdout), String> {
        let mut child = self
            .child
            .lock()
            .map_err(|error| format!("lock active MCP child: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to open MCP server stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to open MCP server stdout".to_string())?;
        Ok((stdin, stdout))
    }

    fn terminate(&self) -> Result<(), String> {
        let mut child = self
            .child
            .lock()
            .map_err(|error| format!("lock active MCP child: {error}"))?;
        let result = terminate_child(&mut child);
        drop(child);
        result
    }
}

impl Drop for ManagedMcpChild {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}

fn terminate_child(child: &mut Child) -> Result<(), String> {
    match child
        .try_wait()
        .map_err(|error| format!("inspect MCP child process: {error}"))?
    {
        Some(_) => Ok(()),
        None => {
            child
                .kill()
                .map_err(|error| format!("terminate MCP child process: {error}"))?;
            child
                .wait()
                .map_err(|error| format!("reap MCP child process: {error}"))?;
            Ok(())
        }
    }
}

fn mcp_store_lock() -> &'static Mutex<()> {
    MCP_STORE_LOCK.get_or_init(|| Mutex::new(()))
}

fn mcp_runtime_epoch() -> &'static str {
    MCP_RUNTIME_EPOCH
        .get_or_init(|| format!("mcp-runtime-{}", ulid::Ulid::new()))
        .as_str()
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

fn require_actor_ptid(actor_ptid: &str) -> Result<String, String> {
    let actor_ptid = actor_ptid.trim();
    if !actor_ptid.starts_with("ptid:") {
        return Err("MCP store requires an authenticated actor PTID".to_string());
    }
    Ok(actor_ptid.to_string())
}

fn mcp_store_spec(actor_ptid: &str) -> Result<DatabaseOpenSpec, String> {
    let actor_ptid = require_actor_ptid(actor_ptid)?;
    let app_name = std::env::var("PT_PROFILE")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "desktop".to_string());
    Ok(DatabaseOpenSpec {
        app_name: app_name.clone(),
        domain: "agent-mcp".to_string(),
        profile: "main".to_string(),
        user_scope: actor_ptid.clone(),
        encryption_level: EncryptionLevel::L2,
        key_ref: format!("agent-mcp/{app_name}/{}", scope_hash(&actor_ptid)),
        schema_version: MCP_STORE_SCHEMA_VERSION,
    })
}

fn mcp_store_connection(actor_ptid: &str) -> Result<rusqlite::Connection, String> {
    let spec = mcp_store_spec(actor_ptid)?;
    let connection = storage::open_database(&spec, PlatformKeyProvider::shared())
        .map_err(|error| format!("open encrypted MCP store: {error}"))?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS mcp_store_state (
                singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                payload TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL
             );",
        )
        .map_err(|error| format!("initialize encrypted MCP store: {error}"))?;
    Ok(connection)
}

fn legacy_mcp_store_path() -> Result<PathBuf, String> {
    let dir = storage::app_file_path(
        "desktop",
        crate::infrastructure::storage::StorageKind::Data,
        &["mcp"],
    )
    .map_err(|error| format!("resolve legacy MCP store directory: {error:?}"))?;
    Ok(dir.join("servers.json"))
}

fn migrate_legacy_store(connection: &rusqlite::Connection) -> Result<Vec<Value>, String> {
    let path = legacy_mcp_store_path()?;
    let values = match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str::<Vec<Value>>(&content)
            .map_err(|error| format!("parse legacy MCP store: {error}"))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(format!("read legacy MCP store: {error}")),
    };
    if values.is_empty() {
        return Ok(values);
    }
    let values = values
        .into_iter()
        .map(record_from_value)
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|record| record.data)
        .collect::<Vec<_>>();
    let payload = serde_json::to_string(&values)
        .map_err(|error| format!("serialize legacy MCP store migration: {error}"))?;
    connection
        .execute(
            "INSERT INTO mcp_store_state(singleton, payload, updated_at_ms)
             VALUES(1, ?1, ?2)
             ON CONFLICT(singleton) DO UPDATE
             SET payload = excluded.payload, updated_at_ms = excluded.updated_at_ms",
            params![payload, now_unix_ms()],
        )
        .map_err(|error| format!("commit legacy MCP store migration: {error}"))?;
    fs::remove_file(&path).map_err(|error| format!("remove legacy MCP store: {error}"))?;
    Ok(values)
}

fn persist_store(store: &McpStore) -> Result<(), String> {
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
    let content = serde_json::to_string(&values)
        .map_err(|error| format!("failed to serialize MCP store: {error}"))?;
    let mut connection = mcp_store_connection(&store.actor_ptid)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("begin encrypted MCP store transaction: {error}"))?;
    transaction
        .execute(
            "INSERT INTO mcp_store_state(singleton, payload, updated_at_ms)
             VALUES(1, ?1, ?2)
             ON CONFLICT(singleton) DO UPDATE
             SET payload = excluded.payload, updated_at_ms = excluded.updated_at_ms",
            params![content, now_unix_ms()],
        )
        .map_err(|error| format!("write encrypted MCP store: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("commit encrypted MCP store: {error}"))?;
    MCP_PROJECTION_EPOCH.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

pub(crate) fn mcp_projection_epoch() -> u64 {
    MCP_PROJECTION_EPOCH.load(Ordering::SeqCst)
}

fn persist_error(error: impl std::fmt::Display) -> AppResult<StubPayload> {
    tracing::error!(error = %error, "Failed to persist MCP store");
    AppResult::fail(
        ErrorCode::InternalError,
        format!("Failed to persist MCP store: {error}"),
        None,
    )
}

fn snapshot_server(actor_ptid: &str, server_name: &str) -> Result<McpServerSnapshot, String> {
    let _lock = mcp_store_lock()
        .lock()
        .map_err(|error| format!("lock encrypted MCP store: {error}"))?;
    let store = McpStore::load(actor_ptid)?;
    let index = store
        .servers
        .iter()
        .position(|server| server.name == server_name);
    Ok(McpServerSnapshot {
        index,
        record: index.map(|index| store.servers[index].clone()),
    })
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

fn load_store(actor_ptid: &str) -> Result<McpStore, AppResult<StubPayload>> {
    McpStore::load(actor_ptid).map_err(store_lock_error)
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
    obj.entry("serverId".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("executionOwner".to_string())
        .or_insert_with(|| json!("client"));
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
    obj.entry("runtimeEpoch".to_string())
        .or_insert_with(|| json!(""));
    obj.entry(MCP_CONFIG_REVISION_KEY.to_string())
        .or_insert_with(|| json!(1));
    obj.entry("createdAt".to_string())
        .or_insert_with(|| json!(now.clone()));
    obj.insert("updatedAt".to_string(), json!(now));
    Ok(())
}

fn now_rfc3339() -> String {
    let unix = now_unix_ms() / 1_000;
    let dt =
        time::OffsetDateTime::from_unix_timestamp(unix).unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    dt.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn scope_hash(value: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(value.as_bytes()))
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

fn validate_stdio_execution_policy(
    command: &str,
    args: &[String],
    env: &[(String, String)],
) -> Result<(), String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("stdio MCP command is required".to_string());
    }
    reject_control_chars("stdio MCP command", command)?;
    let executable = std::path::Path::new(command)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(command)
        .to_ascii_lowercase();
    if matches!(
        executable.as_str(),
        "sh" | "bash" | "zsh" | "fish" | "cmd" | "powershell" | "pwsh"
    ) {
        return Err("stdio MCP command must not execute through a shell".to_string());
    }
    for arg in args {
        reject_control_chars("stdio MCP argument", arg)?;
    }
    for (key, value) in env {
        if key.trim().is_empty() {
            return Err("stdio MCP env key must not be empty".to_string());
        }
        reject_control_chars("stdio MCP env key", key)?;
        reject_control_chars("stdio MCP env value", value)?;
        if key.contains('=') {
            return Err("stdio MCP env key must not contain '='".to_string());
        }
        if key
            .to_ascii_uppercase()
            .starts_with(MCP_RESERVED_ENV_PREFIX)
        {
            return Err(format!(
                "stdio MCP env key must not override reserved {MCP_RESERVED_ENV_PREFIX} variables"
            ));
        }
    }
    Ok(())
}

fn validate_http_execution_policy(
    url: &str,
    headers: &[(String, String)],
) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| format!("invalid MCP URL: {error}"))?;
    if parsed.username() != "" || parsed.password().is_some() {
        return Err("MCP URL must not embed credentials".to_string());
    }
    let scheme = parsed.scheme();
    let host = parsed
        .host_str()
        .ok_or_else(|| "MCP URL must include a host".to_string())?;
    let is_loopback = is_loopback_host(host);
    match scheme {
        "https" => {}
        "http" if is_loopback => {}
        "http" => return Err("HTTP MCP transport only allows http for loopback hosts".to_string()),
        _ => return Err("MCP URL scheme must be https or loopback http".to_string()),
    }
    if is_blocked_literal_ip(host) && !is_loopback {
        return Err("MCP URL must not target private, link-local, or metadata IPs".to_string());
    }
    for (key, value) in headers {
        if key.trim().is_empty() {
            return Err("MCP header name must not be empty".to_string());
        }
        reject_control_chars("MCP header name", key)?;
        reject_control_chars("MCP header value", value)?;
    }
    Ok(parsed)
}

fn reject_control_chars(label: &str, value: &str) -> Result<(), String> {
    if value
        .chars()
        .any(|ch| ch == '\0' || ch == '\n' || ch == '\r')
    {
        return Err(format!("{label} must not contain control characters"));
    }
    Ok(())
}

fn is_loopback_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.parse::<IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

fn is_blocked_literal_ip(host: &str) -> bool {
    let Ok(ip) = host.parse::<IpAddr>() else {
        return false;
    };
    match ip {
        IpAddr::V4(ip) => {
            let octets = ip.octets();
            ip.is_private()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_unspecified()
                || matches!(
                    octets,
                    [192, 0, 2, _] | [198, 51, 100, _] | [203, 0, 113, _]
                )
                || octets == [169, 254, 169, 254]
        }
        IpAddr::V6(ip) => {
            let segments = ip.segments();
            ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        }
    }
}

pub(crate) fn mcp_client_capability_contracts(
    actor_ptid: &str,
) -> Result<Vec<(String, String)>, String> {
    let _lock = mcp_store_lock()
        .lock()
        .map_err(|error| format!("failed to access MCP store: {error}"))?;
    let store = McpStore::load(actor_ptid)?;
    let mut contracts = Vec::new();
    for server in store
        .servers
        .iter()
        .filter(|server| server.enabled && value_string(&server.data, "executionOwner") == "client")
    {
        let tools = server
            .data
            .get("tools")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for tool in tools {
            let capability_id = tool
                .get("capabilityId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let capability_version = tool
                .get("capabilityVersion")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if capability_id.is_empty() || capability_version.is_empty() {
                continue;
            }
            contracts.push((capability_id.to_string(), capability_version.to_string()));
        }
    }
    contracts.sort();
    contracts.dedup();
    Ok(contracts)
}

pub fn mcp_execute_tool(actor_ptid: &str, input: McpExecuteToolInput) -> AppResult<StubPayload> {
    let server_name = input.server_name.trim();
    let tool_name = input.tool_name.trim();
    if server_name.is_empty() {
        return invalid_argument("server_name is required");
    }
    if tool_name.is_empty() {
        return invalid_argument("tool_name is required");
    }
    let record = {
        let _lock = match mcp_store_lock().lock() {
            Ok(lock) => lock,
            Err(error) => return store_lock_error(error),
        };
        let store = match load_store(actor_ptid) {
            Ok(store) => store,
            Err(error) => return error,
        };
        let Some(item) = store.servers.iter().find(|item| item.name == server_name) else {
            return AppResult::fail(ErrorCode::NotFound, "MCP server not found", None);
        };
        if !item.enabled {
            return AppResult::fail(ErrorCode::InvalidArgument, "MCP server is disabled", None);
        }
        item.clone()
    };
    let started_at = SystemTime::now();
    let arguments = input.arguments.unwrap_or_else(|| json!({}));
    let policy = match mcp_execution_policy(
        input.workspace_root.as_deref(),
        input.allowed_roots.as_deref(),
    ) {
        Ok(policy) => policy,
        Err(error) => return invalid_argument(&error),
    };
    let result = validate_tool_arguments_policy(&arguments, &policy)
        .and_then(|_| execute_tool_on_server(&record.data, tool_name, arguments.clone(), &policy));
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
                    "workspaceRoot": policy.workspace_root.as_ref().map(|path| path.display().to_string()).unwrap_or_default(),
                    "allowedRootCount": policy.allowed_roots.len(),
                    "policyDecision": "allow",
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
                    "workspaceRoot": policy.workspace_root.as_ref().map(|path| path.display().to_string()).unwrap_or_default(),
                    "allowedRootCount": policy.allowed_roots.len(),
                    "policyDecision": "deny",
                    "executedAt": now_rfc3339()
                }
            }),
        ),
    }
}

pub fn mcp_execute_capability(
    actor_ptid: &str,
    capability_id: &str,
    arguments: Value,
    call_id: Option<String>,
    workspace_root: Option<String>,
    allowed_roots: Option<Vec<String>>,
) -> AppResult<StubPayload> {
    let resolved = {
        let _lock = match mcp_store_lock().lock() {
            Ok(lock) => lock,
            Err(error) => return store_lock_error(error),
        };
        let store = match load_store(actor_ptid) {
            Ok(store) => store,
            Err(error) => return error,
        };
        store
            .servers
            .iter()
            .filter(|server| {
                server.enabled && value_string(&server.data, "executionOwner") == "client"
            })
            .find_map(|server| {
                server
                    .data
                    .get("tools")
                    .and_then(Value::as_array)
                    .and_then(|tools| {
                        tools.iter().find_map(|tool| {
                            (tool.get("capabilityId").and_then(Value::as_str)
                                == Some(capability_id))
                            .then(|| {
                                (
                                    server.name.clone(),
                                    tool.get("name")
                                        .and_then(Value::as_str)
                                        .unwrap_or_default()
                                        .to_string(),
                                )
                            })
                        })
                    })
            })
    };
    let Some((server_name, tool_name)) = resolved else {
        return AppResult::fail(
            ErrorCode::NotFound,
            "CLIENT_CAPABILITY_MCP_TOOL_NOT_FOUND",
            None,
        );
    };
    mcp_execute_tool(
        actor_ptid,
        McpExecuteToolInput {
            server_name,
            tool_name,
            arguments: Some(arguments),
            call_id,
            workspace_root,
            allowed_roots,
        },
    )
}

fn validate_server_configuration(data: &Value) -> Result<(), String> {
    match value_string(data, "type").as_str() {
        "stdio" => validate_stdio_execution_policy(
            &value_string(data, "command"),
            &value_string_array(data, "args"),
            &value_string_map(data, "env"),
        ),
        "http" | "sse" => validate_http_execution_policy(
            &value_string(data, "url"),
            &value_string_map(data, "headers"),
        )
        .map(|_| ()),
        other => Err(format!("unsupported MCP transport: {other}")),
    }
}

fn redact_mcp_error(error: &str, data: &Value) -> String {
    let mut redacted = error.to_string();
    for key in ["env", "headers"] {
        for (_, value) in value_string_map(data, key) {
            if !value.is_empty() {
                redacted = redacted.replace(&value, "[REDACTED]");
            }
        }
    }
    for key in ["authToken", "authAccessToken"] {
        let value = value_string(data, key);
        if !value.is_empty() {
            redacted = redacted.replace(&value, "[REDACTED]");
        }
    }
    redacted
}

fn probe_server(data: &Value) -> Result<Vec<McpToolDescriptor>, String> {
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

fn extract_tools(response: &Value) -> Result<Vec<McpToolDescriptor>, String> {
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
        .filter_map(|tool| {
            let name = tool.get("name").and_then(Value::as_str)?.trim();
            if name.is_empty() {
                return None;
            }
            let input_schema = tool
                .get("inputSchema")
                .cloned()
                .unwrap_or_else(|| json!({"type": "object", "properties": {}}));
            Some(McpToolDescriptor {
                tool_name: name.to_string(),
                description: tool
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
                input_schema_json: serde_json::to_string(&input_schema)
                    .unwrap_or_else(|_| r#"{"type":"object","properties":{}}"#.to_string()),
                ..Default::default()
            })
        })
        .collect())
}

fn mcp_execution_policy(
    workspace_root: Option<&str>,
    allowed_roots: Option<&[String]>,
) -> Result<McpToolExecutionPolicy, String> {
    let Some(raw_workspace_root) = workspace_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(McpToolExecutionPolicy::default());
    };
    let workspace_root = canonicalize_policy_root(raw_workspace_root, "workspace_root")?;
    let mut roots = vec![workspace_root.clone()];
    for raw_root in allowed_roots.into_iter().flatten() {
        let raw_root = raw_root.trim();
        if raw_root.is_empty() {
            continue;
        }
        let root = canonicalize_policy_root(raw_root, "allowed_roots")?;
        if !roots.iter().any(|existing| existing == &root) {
            roots.push(root);
        }
    }
    Ok(McpToolExecutionPolicy {
        workspace_root: Some(workspace_root),
        allowed_roots: roots,
    })
}

fn canonicalize_policy_root(raw_path: &str, label: &str) -> Result<PathBuf, String> {
    reject_control_chars(label, raw_path)?;
    let path = Path::new(raw_path);
    if !path.is_absolute() {
        return Err(format!("{label} must be an absolute path"));
    }
    path.canonicalize()
        .map_err(|error| format!("failed to canonicalize {label}: {error}"))
}

fn validate_tool_arguments_policy(
    value: &Value,
    policy: &McpToolExecutionPolicy,
) -> Result<(), String> {
    let Some(workspace_root) = &policy.workspace_root else {
        return Ok(());
    };
    match value {
        Value::String(raw) => validate_potential_path_argument(raw, workspace_root, policy),
        Value::Array(items) => {
            for item in items {
                validate_tool_arguments_policy(item, policy)?;
            }
            Ok(())
        }
        Value::Object(map) => {
            for item in map.values() {
                validate_tool_arguments_policy(item, policy)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn validate_potential_path_argument(
    raw_value: &str,
    workspace_root: &Path,
    policy: &McpToolExecutionPolicy,
) -> Result<(), String> {
    let value = raw_value.trim();
    if value.is_empty() || value.contains("://") || value.starts_with("i18n:") {
        return Ok(());
    }
    let candidate = Path::new(value);
    let looks_path_like = candidate.is_absolute()
        || value.starts_with("./")
        || value.starts_with("../")
        || value.contains('/')
        || value.contains('\\');
    if !looks_path_like {
        return Ok(());
    }
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        workspace_root.join(candidate)
    };
    let resolved = canonicalize_existing_or_parent(&joined)?;
    if policy
        .allowed_roots
        .iter()
        .any(|root| resolved.starts_with(root))
    {
        return Ok(());
    }
    Err(format!(
        "MCP tool argument path is outside allowed roots: {}",
        joined.display()
    ))
}

fn canonicalize_existing_or_parent(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return path
            .canonicalize()
            .map_err(|error| format!("failed to canonicalize MCP argument path: {error}"));
    }
    let mut current = path;
    while let Some(parent) = current.parent() {
        if parent.exists() {
            return parent
                .canonicalize()
                .map_err(|error| format!("failed to canonicalize MCP argument parent: {error}"));
        }
        current = parent;
    }
    Err("MCP argument path has no existing parent".to_string())
}

fn execute_tool_on_server(
    data: &Value,
    tool_name: &str,
    arguments: Value,
    policy: &McpToolExecutionPolicy,
) -> Result<Value, String> {
    match value_string(data, "type").as_str() {
        "stdio" => execute_stdio_tool(data, tool_name, arguments, policy),
        "http" => execute_http_like_tool(data, tool_name, arguments, false),
        "sse" => execute_http_like_tool(data, tool_name, arguments, true),
        other => Err(format!("unsupported MCP transport: {other}")),
    }
}

fn probe_stdio_server(data: &Value) -> Result<Vec<McpToolDescriptor>, String> {
    let command = value_string(data, "command");
    let args = value_string_array(data, "args");
    let env = value_string_map(data, "env");
    validate_stdio_execution_policy(&command, &args, &env)?;
    let child = Command::new(command)
        .args(&args)
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .envs(env.iter().map(|(key, value)| (key, value)))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("failed to spawn stdio MCP server: {error}"))?;
    let child = ManagedMcpChild::new(child);
    let (mut stdin, stdout) = child.take_stdio()?;
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
    child.terminate()?;
    result
}

fn execute_stdio_tool(
    data: &Value,
    tool_name: &str,
    arguments: Value,
    policy: &McpToolExecutionPolicy,
) -> Result<Value, String> {
    let command = value_string(data, "command");
    let args = value_string_array(data, "args");
    let env = value_string_map(data, "env");
    validate_stdio_execution_policy(&command, &args, &env)?;
    let mut command_builder = Command::new(command);
    command_builder
        .args(&args)
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .envs(env.iter().map(|(key, value)| (key, value)))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(workspace_root) = &policy.workspace_root {
        command_builder
            .current_dir(workspace_root)
            .env("PEERS_TOUCH_AGENT_WORKSPACE", workspace_root)
            .env(
                "PEERS_TOUCH_ALLOWED_ROOTS",
                policy
                    .allowed_roots
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(":"),
            );
    }
    let mut child = command_builder
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
    let mut body = serde_json::to_string(message)
        .map_err(|error| format!("failed to serialize MCP request: {error}"))?;
    body.push('\n');
    stdin
        .write_all(body.as_bytes())
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
    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .map_err(|error| format!("failed to read MCP message: {error}"))?;
        if read == 0 {
            return Err("MCP server closed stdout".to_string());
        }
        if line.len() > MCP_MAX_FRAME_BYTES {
            return Err(format!("MCP message exceeds {MCP_MAX_FRAME_BYTES} bytes"));
        }
        let body = line.trim();
        if body.is_empty() {
            continue;
        }
        return serde_json::from_str(body)
            .map_err(|error| format!("invalid MCP JSON response: {error}"));
    }
}

fn probe_http_like_server(
    data: &Value,
    expect_sse: bool,
) -> Result<Vec<McpToolDescriptor>, String> {
    let url = value_string(data, "url");
    if url.is_empty() {
        return Err("HTTP/SSE MCP URL is required".to_string());
    }
    let headers = value_string_map(data, "headers");
    validate_http_execution_policy(&url, &headers)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(MCP_TEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
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
    let headers = value_string_map(data, "headers");
    validate_http_execution_policy(&url, &headers)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(MCP_TEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
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
    let headers = value_string_map(data, "headers");
    let parsed_url = validate_http_execution_policy(url, &headers)?;
    let mut request = client
        .post(parsed_url)
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
    for (key, value) in headers {
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
    let mut text = String::new();
    response
        .take(MCP_MAX_HTTP_RESPONSE_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|error| format!("failed to read MCP HTTP response: {error}"))?;
    if text.len() as u64 > MCP_MAX_HTTP_RESPONSE_BYTES {
        return Err(format!(
            "MCP HTTP response exceeds {MCP_MAX_HTTP_RESPONSE_BYTES} bytes"
        ));
    }
    if !status.is_success() {
        return Err(format!("MCP HTTP request failed with status {status}"));
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
    fn mcp_store_spec_is_actor_scoped_and_encrypted() {
        let alice = mcp_store_spec("ptid:person:alice").expect("alice MCP store spec");
        let bob = mcp_store_spec("ptid:person:bob").expect("bob MCP store spec");

        assert_eq!(alice.encryption_level, EncryptionLevel::L2);
        assert_eq!(alice.domain, "agent-mcp");
        assert_ne!(alice.user_scope, bob.user_scope);
        assert_ne!(alice.key_ref, bob.key_ref);
    }

    #[test]
    fn stdio_execution_policy_rejects_shell_wrappers() {
        let err = validate_stdio_execution_policy("sh", &["-c".to_string()], &[])
            .expect_err("shell wrappers should be rejected");

        assert!(err.contains("shell"));
    }

    #[test]
    fn stdio_execution_policy_rejects_reserved_env() {
        let err = validate_stdio_execution_policy(
            "python3",
            &[],
            &[("PEERS_TOUCH_AGENT_ID".to_string(), "override".to_string())],
        )
        .expect_err("reserved env should be rejected");

        assert!(err.contains("reserved"));
    }

    #[test]
    fn http_execution_policy_allows_loopback_http() {
        let parsed =
            validate_http_execution_policy("http://127.0.0.1:3030/mcp", &[]).expect("loopback ok");

        assert_eq!(parsed.scheme(), "http");
    }

    #[test]
    fn http_execution_policy_rejects_public_http() {
        let err = validate_http_execution_policy("http://example.com/mcp", &[])
            .expect_err("public http should be rejected");

        assert!(err.contains("loopback"));
    }

    #[test]
    fn http_execution_policy_rejects_private_literal_ip() {
        let err = validate_http_execution_policy("https://192.168.1.10/mcp", &[])
            .expect_err("private literal IP should be rejected");

        assert!(err.contains("private"));
    }

    #[test]
    fn http_execution_policy_rejects_header_injection() {
        let err = validate_http_execution_policy(
            "https://example.com/mcp",
            &[("X-Test\nInjected".to_string(), "value".to_string())],
        )
        .expect_err("header control chars should be rejected");

        assert!(err.contains("control"));
    }

    #[test]
    fn mcp_tool_policy_allows_workspace_relative_paths() {
        let workspace = std::env::temp_dir().join(format!(
            "peers-touch-mcp-policy-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_else(|_| Duration::from_secs(0))
                .as_nanos()
        ));
        fs::create_dir_all(&workspace).expect("workspace should be created");
        let policy = mcp_execution_policy(
            Some(&workspace.to_string_lossy()),
            Some(&Vec::<String>::new()),
        )
        .expect("policy should build");

        validate_tool_arguments_policy(&json!({ "path": "notes/today.md" }), &policy)
            .expect("workspace-relative paths should be allowed");

        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn mcp_tool_policy_rejects_absolute_paths_outside_allowed_roots() {
        let workspace = std::env::temp_dir().join(format!(
            "peers-touch-mcp-policy-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_else(|_| Duration::from_secs(0))
                .as_nanos()
        ));
        fs::create_dir_all(&workspace).expect("workspace should be created");
        let policy = mcp_execution_policy(
            Some(&workspace.to_string_lossy()),
            Some(&Vec::<String>::new()),
        )
        .expect("policy should build");

        let err = validate_tool_arguments_policy(&json!({ "path": "/etc/hosts" }), &policy)
            .expect_err("absolute path outside roots should be rejected");
        assert!(err.contains("outside allowed roots"));

        let _ = fs::remove_dir_all(workspace);
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
    fn extract_tools_preserves_tool_contracts() {
        let response = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": {
                "tools": [
                    {
                        "name": "read_file",
                        "description": "Read file",
                        "inputSchema": {"type": "object", "required": ["path"]}
                    },
                    { "name": "write_file", "description": "Write file" }
                ]
            }
        });
        let tools = extract_tools(&response).expect("tools/list response should parse");
        assert_eq!(tools[0].tool_name, "read_file");
        assert_eq!(tools[0].description, "Read file");
        assert!(tools[0].input_schema_json.contains("\"path\""));
        assert_eq!(tools[1].tool_name, "write_file");
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

        assert_eq!(tools[0].tool_name, "stdio_fixture_tool");
    }

    #[test]
    fn test_probe_server_discovers_http_mcp_tools_bits_ut() {
        let url = start_http_mcp_fixture(false, "http_fixture_tool");
        let server = json!({
            "type": "http",
            "url": url,
        });

        let tools = probe_server(&server).expect("HTTP MCP fixture should expose tools");

        assert_eq!(tools[0].tool_name, "http_fixture_tool");
    }

    #[test]
    fn test_probe_server_discovers_sse_mcp_tools_bits_ut() {
        let url = start_http_mcp_fixture(true, "sse_fixture_tool");
        let server = json!({
            "type": "sse",
            "url": url,
        });

        let tools = probe_server(&server).expect("SSE MCP fixture should expose tools");

        assert_eq!(tools[0].tool_name, "sse_fixture_tool");
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
            &McpToolExecutionPolicy::default(),
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
    fn client_mcp_capability_uses_station_assigned_tool_identity() {
        let actor_ptid = format!("ptid:person:mcp-dynamic-{}", ulid::Ulid::new());
        let script_path = write_stdio_mcp_fixture("stdio-capability");
        let capability_id = format!("mcp.tool.{}", "a".repeat(64));
        let data = json!({
            "serverId": "server-client-runtime",
            "name": "client-runtime",
            "type": "stdio",
            "executionOwner": "client",
            "command": "python3",
            "args": [script_path.to_string_lossy().to_string()],
            "enabled": true,
            "tools": [{
                "name": "stdio_fixture_tool",
                "providerToolName": "mcp_fixture_stdio",
                "capabilityId": capability_id,
                "capabilityVersion": "3"
            }]
        });
        station_projection::upsert_client_executor_projection(&actor_ptid, data)
            .expect("persist client MCP executor projection");

        let contracts =
            mcp_client_capability_contracts(&actor_ptid).expect("load MCP capability contracts");
        assert_eq!(contracts, vec![(capability_id.clone(), "3".to_string())]);

        let result = mcp_execute_capability(
            &actor_ptid,
            &capability_id,
            json!({"query": "desktop-local"}),
            Some("tool-call-client-mcp".to_string()),
            None,
            Some(Vec::new()),
        );
        assert!(
            result.ok,
            "dynamic MCP capability failed: {:?}",
            result.error
        );
        let payload = result.data.expect("dynamic MCP result payload");
        let value: Value =
            serde_json::from_str(&payload.status).expect("decode dynamic MCP result");
        assert_eq!(
            value
                .get("output")
                .and_then(|output| output.get("content"))
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("text"))
                .and_then(Value::as_str),
            Some("stdio_fixture_tool:desktop-local")
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
            &McpToolExecutionPolicy::default(),
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
            &McpToolExecutionPolicy::default(),
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
    line = sys.stdin.buffer.readline()
    if not line:
        return None
    return json.loads(line.decode("utf-8"))

def write_frame(message):
    body = json.dumps(message, separators=(",", ":")).encode("utf-8") + b"\n"
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
