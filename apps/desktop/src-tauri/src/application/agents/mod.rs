use crate::contracts::{
    AgentCreateInput, AgentDuplicateInput, AgentIdInput, AgentPackageExportInput,
    AgentPackageImportInput, AgentSearchInput, AgentSelectInput, AgentUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::application::security::redact_secret_like_values;
use crate::infrastructure::actor_bucket::actor_bucket_id;
use crate::infrastructure::storage::{self, StorageKind};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEFAULT_AGENT_NAME: &str = "assistant";
const AGENT_PACKAGE_SCHEMA: &str = "peers.agent.package.v1";

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
    fn load(actor_id: &str) -> Self {
        let path = match agent_store_path(actor_id) {
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

fn with_agent_app_result<F>(actor_id: &str, f: F) -> AppResult<StubPayload>
where
    F: FnOnce(&mut AgentStore) -> AppResult<StubPayload>,
{
    with_agent_store(actor_id, false, f)
}

fn with_agent_mutation<F>(actor_id: &str, f: F) -> AppResult<StubPayload>
where
    F: FnOnce(&mut AgentStore) -> AppResult<StubPayload>,
{
    with_agent_store(actor_id, true, f)
}

fn with_agent_store<F>(actor_id: &str, persist: bool, f: F) -> AppResult<StubPayload>
where
    F: FnOnce(&mut AgentStore) -> AppResult<StubPayload>,
{
    let key = actor_bucket_id(actor_id);
    let mut stores = match agent_stores().lock() {
        Ok(g) => g,
        Err(e) => return store_lock_error(e),
    };
    let store = stores
        .buckets
        .entry(key)
        .or_insert_with(|| AgentStore::load(actor_id));
    let result = f(store);
    if persist && result.ok {
        if let Err(error) = persist_store(actor_id, store) {
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

fn agent_store_path(actor_id: &str) -> Result<PathBuf, String> {
    let scope = storage::resolve_user_scope(Some(actor_id));
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["agents", &scope, "agents.json"],
    )
    .map_err(|error| format!("failed to resolve agent store path: {error:?}"))
}

fn persist_store(actor_id: &str, store: &AgentStore) -> Result<(), String> {
    let path = agent_store_path(actor_id)?;
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
    obj.entry("model".to_string()).or_insert_with(|| json!(""));
    obj.entry("provider".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("tags".to_string()).or_insert_with(|| json!(""));
    obj.entry("toolsProfile".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("toolsAllow".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("toolsDeny".to_string())
        .or_insert_with(|| json!(""));
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
    obj.entry("chatConfig".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("params".to_string()).or_insert_with(|| json!(""));
    obj.entry("knowledgeResources".to_string())
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

fn now_rfc3339() -> String {
    let unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs() as i64;
    let dt =
        time::OffsetDateTime::from_unix_timestamp(unix).unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    dt.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn unique_agent_name(store: &AgentStore, requested: &str) -> String {
    let base = requested.trim();
    let base = if base.is_empty() {
        DEFAULT_AGENT_NAME
    } else {
        base
    };
    if !store.agents.iter().any(|item| agent_name(item) == base) {
        return base.to_string();
    }
    for index in 2..1000 {
        let candidate = format!("{base} {index}");
        if !store
            .agents
            .iter()
            .any(|item| agent_name(item) == candidate)
        {
            return candidate;
        }
    }
    format!("{base} {}", now_rfc3339())
}

fn parse_json_object_field(data: &Value, field: &str) -> Value {
    data.get(field)
        .and_then(Value::as_str)
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .unwrap_or_else(|| json!({}))
}

fn sanitize_chat_config_for_export(
    chat_config: &mut Value,
    include_local_paths: bool,
    redactions: &mut Vec<String>,
) {
    if include_local_paths {
        return;
    }
    if let Some(workspace) = chat_config
        .get_mut("workspace")
        .and_then(Value::as_object_mut)
    {
        if workspace
            .get("root")
            .and_then(Value::as_str)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
        {
            workspace.insert("root".to_string(), json!(""));
            redactions.push("agent.chatConfig.workspace.root".to_string());
        }
    }
}

fn is_shareable_knowledge_resource(resource: &Value) -> bool {
    matches!(
        resource.get("type").and_then(Value::as_str),
        Some("url") | Some("notebook")
    )
}

fn sanitize_knowledge_resources_for_export(
    data: &mut Value,
    include_local_paths: bool,
    redactions: &mut Vec<String>,
) {
    if include_local_paths {
        return;
    }
    let Some(raw) = data.get("knowledgeResources").and_then(Value::as_str) else {
        return;
    };
    let Ok(parsed) = serde_json::from_str::<Value>(raw) else {
        return;
    };
    let Some(resources) = parsed.as_array() else {
        return;
    };
    let shareable = resources
        .iter()
        .filter(|resource| is_shareable_knowledge_resource(resource))
        .cloned()
        .collect::<Vec<_>>();
    if shareable.len() != resources.len() {
        redactions.push("agent.knowledgeResources.localSources".to_string());
    }
    if let Some(obj) = data.as_object_mut() {
        let knowledge_json = serde_json::to_string(&shareable).unwrap_or_else(|_| "[]".to_string());
        obj.insert("knowledgeResources".to_string(), json!(knowledge_json));
    }
}

fn sanitize_agent_for_export(
    record: &AgentRecord,
    include_local_paths: bool,
) -> (Value, Value, Value, Vec<String>) {
    let mut data = record.data.clone();
    let mut redactions = Vec::new();
    sanitize_knowledge_resources_for_export(&mut data, include_local_paths, &mut redactions);

    let chat_config = data
        .get("chatConfig")
        .and_then(Value::as_str)
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .unwrap_or_else(|| json!({}));
    let mut chat_config = chat_config;
    sanitize_chat_config_for_export(&mut chat_config, include_local_paths, &mut redactions);
    redact_secret_like_values(&mut data, "agent", &mut redactions);
    redact_secret_like_values(&mut chat_config, "chatBehavior", &mut redactions);
    let mut params = parse_json_object_field(&data, "params");
    redact_secret_like_values(&mut params, "providerPreset.params", &mut redactions);

    if let Some(obj) = data.as_object_mut() {
        obj.insert("chatConfig".to_string(), json!(chat_config.to_string()));
        let params_json = serde_json::to_string(&params).unwrap_or_else(|_| "{}".to_string());
        obj.insert("params".to_string(), json!(params_json));
        obj.insert("isDefault".to_string(), json!(false));
        obj.remove("pinned");
        obj.remove("favorite");
        obj.remove("sortOrder");
    }

    (data, chat_config, params, redactions)
}

fn package_agent_data(record: &AgentRecord, include_local_paths: bool) -> Value {
    let (data, chat_config, params, redactions) =
        sanitize_agent_for_export(record, include_local_paths);
    json!({
        "schemaVersion": AGENT_PACKAGE_SCHEMA,
        "exportedAt": now_rfc3339(),
        "source": {
            "agentId": record.id,
            "name": data.get("name").cloned().unwrap_or_else(|| json!(DEFAULT_AGENT_NAME)),
            "packageType": "agent",
            "exportedFrom": "desktop",
            "sharePolicy": {
                "includeLocalPaths": include_local_paths,
                "secrets": "redacted"
            },
            "redactions": redactions
        },
        "agent": data,
        "providerPreset": {
            "provider": data.get("provider").cloned().unwrap_or_else(|| json!("")),
            "model": data.get("model").cloned().unwrap_or_else(|| json!("")),
            "params": params
        },
        "bindings": {
            "mcpServers": chat_config.get("mcpServers").cloned().unwrap_or_else(|| json!([])),
            "tools": chat_config.get("tools").cloned().unwrap_or_else(|| json!([])),
            "skills": chat_config.get("skills").cloned().unwrap_or_else(|| json!([]))
        },
        "opening": {
            "message": data.get("openingMessage").cloned().unwrap_or_else(|| json!("")),
            "questions": data.get("openingQuestions").cloned().unwrap_or_else(|| json!(""))
        },
        "chatBehavior": chat_config
    })
}

fn agent_data_from_package(package: Value) -> Result<Value, String> {
    let schema = package
        .get("schemaVersion")
        .and_then(Value::as_str)
        .unwrap_or("");
    if schema != AGENT_PACKAGE_SCHEMA {
        return Err(format!("unsupported agent package schema: {schema}"));
    }
    let agent = package
        .get("agent")
        .cloned()
        .ok_or_else(|| "agent package is missing agent".to_string())?;
    if !agent.is_object() {
        return Err("agent package agent must be an object".to_string());
    }
    Ok(agent)
}

fn prepare_imported_agent(
    store: &AgentStore,
    mut data: Value,
    id: String,
    name: Option<String>,
) -> Value {
    if let Some(obj) = data.as_object_mut() {
        let requested = name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                obj.get("name")
                    .and_then(Value::as_str)
                    .map(|value| value.to_string())
            })
            .unwrap_or_else(|| DEFAULT_AGENT_NAME.to_string());
        obj.insert("id".to_string(), json!(id));
        obj.insert(
            "name".to_string(),
            json!(unique_agent_name(store, &requested)),
        );
        obj.insert("isDefault".to_string(), json!(false));
        obj.insert("sortOrder".to_string(), json!(store.next_sort_order()));
        obj.insert("createdAt".to_string(), json!(now_rfc3339()));
        obj.insert("updatedAt".to_string(), json!(now_rfc3339()));
    }
    normalize_agent_value(data)
}

pub fn agents_list(actor_id: &str) -> AppResult<StubPayload> {
    with_agent_app_result(actor_id, |store| {
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

pub fn agents_get_selected(actor_id: &str) -> AppResult<StubPayload> {
    with_agent_app_result(actor_id, |store| {
        success_payload(
            "agents_get_selected",
            json!({ "selectedAgent": store.selected_agent }),
        )
    })
}

pub fn agents_set_selected(actor_id: &str, input: AgentSelectInput) -> AppResult<StubPayload> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    with_agent_mutation(actor_id, |store| {
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

pub fn agents_get_default(actor_id: &str) -> AppResult<StubPayload> {
    with_agent_app_result(actor_id, |store| {
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

pub fn agents_set_default(actor_id: &str, input: AgentIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    with_agent_mutation(actor_id, |store| {
        let Some(agent) = store.agents.iter().find(|item| item.id == input.id) else {
            return AppResult::fail(ErrorCode::NotFound, "Agent not found", None);
        };
        let name = agent_name(agent);
        set_default_agent(store, name.clone());
        success_payload("agents_set_default", json!({ "defaultAgent": name }))
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

pub fn agents_create(actor_id: &str, input: AgentCreateInput) -> AppResult<StubPayload> {
    with_agent_mutation(actor_id, |store| {
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

pub fn agents_update(actor_id: &str, input: AgentUpdateInput) -> AppResult<StubPayload> {
    tracing::info!(command = "agents_update", agent_id = %input.id, "Updating agent");
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    with_agent_mutation(actor_id, |store| {
        let Some(index) = store.agents.iter().position(|item| item.id == input.id) else {
            return AppResult::fail(ErrorCode::NotFound, "Agent not found", None);
        };
        let previous_name = agent_name(&store.agents[index]);
        let mut data = store.agents[index].data.clone();
        if let (Some(base), Some(update)) = (data.as_object_mut(), input.data.as_object()) {
            for (key, value) in update {
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

pub fn agents_delete(actor_id: &str, input: AgentIdInput) -> AppResult<StubPayload> {
    tracing::info!(command = "agents_delete", agent_id = %input.id, "Deleting agent");
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    with_agent_mutation(actor_id, |store| {
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

pub fn agents_duplicate(actor_id: &str, input: AgentDuplicateInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() || input.name.trim().is_empty() {
        return invalid_argument("id and name are required");
    }
    with_agent_mutation(actor_id, |store| {
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

pub fn agents_export_package(
    actor_id: &str,
    input: AgentPackageExportInput,
) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    with_agent_app_result(actor_id, |store| {
        let Some(agent) = store.agents.iter().find(|item| item.id == input.id) else {
            return AppResult::fail(ErrorCode::NotFound, "Agent not found", None);
        };
        success_payload(
            "agents_export_package",
            json!({ "package": package_agent_data(agent, input.include_local_paths) }),
        )
    })
}

pub fn agents_import_package(
    actor_id: &str,
    input: AgentPackageImportInput,
) -> AppResult<StubPayload> {
    let data = match agent_data_from_package(input.package) {
        Ok(data) => data,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    with_agent_mutation(actor_id, |store| {
        let id = store.next_agent_id();
        let data = prepare_imported_agent(store, data, id.clone(), input.name);
        store.agents.push(AgentRecord {
            id,
            data: data.clone(),
        });
        success_payload("agents_import_package", data)
    })
}

pub fn agents_search(actor_id: &str, input: AgentSearchInput) -> AppResult<StubPayload> {
    if input.q.trim().is_empty() {
        return invalid_argument("q is required");
    }
    with_agent_app_result(actor_id, |store| {
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
        let store = stores
            .buckets
            .entry(key)
            .or_insert_with(|| AgentStore::load(actor_id));
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
        std::env::set_var("PEERS_STORAGE_ROOT", base.to_str().expect("utf8 path"));
        reset_agent_stores_for_test();
        f();
        reset_agent_stores_for_test();
        std::env::remove_var("PEERS_STORAGE_ROOT");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn agent_stores_isolate_actors() {
        with_temp_storage_root(|| {
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
        });
    }

    #[test]
    fn agent_store_survives_cache_reset() {
        with_temp_storage_root(|| {
            let actor = "actor-agent-persist";
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
            let actor = "actor-agent-default";
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
    fn deleting_default_agent_falls_back_without_clone_or_import_stealing_default() {
        with_temp_storage_root(|| {
            let actor = "actor-agent-default-delete";
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

            let exported = agents_export_package(
                actor,
                AgentPackageExportInput {
                    id: coder_id.clone(),
                    include_local_paths: false,
                },
            );
            assert!(exported.ok, "export default");
            let exported_json: Value =
                serde_json::from_str(&exported.data.expect("export payload").status)
                    .expect("export json");
            let package = exported_json.get("package").cloned().expect("package");
            let imported = agents_import_package(
                actor,
                AgentPackageImportInput {
                    package,
                    name: Some("imported coder".to_string()),
                },
            );
            assert!(imported.ok, "import should not become default");
            let imported_json: Value =
                serde_json::from_str(&imported.data.expect("import payload").status)
                    .expect("import json");
            assert_eq!(
                imported_json.get("isDefault").and_then(Value::as_bool),
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
            let actor = "actor-agent-order";
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
    fn agent_package_round_trip_preserves_supported_fields_without_overwrite() {
        with_temp_storage_root(|| {
            let actor = "actor-agent-package";
            let created = agents_create(
                actor,
                AgentCreateInput {
                    data: json!({
                        "name": "coder",
                        "title": "Coder",
                        "description": "Writes code",
                        "provider": "openai",
                        "model": "gpt-4.1",
                        "openingMessage": "Ready",
                        "openingQuestions": "Review code\nWrite tests",
                        "chatConfig": "{\"mcpServers\":[\"local\"],\"tools\":[\"local_file_read\"],\"skills\":[\"skill-a\"],\"enableStreaming\":true}",
                        "params": "{\"temperature\":0.2}"
                    }),
                },
            );
            assert!(created.ok, "create source agent");
            let created_payload = created.data.expect("created payload");
            let created_json: Value =
                serde_json::from_str(&created_payload.status).expect("created json");
            let source_id = created_json
                .get("id")
                .and_then(Value::as_str)
                .expect("source id")
                .to_string();

            let exported = agents_export_package(
                actor,
                AgentPackageExportInput {
                    id: source_id.clone(),
                    include_local_paths: false,
                },
            );
            assert!(exported.ok, "export package");
            let exported_payload = exported.data.expect("exported payload");
            let exported_json: Value =
                serde_json::from_str(&exported_payload.status).expect("exported json");
            let package = exported_json.get("package").cloned().expect("package");
            assert_eq!(package["schemaVersion"], AGENT_PACKAGE_SCHEMA);
            assert_eq!(package["providerPreset"]["provider"], "openai");
            assert_eq!(package["bindings"]["mcpServers"][0], "local");
            assert_eq!(package["bindings"]["tools"][0], "local_file_read");
            assert_eq!(package["bindings"]["skills"][0], "skill-a");

            let imported = agents_import_package(
                actor,
                AgentPackageImportInput {
                    package,
                    name: None,
                },
            );
            assert!(imported.ok, "import package");
            let imported_payload = imported.data.expect("imported payload");
            let imported_json: Value =
                serde_json::from_str(&imported_payload.status).expect("imported json");
            assert_ne!(imported_json["id"], source_id);
            assert_eq!(imported_json["name"], "coder 2");
            assert_eq!(imported_json["provider"], "openai");
            assert_eq!(imported_json["model"], "gpt-4.1");
            assert_eq!(imported_json["openingMessage"], "Ready");
            assert!(imported_json["chatConfig"]
                .as_str()
                .unwrap_or_default()
                .contains("local_file_read"));
        });
    }

    #[test]
    fn share_safe_agent_package_redacts_secrets_and_local_sources() {
        with_temp_storage_root(|| {
            let actor = "actor-agent-share-safe";
            let created = agents_create(
                actor,
                AgentCreateInput {
                    data: json!({
                        "name": "private-coder",
                        "title": "Private Coder",
                        "provider": "openai",
                        "model": "gpt-4.1",
                        "chatConfig": "{\"workspace\":{\"root\":\"/tmp/private-workspace\",\"policy\":\"workspace-only\"},\"mcpServers\":[\"local\"],\"api_key\":\"sk-secret\"}",
                        "params": "{\"temperature\":0.2,\"private_key\":\"pem-secret\"}",
                        "knowledgeResources": "[{\"id\":\"local-file\",\"type\":\"folder\",\"title\":\"Local\",\"source\":\"/tmp/private-workspace\",\"policy\":\"always\",\"status\":\"bound\"},{\"id\":\"public-url\",\"type\":\"url\",\"title\":\"Docs\",\"source\":\"https://example.test/docs\",\"policy\":\"auto\",\"status\":\"bound\"}]"
                    }),
                },
            );
            assert!(created.ok, "create share-safe source agent");
            let created_json: Value =
                serde_json::from_str(&created.data.expect("created payload").status)
                    .expect("created json");
            let source_id = created_json["id"].as_str().expect("source id").to_string();

            let exported = agents_export_package(
                actor,
                AgentPackageExportInput {
                    id: source_id,
                    include_local_paths: false,
                },
            );
            assert!(exported.ok, "export share-safe package");
            let exported_json: Value =
                serde_json::from_str(&exported.data.expect("export payload").status)
                    .expect("export json");
            let package = exported_json.get("package").expect("package");
            let package_text = package.to_string();
            assert!(!package_text.contains("sk-secret"));
            assert!(!package_text.contains("pem-secret"));
            assert!(!package_text.contains("/tmp/private-workspace"));
            assert_eq!(
                package["source"]["sharePolicy"]["includeLocalPaths"].as_bool(),
                Some(false)
            );
            assert_eq!(package["source"]["sharePolicy"]["secrets"], "redacted");
            assert!(package["source"]["redactions"]
                .as_array()
                .expect("redactions")
                .iter()
                .any(|item| item.as_str() == Some("agent.knowledgeResources.localSources")));
            assert!(package["agent"]["knowledgeResources"]
                .as_str()
                .unwrap_or_default()
                .contains("https://example.test/docs"));
        });
    }

    #[test]
    fn agent_duplicate_creates_distinct_identity() {
        with_temp_storage_root(|| {
            let actor = "actor-agent-clone";
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
