//! User-selectable local project workspaces for agent tools.
//!
//! The capability worker otherwise provisions one private sandbox root per
//! actor/device (see [`super::workspace_grants::provision_actor_workspace`]).
//! A user may additionally point an agent capability session at a real local
//! project directory — the same mental model as Terminal's workspaceRoot and
//! as Trae/opencode "Select project" — by explicitly authorizing a folder for
//! the session.
//!
//! Security invariants kept here:
//!  - every stored locator is canonicalized to a real directory at write time;
//!  - worktree children are created only by this user-initiated surface (a
//!    fixed `git worktree add` form), never by an agent tool;
//!  - choices are non-secret user data persisted as actor/device-scoped JSON
//!    under the application data root; granting the choice to a live session
//!    is a separate, per-session activation handled by the supervisor.
use crate::infrastructure::storage;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Folder under which project worktrees are created: `<project>/.peers-worktrees/`.
pub(crate) const WORKTREE_DIR: &str = ".peers-worktrees";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct WorkspaceChoice {
    /// Canonical absolute locator of the project root or worktree.
    pub locator: String,
    pub label: String,
    /// True when the locator sits inside a git working tree.
    pub is_git: bool,
    /// When this choice is a worktree, the canonical base repository root.
    pub worktree_base: Option<String>,
    pub created_at_ms: i64,
    pub last_used_ms: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct ChoiceFile {
    choices: Vec<WorkspaceChoice>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn scope_dir(actor_ptid: &str, device_id: &str) -> Result<PathBuf, String> {
    let root = storage::application_data_root()
        .map_err(|error| format!("resolve application data root: {error}"))?
        .join("agent-workspaces");
    // The capability sandbox uses the same 32-hex scope naming as the worker
    // grants so the two surfaces stay beside each other for one actor/device.
    let scope = {
        use sha2::{Digest, Sha256};
        let digest = hex::encode(Sha256::digest(
            format!("{actor_ptid}\x00{device_id}").as_bytes(),
        ));
        digest[..32].to_string()
    };
    Ok(root.join(scope))
}

fn choices_path(actor_ptid: &str, device_id: &str) -> Result<PathBuf, String> {
    Ok(scope_dir(actor_ptid, device_id)?.join("workspace-choices.json"))
}

/// Canonicalize a user-supplied path and verify it is an existing directory.
pub(crate) fn validate_directory(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("workspace path is empty".to_string());
    }
    let path = Path::new(trimmed);
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("resolve workspace directory {trimmed:?}: {error}"))?;
    if !canonical.is_dir() {
        return Err(format!("workspace path is not a directory: {}", canonical.display()));
    }
    Ok(canonical)
}

fn is_git_repository(root: &Path) -> bool {
    root.join(".git").exists()
}

/// In-process write guard; the on-disk file is tiny and single-user.
static FILE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn with_file_lock<T>(f: impl FnOnce() -> T) -> T {
    let lock = FILE_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock.lock().unwrap_or_else(|poison| poison.into_inner());
    f()
}

fn read_file(actor_ptid: &str, device_id: &str) -> ChoiceFile {
    let Ok(path) = choices_path(actor_ptid, device_id) else {
        return ChoiceFile::default();
    };
    let Ok(bytes) = fs::read(&path) else {
        return ChoiceFile::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn write_file(actor_ptid: &str, device_id: &str, file: &ChoiceFile) -> Result<(), String> {
    let path = choices_path(actor_ptid, device_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("create choices dir: {error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(file).map_err(|error| format!("encode choices: {error}"))?;
    fs::write(&path, bytes).map_err(|error| format!("write choices: {error}"))
}

/// Persist a validated directory as a reusable project choice. Idempotent on
/// the canonical locator; refreshes `last_used_at`.
pub(crate) fn add_choice(
    actor_ptid: &str,
    device_id: &str,
    locator: &Path,
    worktree_base: Option<&Path>,
) -> Result<WorkspaceChoice, String> {
    with_file_lock(|| {
        let mut file = read_file(actor_ptid, device_id);
        let key = locator.to_string_lossy().to_string();
        let now = now_ms();
        if let Some(existing) = file.choices.iter_mut().find(|c| c.locator == key) {
            existing.last_used_ms = now;
            let updated = existing.clone();
            write_file(actor_ptid, device_id, &file)?;
            return Ok(updated);
        }
        let choice = WorkspaceChoice {
            locator: key.clone(),
            label: locator
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| key.clone()),
            is_git: is_git_repository(locator),
            worktree_base: worktree_base.map(|base| base.to_string_lossy().to_string()),
            created_at_ms: now,
            last_used_ms: now,
        };
        file.choices.push(choice.clone());
        file.choices.sort_by(|a, b| b.last_used_ms.cmp(&a.last_used_ms));
        write_file(actor_ptid, device_id, &file)?;
        Ok(choice)
    })
}

pub(crate) fn list_choices(actor_ptid: &str, device_id: &str) -> Vec<WorkspaceChoice> {
    with_file_lock(|| read_file(actor_ptid, device_id).choices)
}

#[allow(dead_code)]
pub(crate) fn remove_choice(actor_ptid: &str, device_id: &str, locator: &str) -> Result<(), String> {
    with_file_lock(|| {
        let mut file = read_file(actor_ptid, device_id);
        file.choices.retain(|c| c.locator != locator.trim());
        write_file(actor_ptid, device_id, &file)
    })
}

/// Create a git worktree of `base` at `<base>/.peers-worktrees/<name>` on a
/// new branch named `peers/<name>`. This runs only from the user-initiated
/// picker surface; agent tools can never invoke it.
pub(crate) fn create_worktree(base: &Path, name: &str) -> Result<PathBuf, String> {
    let base = validate_directory(&base.to_string_lossy())?;
    if !is_git_repository(&base) {
        return Err(format!("not a git repository: {}", base.display()));
    }
    // Name becomes part of a path and a git branch name; restrict to a safe
    // identifier charset (no separators, dots traversal, or shell metachars).
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.len() > 64
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("worktree name must be 1-64 chars of [A-Za-z0-9_-]".to_string());
    }
    let target = base.join(WORKTREE_DIR).join(trimmed);
    if target.exists() {
        return Err(format!("worktree already exists: {}", target.display()));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("create worktrees dir: {error}"))?;
    }
    let branch = format!("peers/{trimmed}");
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(&base)
        .arg("worktree")
        .arg("add")
        .arg("-b")
        .arg(&branch)
        .arg(&target)
        .output()
        .map_err(|error| format!("failed to start git: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git worktree add failed: {}", stderr.trim()));
    }
    fs::canonicalize(&target).map_err(|error| format!("resolve new worktree: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_and_relative_traversal() {
        assert!(validate_directory("/nonexistent/peers-touch-workspace-path").is_err());
    }

    #[test]
    fn validates_real_directory() {
        let dir = validate_directory(".").expect("cwd is a directory");
        assert!(dir.is_dir());
    }

    #[test]
    fn rejects_unsafe_worktree_name() {
        let dir = validate_directory(".").unwrap();
        assert!(create_worktree(&dir, "../escape").is_err());
        assert!(create_worktree(&dir, "bad name").is_err());
        assert!(create_worktree(&dir, "").is_err());
    }
}
