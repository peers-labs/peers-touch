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
pub struct TaskReviewListInput {
    pub agent_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TaskReviewUpdateInput {
    pub agent_id: String,
    pub target_id: String,
    pub target_type: String,
    pub status: String,
    pub note: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct TaskReviewRecord {
    id: String,
    agent_id: String,
    target_id: String,
    target_type: String,
    status: String,
    note: String,
    audit_event: String,
    created_at: String,
    updated_at: String,
}

#[derive(Default, Serialize, Deserialize)]
struct TaskReviewStore {
    sequence: u64,
    reviews: Vec<TaskReviewRecord>,
}

static TASK_REVIEW_STORE: OnceLock<Mutex<TaskReviewStore>> = OnceLock::new();

fn task_review_store() -> &'static Mutex<TaskReviewStore> {
    TASK_REVIEW_STORE.get_or_init(|| Mutex::new(load_task_review_store()))
}

#[cfg(test)]
fn task_review_store_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "peers-touch-agent-task-reviews-{}.json",
        std::process::id()
    ))
}

#[cfg(not(test))]
fn task_review_store_path() -> PathBuf {
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["agent", "task-board", "reviews.json"],
    )
    .unwrap_or_else(|_| PathBuf::from("agent.task.reviews.json"))
}

fn load_task_review_store() -> TaskReviewStore {
    let path = task_review_store_path();
    if !path.exists() {
        return TaskReviewStore::default();
    }
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "Failed to read task review store");
            return TaskReviewStore::default();
        }
    };
    serde_json::from_str::<TaskReviewStore>(&raw).unwrap_or_else(|err| {
        tracing::warn!(path = %path.display(), error = %err, "Failed to parse task review store");
        TaskReviewStore::default()
    })
}

fn persist_task_review_store(store: &TaskReviewStore) -> Result<(), AppResult<StubPayload>> {
    let path = task_review_store_path();
    let serialized = serde_json::to_string(store).map_err(|err| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to serialize task review store: {}", err),
            None,
        )
    })?;
    storage::write_string_atomic(&path, &serialized).map_err(|err| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist task review store: {}", err),
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
    tracing::error!(error = %e, "Failed to acquire task review store lock");
    AppResult::fail(
        ErrorCode::InternalError,
        format!("Failed to access task review store: {}", e),
        None,
    )
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn review_json(review: &TaskReviewRecord) -> serde_json::Value {
    json!({
        "id": review.id,
        "agent_id": review.agent_id,
        "target_id": review.target_id,
        "target_type": review.target_type,
        "status": review.status,
        "note": review.note,
        "audit_event": review.audit_event,
        "created_at": review.created_at,
        "updated_at": review.updated_at,
    })
}

pub fn agent_task_reviews_list(input: TaskReviewListInput) -> AppResult<StubPayload> {
    let agent_id = input.agent_id.unwrap_or_default();
    let guard = match task_review_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let reviews = guard
        .reviews
        .iter()
        .filter(|review| agent_id.trim().is_empty() || review.agent_id == agent_id)
        .map(review_json)
        .collect::<Vec<_>>();
    success_payload("agent_task_reviews_list", json!({ "reviews": reviews }))
}

pub fn agent_task_review_update(input: TaskReviewUpdateInput) -> AppResult<StubPayload> {
    let agent_id = input.agent_id.trim().to_string();
    let target_id = input.target_id.trim().to_string();
    let target_type = input.target_type.trim().to_string();
    let status = input.status.trim().to_string();
    if agent_id.is_empty() || target_id.is_empty() || target_type.is_empty() || status.is_empty() {
        return invalid_argument("agent_id, target_id, target_type, and status are required");
    }
    let mut guard = match task_review_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let now = now_iso();
    if let Some(review) = guard
        .reviews
        .iter_mut()
        .find(|review| review.agent_id == agent_id && review.target_id == target_id)
    {
        review.status = status;
        if let Some(note) = input.note {
            review.note = note;
        }
        review.audit_event = "task.review.updated".to_string();
        review.updated_at = now;
        let payload = review_json(review);
        if let Err(err) = persist_task_review_store(&guard) {
            return err;
        }
        return success_payload("agent_task_review_update", json!({ "review": payload }));
    }

    guard.sequence += 1;
    let review = TaskReviewRecord {
        id: format!("task-review-{}", guard.sequence),
        agent_id,
        target_id,
        target_type,
        status,
        note: input.note.unwrap_or_default(),
        audit_event: "task.review.created".to_string(),
        created_at: now.clone(),
        updated_at: now,
    };
    guard.reviews.push(review.clone());
    if let Err(err) = persist_task_review_store(&guard) {
        return err;
    }
    success_payload(
        "agent_task_review_update",
        json!({ "review": review_json(&review) }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_review_should_upsert_by_agent_and_target() {
        let first = agent_task_review_update(TaskReviewUpdateInput {
            agent_id: "agent-a".to_string(),
            target_id: "cron-1".to_string(),
            target_type: "cron_job".to_string(),
            status: "accepted".to_string(),
            note: Some("ok".to_string()),
        });
        assert!(first.ok);
        let second = agent_task_review_update(TaskReviewUpdateInput {
            agent_id: "agent-a".to_string(),
            target_id: "cron-1".to_string(),
            target_type: "cron_job".to_string(),
            status: "needs_changes".to_string(),
            note: None,
        });
        assert!(second.ok);
        let list = agent_task_reviews_list(TaskReviewListInput {
            agent_id: Some("agent-a".to_string()),
        });
        let status: serde_json::Value =
            serde_json::from_str(&list.data.expect("payload").status).unwrap();
        assert_eq!(status["reviews"].as_array().unwrap().len(), 1);
        assert_eq!(status["reviews"][0]["status"], "needs_changes");
    }
}
