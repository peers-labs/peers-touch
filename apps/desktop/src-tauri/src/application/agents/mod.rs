use crate::contracts::{
    AgentCreateInput, AgentDuplicateInput, AgentIdInput, AgentSearchInput, AgentUpdateInput,
    AgentsReorderInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::infrastructure::actor_bucket::actor_bucket_id;

#[derive(Clone)]
struct AgentRecord {
    id: String,
    data: Value,
}

#[derive(Default)]
struct AgentStore {
    agents: Vec<AgentRecord>,
}

impl AgentStore {
    fn seeded() -> Self {
        Self {
            agents: vec![AgentRecord {
                id: "agent-1".to_string(),
                data: json!({
                    "id":"agent-1",
                    "name":"assistant",
                    "title":"i18n:agent.default.title",
                    "description":"",
                    "avatar":"🤖",
                    "scope":"general",
                    "pinned": true,
                    "sortOrder": 0,
                    "isDefault": true
                }),
            }],
        }
    }
}

struct AgentStores {
    buckets: HashMap<String, AgentStore>,
}

static AGENT_STORES: OnceLock<Mutex<AgentStores>> = OnceLock::new();

fn agent_stores() -> &'static Mutex<AgentStores> {
    AGENT_STORES.get_or_init(|| {
        Mutex::new(AgentStores {
            buckets: HashMap::new(),
        })
    })
}

fn with_agent_app_result<F>(actor_id: &str, f: F) -> AppResult<StubPayload>
where
    F: FnOnce(&mut AgentStore) -> AppResult<StubPayload>,
{
    let key = actor_bucket_id(actor_id);
    let mut stores = match agent_stores().lock() {
        Ok(g) => g,
        Err(e) => return store_lock_error(e),
    };
    let store = stores.buckets.entry(key).or_insert_with(AgentStore::seeded);
    f(store)
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
    tracing::error!(error = %e, "Failed to acquire agents store lock");
    AppResult::fail(
        ErrorCode::InternalError,
        format!("Failed to access agents store: {}", e),
        None,
    )
}

fn normalized_agent_data(record: &AgentRecord, index: usize) -> Value {
    let mut data = record.data.clone();
    if let Some(obj) = data.as_object_mut() {
        obj.entry("id").or_insert_with(|| json!(record.id.clone()));
        obj.entry("pinned").or_insert_with(|| json!(false));
        obj.entry("sortOrder")
            .or_insert_with(|| json!(index as i64));
    }
    data
}

fn sort_agents(records: &mut [AgentRecord]) {
    records.sort_by(|a, b| {
        let a_pinned = a
            .data
            .get("pinned")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let b_pinned = b
            .data
            .get("pinned")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let a_order = a
            .data
            .get("sortOrder")
            .and_then(Value::as_i64)
            .unwrap_or(i64::MAX);
        let b_order = b
            .data
            .get("sortOrder")
            .and_then(Value::as_i64)
            .unwrap_or(i64::MAX);
        b_pinned
            .cmp(&a_pinned)
            .then_with(|| a_order.cmp(&b_order))
            .then_with(|| a.id.cmp(&b.id))
    });
}

pub fn agents_list(actor_id: &str) -> AppResult<StubPayload> {
    with_agent_app_result(actor_id, |store| {
        sort_agents(&mut store.agents);
        let agents = store
            .agents
            .iter()
            .enumerate()
            .map(|(index, item)| normalized_agent_data(item, index))
            .collect::<Vec<_>>();
        tracing::info!(
            command = "agents_list",
            count = agents.len(),
            "Agents listed"
        );
        success_payload("agents_list", json!({ "agents": agents }))
    })
}

pub fn agents_get(actor_id: &str, input: AgentIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    with_agent_app_result(actor_id, |store| {
        if let Some(agent) = store.agents.iter().find(|item| item.id == input.id) {
            return success_payload("agents_get", agent.data.clone());
        }
        AppResult::fail(ErrorCode::NotFound, "Agent not found", None)
    })
}

pub(crate) fn agent_data_by_identifier(actor_id: &str, identifier: &str) -> Option<Value> {
    let key = actor_bucket_id(actor_id);
    let mut stores = agent_stores().lock().ok()?;
    let store = stores.buckets.entry(key).or_insert_with(AgentStore::seeded);
    store
        .agents
        .iter()
        .find(|item| {
            item.id == identifier
                || item
                    .data
                    .get("name")
                    .and_then(Value::as_str)
                    .map(|name| name == identifier)
                    .unwrap_or(false)
        })
        .map(|item| normalized_agent_data(item, 0))
}

pub fn agents_create(actor_id: &str, input: AgentCreateInput) -> AppResult<StubPayload> {
    with_agent_app_result(actor_id, |store| {
        let id = format!("agent-{}", store.agents.len() + 1);
        tracing::info!(command = "agents_create", agent_id = %id, "Creating agent");
        let mut data = input.data;
        if let Some(obj) = data.as_object_mut() {
            obj.insert("id".to_string(), json!(id.clone()));
            obj.entry("pinned".to_string())
                .or_insert_with(|| json!(false));
            obj.entry("sortOrder".to_string())
                .or_insert_with(|| json!(store.agents.len() as i64));
        }
        store.agents.push(AgentRecord {
            id,
            data: data.clone(),
        });
        success_payload("agents_create", data)
    })
}

pub fn agents_update(actor_id: &str, input: AgentUpdateInput) -> AppResult<StubPayload> {
    tracing::info!(command = "agents_update", agent_id = %input.id, "Updating agent");
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    with_agent_app_result(actor_id, |store| {
        if let Some(agent) = store.agents.iter_mut().find(|item| item.id == input.id) {
            let mut data = agent.data.clone();
            if let (Some(base), Some(update)) = (data.as_object_mut(), input.data.as_object()) {
                for (key, value) in update {
                    base.insert(key.clone(), value.clone());
                }
                base.insert("id".to_string(), json!(input.id));
            } else {
                data = input.data;
                if let Some(obj) = data.as_object_mut() {
                    obj.insert("id".to_string(), json!(input.id));
                }
            }
            agent.data = data.clone();
            return success_payload("agents_update", data);
        }
        AppResult::fail(ErrorCode::NotFound, "Agent not found", None)
    })
}

pub fn agents_delete(actor_id: &str, input: AgentIdInput) -> AppResult<StubPayload> {
    tracing::info!(command = "agents_delete", agent_id = %input.id, "Deleting agent");
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    with_agent_app_result(actor_id, |store| {
        let before = store.agents.len();
        store.agents.retain(|item| item.id != input.id);
        success_payload(
            "agents_delete",
            json!({ "ok": before != store.agents.len() }),
        )
    })
}

pub fn agents_reorder(actor_id: &str, input: AgentsReorderInput) -> AppResult<StubPayload> {
    if input.items.is_empty() {
        return invalid_argument("items is required");
    }
    with_agent_app_result(actor_id, |store| {
        for item in &input.items {
            if item.id.trim().is_empty() {
                return invalid_argument("item id is required");
            }
            if !store.agents.iter().any(|agent| agent.id == item.id) {
                return AppResult::fail(ErrorCode::NotFound, "Agent not found", None);
            }
        }

        for item in input.items {
            if let Some(agent) = store.agents.iter_mut().find(|agent| agent.id == item.id) {
                if let Some(obj) = agent.data.as_object_mut() {
                    obj.insert("pinned".to_string(), json!(item.pinned));
                    obj.insert("sortOrder".to_string(), json!(item.sort_order));
                }
            }
        }
        sort_agents(&mut store.agents);
        let agents = store
            .agents
            .iter()
            .enumerate()
            .map(|(index, item)| normalized_agent_data(item, index))
            .collect::<Vec<_>>();
        success_payload("agents_reorder", json!({ "agents": agents }))
    })
}

pub fn agents_duplicate(actor_id: &str, input: AgentDuplicateInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() || input.name.trim().is_empty() {
        return invalid_argument("id and name are required");
    }
    with_agent_app_result(actor_id, |store| {
        if let Some(agent) = store.agents.iter().find(|item| item.id == input.id) {
            let id = format!("agent-{}", store.agents.len() + 1);
            let mut data = agent.data.clone();
            if let Some(obj) = data.as_object_mut() {
                obj.insert("id".to_string(), json!(id.clone()));
                obj.insert("name".to_string(), json!(input.name));
                obj.insert("pinned".to_string(), json!(false));
                obj.insert("sortOrder".to_string(), json!(store.agents.len() as i64));
            }
            store.agents.push(AgentRecord {
                id,
                data: data.clone(),
            });
            return success_payload("agents_duplicate", data);
        }
        AppResult::fail(ErrorCode::NotFound, "Agent not found", None)
    })
}

pub fn agents_search(actor_id: &str, input: AgentSearchInput) -> AppResult<StubPayload> {
    if input.q.trim().is_empty() {
        return invalid_argument("q is required");
    }
    with_agent_app_result(actor_id, |store| {
        let q = input.q.to_lowercase();
        sort_agents(&mut store.agents);
        let agents = store
            .agents
            .iter()
            .enumerate()
            .filter(|item| {
                item.1
                    .data
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&q)
            })
            .map(|(index, item)| normalized_agent_data(item, index))
            .collect::<Vec<_>>();
        success_payload("agents_search", json!({ "agents": agents }))
    })
}

pub fn agents_list_sessions(actor_id: &str, input: AgentIdInput) -> AppResult<StubPayload> {
    tracing::info!(command = "agents_list_sessions", agent_id = %input.id, "Listing agent sessions");
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let agent_name = {
        let mut stores = match agent_stores().lock() {
            Ok(g) => g,
            Err(e) => return store_lock_error(e),
        };
        let key = actor_bucket_id(actor_id);
        let store = stores.buckets.entry(key).or_insert_with(AgentStore::seeded);
        match store.agents.iter().find(|item| item.id == input.id) {
            Some(agent) => agent
                .data
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("assistant")
                .to_string(),
            None => return AppResult::fail(ErrorCode::NotFound, "Agent not found", None),
        }
    };
    let sessions = crate::application::chat::list_conversations_by_agent(actor_id, &agent_name);
    tracing::debug!(command = "agents_list_sessions", agent_id = %input.id, count = sessions.len(), "Agent sessions retrieved");
    success_payload("agents_list_sessions", json!({ "sessions": sessions }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_stores_isolate_actors() {
        let a = "actor-agent-a";
        let b = "actor-agent-b";
        let create = AgentCreateInput {
            data: json!({ "name": "unique-x", "title": "t" }),
        };
        let created = agents_create(a, create);
        assert!(created.ok, "create a");
        let list_b = agents_list(b);
        assert!(list_b.ok, "list b");
        let payload = list_b.data.expect("payload");
        let v: Value = serde_json::from_str(&payload.status).expect("json");
        let n = v
            .get("agents")
            .and_then(|a| a.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        assert_eq!(n, 1, "B should only have the default seeded agent");
        let list_a = agents_list(a);
        assert!(list_a.ok, "list a");
        let p2 = list_a.data.expect("payload");
        let v2: Value = serde_json::from_str(&p2.status).expect("json");
        let n2 = v2
            .get("agents")
            .and_then(|a| a.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        assert_eq!(n2, 2);
    }
}
