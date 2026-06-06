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
pub struct ChannelBindingListInput {
    pub agent_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ChannelBindingUpsertInput {
    pub agent_id: String,
    pub channel_id: String,
    pub mirror_mode: String,
    pub topic_policy: String,
    pub execution_policy: String,
    pub enabled: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ChannelBindingToggleInput {
    pub id: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ChannelBindingDeleteInput {
    pub id: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct ChannelBindingRecord {
    id: String,
    agent_id: String,
    channel_id: String,
    mirror_mode: String,
    topic_policy: String,
    execution_policy: String,
    enabled: bool,
    audit_event: String,
    created_at: String,
    updated_at: String,
}

#[derive(Default, Serialize, Deserialize)]
struct ChannelBindingStore {
    sequence: u64,
    bindings: Vec<ChannelBindingRecord>,
}

static CHANNEL_BINDING_STORE: OnceLock<Mutex<ChannelBindingStore>> = OnceLock::new();

fn channel_binding_store() -> &'static Mutex<ChannelBindingStore> {
    CHANNEL_BINDING_STORE.get_or_init(|| Mutex::new(load_channel_binding_store()))
}

#[cfg(test)]
fn channel_binding_store_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "peers-touch-agent-channel-bindings-{}.json",
        std::process::id()
    ))
}

#[cfg(not(test))]
fn channel_binding_store_path() -> PathBuf {
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["agent", "channels", "bindings.json"],
    )
    .unwrap_or_else(|_| PathBuf::from("agent.channel.bindings.json"))
}

fn load_channel_binding_store() -> ChannelBindingStore {
    let path = channel_binding_store_path();
    if !path.exists() {
        return ChannelBindingStore::default();
    }
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "Failed to read channel binding store");
            return ChannelBindingStore::default();
        }
    };
    serde_json::from_str::<ChannelBindingStore>(&raw).unwrap_or_else(|err| {
        tracing::warn!(path = %path.display(), error = %err, "Failed to parse channel binding store");
        ChannelBindingStore::default()
    })
}

fn persist_channel_binding_store(
    store: &ChannelBindingStore,
) -> Result<(), AppResult<StubPayload>> {
    let path = channel_binding_store_path();
    let serialized = serde_json::to_string(store).map_err(|err| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to serialize channel binding store: {}", err),
            None,
        )
    })?;
    storage::write_string_atomic(&path, &serialized).map_err(|err| {
        AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist channel binding store: {}", err),
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
    tracing::error!(error = %e, "Failed to acquire channel binding store lock");
    AppResult::fail(
        ErrorCode::InternalError,
        format!("Failed to access channel binding store: {}", e),
        None,
    )
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn binding_json(binding: &ChannelBindingRecord) -> serde_json::Value {
    json!({
        "id": binding.id,
        "agent_id": binding.agent_id,
        "channel_id": binding.channel_id,
        "mirror_mode": binding.mirror_mode,
        "topic_policy": binding.topic_policy,
        "execution_policy": binding.execution_policy,
        "enabled": binding.enabled,
        "audit_event": binding.audit_event,
        "created_at": binding.created_at,
        "updated_at": binding.updated_at,
    })
}

pub fn agent_channel_bindings_list(input: ChannelBindingListInput) -> AppResult<StubPayload> {
    let agent_id = input.agent_id.unwrap_or_default();
    let guard = match channel_binding_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let bindings = guard
        .bindings
        .iter()
        .filter(|binding| agent_id.trim().is_empty() || binding.agent_id == agent_id)
        .map(binding_json)
        .collect::<Vec<_>>();
    success_payload(
        "agent_channel_bindings_list",
        json!({ "bindings": bindings }),
    )
}

pub fn agent_channel_binding_upsert(input: ChannelBindingUpsertInput) -> AppResult<StubPayload> {
    let agent_id = input.agent_id.trim().to_string();
    let channel_id = input.channel_id.trim().to_string();
    if agent_id.is_empty() || channel_id.is_empty() {
        return invalid_argument("agent_id and channel_id are required");
    }
    let mut guard = match channel_binding_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let now = now_iso();
    if let Some(binding) = guard
        .bindings
        .iter_mut()
        .find(|binding| binding.agent_id == agent_id && binding.channel_id == channel_id)
    {
        binding.mirror_mode = input.mirror_mode;
        binding.topic_policy = input.topic_policy;
        binding.execution_policy = input.execution_policy;
        binding.enabled = input.enabled.unwrap_or(binding.enabled);
        binding.audit_event = "channel.binding.updated".to_string();
        binding.updated_at = now;
        let payload = binding_json(binding);
        if let Err(err) = persist_channel_binding_store(&guard) {
            return err;
        }
        return success_payload(
            "agent_channel_binding_upsert",
            json!({ "binding": payload }),
        );
    }
    guard.sequence += 1;
    let binding = ChannelBindingRecord {
        id: format!("channel-binding-{}", guard.sequence),
        agent_id,
        channel_id,
        mirror_mode: input.mirror_mode,
        topic_policy: input.topic_policy,
        execution_policy: input.execution_policy,
        enabled: input.enabled.unwrap_or(true),
        audit_event: "channel.binding.created".to_string(),
        created_at: now.clone(),
        updated_at: now,
    };
    guard.bindings.push(binding.clone());
    if let Err(err) = persist_channel_binding_store(&guard) {
        return err;
    }
    success_payload(
        "agent_channel_binding_upsert",
        json!({ "binding": binding_json(&binding) }),
    )
}

pub fn agent_channel_binding_toggle(input: ChannelBindingToggleInput) -> AppResult<StubPayload> {
    let id = input.id.trim().to_string();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match channel_binding_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let Some(binding) = guard.bindings.iter_mut().find(|binding| binding.id == id) else {
        return AppResult::fail(ErrorCode::NotFound, "Channel binding not found", None);
    };
    binding.enabled = input.enabled;
    binding.audit_event = "channel.binding.toggled".to_string();
    binding.updated_at = now_iso();
    let payload = binding_json(binding);
    if let Err(err) = persist_channel_binding_store(&guard) {
        return err;
    }
    success_payload(
        "agent_channel_binding_toggle",
        json!({ "binding": payload }),
    )
}

pub fn agent_channel_binding_delete(input: ChannelBindingDeleteInput) -> AppResult<StubPayload> {
    let id = input.id.trim().to_string();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match channel_binding_store().lock() {
        Ok(guard) => guard,
        Err(e) => return store_lock_error(e),
    };
    let before = guard.bindings.len();
    guard.bindings.retain(|binding| binding.id != id);
    if let Err(err) = persist_channel_binding_store(&guard) {
        return err;
    }
    success_payload(
        "agent_channel_binding_delete",
        json!({ "ok": before != guard.bindings.len() }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_binding_should_upsert_and_toggle() {
        let created = agent_channel_binding_upsert(ChannelBindingUpsertInput {
            agent_id: "agent-a".to_string(),
            channel_id: "channel-1".to_string(),
            mirror_mode: "inbound_outbound".to_string(),
            topic_policy: "channel_thread".to_string(),
            execution_policy: "manual_approval".to_string(),
            enabled: Some(true),
        });
        assert!(created.ok);
        let status: serde_json::Value =
            serde_json::from_str(&created.data.expect("payload").status).unwrap();
        let id = status["binding"]["id"].as_str().unwrap().to_string();
        let toggled =
            agent_channel_binding_toggle(ChannelBindingToggleInput { id, enabled: false });
        assert!(toggled.ok);
        let list = agent_channel_bindings_list(ChannelBindingListInput {
            agent_id: Some("agent-a".to_string()),
        });
        let status: serde_json::Value =
            serde_json::from_str(&list.data.expect("payload").status).unwrap();
        assert_eq!(status["bindings"][0]["enabled"], false);
    }
}
