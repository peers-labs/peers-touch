use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::storage;
#[cfg(not(test))]
use crate::infrastructure::storage::StorageKind;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Deserialize, Serialize)]
pub struct A2AListInput {
    pub agent_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct A2AStartInput {
    pub parent_agent_id: String,
    pub parent_agent_name: Option<String>,
    pub child_agent_ids: Vec<String>,
    pub prompt: String,
    pub title: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct A2AUpdateTaskInput {
    pub task_id: String,
    pub status: String,
    pub artifact: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct A2ARunRecord {
    id: String,
    parent_agent_id: String,
    parent_agent_name: String,
    title: String,
    prompt: String,
    status: String,
    transport: String,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct A2ATaskRecord {
    id: String,
    run_id: String,
    parent_agent_id: String,
    child_agent_id: String,
    prompt: String,
    status: String,
    artifact: String,
    audit_event: String,
    transport: String,
    created_at: String,
    updated_at: String,
}

#[derive(Default, Serialize, Deserialize)]
struct A2AStore {
    sequence: u64,
    runs: Vec<A2ARunRecord>,
    tasks: Vec<A2ATaskRecord>,
}

static A2A_STORE: OnceLock<Mutex<A2AStore>> = OnceLock::new();

fn a2a_store() -> &'static Mutex<A2AStore> {
    A2A_STORE.get_or_init(|| Mutex::new(load_a2a_store()))
}

#[cfg(test)]
fn a2a_store_path() -> PathBuf {
    std::env::temp_dir().join(format!("peers-touch-agent-a2a-{}.json", std::process::id()))
}

#[cfg(not(test))]
fn a2a_store_path() -> PathBuf {
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["agent", "a2a", "tasks.json"],
    )
    .unwrap_or_else(|_| PathBuf::from("agent.a2a.tasks.json"))
}

fn load_a2a_store() -> A2AStore {
    let path = a2a_store_path();
    if !path.exists() {
        return A2AStore::default();
    }
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "Failed to read A2A store");
            return A2AStore::default();
        }
    };
    serde_json::from_str::<A2AStore>(&raw).unwrap_or_else(|err| {
        tracing::warn!(path = %path.display(), error = %err, "Failed to parse A2A store");
        A2AStore::default()
    })
}

fn persist_a2a_store(store: &A2AStore) -> Result<(), AppResult<StubPayload>> {
    let path = a2a_store_path();
    let serialized = serde_json::to_string(store).map_err(|err| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to serialize A2A store: {}", err),
            None,
        )
    })?;
    storage::write_string_atomic(&path, &serialized).map_err(|err| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist A2A store: {}", err),
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
    tracing::error!(error = %e, "Failed to acquire A2A store lock");
    AppResult::fail(
        ErrorCode::InternalError,
        format!("Failed to access A2A store: {}", e),
        None,
    )
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn task_json(task: &A2ATaskRecord) -> serde_json::Value {
    json!({
        "id": task.id,
        "run_id": task.run_id,
        "parent_agent_id": task.parent_agent_id,
        "child_agent_id": task.child_agent_id,
        "prompt": task.prompt,
        "status": task.status,
        "artifact": task.artifact,
        "audit_event": task.audit_event,
        "transport": task.transport,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    })
}

fn run_json(run: &A2ARunRecord) -> serde_json::Value {
    json!({
        "id": run.id,
        "parent_agent_id": run.parent_agent_id,
        "parent_agent_name": run.parent_agent_name,
        "title": run.title,
        "prompt": run.prompt,
        "status": run.status,
        "transport": run.transport,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
    })
}

pub fn agent_a2a_list(input: A2AListInput) -> AppResult<StubPayload> {
    let agent_id = input.agent_id.unwrap_or_default();
    let guard = match a2a_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let tasks = guard
        .tasks
        .iter()
        .filter(|task| {
            agent_id.trim().is_empty()
                || task.parent_agent_id == agent_id
                || task.child_agent_id == agent_id
        })
        .map(task_json)
        .collect::<Vec<_>>();
    let runs = guard
        .runs
        .iter()
        .filter(|run| agent_id.trim().is_empty() || run.parent_agent_id == agent_id)
        .map(run_json)
        .collect::<Vec<_>>();
    success_payload("agent_a2a_list", json!({ "runs": runs, "tasks": tasks }))
}

pub fn agent_a2a_start(input: A2AStartInput) -> AppResult<StubPayload> {
    let parent_agent_id = input.parent_agent_id.trim().to_string();
    let prompt = input.prompt.trim().to_string();
    let child_agent_ids = input
        .child_agent_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty() && id != &parent_agent_id)
        .collect::<Vec<_>>();
    if parent_agent_id.is_empty() {
        return invalid_argument("parent_agent_id is required");
    }
    if prompt.is_empty() {
        return invalid_argument("prompt is required");
    }
    if child_agent_ids.is_empty() {
        return invalid_argument("at least one child agent is required");
    }

    let mut guard = match a2a_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    guard.sequence += 1;
    let now = now_iso();
    let run_id = format!("a2a-run-{}", guard.sequence);
    let run = A2ARunRecord {
        id: run_id.clone(),
        parent_agent_id: parent_agent_id.clone(),
        parent_agent_name: input.parent_agent_name.unwrap_or_default(),
        title: input.title.unwrap_or_else(|| "Agent group run".to_string()),
        prompt: prompt.clone(),
        status: "running".to_string(),
        transport: "local".to_string(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let mut created_tasks = Vec::new();
    for child_agent_id in child_agent_ids {
        guard.sequence += 1;
        let task = A2ATaskRecord {
            id: format!("a2a-task-{}", guard.sequence),
            run_id: run_id.clone(),
            parent_agent_id: parent_agent_id.clone(),
            child_agent_id,
            prompt: prompt.clone(),
            status: "queued".to_string(),
            artifact: String::new(),
            audit_event: "a2a.task.created".to_string(),
            transport: "local".to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        created_tasks.push(task.clone());
        guard.tasks.push(task);
    }
    guard.runs.push(run.clone());
    if let Err(err) = persist_a2a_store(&guard) {
        return err;
    }
    success_payload(
        "agent_a2a_start",
        json!({
            "run": run_json(&run),
            "tasks": created_tasks.iter().map(task_json).collect::<Vec<_>>()
        }),
    )
}

pub fn agent_a2a_update_task(input: A2AUpdateTaskInput) -> AppResult<StubPayload> {
    let task_id = input.task_id.trim().to_string();
    let status = input.status.trim().to_string();
    if task_id.is_empty() {
        return invalid_argument("task_id is required");
    }
    if status.is_empty() {
        return invalid_argument("status is required");
    }
    let mut guard = match a2a_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let now = now_iso();
    let Some(task_index) = guard.tasks.iter().position(|task| task.id == task_id) else {
        return AppResult::fail(ErrorCode::NotFound, "A2A task not found", None);
    };
    guard.tasks[task_index].status = status;
    if let Some(artifact) = input.artifact {
        guard.tasks[task_index].artifact = artifact;
    }
    guard.tasks[task_index].audit_event = "a2a.task.updated".to_string();
    guard.tasks[task_index].updated_at = now.clone();
    let run_id = guard.tasks[task_index].run_id.clone();
    let task_payload = task_json(&guard.tasks[task_index]);
    let run_tasks = guard
        .tasks
        .iter()
        .filter(|task| task.run_id == run_id)
        .cloned()
        .collect::<Vec<_>>();
    let run_status = if run_tasks.iter().any(|task| task.status == "failed") {
        "failed"
    } else if run_tasks
        .iter()
        .all(|task| ["accepted", "completed"].contains(&task.status.as_str()))
    {
        "completed"
    } else {
        "running"
    };
    if let Some(run) = guard.runs.iter_mut().find(|run| run.id == run_id) {
        run.status = run_status.to_string();
        run.updated_at = now;
    }
    if let Err(err) = persist_a2a_store(&guard) {
        return err;
    }
    success_payload("agent_a2a_update_task", json!({ "task": task_payload }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a2a_start_should_create_local_tasks() {
        let result = agent_a2a_start(A2AStartInput {
            parent_agent_id: "parent".to_string(),
            parent_agent_name: Some("Parent".to_string()),
            child_agent_ids: vec!["child-a".to_string(), "child-b".to_string()],
            prompt: "Review this plan".to_string(),
            title: Some("Review".to_string()),
        });
        assert!(result.ok);
        let status: serde_json::Value =
            serde_json::from_str(&result.data.expect("payload").status).expect("json");
        assert_eq!(status["tasks"].as_array().expect("tasks").len(), 2);
    }

    #[test]
    fn a2a_update_should_refresh_run_status() {
        let result = agent_a2a_start(A2AStartInput {
            parent_agent_id: "owner".to_string(),
            parent_agent_name: None,
            child_agent_ids: vec!["worker".to_string()],
            prompt: "Summarize".to_string(),
            title: None,
        });
        let status: serde_json::Value =
            serde_json::from_str(&result.data.expect("payload").status).expect("json");
        let task_id = status["tasks"][0]["id"].as_str().expect("task").to_string();
        let update = agent_a2a_update_task(A2AUpdateTaskInput {
            task_id,
            status: "accepted".to_string(),
            artifact: Some("done".to_string()),
        });
        assert!(update.ok);
        let list = agent_a2a_list(A2AListInput {
            agent_id: Some("owner".to_string()),
        });
        let status: serde_json::Value =
            serde_json::from_str(&list.data.expect("payload").status).expect("json");
        assert!(status["runs"]
            .as_array()
            .expect("runs")
            .iter()
            .any(|run| { run["parent_agent_id"] == "owner" && run["status"] == "completed" }));
    }
}
