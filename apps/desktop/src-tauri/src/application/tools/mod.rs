use crate::application::plugins;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Typed device execution failure codes surfaced verbatim through the
/// capability receipt error_code. Keep in sync with
/// ClientCapabilityReceiptErrorCode in model/domain/agent/agent.proto.
pub(crate) const ERR_PATH_OUTSIDE_ROOT: &str = "CLIENT_CAPABILITY_PATH_OUTSIDE_ROOT";
pub(crate) const ERR_COMMAND_NOT_ALLOWED: &str = "CLIENT_CAPABILITY_COMMAND_NOT_ALLOWED";
pub(crate) const ERR_COMMAND_TIMEOUT: &str = "CLIENT_CAPABILITY_COMMAND_TIMEOUT";
pub(crate) const ERR_EXECUTION_FAILED: &str = "CLIENT_CAPABILITY_EXECUTION_FAILED";

#[derive(Debug)]
pub(crate) struct ToolError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

impl ToolError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }

    fn execution_failed(message: impl Into<String>) -> Self {
        Self::new(ERR_EXECUTION_FAILED, message)
    }

    fn outside_root(message: impl Into<String>) -> Self {
        Self::new(ERR_PATH_OUTSIDE_ROOT, message)
    }

    fn command_not_allowed(message: impl Into<String>) -> Self {
        Self::new(ERR_COMMAND_NOT_ALLOWED, message)
    }
}

impl std::fmt::Display for ToolError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

/// One-shot commands are bounded: wall time and per-stream output. The
/// bounds are deliberately tight for the local allowlist (build/test probes).
const SHELL_TIMEOUT_MS: u64 = 60_000;
const SHELL_OUTPUT_CAP_BYTES: usize = 64 * 1024;
/// Maximum unified diff surfaced in a tool result / artifact receipt.
const DIFF_CAP_CHARS: usize = 16_000;
/// Refuse quadratic LCS work on pathological files.
const DIFF_MAX_LCS_CELLS: usize = 2_000_000;

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
) -> Result<Value, ToolError> {
    let started = Instant::now();
    let output = match tool_name {
        "local_file_read" => execute_file_read(&arguments, workspace_root, allowed_roots),
        "local_workspace_list" => execute_workspace_list(&arguments, workspace_root, allowed_roots),
        "local_clipboard_read" => execute_clipboard_read(),
        "local_clipboard_write" => execute_clipboard_write(&arguments),
        "local_shell_safe" => execute_shell_safe(&arguments, workspace_root, allowed_roots),
        "local_file_write" => execute_file_write(&arguments, workspace_root, allowed_roots),
        "local_file_edit" => execute_file_edit(&arguments, workspace_root, allowed_roots),
        "local_shell_exec" => execute_shell_allowlist(&arguments, workspace_root, allowed_roots),
        other => Err(ToolError::execution_failed(format!(
            "unsupported builtin local tool: {other}"
        ))),
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
) -> Result<Value, ToolError> {
    let path = required_string(arguments, "path").map_err(ToolError::execution_failed)?;
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
    let bytes = fs::read(&resolved)
        .map_err(|error| ToolError::execution_failed(format!("failed to read file: {error}")))?;
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
) -> Result<Value, ToolError> {
    let path = optional_string(arguments, "path").unwrap_or_else(|| ".".to_string());
    let limit = arguments
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(100)
        .min(200) as usize;
    let resolved = resolve_guarded_path(workspace_root, allowed_roots, &path)?;
    if !resolved.is_dir() {
        return Err(ToolError::execution_failed(format!(
            "path is not a directory: {}",
            resolved.display()
        )));
    }
    let mut entries = Vec::new();
    for entry in
        fs::read_dir(&resolved).map_err(|error| ToolError::execution_failed(format!("failed to list directory: {error}")))?
    {
        if entries.len() >= limit {
            break;
        }
        let entry = entry.map_err(|error| ToolError::execution_failed(format!("failed to read directory entry: {error}")))?;
        let metadata = entry
            .metadata()
            .map_err(|error| ToolError::execution_failed(format!("failed to read entry metadata: {error}")))?;
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

fn execute_clipboard_read() -> Result<Value, ToolError> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| ToolError::execution_failed(format!("native clipboard is unavailable: {error}")))?;
    let text = clipboard
        .get_text()
        .map_err(|error| ToolError::execution_failed(format!("native clipboard read failed: {error}")))?;
    Ok(json!({ "text": text }))
}

fn execute_clipboard_write(arguments: &Value) -> Result<Value, ToolError> {
    let text = required_string(arguments, "text").map_err(ToolError::execution_failed)?;
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| ToolError::execution_failed(format!("native clipboard is unavailable: {error}")))?;
    clipboard
        .set_text(text.clone())
        .map_err(|error| ToolError::execution_failed(format!("native clipboard write failed: {error}")))?;
    Ok(json!({ "written": true, "bytes": text.len() }))
}

fn execute_shell_safe(
    arguments: &Value,
    workspace_root: Option<&str>,
    allowed_roots: Option<&[String]>,
) -> Result<Value, ToolError> {
    let operation =
        required_string(arguments, "operation").map_err(ToolError::execution_failed)?;
    match operation.as_str() {
        "pwd" => Ok(json!({
            "workspace": workspace_base(workspace_root)
                .map_err(ToolError::execution_failed)?
                .display()
                .to_string()
        })),
        "list_dir" => execute_workspace_list(arguments, workspace_root, allowed_roots),
        other => Err(ToolError::command_not_allowed(format!(
            "unsupported safe shell operation: {other}"
        ))),
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
) -> Result<Value, ToolError> {
    let path = required_string(arguments, "path").map_err(ToolError::execution_failed)?;
    let content = required_string(arguments, "content").map_err(ToolError::execution_failed)?;
    if content.len() > MAX_WRITE_BYTES {
        return Err(ToolError::execution_failed(format!(
            "file content exceeds {MAX_WRITE_BYTES} bytes; chunked writes are not supported"
        )));
    }
    let resolved = resolve_guarded_path_for_write(workspace_root, allowed_roots, &path)?;
    if let Some(parent) = resolved.parent() {
        if !parent.is_dir() {
            return Err(ToolError::execution_failed(
                "parent directory does not exist",
            ));
        }
    }
    let before_text = fs::read_to_string(&resolved).ok();
    let before_hash = hash_file(&resolved);
    let before_size = fs::metadata(&resolved).map(|meta| meta.len()).ok();
    let created = before_hash.is_none();
    let temp_path = resolved.with_extension(format!(
        "{}.tmp",
        resolved
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("part")
    ));
    {
        let mut temp = fs::File::create(&temp_path)
            .map_err(|error| ToolError::execution_failed(format!("failed to create temporary file: {error}")))?;
        temp.write_all(content.as_bytes())
            .map_err(|error| ToolError::execution_failed(format!("failed to write temporary file: {error}")))?;
        temp.sync_all()
            .map_err(|error| ToolError::execution_failed(format!("failed to sync temporary file: {error}")))?;
    }
    fs::rename(&temp_path, &resolved)
        .map_err(|error| ToolError::execution_failed(format!("failed to atomically replace file: {error}")))?;
    let after_size = fs::metadata(&resolved)
        .map_err(|error| ToolError::execution_failed(format!("failed to stat written file: {error}")))?
        .len();
    let after_hash = hash_file(&resolved)
        .ok_or_else(|| ToolError::execution_failed("failed to hash written file"))?;
    let name = resolved
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| ToolError::execution_failed("written file name is not valid UTF-8"))?;
    let (unified_diff, diff_truncated) =
        bounded_unified_diff(before_text.as_deref().unwrap_or(""), &content, &path);
    let change_type = if created { "created" } else { "modified" };
    Ok(json!({
        "path": resolved.display().to_string(),
        "before_hash": before_hash,
        "before_size": before_size,
        "after_hash": after_hash,
        "after_size": after_size,
        "created": created,
        "change_type": change_type,
        "unified_diff": unified_diff,
        "diff_truncated": diff_truncated,
        "artifacts": [{
            "kind": "file",
            "name": name,
            "size": after_size,
            "sha256": after_hash,
            "before_sha256": before_hash,
            "before_size": before_size,
            "change_type": change_type,
            "unified_diff": unified_diff,
            "diff_truncated": diff_truncated,
            "client_local_ref": resolved.display().to_string(),
        }],
    }))
}

fn execute_file_edit(
    arguments: &Value,
    workspace_root: Option<&str>,
    allowed_roots: Option<&[String]>,
) -> Result<Value, ToolError> {
    let path = required_string(arguments, "path").map_err(ToolError::execution_failed)?;
    let old_string = required_string(arguments, "old_string").map_err(ToolError::execution_failed)?;
    let new_string = required_string(arguments, "new_string").map_err(ToolError::execution_failed)?;
    if old_string.is_empty() {
        return Err(ToolError::execution_failed(
            "old_string must not be empty; use local_file_write to create files",
        ));
    }
    if old_string.len() > MAX_WRITE_BYTES || new_string.len() > MAX_WRITE_BYTES {
        return Err(ToolError::execution_failed(format!(
            "edit payload exceeds {MAX_WRITE_BYTES} bytes"
        )));
    }
    let resolved = resolve_guarded_path_for_write(workspace_root, allowed_roots, &path)?;
    if !resolved.is_file() {
        return Err(ToolError::execution_failed(format!(
            "path is not a file: {}",
            resolved.display()
        )));
    }
    let before = fs::read_to_string(&resolved)
        .map_err(|error| ToolError::execution_failed(format!("failed to read file as UTF-8: {error}")))?;
    let matches = before.matches(&old_string).count();
    if matches == 0 {
        return Err(ToolError::execution_failed(
            "old_string not found in file",
        ));
    }
    if matches > 1 {
        return Err(ToolError::execution_failed(
            "old_string must match exactly once",
        ));
    }
    if before.len() - old_string.len() + new_string.len() > MAX_WRITE_BYTES {
        return Err(ToolError::execution_failed(format!(
            "resulting file would exceed {MAX_WRITE_BYTES} bytes"
        )));
    }
    let after = before.replacen(&old_string, &new_string, 1);
    let temp_path = resolved.with_extension("edit.tmp");
    fs::write(&temp_path, after.as_bytes())
        .map_err(|error| ToolError::execution_failed(format!("failed to stage edit: {error}")))?;
    fs::rename(&temp_path, &resolved)
        .map_err(|error| ToolError::execution_failed(format!("failed to atomically apply edit: {error}")))?;
    let name = resolved
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| ToolError::execution_failed("edited file name is not valid UTF-8"))?;
    let before_hash = hash_string(&before);
    let after_hash = hash_string(&after);
    let (unified_diff, diff_truncated) = bounded_unified_diff(&before, &after, &path);
    Ok(json!({
        "path": resolved.display().to_string(),
        "before_hash": before_hash,
        "before_size": before.len(),
        "after_hash": after_hash,
        "after_size": after.len(),
        "created": false,
        "change_type": "modified",
        "unified_diff": unified_diff,
        "diff_truncated": diff_truncated,
        "artifacts": [{
            "kind": "file",
            "name": name,
            "size": after.len(),
            "sha256": after_hash,
            "before_sha256": before_hash,
            "before_size": before.len(),
            "change_type": "modified",
            "unified_diff": unified_diff,
            "diff_truncated": diff_truncated,
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
) -> Result<PathBuf, ToolError> {
    let base = workspace_base(workspace_root).map_err(ToolError::execution_failed)?;
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err(ToolError::outside_root(
            "absolute paths are not allowed; use workspace-relative paths",
        ));
    }
    if path
        .split(['/', '\\'])
        .any(|segment| segment == ".." || segment == ".")
    {
        return Err(ToolError::outside_root(
            "path must stay inside the workspace without . or .. segments",
        ));
    }
    let joined = base.join(candidate);
    let parent = joined
        .parent()
        .ok_or_else(|| ToolError::execution_failed("file path has no parent directory"))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| ToolError::execution_failed(format!("failed to resolve parent directory: {error}")))?;
    let allowed = approved_roots(&base, allowed_roots).map_err(ToolError::execution_failed)?;
    if !allowed
        .iter()
        .any(|root| canonical_parent.starts_with(root))
    {
        return Err(ToolError::outside_root(
            "path is outside the approved Agent access roots",
        ));
    }
    Ok(canonical_parent.join(
        joined
            .file_name()
            .ok_or_else(|| ToolError::execution_failed("path must reference a file"))?,
    ))
}

fn hash_string(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

/// Bounded unified diff over real before/after bytes. Output is capped at
/// DIFF_CAP_CHARS; when the LCS table would be too large, fall back to a
/// full-content replacement hunk. Headers reference the workspace-relative
/// path supplied by the model, never the resolved absolute path.
fn bounded_unified_diff(before: &str, after: &str, display_path: &str) -> (String, bool) {
    let old: Vec<&str> = before.lines().collect();
    let new: Vec<&str> = after.lines().collect();
    let mut hunks: Vec<(usize, usize, Vec<String>)> = Vec::new();
    let mut truncated = false;

    if old.len().saturating_mul(new.len()) > DIFF_MAX_LCS_CELLS {
        // Bounded fallback: show both sides as one replacement block.
        let mut block = Vec::new();
        for line in &old {
            block.push(format!("-{line}"));
        }
        for line in &new {
            block.push(format!("+{line}"));
        }
        hunks.push((old.len(), new.len(), block));
    } else {
        let rows = old.len();
        let cols = new.len();
        let mut lcs = vec![0usize; (rows + 1) * (cols + 1)];
        for i in 1..=rows {
            for j in 1..=cols {
                lcs[i * (cols + 1) + j] = if old[i - 1] == new[j - 1] {
                    lcs[(i - 1) * (cols + 1) + j - 1] + 1
                } else {
                    lcs[(i - 1) * (cols + 1) + j]
                        .max(lcs[i * (cols + 1) + j - 1])
                };
            }
        }
        // Backtrack into tagged edit script, then split into hunks.
        let mut script: Vec<(char, &str, usize, usize)> = Vec::new();
        let (mut i, mut j) = (rows, cols);
        while i > 0 || j > 0 {
            if i > 0
                && j > 0
                && old[i - 1] == new[j - 1]
                && lcs[i * (cols + 1) + j] == lcs[(i - 1) * (cols + 1) + j - 1] + 1
            {
                script.push((' ', old[i - 1], i, j));
                i -= 1;
                j -= 1;
            } else if j > 0
                && (i == 0 || lcs[i * (cols + 1) + j] > lcs[(i) * (cols + 1) + j - 1])
            {
                script.push(('+', new[j - 1], i, j));
                j -= 1;
            } else {
                script.push(('-', old[i - 1], i, j));
                i -= 1;
            }
        }
        script.reverse();

        // Group into hunks with one context line on each side.
        let mut idx = 0;
        while idx < script.len() {
            if script[idx].0 == ' ' {
                idx += 1;
                continue;
            }
            let start = idx.saturating_sub(1);
            let mut end = idx;
            let mut gap = 0;
            while end + 1 < script.len() {
                if script[end + 1].0 == ' ' {
                    if gap >= 2 {
                        break;
                    }
                    gap += 1;
                } else {
                    gap = 0;
                }
                end += 1;
            }
            let end = (end + 1).min(script.len() - 1);
            let old_start = script[start].2;
            let new_start = script[start].3;
            let lines = script[start..=end]
                .iter()
                .map(|(tag, line, _, _)| format!("{tag}{line}"))
                .collect::<Vec<_>>();
            hunks.push((old_start.max(1), new_start.max(1), lines));
            idx = end + 1;
        }
    }

    let mut diff = format!("--- a/{display_path}\n+++ b/{display_path}\n");
    for (old_start, new_start, lines) in &hunks {
        let old_count = lines.iter().filter(|l| !l.starts_with('+')).count();
        let new_count = lines.iter().filter(|l| !l.starts_with('-')).count();
        diff.push_str(&format!("@@ -{old_start},{old_count} +{new_start},{new_count} @@\n"));
        for line in lines {
            diff.push_str(line);
            diff.push('\n');
        }
        if diff.chars().count() > DIFF_CAP_CHARS {
            truncated = true;
            diff = diff.chars().take(DIFF_CAP_CHARS).collect();
            diff.push_str("\n… diff truncated\n");
            break;
        }
    }
    (diff, truncated)
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
) -> Result<Value, ToolError> {
    let command =
        required_string(arguments, "command").map_err(ToolError::execution_failed)?;
    let cwd = workspace_base(workspace_root).map_err(ToolError::execution_failed)?;
    if !is_allowlisted_shell_command(&command) {
        return Err(ToolError::command_not_allowed(format!(
            "command '{command}' is not in the shell allowlist"
        )));
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
            return Err(ToolError::command_not_allowed("empty shell argument"));
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
            return Err(ToolError::command_not_allowed(format!(
                "shell metacharacters are not allowed in argument: {arg}"
            )));
        }
        if forbidden_flags
            .iter()
            .any(|flag| arg == *flag || arg.starts_with(&format!("{flag}=")))
        {
            return Err(ToolError::command_not_allowed(format!(
                "flag is not allowed for {command}: {arg}"
            )));
        }
        if path_bearing && !arg.starts_with('-') && (arg.starts_with('/') || arg.contains("..")) {
            return Err(ToolError::outside_root(format!(
                "{command} arguments must stay inside the workspace: {arg}"
            )));
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
            return Err(ToolError::command_not_allowed(format!(
                "make target '{sub}' is not in the safe target allowlist"
            )));
        }
        if disallowed.iter().any(|forbidden| *forbidden == sub) {
            return Err(ToolError::command_not_allowed(format!(
                "'{command} {sub}' performs writes and is not allowed"
            )));
        }
    }
    let started = Instant::now();
    let mut child = std::process::Command::new(&command)
        .args(&raw_args)
        .current_dir(&cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| ToolError::execution_failed(format!("failed to execute {command}: {error}")))?;
    // Drain pipes on dedicated threads so a chatty build cannot deadlock
    // against the OS pipe buffer while we enforce the wall-time bound.
    let mut stdout_handle = child.stdout.take();
    let mut stderr_handle = child.stderr.take();
    let stdout_thread = stdout_handle
        .take()
        .map(|mut pipe| std::thread::spawn(move || read_to_end_bounded(&mut pipe)));
    let stderr_thread = stderr_handle
        .take()
        .map(|mut pipe| std::thread::spawn(move || read_to_end_bounded(&mut pipe)));
    let timeout = Duration::from_millis(
        arguments
            .get("timeout_ms")
            .and_then(Value::as_u64)
            .unwrap_or(SHELL_TIMEOUT_MS)
            .min(SHELL_TIMEOUT_MS),
    );
    let exit_code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code().unwrap_or(-1),
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    if let Some(handle) = stdout_thread {
                        let _ = handle.join();
                    }
                    if let Some(handle) = stderr_thread {
                        let _ = handle.join();
                    }
                    return Err(ToolError::new(
                        ERR_COMMAND_TIMEOUT,
                        format!(
                            "command '{command}' exceeded {}ms and was killed",
                            timeout.as_millis()
                        ),
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                let _ = child.kill();
                return Err(ToolError::execution_failed(format!(
                    "failed while awaiting {command}: {error}"
                )));
            }
        }
    };
    let stdout_bytes = stdout_thread
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    let stderr_bytes = stderr_thread
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    let stdout_truncated = stdout_bytes.len() > SHELL_OUTPUT_CAP_BYTES;
    let stderr_truncated = stderr_bytes.len() > SHELL_OUTPUT_CAP_BYTES;
    let stdout_total = stdout_bytes.len();
    let stderr_total = stderr_bytes.len();
    let stdout = String::from_utf8_lossy(&stdout_bytes[..stdout_bytes.len().min(SHELL_OUTPUT_CAP_BYTES)])
        .to_string();
    let stderr = String::from_utf8_lossy(&stderr_bytes[..stderr_bytes.len().min(SHELL_OUTPUT_CAP_BYTES)])
        .to_string();
    let duration_ms = started.elapsed().as_millis() as u64;
    let timed_out = false;
    let failure_reason = if exit_code == 0 {
        ""
    } else {
        "non-zero exit code"
    };
    Ok(json!({
        "command": command,
        "args": raw_args,
        "cwd": cwd.display().to_string(),
        "exit_code": exit_code,
        "stdout": stdout,
        "stderr": stderr,
        "stdout_truncated": stdout_truncated,
        "stderr_truncated": stderr_truncated,
        "stdout_total_bytes": stdout_total,
        "stderr_total_bytes": stderr_total,
        "duration_ms": duration_ms,
        "timed_out": timed_out,
        "failure_reason": failure_reason,
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

fn read_to_end_bounded<R: std::io::Read>(reader: &mut R) -> Vec<u8> {
    // Read one byte beyond the cap so callers can detect truncation, but
    // bound memory regardless of how chatty the command is.
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    while buf.len() <= SHELL_OUTPUT_CAP_BYTES {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                let remaining = SHELL_OUTPUT_CAP_BYTES + 1 - buf.len();
                buf.extend_from_slice(&chunk[..n.min(remaining)]);
                if n > remaining {
                    // Drain and discard the rest so the child can exit.
                    let mut throwaway = vec![0u8; 16 * 1024];
                    while reader.read(&mut throwaway).unwrap_or(0) > 0 {}
                    break;
                }
            }
            Err(_) => break,
        }
    }
    buf
}

fn resolve_guarded_path(
    workspace_root: Option<&str>,
    allowed_roots: Option<&[String]>,
    path: &str,
) -> Result<PathBuf, ToolError> {
    let base = workspace_base(workspace_root).map_err(ToolError::execution_failed)?;
    let candidate = Path::new(path);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        base.join(candidate)
    };
    let normalized = joined
        .canonicalize()
        .map_err(|error| ToolError::execution_failed(format!("failed to resolve path: {error}")))?;
    let allowed = approved_roots(&base, allowed_roots).map_err(ToolError::execution_failed)?;
    if !allowed.iter().any(|root| normalized.starts_with(root)) {
        return Err(ToolError::outside_root(
            "path is outside the approved Agent access roots",
        ));
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

/// Resolve the working directory for a persistent terminal session (TW-D5):
/// it must live inside the granted workspace roots, defaulting to the
/// workspace root itself. Terminal sessions are not allowed to anchor an
/// interactive shell outside the approved roots.
pub(crate) fn resolve_terminal_cwd(
    workspace_root: Option<&str>,
    cwd: Option<&str>,
    allowed_roots: Option<&[String]>,
) -> Result<PathBuf, ToolError> {
    let base = workspace_base(workspace_root).map_err(ToolError::execution_failed)?;
    let target = match cwd.map(str::trim).filter(|value| !value.is_empty()) {
        Some(raw) => {
            let candidate = Path::new(raw);
            if candidate.is_absolute() {
                candidate.to_path_buf()
            } else {
                base.join(candidate)
            }
        }
        None => base.clone(),
    };
    let normalized = target
        .canonicalize()
        .map_err(|error| ToolError::execution_failed(format!("failed to resolve cwd: {error}")))?;
    let allowed = approved_roots(&base, allowed_roots).map_err(ToolError::execution_failed)?;
    if !allowed.iter().any(|root| normalized.starts_with(root)) {
        return Err(ToolError::outside_root(
            "terminal cwd is outside the approved Agent access roots",
        ));
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
        let denial = denied.expect_err("outside file must be denied");
        assert_eq!(denial.code, ERR_PATH_OUTSIDE_ROOT);
        assert!(denial.message.contains("outside the approved Agent access roots"));

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

    #[test]
    fn typed_error_codes_cover_path_and_command_violations() {
        let base = unique_temp_dir("agent-tools-codes");
        fs::create_dir_all(&base).expect("temp workspace");
        let root = Some(base.to_str().unwrap());

        let traversal = execute_builtin_local_tool(
            "local_file_write",
            json!({"path": "../escape.txt", "content": "x"}),
            root,
            Some(&[]),
            Some("call"),
        )
        .expect_err("traversal rejected");
        assert_eq!(traversal.code, ERR_PATH_OUTSIDE_ROOT);

        let unknown = execute_builtin_local_tool(
            "local_shell_exec",
            json!({"command": "bash", "args": []}),
            root,
            Some(&[]),
            Some("call"),
        )
        .expect_err("bash rejected");
        assert_eq!(unknown.code, ERR_COMMAND_NOT_ALLOWED);

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn shell_result_is_bounded_and_echoes_cwd_duration_and_failure_reason() {
        let base = unique_temp_dir("agent-tools-shell-facts");
        fs::create_dir_all(&base).expect("temp workspace");
        let root = Some(base.to_str().unwrap());

        let ok = execute_builtin_local_tool(
            "local_shell_exec",
            json!({"command": "ls", "args": []}),
            root,
            Some(&[]),
            Some("call"),
        )
        .expect("ls runs");
        let output = ok.get("output").expect("output object");
        assert_eq!(output.get("exit_code").and_then(Value::as_i64), Some(0));
        assert!(output
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("agent-tools-shell-facts"));
        assert!(output.get("duration_ms").and_then(Value::as_u64).is_some());
        assert_eq!(output.get("failure_reason").and_then(Value::as_str), Some(""));

        // Non-zero exit is a bounded fact, not an error.
        let failed = execute_builtin_local_tool(
            "local_shell_exec",
            json!({"command": "ls", "args": ["missing-dir-d4"]}),
            root,
            Some(&[]),
            Some("call"),
        )
        .expect("non-zero exit still returns a result");
        let failed_output = failed.get("output").unwrap();
        assert!(
            failed_output.get("exit_code").and_then(Value::as_i64).unwrap_or(0) > 0
        );
        assert_eq!(
            failed_output.get("failure_reason").and_then(Value::as_str),
            Some("non-zero exit code")
        );
        assert_eq!(
            failed_output.get("stderr_truncated").and_then(Value::as_bool),
            Some(false)
        );

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn write_emits_real_byte_diff_and_change_facts() {
        let base = unique_temp_dir("agent-tools-diff");
        fs::create_dir_all(base.join("docs")).expect("temp workspace");
        fs::write(base.join("docs/note.txt"), "line one\nline two\n").unwrap();

        let edited = execute_builtin_local_tool(
            "local_file_edit",
            json!({
                "path": "docs/note.txt",
                "old_string": "line two",
                "new_string": "line three",
            }),
            Some(base.to_str().unwrap()),
            Some(&[]),
            Some("call"),
        )
        .expect("edit applies");
        let output = edited.get("output").unwrap();
        assert_eq!(output.get("change_type").and_then(Value::as_str), Some("modified"));
        let diff = output
            .get("unified_diff")
            .and_then(Value::as_str)
            .expect("diff present");
        assert!(diff.contains("--- a/docs/note.txt"));
        assert!(diff.contains("-line two"));
        assert!(diff.contains("+line three"));
        assert_eq!(output.get("before_hash").and_then(Value::as_str).is_some(), true);
        let artifact = output
            .get("artifacts")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .expect("artifact entry");
        assert_eq!(artifact.get("change_type").and_then(Value::as_str), Some("modified"));
        assert!(artifact.get("before_sha256").and_then(Value::as_str).is_some());

        let created = execute_builtin_local_tool(
            "local_file_write",
            json!({"path": "new.txt", "content": "fresh\n"}),
            Some(base.to_str().unwrap()),
            Some(&[]),
            Some("call2"),
        )
        .expect("create applies");
        assert_eq!(
            created
                .get("output")
                .and_then(|o| o.get("change_type"))
                .and_then(Value::as_str),
            Some("created")
        );

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn shell_command_is_killed_after_timeout() {
        let base = unique_temp_dir("agent-tools-shell-timeout");
        fs::create_dir_all(&base).expect("temp workspace");
        // cat blocks forever on an open FIFO that nobody writes to.
        std::process::Command::new("mkfifo")
            .arg(base.join("blocked.fifo"))
            .status()
            .expect("mkfifo available on linux test hosts");
        let error = execute_builtin_local_tool(
            "local_shell_exec",
            json!({"command": "cat", "args": ["blocked.fifo"], "timeout_ms": 200}),
            Some(base.to_str().unwrap()),
            Some(&[]),
            Some("call"),
        )
        .expect_err("blocked command must be killed");
        assert_eq!(error.code, ERR_COMMAND_TIMEOUT);

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
