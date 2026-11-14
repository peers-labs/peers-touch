//! Read-only filesystem browsing for the currently authorized local agent
//! workspace. Every path is confined to the canonical active workspace root;
//! the private Station sandbox (no local root) is explicitly unsupported here
//! and must be served by a Station capability instead.
use crate::application::desktop_executor_worker::CapabilityWorkerSupervisor;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tauri::{State, Window};

const MAX_READ_BYTES: u64 = 512 * 1024;

fn fail(code: ErrorCode, message: &str, cause: String) -> AppError {
    AppError {
        code,
        message: message.to_string(),
        details: Some(serde_json::json!({ "cause": cause })),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFsPathInput {
    /// Workspace-relative path using `/`; empty or "." means the root.
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntryPayload {
    pub name: String,
    pub relative_path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceListPayload {
    pub root: String,
    pub root_name: String,
    pub is_git: bool,
    pub path: String,
    pub entries: Vec<WorkspaceEntryPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFilePayload {
    pub path: String,
    pub content: String,
    pub truncated: bool,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChangePayload {
    /// Raw porcelain XY status, e.g. "M ", "??", "A ".
    pub status: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChangesPayload {
    pub is_git: bool,
    pub changes: Vec<WorkspaceChangePayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiffPayload {
    pub path: String,
    /// True for untracked files whose full content is shown as an addition.
    pub untracked: bool,
    pub diff: String,
}

fn active_root(
    supervisor: &CapabilityWorkerSupervisor,
    actor_ptid: &str,
) -> Result<PathBuf, AppError> {
    let device_id = supervisor
        .device_id_for_actor(actor_ptid)
        .map_err(|error| fail(ErrorCode::Conflict, "agent.workspaceOperationFailed", error))?;
    let root = supervisor
        .active_workspace(actor_ptid, &device_id)
        .map_err(|error| fail(ErrorCode::Conflict, "agent.workspaceOperationFailed", error))?
        .ok_or_else(|| AppError {
            code: ErrorCode::Unavailable,
            message: "agent.workspaceRemoteSandbox".to_string(),
            details: Some(serde_json::json!({
                "cause": "file browsing requires a local authorized workspace"
            })),
        })?;
    root.canonicalize()
        .map_err(|error| fail(ErrorCode::Conflict, "agent.workspaceOperationFailed", format!("invalid workspace root: {error}")))
}

/// Resolve a workspace-relative path and guarantee it stays inside root.
fn resolve_inside(root: &Path, relative: &str) -> Result<PathBuf, AppError> {
    let trimmed = relative.trim().trim_start_matches('/');
    let candidate = if trimmed.is_empty() || trimmed == "." {
        root.to_path_buf()
    } else {
        root.join(trimmed)
    };
    let canonical = candidate.canonicalize().map_err(|error| AppError {
        code: ErrorCode::NotFound,
        message: "agent.workspacePathNotFound".to_string(),
        details: Some(serde_json::json!({ "path": trimmed, "cause": error.to_string() })),
    })?;
    if canonical != root && !canonical.starts_with(root) {
        return Err(AppError {
            code: ErrorCode::Forbidden,
            message: "agent.workspacePathOutsideRoot".to_string(),
            details: Some(serde_json::json!({ "path": trimmed })),
        });
    }
    Ok(canonical)
}

fn relative_posix(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|rel| {
            rel.components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default()
}

fn is_git_repo(root: &Path) -> bool {
    root.join(".git").exists()
}

pub(crate) fn list_directory(
    supervisor: &CapabilityWorkerSupervisor,
    actor_ptid: &str,
    relative: &str,
) -> Result<WorkspaceListPayload, AppError> {
    let root = active_root(supervisor, actor_ptid)?;
    let dir = resolve_inside(&root, relative)?;
    if !dir.is_dir() {
        return Err(AppError {
            code: ErrorCode::InvalidArgument,
            message: "agent.workspacePathNotDirectory".to_string(),
            details: Some(serde_json::json!({ "path": relative })),
        });
    }

    let read = fs::read_dir(&dir)
        .map_err(|error| fail(ErrorCode::Conflict, "agent.workspaceOperationFailed", error.to_string()))?;

    let mut entries: Vec<WorkspaceEntryPayload> = Vec::new();
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Hide the internal git database; other dot-directories stay visible
        // (they are project configuration the user manages).
        if name == ".git" {
            continue;
        }
        let is_symlink = entry.file_type().map(|kind| kind.is_symlink()).unwrap_or(false);
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0);
        entries.push(WorkspaceEntryPayload {
            name,
            relative_path: relative_posix(&root, &entry.path()),
            is_dir: metadata.is_dir(),
            is_symlink,
            size: metadata.len(),
            modified_ms,
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    let root_name = root
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "workspace".to_string());

    Ok(WorkspaceListPayload {
        root: root.to_string_lossy().to_string(),
        root_name: root_name,
        is_git: is_git_repo(&root),
        path: relative_posix(&root, &dir),
        entries,
    })
}

pub(crate) fn read_file(
    supervisor: &CapabilityWorkerSupervisor,
    actor_ptid: &str,
    relative: &str,
) -> Result<WorkspaceFilePayload, AppError> {
    use std::io::Read;
    let root = active_root(supervisor, actor_ptid)?;
    let path = resolve_inside(&root, relative)?;
    if !path.is_file() {
        return Err(AppError {
            code: ErrorCode::InvalidArgument,
            message: "agent.workspacePathNotFile".to_string(),
            details: Some(serde_json::json!({ "path": relative })),
        });
    }
    let metadata = fs::metadata(&path)
        .map_err(|error| fail(ErrorCode::Conflict, "agent.workspaceOperationFailed", error.to_string()))?;
    let size = metadata.len();
    let truncated = size > MAX_READ_BYTES;
    let mut file = fs::File::open(&path)
        .map_err(|error| fail(ErrorCode::Conflict, "agent.workspaceOperationFailed", error.to_string()))?;
    let mut bytes = Vec::new();
    if truncated {
        std::io::Read::take(&mut file, MAX_READ_BYTES)
            .read_to_end(&mut bytes)
            .map_err(|error| fail(ErrorCode::Conflict, "agent.workspaceOperationFailed", error.to_string()))?;
    } else {
        file.read_to_end(&mut bytes)
            .map_err(|error| fail(ErrorCode::Conflict, "agent.workspaceOperationFailed", error.to_string()))?;
    }
    // Reject binary content: NUL bytes in the first sample are a reliable signal.
    if bytes.iter().take(8192).any(|byte| *byte == 0) {
        return Err(AppError {
            code: ErrorCode::Unavailable,
            message: "agent.workspaceBinaryFile".to_string(),
            details: Some(serde_json::json!({ "path": relative })),
        });
    }
    let content = String::from_utf8_lossy(&bytes).into_owned();

    Ok(WorkspaceFilePayload {
        path: relative_posix(&root, &path),
        content,
        truncated,
        size,
    })
}

fn run_git(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() && output.status.code() != Some(1) {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

pub(crate) fn git_changes(
    supervisor: &CapabilityWorkerSupervisor,
    actor_ptid: &str,
) -> Result<WorkspaceChangesPayload, AppError> {
    let root = active_root(supervisor, actor_ptid)?;
    if !is_git_repo(&root) {
        return Ok(WorkspaceChangesPayload { is_git: false, changes: Vec::new() });
    }
    // NUL-terminated records survive paths with spaces; rename pairs carry a
    // second NUL-separated path.
    let raw = run_git(
        &root,
        &["status", "--porcelain=v1", "--untracked-files=all", "-z"],
    )
    .ok_or_else(|| AppError {
        code: ErrorCode::Conflict,
        message: "agent.workspaceGitUnavailable".to_string(),
        details: None,
    })?;

    let mut tokens = raw.split('\0').filter(|token| !token.is_empty());
    let mut changes: Vec<WorkspaceChangePayload> = Vec::new();
    while let Some(record) = tokens.next() {
        if record.len() < 3 {
            continue;
        }
        let status = record[..2].to_string();
        let mut path = record[3..].to_string();
        // Rename/copy records ("R "/"C ") are followed by the new path.
        if status.starts_with('R') || status.starts_with('C') {
            if let Some(new_path) = tokens.next() {
                path = new_path.to_string();
            }
        }
        changes.push(WorkspaceChangePayload { status, path });
    }

    Ok(WorkspaceChangesPayload { is_git: true, changes })
}

pub(crate) fn git_diff(
    supervisor: &CapabilityWorkerSupervisor,
    actor_ptid: &str,
    relative: &str,
) -> Result<WorkspaceDiffPayload, AppError> {
    let root = active_root(supervisor, actor_ptid)?;
    let path = resolve_inside(&root, relative)?;
    let display_path = relative_posix(&root, &path);

    // Untracked file: render the full content as an addition against /dev/null.
    let status_output = run_git(
        &root,
        &["status", "--porcelain=v1", "--untracked-files=all", "--", &display_path],
    );
    let untracked = status_output
        .as_deref()
        .map(|output| output.starts_with("??"))
        .unwrap_or(false);

    let diff = if untracked {
        run_git(
            &root,
            &["diff", "--no-index", "--no-color", "--", "/dev/null", &display_path],
        )
        .unwrap_or_default()
    } else {
        run_git(&root, &["diff", "--no-color", "HEAD", "--", &display_path]).unwrap_or_default()
    };

    Ok(WorkspaceDiffPayload {
        path: display_path,
        untracked,
        diff,
    })
}

fn require_actor(
    state: &Arc<AppState>,
    window: &Window,
) -> Result<String, AppError> {
    let token = crate::application::session_resolver::token_for_window(state, window).unwrap_or_default();
    let actor_ptid = crate::application::session_resolver::ptid_for_window(state, window).unwrap_or_default();
    if token.trim().is_empty() || !actor_ptid.starts_with("ptid:") {
        return Err(AppError {
            code: ErrorCode::Unauthorized,
            message: "authentication required".to_string(),
            details: None,
        });
    }
    Ok(actor_ptid)
}

fn into_app_result<T: Serialize>(result: Result<T, AppError>) -> AppResult<T> {
    match result {
        Ok(payload) => AppResult::success(payload),
        Err(error) => AppResult {
            ok: false,
            data: None,
            error: Some(error),
        },
    }
}

#[tauri::command]
pub fn agent_workspace_fs_list(
    input: WorkspaceFsPathInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<WorkspaceListPayload> {
    let actor_ptid = match require_actor(state.inner(), &window) {
        Ok(actor_ptid) => actor_ptid,
        Err(error) => return into_app_result::<WorkspaceListPayload>(Err(error)),
    };
    into_app_result(list_directory(supervisor.inner(), &actor_ptid, &input.path))
}

#[tauri::command]
pub fn agent_workspace_fs_read(
    input: WorkspaceFsPathInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<WorkspaceFilePayload> {
    let actor_ptid = match require_actor(state.inner(), &window) {
        Ok(actor_ptid) => actor_ptid,
        Err(error) => return into_app_result::<WorkspaceFilePayload>(Err(error)),
    };
    into_app_result(read_file(supervisor.inner(), &actor_ptid, &input.path))
}

#[tauri::command]
pub fn agent_workspace_git_changes(
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<WorkspaceChangesPayload> {
    let actor_ptid = match require_actor(state.inner(), &window) {
        Ok(actor_ptid) => actor_ptid,
        Err(error) => return into_app_result::<WorkspaceChangesPayload>(Err(error)),
    };
    into_app_result(git_changes(supervisor.inner(), &actor_ptid))
}

#[tauri::command]
pub fn agent_workspace_git_diff(
    input: WorkspaceFsPathInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<CapabilityWorkerSupervisor>>,
    window: Window,
) -> AppResult<WorkspaceDiffPayload> {
    let actor_ptid = match require_actor(state.inner(), &window) {
        Ok(actor_ptid) => actor_ptid,
        Err(error) => return into_app_result::<WorkspaceDiffPayload>(Err(error)),
    };
    into_app_result(git_diff(supervisor.inner(), &actor_ptid, &input.path))
}
