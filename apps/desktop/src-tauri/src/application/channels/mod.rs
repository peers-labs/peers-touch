use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{
    ChannelCreateInput, ChannelEventsInput, ChannelIdInput, ChannelSendMessageInput, ChannelUpdateInput, StubPayload,
};
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};

#[derive(Clone)]
struct ChannelRecord {
    id: String,
    data: Value,
}

#[derive(Default)]
struct ChannelStore {
    channels: Vec<ChannelRecord>,
}

impl ChannelStore {
    fn seeded() -> Self {
        Self {
            channels: vec![ChannelRecord {
                id: "channel-1".to_string(),
                data: json!({
                    "id":"channel-1",
                    "name":"Default Channel",
                    "type":"webhook",
                    "config":"{}",
                    "enabled":true
                }),
            }],
        }
    }
}

static CHANNEL_STORE: OnceLock<Mutex<ChannelStore>> = OnceLock::new();

fn channel_store() -> &'static Mutex<ChannelStore> {
    CHANNEL_STORE.get_or_init(|| Mutex::new(ChannelStore::seeded()))
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
    AppResult::fail(ErrorCode::InternalError, "failed to access channels store", None)
}

pub fn channels_list() -> AppResult<StubPayload> {
    let guard = match channel_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let channels = guard.channels.iter().map(|item| item.data.clone()).collect::<Vec<_>>();
    success_payload("channels_list", json!({ "channels": channels }))
}

pub fn channels_get(input: ChannelIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let guard = match channel_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    if let Some(channel) = guard.channels.iter().find(|item| item.id == id) {
        return success_payload("channels_get", channel.data.clone());
    }
    AppResult::fail(ErrorCode::NotFound, "channel not found", None)
}

pub fn channels_create(input: ChannelCreateInput) -> AppResult<StubPayload> {
    if input.name.trim().is_empty() {
        return invalid_argument("name is required");
    }
    let mut guard = match channel_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let id = format!("channel-{}", guard.channels.len() + 1);
    let data = json!({
        "id": id,
        "name": input.name,
        "type": input.r#type,
        "config": input.config,
        "enabled": input.enabled.unwrap_or(true)
    });
    guard.channels.push(ChannelRecord {
        id: data.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
        data: data.clone(),
    });
    success_payload("channels_create", data)
}

pub fn channels_update(input: ChannelUpdateInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match channel_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    if let Some(channel) = guard.channels.iter_mut().find(|item| item.id == id) {
        if let Some(obj) = channel.data.as_object_mut() {
            if let Some(name) = input.name {
                obj.insert("name".to_string(), json!(name));
            }
            if let Some(ty) = input.r#type {
                obj.insert("type".to_string(), json!(ty));
            }
            if let Some(config) = input.config {
                obj.insert("config".to_string(), json!(config));
            }
            if let Some(enabled) = input.enabled {
                obj.insert("enabled".to_string(), json!(enabled));
            }
        }
        return success_payload("channels_update", channel.data.clone());
    }
    AppResult::fail(ErrorCode::NotFound, "channel not found", None)
}

pub fn channels_delete(input: ChannelIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim().to_string();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match channel_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let before = guard.channels.len();
    guard.channels.retain(|item| item.id != id);
    success_payload("channels_delete", json!({ "ok": before != guard.channels.len() }))
}

pub fn channels_test(input: ChannelIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("channels_test", json!({ "ok": true }))
}

pub fn channels_send(input: ChannelSendMessageInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    if input.text.trim().is_empty() {
        return invalid_argument("text is required");
    }
    success_payload("channels_send", json!({ "ok": true }))
}

pub fn channels_list_chats(input: ChannelIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("channels_list_chats", json!({ "chats": [] }))
}

pub fn channels_start_bot(input: ChannelIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("channels_start_bot", json!({ "ok": true }))
}

pub fn channels_stop_bot(input: ChannelIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("channels_stop_bot", json!({ "ok": true }))
}

pub fn channels_bot_status(input: ChannelIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    success_payload(
        "channels_bot_status",
        json!({
            "running": true,
            "last_error": null
        }),
    )
}

pub fn channels_list_events(input: ChannelEventsInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let limit = input.limit.unwrap_or(50);
    let offset = input.offset.unwrap_or(0);
    success_payload("channels_list_events", json!({ "events": [], "total": 0, "limit": limit, "offset": offset }))
}

pub fn channels_stats(input: ChannelIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    success_payload(
        "channels_stats",
        json!({
            "total_messages": 0,
            "success_messages": 0,
            "failed_messages": 0
        }),
    )
}
