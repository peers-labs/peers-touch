use crate::contracts::AgentExecuteTurnInput;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct ResolvedAgentWorkspace {
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentWorkspaceInfo {
    pub agent_id: String,
    pub workspace_root: String,
    pub profile_dir: String,
    pub total_bytes: u64,
    pub workspace_bytes: u64,
    pub profile_bytes: u64,
    pub task_count: usize,
    pub last_modified_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceCleanScope {
    Tasks,
    Artifacts,
    Logs,
    AllWorkspace,
}

impl WorkspaceCleanScope {
    pub fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "tasks" => Ok(Self::Tasks),
            "artifacts" => Ok(Self::Artifacts),
            "logs" => Ok(Self::Logs),
            "all_workspace" => Ok(Self::AllWorkspace),
            other => Err(format!("unsupported workspace clean scope: {other}")),
        }
    }
}

pub fn resolve_agent_workspace(
    input: &AgentExecuteTurnInput,
) -> Result<ResolvedAgentWorkspace, String> {
    let agent_id = safe_component(&input.agent_id);
    if agent_id.is_empty() {
        return Err("agent_id is required to resolve agent workspace".to_string());
    }

    let agent_root = agent_workspace_home().join(&agent_id);
    let workspace = match input.workspace_mode.as_deref().unwrap_or("agent") {
        "task" => {
            let conversation_id = safe_component(&input.conversation_id);
            let task_id = if conversation_id.is_empty() {
                "default-task".to_string()
            } else {
                conversation_id
            };
            agent_root.join("workspace").join("tasks").join(task_id)
        }
        _ => agent_root.join("workspace"),
    };

    fs::create_dir_all(agent_root.join("profile"))
        .map_err(|error| format!("failed to create agent profile directory: {error}"))?;
    fs::create_dir_all(agent_root.join("workspace").join("artifacts"))
        .map_err(|error| format!("failed to create agent artifacts directory: {error}"))?;
    fs::create_dir_all(agent_root.join("workspace").join("logs"))
        .map_err(|error| format!("failed to create agent logs directory: {error}"))?;
    fs::create_dir_all(&workspace)
        .map_err(|error| format!("failed to create agent workspace directory: {error}"))?;

    workspace
        .canonicalize()
        .map(|path| ResolvedAgentWorkspace { path })
        .map_err(|error| format!("failed to resolve agent workspace directory: {error}"))
}

pub fn proot_available() -> bool {
    env::var_os("PATH")
        .and_then(|paths| {
            env::split_paths(&paths)
                .map(|path| path.join("proot"))
                .find(|path| path.is_file())
        })
        .is_some()
}

fn agent_workspace_home() -> PathBuf {
    if let Ok(path) = env::var("PEERS_TOUCH_AGENT_HOME") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if let Ok(home) = env::var("HOME") {
        return PathBuf::from(home).join(".peers-touch").join("agents");
    }

    env::temp_dir().join("peers-touch").join("agents")
}

fn safe_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn agent_root_for_id(agent_id: &str) -> Result<PathBuf, String> {
    let safe_id = safe_component(agent_id);
    if safe_id.is_empty() {
        return Err("agent_id is required".to_string());
    }
    Ok(agent_workspace_home().join(safe_id))
}

pub fn workspace_info(agent_id: &str) -> Result<AgentWorkspaceInfo, String> {
    let agent_root = agent_root_for_id(agent_id)?;
    let workspace_dir = agent_root.join("workspace");
    let profile_dir = agent_root.join("profile");

    let workspace_bytes = if workspace_dir.is_dir() {
        dir_size(&workspace_dir)
    } else {
        0
    };
    let profile_bytes = if profile_dir.is_dir() {
        dir_size(&profile_dir)
    } else {
        0
    };

    let tasks_dir = workspace_dir.join("tasks");
    let task_count = if tasks_dir.is_dir() {
        fs::read_dir(&tasks_dir)
            .map(|entries| {
                entries
                    .filter_map(|entry| entry.ok())
                    .filter(|entry| entry.path().is_dir())
                    .count()
            })
            .unwrap_or(0)
    } else {
        0
    };

    let last_modified_at = if agent_root.is_dir() {
        dir_last_modified(&agent_root)
    } else {
        None
    };

    Ok(AgentWorkspaceInfo {
        agent_id: agent_id.to_string(),
        workspace_root: workspace_dir.display().to_string(),
        profile_dir: profile_dir.display().to_string(),
        total_bytes: workspace_bytes.saturating_add(profile_bytes),
        workspace_bytes,
        profile_bytes,
        task_count,
        last_modified_at,
    })
}

pub fn clean_workspace(agent_id: &str, scope: WorkspaceCleanScope) -> Result<u64, String> {
    let agent_root = agent_root_for_id(agent_id)?;
    let workspace_dir = agent_root.join("workspace");
    if !workspace_dir.is_dir() {
        return Ok(0);
    }

    let targets: Vec<PathBuf> = match scope {
        WorkspaceCleanScope::Tasks => vec![workspace_dir.join("tasks")],
        WorkspaceCleanScope::Artifacts => vec![workspace_dir.join("artifacts")],
        WorkspaceCleanScope::Logs => vec![workspace_dir.join("logs")],
        WorkspaceCleanScope::AllWorkspace => {
            let mut entries = Vec::new();
            if let Ok(read_dir) = fs::read_dir(&workspace_dir) {
                for entry in read_dir.flatten() {
                    entries.push(entry.path());
                }
            }
            entries
        }
    };

    let mut freed_bytes: u64 = 0;
    for target in &targets {
        if !target.exists() {
            continue;
        }
        let size = if target.is_dir() { dir_size(target) } else { 0 };
        if target.is_dir() {
            fs::remove_dir_all(target)
                .map_err(|error| format!("failed to remove {}: {error}", target.display()))?;
        } else {
            fs::remove_file(target)
                .map_err(|error| format!("failed to remove {}: {error}", target.display()))?;
        }
        freed_bytes = freed_bytes.saturating_add(size);
    }

    if scope == WorkspaceCleanScope::AllWorkspace || scope == WorkspaceCleanScope::Tasks {
        let _ = fs::create_dir_all(workspace_dir.join("tasks"));
    }
    if scope == WorkspaceCleanScope::AllWorkspace || scope == WorkspaceCleanScope::Artifacts {
        let _ = fs::create_dir_all(workspace_dir.join("artifacts"));
    }
    if scope == WorkspaceCleanScope::AllWorkspace || scope == WorkspaceCleanScope::Logs {
        let _ = fs::create_dir_all(workspace_dir.join("logs"));
    }

    Ok(freed_bytes)
}

pub fn clean_expired_tasks(agent_id: &str, retention_days: u32) -> Result<u64, String> {
    let agent_root = agent_root_for_id(agent_id)?;
    let tasks_dir = agent_root.join("workspace").join("tasks");
    if !tasks_dir.is_dir() {
        return Ok(0);
    }

    let now = SystemTime::now();
    let cutoff = now
        .checked_sub(std::time::Duration::from_secs(
            (retention_days as u64).saturating_mul(86_400),
        ))
        .unwrap_or(UNIX_EPOCH);

    let mut freed_bytes: u64 = 0;
    let read_dir = fs::read_dir(&tasks_dir)
        .map_err(|error| format!("failed to read tasks directory: {error}"))?;

    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let is_expired = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .map(|modified| modified < cutoff)
            .unwrap_or(false);
        if !is_expired {
            continue;
        }
        let size = dir_size(&path);
        if fs::remove_dir_all(&path).is_ok() {
            freed_bytes = freed_bytes.saturating_add(size);
        }
    }

    Ok(freed_bytes)
}

fn dir_size(path: &Path) -> u64 {
    let mut total: u64 = 0;
    let mut stack = vec![path.to_path_buf()];
    while let Some(current) = stack.pop() {
        let read_dir = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in read_dir.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                stack.push(entry_path);
            } else if let Ok(meta) = entry.metadata() {
                total = total.saturating_add(meta.len());
            }
        }
    }
    total
}

fn dir_last_modified(path: &Path) -> Option<String> {
    let mut latest: Option<SystemTime> = None;
    let mut stack = vec![path.to_path_buf()];
    while let Some(current) = stack.pop() {
        let read_dir = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in read_dir.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                stack.push(entry_path);
            }
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    latest = Some(match latest {
                        Some(current_latest) if current_latest > modified => current_latest,
                        _ => modified,
                    });
                }
            }
        }
    }
    latest.map(|time| {
        let duration = time.duration_since(UNIX_EPOCH).unwrap_or_default();
        format!("{}", duration.as_secs())
    })
}
