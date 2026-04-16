use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

use crate::application::chat_storage;
use crate::contracts::{
    AttachmentInput, ChatKeyRotateInput, ChatLocalSearchInput, ChatScopeCursorGetInput, ChatScopeCursorSetInput, GroupChatListInput,
    GroupChatListMessagesInput, GroupChatMarkReadInput, GroupChatSendInput, GroupChatUnreadInput, StubPayload,
    GroupChatSyncInput, GroupChatCreateGroupInput, GroupChatLeaveGroupInput,
    GroupAckOfflineInput, GroupInviteInput, GroupJoinInput,
    GroupMembersInput, GroupMessageActionInput, GroupOfflineMessagesInput,
    GroupRemoveMemberInput, GroupSearchMessagesInput, GroupUlidInput,
    GroupUpdateInput, GroupUpdateMySettingsInput, GroupUpdateNicknameInput,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::infrastructure::storage::resolve_user_scope;
use crate::model;
use crate::state::AppState;
use reqwest::Method;
use serde_json::{json, Value};
use tauri::State;

fn token_from_state(state: &State<'_, Arc<AppState>>) -> Result<String, AppResult<StubPayload>> {
    let guard = state.session.lock().map_err(|_| {
        tracing::error!("Failed to acquire session lock");
        AppResult::fail(ErrorCode::InternalError, "Failed to access session state", None)
    })?;
    let token = guard.token.clone().unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "Authentication required — please log in",
            None,
        ));
    }
    Ok(token)
}

fn actor_id_from_state(state: &State<'_, Arc<AppState>>) -> Option<String> {
    state
        .session
        .lock()
        .ok()
        .and_then(|guard| guard.actor_id.clone())
}

fn user_scope_from_state(state: &State<'_, Arc<AppState>>) -> String {
    let actor_id = actor_id_from_state(state);
    resolve_user_scope(actor_id.as_deref())
}

/// Maps `station_client::request_proto` string errors to the standard Tauri `AppResult` shape.
fn fail_station_request(reason: String) -> AppResult<StubPayload> {
    let code = if reason.starts_with("SESSION_REVOKED:") {
        ErrorCode::Unauthorized
    } else {
        ErrorCode::InternalError
    };
    tracing::error!(reason = %reason, "Station request failed");
    AppResult::fail(
        code,
        format!("Station request failed: {}", reason),
        None,
    )
}

fn to_stub(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn ts_millis(ts: &Option<prost_types::Timestamp>) -> Value {
    match ts {
        Some(t) => Value::Number((t.seconds * 1000 + (t.nanos as i64) / 1_000_000).into()),
        None => Value::Null,
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

fn map_group_attachments(inputs: &[AttachmentInput]) -> Vec<model::chat::GroupMessageAttachment> {
    inputs
        .iter()
        .map(|a| model::chat::GroupMessageAttachment {
            cid: a.cid.clone(),
            filename: a.filename.clone(),
            mime_type: a.mime_type.clone(),
            size: a.size,
            thumbnail_cid: a.thumbnail_cid.clone().unwrap_or_default(),
        })
        .collect()
}

fn group_message_attachment_to_json(a: &model::chat::GroupMessageAttachment) -> Value {
    json!({
        "cid": a.cid,
        "filename": a.filename,
        "mimeType": a.mime_type,
        "size": a.size,
        "thumbnailCid": a.thumbnail_cid,
    })
}

fn group_message_to_json(m: &model::chat::GroupMessage) -> Value {
    json!({
        "ulid": m.ulid,
        "groupUlid": m.group_ulid,
        "senderDid": m.sender_did,
        "type": m.r#type,
        "content": m.content,
        "attachments": m.attachments.iter().map(group_message_attachment_to_json).collect::<Vec<_>>(),
        "replyToUlid": m.reply_to_ulid,
        "mentionedDids": m.mentioned_dids,
        "mentionAll": m.mention_all,
        "sentAt": ts_millis(&m.sent_at),
        "createdAt": ts_millis(&m.created_at),
        "updatedAt": ts_millis(&m.updated_at),
        "deleted": m.deleted,
        "encryptedPayload": bytes_to_b64(&m.encrypted_payload),
    })
}

/// Shape expected by `chat_storage::ingest_group_messages` (snake_case + numeric `sent_at`).
fn group_message_to_ingest_json(m: &model::chat::GroupMessage) -> Value {
    json!({
        "group_ulid": m.group_ulid,
        "ulid": m.ulid,
        "sender_did": m.sender_did,
        "content": m.content,
        "sent_at": ts_millis_i64(&m.sent_at),
    })
}

fn group_to_json(g: &model::chat::Group) -> Value {
    let settings: Vec<Value> = g
        .settings
        .iter()
        .map(|(k, v)| json!({ "key": k, "value": v }))
        .collect();
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

fn group_offline_message_to_json(o: &model::chat::GroupOfflineMessage) -> Value {
    json!({
        "ulid": o.ulid,
        "groupUlid": o.group_ulid,
        "receiverDid": o.receiver_did,
        "messageUlid": o.message_ulid,
        "status": o.status,
        "expireAt": ts_millis(&o.expire_at),
        "deliveredAt": ts_millis(&o.delivered_at),
        "createdAt": ts_millis(&o.created_at),
    })
}

fn list_groups_response_to_json(resp: &model::chat::ListGroupsResponse) -> Value {
    json!({
        "groups": resp.groups.iter().map(group_to_json).collect::<Vec<_>>(),
        "total": resp.total,
    })
}

fn get_group_response_to_json(resp: &model::chat::GetGroupResponse) -> Value {
    json!({
        "group": resp.group.as_ref().map(group_to_json),
        "myMembership": resp.my_membership.as_ref().map(group_member_to_json),
    })
}

fn get_group_messages_response_to_json(resp: &model::chat::GetGroupMessagesResponse) -> Value {
    json!({
        "messages": resp.messages.iter().map(group_message_to_json).collect::<Vec<_>>(),
        "hasMore": resp.has_more,
        "nextCursor": resp.next_cursor,
    })
}

fn get_group_messages_ingest_value(resp: &model::chat::GetGroupMessagesResponse) -> Value {
    json!({
        "messages": resp.messages.iter().map(group_message_to_ingest_json).collect::<Vec<_>>(),
    })
}

fn send_group_message_response_to_json(resp: &model::chat::SendGroupMessageResponse) -> Value {
    json!({
        "message": resp.message.as_ref().map(group_message_to_json),
    })
}

fn send_group_message_ingest_value(resp: &model::chat::SendGroupMessageResponse) -> Value {
    match &resp.message {
        Some(m) => json!({ "message": group_message_to_ingest_json(m) }),
        None => json!({}),
    }
}

fn search_group_messages_response_to_json(resp: &model::chat::SearchGroupMessagesResponse) -> Value {
    json!({
        "messages": resp.messages.iter().map(group_message_to_json).collect::<Vec<_>>(),
        "hasMore": resp.has_more,
    })
}

fn get_group_settings_response_to_json(resp: &model::chat::GetGroupSettingsResponse) -> Value {
    json!({
        "isMuted": resp.is_muted,
        "isPinned": resp.is_pinned,
        "myNickname": resp.my_nickname,
        "showMemberNickname": resp.show_member_nickname,
    })
}

fn extract_latest_ulid_from_messages(messages: &[model::chat::GroupMessage]) -> Option<String> {
    messages
        .iter()
        .filter_map(|m| {
            let u = m.ulid.trim();
            if u.is_empty() {
                None
            } else {
                Some(u.to_string())
            }
        })
        .max()
}

fn filter_incremental_group_messages(
    messages: Vec<model::chat::GroupMessage>,
    cursor: Option<&str>,
) -> (Vec<model::chat::GroupMessage>, usize, Option<String>) {
    let mut out = Vec::new();
    let mut synced_count = 0usize;
    let mut latest: Option<String> = None;
    for m in messages {
        let ulid = m.ulid.trim().to_string();
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
            out.push(m);
        }
    }
    (out, synced_count, latest)
}

#[tauri::command]
pub fn group_chat_list_groups(input: GroupChatListInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    let req = model::chat::ListGroupsRequest {
        limit: input.limit.unwrap_or(50) as i32,
        offset: input.offset.unwrap_or(0) as i32,
    };
    let resp = match station_client::request_proto::<model::chat::ListGroupsRequest, model::chat::ListGroupsResponse>(
        Method::GET,
        "/group-chat/list",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };
    to_stub("group_chat_list_groups", list_groups_response_to_json(&resp))
}

#[tauri::command]
pub fn group_chat_list_messages(input: GroupChatListMessagesInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.group_ulid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "Group ULID is required", None);
    }
    let req = model::chat::GetGroupMessagesRequest {
        group_ulid: input.group_ulid,
        before_ulid: input.before_ulid.unwrap_or_default(),
        limit: input.limit.unwrap_or(50) as i32,
    };
    let resp = match station_client::request_proto::<model::chat::GetGroupMessagesRequest, model::chat::GetGroupMessagesResponse>(
        Method::GET,
        "/group-chat/messages",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };
    let user_scope = user_scope_from_state(&state);
    let _ = chat_storage::ingest_group_messages(user_scope.as_str(), &get_group_messages_ingest_value(&resp));
    to_stub("group_chat_list_messages", get_group_messages_response_to_json(&resp))
}

#[tauri::command]
pub fn group_chat_send_message(input: GroupChatSendInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let mut encrypted_payload = Vec::new();
    if let Some(ref b64) = input.encrypted_payload {
        let t = b64.trim();
        if !t.is_empty() {
            encrypted_payload = match B64.decode(t.as_bytes()) {
                Ok(b) => b,
                Err(e) => {
                    return AppResult::fail(
                        ErrorCode::InvalidArgument,
                        format!("Invalid encrypted_payload: {}", e),
                        None,
                    );
                }
            };
        }
    }

    let req = model::chat::SendGroupMessageRequest {
        group_ulid: input.group_ulid,
        r#type: input.r#type.unwrap_or(1),
        content: input.content,
        attachments: map_group_attachments(&input.attachments.unwrap_or_default()),
        reply_to_ulid: input.reply_to_ulid.unwrap_or_default(),
        mentioned_dids: input.mentioned_dids.unwrap_or_default(),
        mention_all: input.mention_all.unwrap_or(false),
        encrypted_payload,
    };

    let resp = match station_client::request_proto::<model::chat::SendGroupMessageRequest, model::chat::SendGroupMessageResponse>(
        Method::POST,
        "/group-chat/message/send",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };
    let user_scope = user_scope_from_state(&state);
    let _ = chat_storage::ingest_group_messages(user_scope.as_str(), &send_group_message_ingest_value(&resp));
    to_stub("group_chat_send_message", send_group_message_response_to_json(&resp))
}

#[tauri::command]
pub fn group_chat_unread_count(input: GroupChatUnreadInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    let req = model::chat::GetUnreadCountRequest {
        group_ulid: input.group_ulid.unwrap_or_default(),
    };
    let resp = match station_client::request_proto::<model::chat::GetUnreadCountRequest, model::chat::GetUnreadCountResponse>(
        Method::GET,
        "/group-chat/unread-count",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };
    to_stub(
        "group_chat_unread_count",
        json!({ "unreadCount": resp.unread_count, "unread_count": resp.unread_count }),
    )
}

#[tauri::command]
pub fn group_chat_mark_read(input: GroupChatMarkReadInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    let req = model::chat::MarkGroupReadRequest {
        group_ulid: input.group_ulid,
        up_to_ulid: String::new(),
    };
    let resp = match station_client::request_proto::<model::chat::MarkGroupReadRequest, model::chat::MarkGroupReadResponse>(
        Method::POST,
        "/group-chat/mark-read",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };
    to_stub("group_chat_mark_read", json!({ "success": resp.success }))
}

#[tauri::command]
pub fn group_chat_local_search(input: ChatLocalSearchInput) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "Search query is required", None);
    }
    let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
    let items = match chat_storage::search_group_messages("__default__", input.query.as_str(), limit) {
        Ok(items) => items,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Local search failed: {}", reason),
                None,
            );
        }
    };
    to_stub("group_chat_local_search", json!({ "messages": items }))
}

#[tauri::command]
pub fn group_chat_local_search_scoped(input: ChatLocalSearchInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "Search query is required", None);
    }
    let user_scope = user_scope_from_state(&state);
    let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
    let items = match chat_storage::search_group_messages(user_scope.as_str(), input.query.as_str(), limit) {
        Ok(items) => items,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Local search failed: {}", reason),
                None,
            );
        }
    };
    to_stub("group_chat_local_search_scoped", json!({ "messages": items }))
}

#[tauri::command]
pub fn group_chat_set_cursor_scoped(input: ChatScopeCursorSetInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    if input.scope.trim().is_empty() || input.cursor.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "scope and cursor are required", None);
    }
    if let Err(reason) = chat_storage::set_scope_cursor(user_scope.as_str(), input.scope.as_str(), input.cursor.as_str()) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to set cursor: {}", reason),
            None,
        );
    }
    to_stub("group_chat_set_cursor_scoped", json!({"ok": true}))
}

#[tauri::command]
pub fn group_chat_get_cursor_scoped(input: ChatScopeCursorGetInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    if input.scope.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "scope is required", None);
    }
    let cursor = match chat_storage::get_scope_cursor(user_scope.as_str(), input.scope.as_str()) {
        Ok(cursor) => cursor,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to get cursor: {}", reason),
                None,
            );
        }
    };
    to_stub("group_chat_get_cursor_scoped", json!({"cursor": cursor}))
}

#[tauri::command]
pub fn group_chat_get_key_version_scoped(state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state);
    let key_version = match chat_storage::get_chat_key_version(user_scope.as_str()) {
        Ok(version) => version,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to get key version: {}", reason),
                None,
            );
        }
    };
    to_stub("group_chat_get_key_version_scoped", json!({"key_version": key_version}))
}

#[tauri::command]
pub fn group_chat_rotate_key_scoped(input: ChatKeyRotateInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    if input.next_version <= 0 {
        return AppResult::fail(ErrorCode::InvalidArgument, "next_version must be positive", None);
    }
    let user_scope = user_scope_from_state(&state);
    let key_version = match chat_storage::rotate_chat_key(user_scope.as_str(), input.next_version) {
        Ok(version) => version,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to rotate key: {}", reason),
                None,
            );
        }
    };
    to_stub("group_chat_rotate_key_scoped", json!({"key_version": key_version}))
}

#[tauri::command]
pub fn group_chat_sync_from_station_scoped(input: GroupChatSyncInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.group_ulid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "Group ULID is required", None);
    }
    let user_scope = user_scope_from_state(&state);
    let scope_key = format!("group:{}", input.group_ulid);
    let cursor = match chat_storage::get_scope_cursor(user_scope.as_str(), scope_key.as_str()) {
        Ok(cursor) => cursor,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to get cursor: {}", reason),
                None,
            );
        }
    };
    let page_limit = input.limit.unwrap_or(100);
    let max_pages = input.max_pages.unwrap_or(10);
    let mut current_cursor = cursor.clone();
    let mut total_synced = 0usize;
    let mut pages_fetched = 0u32;
    for _ in 0..max_pages {
        let before_ulid = match &current_cursor {
            Some(existing) if !existing.trim().is_empty() => format!("since:{existing}"),
            _ => String::new(),
        };
        let req = model::chat::GetGroupMessagesRequest {
            group_ulid: input.group_ulid.clone(),
            before_ulid,
            limit: page_limit as i32,
        };
        let data = match station_client::request_proto::<model::chat::GetGroupMessagesRequest, model::chat::GetGroupMessagesResponse>(
            Method::GET,
            "/group-chat/messages",
            &token,
            None,
            Some(&req),
        ) {
            Ok(r) => r,
            Err(e) => return fail_station_request(e),
        };
        pages_fetched += 1;
        let (filtered_msgs, synced_count, latest) =
            filter_incremental_group_messages(data.messages.clone(), current_cursor.as_deref());
        let incremental = model::chat::GetGroupMessagesResponse {
            messages: filtered_msgs,
            has_more: data.has_more,
            next_cursor: data.next_cursor.clone(),
        };
        let incremental_payload = get_group_messages_ingest_value(&incremental);
        let _ = chat_storage::ingest_group_messages(user_scope.as_str(), &incremental_payload);
        total_synced += synced_count;
        let server_cursor = {
            let nc = data.next_cursor.trim();
            if nc.is_empty() {
                None
            } else {
                Some(nc.to_string())
            }
        };
        let fallback_latest = extract_latest_ulid_from_messages(&data.messages);
        let next = server_cursor.or(latest).or(fallback_latest);
        if let Some(ref new_cursor) = next {
            let _ = chat_storage::set_scope_cursor(user_scope.as_str(), scope_key.as_str(), new_cursor.as_str());
            current_cursor = Some(new_cursor.clone());
        }
        if !data.has_more {
            break;
        }
    }
    to_stub(
        "group_chat_sync_from_station_scoped",
        json!({
            "synced_count": total_synced,
            "pages_fetched": pages_fetched,
            "cursor_before": cursor,
            "cursor_after": current_cursor
        }),
    )
}

#[tauri::command]
pub fn group_chat_create_group(input: GroupChatCreateGroupInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::CreateGroupRequest {
        name: input.name,
        description: input.description.unwrap_or_default(),
        initial_member_dids: input.member_dids.unwrap_or_default(),
        ..Default::default()
    };

    let resp = match station_client::request_proto::<model::chat::CreateGroupRequest, model::chat::CreateGroupResponse>(
        Method::POST, "/group-chat/create", &token, None, Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    let group_json = match resp.group {
        Some(ref g) => group_to_json(g),
        None => json!(null),
    };

    to_stub("group_chat_create_group", json!({ "group": group_json }))
}

#[tauri::command]
pub fn group_chat_leave_group(input: GroupChatLeaveGroupInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::LeaveGroupRequest {
        group_ulid: input.group_ulid,
    };

    let resp = match station_client::request_proto::<model::chat::LeaveGroupRequest, model::chat::LeaveGroupResponse>(
        Method::POST, "/group-chat/leave", &token, None, Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("group_chat_leave_group", json!({ "success": resp.success }))
}

// ---------------------------------------------------------------------------
// Stub commands - registered in main.rs, backed by station protobuf API
// ---------------------------------------------------------------------------

/// Get a single group's detail by its ULID.
#[tauri::command]
pub fn group_chat_get_group(input: GroupUlidInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::GetGroupRequest {
        group_ulid: input.group_ulid,
    };
    let resp = match station_client::request_proto::<model::chat::GetGroupRequest, model::chat::GetGroupResponse>(
        Method::GET,
        "/group-chat/info",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("group_chat_get_group", get_group_response_to_json(&resp))
}

/// Update a group's name / description.
#[tauri::command]
pub fn group_chat_update_group(input: GroupUpdateInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::UpdateGroupRequest {
        group_ulid: input.group_ulid,
        name: Some(input.name),
        description: Some(input.description.unwrap_or_default()),
        ..Default::default()
    };

    let resp = match station_client::request_proto::<model::chat::UpdateGroupRequest, model::chat::UpdateGroupResponse>(
        Method::PUT,
        "/group-chat/update",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    let data = match resp.group {
        Some(ref g) => json!({ "group": group_to_json(g) }),
        None => json!({ "group": null }),
    };
    to_stub("group_chat_update_group", data)
}

/// Invite members to a group.
#[tauri::command]
pub fn group_chat_invite_to_group(input: GroupInviteInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::InviteToGroupRequest {
        group_ulid: input.group_ulid,
        invitee_dids: input.member_dids,
    };

    let resp = match station_client::request_proto::<model::chat::InviteToGroupRequest, model::chat::InviteToGroupResponse>(
        Method::POST,
        "/group-chat/invite",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub(
        "group_chat_invite_to_group",
        json!({
            "invitations": resp.invitations.iter().map(group_invitation_to_json).collect::<Vec<_>>(),
        }),
    )
}

/// Join a group (optionally via invitation).
#[tauri::command]
pub fn group_chat_join_group(input: GroupJoinInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::JoinGroupRequest {
        group_ulid: input.group_ulid,
        invitation_ulid: input.invitation_ulid.unwrap_or_default(),
    };

    let resp = match station_client::request_proto::<model::chat::JoinGroupRequest, model::chat::JoinGroupResponse>(
        Method::POST,
        "/group-chat/join",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub(
        "group_chat_join_group",
        json!({
            "membership": resp.membership.as_ref().map(group_member_to_json),
        }),
    )
}

/// List members of a group.
#[tauri::command]
pub fn group_chat_get_members(input: GroupMembersInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::GetGroupMembersRequest {
        group_ulid: input.group_ulid,
        limit: input.limit.unwrap_or(100) as i32,
        offset: input.offset.unwrap_or(0) as i32,
    };

    let resp = match station_client::request_proto::<model::chat::GetGroupMembersRequest, model::chat::GetGroupMembersResponse>(
        Method::GET,
        "/group-chat/members",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub(
        "group_chat_get_members",
        json!({
            "members": resp.members.iter().map(group_member_to_json).collect::<Vec<_>>(),
            "total": resp.total,
        }),
    )
}

/// Remove a member from a group.
#[tauri::command]
pub fn group_chat_remove_member(input: GroupRemoveMemberInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::RemoveMemberRequest {
        group_ulid: input.group_ulid,
        actor_did: input.member_did,
    };

    let resp = match station_client::request_proto::<model::chat::RemoveMemberRequest, model::chat::RemoveMemberResponse>(
        Method::POST,
        "/group-chat/member/remove",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("group_chat_remove_member", json!({ "success": resp.success }))
}

/// Recall (withdraw) a message in a group.
#[tauri::command]
pub fn group_chat_recall_message(input: GroupMessageActionInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::RecallGroupMessageRequest {
        group_ulid: input.group_ulid,
        message_ulid: input.message_ulid,
    };

    let resp = match station_client::request_proto::<model::chat::RecallGroupMessageRequest, model::chat::RecallGroupMessageResponse>(
        Method::POST,
        "/group-chat/message/recall",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("group_chat_recall_message", json!({ "success": resp.success }))
}

/// Delete a message in a group.
#[tauri::command]
pub fn group_chat_delete_message(input: GroupMessageActionInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::DeleteGroupMessageRequest {
        group_ulid: input.group_ulid,
        message_ulid: input.message_ulid,
    };

    let resp = match station_client::request_proto::<model::chat::DeleteGroupMessageRequest, model::chat::DeleteGroupMessageResponse>(
        Method::POST,
        "/group-chat/message/delete",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("group_chat_delete_message", json!({ "success": resp.success }))
}

/// Search messages within a group.
#[tauri::command]
pub fn group_chat_search_messages(input: GroupSearchMessagesInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::SearchGroupMessagesRequest {
        group_ulid: input.group_ulid,
        query: input.query,
        limit: input.limit.unwrap_or(50) as i32,
        before_ulid: String::new(),
    };

    let resp = match station_client::request_proto::<model::chat::SearchGroupMessagesRequest, model::chat::SearchGroupMessagesResponse>(
        Method::GET,
        "/group-chat/messages/search",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("group_chat_search_messages", search_group_messages_response_to_json(&resp))
}

/// Update the current user's nickname in a group.
#[tauri::command]
pub fn group_chat_update_nickname(input: GroupUpdateNicknameInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::UpdateMyNicknameRequest {
        group_ulid: input.group_ulid,
        nickname: input.nickname,
    };

    let resp = match station_client::request_proto::<model::chat::UpdateMyNicknameRequest, model::chat::UpdateMyNicknameResponse>(
        Method::PUT,
        "/group-chat/member/nickname",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub(
        "group_chat_update_nickname",
        json!({
            "member": resp.member.as_ref().map(group_member_to_json),
        }),
    )
}

/// Get the current user's settings for a group.
#[tauri::command]
pub fn group_chat_get_settings(input: GroupUlidInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::GetGroupSettingsRequest {
        group_ulid: input.group_ulid,
    };

    let resp = match station_client::request_proto::<model::chat::GetGroupSettingsRequest, model::chat::GetGroupSettingsResponse>(
        Method::GET,
        "/group-chat/my-settings",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("group_chat_get_settings", get_group_settings_response_to_json(&resp))
}

/// Update the current user's settings for a group.
#[tauri::command]
pub fn group_chat_update_settings(input: GroupUpdateMySettingsInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::UpdateGroupSettingsRequest {
        group_ulid: input.group_ulid,
        is_muted: input.is_muted,
        is_pinned: input.is_pinned,
        show_member_nickname: input.show_member_nickname,
    };

    let resp = match station_client::request_proto::<model::chat::UpdateGroupSettingsRequest, model::chat::UpdateGroupSettingsResponse>(
        Method::PUT,
        "/group-chat/my-settings",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("group_chat_update_settings", json!({ "success": resp.success }))
}

/// Retrieve offline messages for a group.
#[tauri::command]
pub fn group_chat_get_offline_messages(input: GroupOfflineMessagesInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let GroupOfflineMessagesInput { limit, .. } = input;

    let req = model::chat::GetOfflineMessagesRequest {
        limit: limit.unwrap_or(100) as i32,
    };

    let resp = match station_client::request_proto::<model::chat::GetOfflineMessagesRequest, model::chat::GetOfflineMessagesResponse>(
        Method::GET,
        "/group-chat/offline-messages",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub(
        "group_chat_get_offline_messages",
        json!({
            "messages": resp.messages.iter().map(group_offline_message_to_json).collect::<Vec<_>>(),
        }),
    )
}

/// Acknowledge (mark as received) offline messages for a group.
#[tauri::command]
pub fn group_chat_ack_offline_messages(input: GroupAckOfflineInput, state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let GroupAckOfflineInput { message_ulids, .. } = input;

    let req = model::chat::AckOfflineMessagesRequest {
        ulids: message_ulids,
    };

    let resp = match station_client::request_proto::<model::chat::AckOfflineMessagesRequest, model::chat::AckOfflineMessagesResponse>(
        Method::POST,
        "/group-chat/offline-messages/ack",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub("group_chat_ack_offline_messages", json!({ "success": resp.success }))
}

/// Get group-chat statistics (unread counts, member counts, etc.).
#[tauri::command]
pub fn group_chat_get_stats(state: State<'_, Arc<AppState>>) -> AppResult<StubPayload> {
    let token = match token_from_state(&state) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let resp = match station_client::request_proto::<(), model::chat::GetGroupStatsResponse>(
        Method::GET,
        "/group-chat/stats",
        &token,
        None,
        None::<&()>,
    ) {
        Ok(r) => r,
        Err(e) => return fail_station_request(e),
    };

    to_stub(
        "group_chat_get_stats",
        json!({
            "totalGroups": resp.total_groups,
            "totalMembers": resp.total_members,
            "totalMessages": resp.total_messages,
            "activeGroups": resp.active_groups,
        }),
    )
}
