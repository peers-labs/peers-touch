use crate::application::chat_storage;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::model::chat;
use reqwest::Method;
use serde_json::json;

use super::shared::request_proto;

pub fn list_sessions(
    token: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<chat::GetSessionsResponse, String> {
    let req = chat::GetSessionsRequest {
        limit: limit.unwrap_or(50) as i32,
        offset: offset.unwrap_or(0) as i32,
    };
    request_proto(Method::GET, "/friend-chat/sessions", token, Some(&req))
}

pub fn create_session(
    token: &str,
    participant_did: &str,
) -> Result<chat::CreateSessionResponse, String> {
    if participant_did.trim().is_empty() {
        return Err("participant_did is required".to_string());
    }
    let req = chat::CreateSessionRequest {
        participant_did: participant_did.to_string(),
    };
    request_proto(Method::POST, "/friend-chat/session/create", token, Some(&req))
}

pub fn list_messages(
    token: &str,
    user_scope: &str,
    session_ulid: &str,
    before_ulid: Option<&str>,
    limit: Option<u32>,
) -> Result<chat::GetMessagesResponse, String> {
    if session_ulid.trim().is_empty() {
        return Err("session_ulid is required".to_string());
    }
    let req = chat::GetMessagesRequest {
        session_ulid: session_ulid.to_string(),
        before_ulid: before_ulid.unwrap_or_default().to_string(),
        limit: limit.unwrap_or(50) as i32,
    };
    let resp: chat::GetMessagesResponse =
        request_proto(Method::GET, "/friend-chat/messages", token, Some(&req))?;
    let _ = chat_storage::ingest_friend_messages_proto(user_scope, &resp.messages);
    Ok(resp)
}

pub fn send_message(
    token: &str,
    user_scope: &str,
    session_ulid: &str,
    receiver_did: &str,
    content: &str,
    msg_type: Option<i32>,
    reply_to_ulid: Option<&str>,
) -> Result<chat::SendMessageResponse, String> {
    let req = chat::SendMessageRequest {
        session_ulid: session_ulid.to_string(),
        receiver_did: receiver_did.to_string(),
        r#type: msg_type.unwrap_or(1),
        content: content.to_string(),
        attachments: vec![],
        reply_to_ulid: reply_to_ulid.unwrap_or_default().to_string(),
    };
    let resp: chat::SendMessageResponse =
        request_proto(Method::POST, "/friend-chat/message/send", token, Some(&req))?;
    if let Some(ref msg) = resp.message {
        let _ = chat_storage::ingest_friend_messages_proto(user_scope, &[msg.clone()]);
    }
    Ok(resp)
}

pub fn ack_messages(
    token: &str,
    ulids: &[String],
    status: i32,
) -> Result<chat::MessageAckResponse, String> {
    let req = chat::MessageAckRequest {
        ulids: ulids.to_vec(),
        status,
    };
    request_proto(Method::POST, "/friend-chat/message/ack", token, Some(&req))
}

pub fn sync_messages(
    token: &str,
    messages: Vec<chat::SyncMessageItem>,
) -> Result<chat::SyncMessagesResponse, String> {
    let req = chat::SyncMessagesRequest { messages };
    request_proto(Method::POST, "/friend-chat/message/sync", token, Some(&req))
}

pub fn go_online(token: &str, did: Option<&str>) -> Result<chat::OnlineResponse, String> {
    let req = chat::OnlineRequest {
        did: did.unwrap_or_default().to_string(),
    };
    request_proto(Method::POST, "/friend-chat/online", token, Some(&req))
}

pub fn go_offline(token: &str, did: Option<&str>) -> Result<chat::OnlineResponse, String> {
    let req = chat::OnlineRequest {
        did: did.unwrap_or_default().to_string(),
    };
    request_proto(Method::POST, "/friend-chat/offline", token, Some(&req))
}

pub fn get_pending(
    token: &str,
    limit: Option<u32>,
) -> Result<chat::GetPendingResponse, String> {
    let req = chat::GetPendingRequest {
        limit: limit.unwrap_or(100) as i32,
    };
    request_proto(Method::GET, "/friend-chat/pending", token, Some(&req))
}

pub fn get_stats(token: &str) -> Result<chat::GetStatsResponse, String> {
    let req = chat::GetStatsRequest {};
    request_proto(Method::GET, "/friend-chat/stats", token, Some(&req))
}

pub fn local_search(query: &str, limit: Option<u32>) -> AppResult<StubPayload> {
    if query.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "query is required", None);
    }
    let limit = limit.unwrap_or(50).clamp(1, 200) as usize;
    match chat_storage::search_friend_messages("__default__", query, limit) {
        Ok(items) => AppResult::success(StubPayload {
            command: "friend_chat_local_search".to_string(),
            status: json!({ "messages": items }).to_string(),
        }),
        Err(reason) => AppResult::fail(
            ErrorCode::InternalError,
            "local search failed",
            Some(json!({ "reason": reason })),
        ),
    }
}

pub fn local_search_scoped(
    user_scope: &str,
    query: &str,
    limit: Option<u32>,
) -> AppResult<StubPayload> {
    if query.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "query is required", None);
    }
    let limit = limit.unwrap_or(50).clamp(1, 200) as usize;
    match chat_storage::search_friend_messages(user_scope, query, limit) {
        Ok(items) => AppResult::success(StubPayload {
            command: "friend_chat_local_search_scoped".to_string(),
            status: json!({ "messages": items }).to_string(),
        }),
        Err(reason) => AppResult::fail(
            ErrorCode::InternalError,
            "local search failed",
            Some(json!({ "reason": reason })),
        ),
    }
}

pub fn set_cursor_scoped(
    user_scope: &str,
    scope: &str,
    cursor: &str,
) -> AppResult<StubPayload> {
    if scope.trim().is_empty() || cursor.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "scope and cursor are required",
            None,
        );
    }
    match chat_storage::set_scope_cursor(user_scope, scope, cursor) {
        Ok(()) => AppResult::success(StubPayload {
            command: "friend_chat_set_cursor_scoped".to_string(),
            status: json!({"ok": true}).to_string(),
        }),
        Err(reason) => AppResult::fail(
            ErrorCode::InternalError,
            "set cursor failed",
            Some(json!({"reason": reason})),
        ),
    }
}

pub fn get_cursor_scoped(user_scope: &str, scope: &str) -> AppResult<StubPayload> {
    if scope.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "scope is required", None);
    }
    match chat_storage::get_scope_cursor(user_scope, scope) {
        Ok(cursor) => AppResult::success(StubPayload {
            command: "friend_chat_get_cursor_scoped".to_string(),
            status: json!({"cursor": cursor}).to_string(),
        }),
        Err(reason) => AppResult::fail(
            ErrorCode::InternalError,
            "get cursor failed",
            Some(json!({"reason": reason})),
        ),
    }
}

pub fn get_key_version_scoped(user_scope: &str) -> AppResult<StubPayload> {
    match chat_storage::get_chat_key_version(user_scope) {
        Ok(version) => AppResult::success(StubPayload {
            command: "friend_chat_get_key_version_scoped".to_string(),
            status: json!({"key_version": version}).to_string(),
        }),
        Err(reason) => AppResult::fail(
            ErrorCode::InternalError,
            "get key version failed",
            Some(json!({"reason": reason})),
        ),
    }
}

pub fn rotate_key_scoped(user_scope: &str, next_version: i32) -> AppResult<StubPayload> {
    if next_version <= 0 {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "next_version must be positive",
            None,
        );
    }
    match chat_storage::rotate_chat_key(user_scope, next_version) {
        Ok(version) => AppResult::success(StubPayload {
            command: "friend_chat_rotate_key_scoped".to_string(),
            status: json!({"key_version": version}).to_string(),
        }),
        Err(reason) => AppResult::fail(
            ErrorCode::InternalError,
            "rotate key failed",
            Some(json!({"reason": reason})),
        ),
    }
}

pub fn sync_from_station_scoped(
    token: &str,
    user_scope: &str,
    session_ulid: &str,
    limit: Option<u32>,
    max_pages: Option<u32>,
) -> AppResult<StubPayload> {
    if session_ulid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "session_ulid is required",
            None,
        );
    }

    let scope_key = format!("friend:{}", session_ulid);
    let cursor = match chat_storage::get_scope_cursor(user_scope, &scope_key) {
        Ok(c) => c,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "get cursor failed",
                Some(json!({"reason": reason})),
            )
        }
    };

    let page_limit = limit.unwrap_or(100) as i32;
    let max_pages = max_pages.unwrap_or(10);
    let mut current_cursor = cursor.clone();
    let mut total_synced = 0usize;
    let mut pages_fetched = 0u32;

    for _ in 0..max_pages {
        let before = current_cursor
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(|c| format!("since:{c}"))
            .unwrap_or_default();

        let req = chat::GetMessagesRequest {
            session_ulid: session_ulid.to_string(),
            before_ulid: before,
            limit: page_limit,
        };
        let resp: chat::GetMessagesResponse = match request_proto(
            Method::GET,
            "/friend-chat/messages",
            token,
            Some(&req),
        ) {
            Ok(data) => data,
            Err(reason) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    "sync fetch failed",
                    Some(json!({"reason": reason})),
                )
            }
        };

        pages_fetched += 1;

        let kept: Vec<_> = resp
            .messages
            .iter()
            .filter(|m| {
                if m.ulid.is_empty() {
                    return false;
                }
                match current_cursor.as_deref() {
                    Some(c) if !c.trim().is_empty() => m.ulid.as_str() > c,
                    _ => true,
                }
            })
            .cloned()
            .collect();

        total_synced += kept.len();

        let latest = kept.iter().map(|m| m.ulid.as_str()).max().map(String::from);

        let _ = chat_storage::ingest_friend_messages_proto(user_scope, &kept);

        let next = if !resp.next_cursor.is_empty() {
            Some(resp.next_cursor.clone())
        } else {
            latest
        };

        if let Some(ref new_cursor) = next {
            let _ = chat_storage::set_scope_cursor(user_scope, &scope_key, new_cursor);
            current_cursor = Some(new_cursor.clone());
        }

        if !resp.has_more {
            break;
        }
    }

    AppResult::success(StubPayload {
        command: "friend_chat_sync_from_station_scoped".to_string(),
        status: json!({
            "synced_count": total_synced,
            "pages_fetched": pages_fetched,
            "cursor_before": cursor,
            "cursor_after": current_cursor
        })
        .to_string(),
    })
}
