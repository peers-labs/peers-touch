use crate::contracts::{
    AgentCreateInput, AgentDuplicateInput, AgentIdInput, AgentSearchInput, AgentSelectInput,
    AgentUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::actor_bucket::actor_bucket_id;
use crate::infrastructure::storage::{self, StorageKind};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const DEFAULT_AGENT_NAME: &str = "assistant";

#[derive(Clone)]
struct AgentRecord {
    id: String,
    data: Value,
}

#[derive(Default)]
struct AgentStore {
    agents: Vec<AgentRecord>,
    selected_agent: String,
    default_agent: String,
}

#[derive(Serialize, Deserialize)]
struct AgentStoreFile {
    #[serde(rename = "selectedAgent")]
    selected_agent: String,
    #[serde(rename = "defaultAgent", default)]
    default_agent: String,
    agents: Vec<Value>,
}

impl AgentStore {
    fn load(actor_ptid: &str) -> Self {
        let path = match agent_store_path(actor_ptid) {
            Ok(path) => path,
            Err(error) => {
                tracing::warn!(error = %error, "Failed to resolve agent store path; using seeded store");
                return Self::seeded();
            }
        };
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Self::seeded(),
            Err(error) => {
                tracing::warn!(error = %error, path = %path.display(), "Failed to read agent store; using seeded store");
                return Self::seeded();
            }
        };
        match serde_json::from_str::<AgentStoreFile>(&content) {
            Ok(file) => Self::from_file(file),
            Err(error) => {
                tracing::warn!(error = %error, path = %path.display(), "Failed to parse agent store; using seeded store");
                Self::seeded()
            }
        }
    }

    fn seeded() -> Self {
        Self {
            selected_agent: DEFAULT_AGENT_NAME.to_string(),
            default_agent: DEFAULT_AGENT_NAME.to_string(),
            agents: vec![AgentRecord {
                id: "agent-1".to_string(),
                data: normalize_agent_value(json!({
                    "id":"agent-1",
                    "name": DEFAULT_AGENT_NAME,
                    "title":"i18n:agent.default.title",
                    "description":"",
                    "avatar":"🤖",
                    "scope":"general",
                    "isDefault": true,
                    "favorite": false,
                    "sortOrder": 0
                })),
            }],
        }
    }

    fn from_file(file: AgentStoreFile) -> Self {
        let mut agents = file
            .agents
            .into_iter()
            .filter_map(record_from_value)
            .collect::<Vec<_>>();
        if agents.is_empty() {
            return Self::seeded();
        }
        let default_agent = resolve_default_agent(&agents, &file.default_agent);
        mark_default_agent(&mut agents, &default_agent);
        normalize_agent_order(&mut agents);
        sort_agent_records(&mut agents);
        let selected_agent = if agents
            .iter()
            .any(|item| agent_name(item) == file.selected_agent)
        {
            file.selected_agent
        } else {
            default_agent.clone()
        };
        Self {
            agents,
            selected_agent,
            default_agent,
        }
    }

    fn to_file(&self) -> AgentStoreFile {
        AgentStoreFile {
            selected_agent: self.selected_agent.clone(),
            default_agent: self.default_agent.clone(),
            agents: self
                .agents
                .iter()
                .map(|item| {
                    let mut data = item.data.clone();
                    if let Some(obj) = data.as_object_mut() {
                        obj.insert("id".to_string(), json!(item.id));
                    }
                    data
                })
                .collect(),
        }
    }

    fn next_agent_id(&self) -> String {
        let next = self
            .agents
            .iter()
            .filter_map(|item| item.id.strip_prefix("agent-")?.parse::<usize>().ok())
            .max()
            .unwrap_or(0)
            + 1;
        format!("agent-{next}")
    }

    fn next_sort_order(&self) -> i64 {
        self.agents.iter().map(agent_sort_order).max().unwrap_or(-1) + 1
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

fn with_agent_app_result<F>(actor_ptid: &str, f: F) -> AppResult<StubPayload>
where
    F: FnOnce(&mut AgentStore) -> AppResult<StubPayload>,
{
    with_agent_store(actor_ptid, false, f)
}

fn with_agent_mutation<F>(actor_ptid: &str, f: F) -> AppResult<StubPayload>
where
    F: FnOnce(&mut AgentStore) -> AppResult<StubPayload>,
{
    with_agent_store(actor_ptid, true, f)
}

fn with_agent_store<F>(actor_ptid: &str, persist: bool, f: F) -> AppResult<StubPayload>
where
    F: FnOnce(&mut AgentStore) -> AppResult<StubPayload>,
{
    let key = match actor_bucket_id(actor_ptid) {
        Ok(key) => key,
        Err(error) => return invalid_argument(error),
    };
    let mut stores = match agent_stores().lock() {
        Ok(g) => g,
        Err(e) => return store_lock_error(e),
    };
    let store = stores
        .buckets
        .entry(key)
        .or_insert_with(|| AgentStore::load(actor_ptid));
    let result = f(store);
    if persist && result.ok {
        if let Err(error) = persist_store(actor_ptid, store) {
            return persist_error(error);
        }
    }
    result
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

fn persist_error(error: impl std::fmt::Display) -> AppResult<StubPayload> {
    tracing::error!(error = %error, "Failed to persist agent store");
    AppResult::fail(
        ErrorCode::InternalError,
        format!("Failed to persist agent store: {error}"),
        None,
    )
}

fn agent_store_path(actor_ptid: &str) -> Result<PathBuf, String> {
    let scope = crate::infrastructure::local_scope::user_scope_for_actor_ptid(actor_ptid);
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["agents", &scope, "agents.json"],
    )
    .map_err(|error| format!("failed to resolve agent store path: {error:?}"))
}

fn persist_store(actor_ptid: &str, store: &AgentStore) -> Result<(), String> {
    let path = agent_store_path(actor_ptid)?;
    let content = serde_json::to_string_pretty(&store.to_file())
        .map_err(|error| format!("failed to serialize agent store: {error}"))?;
    storage::write_string_atomic(&path, &content)
        .map_err(|error| format!("failed to write agent store: {error}"))
}

fn record_from_value(data: Value) -> Option<AgentRecord> {
    let data = normalize_agent_value(data);
    let id = data.get("id").and_then(Value::as_str)?.trim().to_string();
    if id.is_empty() {
        return None;
    }
    Some(AgentRecord { id, data })
}

fn normalize_agent_value(mut data: Value) -> Value {
    let Some(obj) = data.as_object_mut() else {
        return json!({
            "id": "",
            "name": DEFAULT_AGENT_NAME,
        });
    };
    obj.entry("id".to_string()).or_insert_with(|| json!(""));
    obj.entry("name".to_string())
        .or_insert_with(|| json!(DEFAULT_AGENT_NAME));
    obj.entry("title".to_string()).or_insert_with(|| json!(""));
    obj.entry("description".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("avatar".to_string()).or_insert_with(|| json!(""));
    obj.entry("backgroundColor".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("systemPrompt".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("soulMd".to_string()).or_insert_with(|| json!(""));
    obj.entry("agentsMd".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("model".to_string()).or_insert_with(|| json!(""));
    obj.entry("provider".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("effort".to_string())
        .or_insert_with(|| json!("medium"));
    obj.entry("visibility".to_string())
        .or_insert_with(|| json!("private"));
    obj.entry("isolationEnabled".to_string())
        .or_insert_with(|| json!(false));
    obj.entry("isolationMode".to_string())
        .or_insert_with(|| json!("shared"));
    obj.entry("isolationRetentionDays".to_string())
        .or_insert_with(|| json!(7));
    obj.entry("workspaceMode".to_string())
        .or_insert_with(|| json!("agent"));
    obj.entry("allowedRoots".to_string())
        .or_insert_with(|| json!("[]"));
    obj.entry("tags".to_string()).or_insert_with(|| json!(""));
    obj.entry("pinned".to_string())
        .or_insert_with(|| json!(false));
    obj.entry("favorite".to_string())
        .or_insert_with(|| json!(false));
    obj.entry("sortOrder".to_string())
        .or_insert_with(|| json!(0));
    obj.entry("openingMessage".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("openingQuestions".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("isDefault".to_string())
        .or_insert_with(|| json!(false));
    obj.entry("createdAt".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("updatedAt".to_string())
        .or_insert_with(|| json!(""));
    data
}

fn agent_name(record: &AgentRecord) -> String {
    record
        .data
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_AGENT_NAME)
        .to_string()
}

fn agent_is_default(record: &AgentRecord) -> bool {
    record
        .data
        .get("isDefault")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn agent_sort_order(record: &AgentRecord) -> i64 {
    record
        .data
        .get("sortOrder")
        .and_then(Value::as_i64)
        .unwrap_or(0)
}

fn agent_is_pinned(record: &AgentRecord) -> bool {
    record
        .data
        .get("pinned")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn agent_is_favorite(record: &AgentRecord) -> bool {
    record
        .data
        .get("favorite")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn normalize_agent_order(agents: &mut [AgentRecord]) {
    for (index, agent) in agents.iter_mut().enumerate() {
        if let Some(obj) = agent.data.as_object_mut() {
            if !obj.get("sortOrder").and_then(Value::as_i64).is_some() {
                obj.insert("sortOrder".to_string(), json!(index as i64));
            }
        }
    }
}

fn sort_agent_records(agents: &mut [AgentRecord]) {
    agents.sort_by(|a, b| {
        agent_is_pinned(b)
            .cmp(&agent_is_pinned(a))
            .then_with(|| agent_is_favorite(b).cmp(&agent_is_favorite(a)))
            .then_with(|| agent_sort_order(a).cmp(&agent_sort_order(b)))
            .then_with(|| agent_name(a).cmp(&agent_name(b)))
    });
}

fn resolve_default_agent(agents: &[AgentRecord], stored_default: &str) -> String {
    if !stored_default.trim().is_empty()
        && agents.iter().any(|item| agent_name(item) == stored_default)
    {
        return stored_default.to_string();
    }
    agents
        .iter()
        .find(|item| agent_is_default(item))
        .map(agent_name)
        .or_else(|| agents.first().map(agent_name))
        .unwrap_or_else(|| DEFAULT_AGENT_NAME.to_string())
}

fn mark_default_agent(agents: &mut [AgentRecord], default_agent: &str) {
    for agent in agents {
        let is_default = agent_name(agent) == default_agent;
        if let Some(obj) = agent.data.as_object_mut() {
            obj.insert("isDefault".to_string(), json!(is_default));
        }
    }
}

fn set_default_agent(store: &mut AgentStore, name: String) {
    store.default_agent = name.clone();
    mark_default_agent(&mut store.agents, &name);
}

pub fn agents_list(actor_ptid: &str) -> AppResult<StubPayload> {
    with_agent_app_result(actor_ptid, |store| {
        sort_agent_records(&mut store.agents);
        let agents = store
            .agents
            .iter()
            .map(|item| item.data.clone())
            .collect::<Vec<_>>();
        tracing::info!(
            command = "agents_list",
            count = agents.len(),
            "Agents listed"
        );
        success_payload(
            "agents_list",
            json!({
                "agents": agents,
                "selectedAgent": store.selected_agent,
                "defaultAgent": store.default_agent
            }),
        )
    })
}

pub fn agents_get_selected(actor_ptid: &str) -> AppResult<StubPayload> {
    with_agent_app_result(actor_ptid, |store| {
        success_payload(
            "agents_get_selected",
            json!({ "selectedAgent": store.selected_agent }),
        )
    })
}

pub fn agents_set_selected(actor_ptid: &str, input: AgentSelectInput) -> AppResult<StubPayload> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    with_agent_mutation(actor_ptid, |store| {
        if !store.agents.iter().any(|item| agent_name(item) == name) {
            return AppResult::fail(ErrorCode::NotFound, "Agent not found", None);
        }
        store.selected_agent = name.to_string();
        success_payload(
            "agents_set_selected",
            json!({ "selectedAgent": store.selected_agent }),
        )
    })
}

pub fn agents_get_default(actor_ptid: &str) -> AppResult<StubPayload> {
    with_agent_app_result(actor_ptid, |store| {
        let agent = store
            .agents
            .iter()
            .find(|item| agent_name(item) == store.default_agent)
            .or_else(|| store.agents.first());
        let Some(agent) = agent else {
            return AppResult::fail(ErrorCode::NotFound, "Default Agent not found", None);
        };
        success_payload(
            "agents_get_default",
            json!({ "defaultAgent": store.default_agent, "agent": agent.data }),
        )
    })
}

pub fn agents_set_default(actor_ptid: &str, input: AgentIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    with_agent_mutation(actor_ptid, |store| {
        let Some(agent) = store.agents.iter().find(|item| item.id == input.id) else {
            return AppResult::fail(ErrorCode::NotFound, "Agent not found", None);
        };
        let name = agent_name(agent);
        set_default_agent(store, name.clone());
        success_payload("agents_set_default", json!({ "defaultAgent": name }))
    })
}

pub fn agents_get(actor_ptid: &str, input: AgentIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    with_agent_app_result(actor_ptid, |store| {
        if let Some(agent) = store.agents.iter().find(|item| item.id == input.id) {
            return success_payload("agents_get", agent.data.clone());
        }
        AppResult::fail(ErrorCode::NotFound, "Agent not found", None)
    })
}

pub fn agents_create(actor_ptid: &str, input: AgentCreateInput) -> AppResult<StubPayload> {
    with_agent_mutation(actor_ptid, |store| {
        let id = store.next_agent_id();
        tracing::info!(command = "agents_create", agent_id = %id, "Creating agent");
        let mut data = input.data;
        let sort_order = store.next_sort_order();
        if let Some(obj) = data.as_object_mut() {
            obj.insert("id".to_string(), json!(id.clone()));
            obj.insert("isDefault".to_string(), json!(false));
            obj.insert("sortOrder".to_string(), json!(sort_order));
        }
        let data = normalize_agent_value(data);
        store.agents.push(AgentRecord {
            id,
            data: data.clone(),
        });
        success_payload("agents_create", data)
    })
}

pub fn agents_update(actor_ptid: &str, input: AgentUpdateInput) -> AppResult<StubPayload> {
    tracing::info!(command = "agents_update", agent_id = %input.id, "Updating agent");
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    with_agent_mutation(actor_ptid, |store| {
        let Some(index) = store.agents.iter().position(|item| item.id == input.id) else {
            return AppResult::fail(ErrorCode::NotFound, "Agent not found", None);
        };
        let previous_name = agent_name(&store.agents[index]);
        let mut data = store.agents[index].data.clone();
        if let (Some(base), Some(update)) = (data.as_object_mut(), input.data.as_object()) {
            for (key, value) in update {
                if matches!(
                    key.as_str(),
                    "chatConfig" | "params" | "toolsAllow" | "toolsDeny" | "toolsProfile"
                ) {
                    continue;
                }
                base.insert(key.to_string(), value.clone());
            }
        }
        if let Some(obj) = data.as_object_mut() {
            obj.insert("id".to_string(), json!(input.id));
        }
        let mut data = normalize_agent_value(data);
        let next_name = data
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_AGENT_NAME)
            .to_string();
        if store.selected_agent == previous_name {
            store.selected_agent = next_name.clone();
        }
        if let Some(obj) = data.as_object_mut() {
            obj.insert(
                "isDefault".to_string(),
                json!(store.default_agent == previous_name),
            );
        }
        store.agents[index].data = data.clone();
        if store.default_agent == previous_name {
            set_default_agent(store, next_name);
        }
        sort_agent_records(&mut store.agents);
        success_payload("agents_update", data)
    })
}

pub fn agents_delete(actor_ptid: &str, input: AgentIdInput) -> AppResult<StubPayload> {
    tracing::info!(command = "agents_delete", agent_id = %input.id, "Deleting agent");
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    with_agent_mutation(actor_ptid, |store| {
        let deleted_selected = store
            .agents
            .iter()
            .find(|item| item.id == input.id)
            .map(|item| agent_name(item) == store.selected_agent)
            .unwrap_or(false);
        let before = store.agents.len();
        store.agents.retain(|item| item.id != input.id);
        if deleted_selected {
            store.selected_agent = store
                .agents
                .first()
                .map(agent_name)
                .unwrap_or_else(|| DEFAULT_AGENT_NAME.to_string());
        }
        if !store
            .agents
            .iter()
            .any(|item| agent_name(item) == store.default_agent)
        {
            let fallback = store
                .agents
                .first()
                .map(agent_name)
                .unwrap_or_else(|| DEFAULT_AGENT_NAME.to_string());
            set_default_agent(store, fallback);
        }
        success_payload(
            "agents_delete",
            json!({ "ok": before != store.agents.len() }),
        )
    })
}

pub fn agents_duplicate(actor_ptid: &str, input: AgentDuplicateInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() || input.name.trim().is_empty() {
        return invalid_argument("id and name are required");
    }
    with_agent_mutation(actor_ptid, |store| {
        if let Some(agent) = store.agents.iter().find(|item| item.id == input.id) {
            let id = store.next_agent_id();
            let mut data = agent.data.clone();
            if let Some(obj) = data.as_object_mut() {
                obj.insert("id".to_string(), json!(id.clone()));
                obj.insert("name".to_string(), json!(input.name));
                obj.insert("isDefault".to_string(), json!(false));
                obj.insert("sortOrder".to_string(), json!(store.next_sort_order()));
            }
            let data = normalize_agent_value(data);
            store.agents.push(AgentRecord {
                id,
                data: data.clone(),
            });
            return success_payload("agents_duplicate", data);
        }
        AppResult::fail(ErrorCode::NotFound, "Agent not found", None)
    })
}

pub fn agents_search(actor_ptid: &str, input: AgentSearchInput) -> AppResult<StubPayload> {
    if input.q.trim().is_empty() {
        return invalid_argument("q is required");
    }
    with_agent_app_result(actor_ptid, |store| {
        let q = input.q.to_lowercase();
        let agents = store
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
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn reset_agent_stores_for_test() {
        if let Ok(mut stores) = agent_stores().lock() {
            stores.buckets.clear();
        }
    }

    fn with_temp_storage_root(f: impl FnOnce()) {
        let _guard = TEST_ENV_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("test env lock");
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "peers-touch-agent-store-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&base).expect("temp storage root");
        let previous_storage_root = std::env::var_os("PEERS_STORAGE_ROOT");
        std::env::set_var("PEERS_STORAGE_ROOT", base.to_str().expect("utf8 path"));
        reset_agent_stores_for_test();
        f();
        reset_agent_stores_for_test();
        match previous_storage_root {
            Some(value) => std::env::set_var("PEERS_STORAGE_ROOT", value),
            None => std::env::remove_var("PEERS_STORAGE_ROOT"),
        }
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn agent_stores_isolate_actors() {
        with_temp_storage_root(|| {
            let a = "ptid:person:agent-a";
            let b = "ptid:person:agent-b";
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
        });
    }

    #[test]
    fn agent_store_survives_cache_reset() {
        with_temp_storage_root(|| {
            let actor = "ptid:person:agent-persist";
            let created = agents_create(
                actor,
                AgentCreateInput {
                    data: json!({
                        "name": "coder",
                        "title": "t",
                        "chatConfig": "{\"workspace\":{\"root\":\"/tmp/work\",\"policy\":\"workspace-only\"},\"mcpServers\":[\"local\"],\"tools\":[\"local_file_read\"],\"skills\":[\"skill-a\"]}"
                    }),
                },
            );
            assert!(created.ok, "create persisted agent");
            let selected = agents_set_selected(
                actor,
                AgentSelectInput {
                    name: "coder".to_string(),
                },
            );
            assert!(selected.ok, "select persisted agent");

            reset_agent_stores_for_test();

            let selected_after_restart = agents_get_selected(actor);
            assert!(selected_after_restart.ok, "load selected after restart");
            let selected_payload = selected_after_restart.data.expect("selected payload");
            let selected_json: Value =
                serde_json::from_str(&selected_payload.status).expect("selected json");
            assert_eq!(
                selected_json.get("selectedAgent").and_then(Value::as_str),
                Some("coder")
            );

            let list = agents_list(actor);
            assert!(list.ok, "list after restart");
            let payload = list.data.expect("list payload");
            let value: Value = serde_json::from_str(&payload.status).expect("list json");
            let agents = value
                .get("agents")
                .and_then(Value::as_array)
                .expect("agents array");
            let coder = agents
                .iter()
                .find(|item| item.get("name").and_then(Value::as_str) == Some("coder"))
                .expect("persisted coder agent");
            let chat_config = coder
                .get("chatConfig")
                .and_then(Value::as_str)
                .expect("chat config");
            assert!(chat_config.contains("local_file_read"));
            assert!(chat_config.contains("skill-a"));
        });
    }

    #[test]
    fn default_agent_is_visible_configurable_and_persistent() {
        with_temp_storage_root(|| {
            let actor = "ptid:person:agent-default";
            let created = agents_create(
                actor,
                AgentCreateInput {
                    data: json!({ "name": "coder", "title": "Coder" }),
                },
            );
            assert!(created.ok, "create configurable default agent");
            let created_payload = created.data.expect("created payload");
            let created_json: Value =
                serde_json::from_str(&created_payload.status).expect("created json");
            let coder_id = created_json
                .get("id")
                .and_then(Value::as_str)
                .expect("coder id")
                .to_string();

            let default_before = agents_get_default(actor);
            assert!(default_before.ok, "get seeded default");
            let payload = default_before.data.expect("default payload");
            let value: Value = serde_json::from_str(&payload.status).expect("default json");
            assert_eq!(
                value.get("defaultAgent").and_then(Value::as_str),
                Some(DEFAULT_AGENT_NAME)
            );
            assert_eq!(
                value["agent"].get("isDefault").and_then(Value::as_bool),
                Some(true)
            );

            let set_default = agents_set_default(actor, AgentIdInput { id: coder_id });
            assert!(set_default.ok, "set default agent");

            reset_agent_stores_for_test();

            let list = agents_list(actor);
            assert!(list.ok, "list after default restart");
            let payload = list.data.expect("list payload");
            let value: Value = serde_json::from_str(&payload.status).expect("list json");
            assert_eq!(
                value.get("defaultAgent").and_then(Value::as_str),
                Some("coder")
            );
            let agents = value
                .get("agents")
                .and_then(Value::as_array)
                .expect("agents array");
            assert_eq!(
                agents
                    .iter()
                    .find(|item| item.get("name").and_then(Value::as_str) == Some("coder"))
                    .and_then(|item| item.get("isDefault"))
                    .and_then(Value::as_bool),
                Some(true)
            );
            assert_eq!(
                agents
                    .iter()
                    .find(
                        |item| item.get("name").and_then(Value::as_str) == Some(DEFAULT_AGENT_NAME)
                    )
                    .and_then(|item| item.get("isDefault"))
                    .and_then(Value::as_bool),
                Some(false)
            );
        });
    }

    #[test]
    fn deleting_default_agent_falls_back_without_clone_stealing_default() {
        with_temp_storage_root(|| {
            let actor = "ptid:person:agent-default-delete";
            let created = agents_create(
                actor,
                AgentCreateInput {
                    data: json!({ "name": "coder", "title": "Coder" }),
                },
            );
            assert!(created.ok, "create coder");
            let created_payload = created.data.expect("created payload");
            let created_json: Value =
                serde_json::from_str(&created_payload.status).expect("created json");
            let coder_id = created_json
                .get("id")
                .and_then(Value::as_str)
                .expect("coder id")
                .to_string();

            assert!(
                agents_set_default(
                    actor,
                    AgentIdInput {
                        id: coder_id.clone()
                    }
                )
                .ok
            );

            let cloned = agents_duplicate(
                actor,
                AgentDuplicateInput {
                    id: coder_id.clone(),
                    name: "coder copy".to_string(),
                },
            );
            assert!(cloned.ok, "clone should not become default");
            let cloned_json: Value =
                serde_json::from_str(&cloned.data.expect("clone payload").status)
                    .expect("clone json");
            assert_eq!(
                cloned_json.get("isDefault").and_then(Value::as_bool),
                Some(false)
            );

            let deleted = agents_delete(actor, AgentIdInput { id: coder_id });
            assert!(deleted.ok, "delete default");
            let default_after_delete = agents_get_default(actor);
            assert!(default_after_delete.ok, "fallback default exists");
            let value: Value =
                serde_json::from_str(&default_after_delete.data.expect("default payload").status)
                    .expect("default json");
            assert_eq!(
                value.get("defaultAgent").and_then(Value::as_str),
                Some(DEFAULT_AGENT_NAME)
            );
            assert_eq!(
                value["agent"].get("isDefault").and_then(Value::as_bool),
                Some(true)
            );
        });
    }

    #[test]
    fn pinned_favorite_and_order_survive_restart_with_partial_updates() {
        with_temp_storage_root(|| {
            let actor = "ptid:person:agent-order";
            let beta = agents_create(
                actor,
                AgentCreateInput {
                    data: json!({ "name": "beta", "title": "Beta" }),
                },
            );
            assert!(beta.ok, "create beta");
            let alpha = agents_create(
                actor,
                AgentCreateInput {
                    data: json!({ "name": "alpha", "title": "Alpha" }),
                },
            );
            assert!(alpha.ok, "create alpha");
            let alpha_json: Value =
                serde_json::from_str(&alpha.data.expect("alpha payload").status)
                    .expect("alpha json");
            let alpha_id = alpha_json
                .get("id")
                .and_then(Value::as_str)
                .expect("alpha id")
                .to_string();

            let updated = agents_update(
                actor,
                AgentUpdateInput {
                    id: alpha_id,
                    data: json!({ "pinned": true, "favorite": true }),
                },
            );
            assert!(updated.ok, "pin alpha");
            let updated_json: Value =
                serde_json::from_str(&updated.data.expect("updated payload").status)
                    .expect("updated json");
            assert_eq!(
                updated_json.get("title").and_then(Value::as_str),
                Some("Alpha")
            );
            assert_eq!(
                updated_json.get("pinned").and_then(Value::as_bool),
                Some(true)
            );
            assert_eq!(
                updated_json.get("favorite").and_then(Value::as_bool),
                Some(true)
            );

            reset_agent_stores_for_test();

            let list = agents_list(actor);
            assert!(list.ok, "list ordered agents");
            let payload = list.data.expect("list payload");
            let value: Value = serde_json::from_str(&payload.status).expect("list json");
            let agents = value
                .get("agents")
                .and_then(Value::as_array)
                .expect("agents array");
            assert_eq!(agents[0].get("name").and_then(Value::as_str), Some("alpha"));
            assert_eq!(agents[0].get("pinned").and_then(Value::as_bool), Some(true));
            assert_eq!(
                agents[0].get("favorite").and_then(Value::as_bool),
                Some(true)
            );
            assert_eq!(
                agents[1].get("name").and_then(Value::as_str),
                Some(DEFAULT_AGENT_NAME)
            );
            assert_eq!(agents[2].get("name").and_then(Value::as_str), Some("beta"));
        });
    }

    #[test]
    fn agent_duplicate_creates_distinct_identity() {
        with_temp_storage_root(|| {
            let actor = "ptid:person:agent-clone";
            let list = agents_list(actor);
            let payload = list.data.expect("list payload");
            let value: Value = serde_json::from_str(&payload.status).expect("list json");
            let source_id = value["agents"][0]["id"]
                .as_str()
                .expect("source id")
                .to_string();

            let cloned = agents_duplicate(
                actor,
                AgentDuplicateInput {
                    id: source_id.clone(),
                    name: "assistant-copy".to_string(),
                },
            );
            assert!(cloned.ok, "clone agent");
            let payload = cloned.data.expect("clone payload");
            let value: Value = serde_json::from_str(&payload.status).expect("clone json");
            assert_ne!(value["id"], source_id);
            assert_eq!(value["name"], "assistant-copy");
        });
    }
}
