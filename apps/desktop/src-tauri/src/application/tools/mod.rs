use crate::application::plugins;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
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

pub fn tools_list_entries(actor_ptid: &str) -> Result<Vec<Value>, String> {
    let mut tools = builtin_tool_registry_entries();
    let _ = actor_ptid;
    if let Ok(mut plugin_tools) = plugins::plugin_tool_registry_entries() {
        tools.append(&mut plugin_tools);
    }
    Ok(tools)
}

pub fn tools_list(actor_ptid: &str) -> AppResult<StubPayload> {
    let mut tools = builtin_tool_registry_entries();
    let _ = actor_ptid;
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
            "local_file_write",
            "filesystem",
            "Create or overwrite a UTF-8 file inside the approved workspace after user approval.",
            "high",
            true,
            "desktop-rust",
            json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to the approved workspace"},
                    "content": {"type": "string", "description": "Complete UTF-8 file content"}
                },
                "required": ["path", "content"]
            }),
        ),
        builtin_tool(
            "local_file_edit",
            "filesystem",
            "Apply one exact text replacement inside an existing workspace file after user approval.",
            "high",
            true,
            "desktop-rust",
            json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to the approved workspace"},
                    "old_string": {"type": "string", "description": "Exact text to replace; must occur exactly once"},
                    "new_string": {"type": "string", "description": "Replacement text"}
                },
                "required": ["path", "old_string", "new_string"]
            }),
        ),
        builtin_tool(
            "local_shell_exec",
            "shell",
            "Run an allow-listed read-only or build command inside the approved workspace after user approval.",
            "high",
            true,
            "desktop-rust",
            json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "enum": ["find", "grep", "rg", "cat", "ls", "make", "pnpm", "npm", "go", "cargo", "git"]
                    },
                    "args": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Arguments; write flags and shell metacharacters are rejected"
                    }
                },
                "required": ["command"]
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
    allowed_roots: Option<&[String]>,
    call_id: Option<&str>,
) -> Result<Value, String> {
    let started = std::time::Instant::now();
    let output = match tool_name {
        "local_file_read" => execute_file_read(&arguments, workspace_root, allowed_roots),
        "local_workspace_list" => execute_workspace_list(&arguments, workspace_root, allowed_roots),
        "local_clipboard_read" => execute_clipboard_read(),
        "local_clipboard_write" => execute_clipboard_write(&arguments),
        "local_shell_safe" => execute_shell_safe(&arguments, workspace_root, allowed_roots),
        "local_file_write" => execute_file_write(&arguments, workspace_root, allowed_roots),
        "local_file_edit" => execute_file_edit(&arguments, workspace_root, allowed_roots),
        "local_shell_exec" => execute_shell_allowlist(&arguments, workspace_root, allowed_roots),
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

fn execute_file_read(
    arguments: &Value,
    workspace_root: Option<&str>,
    allowed_roots: Option<&[String]>,
) -> Result<Value, String> {
    let path = required_string(arguments, "path")?;
    let max_bytes = arguments
        .get("max_bytes")
        .and_then(Value::as_u64)
        .unwrap_or(64 * 1024)
        .min(200_000) as usize;
    let resolved = resolve_guarded_path(workspace_root, allowed_roots, &path)?;
    // A missing file is a normal probe during create-and-edit workflows:
    // return a soft error in the tool result so the model can react instead
    // of aborting the whole turn.
    if !resolved.is_file() {
        return Ok(json!({
            "path": resolved.display().to_string(),
            "exists": false,
            "error": "file not found",
        }));
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
    allowed_roots: Option<&[String]>,
) -> Result<Value, String> {
    let path = optional_string(arguments, "path").unwrap_or_else(|| ".".to_string());
    let limit = arguments
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(100)
        .min(200) as usize;
    let resolved = resolve_guarded_path(workspace_root, allowed_roots, &path)?;
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

fn execute_shell_safe(
    arguments: &Value,
    workspace_root: Option<&str>,
    allowed_roots: Option<&[String]>,
) -> Result<Value, String> {
    let operation = required_string(arguments, "operation")?;
    match operation.as_str() {
        "pwd" => Ok(json!({ "workspace": workspace_base(workspace_root)?.display().to_string() })),
        "list_dir" => execute_workspace_list(arguments, workspace_root, allowed_roots),
        other => Err(format!("unsupported safe shell operation: {other}")),
    }
}

/// Maximum file content accepted by local_file_write/edit. Larger
/// blobs need a dedicated chunked protocol and must fail closed here.
const MAX_WRITE_BYTES: usize = 64 * 1024;

fn hash_file(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    Some(hex::encode(Sha256::digest(bytes)))
}

fn execute_file_write(
    arguments: &Value,
    workspace_root: Option<&str>,
    allowed_roots: Option<&[String]>,
) -> Result<Value, String> {
    let path = required_string(arguments, "path")?;
    let content = required_string(arguments, "content")?;
    if content.len() > MAX_WRITE_BYTES {
        return Err(format!(
            "file content exceeds {MAX_WRITE_BYTES} bytes; chunked writes are not supported"
        ));
    }
    let resolved = resolve_guarded_path_for_write(workspace_root, allowed_roots, &path)?;
    if let Some(parent) = resolved.parent() {
        if !parent.is_dir() {
            return Err("parent directory does not exist".to_string());
        }
    }
    let before_hash = hash_file(&resolved);
    let before_size = fs::metadata(&resolved).map(|meta| meta.len()).ok();
    let temp_path = resolved.with_extension(format!(
        "{}.tmp",
        resolved
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("part")
    ));
    {
        let mut temp = fs::File::create(&temp_path)
            .map_err(|error| format!("failed to create temporary file: {error}"))?;
        temp.write_all(content.as_bytes())
            .map_err(|error| format!("failed to write temporary file: {error}"))?;
        temp.sync_all()
            .map_err(|error| format!("failed to sync temporary file: {error}"))?;
    }
    fs::rename(&temp_path, &resolved)
        .map_err(|error| format!("failed to atomically replace file: {error}"))?;
    let after_size = fs::metadata(&resolved)
        .map_err(|error| format!("failed to stat written file: {error}"))?
        .len();
    let after_hash =
        hash_file(&resolved).ok_or_else(|| "failed to hash written file".to_string())?;
    let name = resolved
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "written file name is not valid UTF-8".to_string())?;
    Ok(json!({
        "path": resolved.display().to_string(),
        "before_hash": before_hash,
        "before_size": before_size,
        "after_hash": after_hash,
        "after_size": after_size,
        "created": before_hash.is_none(),
        "artifacts": [{
            "kind": "file",
            "name": name,
            "size": after_size,
            "sha256": after_hash,
            "client_local_ref": resolved.display().to_string(),
        }],
    }))
}

fn execute_file_edit(
    arguments: &Value,
    workspace_root: Option<&str>,
    allowed_roots: Option<&[String]>,
) -> Result<Value, String> {
    let path = required_string(arguments, "path")?;
    let old_string = required_string(arguments, "old_string")?;
    let new_string = required_string(arguments, "new_string")?;
    if old_string.is_empty() {
        return Err(
            "old_string must not be empty; use local_file_write to create files".to_string(),
        );
    }
    if old_string.len() > MAX_WRITE_BYTES || new_string.len() > MAX_WRITE_BYTES {
        return Err(format!("edit payload exceeds {MAX_WRITE_BYTES} bytes"));
    }
    let resolved = resolve_guarded_path_for_write(workspace_root, allowed_roots, &path)?;
    if !resolved.is_file() {
        return Err(format!("path is not a file: {}", resolved.display()));
    }
    let before = fs::read_to_string(&resolved)
        .map_err(|error| format!("failed to read file as UTF-8: {error}"))?;
    let matches = before.matches(&old_string).count();
    if matches == 0 {
        return Err("old_string not found in file".to_string());
    }
    if matches > 1 {
        return Err("old_string must match exactly once".to_string());
    }
    if before.len() - old_string.len() + new_string.len() > MAX_WRITE_BYTES {
        return Err(format!(
            "resulting file would exceed {MAX_WRITE_BYTES} bytes"
        ));
    }
    let after = before.replacen(&old_string, &new_string, 1);
    let temp_path = resolved.with_extension("edit.tmp");
    fs::write(&temp_path, after.as_bytes())
        .map_err(|error| format!("failed to stage edit: {error}"))?;
    fs::rename(&temp_path, &resolved)
        .map_err(|error| format!("failed to atomically apply edit: {error}"))?;
    let name = resolved
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "edited file name is not valid UTF-8".to_string())?;
    let after_hash = hash_string(&after);
    Ok(json!({
        "path": resolved.display().to_string(),
        "before_hash": hash_string(&before),
        "after_hash": after_hash,
        "after_size": after.len(),
        "artifacts": [{
            "kind": "file",
            "name": name,
            "size": after.len(),
            "sha256": after_hash,
            "client_local_ref": resolved.display().to_string(),
        }],
    }))
}

/// resolve_guarded_path canonicalizes the target, which fails before a
/// write creates the file. Resolve and validate the parent instead.
fn resolve_guarded_path_for_write(
    workspace_root: Option<&str>,
    allowed_roots: Option<&[String]>,
    path: &str,
) -> Result<PathBuf, String> {
    let base = workspace_base(workspace_root)?;
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err("absolute paths are not allowed; use workspace-relative paths".to_string());
    }
    if path
        .split(['/', '\\'])
        .any(|segment| segment == ".." || segment == ".")
    {
        return Err("path must stay inside the workspace without . or .. segments".to_string());
    }
    let joined = base.join(candidate);
    let parent = joined
        .parent()
        .ok_or_else(|| "file path has no parent directory".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("failed to resolve parent directory: {error}"))?;
    let allowed = approved_roots(&base, allowed_roots)?;
    if !allowed
        .iter()
        .any(|root| canonical_parent.starts_with(root))
    {
        return Err("path is outside the approved Agent access roots".to_string());
    }
    Ok(canonical_parent.join(
        joined
            .file_name()
            .ok_or_else(|| "path must reference a file".to_string())?,
    ))
}

fn hash_string(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

/// Allowed top-level shell commands (executed without a shell).
fn is_allowlisted_shell_command(command: &str) -> bool {
    matches!(
        command,
        "find" | "grep" | "rg" | "cat" | "ls" | "make" | "pnpm" | "npm" | "go" | "cargo" | "git"
    )
}

/// Write/mutate subcommands rejected per top-level command. Commands
/// absent from this map accept any non-flag argument (read-only tools).
fn forbidden_shell_subcommands(command: &str) -> Option<&'static [&'static str]> {
    Some(match command {
        "pnpm" => &[
            "install", "i", "add", "update", "remove", "rm", "publish", "dlx", "create",
        ],
        "npm" => &[
            "install",
            "i",
            "ci",
            "update",
            "uninstall",
            "publish",
            "create",
        ],
        "go" => &["get", "install", "mod", "env", "generate", "clean", "work"],
        "cargo" => &["install", "publish", "new", "init", "remove", "clean"],
        "git" => &[
            "push",
            "commit",
            "merge",
            "rebase",
            "reset",
            "checkout",
            "switch",
            "stash",
            "clean",
            "apply",
            "cherry-pick",
            "revert",
            "tag",
        ],
        _ => return None,
    })
}

fn execute_shell_allowlist(
    arguments: &Value,
    workspace_root: Option<&str>,
    _allowed_roots: Option<&[String]>,
) -> Result<Value, String> {
    let command = required_string(arguments, "command")?;
    let cwd = workspace_base(workspace_root)?;
    if !is_allowlisted_shell_command(&command) {
        return Err(format!("command '{command}' is not in the shell allowlist"));
    }
    let disallowed = forbidden_shell_subcommands(&command).unwrap_or(&[]);
    // Path-reading commands and package managers must not reach outside
    // the workspace through absolute paths or parent traversal.
    let path_bearing = matches!(
        command.as_str(),
        "find" | "grep" | "rg" | "cat" | "ls" | "make"
    );
    // find can execute or mutate through these flags.
    let forbidden_flags = ["-exec", "-execdir", "-ok", "-delete", "-fls", "-fprint"];
    let raw_args: Vec<String> = arguments
        .get("args")
        .map(Value::as_array)
        .flatten()
        .map(|items| {
            items
                .iter()
                .map(|value| value.as_str().unwrap_or_default().to_string())
                .collect()
        })
        .unwrap_or_default();
    for arg in &raw_args {
        if arg.trim().is_empty() {
            return Err("empty shell argument".to_string());
        }
        if arg.contains(';')
            || arg.contains('|')
            || arg.contains('&')
            || arg.contains('`')
            || arg.contains('$')
            || arg.contains('>')
            || arg.contains('<')
            || arg.contains('\n')
            || arg.contains('\r')
        {
            return Err(format!(
                "shell metacharacters are not allowed in argument: {arg}"
            ));
        }
        if forbidden_flags
            .iter()
            .any(|flag| arg == *flag || arg.starts_with(&format!("{flag}=")))
        {
            return Err(format!("flag is not allowed for {command}: {arg}"));
        }
        if path_bearing && !arg.starts_with('-') && (arg.starts_with('/') || arg.contains("..")) {
            return Err(format!(
                "{command} arguments must stay inside the workspace: {arg}"
            ));
        }
    }
    // For commands with subcommands, the first non-flag argument must be
    // outside the forbidden (write) set. Make recipes are arbitrary, so
    // make additionally accepts only a small safe target allowlist.
    const SAFE_MAKE_TARGETS: &[&str] = &["test", "check", "lint", "build", "fmt", "help", "tidy"];
    let subcommand = raw_args
        .iter()
        .find(|arg| !arg.starts_with('-'))
        .map(String::as_str);
    if let Some(sub) = subcommand {
        if command == "make" && !SAFE_MAKE_TARGETS.contains(&sub) {
            return Err(format!(
                "make target '{sub}' is not in the safe target allowlist"
            ));
        }
        if disallowed.iter().any(|forbidden| *forbidden == sub) {
            return Err(format!(
                "'{command} {sub}' performs writes and is not allowed"
            ));
        }
    }
    let output = std::process::Command::new(&command)
        .args(&raw_args)
        .current_dir(&cwd)
        .output()
        .map_err(|error| format!("failed to execute {command}: {error}"))?;
    Ok(json!({
        "command": command,
        "args": raw_args,
        "cwd": cwd.display().to_string(),
        "exit_code": output.status.code().unwrap_or(-1),
        "stdout": String::from_utf8_lossy(&output.stdout).to_string(),
        "stderr": String::from_utf8_lossy(&output.stderr).to_string(),
    }))
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

fn resolve_guarded_path(
    workspace_root: Option<&str>,
    allowed_roots: Option<&[String]>,
    path: &str,
) -> Result<PathBuf, String> {
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
    let allowed = approved_roots(&base, allowed_roots)?;
    if !allowed.iter().any(|root| normalized.starts_with(root)) {
        return Err("path is outside the approved Agent access roots".to_string());
    }
    Ok(normalized)
}

fn approved_roots(base: &Path, allowed_roots: Option<&[String]>) -> Result<Vec<PathBuf>, String> {
    let mut roots = vec![base.to_path_buf()];
    if let Some(extra_roots) = allowed_roots {
        for raw in extra_roots {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                continue;
            }
            let root = Path::new(trimmed)
                .canonicalize()
                .map_err(|error| format!("failed to resolve allowed root '{trimmed}': {error}"))?;
            roots.push(root);
        }
    }
    roots.sort();
    roots.dedup();
    Ok(roots)
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
            None,
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
            None,
            Some("call_2"),
        );
        assert!(denied
            .expect_err("outside file must be denied")
            .contains("outside the approved Agent access roots"));

        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn local_file_read_allows_configured_extra_root() {
        let base = unique_temp_dir("agent-tools-workspace");
        let extra = unique_temp_dir("agent-tools-extra");
        fs::create_dir_all(&base).expect("temp workspace should be created");
        fs::create_dir_all(&extra).expect("extra root should be created");
        fs::write(extra.join("shared.txt"), "shared").expect("extra file should be written");

        let result = execute_builtin_local_tool(
            "local_file_read",
            json!({"path": extra.join("shared.txt").display().to_string()}),
            Some(base.to_str().expect("temp path should be utf8")),
            Some(&[extra.to_string_lossy().to_string()]),
            Some("call_3"),
        )
        .expect("configured extra root should be readable");
        assert_eq!(
            result
                .get("output")
                .and_then(|output| output.get("content"))
                .and_then(Value::as_str),
            Some("shared")
        );

        let _ = fs::remove_dir_all(base);
        let _ = fs::remove_dir_all(extra);
    }

    #[test]
    fn file_write_and_edit_stay_inside_workspace() {
        let base = unique_temp_dir("agent-tools-write");
        fs::create_dir_all(&base).expect("temp workspace");

        let write = execute_builtin_local_tool(
            "local_file_write",
            json!({"path": "docs/note.txt", "content": "hello world"}),
            Some(base.to_str().unwrap()),
            Some(&[]),
            Some("call_write"),
        )
        .expect("write inside workspace");
        assert_eq!(
            write
                .get("output")
                .and_then(|output| output.get("created"))
                .and_then(Value::as_bool),
            Some(true)
        );

        let edit = execute_builtin_local_tool(
            "local_file_edit",
            json!({
                "path": "docs/note.txt",
                "old_string": "world",
                "new_string": "rust",
            }),
            Some(base.to_str().unwrap()),
            Some(&[]),
            Some("call_edit"),
        )
        .expect("exact edit should apply");
        let after = edit
            .get("output")
            .and_then(|output| output.get("after_hash"))
            .and_then(Value::as_str)
            .unwrap();
        assert!(!after.is_empty());
        assert_eq!(
            fs::read_to_string(base.join("docs/note.txt")).unwrap(),
            "hello rust"
        );

        // Parent traversal and absolute writes fail closed.
        let traversal = execute_builtin_local_tool(
            "local_file_write",
            json!({"path": "../escape.txt", "content": "x"}),
            Some(base.to_str().unwrap()),
            Some(&[]),
            Some("call_travel"),
        );
        assert!(traversal.is_err(), "parent traversal must be rejected");
        let absolute = execute_builtin_local_tool(
            "local_file_write",
            json!({"path": base.join("abs.txt").display().to_string(), "content": "x"}),
            Some(base.to_str().unwrap()),
            Some(&[]),
            Some("call_abs"),
        );
        assert!(absolute.is_err(), "absolute paths must be rejected");
        // Nothing escaped.
        assert!(!base.parent().unwrap().join("escape.txt").exists());

        // Ambiguous edits must fail rather than guess.
        fs::write(base.join("dup.txt"), "a a").unwrap();
        let ambiguous = execute_builtin_local_tool(
            "local_file_edit",
            json!({"path": "dup.txt", "old_string": "a", "new_string": "b"}),
            Some(base.to_str().unwrap()),
            Some(&[]),
            Some("call_dup"),
        );
        assert!(ambiguous.is_err());

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn shell_allowlist_enforces_commands_args_and_targets() {
        let base = unique_temp_dir("agent-tools-shell");
        fs::create_dir_all(&base).expect("temp workspace");
        let root = Some(base.to_str().unwrap());

        // Unknown commands and write subcommands are rejected without execution.
        for command in ["bash", "rm", "curl"] {
            let result = execute_builtin_local_tool(
                "local_shell_exec",
                json!({"command": command, "args": ["-lc", "echo hi"]}),
                root,
                Some(&[]),
                Some("call"),
            );
            assert!(result.is_err(), "{command} must be rejected");
        }
        assert!(execute_builtin_local_tool(
            "local_shell_exec",
            json!({"command": "git", "args": ["commit", "-m", "x"]}),
            root,
            Some(&[]),
            Some("call"),
        )
        .is_err());
        assert!(execute_builtin_local_tool(
            "local_shell_exec",
            json!({"command": "pnpm", "args": ["install"]}),
            root,
            Some(&[]),
            Some("call"),
        )
        .is_err());
        assert!(execute_builtin_local_tool(
            "local_shell_exec",
            json!({"command": "make", "args": ["deploy"]}),
            root,
            Some(&[]),
            Some("call"),
        )
        .is_err());
        assert!(execute_builtin_local_tool(
            "local_shell_exec",
            json!({"command": "find", "args": ["-delete", "."]}),
            root,
            Some(&[]),
            Some("call"),
        )
        .is_err());
        assert!(execute_builtin_local_tool(
            "local_shell_exec",
            json!({"command": "cat", "args": ["/etc/hosts"]}),
            root,
            Some(&[]),
            Some("call"),
        )
        .is_err());
        assert!(execute_builtin_local_tool(
            "local_shell_exec",
            json!({"command": "ls", "args": ["; rm -rf /"]}),
            root,
            Some(&[]),
            Some("call"),
        )
        .is_err());

        // A read-only allowlisted command executes inside the workspace.
        let ok = execute_builtin_local_tool(
            "local_shell_exec",
            json!({"command": "ls", "args": []}),
            root,
            Some(&[]),
            Some("call"),
        )
        .expect("ls is allowlisted");
        assert_eq!(
            ok.get("output")
                .and_then(|output| output.get("exit_code"))
                .and_then(Value::as_i64),
            Some(0)
        );

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
