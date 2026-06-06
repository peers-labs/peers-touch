use crate::contracts::{
    BuiltinSkillIdInput, SkillCreateInput, SkillIdInput, SkillToggleInput, SkillUpdateInput,
    SkillsListInput, SkillsSearchInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::storage;
#[cfg(not(test))]
use crate::infrastructure::storage::StorageKind;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Serialize, Deserialize)]
struct SkillRecord {
    id: String,
    identifier: String,
    name: String,
    description: String,
    enabled: bool,
    content: String,
    created_at: String,
    updated_at: String,
}

impl SkillRecord {
    fn list_json(&self) -> serde_json::Value {
        json!({
            "id": self.id,
            "identifier": self.identifier,
            "name": self.name,
            "description": self.description,
            "version": "1.0.0",
            "authorName": "Peers",
            "metaAvatar": "",
            "metaTitle": self.name,
            "metaTags": [],
            "source": "user",
            "enabled": self.enabled,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "useCount": 0
        })
    }

    fn detail_json(&self) -> serde_json::Value {
        let mut base = self.list_json();
        if let Some(obj) = base.as_object_mut() {
            obj.insert("authorUrl".to_string(), json!(""));
            obj.insert("license".to_string(), json!("MIT"));
            obj.insert("repository".to_string(), json!(""));
            obj.insert("sourceUrl".to_string(), json!(""));
            obj.insert("permissions".to_string(), json!([]));
            obj.insert("content".to_string(), json!(self.content));
            obj.insert("metaDescription".to_string(), json!(self.description));
            obj.insert("metaBackgroundColor".to_string(), json!(""));
            obj.insert("keywords".to_string(), json!([]));
            obj.insert("globs".to_string(), json!([]));
            obj.insert("agentOnly".to_string(), json!([]));
            obj.insert("sourceUri".to_string(), json!(""));
            obj.insert("zipFileHash".to_string(), json!(""));
        }
        base
    }
}

#[derive(Default, Serialize, Deserialize)]
struct SkillStore {
    sequence: u64,
    skills: Vec<SkillRecord>,
}

impl SkillStore {
    fn seeded() -> Self {
        Self {
            sequence: 1,
            skills: vec![SkillRecord {
                id: "skill-1".to_string(),
                identifier: "web-search".to_string(),
                name: "i18n:skills.webSearch.name".to_string(),
                description: "i18n:skills.webSearch.description".to_string(),
                enabled: true,
                content: "name: Web Search".to_string(),
                created_at: "2026-01-01T00:00:00.000Z".to_string(),
                updated_at: "2026-01-01T00:00:00.000Z".to_string(),
            }],
        }
    }
}

static SKILL_STORE: OnceLock<Mutex<SkillStore>> = OnceLock::new();

fn skill_store() -> &'static Mutex<SkillStore> {
    SKILL_STORE.get_or_init(|| Mutex::new(load_skill_store()))
}

#[cfg(test)]
fn skill_store_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "peers-touch-agent-skills-{}.json",
        std::process::id()
    ))
}

#[cfg(not(test))]
fn skill_store_path() -> PathBuf {
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["agent", "skills", "skills.json"],
    )
    .unwrap_or_else(|_| PathBuf::from("agent.skills.json"))
}

fn load_skill_store() -> SkillStore {
    let path = skill_store_path();
    if !path.exists() {
        return SkillStore::seeded();
    }
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "Failed to read skill store");
            return SkillStore::seeded();
        }
    };
    serde_json::from_str::<SkillStore>(&raw).unwrap_or_else(|err| {
        tracing::warn!(path = %path.display(), error = %err, "Failed to parse skill store");
        SkillStore::seeded()
    })
}

fn persist_skill_store(store: &SkillStore) -> Result<(), AppResult<StubPayload>> {
    let path = skill_store_path();
    let serialized = serde_json::to_string(store).map_err(|err| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to serialize skill store: {}", err),
            None,
        )
    })?;
    storage::write_string_atomic(&path, &serialized).map_err(|err| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist skill store: {}", err),
            None,
        )
    })
}

fn now_iso() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("unix-ms:{millis}")
}

fn slugify(value: &str) -> String {
    let slug = value
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "skill".to_string()
    } else {
        slug
    }
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
    tracing::error!(error = %e, "Failed to acquire skills store lock");
    AppResult::fail(
        ErrorCode::InternalError,
        format!("Failed to access skills store: {}", e),
        None,
    )
}

pub fn skills_list(input: SkillsListInput) -> AppResult<StubPayload> {
    let guard = match skill_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let source = input.source.unwrap_or_else(|| "all".to_string());
    let skills = guard
        .skills
        .iter()
        .filter(|_| source == "all" || source == "user")
        .map(SkillRecord::list_json)
        .collect::<Vec<_>>();
    let builtin = vec![json!({
        "identifier": "builtin-file-search",
        "name": "File Search",
        "description": "Search files",
        "keywords": [],
        "avatar": "",
        "useCount": 0
    })];
    success_payload(
        "skills_list",
        json!({ "skills": skills, "builtin": builtin }),
    )
}

pub(crate) fn enabled_skill_index() -> Vec<serde_json::Value> {
    let guard = match skill_store().lock() {
        Ok(guard) => guard,
        Err(e) => {
            tracing::error!(error = %e, "Failed to read skill index");
            return vec![];
        }
    };
    guard
        .skills
        .iter()
        .filter(|item| item.enabled)
        .map(|item| {
            json!({
                "id": item.id,
                "identifier": item.identifier,
                "name": item.name,
                "description": item.description,
            })
        })
        .collect()
}

pub fn skills_search(input: SkillsSearchInput) -> AppResult<StubPayload> {
    let q = input.q.trim().to_lowercase();
    if q.is_empty() {
        return invalid_argument("q is required");
    }
    let guard = match skill_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let limit = input.limit.unwrap_or(20) as usize;
    let skills = guard
        .skills
        .iter()
        .filter(|item| {
            item.name.to_lowercase().contains(&q) || item.description.to_lowercase().contains(&q)
        })
        .take(limit)
        .map(SkillRecord::list_json)
        .collect::<Vec<_>>();
    success_payload("skills_search", json!({ "skills": skills }))
}

pub fn skills_get(input: SkillIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let guard = match skill_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    if let Some(skill) = guard.skills.iter().find(|item| item.id == id) {
        return success_payload("skills_get", skill.detail_json());
    }
    AppResult::fail(ErrorCode::NotFound, "Skill not found", None)
}

pub fn skills_get_builtin(input: BuiltinSkillIdInput) -> AppResult<StubPayload> {
    let identifier = input.identifier.trim();
    if identifier.is_empty() {
        return invalid_argument("identifier is required");
    }
    success_payload(
        "skills_get_builtin",
        json!({
            "identifier": identifier,
            "name": "Builtin Skill",
            "description": "",
            "keywords": [],
            "avatar": "",
            "useCount": 0,
            "content": format!("name: {}", identifier)
        }),
    )
}

pub fn skills_create(input: SkillCreateInput) -> AppResult<StubPayload> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let mut guard = match skill_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    guard.sequence = guard.sequence.saturating_add(1);
    let id = format!("skill-{}", guard.sequence);
    let identifier = slugify(name);
    let now = now_iso();
    guard.skills.push(SkillRecord {
        id: id.clone(),
        identifier: identifier.clone(),
        name: name.to_string(),
        description: "".to_string(),
        enabled: true,
        content: input.content,
        created_at: now.clone(),
        updated_at: now,
    });
    if let Err(err) = persist_skill_store(&guard) {
        return err;
    }
    success_payload(
        "skills_create",
        json!({
            "id": id,
            "identifier": identifier,
            "name": name,
            "isNew": true
        }),
    )
}

pub fn skills_update(input: SkillUpdateInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match skill_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    if let Some(skill) = guard.skills.iter_mut().find(|item| item.id == id) {
        if let Some(name) = input.name {
            if !name.trim().is_empty() {
                skill.name = name;
            }
        }
        if let Some(description) = input.description {
            skill.description = description;
        }
        if let Some(content) = input.content {
            skill.content = content;
        }
        if let Some(enabled) = input.enabled {
            skill.enabled = enabled;
        }
        skill.updated_at = now_iso();
        if let Err(err) = persist_skill_store(&guard) {
            return err;
        }
        return success_payload("skills_update", json!({ "ok": true }));
    }
    AppResult::fail(ErrorCode::NotFound, "Skill not found", None)
}

pub fn skills_delete(input: SkillIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match skill_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let before = guard.skills.len();
    guard.skills.retain(|item| item.id != id);
    if before != guard.skills.len() {
        if let Err(err) = persist_skill_store(&guard) {
            return err;
        }
    }
    success_payload(
        "skills_delete",
        json!({ "ok": before != guard.skills.len() }),
    )
}

pub fn skills_toggle(input: SkillToggleInput) -> AppResult<StubPayload> {
    let mut guard = match skill_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    if let Some(skill) = guard.skills.iter_mut().find(|item| item.id == input.id) {
        skill.enabled = input.enabled;
        skill.updated_at = now_iso();
        if let Err(err) = persist_skill_store(&guard) {
            return err;
        }
        return success_payload("skills_toggle", json!({ "ok": true }));
    }
    AppResult::fail(ErrorCode::NotFound, "Skill not found", None)
}

pub(crate) fn install_market_skill(
    identifier: &str,
    name: &str,
    description: &str,
    content: &str,
) -> Result<serde_json::Value, AppResult<StubPayload>> {
    let identifier = slugify(identifier);
    let name = name.trim();
    if name.is_empty() {
        return Err(invalid_argument("name is required"));
    }
    let mut guard = match skill_store().lock() {
        Ok(guard) => guard,
        Err(e) => return Err(store_lock_error(e)),
    };
    if let Some(skill) = guard
        .skills
        .iter_mut()
        .find(|item| item.identifier == identifier)
    {
        skill.name = name.to_string();
        skill.description = description.to_string();
        skill.content = content.to_string();
        skill.enabled = true;
        skill.updated_at = now_iso();
        let result = json!({
            "id": skill.id,
            "identifier": skill.identifier,
            "name": skill.name,
            "isNew": false
        });
        persist_skill_store(&guard)?;
        return Ok(result);
    }

    guard.sequence = guard.sequence.saturating_add(1);
    let id = format!("skill-{}", guard.sequence);
    let now = now_iso();
    guard.skills.push(SkillRecord {
        id: id.clone(),
        identifier: identifier.clone(),
        name: name.to_string(),
        description: description.to_string(),
        enabled: true,
        content: content.to_string(),
        created_at: now.clone(),
        updated_at: now,
    });
    persist_skill_store(&guard)?;
    Ok(json!({
        "id": id,
        "identifier": identifier,
        "name": name,
        "isNew": true
    }))
}
