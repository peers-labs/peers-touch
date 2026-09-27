//! Local chat projection helpers and shared Station-backed thread/presence reads.

use crate::infrastructure::local_chat_store::{self, LocalChatRecord};
use crate::infrastructure::station_client;
use crate::model;
use reqwest::Method;
use serde_json::{json, Value};

type StationResult<T> = Result<T, station_client::StationClientError>;

fn ts_millis(ts: &Option<prost_types::Timestamp>) -> serde_json::Value {
    match ts {
        Some(t) => {
            serde_json::Value::Number((t.seconds * 1000 + (t.nanos as i64) / 1_000_000).into())
        }
        None => serde_json::Value::Null,
    }
}

fn presence_update_response_to_value(resp: &model::presence::PresenceUpdateResponse) -> Value {
    json!({
        "actorPtid": resp.actor_ptid,
        "sessionId": resp.session_id,
        "state": resp.state,
        "leaseExpiresAt": ts_millis(&resp.lease_expires_at),
    })
}

pub fn ingest_group_messages(user_scope: &str, payload: &Value) -> Result<(), String> {
    local_chat_store::ingest_group_payload(user_scope, payload)
}

pub fn search_group_messages(
    user_scope: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<LocalChatRecord>, String> {
    local_chat_store::search_local(user_scope, Some("group"), None, query, limit)
}

pub fn set_scope_cursor(user_scope: &str, scope: &str, cursor: &str) -> Result<(), String> {
    local_chat_store::set_sync_cursor(user_scope, scope, cursor)
}

pub fn get_scope_cursor(user_scope: &str, scope: &str) -> Result<Option<String>, String> {
    local_chat_store::get_sync_cursor(user_scope, scope)
}

pub fn get_chat_key_version(user_scope: &str) -> Result<Option<i32>, String> {
    local_chat_store::get_chat_key_version(user_scope)
}

pub fn rotate_chat_key(user_scope: &str, next_version: i32) -> Result<i32, String> {
    local_chat_store::rotate_chat_key(user_scope, next_version)
}

fn message_ulid(value: &Value) -> &str {
    value
        .get("ulid")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
}

fn message_reply_to_ulid(value: &Value) -> &str {
    value
        .get("replyToUlid")
        .or_else(|| value.get("reply_to_ulid"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
}

fn message_thread_root_ulid(value: &Value) -> &str {
    value
        .get("threadRootUlid")
        .or_else(|| value.get("thread_root_ulid"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
}

fn sent_at_millis(value: &Value) -> i64 {
    value
        .get("sent_at")
        .or_else(|| value.get("sentAt"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
}

fn thread_payload(root_ulid: &str, mut collected: Vec<Value>, hit_page_cap: bool) -> Value {
    let root = collected
        .iter()
        .find(|item| message_ulid(item) == root_ulid)
        .cloned();
    let mut replies: Vec<Value> = collected
        .drain(..)
        .filter(|item| {
            message_thread_root_ulid(item) == root_ulid
                || (message_thread_root_ulid(item).is_empty()
                    && message_reply_to_ulid(item) == root_ulid)
        })
        .collect();
    replies.sort_by(|a, b| {
        let by_time = sent_at_millis(a).cmp(&sent_at_millis(b));
        if by_time == std::cmp::Ordering::Equal {
            message_ulid(a).cmp(message_ulid(b))
        } else {
            by_time
        }
    });
    let mut messages = Vec::with_capacity(replies.len() + 1);
    if let Some(root_msg) = root.clone() {
        messages.push(root_msg);
    }
    messages.extend(replies.iter().cloned());
    let reply_count = replies.len();
    json!({
        "root": root,
        "replies": replies,
        "messages": messages,
        "replyCount": reply_count,
        "hitPageCap": hit_page_cap,
    })
}

pub fn list_group_thread_messages(
    token: &str,
    group_ulid: &str,
    root_ulid: &str,
    page_limit: u32,
    after_ulid: Option<&str>,
    _max_pages: u32,
) -> StationResult<Value> {
    let limit = page_limit.clamp(1, 100);
    let mut query = vec![
        ("conversation_id", group_ulid.to_string()),
        ("root_id", root_ulid.to_string()),
        ("limit", limit.to_string()),
    ];
    if let Some(after) = after_ulid {
        if !after.is_empty() {
            query.push(("after_seq", after.to_string()));
        }
    }
    station_client::request_json(
        Method::GET,
        "/conversation/thread/messages",
        token,
        Some(&query),
        None,
    )
}

pub fn presence_heartbeat(token: &str, reason: &str) -> StationResult<Value> {
    let req = model::presence::PresenceHeartbeatRequest {
        reason: reason.to_string(),
    };
    let resp = station_client::request_proto::<
        model::presence::PresenceHeartbeatRequest,
        model::presence::PresenceUpdateResponse,
    >(Method::POST, "/presence/heartbeat", token, None, Some(&req))?;
    Ok(presence_update_response_to_value(&resp))
}

pub fn presence_offline(token: &str, reason: &str) -> StationResult<Value> {
    let req = model::presence::PresenceOfflineRequest {
        reason: reason.to_string(),
    };
    let resp = station_client::request_proto::<
        model::presence::PresenceOfflineRequest,
        model::presence::PresenceUpdateResponse,
    >(Method::POST, "/presence/offline", token, None, Some(&req))?;
    Ok(presence_update_response_to_value(&resp))
}
