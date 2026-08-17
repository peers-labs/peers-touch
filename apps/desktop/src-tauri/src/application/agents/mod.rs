use crate::application::security::redact_secret_like_values;
use crate::contracts::{
    AgentCreateInput, AgentDuplicateInput, AgentIdInput, AgentPackageExportInput,
    AgentPackageImportInput, AgentSearchInput, AgentSelectInput, AgentUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::actor_bucket::actor_bucket_id;
use crate::infrastructure::station_client;
use crate::infrastructure::storage::{self, StorageKind};
use reqwest::Method;
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

fn station_failure(
    error: station_client::StationClientError,
    context: &str,
) -> AppResult<StubPayload> {
    error.into_app_result(context)
}

fn require_token(token: &str) -> Result<(), AppResult<StubPayload>> {
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(())
}

fn normalize_station_visibility(value: Value) -> Value {
    match value.as_str() {
        Some("workspace") | Some("AGENT_VISIBILITY_WORKSPACE") => json!("workspace"),
        _ => json!("private"),
    }
}

fn normalize_station_i64(value: Value) -> Value {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<i64>().ok()))
        .map(Value::from)
        .unwrap_or_else(|| Value::from(0))
}

fn station_agent_to_desktop(agent: Value) -> Value {
    let config = agent
        .get("config_json")
        .or_else(|| agent.get("configJson"))
        .and_then(Value::as_str)
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .unwrap_or_else(|| json!({}));
    let mut desktop = config.as_object().cloned().unwrap_or_default();
    let field = |snake: &str, camel: &str| {
        agent
            .get(snake)
            .or_else(|| agent.get(camel))
            .cloned()
            .unwrap_or(Value::Null)
    };
    desktop.insert("id".to_string(), field("agent_id", "agentId"));
    desktop.insert("name".to_string(), field("name", "name"));
    desktop.insert("title".to_string(), field("title", "title"));
    desktop.insert(
        "description".to_string(),
        field("description", "description"),
    );
    desktop.insert("provider".to_string(), field("provider_id", "providerId"));
    desktop.insert("model".to_string(), field("model_name", "modelName"));
    desktop.insert("effort".to_string(), field("effort", "effort"));
    desktop.insert(
        "visibility".to_string(),
        normalize_station_visibility(field("visibility", "visibility")),
    );
    desktop.insert(
        "version".to_string(),
        normalize_station_i64(field("version", "version")),
    );
    desktop.insert("createdAt".to_string(), field("created_at", "createdAt"));
    desktop.insert("updatedAt".to_string(), field("updated_at", "updatedAt"));
    normalize_agent_value(Value::Object(desktop))
}

fn desktop_agent_config(data: &Value) -> String {
    let mut config = data.as_object().cloned().unwrap_or_default();
    for key in [
        "id",
        "name",
        "title",
        "description",
        "provider",
        "model",
        "effort",
        "visibility",
        "version",
        "createdAt",
        "updatedAt",
    ] {
        config.remove(key);
    }
    Value::Object(config).to_string()
}

fn station_agent_body(data: &Value, agent_id: Option<&str>) -> Value {
    let string_value = |key: &str| {
        data.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let visibility =
        normalize_station_visibility(data.get("visibility").cloned().unwrap_or(Value::Null));
    let mut body = json!({
        "name": string_value("name"),
        "title": string_value("title"),
        "description": string_value("description"),
        "provider_id": string_value("provider"),
        "model_name": string_value("model"),
        "effort": string_value("effort"),
        "visibility": visibility,
        "config_json": desktop_agent_config(data),
        "version": data.get("version").and_then(Value::as_i64).unwrap_or(0),
    });
    if let Some(agent_id) = agent_id {
        body["agent_id"] = json!(agent_id);
    }
    body
}

fn station_agent(token: &str, agent_id: &str) -> Result<Value, station_client::StationClientError> {
    let result = station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/get",
        token,
        None,
        Some(&json!({"agent_id": agent_id})),
    )?;
    Ok(station_agent_to_desktop(
        result.get("agent").cloned().unwrap_or(result),
    ))
}

fn unique_station_agent_name(
    token: &str,
    requested: &str,
) -> Result<String, station_client::StationClientError> {
    let result = station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/list",
        token,
        None,
        Some(&json!({"page": 1, "page_size": 100})),
    )?;
    let existing = result
        .get("agents")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|agent| agent.get("name").and_then(Value::as_str))
        .collect::<Vec<_>>();
    let base = requested.trim();
    let base = if base.is_empty() {
        DEFAULT_AGENT_NAME
    } else {
        base
    };
    if !existing.contains(&base) {
        return Ok(base.to_string());
    }
    for index in 2..1000 {
        let candidate = format!("{base} {index}");
        if !existing.iter().any(|name| *name == candidate) {
            return Ok(candidate);
        }
    }
    Ok(format!("{base} {}", now_rfc3339()))
}

fn create_station_agent(
    actor_id: &str,
    token: &str,
    data: Value,
    command: &str,
) -> AppResult<StubPayload> {
    match station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/create",
        token,
        None,
        Some(&station_agent_body(&normalize_agent_value(data), None)),
    ) {
        Ok(result) => {
            let agent = station_agent_to_desktop(result.get("agent").cloned().unwrap_or(result));
            let _ = agents_list(actor_id, token);
            success_payload(command, agent)
        }
        Err(error) => station_failure(error, "Failed to create Agent"),
    }
}

fn replace_station_projection(actor_id: &str, agents: &[Value]) -> Result<(), String> {
    let records = agents
        .iter()
        .cloned()
        .filter_map(record_from_value)
        .collect::<Vec<_>>();
    let key = actor_bucket_id(actor_id);
    let mut stores = agent_stores()
        .lock()
        .map_err(|error| format!("failed to acquire Agent projection: {error}"))?;
    let store = stores
        .buckets
        .entry(key)
        .or_insert_with(|| AgentStore::load(actor_id));
    store.agents = records;
    if !store
        .agents
        .iter()
        .any(|item| agent_name(item) == store.selected_agent)
    {
        store.selected_agent = store.agents.first().map(agent_name).unwrap_or_default();
    }
    if !store
        .agents
        .iter()
        .any(|item| agent_name(item) == store.default_agent)
    {
        store.default_agent = store.selected_agent.clone();
    }
    mark_default_agent(&mut store.agents, &store.default_agent);
    sort_agent_records(&mut store.agents);
    persist_store(actor_id, store)
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
    let scope = crate::infrastructure::local_scope::user_scope_for_actor(Some(actor_id));
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
    obj.entry("runtimeBackend".to_string())
        .or_insert_with(|| json!("host"));
    obj.entry("rootfsPath".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("allowedRoots".to_string())
        .or_insert_with(|| json!("[]"));
    obj.entry("cliCommand".to_string())
        .or_insert_with(|| json!(""));
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
    obj.entry("knowledgeResources".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("isDefault".to_string())
        .or_insert_with(|| json!(false));
    obj.entry("createdAt".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("updatedAt".to_string())
        .or_insert_with(|| json!(""));
    obj.entry("version".to_string()).or_insert_with(|| json!(0));
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
) -> (Value, Value, Vec<String>) {
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

    if let Some(obj) = data.as_object_mut() {
        obj.insert("chatConfig".to_string(), json!(chat_config.to_string()));
        obj.remove("params");
        obj.remove("toolsAllow");
        obj.remove("toolsDeny");
        obj.remove("toolsProfile");
        obj.insert("isDefault".to_string(), json!(false));
        obj.remove("pinned");
        obj.remove("favorite");
        obj.remove("sortOrder");
    }

    (data, chat_config, redactions)
}

fn package_agent_data(record: &AgentRecord, include_local_paths: bool) -> Value {
    let (data, chat_config, redactions) = sanitize_agent_for_export(record, include_local_paths);
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
            "model": data.get("model").cloned().unwrap_or_else(|| json!(""))
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

pub fn agents_list(actor_id: &str, token: &str) -> AppResult<StubPayload> {
    if let Err(error) = require_token(token) {
        return error;
    }
    let result = match station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/list",
        token,
        None,
        Some(&json!({"page": 1, "page_size": 100})),
    ) {
        Ok(result) => result,
        Err(error) => return station_failure(error, "Failed to list Agents"),
    };
    let agents = result
        .get("agents")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .cloned()
        .map(station_agent_to_desktop)
        .collect::<Vec<_>>();
    if let Err(error) = replace_station_projection(actor_id, &agents) {
        return persist_error(error);
    }
    with_agent_app_result(actor_id, |store| {
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

pub fn agents_get(_actor_id: &str, token: &str, input: AgentIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    if let Err(error) = require_token(token) {
        return error;
    }
    match station_agent(token, &input.id) {
        Ok(agent) => success_payload("agents_get", agent),
        Err(error) => station_failure(error, "Failed to get Agent"),
    }
}

pub fn agents_create(
    actor_id: &str,
    token: &str,
    input: AgentCreateInput,
) -> AppResult<StubPayload> {
    if let Err(error) = require_token(token) {
        return error;
    }
    create_station_agent(actor_id, token, input.data, "agents_create")
}

pub fn agents_update(
    actor_id: &str,
    token: &str,
    input: AgentUpdateInput,
) -> AppResult<StubPayload> {
    tracing::info!(command = "agents_update", agent_id = %input.id, "Updating agent");
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    if let Err(error) = require_token(token) {
        return error;
    }
    let current = match station_agent(token, &input.id) {
        Ok(agent) => agent,
        Err(error) => return station_failure(error, "Failed to load Agent before update"),
    };
    let mut data = current;
    if let (Some(base), Some(update)) = (data.as_object_mut(), input.data.as_object()) {
        for (key, value) in update {
            base.insert(key.clone(), value.clone());
        }
    }
    let data = normalize_agent_value(data);
    match station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/update",
        token,
        None,
        Some(&station_agent_body(&data, Some(&input.id))),
    ) {
        Ok(result) => {
            let updated = station_agent_to_desktop(result.get("agent").cloned().unwrap_or(result));
            let _ = agents_list(actor_id, token);
            success_payload("agents_update", updated)
        }
        Err(error) => station_failure(error, "Failed to update Agent"),
    }
}

pub fn agents_delete(actor_id: &str, token: &str, input: AgentIdInput) -> AppResult<StubPayload> {
    tracing::info!(command = "agents_delete", agent_id = %input.id, "Deleting agent");
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    if let Err(error) = require_token(token) {
        return error;
    }
    match station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/delete",
        token,
        None,
        Some(&json!({"agent_id": input.id})),
    ) {
        Ok(_) => {
            let _ = agents_list(actor_id, token);
            success_payload("agents_delete", json!({"ok": true}))
        }
        Err(error) => station_failure(error, "Failed to delete Agent"),
    }
}

pub fn agents_duplicate(
    actor_id: &str,
    token: &str,
    input: AgentDuplicateInput,
) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() || input.name.trim().is_empty() {
        return invalid_argument("id and name are required");
    }
    if let Err(error) = require_token(token) {
        return error;
    }
    let mut data = match station_agent(token, &input.id) {
        Ok(agent) => agent,
        Err(error) => return station_failure(error, "Failed to load Agent before duplicate"),
    };
    if let Some(obj) = data.as_object_mut() {
        obj.insert("name".to_string(), json!(input.name.trim()));
        obj.insert("isDefault".to_string(), json!(false));
        obj.remove("id");
        obj.remove("version");
        obj.remove("createdAt");
        obj.remove("updatedAt");
    }
    create_station_agent(actor_id, token, data, "agents_duplicate")
}

pub fn agents_export_package(
    _actor_id: &str,
    token: &str,
    input: AgentPackageExportInput,
) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    if let Err(error) = require_token(token) {
        return error;
    }
    let data = match station_agent(token, &input.id) {
        Ok(agent) => agent,
        Err(error) => return station_failure(error, "Failed to load Agent before export"),
    };
    let Some(agent) = record_from_value(data) else {
        return AppResult::fail(
            ErrorCode::InternalError,
            "Station returned an Agent without an id",
            None,
        );
    };
    success_payload(
        "agents_export_package",
        json!({ "package": package_agent_data(&agent, input.include_local_paths) }),
    )
}

pub fn agents_import_package(
    actor_id: &str,
    token: &str,
    input: AgentPackageImportInput,
) -> AppResult<StubPayload> {
    if let Err(error) = require_token(token) {
        return error;
    }
    let mut data = match agent_data_from_package(input.package) {
        Ok(data) => data,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    let requested_name = input
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .or_else(|| data.get("name").and_then(Value::as_str))
        .unwrap_or(DEFAULT_AGENT_NAME);
    let unique_name = match unique_station_agent_name(token, requested_name) {
        Ok(name) => name,
        Err(error) => return station_failure(error, "Failed to resolve imported Agent name"),
    };
    if let Some(obj) = data.as_object_mut() {
        obj.insert("name".to_string(), json!(unique_name));
        obj.insert("isDefault".to_string(), json!(false));
        obj.remove("id");
        obj.remove("version");
        obj.remove("createdAt");
        obj.remove("updatedAt");
    }
    create_station_agent(actor_id, token, data, "agents_import_package")
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

    #[test]
    fn station_mapping_normalizes_agent_contract() {
        let mapped = station_agent_to_desktop(json!({
            "agent_id": "agent-1",
            "name": "assistant",
            "provider_id": "ark",
            "model_name": "ep-model",
            "effort": "medium",
            "visibility": "AGENT_VISIBILITY_PRIVATE",
            "version": "2",
            "config_json": "{\"openingMessage\":\"Ready\"}"
        }));

        assert_eq!(mapped["id"], "agent-1");
        assert_eq!(mapped["provider"], "ark");
        assert_eq!(mapped["model"], "ep-model");
        assert_eq!(mapped["effort"], "medium");
        assert_eq!(mapped["visibility"], "private");
        assert_eq!(mapped["version"], 2);
        assert_eq!(mapped["openingMessage"], "Ready");

        let body = station_agent_body(&mapped, Some("agent-1"));
        assert_eq!(body["agent_id"], "agent-1");
        assert_eq!(body["visibility"], "private");
        assert_eq!(body["version"], 2);
    }

    #[test]
    fn agent_package_round_trip_keeps_runtime_identity_and_redacts_secrets() {
        let record = record_from_value(json!({
            "id": "agent-1",
            "name": "coder",
            "provider": "ark",
            "model": "ep-model",
            "chatConfig": "{\"mcpServers\":[\"local\"],\"api_key\":\"secret\"}",
            "knowledgeResources": "[{\"id\":\"docs\",\"type\":\"url\",\"source\":\"https://example.test\"}]"
        }))
        .expect("agent record");

        let package = package_agent_data(&record, false);
        let text = package.to_string();
        assert_eq!(package["providerPreset"]["provider"], "ark");
        assert_eq!(package["providerPreset"]["model"], "ep-model");
        assert!(!text.contains("\"api_key\":\"secret\""));

        let imported = agent_data_from_package(package).expect("package round trip");
        assert_eq!(imported["provider"], "ark");
        assert_eq!(imported["model"], "ep-model");
    }
}
