use crate::application::chat_storage;
use crate::application::session_resolver;
use crate::contracts::{
    AttachmentInput, ChatKeyRotateInput, ChatLocalSearchInput, ChatScopeCursorGetInput,
    ChatScopeCursorSetInput, GroupAckOfflineInput, GroupChatCreateGroupInput, GroupChatEditInput,
    GroupChatLeaveGroupInput, GroupChatListInput, GroupChatListMessagesInput,
    GroupChatMarkReadInput, GroupChatSendInput, GroupChatSyncInput, GroupChatThreadCountsInput,
    GroupChatThreadInput, GroupChatThreadReadInput, GroupChatUnreadInput, GroupInviteInput,
    GroupJoinInput, GroupMembersInput, GroupMessageActionInput, GroupOfflineMessagesInput,
    GroupRemoveMemberInput, GroupSearchMessagesInput, GroupUlidInput, GroupUpdateInput,
    GroupUpdateMemberInput, GroupUpdateMySettingsInput, GroupUpdateNicknameInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model;
use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use prost::Message;
use reqwest::Method;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{State, Window};

fn token_from_state(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<String, AppResult<StubPayload>> {
    let token = session_resolver::token_for_window(state.inner(), window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(token)
}

fn token_from_state_proto(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<String, AppResult<Vec<u8>>> {
    let token = session_resolver::token_for_window(state.inner(), window).unwrap_or_default();
    if token.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(token)
}

fn actor_id_from_state(state: &State<'_, Arc<AppState>>, window: &Window) -> Option<String> {
    session_resolver::actor_id_for_window(state.inner(), window)
}

fn user_scope_from_state(state: &State<'_, Arc<AppState>>, window: &Window) -> String {
    let actor_id = actor_id_from_state(state, window);
    crate::infrastructure::storage::resolve_user_scope(actor_id.as_deref())
}

fn request_json(
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<Value>,
) -> Result<Value, AppResult<StubPayload>> {
    station_client::request_json(method, path, token, query, body)
        .map_err(|e| e.into_app_result("station request failed"))
}

fn to_stub(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn extract_latest_ulid(payload: &Value) -> Option<String> {
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

fn map_group_attachments(inputs: &[AttachmentInput]) -> Vec<model::chat::GroupMessageAttachment> {
    inputs
        .iter()
        .map(|a| {
            model::chat::GroupMessageAttachment {
                cid: a.cid.clone(),
                filename: a.filename.clone(),
                mime_type: a.mime_type.clone(),
                size: a.size,
                thumbnail_cid: a.thumbnail_cid.clone().unwrap_or_default(),
                visibility: a.visibility.clone().unwrap_or_default(),
                media_encryption: None,
                ..Default::default()
            }
        })
        .collect()
}

fn filter_incremental_messages(
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

#[tauri::command]
pub fn group_chat_list_groups(
    input: GroupChatListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    let query = vec![
        ("limit", input.limit.unwrap_or(50).to_string()),
        ("offset", input.offset.unwrap_or(0).to_string()),
    ];
    let data = match request_json(Method::GET, "/group-chat/list", &token, Some(&query), None) {
        Ok(data) => data,
        Err(error) => return error,
    };
    to_stub("group_chat_list_groups", data)
}

#[tauri::command]
pub fn group_chat_list_messages(
    input: GroupChatListMessagesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.group_ulid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "group_ulid is required", None);
    }
    let mut query = vec![
        ("group_ulid", input.group_ulid),
        ("limit", input.limit.unwrap_or(50).to_string()),
    ];
    if let Some(before) = input.before_ulid {
        query.push(("before_ulid", before));
    }
    let data = match request_json(
        Method::GET,
        "/group-chat/messages",
        &token,
        Some(&query),
        None,
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };
    let user_scope = user_scope_from_state(&state, &window);
    let _ = chat_storage::ingest_group_messages(user_scope.as_str(), &data);
    to_stub("group_chat_list_messages", data)
}

#[tauri::command]
pub fn group_chat_list_thread_messages(
    input: GroupChatThreadInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.group_ulid.trim().is_empty() || input.root_ulid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "group_ulid and root_ulid are required",
            None,
        );
    }
    let data = match chat_storage::list_group_thread_messages(
        &token,
        input.group_ulid.as_str(),
        input.root_ulid.as_str(),
        input.limit.unwrap_or(100),
        input.after_ulid.as_deref(),
        input.max_pages.unwrap_or(50),
    ) {
        Ok(data) => data,
        Err(error) => return error.into_app_result("station request failed"),
    };
    to_stub("group_chat_list_thread_messages", data)
}

#[tauri::command]
pub fn group_chat_thread_counts(
    input: GroupChatThreadCountsInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.group_ulid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "group_ulid is required", None);
    }
    let data = match chat_storage::group_thread_counts(
        &token,
        input.group_ulid.as_str(),
        input.root_ulids.as_slice(),
    ) {
        Ok(data) => data,
        Err(error) => return error.into_app_result("station request failed"),
    };
    to_stub("group_chat_thread_counts", data)
}

#[tauri::command]
pub fn group_chat_thread_mark_read(
    input: GroupChatThreadReadInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.group_ulid.trim().is_empty() || input.root_ulid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "group_ulid and root_ulid are required",
            None,
        );
    }
    let data = match chat_storage::mark_group_thread_read(
        &token,
        input.group_ulid.as_str(),
        input.root_ulid.as_str(),
        input.last_read_ulid.as_deref(),
    ) {
        Ok(data) => data,
        Err(error) => return error.into_app_result("station request failed"),
    };
    to_stub("group_chat_thread_mark_read", data)
}

#[tauri::command]
pub fn group_chat_send_message(
    input: GroupChatSendInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    // Sender Keys is the only supported send path. The web layer passes
    // base64-encoded `GroupCiphertext` proto bytes from `crypto_group_encrypt`;
    // Desktop decodes those bytes and sends a protobuf request to Station.
    // `content` is pinned to empty so plaintext can never be smuggled beside
    // ciphertext.
    let encrypted_payload = match input.encrypted_payload.as_ref() {
        Some(s) if !s.trim().is_empty() => match B64.decode(s.trim().as_bytes()) {
            Ok(bytes) if !bytes.is_empty() => bytes,
            Ok(_) => {
                return AppResult::fail(
                    ErrorCode::InvalidArgument,
                    "encrypted_payload is required for group sends",
                    None,
                );
            }
            Err(e) => {
                return AppResult::fail(
                    ErrorCode::InvalidArgument,
                    format!("Invalid encrypted_payload: {}", e),
                    None,
                );
            }
        },
        _ => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "encrypted_payload is required for group sends",
                None,
            );
        }
    };

    let attachments = input.attachments.unwrap_or_default();
    let req = model::chat::SendGroupMessageRequest {
        group_ulid: input.group_ulid,
        r#type: input.r#type.unwrap_or(1),
        content: String::new(),
        attachments: map_group_attachments(&attachments),
        reply_to_ulid: input.reply_to_ulid.unwrap_or_default(),
        mentioned_dids: input.mentioned_dids.unwrap_or_default(),
        mention_all: input.mention_all.unwrap_or(false),
        encrypted_payload,
        thread_root_ulid: input.thread_root_ulid.unwrap_or_default(),
    };

    let resp = match station_client::request_proto::<
        model::chat::SendGroupMessageRequest,
        model::chat::SendGroupMessageResponse,
    >(
        Method::POST,
        "/group-chat/message/send",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return e.into_app_result("station request failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn group_chat_unread_count(
    input: GroupChatUnreadInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    let mut query = Vec::new();
    if let Some(group_ulid) = input.group_ulid {
        query.push(("group_ulid", group_ulid));
    }
    let data = match request_json(
        Method::GET,
        "/group-chat/unread-count",
        &token,
        Some(&query),
        None,
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };
    to_stub("group_chat_unread_count", data)
}

#[tauri::command]
pub fn group_chat_mark_read(
    input: GroupChatMarkReadInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    let data = match request_json(
        Method::POST,
        "/group-chat/mark-read",
        &token,
        None,
        Some(json!({"group_ulid": input.group_ulid})),
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };
    to_stub("group_chat_mark_read", data)
}

#[tauri::command]
pub fn group_chat_local_search(input: ChatLocalSearchInput) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "query is required", None);
    }
    let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
    let items =
        match chat_storage::search_group_messages("__default__", input.query.as_str(), limit) {
            Ok(items) => items,
            Err(reason) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    "local search failed",
                    Some(json!({ "reason": reason })),
                );
            }
        };
    to_stub("group_chat_local_search", json!({ "messages": items }))
}

#[tauri::command]
pub fn group_chat_local_search_scoped(
    input: ChatLocalSearchInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if input.query.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "query is required", None);
    }
    let user_scope = user_scope_from_state(&state, &window);
    let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
    let items =
        match chat_storage::search_group_messages(user_scope.as_str(), input.query.as_str(), limit)
        {
            Ok(items) => items,
            Err(reason) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    "local search failed",
                    Some(json!({ "reason": reason })),
                );
            }
        };
    to_stub(
        "group_chat_local_search_scoped",
        json!({ "messages": items }),
    )
}

#[tauri::command]
pub fn group_chat_set_cursor_scoped(
    input: ChatScopeCursorSetInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state, &window);
    if input.scope.trim().is_empty() || input.cursor.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "scope and cursor are required",
            None,
        );
    }
    if let Err(reason) = chat_storage::set_scope_cursor(
        user_scope.as_str(),
        input.scope.as_str(),
        input.cursor.as_str(),
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            "set cursor failed",
            Some(json!({"reason": reason})),
        );
    }
    to_stub("group_chat_set_cursor_scoped", json!({"ok": true}))
}

#[tauri::command]
pub fn group_chat_get_cursor_scoped(
    input: ChatScopeCursorGetInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state, &window);
    if input.scope.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "scope is required", None);
    }
    let cursor = match chat_storage::get_scope_cursor(user_scope.as_str(), input.scope.as_str()) {
        Ok(cursor) => cursor,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "get cursor failed",
                Some(json!({"reason": reason})),
            );
        }
    };
    to_stub("group_chat_get_cursor_scoped", json!({"cursor": cursor}))
}

#[tauri::command]
pub fn group_chat_get_key_version_scoped(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let user_scope = user_scope_from_state(&state, &window);
    let key_version = match chat_storage::get_chat_key_version(user_scope.as_str()) {
        Ok(version) => version,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "get key version failed",
                Some(json!({"reason": reason})),
            );
        }
    };
    to_stub(
        "group_chat_get_key_version_scoped",
        json!({"key_version": key_version}),
    )
}

#[tauri::command]
pub fn group_chat_rotate_key_scoped(
    input: ChatKeyRotateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if input.next_version <= 0 {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "next_version must be positive",
            None,
        );
    }
    let user_scope = user_scope_from_state(&state, &window);
    let key_version = match chat_storage::rotate_chat_key(user_scope.as_str(), input.next_version) {
        Ok(version) => version,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "rotate key failed",
                Some(json!({"reason": reason})),
            );
        }
    };
    to_stub(
        "group_chat_rotate_key_scoped",
        json!({"key_version": key_version}),
    )
}

#[tauri::command]
pub fn group_chat_sync_from_station_scoped(
    input: GroupChatSyncInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.group_ulid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "group_ulid is required", None);
    }
    let user_scope = user_scope_from_state(&state, &window);
    let scope_key = format!("group:{}", input.group_ulid);
    let cursor = match chat_storage::get_scope_cursor(user_scope.as_str(), scope_key.as_str()) {
        Ok(cursor) => cursor,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "get cursor failed",
                Some(json!({"reason": reason})),
            );
        }
    };
    let page_limit = input.limit.unwrap_or(100);
    let max_pages = input.max_pages.unwrap_or(10);
    let mut current_cursor = cursor.clone();
    let mut total_synced = 0usize;
    let mut pages_fetched = 0u32;
    for _ in 0..max_pages {
        let mut query = vec![
            ("group_ulid", input.group_ulid.clone()),
            ("limit", page_limit.to_string()),
        ];
        if let Some(ref existing) = current_cursor {
            if !existing.trim().is_empty() {
                query.push(("before_ulid", format!("since:{existing}")));
            }
        }
        let data = match request_json(
            Method::GET,
            "/group-chat/messages",
            &token,
            Some(&query),
            None,
        ) {
            Ok(data) => data,
            Err(error) => return error,
        };
        pages_fetched += 1;
        let (incremental_payload, synced_count, latest) =
            filter_incremental_messages(&data, current_cursor.as_deref());
        let _ = chat_storage::ingest_group_messages(user_scope.as_str(), &incremental_payload);
        total_synced += synced_count;
        let server_cursor = data
            .get("next_cursor")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let fallback_latest = extract_latest_ulid(&data);
        let next = server_cursor.or(latest).or(fallback_latest);
        if let Some(ref new_cursor) = next {
            let _ = chat_storage::set_scope_cursor(
                user_scope.as_str(),
                scope_key.as_str(),
                new_cursor.as_str(),
            );
            current_cursor = Some(new_cursor.clone());
        }
        let has_more = data
            .get("has_more")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !has_more {
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
pub fn group_chat_create_group(
    input: GroupChatCreateGroupInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::CreateGroupRequest {
        name: input.name,
        description: input.description.unwrap_or_default(),
        initial_member_dids: input.member_dids.unwrap_or_default(),
        ..Default::default()
    };

    let resp = match station_client::request_proto::<
        model::chat::CreateGroupRequest,
        model::chat::CreateGroupResponse,
    >(Method::POST, "/group-chat/create", &token, None, Some(&req))
    {
        Ok(r) => r,
        Err(e) => return e.into_app_result("station request failed"),
    };

    let group_json = match resp.group {
        Some(g) => json!({
            "ulid": g.ulid,
            "name": g.name,
            "description": g.description,
            "owner_did": g.owner_did,
            "type": g.r#type,
        }),
        None => json!(null),
    };

    to_stub("group_chat_create_group", json!({ "group": group_json }))
}

#[tauri::command]
pub fn group_chat_leave_group(
    input: GroupChatLeaveGroupInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let req = model::chat::LeaveGroupRequest {
        group_ulid: input.group_ulid,
    };

    let resp = match station_client::request_proto::<
        model::chat::LeaveGroupRequest,
        model::chat::LeaveGroupResponse,
    >(Method::POST, "/group-chat/leave", &token, None, Some(&req))
    {
        Ok(r) => r,
        Err(e) => return e.into_app_result("station request failed"),
    };

    to_stub("group_chat_leave_group", json!({ "success": resp.success }))
}

// ---------------------------------------------------------------------------
// Stub commands - registered in main.rs, backed by station JSON API
// ---------------------------------------------------------------------------

/// Get a single group's detail by its ULID.
#[tauri::command]
pub fn group_chat_get_group(
    input: GroupUlidInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let query = vec![("group_ulid", input.group_ulid)];
    let data = match request_json(Method::GET, "/group-chat/group", &token, Some(&query), None) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("group_chat_get_group", data)
}

/// Update a group's name / description.
#[tauri::command]
pub fn group_chat_update_group(
    input: GroupUpdateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let data = match request_json(
        Method::POST,
        "/group-chat/group/update",
        &token,
        None,
        Some(json!({
            "group_ulid": input.group_ulid,
            "name": input.name,
            "description": input.description.unwrap_or_default(),
        })),
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("group_chat_update_group", data)
}

/// Invite members to a group.
#[tauri::command]
pub fn group_chat_invite_to_group(
    input: GroupInviteInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let data = match request_json(
        Method::POST,
        "/group-chat/invite",
        &token,
        None,
        Some(json!({
            "group_ulid": input.group_ulid,
            "member_dids": input.member_dids,
        })),
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("group_chat_invite_to_group", data)
}

/// Join a group (optionally via invitation).
#[tauri::command]
pub fn group_chat_join_group(
    input: GroupJoinInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let data = match request_json(
        Method::POST,
        "/group-chat/group/join",
        &token,
        None,
        Some(json!({
            "group_ulid": input.group_ulid,
            "invitation_ulid": input.invitation_ulid,
        })),
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("group_chat_join_group", data)
}

/// List members of a group.
#[tauri::command]
pub fn group_chat_get_members(
    input: GroupMembersInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let query = vec![
        ("group_ulid", input.group_ulid),
        ("limit", input.limit.unwrap_or(100).to_string()),
        ("offset", input.offset.unwrap_or(0).to_string()),
    ];

    let data = match request_json(
        Method::GET,
        "/group-chat/group/members",
        &token,
        Some(&query),
        None,
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("group_chat_get_members", data)
}

/// Remove a member from a group.
#[tauri::command]
pub fn group_chat_remove_member(
    input: GroupRemoveMemberInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.group_ulid.trim().is_empty() || input.member_did.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "group_ulid and member_did are required",
            None,
        );
    }
    let req = model::chat::RemoveMemberRequest {
        group_ulid: input.group_ulid,
        actor_did: input.member_did,
    };
    let resp = match station_client::request_proto::<
        model::chat::RemoveMemberRequest,
        model::chat::RemoveMemberResponse,
    >(
        Method::POST,
        "/group-chat/member/remove",
        &token,
        None,
        Some(&req),
    ) {
        Ok(resp) => resp,
        Err(error) => return error.into_app_result("station request failed"),
    };

    AppResult::success(resp.encode_to_vec())
}

#[tauri::command]
pub fn group_chat_update_member(
    input: GroupUpdateMemberInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.group_ulid.trim().is_empty() || input.member_did.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "group_ulid and member_did are required",
            None,
        );
    }
    let muted_until = input
        .muted_until_unix_ms
        .map(|millis| prost_types::Timestamp {
            seconds: millis / 1000,
            nanos: ((millis % 1000) * 1_000_000) as i32,
        });
    let req = model::chat::UpdateMemberRequest {
        group_ulid: input.group_ulid,
        actor_did: input.member_did,
        role: input.role,
        muted: input.muted,
        muted_until,
    };
    let resp = match station_client::request_proto::<
        model::chat::UpdateMemberRequest,
        model::chat::UpdateMemberResponse,
    >(
        Method::PUT,
        "/group-chat/member/update",
        &token,
        None,
        Some(&req),
    ) {
        Ok(resp) => resp,
        Err(error) => return error.into_app_result("station request failed"),
    };

    AppResult::success(resp.encode_to_vec())
}

/// Recall (withdraw) a message in a group. Returns proto bytes
/// for `RecallGroupMessageResponse`. On success Station fans out
/// a `MessageMutation { kind=RECALL }` event over SSE so peers'
/// stores converge via `applyMessageMutation`.
#[tauri::command]
pub fn group_chat_recall_message(
    input: GroupMessageActionInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.group_ulid.trim().is_empty() || input.message_ulid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "group_ulid and message_ulid are required",
            None,
        );
    }
    let req = model::chat::RecallGroupMessageRequest {
        group_ulid: input.group_ulid,
        message_ulid: input.message_ulid,
    };
    let resp = match station_client::request_proto::<
        model::chat::RecallGroupMessageRequest,
        model::chat::RecallGroupMessageResponse,
    >(
        Method::POST,
        "/group-chat/message/recall",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return e.into_app_result("station request failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

/// Edit a previously-sent group message. Same window + ownership
/// gates as friend chat. At least one of `new_content` or
/// `new_encrypted_payload` must be non-empty.
#[tauri::command]
pub fn group_chat_edit_message(
    input: GroupChatEditInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.group_ulid.trim().is_empty() || input.message_ulid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "group_ulid and message_ulid are required",
            None,
        );
    }
    let new_content = input.new_content.unwrap_or_default();
    let new_payload = input.new_encrypted_payload.unwrap_or_default();
    if new_content.trim().is_empty() && new_payload.is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "new_content or new_encrypted_payload is required",
            None,
        );
    }
    let req = model::chat::EditGroupMessageRequest {
        group_ulid: input.group_ulid,
        message_ulid: input.message_ulid,
        new_content,
        new_encrypted_payload: new_payload,
    };
    let resp = match station_client::request_proto::<
        model::chat::EditGroupMessageRequest,
        model::chat::EditGroupMessageResponse,
    >(
        Method::POST,
        "/group-chat/message/edit",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return e.into_app_result("station request failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

/// Delete (hard-remove) a message in a group. Sender or admin /
/// owner only. Server publishes a `MessageMutation { kind=DELETE }`
/// over SSE on success.
#[tauri::command]
pub fn group_chat_delete_message(
    input: GroupMessageActionInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Vec<u8>> {
    let token = match token_from_state_proto(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };
    if input.group_ulid.trim().is_empty() || input.message_ulid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "group_ulid and message_ulid are required",
            None,
        );
    }
    let req = model::chat::DeleteGroupMessageRequest {
        group_ulid: input.group_ulid,
        message_ulid: input.message_ulid,
    };
    let resp = match station_client::request_proto::<
        model::chat::DeleteGroupMessageRequest,
        model::chat::DeleteGroupMessageResponse,
    >(
        Method::POST,
        "/group-chat/message/delete",
        &token,
        None,
        Some(&req),
    ) {
        Ok(r) => r,
        Err(e) => return e.into_app_result("station request failed"),
    };
    AppResult::success(resp.encode_to_vec())
}

/// Search messages within a group.
#[tauri::command]
pub fn group_chat_search_messages(
    input: GroupSearchMessagesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let query = vec![
        ("group_ulid", input.group_ulid),
        ("query", input.query),
        ("limit", input.limit.unwrap_or(50).to_string()),
    ];

    let data = match request_json(
        Method::GET,
        "/group-chat/messages/search",
        &token,
        Some(&query),
        None,
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("group_chat_search_messages", data)
}

/// Update the current user's nickname in a group.
#[tauri::command]
pub fn group_chat_update_nickname(
    input: GroupUpdateNicknameInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let data = match request_json(
        Method::POST,
        "/group-chat/group/nickname",
        &token,
        None,
        Some(json!({
            "group_ulid": input.group_ulid,
            "nickname": input.nickname,
        })),
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("group_chat_update_nickname", data)
}

/// Get the current user's settings for a group.
#[tauri::command]
pub fn group_chat_get_settings(
    input: GroupUlidInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let query = vec![("group_ulid", input.group_ulid)];

    let data = match request_json(
        Method::GET,
        "/group-chat/my-settings",
        &token,
        Some(&query),
        None,
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("group_chat_get_settings", data)
}

/// Update the current user's settings for a group.
#[tauri::command]
pub fn group_chat_update_settings(
    input: GroupUpdateMySettingsInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let mut body = json!({"group_ulid": input.group_ulid});
    if let Some(value) = input.is_muted {
        body["is_muted"] = json!(value);
    }
    if let Some(value) = input.is_pinned {
        body["is_pinned"] = json!(value);
    }
    if let Some(value) = input.show_member_nickname {
        body["show_member_nickname"] = json!(value);
    }
    if let Some(value) = input.alert_enabled {
        body["alert_enabled"] = json!(value);
    }
    if let Some(value) = input.background {
        body["background"] = json!(value);
    }
    if let Some(value) = input.cleared_at_unix_ms {
        body["cleared_at_unix_ms"] = json!(value);
    }

    let data = match request_json(
        Method::PUT,
        "/group-chat/my-settings",
        &token,
        None,
        Some(body),
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("group_chat_update_settings", data)
}

/// Retrieve offline messages for a group.
#[tauri::command]
pub fn group_chat_get_offline_messages(
    input: GroupOfflineMessagesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let query = vec![
        ("group_ulid", input.group_ulid),
        ("limit", input.limit.unwrap_or(100).to_string()),
    ];

    let data = match request_json(
        Method::GET,
        "/group-chat/offline-messages",
        &token,
        Some(&query),
        None,
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("group_chat_get_offline_messages", data)
}

/// Acknowledge (mark as received) offline messages for a group.
#[tauri::command]
pub fn group_chat_ack_offline_messages(
    input: GroupAckOfflineInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let data = match request_json(
        Method::POST,
        "/group-chat/offline-messages/ack",
        &token,
        None,
        Some(json!({
            "group_ulid": input.group_ulid,
            "message_ulids": input.message_ulids,
        })),
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("group_chat_ack_offline_messages", data)
}

/// Get group-chat statistics (unread counts, member counts, etc.).
#[tauri::command]
pub fn group_chat_get_stats(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let token = match token_from_state(&state, &window) {
        Ok(token) => token,
        Err(error) => return error,
    };

    let data = match request_json(Method::GET, "/group-chat/stats", &token, None, None) {
        Ok(data) => data,
        Err(error) => return error,
    };

    to_stub("group_chat_get_stats", data)
}
