use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{
    AgentCreateInput, AgentDuplicateInput, AgentIdInput, AgentSearchInput, AgentUpdateInput, StubPayload,
};
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};

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
                    "name":"Default Agent",
                    "description":"",
                    "avatar":"🤖",
                    "scope":"general"
                }),
            }],
        }
    }
}

static AGENT_STORE: OnceLock<Mutex<AgentStore>> = OnceLock::new();

fn agent_store() -> &'static Mutex<AgentStore> {
    AGENT_STORE.get_or_init(|| Mutex::new(AgentStore::seeded()))
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
    AppResult::fail(ErrorCode::InternalError, "failed to access agents store", None)
}

pub fn agents_list() -> AppResult<StubPayload> {
    let guard = match agent_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let agents = guard.agents.iter().map(|item| item.data.clone()).collect::<Vec<_>>();
    success_payload("agents_list", json!({ "agents": agents }))
}

pub fn agents_get(input: AgentIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let guard = match agent_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    if let Some(agent) = guard.agents.iter().find(|item| item.id == input.id) {
        return success_payload("agents_get", agent.data.clone());
    }
    AppResult::fail(ErrorCode::NotFound, "agent not found", None)
}

pub fn agents_create(input: AgentCreateInput) -> AppResult<StubPayload> {
    let mut guard = match agent_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let id = format!("agent-{}", guard.agents.len() + 1);
    let mut data = input.data;
    if let Some(obj) = data.as_object_mut() {
        obj.insert("id".to_string(), json!(id.clone()));
    }
    guard.agents.push(AgentRecord {
        id,
        data: data.clone(),
    });
    success_payload("agents_create", data)
}

pub fn agents_update(input: AgentUpdateInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match agent_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    if let Some(agent) = guard.agents.iter_mut().find(|item| item.id == input.id) {
        let mut data = input.data;
        if let Some(obj) = data.as_object_mut() {
            obj.insert("id".to_string(), json!(input.id));
        }
        agent.data = data.clone();
        return success_payload("agents_update", data);
    }
    AppResult::fail(ErrorCode::NotFound, "agent not found", None)
}

pub fn agents_delete(input: AgentIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match agent_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let before = guard.agents.len();
    guard.agents.retain(|item| item.id != input.id);
    success_payload("agents_delete", json!({ "ok": before != guard.agents.len() }))
}

pub fn agents_duplicate(input: AgentDuplicateInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() || input.name.trim().is_empty() {
        return invalid_argument("id and name are required");
    }
    let mut guard = match agent_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    if let Some(agent) = guard.agents.iter().find(|item| item.id == input.id) {
        let id = format!("agent-{}", guard.agents.len() + 1);
        let mut data = agent.data.clone();
        if let Some(obj) = data.as_object_mut() {
            obj.insert("id".to_string(), json!(id.clone()));
            obj.insert("name".to_string(), json!(input.name));
        }
        guard.agents.push(AgentRecord {
            id,
            data: data.clone(),
        });
        return success_payload("agents_duplicate", data);
    }
    AppResult::fail(ErrorCode::NotFound, "agent not found", None)
}

pub fn agents_search(input: AgentSearchInput) -> AppResult<StubPayload> {
    if input.q.trim().is_empty() {
        return invalid_argument("q is required");
    }
    let guard = match agent_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let q = input.q.to_lowercase();
    let agents = guard
        .agents
        .iter()
        .filter(|item| {
            item.data
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_lowercase()
                .contains(&q)
        })
        .map(|item| item.data.clone())
        .collect::<Vec<_>>();
    success_payload("agents_search", json!({ "agents": agents }))
}

pub fn agents_list_sessions(input: AgentIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("agents_list_sessions", json!({ "sessions": [] }))
}
