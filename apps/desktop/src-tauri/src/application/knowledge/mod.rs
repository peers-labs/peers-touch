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
pub struct KnowledgeListInput {
    pub agent_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct KnowledgeBindInput {
    pub agent_id: String,
    pub title: String,
    pub resource_type: String,
    pub source: String,
    pub retrieval_policy: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct KnowledgeUpdateInput {
    pub id: String,
    pub enabled: Option<bool>,
    pub retrieval_policy: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct KnowledgeDeleteInput {
    pub id: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct KnowledgeResourceRecord {
    id: String,
    agent_id: String,
    title: String,
    resource_type: String,
    source: String,
    retrieval_policy: String,
    notes: String,
    enabled: bool,
    audit_event: String,
    created_at: String,
    updated_at: String,
}

#[derive(Default, Serialize, Deserialize)]
struct KnowledgeStore {
    sequence: u64,
    resources: Vec<KnowledgeResourceRecord>,
}

static KNOWLEDGE_STORE: OnceLock<Mutex<KnowledgeStore>> = OnceLock::new();

fn knowledge_store() -> &'static Mutex<KnowledgeStore> {
    KNOWLEDGE_STORE.get_or_init(|| Mutex::new(load_knowledge_store()))
}

#[cfg(test)]
fn knowledge_store_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "peers-touch-agent-knowledge-{}.json",
        std::process::id()
    ))
}

#[cfg(not(test))]
fn knowledge_store_path() -> PathBuf {
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["agent", "knowledge", "resources.json"],
    )
    .unwrap_or_else(|_| PathBuf::from("agent.knowledge.resources.json"))
}

fn load_knowledge_store() -> KnowledgeStore {
    let path = knowledge_store_path();
    if !path.exists() {
        return KnowledgeStore::default();
    }
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "Failed to read knowledge store");
            return KnowledgeStore::default();
        }
    };
    serde_json::from_str::<KnowledgeStore>(&raw).unwrap_or_else(|err| {
        tracing::warn!(path = %path.display(), error = %err, "Failed to parse knowledge store");
        KnowledgeStore::default()
    })
}

fn persist_knowledge_store(store: &KnowledgeStore) -> Result<(), AppResult<StubPayload>> {
    let path = knowledge_store_path();
    let serialized = serde_json::to_string(store).map_err(|err| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to serialize knowledge store: {}", err),
            None,
        )
    })?;
    storage::write_string_atomic(&path, &serialized).map_err(|err| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist knowledge store: {}", err),
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
    tracing::error!(error = %e, "Failed to acquire knowledge store lock");
    AppResult::fail(
        ErrorCode::InternalError,
        format!("Failed to access knowledge store: {}", e),
        None,
    )
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn resource_json(resource: &KnowledgeResourceRecord) -> serde_json::Value {
    json!({
        "id": resource.id,
        "agent_id": resource.agent_id,
        "title": resource.title,
        "resource_type": resource.resource_type,
        "source": resource.source,
        "retrieval_policy": resource.retrieval_policy,
        "notes": resource.notes,
        "enabled": resource.enabled,
        "audit_event": resource.audit_event,
        "created_at": resource.created_at,
        "updated_at": resource.updated_at,
    })
}

pub fn agent_knowledge_list(input: KnowledgeListInput) -> AppResult<StubPayload> {
    let agent_id = input.agent_id.unwrap_or_default();
    let guard = match knowledge_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let resources = guard
        .resources
        .iter()
        .filter(|resource| agent_id.trim().is_empty() || resource.agent_id == agent_id)
        .map(resource_json)
        .collect::<Vec<_>>();
    success_payload("agent_knowledge_list", json!({ "resources": resources }))
}

pub fn agent_knowledge_bind(input: KnowledgeBindInput) -> AppResult<StubPayload> {
    let agent_id = input.agent_id.trim().to_string();
    let title = input.title.trim().to_string();
    let source = input.source.trim().to_string();
    let resource_type = input.resource_type.trim().to_string();
    if agent_id.is_empty() {
        return invalid_argument("agent_id is required");
    }
    if title.is_empty() {
        return invalid_argument("title is required");
    }
    if source.is_empty() {
        return invalid_argument("source is required");
    }
    let mut guard = match knowledge_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    guard.sequence += 1;
    let now = now_iso();
    let resource = KnowledgeResourceRecord {
        id: format!("knowledge-{}", guard.sequence),
        agent_id,
        title,
        resource_type: if resource_type.is_empty() {
            "document".to_string()
        } else {
            resource_type
        },
        source,
        retrieval_policy: input
            .retrieval_policy
            .unwrap_or_else(|| "auto".to_string())
            .trim()
            .to_string(),
        notes: String::new(),
        enabled: true,
        audit_event: "knowledge.resource.bound".to_string(),
        created_at: now.clone(),
        updated_at: now,
    };
    guard.resources.push(resource.clone());
    if let Err(err) = persist_knowledge_store(&guard) {
        return err;
    }
    success_payload(
        "agent_knowledge_bind",
        json!({ "resource": resource_json(&resource) }),
    )
}

pub fn agent_knowledge_update(input: KnowledgeUpdateInput) -> AppResult<StubPayload> {
    let id = input.id.trim().to_string();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match knowledge_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let Some(resource) = guard
        .resources
        .iter_mut()
        .find(|resource| resource.id == id)
    else {
        return AppResult::fail(ErrorCode::NotFound, "Knowledge resource not found", None);
    };
    if let Some(enabled) = input.enabled {
        resource.enabled = enabled;
    }
    if let Some(policy) = input.retrieval_policy {
        resource.retrieval_policy = policy.trim().to_string();
    }
    if let Some(notes) = input.notes {
        resource.notes = notes;
    }
    resource.audit_event = "knowledge.resource.updated".to_string();
    resource.updated_at = now_iso();
    let payload = resource_json(resource);
    if let Err(err) = persist_knowledge_store(&guard) {
        return err;
    }
    success_payload("agent_knowledge_update", json!({ "resource": payload }))
}

pub fn agent_knowledge_delete(input: KnowledgeDeleteInput) -> AppResult<StubPayload> {
    let id = input.id.trim().to_string();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match knowledge_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let before = guard.resources.len();
    guard.resources.retain(|resource| resource.id != id);
    if let Err(err) = persist_knowledge_store(&guard) {
        return err;
    }
    success_payload(
        "agent_knowledge_delete",
        json!({ "ok": before != guard.resources.len() }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knowledge_should_bind_and_update_resource() {
        let created = agent_knowledge_bind(KnowledgeBindInput {
            agent_id: "agent-a".to_string(),
            title: "Project brief".to_string(),
            resource_type: "project".to_string(),
            source: "/tmp/project.md".to_string(),
            retrieval_policy: Some("manual".to_string()),
        });
        assert!(created.ok);
        let status: serde_json::Value =
            serde_json::from_str(&created.data.expect("payload").status).expect("json");
        let id = status["resource"]["id"].as_str().expect("id").to_string();
        let updated = agent_knowledge_update(KnowledgeUpdateInput {
            id,
            enabled: Some(false),
            retrieval_policy: Some("off".to_string()),
            notes: Some("disabled for review".to_string()),
        });
        assert!(updated.ok);
        let list = agent_knowledge_list(KnowledgeListInput {
            agent_id: Some("agent-a".to_string()),
        });
        let status: serde_json::Value =
            serde_json::from_str(&list.data.expect("payload").status).expect("json");
        assert_eq!(status["resources"][0]["enabled"], false);
        assert_eq!(status["resources"][0]["retrieval_policy"], "off");
    }
}
