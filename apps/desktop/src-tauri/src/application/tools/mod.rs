use crate::application::{mcp, oauth2, plugins};
use crate::contracts::{SearchPrimaryInput, StubPayload};
use crate::error::{AppResult, ErrorCode};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
    let mut tools = builtin_tool_registry_entries();
    match mcp::mcp_tool_registry_entries() {
        Ok(mut mcp_tools) => tools.append(&mut mcp_tools),
        Err(error) => {
            tracing::error!(error = %error, "Failed to project MCP tools into tool registry");
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to list MCP tools: {error}"),
                None,
            );
        }
    }
    match plugins::plugin_tool_registry_entries() {
        Ok(mut plugin_tools) => tools.append(&mut plugin_tools),
        Err(error) => {
            tracing::error!(error = %error, "Failed to project plugin tools into tool registry");
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to list plugin tools: {error}"),
                None,
            );
        }
    }
    success_payload("tools_list", json!({ "tools": tools }))
}

pub fn builtin_tool_registry_entries() -> Vec<Value> {
    vec![
        builtin_tool(
            "local_file_read",
            "filesystem",
            "Read a UTF-8 file from the approved local workspace.",
            "high",
            true,
            "desktop-rust",
            json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to the approved workspace"},
                    "max_bytes": {"type": "integer", "description": "Maximum bytes to read", "minimum": 1, "maximum": 200000}
                },
                "required": ["path"]
            }),
        ),
        builtin_tool(
            "local_workspace_list",
            "filesystem",
            "List files in a directory inside the approved local workspace.",
            "medium",
            true,
            "desktop-rust",
            json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory path relative to the approved workspace"},
                    "limit": {"type": "integer", "description": "Maximum entries", "minimum": 1, "maximum": 200}
                },
                "required": ["path"]
            }),
        ),
        builtin_tool(
            "local_clipboard_read",
            "clipboard",
            "Read plain text from the local clipboard.",
            "high",
            true,
            "desktop-rust",
            json!({"type": "object", "properties": {}}),
        ),
        builtin_tool(
            "local_clipboard_write",
            "clipboard",
            "Write plain text into the local clipboard.",
            "high",
            true,
            "desktop-rust",
            json!({
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Clipboard text to write", "maxLength": 200000}
                },
                "required": ["text"]
            }),
        ),
        builtin_tool(
            "local_shell_safe",
            "shell",
            "Run an allow-listed local workspace operation without arbitrary shell execution.",
            "high",
            true,
            "desktop-rust",
            json!({
                "type": "object",
                "properties": {
                    "operation": {"type": "string", "enum": ["pwd", "list_dir"]},
                    "path": {"type": "string", "description": "Directory path for list_dir"}
                },
                "required": ["operation"]
            }),
        ),
        builtin_tool(
            "oauth_connector_call",
            "oauth",
            "Read approved OAuth connector state through Desktop Rust without exposing credentials.",
            "high",
            true,
            "desktop-rust",
            json!({
                "type": "object",
                "properties": {
                    "provider_id": {"type": "string", "description": "OAuth provider id, such as github, google, or lark"},
                    "resource": {
                        "type": "string",
                        "enum": ["connections.list", "connection.status", "connection.profile"],
                        "description": "Safe OAuth connector resource to read"
                    },
                    "params": {"type": "object", "description": "Optional resource parameters; secret-like fields are redacted"}
                },
                "required": ["resource"]
            }),
        ),
        builtin_tool(
            "memory_search",
            "memory",
            "Search Station-backed Agent memory.",
            "low",
            false,
            "station",
            json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 20}
                },
                "required": ["query"]
            }),
        ),
        builtin_tool(
            "station_search",
            "search",
            "Search through the Station-backed search provider.",
            "medium",
            false,
            "station",
            json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "source": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 20}
                },
                "required": ["query"]
            }),
        ),
    ]
}

fn builtin_tool(
    name: &str,
    category: &str,
    description: &str,
    risk_level: &str,
    needs_approval: bool,
    execution_owner: &str,
    schema: Value,
) -> Value {
    json!({
        "name": name,
        "displayName": name,
        "description": description,
        "category": category,
        "enabled": true,
        "needs_approval": needs_approval,
        "riskLevel": risk_level,
        "executionOwner": execution_owner,
        "source": "builtin",
        "executable": execution_owner == "desktop-rust",
        "schema": schema
    })
}

pub fn execute_builtin_local_tool(
    tool_name: &str,
    arguments: Value,
    workspace_root: Option<&str>,
    call_id: Option<&str>,
) -> Result<Value, String> {
    let started = std::time::Instant::now();
    let output = match tool_name {
        "local_file_read" => execute_file_read(&arguments, workspace_root),
        "local_workspace_list" => execute_workspace_list(&arguments, workspace_root),
        "local_clipboard_read" => execute_clipboard_read(),
        "local_clipboard_write" => execute_clipboard_write(&arguments),
        "local_shell_safe" => execute_shell_safe(&arguments, workspace_root),
        "oauth_connector_call" => return oauth2::execute_oauth_connector_tool(&arguments, call_id),
        other => Err(format!("unsupported builtin local tool: {other}")),
    }?;
    Ok(json!({
        "ok": true,
        "toolName": tool_name,
        "callId": call_id.unwrap_or_default(),
        "arguments": arguments,
        "durationMs": started.elapsed().as_millis() as u64,
        "output": output,
        "audit": {
            "source": "builtin",
            "toolName": tool_name,
            "executionOwner": "desktop-rust",
            "approvalRequired": true,
            "executedAt": now_rfc3339()
        }
    }))
}

fn execute_file_read(arguments: &Value, workspace_root: Option<&str>) -> Result<Value, String> {
    let path = required_string(arguments, "path")?;
    let max_bytes = arguments
        .get("max_bytes")
        .and_then(Value::as_u64)
        .unwrap_or(64 * 1024)
        .min(200_000) as usize;
    let resolved = resolve_workspace_path(workspace_root, &path)?;
    if !resolved.is_file() {
        return Err(format!("path is not a file: {}", resolved.display()));
    }
    let bytes = fs::read(&resolved).map_err(|error| format!("failed to read file: {error}"))?;
    let truncated = bytes.len() > max_bytes;
    let slice = &bytes[..bytes.len().min(max_bytes)];
    let content = String::from_utf8_lossy(slice).to_string();
    Ok(json!({
        "path": resolved.display().to_string(),
        "content": content,
        "truncated": truncated,
        "bytesRead": slice.len()
    }))
}

fn execute_workspace_list(
    arguments: &Value,
    workspace_root: Option<&str>,
) -> Result<Value, String> {
    let path = optional_string(arguments, "path").unwrap_or_else(|| ".".to_string());
    let limit = arguments
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(100)
        .min(200) as usize;
    let resolved = resolve_workspace_path(workspace_root, &path)?;
    if !resolved.is_dir() {
        return Err(format!("path is not a directory: {}", resolved.display()));
    }
    let mut entries = Vec::new();
    for entry in
        fs::read_dir(&resolved).map_err(|error| format!("failed to list directory: {error}"))?
    {
        if entries.len() >= limit {
            break;
        }
        let entry = entry.map_err(|error| format!("failed to read directory entry: {error}"))?;
        let metadata = entry
            .metadata()
            .map_err(|error| format!("failed to read entry metadata: {error}"))?;
        entries.push(json!({
            "name": entry.file_name().to_string_lossy(),
            "path": entry.path().display().to_string(),
            "kind": if metadata.is_dir() { "directory" } else { "file" },
            "size": metadata.len()
        }));
    }
    Ok(json!({
        "path": resolved.display().to_string(),
        "entries": entries
    }))
}

fn execute_clipboard_read() -> Result<Value, String> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("native clipboard is unavailable: {error}"))?;
    let text = clipboard
        .get_text()
        .map_err(|error| format!("native clipboard read failed: {error}"))?;
    Ok(json!({ "text": text }))
}

fn execute_clipboard_write(arguments: &Value) -> Result<Value, String> {
    let text = required_string(arguments, "text")?;
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("native clipboard is unavailable: {error}"))?;
    clipboard
        .set_text(text.clone())
        .map_err(|error| format!("native clipboard write failed: {error}"))?;
    Ok(json!({ "written": true, "bytes": text.len() }))
}

fn execute_shell_safe(arguments: &Value, workspace_root: Option<&str>) -> Result<Value, String> {
    let operation = required_string(arguments, "operation")?;
    match operation.as_str() {
        "pwd" => Ok(json!({ "workspace": workspace_base(workspace_root)?.display().to_string() })),
        "list_dir" => execute_workspace_list(arguments, workspace_root),
        other => Err(format!("unsupported safe shell operation: {other}")),
    }
}

fn required_string(arguments: &Value, key: &str) -> Result<String, String> {
    optional_string(arguments, key).ok_or_else(|| format!("{key} is required"))
}

fn optional_string(arguments: &Value, key: &str) -> Option<String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn resolve_workspace_path(workspace_root: Option<&str>, path: &str) -> Result<PathBuf, String> {
    let base = workspace_base(workspace_root)?;
    let candidate = Path::new(path);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        base.join(candidate)
    };
    let normalized = joined
        .canonicalize()
        .map_err(|error| format!("failed to resolve path: {error}"))?;
    if !normalized.starts_with(&base) {
        return Err("path is outside the approved workspace".to_string());
    }
    Ok(normalized)
}

fn workspace_base(workspace_root: Option<&str>) -> Result<PathBuf, String> {
    let raw = workspace_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "workspace_root is required for local workspace tools".to_string())?;
    raw.canonicalize()
        .map_err(|error| format!("failed to resolve workspace root: {error}"))
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

    #[test]
    fn builtin_registry_exposes_policy_metadata() {
        let tools = builtin_tool_registry_entries();
        let file_tool = tools
            .iter()
            .find(|tool| tool.get("name").and_then(Value::as_str) == Some("local_file_read"))
            .expect("local_file_read should be registered");
        assert_eq!(
            file_tool.get("source").and_then(Value::as_str),
            Some("builtin")
        );
        assert_eq!(
            file_tool.get("riskLevel").and_then(Value::as_str),
            Some("high")
        );
        assert_eq!(
            file_tool.get("executionOwner").and_then(Value::as_str),
            Some("desktop-rust")
        );
        assert_eq!(
            file_tool.get("needs_approval").and_then(Value::as_bool),
            Some(true)
        );
        assert!(file_tool.get("schema").is_some());

        let oauth_tool = tools
            .iter()
            .find(|tool| tool.get("name").and_then(Value::as_str) == Some("oauth_connector_call"))
            .expect("oauth_connector_call should be registered");
        assert_eq!(
            oauth_tool.get("executionOwner").and_then(Value::as_str),
            Some("desktop-rust")
        );
        assert_eq!(
            oauth_tool.get("needs_approval").and_then(Value::as_bool),
            Some(true)
        );

        let memory_tool = tools
            .iter()
            .find(|tool| tool.get("name").and_then(Value::as_str) == Some("memory_search"))
            .expect("memory_search should be registered");
        assert_eq!(
            memory_tool.get("executionOwner").and_then(Value::as_str),
            Some("station")
        );
        assert_eq!(
            memory_tool.get("needs_approval").and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn local_file_read_is_sandboxed_to_workspace() {
        let base = unique_temp_dir("agent-tools-sandbox");
        fs::create_dir_all(&base).expect("temp workspace should be created");
        fs::write(base.join("allowed.txt"), "allowed").expect("allowed file should be written");

        let result = execute_builtin_local_tool(
            "local_file_read",
            json!({"path": "allowed.txt"}),
            Some(base.to_str().expect("temp path should be utf8")),
            Some("call_1"),
        )
        .expect("workspace file should be readable");
        assert_eq!(result.get("ok").and_then(Value::as_bool), Some(true));
        assert_eq!(
            result
                .get("output")
                .and_then(|output| output.get("content"))
                .and_then(Value::as_str),
            Some("allowed")
        );

        let outside = base
            .parent()
            .expect("temp workspace should have parent")
            .join("outside-agent-tools.txt");
        fs::write(&outside, "outside").expect("outside file should be written");
        let denied = execute_builtin_local_tool(
            "local_file_read",
            json!({"path": outside.display().to_string()}),
            Some(base.to_str().expect("temp path should be utf8")),
            Some("call_2"),
        );
        assert!(denied
            .expect_err("outside file must be denied")
            .contains("outside the approved workspace"));

        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(base);
    }

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_else(|_| Duration::from_secs(0))
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{nanos}"))
    }
}
