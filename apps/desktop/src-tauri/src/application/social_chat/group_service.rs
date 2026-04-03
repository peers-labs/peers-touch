use crate::application::chat_storage;
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::model::chat;
use reqwest::Method;
use serde_json::json;

use super::shared::request_proto;

pub fn list_groups(
    token: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<chat::ListGroupsResponse, String> {
    let req = chat::ListGroupsRequest {
        limit: limit.unwrap_or(50) as i32,
        offset: offset.unwrap_or(0) as i32,
    };
    request_proto(Method::GET, "/group-chat/list", token, Some(&req))
}

pub fn list_messages(
    token: &str,
    user_scope: &str,
    group_ulid: &str,
    before_ulid: Option<&str>,
    limit: Option<u32>,
) -> Result<chat::GetGroupMessagesResponse, String> {
    if group_ulid.trim().is_empty() {
        return Err("group_ulid is required".to_string());
    }
    let req = chat::GetGroupMessagesRequest {
        group_ulid: group_ulid.to_string(),
        before_ulid: before_ulid.unwrap_or_default().to_string(),
        limit: limit.unwrap_or(50) as i32,
    };
    let resp: chat::GetGroupMessagesResponse =
        request_proto(Method::GET, "/group-chat/messages", token, Some(&req))?;
    let _ = chat_storage::ingest_group_messages_proto(user_scope, &resp.messages);
    Ok(resp)
}

pub fn send_message(
    token: &str,
    user_scope: &str,
    group_ulid: &str,
    content: &str,
    msg_type: Option<i32>,
    reply_to_ulid: Option<&str>,
    mentioned_dids: Option<&[String]>,
    mention_all: Option<bool>,
) -> Result<chat::SendGroupMessageResponse, String> {
    let req = chat::SendGroupMessageRequest {
        group_ulid: group_ulid.to_string(),
        r#type: msg_type.unwrap_or(1),
        content: content.to_string(),
        attachments: vec![],
        reply_to_ulid: reply_to_ulid.unwrap_or_default().to_string(),
        mentioned_dids: mentioned_dids.unwrap_or_default().to_vec(),
        mention_all: mention_all.unwrap_or(false),
    };
    let resp: chat::SendGroupMessageResponse =
        request_proto(Method::POST, "/group-chat/message/send", token, Some(&req))?;
    if let Some(ref msg) = resp.message {
        let _ = chat_storage::ingest_group_messages_proto(user_scope, &[msg.clone()]);
    }
    Ok(resp)
}

pub fn unread_count(
    token: &str,
    group_ulid: Option<&str>,
) -> Result<chat::GetUnreadCountResponse, String> {
    let req = chat::GetUnreadCountRequest {
        group_ulid: group_ulid.unwrap_or_default().to_string(),
    };
    request_proto(Method::GET, "/group-chat/unread-count", token, Some(&req))
}

pub fn mark_read(
    token: &str,
    group_ulid: &str,
) -> Result<chat::MarkGroupReadResponse, String> {
    let req = chat::MarkGroupReadRequest {
        group_ulid: group_ulid.to_string(),
        up_to_ulid: String::new(),
    };
    request_proto(Method::POST, "/group-chat/mark-read", token, Some(&req))
}

pub fn create_group(
    token: &str,
    name: &str,
    description: Option<&str>,
    member_dids: Option<&[String]>,
) -> Result<chat::CreateGroupResponse, String> {
    let req = chat::CreateGroupRequest {
        name: name.to_string(),
        description: description.unwrap_or_default().to_string(),
        r#type: 1, // GROUP_TYPE_NORMAL
        visibility: 2, // GROUP_VISIBILITY_PRIVATE
        initial_member_dids: member_dids.unwrap_or_default().to_vec(),
    };
    request_proto(Method::POST, "/group-chat/create", token, Some(&req))
}

pub fn get_group(
    token: &str,
    group_ulid: &str,
) -> Result<chat::GetGroupResponse, String> {
    let req = chat::GetGroupRequest {
        group_ulid: group_ulid.to_string(),
    };
    request_proto(Method::GET, "/group-chat/info", token, Some(&req))
}

pub fn update_group(
    token: &str,
    group_ulid: &str,
    name: &str,
    description: Option<&str>,
) -> Result<chat::UpdateGroupResponse, String> {
    let req = chat::UpdateGroupRequest {
        group_ulid: group_ulid.to_string(),
        name: Some(name.to_string()),
        description: description.map(|d| d.to_string()),
        avatar_cid: None,
        r#type: None,
        visibility: None,
        muted: None,
    };
    request_proto(Method::PUT, "/group-chat/update", token, Some(&req))
}

pub fn invite_to_group(
    token: &str,
    group_ulid: &str,
    member_dids: &[String],
) -> Result<chat::InviteToGroupResponse, String> {
    let req = chat::InviteToGroupRequest {
        group_ulid: group_ulid.to_string(),
        invitee_dids: member_dids.to_vec(),
    };
    request_proto(Method::POST, "/group-chat/invite", token, Some(&req))
}

pub fn join_group(
    token: &str,
    group_ulid: &str,
    invitation_ulid: Option<&str>,
) -> Result<chat::JoinGroupResponse, String> {
    let req = chat::JoinGroupRequest {
        group_ulid: group_ulid.to_string(),
        invitation_ulid: invitation_ulid.unwrap_or_default().to_string(),
    };
    request_proto(Method::POST, "/group-chat/join", token, Some(&req))
}

pub fn leave_group(
    token: &str,
    group_ulid: &str,
) -> Result<chat::LeaveGroupResponse, String> {
    let req = chat::LeaveGroupRequest {
        group_ulid: group_ulid.to_string(),
    };
    request_proto(Method::POST, "/group-chat/leave", token, Some(&req))
}

pub fn get_members(
    token: &str,
    group_ulid: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<chat::GetGroupMembersResponse, String> {
    let req = chat::GetGroupMembersRequest {
        group_ulid: group_ulid.to_string(),
        limit: limit.unwrap_or(50) as i32,
        offset: offset.unwrap_or(0) as i32,
    };
    request_proto(Method::GET, "/group-chat/members", token, Some(&req))
}

pub fn remove_member(
    token: &str,
    group_ulid: &str,
    member_did: &str,
) -> Result<chat::RemoveMemberResponse, String> {
    let req = chat::RemoveMemberRequest {
        group_ulid: group_ulid.to_string(),
        actor_did: member_did.to_string(),
    };
    request_proto(Method::POST, "/group-chat/member/remove", token, Some(&req))
}

pub fn recall_message(
    token: &str,
    group_ulid: &str,
    message_ulid: &str,
) -> Result<chat::RecallGroupMessageResponse, String> {
    let req = chat::RecallGroupMessageRequest {
        group_ulid: group_ulid.to_string(),
        message_ulid: message_ulid.to_string(),
    };
    request_proto(Method::POST, "/group-chat/message/recall", token, Some(&req))
}

pub fn delete_message(
    token: &str,
    group_ulid: &str,
    message_ulid: &str,
) -> Result<chat::DeleteGroupMessageResponse, String> {
    let req = chat::DeleteGroupMessageRequest {
        group_ulid: group_ulid.to_string(),
        message_ulid: message_ulid.to_string(),
    };
    request_proto(Method::POST, "/group-chat/message/delete", token, Some(&req))
}

pub fn search_messages(
    token: &str,
    group_ulid: &str,
    query: &str,
    limit: Option<u32>,
) -> Result<chat::SearchGroupMessagesResponse, String> {
    let req = chat::SearchGroupMessagesRequest {
        group_ulid: group_ulid.to_string(),
        query: query.to_string(),
        limit: limit.unwrap_or(50) as i32,
        before_ulid: String::new(),
    };
    request_proto(Method::GET, "/group-chat/messages/search", token, Some(&req))
}

pub fn update_nickname(
    token: &str,
    group_ulid: &str,
    nickname: &str,
) -> Result<chat::UpdateMyNicknameResponse, String> {
    let req = chat::UpdateMyNicknameRequest {
        group_ulid: group_ulid.to_string(),
        nickname: nickname.to_string(),
    };
    request_proto(Method::PUT, "/group-chat/member/nickname", token, Some(&req))
}

pub fn get_settings(
    token: &str,
    group_ulid: &str,
) -> Result<chat::GetGroupSettingsResponse, String> {
    let req = chat::GetGroupSettingsRequest {
        group_ulid: group_ulid.to_string(),
    };
    request_proto(Method::GET, "/group-chat/my-settings", token, Some(&req))
}

pub fn update_settings(
    token: &str,
    group_ulid: &str,
    settings_json: &str,
) -> Result<chat::UpdateGroupSettingsResponse, String> {
    #[derive(serde::Deserialize)]
    struct SettingsPayload {
        is_muted: Option<bool>,
        is_pinned: Option<bool>,
        show_member_nickname: Option<bool>,
    }
    let parsed: SettingsPayload =
        serde_json::from_str(settings_json).map_err(|e| format!("invalid settings_json: {e}"))?;
    let req = chat::UpdateGroupSettingsRequest {
        group_ulid: group_ulid.to_string(),
        is_muted: parsed.is_muted,
        is_pinned: parsed.is_pinned,
        show_member_nickname: parsed.show_member_nickname,
    };
    request_proto(Method::PUT, "/group-chat/my-settings", token, Some(&req))
}

pub fn get_offline_messages(
    token: &str,
    group_ulid: &str,
    limit: Option<u32>,
) -> Result<chat::GetOfflineMessagesResponse, String> {
    let _ = group_ulid; // reserved for future per-group filtering
    let req = chat::GetOfflineMessagesRequest {
        limit: limit.unwrap_or(100) as i32,
    };
    request_proto(Method::GET, "/group-chat/offline-messages", token, Some(&req))
}

pub fn ack_offline_messages(
    token: &str,
    group_ulid: &str,
    message_ulids: &[String],
) -> Result<chat::AckOfflineMessagesResponse, String> {
    let _ = group_ulid; // reserved for future per-group filtering
    let req = chat::AckOfflineMessagesRequest {
        ulids: message_ulids.to_vec(),
    };
    request_proto(Method::POST, "/group-chat/offline-messages/ack", token, Some(&req))
}

pub fn get_stats(
    token: &str,
) -> Result<chat::GetGroupStatsResponse, String> {
    let req = chat::GetGroupStatsRequest {};
    request_proto(Method::GET, "/group-chat/stats", token, Some(&req))
}

pub fn local_search(query: &str, limit: Option<u32>) -> AppResult<StubPayload> {
    if query.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "query is required", None);
    }
    let limit = limit.unwrap_or(50).clamp(1, 200) as usize;
    match chat_storage::search_group_messages("__default__", query, limit) {
        Ok(items) => AppResult::success(StubPayload {
            command: "group_chat_local_search".to_string(),
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
    match chat_storage::search_group_messages(user_scope, query, limit) {
        Ok(items) => AppResult::success(StubPayload {
            command: "group_chat_local_search_scoped".to_string(),
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
            command: "group_chat_set_cursor_scoped".to_string(),
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
            command: "group_chat_get_cursor_scoped".to_string(),
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
            command: "group_chat_get_key_version_scoped".to_string(),
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
            command: "group_chat_rotate_key_scoped".to_string(),
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
    group_ulid: &str,
    limit: Option<u32>,
    max_pages: Option<u32>,
) -> AppResult<StubPayload> {
    if group_ulid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "group_ulid is required",
            None,
        );
    }

    let scope_key = format!("group:{}", group_ulid);
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

        let req = chat::GetGroupMessagesRequest {
            group_ulid: group_ulid.to_string(),
            before_ulid: before,
            limit: page_limit,
        };
        let resp: chat::GetGroupMessagesResponse = match request_proto(
            Method::GET,
            "/group-chat/messages",
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

        let _ = chat_storage::ingest_group_messages_proto(user_scope, &kept);

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
        command: "group_chat_sync_from_station_scoped".to_string(),
        status: json!({
            "synced_count": total_synced,
            "pages_fetched": pages_fetched,
            "cursor_before": cursor,
            "cursor_after": current_cursor
        })
        .to_string(),
    })
}
