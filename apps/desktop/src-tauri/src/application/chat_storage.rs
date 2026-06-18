//! Local chat + optional Station protobuf clients. Several `pub` HTTP helpers are not wired from
//! Tauri commands yet; conversion helpers are still used when those entry points are called.
#![allow(dead_code)]

use crate::infrastructure::local_chat_store::{self, LocalChatRecord};
use crate::infrastructure::station_client;
use crate::model;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use reqwest::Method;
use serde_json::{json, Value};

type StationResult<T> = Result<T, station_client::StationClientError>;

fn invalid_response_err(message: impl Into<String>) -> station_client::StationClientError {
    station_client::StationClientError::new(
        station_client::StationClientErrorKind::InvalidResponse,
        message.into(),
        None,
    )
}

fn ts_millis(ts: &Option<prost_types::Timestamp>) -> serde_json::Value {
    match ts {
        Some(t) => {
            serde_json::Value::Number((t.seconds * 1000 + (t.nanos as i64) / 1_000_000).into())
        }
        None => serde_json::Value::Null,
    }
}

fn ts_millis_i64(ts: &Option<prost_types::Timestamp>) -> i64 {
    match ts {
        Some(t) => t.seconds * 1000 + (t.nanos as i64) / 1_000_000,
        None => 0,
    }
}

fn bytes_to_b64(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        String::new()
    } else {
        B64.encode(bytes)
    }
}

fn json_str(v: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
            return Some(s.to_string());
        }
    }
    None
}

fn json_i32(v: &Value, keys: &[&str]) -> Option<i32> {
    for k in keys {
        if let Some(n) = v.get(*k).and_then(|x| x.as_i64()) {
            return Some(n as i32);
        }
    }
    None
}

fn millis_to_timestamp(ms: i64) -> prost_types::Timestamp {
    prost_types::Timestamp {
        seconds: ms / 1000,
        nanos: ((ms % 1000) * 1_000_000) as i32,
    }
}

fn json_to_optional_timestamp(v: &Value, keys: &[&str]) -> Option<prost_types::Timestamp> {
    let ms = keys
        .iter()
        .find_map(|k| v.get(*k).and_then(|x| x.as_i64()))?;
    Some(millis_to_timestamp(ms))
}

fn friend_attachment_to_json(a: &model::chat::FriendMessageAttachment) -> Value {
    json!({
        "cid": a.cid,
        "filename": a.filename,
        "mimeType": a.mime_type,
        "size": a.size,
        "thumbnailCid": a.thumbnail_cid,
        "visibility": a.visibility,
    })
}

/// Friend message JSON: camelCase proto fields plus snake_case keys required by local ingest (`ingest_friend_payload`).
fn friend_chat_message_to_json(m: &model::chat::FriendChatMessage) -> Value {
    let sent_ms = ts_millis_i64(&m.sent_at);
    json!({
        "ulid": m.ulid,
        "sessionUlid": m.session_ulid,
        "senderDid": m.sender_did,
        "receiverDid": m.receiver_did,
        "type": m.r#type,
        "content": m.content,
        "attachments": m.attachments.iter().map(friend_attachment_to_json).collect::<Vec<_>>(),
        "replyToUlid": m.reply_to_ulid,
        "threadRootUlid": m.thread_root_ulid,
        "status": m.status,
        "sentAt": ts_millis(&m.sent_at),
        "deliveredAt": ts_millis(&m.delivered_at),
        "readAt": ts_millis(&m.read_at),
        "createdAt": ts_millis(&m.created_at),
        "updatedAt": ts_millis(&m.updated_at),
        "encryptedPayload": bytes_to_b64(&m.encrypted_payload),
        "session_ulid": m.session_ulid,
        "sender_did": m.sender_did,
        "reply_to_ulid": m.reply_to_ulid,
        "thread_root_ulid": m.thread_root_ulid,
        "sent_at": sent_ms,
    })
}

fn friend_chat_session_to_json(s: &model::chat::FriendChatSession) -> Value {
    json!({
        "ulid": s.ulid,
        "participantADid": s.participant_a_did,
        "participantBDid": s.participant_b_did,
        "participantADisplayName": s.participant_a_display_name,
        "participantAAvatar": s.participant_a_avatar,
        "participantBDisplayName": s.participant_b_display_name,
        "participantBAvatar": s.participant_b_avatar,
        "participantAOnline": s.participant_a_online,
        "participantBOnline": s.participant_b_online,
        "lastMessageUlid": s.last_message_ulid,
        "lastMessageAt": ts_millis(&s.last_message_at),
        "unreadCountA": s.unread_count_a,
        "unreadCountB": s.unread_count_b,
        "createdAt": ts_millis(&s.created_at),
        "updatedAt": ts_millis(&s.updated_at),
    })
}

fn get_sessions_response_to_value(resp: &model::chat::GetSessionsResponse) -> Value {
    json!({
        "sessions": resp.sessions.iter().map(friend_chat_session_to_json).collect::<Vec<_>>(),
        "total": resp.total,
    })
}

fn create_session_response_to_value(resp: &model::chat::CreateSessionResponse) -> Value {
    json!({
        "session": resp.session.as_ref().map(friend_chat_session_to_json),
        "created": resp.created,
    })
}

fn get_messages_response_to_value(resp: &model::chat::GetMessagesResponse) -> Value {
    json!({
        "messages": resp.messages.iter().map(friend_chat_message_to_json).collect::<Vec<_>>(),
        "hasMore": resp.has_more,
        "nextCursor": resp.next_cursor,
    })
}

fn send_message_response_to_value(resp: &model::chat::SendMessageResponse) -> Value {
    json!({
        "message": resp.message.as_ref().map(friend_chat_message_to_json),
        "relayStatus": resp.relay_status,
    })
}

fn sync_messages_response_to_value(resp: &model::chat::SyncMessagesResponse) -> Value {
    json!({
        "synced": resp.synced,
        "failed": resp.failed,
    })
}

fn online_response_to_value(resp: &model::chat::OnlineResponse) -> Value {
    json!({ "status": resp.status })
}

fn pending_message_info_to_json(p: &model::chat::PendingMessageInfo) -> Value {
    json!({
        "ulid": p.ulid,
        "senderDid": p.sender_did,
        "sessionUlid": p.session_ulid,
        "encryptedPayload": bytes_to_b64(&p.encrypted_payload),
        "createdAt": p.created_at,
    })
}

fn get_pending_response_to_value(resp: &model::chat::GetPendingResponse) -> Value {
    json!({
        "messages": resp.messages.iter().map(pending_message_info_to_json).collect::<Vec<_>>(),
    })
}

fn get_stats_response_to_value(resp: &model::chat::GetStatsResponse) -> Value {
    json!({
        "onlinePeers": resp.online_peers,
        "pendingMessages": resp.pending_messages,
        "status": resp.status,
    })
}

fn group_attachment_to_json(a: &model::chat::GroupMessageAttachment) -> Value {
    json!({
        "cid": a.cid,
        "filename": a.filename,
        "mimeType": a.mime_type,
        "size": a.size,
        "thumbnailCid": a.thumbnail_cid,
        "visibility": a.visibility,
    })
}

/// Group message JSON: camelCase plus snake_case ingest fields for `ingest_group_payload`.
fn group_message_to_json(m: &model::chat::GroupMessage) -> Value {
    let sent_ms = ts_millis_i64(&m.sent_at);
    json!({
        "ulid": m.ulid,
        "groupUlid": m.group_ulid,
        "senderDid": m.sender_did,
        "type": m.r#type,
        "content": m.content,
        "attachments": m.attachments.iter().map(group_attachment_to_json).collect::<Vec<_>>(),
        "replyToUlid": m.reply_to_ulid,
        "threadRootUlid": m.thread_root_ulid,
        "mentionedDids": m.mentioned_dids,
        "mentionAll": m.mention_all,
        "sentAt": ts_millis(&m.sent_at),
        "createdAt": ts_millis(&m.created_at),
        "updatedAt": ts_millis(&m.updated_at),
        "recalled": m.recalled,
        "editedAt": ts_millis(&m.edited_at),
        "encryptedPayload": bytes_to_b64(&m.encrypted_payload),
        "group_ulid": m.group_ulid,
        "sender_did": m.sender_did,
        "reply_to_ulid": m.reply_to_ulid,
        "thread_root_ulid": m.thread_root_ulid,
        "sent_at": sent_ms,
    })
}

fn group_to_json(g: &model::chat::Group) -> Value {
    let settings = serde_json::to_value(&g.settings).unwrap_or(Value::Null);
    json!({
        "ulid": g.ulid,
        "name": g.name,
        "description": g.description,
        "avatarCid": g.avatar_cid,
        "ownerDid": g.owner_did,
        "type": g.r#type,
        "visibility": g.visibility,
        "memberCount": g.member_count,
        "maxMembers": g.max_members,
        "muted": g.muted,
        "settings": settings,
        "createdAt": ts_millis(&g.created_at),
        "updatedAt": ts_millis(&g.updated_at),
    })
}

fn group_member_to_json(m: &model::chat::GroupMember) -> Value {
    json!({
        "groupUlid": m.group_ulid,
        "actorDid": m.actor_did,
        "role": m.role,
        "nickname": m.nickname,
        "muted": m.muted,
        "mutedUntil": ts_millis(&m.muted_until),
        "joinedAt": ts_millis(&m.joined_at),
        "invitedBy": m.invited_by,
    })
}

fn group_invitation_to_json(i: &model::chat::GroupInvitation) -> Value {
    json!({
        "ulid": i.ulid,
        "groupUlid": i.group_ulid,
        "inviterDid": i.inviter_did,
        "inviteeDid": i.invitee_did,
        "status": i.status,
        "expireAt": ts_millis(&i.expire_at),
        "createdAt": ts_millis(&i.created_at),
    })
}

fn group_offline_message_to_json(m: &model::chat::GroupOfflineMessage) -> Value {
    json!({
        "ulid": m.ulid,
        "groupUlid": m.group_ulid,
        "receiverDid": m.receiver_did,
        "messageUlid": m.message_ulid,
        "status": m.status,
        "expireAt": ts_millis(&m.expire_at),
        "deliveredAt": ts_millis(&m.delivered_at),
        "createdAt": ts_millis(&m.created_at),
    })
}

fn list_groups_response_to_value(resp: &model::chat::ListGroupsResponse) -> Value {
    json!({
        "groups": resp.groups.iter().map(group_to_json).collect::<Vec<_>>(),
        "total": resp.total,
    })
}

fn get_group_response_to_value(resp: &model::chat::GetGroupResponse) -> Value {
    json!({
        "group": resp.group.as_ref().map(group_to_json),
        "myMembership": resp.my_membership.as_ref().map(group_member_to_json),
    })
}

fn update_group_response_to_value(resp: &model::chat::UpdateGroupResponse) -> Value {
    json!({
        "group": resp.group.as_ref().map(group_to_json),
    })
}

fn invite_to_group_response_to_value(resp: &model::chat::InviteToGroupResponse) -> Value {
    json!({
        "invitations": resp.invitations.iter().map(group_invitation_to_json).collect::<Vec<_>>(),
    })
}

fn join_group_response_to_value(resp: &model::chat::JoinGroupResponse) -> Value {
    json!({
        "membership": resp.membership.as_ref().map(group_member_to_json),
    })
}

fn leave_group_response_to_value(resp: &model::chat::LeaveGroupResponse) -> Value {
    json!({ "success": resp.success })
}

fn get_group_members_response_to_value(resp: &model::chat::GetGroupMembersResponse) -> Value {
    json!({
        "members": resp.members.iter().map(group_member_to_json).collect::<Vec<_>>(),
        "total": resp.total,
    })
}

fn remove_member_response_to_value(resp: &model::chat::RemoveMemberResponse) -> Value {
    json!({ "success": resp.success })
}

fn send_group_message_response_to_value(resp: &model::chat::SendGroupMessageResponse) -> Value {
    json!({
        "message": resp.message.as_ref().map(group_message_to_json),
    })
}

fn get_group_messages_response_to_value(resp: &model::chat::GetGroupMessagesResponse) -> Value {
    json!({
        "messages": resp.messages.iter().map(group_message_to_json).collect::<Vec<_>>(),
        "hasMore": resp.has_more,
        "nextCursor": resp.next_cursor,
    })
}

fn recall_group_message_response_to_value(resp: &model::chat::RecallGroupMessageResponse) -> Value {
    json!({ "success": resp.success })
}

fn delete_group_message_response_to_value(resp: &model::chat::DeleteGroupMessageResponse) -> Value {
    json!({ "success": resp.success })
}

fn search_group_messages_response_to_value(
    resp: &model::chat::SearchGroupMessagesResponse,
) -> Value {
    json!({
        "messages": resp.messages.iter().map(group_message_to_json).collect::<Vec<_>>(),
        "hasMore": resp.has_more,
    })
}

fn update_my_nickname_response_to_value(resp: &model::chat::UpdateMyNicknameResponse) -> Value {
    json!({
        "member": resp.member.as_ref().map(group_member_to_json),
    })
}

fn get_group_settings_response_to_value(resp: &model::chat::GetGroupSettingsResponse) -> Value {
    json!({
        "isMuted": resp.is_muted,
        "isPinned": resp.is_pinned,
        "myNickname": resp.my_nickname,
        "showMemberNickname": resp.show_member_nickname,
        "alertEnabled": resp.alert_enabled,
        "background": if resp.background.is_empty() { "default" } else { resp.background.as_str() },
        "clearedAt": resp.cleared_at_unix_ms,
    })
}

fn update_group_settings_response_to_value(
    resp: &model::chat::UpdateGroupSettingsResponse,
) -> Value {
    json!({ "success": resp.success })
}

fn get_offline_messages_response_to_value(resp: &model::chat::GetOfflineMessagesResponse) -> Value {
    json!({
        "messages": resp.messages.iter().map(group_offline_message_to_json).collect::<Vec<_>>(),
    })
}

fn ack_offline_messages_response_to_value(resp: &model::chat::AckOfflineMessagesResponse) -> Value {
    json!({ "success": resp.success })
}

fn get_unread_count_response_to_value(resp: &model::chat::GetUnreadCountResponse) -> Value {
    json!({ "unreadCount": resp.unread_count })
}

fn mark_group_read_response_to_value(resp: &model::chat::MarkGroupReadResponse) -> Value {
    json!({ "success": resp.success })
}

fn get_group_stats_response_to_value(resp: &model::chat::GetGroupStatsResponse) -> Value {
    json!({
        "totalGroups": resp.total_groups,
        "totalMembers": resp.total_members,
        "totalMessages": resp.total_messages,
        "activeGroups": resp.active_groups,
    })
}

fn sync_message_item_from_value(
    v: &Value,
    default_session_ulid: &str,
) -> Result<model::chat::SyncMessageItem, String> {
    let ulid = json_str(v, &["ulid"]).ok_or_else(|| "sync item: ulid required".to_string())?;
    let session_ulid = json_str(v, &["sessionUlid", "session_ulid"])
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| default_session_ulid.to_string());
    let receiver_did = json_str(v, &["receiverDid", "receiver_did"]).unwrap_or_default();
    let content = json_str(v, &["content"]).unwrap_or_default();
    let r#type = json_i32(v, &["type"]).unwrap_or(1);
    Ok(model::chat::SyncMessageItem {
        ulid,
        session_ulid,
        receiver_did,
        r#type,
        content,
        sent_at: json_to_optional_timestamp(v, &["sentAt", "sent_at"]),
        encrypted_payload: Vec::new(),
        attachments: Vec::new(),
        reply_to_ulid: json_str(v, &["replyToUlid", "reply_to_ulid"]).unwrap_or_default(),
        thread_root_ulid: json_str(v, &["threadRootUlid", "thread_root_ulid"]).unwrap_or_default(),
    })
}

fn settings_to_update_request(
    group_ulid: &str,
    settings: &Value,
) -> Result<model::chat::UpdateGroupSettingsRequest, String> {
    let obj = settings
        .as_object()
        .ok_or_else(|| "settings must be a JSON object".to_string())?;
    let mut req = model::chat::UpdateGroupSettingsRequest {
        group_ulid: group_ulid.to_string(),
        is_muted: None,
        is_pinned: None,
        show_member_nickname: None,
        alert_enabled: None,
        background: None,
        cleared_at_unix_ms: None,
    };
    if let Some(v) = obj
        .get("is_muted")
        .or_else(|| obj.get("isMuted"))
        .and_then(|x| x.as_bool())
    {
        req.is_muted = Some(v);
    }
    if let Some(v) = obj
        .get("is_pinned")
        .or_else(|| obj.get("isPinned"))
        .and_then(|x| x.as_bool())
    {
        req.is_pinned = Some(v);
    }
    if let Some(v) = obj
        .get("show_member_nickname")
        .or_else(|| obj.get("showMemberNickname"))
        .and_then(|x| x.as_bool())
    {
        req.show_member_nickname = Some(v);
    }
    if let Some(v) = obj
        .get("alert_enabled")
        .or_else(|| obj.get("alertEnabled"))
        .and_then(|x| x.as_bool())
    {
        req.alert_enabled = Some(v);
    }
    if let Some(v) = obj.get("background").and_then(|x| x.as_str()) {
        req.background = Some(v.to_string());
    }
    if let Some(v) = obj
        .get("cleared_at_unix_ms")
        .or_else(|| obj.get("clearedAt"))
        .and_then(|x| x.as_i64())
    {
        req.cleared_at_unix_ms = Some(v);
    }
    Ok(req)
}

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

pub fn index_plaintext_messages(
    user_scope: &str,
    records: &[LocalChatRecord],
) -> Result<usize, String> {
    local_chat_store::upsert_plaintext_records(user_scope, records)
}

pub fn search_friend_messages(
    user_scope: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<LocalChatRecord>, String> {
    local_chat_store::search_local(user_scope, Some("friend"), None, query, limit)
}

pub fn search_group_messages(
    user_scope: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<LocalChatRecord>, String> {
    local_chat_store::search_local(user_scope, Some("group"), None, query, limit)
}

pub fn search_messages_unified(
    user_scope: &str,
    query: &str,
    scope_filter: &str,
    conversation_id: &str,
    limit: usize,
) -> Result<Vec<LocalChatRecord>, String> {
    local_chat_store::search_local_unified(user_scope, query, scope_filter, conversation_id, limit)
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

pub fn list_friend_sessions(token: &str, limit: u32, offset: u32) -> StationResult<Value> {
    let query = vec![("limit", limit.to_string()), ("offset", offset.to_string())];
    let resp = station_client::request_proto::<(), model::chat::GetSessionsResponse>(
        Method::GET,
        "/friend-chat/sessions",
        token,
        Some(&query),
        None::<&()>,
    )?;
    Ok(get_sessions_response_to_value(&resp))
}

pub fn create_friend_session(token: &str, participant_did: &str) -> StationResult<Value> {
    let req = model::chat::CreateSessionRequest {
        participant_did: participant_did.to_string(),
    };
    let resp = station_client::request_proto::<
        model::chat::CreateSessionRequest,
        model::chat::CreateSessionResponse,
    >(
        Method::POST,
        "/friend-chat/session/create",
        token,
        None,
        Some(&req),
    )?;
    Ok(create_session_response_to_value(&resp))
}

pub fn list_friend_messages(
    token: &str,
    session_ulid: &str,
    limit: u32,
    before_ulid: Option<&str>,
) -> StationResult<Value> {
    let mut query = vec![
        ("session_ulid", session_ulid.to_string()),
        ("limit", limit.to_string()),
    ];
    if let Some(before) = before_ulid {
        query.push(("before_ulid", before.to_string()));
    }
    let resp = station_client::request_proto::<(), model::chat::GetMessagesResponse>(
        Method::GET,
        "/friend-chat/messages",
        token,
        Some(&query),
        None::<&()>,
    )?;
    Ok(get_messages_response_to_value(&resp))
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

pub fn list_friend_thread_messages(
    token: &str,
    session_ulid: &str,
    root_ulid: &str,
    page_limit: u32,
    after_ulid: Option<&str>,
    _max_pages: u32,
) -> StationResult<Value> {
    let limit = page_limit.clamp(1, 100);
    let mut query = vec![
        ("session_ulid", session_ulid.to_string()),
        ("root_ulid", root_ulid.to_string()),
        ("limit", limit.to_string()),
    ];
    if let Some(after) = after_ulid {
        if !after.is_empty() {
            query.push(("after_ulid", after.to_string()));
        }
    }
    station_client::request_json(
        Method::GET,
        "/friend-chat/thread/messages",
        token,
        Some(&query),
        None,
    )
}

pub fn friend_thread_counts(
    token: &str,
    session_ulid: &str,
    root_ulids: &[String],
) -> StationResult<Value> {
    station_client::request_json(
        Method::POST,
        "/friend-chat/thread/counts",
        token,
        None,
        Some(json!({
            "session_ulid": session_ulid,
            "root_ulids": root_ulids,
        })),
    )
}

pub fn mark_friend_thread_read(
    token: &str,
    session_ulid: &str,
    root_ulid: &str,
    last_read_ulid: Option<&str>,
) -> StationResult<Value> {
    station_client::request_json(
        Method::POST,
        "/friend-chat/thread/read",
        token,
        None,
        Some(json!({
            "session_ulid": session_ulid,
            "root_ulid": root_ulid,
            "last_read_ulid": last_read_ulid.unwrap_or_default(),
        })),
    )
}

pub fn send_friend_message(
    token: &str,
    session_ulid: &str,
    receiver_did: &str,
    content: &str,
    msg_type: i32,
    reply_to_ulid: &str,
) -> StationResult<Value> {
    let req = model::chat::SendMessageRequest {
        session_ulid: session_ulid.to_string(),
        receiver_did: receiver_did.to_string(),
        r#type: msg_type,
        content: content.to_string(),
        attachments: Vec::new(),
        reply_to_ulid: reply_to_ulid.to_string(),
        thread_root_ulid: String::new(),
        encrypted_payload: Vec::new(),
        client_ulid: String::new(),
    };
    let resp = station_client::request_proto::<
        model::chat::SendMessageRequest,
        model::chat::SendMessageResponse,
    >(
        Method::POST,
        "/friend-chat/message/send",
        token,
        None,
        Some(&req),
    )?;
    Ok(send_message_response_to_value(&resp))
}

pub fn ack_friend_messages(token: &str, ulids: &[String], status: i32) -> StationResult<Value> {
    let req = model::chat::MessageAckRequest {
        ulids: ulids.to_vec(),
        status,
    };
    let _resp = station_client::request_proto::<
        model::chat::MessageAckRequest,
        model::chat::MessageAckResponse,
    >(
        Method::POST,
        "/friend-chat/message/ack",
        token,
        None,
        Some(&req),
    )?;
    Ok(json!({}))
}

pub fn list_groups(token: &str, limit: u32, offset: u32) -> StationResult<Value> {
    let query = vec![("limit", limit.to_string()), ("offset", offset.to_string())];
    let resp = station_client::request_proto::<(), model::chat::ListGroupsResponse>(
        Method::GET,
        "/group-chat/list",
        token,
        Some(&query),
        None::<&()>,
    )?;
    Ok(list_groups_response_to_value(&resp))
}

pub fn list_group_messages(
    token: &str,
    group_ulid: &str,
    limit: u32,
    before_ulid: Option<&str>,
) -> StationResult<Value> {
    let mut query = vec![
        ("group_ulid", group_ulid.to_string()),
        ("limit", limit.to_string()),
    ];
    if let Some(before) = before_ulid {
        query.push(("before_ulid", before.to_string()));
    }
    let resp = station_client::request_proto::<(), model::chat::GetGroupMessagesResponse>(
        Method::GET,
        "/group-chat/messages",
        token,
        Some(&query),
        None::<&()>,
    )?;
    Ok(get_group_messages_response_to_value(&resp))
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
        ("group_ulid", group_ulid.to_string()),
        ("root_ulid", root_ulid.to_string()),
        ("limit", limit.to_string()),
    ];
    if let Some(after) = after_ulid {
        if !after.is_empty() {
            query.push(("after_ulid", after.to_string()));
        }
    }
    station_client::request_json(
        Method::GET,
        "/group-chat/thread/messages",
        token,
        Some(&query),
        None,
    )
}

pub fn group_thread_counts(
    token: &str,
    group_ulid: &str,
    root_ulids: &[String],
) -> StationResult<Value> {
    station_client::request_json(
        Method::POST,
        "/group-chat/thread/counts",
        token,
        None,
        Some(json!({
            "group_ulid": group_ulid,
            "root_ulids": root_ulids,
        })),
    )
}

pub fn mark_group_thread_read(
    token: &str,
    group_ulid: &str,
    root_ulid: &str,
    last_read_ulid: Option<&str>,
) -> StationResult<Value> {
    station_client::request_json(
        Method::POST,
        "/group-chat/thread/read",
        token,
        None,
        Some(json!({
            "group_ulid": group_ulid,
            "root_ulid": root_ulid,
            "last_read_ulid": last_read_ulid.unwrap_or_default(),
        })),
    )
}

pub fn send_group_message(
    token: &str,
    group_ulid: &str,
    content: &str,
    msg_type: i32,
    reply_to_ulid: &str,
    mentioned_dids: &[String],
    mention_all: bool,
) -> StationResult<Value> {
    let req = model::chat::SendGroupMessageRequest {
        group_ulid: group_ulid.to_string(),
        r#type: msg_type,
        content: content.to_string(),
        attachments: Vec::new(),
        reply_to_ulid: reply_to_ulid.to_string(),
        thread_root_ulid: String::new(),
        mentioned_dids: mentioned_dids.to_vec(),
        mention_all,
        encrypted_payload: Vec::new(),
    };
    let resp = station_client::request_proto::<
        model::chat::SendGroupMessageRequest,
        model::chat::SendGroupMessageResponse,
    >(
        Method::POST,
        "/group-chat/message/send",
        token,
        None,
        Some(&req),
    )?;
    Ok(send_group_message_response_to_value(&resp))
}

pub fn group_unread_count(token: &str, group_ulid: Option<&str>) -> StationResult<Value> {
    let mut query = Vec::new();
    if let Some(gid) = group_ulid {
        query.push(("group_ulid", gid.to_string()));
    }
    let resp = station_client::request_proto::<(), model::chat::GetUnreadCountResponse>(
        Method::GET,
        "/group-chat/unread-count",
        token,
        if query.is_empty() {
            None
        } else {
            Some(query.as_slice())
        },
        None::<&()>,
    )?;
    Ok(get_unread_count_response_to_value(&resp))
}

pub fn group_mark_read(token: &str, group_ulid: &str) -> StationResult<Value> {
    let req = model::chat::MarkGroupReadRequest {
        group_ulid: group_ulid.to_string(),
        up_to_ulid: String::new(),
    };
    let resp = station_client::request_proto::<
        model::chat::MarkGroupReadRequest,
        model::chat::MarkGroupReadResponse,
    >(
        Method::POST,
        "/group-chat/mark-read",
        token,
        None,
        Some(&req),
    )?;
    Ok(mark_group_read_response_to_value(&resp))
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

pub fn filter_incremental_messages(
    payload: &Value,
    cursor: Option<&str>,
) -> (Value, usize, Option<String>) {
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
                if latest
                    .as_ref()
                    .map(|v| ulid.as_str() > v.as_str())
                    .unwrap_or(true)
                {
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

pub fn sync_friend_from_station(
    token: &str,
    user_scope: &str,
    session_ulid: &str,
    page_limit: u32,
    max_pages: u32,
) -> StationResult<SyncResult> {
    let scope_key = format!("friend:{session_ulid}");
    let cursor = get_scope_cursor(user_scope, &scope_key).map_err(invalid_response_err)?;
    let mut current_cursor = cursor.clone();
    let mut total_synced = 0usize;
    let mut pages_fetched = 0u32;
    for _ in 0..max_pages {
        let before = current_cursor
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(|c| format!("since:{c}"));
        let data = list_friend_messages(token, session_ulid, page_limit, before.as_deref())?;
        pages_fetched += 1;
        let (payload, count, latest) =
            filter_incremental_messages(&data, current_cursor.as_deref());
        let _ = ingest_friend_messages(user_scope, &payload);
        total_synced += count;
        let server_cursor = data
            .get("nextCursor")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let next = server_cursor
            .or(latest)
            .or_else(|| extract_latest_ulid(&data));
        if let Some(ref nc) = next {
            let _ = set_scope_cursor(user_scope, &scope_key, nc);
            current_cursor = Some(nc.clone());
        }
        let has_more = data
            .get("hasMore")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !has_more {
            break;
        }
    }
    Ok(SyncResult {
        synced_count: total_synced,
        pages_fetched,
        cursor_before: cursor,
        cursor_after: current_cursor,
    })
}

pub fn sync_friend_messages(
    token: &str,
    session_ulid: &str,
    messages_json: &str,
) -> StationResult<Value> {
    let body: Value = serde_json::from_str(messages_json)
        .map_err(|e| invalid_response_err(format!("invalid json: {e}")))?;
    let items_val = if let Some(a) = body.as_array() {
        a.clone()
    } else if let Some(a) = body.get("messages").and_then(|v| v.as_array()) {
        a.clone()
    } else {
        return Err(invalid_response_err(
            "expected JSON array of messages or { \"messages\": [...] }",
        ));
    };
    let mut items = Vec::with_capacity(items_val.len());
    for v in &items_val {
        items.push(sync_message_item_from_value(v, session_ulid).map_err(invalid_response_err)?);
    }
    let req = model::chat::SyncMessagesRequest { messages: items };
    let resp = station_client::request_proto::<
        model::chat::SyncMessagesRequest,
        model::chat::SyncMessagesResponse,
    >(
        Method::POST,
        "/friend-chat/message/sync",
        token,
        None,
        Some(&req),
    )?;
    Ok(sync_messages_response_to_value(&resp))
}

pub fn friend_chat_online(token: &str) -> StationResult<Value> {
    let req = model::chat::OnlineRequest { did: String::new() };
    let resp = station_client::request_proto::<
        model::chat::OnlineRequest,
        model::chat::OnlineResponse,
    >(Method::POST, "/friend-chat/online", token, None, Some(&req))?;
    Ok(online_response_to_value(&resp))
}

pub fn friend_chat_offline(token: &str) -> StationResult<Value> {
    let req = model::chat::OnlineRequest { did: String::new() };
    let resp =
        station_client::request_proto::<model::chat::OnlineRequest, model::chat::OnlineResponse>(
            Method::POST,
            "/friend-chat/offline",
            token,
            None,
            Some(&req),
        )?;
    Ok(online_response_to_value(&resp))
}

pub fn friend_chat_pending(token: &str) -> StationResult<Value> {
    let query = vec![("limit", "50".to_string())];
    let resp = station_client::request_proto::<(), model::chat::GetPendingResponse>(
        Method::GET,
        "/friend-chat/pending",
        token,
        Some(&query),
        None::<&()>,
    )?;
    Ok(get_pending_response_to_value(&resp))
}

pub fn friend_chat_stats(token: &str) -> StationResult<Value> {
    let resp = station_client::request_proto::<(), model::chat::GetStatsResponse>(
        Method::GET,
        "/friend-chat/stats",
        token,
        None,
        None::<&()>,
    )?;
    Ok(get_stats_response_to_value(&resp))
}

pub fn create_group(
    token: &str,
    name: &str,
    description: &str,
    member_dids: &[String],
) -> StationResult<Value> {
    let req = model::chat::CreateGroupRequest {
        name: name.to_string(),
        description: description.to_string(),
        initial_member_dids: member_dids.to_vec(),
        ..Default::default()
    };
    let resp = station_client::request_proto::<
        model::chat::CreateGroupRequest,
        model::chat::CreateGroupResponse,
    >(Method::POST, "/group-chat/create", token, None, Some(&req))?;
    Ok(json!({
        "group": resp.group.as_ref().map(group_to_json),
    }))
}

pub fn group_info(token: &str, group_ulid: &str) -> StationResult<Value> {
    let query = vec![("group_ulid", group_ulid.to_string())];
    let resp = station_client::request_proto::<(), model::chat::GetGroupResponse>(
        Method::GET,
        "/group-chat/info",
        token,
        Some(&query),
        None::<&()>,
    )?;
    Ok(get_group_response_to_value(&resp))
}

pub fn update_group(
    token: &str,
    group_ulid: &str,
    name: &str,
    description: &str,
) -> StationResult<Value> {
    let req = model::chat::UpdateGroupRequest {
        group_ulid: group_ulid.to_string(),
        name: Some(name.to_string()),
        description: Some(description.to_string()),
        ..Default::default()
    };
    let resp = station_client::request_proto::<
        model::chat::UpdateGroupRequest,
        model::chat::UpdateGroupResponse,
    >(Method::PUT, "/group-chat/update", token, None, Some(&req))?;
    Ok(update_group_response_to_value(&resp))
}

pub fn group_invite(token: &str, group_ulid: &str, member_dids: &[String]) -> StationResult<Value> {
    let req = model::chat::InviteToGroupRequest {
        group_ulid: group_ulid.to_string(),
        invitee_dids: member_dids.to_vec(),
    };
    let resp = station_client::request_proto::<
        model::chat::InviteToGroupRequest,
        model::chat::InviteToGroupResponse,
    >(Method::POST, "/group-chat/invite", token, None, Some(&req))?;
    Ok(invite_to_group_response_to_value(&resp))
}

pub fn group_join(token: &str, group_ulid: &str) -> StationResult<Value> {
    let req = model::chat::JoinGroupRequest {
        group_ulid: group_ulid.to_string(),
        invitation_ulid: String::new(),
    };
    let resp = station_client::request_proto::<
        model::chat::JoinGroupRequest,
        model::chat::JoinGroupResponse,
    >(Method::POST, "/group-chat/join", token, None, Some(&req))?;
    Ok(join_group_response_to_value(&resp))
}

pub fn group_leave(token: &str, group_ulid: &str) -> StationResult<Value> {
    let req = model::chat::LeaveGroupRequest {
        group_ulid: group_ulid.to_string(),
    };
    let resp = station_client::request_proto::<
        model::chat::LeaveGroupRequest,
        model::chat::LeaveGroupResponse,
    >(Method::POST, "/group-chat/leave", token, None, Some(&req))?;
    Ok(leave_group_response_to_value(&resp))
}

pub fn group_members(token: &str, group_ulid: &str) -> StationResult<Value> {
    let query = vec![("group_ulid", group_ulid.to_string())];
    let resp = station_client::request_proto::<(), model::chat::GetGroupMembersResponse>(
        Method::GET,
        "/group-chat/members",
        token,
        Some(&query),
        None::<&()>,
    )?;
    Ok(get_group_members_response_to_value(&resp))
}

pub fn group_remove_member(
    token: &str,
    group_ulid: &str,
    member_did: &str,
) -> StationResult<Value> {
    let req = model::chat::RemoveMemberRequest {
        group_ulid: group_ulid.to_string(),
        actor_did: member_did.to_string(),
    };
    let resp = station_client::request_proto::<
        model::chat::RemoveMemberRequest,
        model::chat::RemoveMemberResponse,
    >(
        Method::POST,
        "/group-chat/member/remove",
        token,
        None,
        Some(&req),
    )?;
    Ok(remove_member_response_to_value(&resp))
}

pub fn group_recall_message(
    token: &str,
    group_ulid: &str,
    message_ulid: &str,
) -> StationResult<Value> {
    let req = model::chat::RecallGroupMessageRequest {
        group_ulid: group_ulid.to_string(),
        message_ulid: message_ulid.to_string(),
    };
    let resp = station_client::request_proto::<
        model::chat::RecallGroupMessageRequest,
        model::chat::RecallGroupMessageResponse,
    >(
        Method::POST,
        "/group-chat/message/recall",
        token,
        None,
        Some(&req),
    )?;
    Ok(recall_group_message_response_to_value(&resp))
}

pub fn group_delete_message(
    token: &str,
    group_ulid: &str,
    message_ulid: &str,
) -> StationResult<Value> {
    let req = model::chat::DeleteGroupMessageRequest {
        group_ulid: group_ulid.to_string(),
        message_ulid: message_ulid.to_string(),
    };
    let resp = station_client::request_proto::<
        model::chat::DeleteGroupMessageRequest,
        model::chat::DeleteGroupMessageResponse,
    >(
        Method::POST,
        "/group-chat/message/delete",
        token,
        None,
        Some(&req),
    )?;
    Ok(delete_group_message_response_to_value(&resp))
}

pub fn group_search_messages(
    token: &str,
    group_ulid: &str,
    query: &str,
    limit: u32,
) -> StationResult<Value> {
    let q = vec![
        ("group_ulid", group_ulid.to_string()),
        ("query", query.to_string()),
        ("limit", limit.to_string()),
    ];
    let resp = station_client::request_proto::<(), model::chat::SearchGroupMessagesResponse>(
        Method::GET,
        "/group-chat/messages/search",
        token,
        Some(&q),
        None::<&()>,
    )?;
    Ok(search_group_messages_response_to_value(&resp))
}

pub fn group_update_nickname(
    token: &str,
    group_ulid: &str,
    nickname: &str,
) -> StationResult<Value> {
    let req = model::chat::UpdateMyNicknameRequest {
        group_ulid: group_ulid.to_string(),
        nickname: nickname.to_string(),
    };
    let resp = station_client::request_proto::<
        model::chat::UpdateMyNicknameRequest,
        model::chat::UpdateMyNicknameResponse,
    >(
        Method::PUT,
        "/group-chat/member/nickname",
        token,
        None,
        Some(&req),
    )?;
    Ok(update_my_nickname_response_to_value(&resp))
}

pub fn group_get_my_settings(token: &str, group_ulid: &str) -> StationResult<Value> {
    let query = vec![("group_ulid", group_ulid.to_string())];
    let resp = station_client::request_proto::<(), model::chat::GetGroupSettingsResponse>(
        Method::GET,
        "/group-chat/my-settings",
        token,
        Some(&query),
        None::<&()>,
    )?;
    Ok(get_group_settings_response_to_value(&resp))
}

pub fn group_update_my_settings(
    token: &str,
    group_ulid: &str,
    settings_json: &str,
) -> StationResult<Value> {
    let settings: Value = serde_json::from_str(settings_json)
        .map_err(|e| invalid_response_err(format!("invalid json: {e}")))?;
    let req = settings_to_update_request(group_ulid, &settings).map_err(invalid_response_err)?;
    let resp = station_client::request_proto::<
        model::chat::UpdateGroupSettingsRequest,
        model::chat::UpdateGroupSettingsResponse,
    >(
        Method::PUT,
        "/group-chat/my-settings",
        token,
        None,
        Some(&req),
    )?;
    Ok(update_group_settings_response_to_value(&resp))
}

pub fn group_offline_messages(token: &str, group_ulid: &str) -> StationResult<Value> {
    let query = vec![("group_ulid", group_ulid.to_string())];
    let resp = station_client::request_proto::<(), model::chat::GetOfflineMessagesResponse>(
        Method::GET,
        "/group-chat/offline-messages",
        token,
        Some(&query),
        None::<&()>,
    )?;
    Ok(get_offline_messages_response_to_value(&resp))
}

pub fn group_ack_offline(
    token: &str,
    _group_ulid: &str,
    message_ulids: &[String],
) -> StationResult<Value> {
    let req = model::chat::AckOfflineMessagesRequest {
        ulids: message_ulids.to_vec(),
    };
    let resp = station_client::request_proto::<
        model::chat::AckOfflineMessagesRequest,
        model::chat::AckOfflineMessagesResponse,
    >(
        Method::POST,
        "/group-chat/offline-messages/ack",
        token,
        None,
        Some(&req),
    )?;
    Ok(ack_offline_messages_response_to_value(&resp))
}

pub fn group_stats(token: &str) -> StationResult<Value> {
    let resp = station_client::request_proto::<(), model::chat::GetGroupStatsResponse>(
        Method::GET,
        "/group-chat/stats",
        token,
        None,
        None::<&()>,
    )?;
    Ok(get_group_stats_response_to_value(&resp))
}

pub fn sync_group_from_station(
    token: &str,
    user_scope: &str,
    group_ulid: &str,
    page_limit: u32,
    max_pages: u32,
) -> StationResult<SyncResult> {
    let scope_key = format!("group:{group_ulid}");
    let cursor = get_scope_cursor(user_scope, &scope_key).map_err(invalid_response_err)?;
    let mut current_cursor = cursor.clone();
    let mut total_synced = 0usize;
    let mut pages_fetched = 0u32;
    for _ in 0..max_pages {
        let before = current_cursor
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(|c| format!("since:{c}"));
        let data = list_group_messages(token, group_ulid, page_limit, before.as_deref())?;
        pages_fetched += 1;
        let (payload, count, latest) =
            filter_incremental_messages(&data, current_cursor.as_deref());
        let _ = ingest_group_messages(user_scope, &payload);
        total_synced += count;
        let server_cursor = data
            .get("nextCursor")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let next = server_cursor
            .or(latest)
            .or_else(|| extract_latest_ulid(&data));
        if let Some(ref nc) = next {
            let _ = set_scope_cursor(user_scope, &scope_key, nc);
            current_cursor = Some(nc.clone());
        }
        let has_more = data
            .get("hasMore")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !has_more {
            break;
        }
    }
    Ok(SyncResult {
        synced_count: total_synced,
        pages_fetched,
        cursor_before: cursor,
        cursor_after: current_cursor,
    })
}
