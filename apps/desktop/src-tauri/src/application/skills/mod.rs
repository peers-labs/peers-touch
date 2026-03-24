use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{
    BuiltinSkillIdInput, SkillCreateInput, SkillIdInput, SkillsListInput, SkillsSearchInput, SkillToggleInput,
    SkillUpdateInput, StubPayload,
};
use serde_json::json;
use std::sync::{Mutex, OnceLock};

#[derive(Clone)]
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

#[derive(Default)]
struct SkillStore {
    skills: Vec<SkillRecord>,
}

impl SkillStore {
    fn seeded() -> Self {
        Self {
            skills: vec![SkillRecord {
                id: "skill-1".to_string(),
                identifier: "web-search".to_string(),
                name: "Web Search".to_string(),
                description: "Search from web".to_string(),
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
    SKILL_STORE.get_or_init(|| Mutex::new(SkillStore::seeded()))
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

fn internal_error() -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InternalError, "failed to access skill store", None)
}

pub fn skills_list(input: SkillsListInput) -> AppResult<StubPayload> {
    let guard = match skill_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
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
    success_payload("skills_list", json!({ "skills": skills, "builtin": builtin }))
}

pub fn skills_search(input: SkillsSearchInput) -> AppResult<StubPayload> {
    let q = input.q.trim().to_lowercase();
    if q.is_empty() {
        return invalid_argument("q is required");
    }
    let guard = match skill_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let limit = input.limit.unwrap_or(20) as usize;
    let skills = guard
        .skills
        .iter()
        .filter(|item| item.name.to_lowercase().contains(&q) || item.description.to_lowercase().contains(&q))
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
        Err(_) => return internal_error(),
    };
    if let Some(skill) = guard.skills.iter().find(|item| item.id == id) {
        return success_payload("skills_get", skill.detail_json());
    }
    AppResult::fail(ErrorCode::NotFound, "skill not found", None)
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
        Err(_) => return internal_error(),
    };
    let id = format!("skill-{}", guard.skills.len() + 1);
    let identifier = name.to_lowercase().replace(' ', "-");
    let now = "2026-03-24T00:00:00.000Z".to_string();
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
        Err(_) => return internal_error(),
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
        skill.updated_at = "2026-03-24T00:00:00.000Z".to_string();
        return success_payload("skills_update", json!({ "ok": true }));
    }
    AppResult::fail(ErrorCode::NotFound, "skill not found", None)
}

pub fn skills_delete(input: SkillIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match skill_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let before = guard.skills.len();
    guard.skills.retain(|item| item.id != id);
    success_payload("skills_delete", json!({ "ok": before != guard.skills.len() }))
}

pub fn skills_toggle(input: SkillToggleInput) -> AppResult<StubPayload> {
    let mut guard = match skill_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    if let Some(skill) = guard.skills.iter_mut().find(|item| item.id == input.id) {
        skill.enabled = input.enabled;
        return success_payload("skills_toggle", json!({ "ok": true }));
    }
    AppResult::fail(ErrorCode::NotFound, "skill not found", None)
}
