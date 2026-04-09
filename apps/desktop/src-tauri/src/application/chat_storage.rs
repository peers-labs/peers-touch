use crate::infrastructure::local_chat_store::{self, LocalChatRecord};
use crate::infrastructure::station_client;
use reqwest::Method;
use serde_json::Value;

pub struct SyncResult {
    pub synced_count: usize,
    pub pages_fetched: u32,
    pub cursor_before: Option<String>,
    pub cursor_after: Option<String>,
}

pub fn ingest_friend_messages(user_scope: &str, payload: &Value) -> Result<(), String> {
    local_chat_store::ingest_friend_payload(user_scope, payload)
}

pub fn ingest_group_messages(user_scope: &str, payload: &Value) -> Result<(), String> {
    local_chat_store::ingest_group_payload(user_scope, payload)
}

pub fn search_friend_messages(user_scope: &str, query: &str, limit: usize) -> Result<Vec<LocalChatRecord>, String> {
    local_chat_store::search_local(user_scope, "friend", query, limit)
}

pub fn search_group_messages(user_scope: &str, query: &str, limit: usize) -> Result<Vec<LocalChatRecord>, String> {
    local_chat_store::search_local(user_scope, "group", query, limit)
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

pub fn list_friend_sessions(token: &str, limit: u32, offset: u32) -> Result<Value, String> {
    let query = vec![
        ("limit", limit.to_string()),
        ("offset", offset.to_string()),
    ];
    station_client::request_json(Method::GET, "/friend-chat/sessions", token, Some(&query), None)
}

pub fn create_friend_session(token: &str, participant_did: &str) -> Result<Value, String> {
    station_client::request_json(
        Method::POST, "/friend-chat/session/create", token, None,
        Some(serde_json::json!({ "participant_did": participant_did })),
    )
}

pub fn list_friend_messages(token: &str, session_ulid: &str, limit: u32, before_ulid: Option<&str>) -> Result<Value, String> {
    let mut query = vec![
        ("session_ulid", session_ulid.to_string()),
        ("limit", limit.to_string()),
    ];
    if let Some(before) = before_ulid {
        query.push(("before_ulid", before.to_string()));
    }
    station_client::request_json(Method::GET, "/friend-chat/messages", token, Some(&query), None)
}

pub fn send_friend_message(token: &str, session_ulid: &str, receiver_did: &str, content: &str, msg_type: i32, reply_to_ulid: &str) -> Result<Value, String> {
    station_client::request_json(
        Method::POST, "/friend-chat/message/send", token, None,
        Some(serde_json::json!({
            "session_ulid": session_ulid,
            "receiver_did": receiver_did,
            "content": content,
            "type": msg_type,
            "reply_to_ulid": reply_to_ulid,
        })),
    )
}

pub fn ack_friend_messages(token: &str, ulids: &[String], status: i32) -> Result<Value, String> {
    station_client::request_json(
        Method::POST, "/friend-chat/message/ack", token, None,
        Some(serde_json::json!({ "ulids": ulids, "status": status })),
    )
}

pub fn list_groups(token: &str, limit: u32, offset: u32) -> Result<Value, String> {
    let query = vec![
        ("limit", limit.to_string()),
        ("offset", offset.to_string()),
    ];
    station_client::request_json(Method::GET, "/group-chat/list", token, Some(&query), None)
}

pub fn list_group_messages(token: &str, group_ulid: &str, limit: u32, before_ulid: Option<&str>) -> Result<Value, String> {
    let mut query = vec![
        ("group_ulid", group_ulid.to_string()),
        ("limit", limit.to_string()),
    ];
    if let Some(before) = before_ulid {
        query.push(("before_ulid", before.to_string()));
    }
    station_client::request_json(Method::GET, "/group-chat/messages", token, Some(&query), None)
}

pub fn send_group_message(token: &str, group_ulid: &str, content: &str, msg_type: i32, reply_to_ulid: &str, mentioned_dids: &[String], mention_all: bool) -> Result<Value, String> {
    station_client::request_json(
        Method::POST, "/group-chat/message/send", token, None,
        Some(serde_json::json!({
            "group_ulid": group_ulid,
            "content": content,
            "type": msg_type,
            "reply_to_ulid": reply_to_ulid,
            "mentioned_dids": mentioned_dids,
            "mention_all": mention_all,
        })),
    )
}

pub fn group_unread_count(token: &str, group_ulid: Option<&str>) -> Result<Value, String> {
    let mut query = Vec::new();
    if let Some(gid) = group_ulid {
        query.push(("group_ulid", gid.to_string()));
    }
    station_client::request_json(Method::GET, "/group-chat/unread-count", token, Some(&query), None)
}

pub fn group_mark_read(token: &str, group_ulid: &str) -> Result<Value, String> {
    station_client::request_json(
        Method::POST, "/group-chat/mark-read", token, None,
        Some(serde_json::json!({ "group_ulid": group_ulid })),
    )
}

pub fn extract_latest_ulid(payload: &Value) -> Option<String> {
    let messages = payload.get("messages")?.as_array()?;
    for item in messages {
        if let Some(ulid) = item.get("ulid").and_then(|v| v.as_str()) {
            if !ulid.trim().is_empty() {
                return Some(ulid.to_string());
            }
        }
    }
    None
}

pub fn filter_incremental_messages(payload: &Value, cursor: Option<&str>) -> (Value, usize, Option<String>) {
    let mut filtered_payload = payload.clone();
    let mut synced_count = 0usize;
    let mut latest: Option<String> = None;
    if let Some(messages) = payload.get("messages").and_then(|v| v.as_array()) {
        let mut out = Vec::new();
        for item in messages {
            let ulid = item
                .get("ulid")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if ulid.is_empty() {
                continue;
            }
            let should_keep = match cursor {
                Some(c) if !c.trim().is_empty() => ulid.as_str() > c,
                _ => true,
            };
            if should_keep {
                synced_count += 1;
                if latest.as_ref().map(|v| ulid.as_str() > v.as_str()).unwrap_or(true) {
                    latest = Some(ulid.clone());
                }
                out.push(item.clone());
            }
        }
        if let Some(obj) = filtered_payload.as_object_mut() {
            obj.insert("messages".to_string(), Value::Array(out));
        }
    }
    (filtered_payload, synced_count, latest)
}

pub fn sync_friend_from_station(token: &str, user_scope: &str, session_ulid: &str, page_limit: u32, max_pages: u32) -> Result<SyncResult, String> {
    let scope_key = format!("friend:{session_ulid}");
    let cursor = get_scope_cursor(user_scope, &scope_key)?;
    let mut current_cursor = cursor.clone();
    let mut total_synced = 0usize;
    let mut pages_fetched = 0u32;
    for _ in 0..max_pages {
        let before = current_cursor.as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(|c| format!("since:{c}"));
        let data = list_friend_messages(token, session_ulid, page_limit, before.as_deref())?;
        pages_fetched += 1;
        let (payload, count, latest) = filter_incremental_messages(&data, current_cursor.as_deref());
        let _ = ingest_friend_messages(user_scope, &payload);
        total_synced += count;
        let server_cursor = data.get("nextCursor").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
        let next = server_cursor.or(latest).or_else(|| extract_latest_ulid(&data));
        if let Some(ref nc) = next {
            let _ = set_scope_cursor(user_scope, &scope_key, nc);
            current_cursor = Some(nc.clone());
        }
        let has_more = data.get("hasMore").and_then(|v| v.as_bool()).unwrap_or(false);
        if !has_more { break; }
    }
    Ok(SyncResult { synced_count: total_synced, pages_fetched, cursor_before: cursor, cursor_after: current_cursor })
}

pub fn sync_friend_messages(token: &str, session_ulid: &str, messages_json: &str) -> Result<Value, String> {
    let body: Value = serde_json::from_str(messages_json).map_err(|e| format!("invalid json: {e}"))?;
    station_client::request_json(
        Method::POST, "/friend-chat/message/sync", token, None,
        Some(serde_json::json!({ "session_ulid": session_ulid, "messages": body })),
    )
}

pub fn friend_chat_online(token: &str) -> Result<Value, String> {
    station_client::request_json(Method::POST, "/friend-chat/online", token, None, None)
}

pub fn friend_chat_offline(token: &str) -> Result<Value, String> {
    station_client::request_json(Method::POST, "/friend-chat/offline", token, None, None)
}

pub fn friend_chat_pending(token: &str) -> Result<Value, String> {
    station_client::request_json(Method::GET, "/friend-chat/pending", token, None, None)
}

pub fn friend_chat_stats(token: &str) -> Result<Value, String> {
    station_client::request_json(Method::GET, "/friend-chat/stats", token, None, None)
}

pub fn create_group(token: &str, name: &str, description: &str, member_dids: &[String]) -> Result<Value, String> {
    station_client::request_json(
        Method::POST, "/group-chat/create", token, None,
        Some(serde_json::json!({ "name": name, "description": description, "member_dids": member_dids })),
    )
}

pub fn group_info(token: &str, group_ulid: &str) -> Result<Value, String> {
    let query = vec![("group_ulid", group_ulid.to_string())];
    station_client::request_json(Method::GET, "/group-chat/info", token, Some(&query), None)
}

pub fn update_group(token: &str, group_ulid: &str, name: &str, description: &str) -> Result<Value, String> {
    station_client::request_json(
        Method::PUT, "/group-chat/update", token, None,
        Some(serde_json::json!({ "group_ulid": group_ulid, "name": name, "description": description })),
    )
}

pub fn group_invite(token: &str, group_ulid: &str, member_dids: &[String]) -> Result<Value, String> {
    station_client::request_json(
        Method::POST, "/group-chat/invite", token, None,
        Some(serde_json::json!({ "group_ulid": group_ulid, "member_dids": member_dids })),
    )
}

pub fn group_join(token: &str, group_ulid: &str) -> Result<Value, String> {
    station_client::request_json(
        Method::POST, "/group-chat/join", token, None,
        Some(serde_json::json!({ "group_ulid": group_ulid })),
    )
}

pub fn group_leave(token: &str, group_ulid: &str) -> Result<Value, String> {
    station_client::request_json(
        Method::POST, "/group-chat/leave", token, None,
        Some(serde_json::json!({ "group_ulid": group_ulid })),
    )
}

pub fn group_members(token: &str, group_ulid: &str) -> Result<Value, String> {
    let query = vec![("group_ulid", group_ulid.to_string())];
    station_client::request_json(Method::GET, "/group-chat/members", token, Some(&query), None)
}

pub fn group_remove_member(token: &str, group_ulid: &str, member_did: &str) -> Result<Value, String> {
    station_client::request_json(
        Method::POST, "/group-chat/member/remove", token, None,
        Some(serde_json::json!({ "group_ulid": group_ulid, "member_did": member_did })),
    )
}

pub fn group_recall_message(token: &str, group_ulid: &str, message_ulid: &str) -> Result<Value, String> {
    station_client::request_json(
        Method::POST, "/group-chat/message/recall", token, None,
        Some(serde_json::json!({ "group_ulid": group_ulid, "message_ulid": message_ulid })),
    )
}

pub fn group_delete_message(token: &str, group_ulid: &str, message_ulid: &str) -> Result<Value, String> {
    station_client::request_json(
        Method::POST, "/group-chat/message/delete", token, None,
        Some(serde_json::json!({ "group_ulid": group_ulid, "message_ulid": message_ulid })),
    )
}

pub fn group_search_messages(token: &str, group_ulid: &str, query: &str, limit: u32) -> Result<Value, String> {
    let q = vec![
        ("group_ulid", group_ulid.to_string()),
        ("query", query.to_string()),
        ("limit", limit.to_string()),
    ];
    station_client::request_json(Method::GET, "/group-chat/messages/search", token, Some(&q), None)
}

pub fn group_update_nickname(token: &str, group_ulid: &str, nickname: &str) -> Result<Value, String> {
    station_client::request_json(
        Method::PUT, "/group-chat/member/nickname", token, None,
        Some(serde_json::json!({ "group_ulid": group_ulid, "nickname": nickname })),
    )
}

pub fn group_get_my_settings(token: &str, group_ulid: &str) -> Result<Value, String> {
    let query = vec![("group_ulid", group_ulid.to_string())];
    station_client::request_json(Method::GET, "/group-chat/my-settings", token, Some(&query), None)
}

pub fn group_update_my_settings(token: &str, group_ulid: &str, settings_json: &str) -> Result<Value, String> {
    let settings: Value = serde_json::from_str(settings_json).map_err(|e| format!("invalid json: {e}"))?;
    station_client::request_json(
        Method::PUT, "/group-chat/my-settings", token, None,
        Some(serde_json::json!({ "group_ulid": group_ulid, "settings": settings })),
    )
}

pub fn group_offline_messages(token: &str, group_ulid: &str) -> Result<Value, String> {
    let query = vec![("group_ulid", group_ulid.to_string())];
    station_client::request_json(Method::GET, "/group-chat/offline-messages", token, Some(&query), None)
}

pub fn group_ack_offline(token: &str, group_ulid: &str, message_ulids: &[String]) -> Result<Value, String> {
    station_client::request_json(
        Method::POST, "/group-chat/offline-messages/ack", token, None,
        Some(serde_json::json!({ "group_ulid": group_ulid, "message_ulids": message_ulids })),
    )
}

pub fn group_stats(token: &str) -> Result<Value, String> {
    station_client::request_json(Method::GET, "/group-chat/stats", token, None, None)
}

pub fn sync_group_from_station(token: &str, user_scope: &str, group_ulid: &str, page_limit: u32, max_pages: u32) -> Result<SyncResult, String> {
    let scope_key = format!("group:{group_ulid}");
    let cursor = get_scope_cursor(user_scope, &scope_key)?;
    let mut current_cursor = cursor.clone();
    let mut total_synced = 0usize;
    let mut pages_fetched = 0u32;
    for _ in 0..max_pages {
        let before = current_cursor.as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(|c| format!("since:{c}"));
        let data = list_group_messages(token, group_ulid, page_limit, before.as_deref())?;
        pages_fetched += 1;
        let (payload, count, latest) = filter_incremental_messages(&data, current_cursor.as_deref());
        let _ = ingest_group_messages(user_scope, &payload);
        total_synced += count;
        let server_cursor = data.get("nextCursor").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
        let next = server_cursor.or(latest).or_else(|| extract_latest_ulid(&data));
        if let Some(ref nc) = next {
            let _ = set_scope_cursor(user_scope, &scope_key, nc);
            current_cursor = Some(nc.clone());
        }
        let has_more = data.get("hasMore").and_then(|v| v.as_bool()).unwrap_or(false);
        if !has_more { break; }
    }
    Ok(SyncResult { synced_count: total_synced, pages_fetched, cursor_before: cursor, cursor_after: current_cursor })
}
