use crate::error::{AppResult, ErrorCode};
use crate::model::chat::{ConversationKind, MessagingMembershipAction};
use crate::state::AppState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{State, Window};

#[derive(Debug, Deserialize)]
pub struct MessagingLocalAttachmentInput {
    pub file_path: String,
    pub filename: String,
    pub mime_type: String,
}

#[derive(Debug, Deserialize)]
pub struct MessagingStageAttachmentSourceInput {
    pub filename: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
pub struct MessagingDiscardAttachmentSourceInput {
    pub file_path: String,
}

#[derive(Debug, Deserialize)]
pub struct MessagingSendMessageInput {
    pub conversation_id: String,
    pub conversation_kind: String,
    pub plaintext: String,
    #[serde(default)]
    pub reply_to_message_id: String,
    #[serde(default)]
    pub thread_root_message_id: String,
    #[serde(default)]
    pub attachments: Vec<MessagingLocalAttachmentInput>,
}

#[derive(Debug, Deserialize)]
pub struct MessagingListMessagesInput {
    pub conversation_id: String,
}

#[derive(Debug, Deserialize)]
pub struct MessagingListThreadMessagesInput {
    pub conversation_id: String,
    pub thread_root_message_id: String,
}

#[derive(Debug, Deserialize)]
pub struct MessagingTypingInput {
    pub conversation_id: String,
    pub is_typing: bool,
}

#[derive(Debug, Deserialize)]
pub struct MessagingReadCursorInput {
    pub conversation_id: String,
    pub last_read_sequence: i64,
}

#[derive(Debug, Deserialize)]
pub struct MessagingMetadataInteractionInput {
    pub conversation_id: String,
    pub message_id: String,
    pub kind: String,
    #[serde(default)]
    pub reaction: String,
    #[serde(default)]
    pub remove: bool,
}

#[derive(Debug, Deserialize)]
pub struct MessagingEditInput {
    pub conversation_id: String,
    pub message_id: String,
    pub plaintext: String,
}

#[derive(Debug, Deserialize)]
pub struct MessagingOpenAttachmentInput {
    pub attachment_id: String,
}

#[derive(Debug, Deserialize)]
pub struct MessagingSearchMessagesInput {
    pub conversation_id: String,
    pub query: String,
    #[serde(default)]
    pub before_timestamp_unix_ms: Option<i64>,
    #[serde(default)]
    pub before_message_id: Option<String>,
    #[serde(default = "default_search_limit")]
    pub limit: usize,
}

fn default_search_limit() -> usize {
    50
}

fn attachment_mime_type(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "pdf" => "application/pdf",
        "json" => "application/json",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}

#[derive(Debug, Deserialize)]
pub struct MessagingCreateDirectInput {
    pub peer_ptid: String,
}

#[derive(Debug, Deserialize)]
pub struct MessagingCreateGroupInput {
    pub conversation_id: String,
    pub name: String,
    pub member_ptids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct MessagingMembershipTransitionInput {
    pub conversation_id: String,
    pub action: String,
    pub target_ptid: String,
    #[serde(default)]
    pub target_device_id: String,
    #[serde(default)]
    pub role: String,
}

fn active_engine(
    state: &Arc<AppState>,
    window: &Window,
) -> Result<(String, String, Arc<crate::messaging::MessagingEngine>), AppResult<Value>> {
    let session = state
        .sessions
        .get(window.label())
        .ok_or_else(|| AppResult::fail(ErrorCode::Unauthorized, "authentication required", None))?;
    if session.account_id.trim().is_empty() || session.jwt.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authenticated profile is incomplete",
            None,
        ));
    }
    let engine = state
        .messaging_engines
        .get(&session.account_id)
        .map_err(|error| AppResult::fail(ErrorCode::InternalError, error, None))?
        .ok_or_else(|| {
            AppResult::fail(
                ErrorCode::InternalError,
                "messaging profile engine is not active",
                None,
            )
        })?;
    Ok((session.account_id, session.jwt, engine))
}

fn attachment_projection_json(
    attachment: &crate::model::chat::AttachmentPlaintextMetadata,
) -> Value {
    let object = attachment.object.as_ref();
    json!({
        "attachment_id": attachment.attachment_id,
        "filename": attachment.filename,
        "mime_type": attachment.mime_type,
        "plaintext_size": attachment.plaintext_size,
        "object_id": object.map(|value| value.object_id.as_str()).unwrap_or_default(),
        "storage_ref": object.map(|value| value.storage_ref.as_str()).unwrap_or_default(),
        "ciphertext_size": object.map(|value| value.ciphertext_size).unwrap_or_default(),
        "availability_state": if object.is_some() { "remote" } else { "uploading" },
    })
}

#[tauri::command]
pub async fn messaging_pick_attachment_source(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> Result<AppResult<Value>, String> {
    if let Err(error) = active_engine(state.inner(), &window) {
        return Ok(error);
    }
    let selected = rfd::AsyncFileDialog::new()
        .set_title("Select File")
        .pick_file()
        .await;
    let Some(handle) = selected else {
        return Ok(AppResult::fail(
            ErrorCode::InvalidArgument,
            "No file selected",
            None,
        ));
    };
    let path = handle.path();
    let metadata = match path.metadata() {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => {
            return Ok(AppResult::fail(
                ErrorCode::InvalidArgument,
                "selected attachment is not a file",
                None,
            ))
        }
        Err(error) => {
            return Ok(AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("stat selected messaging attachment: {error}"),
                None,
            ))
        }
    };
    Ok(AppResult::success(json!({
        "file_path": path.to_string_lossy(),
        "filename": path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Attachment"),
        "mime_type": attachment_mime_type(path),
        "size": metadata.len(),
    })))
}

#[tauri::command]
pub fn messaging_create_direct(
    input: MessagingCreateDirectInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    if input.peer_ptid.trim().is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "peer_ptid is required", None);
    }
    let (account_id, token, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let conversation_id = match engine.create_direct_conversation(&token, &input.peer_ptid) {
        Ok(conversation_id) => conversation_id,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    if let Err(error) = engine.drain_once(&token, 100) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    if let Err(error) = state.messaging_engines.wake_profile(&account_id) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    AppResult::success(json!({
        "conversation_id": conversation_id,
        "state": "projected",
    }))
}

#[tauri::command]
pub fn messaging_list_conversations(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (_, _, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let conversations = match engine.conversations() {
        Ok(conversations) => conversations,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    AppResult::success(json!({
        "conversations": conversations.into_iter().map(|conversation| json!({
            "conversation_id": conversation.conversation_id,
            "authority_station_id": conversation.authority_station_id,
            "kind": conversation.kind,
            "name": conversation.name,
            "owner_ptid": conversation.owner_ptid,
            "member_ptids": conversation.member_ptids,
            "membership_epoch": conversation.membership_epoch,
            "mls_epoch": conversation.mls_epoch,
            "active": conversation.active,
            "updated_at_unix_ms": conversation.updated_at_unix_ms,
        })).collect::<Vec<_>>()
    }))
}

#[tauri::command]
pub fn messaging_create_group(
    input: MessagingCreateGroupInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    if input.conversation_id.trim().is_empty()
        || input.name.trim().is_empty()
        || input.member_ptids.is_empty()
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id, name, and members are required",
            None,
        );
    }
    let (account_id, token, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let conversation_id = match engine.create_group_conversation(
        &token,
        &input.conversation_id,
        &input.name,
        &input.member_ptids,
    ) {
        Ok(conversation_id) => conversation_id,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let progress = engine.dispatch_command_once(
        &token,
        crate::messaging::now_unix_ms(),
        crate::messaging::CommandRetryPolicy {
            initial_delay_ms: 1_000,
            maximum_delay_ms: 300_000,
        },
    );
    if !matches!(
        progress,
        Ok(crate::messaging::CommandDispatchProgress::Submitted { .. })
            | Ok(crate::messaging::CommandDispatchProgress::Idle)
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("messaging group genesis dispatch incomplete: {progress:?}"),
            None,
        );
    }
    if let Err(error) = engine.drain_once(&token, 100) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    if let Err(error) = state.messaging_engines.wake_profile(&account_id) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    AppResult::success(json!({
        "conversation_id": conversation_id,
        "state": "projected",
    }))
}

#[tauri::command]
pub fn messaging_membership_transition(
    input: MessagingMembershipTransitionInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    if input.conversation_id.trim().is_empty() || input.target_ptid.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id and target_ptid are required",
            None,
        );
    }
    let action = match input.action.as_str() {
        "add_actor" => MessagingMembershipAction::AddActor,
        "remove_actor" => MessagingMembershipAction::RemoveActor,
        "add_device" => MessagingMembershipAction::AddDevice,
        "remove_device" => MessagingMembershipAction::RemoveDevice,
        _ => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "unsupported messaging membership action",
                None,
            );
        }
    };
    if matches!(
        action,
        MessagingMembershipAction::AddDevice | MessagingMembershipAction::RemoveDevice
    ) && input.target_device_id.trim().is_empty()
    {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "target_device_id is required for a device transition",
            None,
        );
    }
    let (account_id, token, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let command = match engine.prepare_membership_transition(
        &token,
        &crate::messaging::MembershipTransitionIntentInput {
            conversation_id: input.conversation_id,
            action,
            target_ptid: input.target_ptid,
            target_device_id: input.target_device_id,
            role: input.role,
        },
    ) {
        Ok(command) => command,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let command_id = command.command_id.clone();
    let progress = engine.dispatch_command_once(
        &token,
        crate::messaging::now_unix_ms(),
        crate::messaging::CommandRetryPolicy {
            initial_delay_ms: 1_000,
            maximum_delay_ms: 300_000,
        },
    );
    if !matches!(
        progress,
        Ok(crate::messaging::CommandDispatchProgress::Submitted { .. })
            | Ok(crate::messaging::CommandDispatchProgress::Idle)
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("messaging membership transition dispatch incomplete: {progress:?}"),
            None,
        );
    }
    if let Err(error) = engine.drain_once(&token, 100) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    if let Err(error) = state.messaging_engines.wake_profile(&account_id) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    AppResult::success(json!({
        "command_id": command_id,
        "state": "pending",
    }))
}

#[tauri::command]
pub async fn messaging_send_message(
    input: MessagingSendMessageInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> Result<AppResult<Value>, String> {
    let conversation_kind = match input.conversation_kind.as_str() {
        "direct" => ConversationKind::Direct,
        "group" => ConversationKind::Group,
        _ => {
            return Ok(AppResult::fail(
                ErrorCode::InvalidArgument,
                "conversation_kind must be direct or group",
                None,
            ));
        }
    };
    if input.conversation_id.trim().is_empty()
        || (input.plaintext.is_empty() && input.attachments.is_empty())
    {
        return Ok(AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id and message content are required",
            None,
        ));
    }
    let (account_id, token, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return Ok(error),
    };
    let conversation_id = input.conversation_id;
    let plaintext = input.plaintext;
    let reply_to_message_id = input.reply_to_message_id;
    let thread_root_message_id = input.thread_root_message_id;
    let attachment_intents = input
        .attachments
        .into_iter()
        .map(|attachment| crate::messaging::LocalAttachmentIntent {
            source_local_ref: attachment.file_path,
            filename: attachment.filename,
            mime_type: attachment.mime_type,
        })
        .collect::<Vec<_>>();
    let outcome = match tauri::async_runtime::spawn_blocking(move || {
        engine.submit_message(
            &token,
            &conversation_id,
            conversation_kind,
            &plaintext,
            &reply_to_message_id,
            &thread_root_message_id,
            &attachment_intents,
        )
    })
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Ok(AppResult::fail(ErrorCode::InternalError, error, None)),
        Err(error) => {
            return Ok(AppResult::fail(
                ErrorCode::InternalError,
                format!("messaging send worker failed: {error}"),
                None,
            ))
        }
    };
    if let Err(error) = state.messaging_engines.wake_profile(&account_id) {
        return Ok(AppResult::fail(ErrorCode::InternalError, error, None));
    }
    Ok(AppResult::success(json!({
        "command_id": outcome.command_id.unwrap_or_default(),
        "message_id": outcome.message_id,
        "attachment_ids": outcome.attachment_ids,
        "state": outcome.state,
    })))
}

#[tauri::command]
pub fn messaging_submit_typing(
    input: MessagingTypingInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (_, token, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    match engine.submit_typing(&token, &input.conversation_id, input.is_typing) {
        Ok(()) => AppResult::success(json!({"submitted": true})),
        Err(error) => AppResult::fail(ErrorCode::InternalError, error, None),
    }
}

#[tauri::command]
pub fn messaging_submit_read_cursor(
    input: MessagingReadCursorInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (_, token, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    match engine.submit_read_cursor(&token, &input.conversation_id, input.last_read_sequence) {
        Ok(()) => AppResult::success(json!({"submitted": true})),
        Err(error) => AppResult::fail(ErrorCode::InternalError, error, None),
    }
}

#[tauri::command]
pub fn messaging_submit_edit(
    input: MessagingEditInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (account_id, token, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let command_id = match engine.submit_edit(
        &token,
        &input.conversation_id,
        &input.message_id,
        &input.plaintext,
    ) {
        Ok(command_id) => command_id,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    if let Err(error) = state.messaging_engines.wake_profile(&account_id) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    AppResult::success(json!({
        "command_id": command_id,
        "state": "pending",
    }))
}

#[tauri::command]
pub fn messaging_submit_metadata_interaction(
    input: MessagingMetadataInteractionInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (account_id, token, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let interaction = match input.kind.as_str() {
        "retract" => crate::messaging::MetadataInteraction::Retract,
        "reaction" => crate::messaging::MetadataInteraction::Reaction {
            reaction: &input.reaction,
            remove: input.remove,
        },
        "pin" => crate::messaging::MetadataInteraction::Pin {
            remove: input.remove,
        },
        _ => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "unsupported metadata interaction kind",
                None,
            )
        }
    };
    let command_id = match engine.submit_metadata_interaction(
        &token,
        &input.conversation_id,
        &input.message_id,
        interaction,
    ) {
        Ok(command_id) => command_id,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    if let Err(error) = state.messaging_engines.wake_profile(&account_id) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    AppResult::success(json!({
        "command_id": command_id,
        "state": "pending",
    }))
}

#[tauri::command]
pub async fn messaging_stage_attachment_source(
    input: MessagingStageAttachmentSourceInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> Result<AppResult<Value>, String> {
    let (_, _, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return Ok(error),
    };
    let local_path = match tauri::async_runtime::spawn_blocking(move || {
        engine.stage_attachment_source(&input.filename, &input.bytes)
    })
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Ok(AppResult::fail(ErrorCode::InvalidArgument, error, None)),
        Err(error) => {
            return Ok(AppResult::fail(
                ErrorCode::InternalError,
                format!("messaging attachment staging worker failed: {error}"),
                None,
            ))
        }
    };
    Ok(AppResult::success(json!({
        "local_path": local_path,
    })))
}

#[tauri::command]
pub fn messaging_discard_attachment_source(
    input: MessagingDiscardAttachmentSourceInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (_, _, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    match engine.discard_staged_attachment_source(&input.file_path) {
        Ok(()) => AppResult::success(json!({ "discarded": true })),
        Err(error) => AppResult::fail(ErrorCode::InvalidArgument, error, None),
    }
}

#[tauri::command]
pub fn messaging_capture_attachment_source(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (_, _, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let captured = match super::oss::capture_screenshot_with_window_hidden(&window) {
        Ok(path) => path,
        Err(error) => {
            let error = error.error.unwrap_or(crate::error::AppError {
                code: ErrorCode::InternalError,
                message: "capture messaging attachment failed".to_string(),
                details: None,
            });
            return AppResult::fail(error.code, error.message, error.details);
        }
    };
    let bytes = match std::fs::read(&captured) {
        Ok(bytes) => bytes,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("read captured messaging attachment: {error}"),
                None,
            )
        }
    };
    let local_path = match engine.stage_attachment_source("Screenshot.png", &bytes) {
        Ok(path) => path,
        Err(error) => {
            let cleanup = std::fs::remove_file(&captured)
                .err()
                .map(|cleanup| format!("; cleanup failed: {cleanup}"))
                .unwrap_or_default();
            return AppResult::fail(ErrorCode::InternalError, format!("{error}{cleanup}"), None);
        }
    };
    if let Err(error) = std::fs::remove_file(&captured) {
        let cleanup = engine
            .discard_staged_attachment_source(&local_path)
            .err()
            .map(|cleanup| format!("; staged-source cleanup failed: {cleanup}"))
            .unwrap_or_default();
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("remove captured messaging source: {error}{cleanup}"),
            None,
        );
    }
    AppResult::success(json!({
        "file_path": local_path,
        "filename": "Screenshot.png",
        "mime_type": "image/png",
    }))
}

#[tauri::command]
pub fn messaging_list_messages(
    input: MessagingListMessagesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    if input.conversation_id.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id is required",
            None,
        );
    }
    let (_, _, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let messages = match engine.conversation_messages(&input.conversation_id) {
        Ok(messages) => messages,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    AppResult::success(json!({
        "messages": messages.into_iter().map(|message| json!({
            "event_id": message.event_id,
            "event_sequence": message.event_sequence,
            "message_id": message.message_id,
            "sender_ptid": message.sender_ptid,
            "sender_device_id": message.sender_device_id,
            "plaintext": message.plaintext,
            "attachments": message.attachments.iter()
                .map(attachment_projection_json)
                .collect::<Vec<_>>(),
            "state": message.state,
            "timestamp_unix_ms": message.timestamp_unix_ms,
            "reply_to_message_id": message.reply_to_message_id,
            "thread_root_message_id": message.thread_root_message_id,
            "edited_text": message.edited_text,
            "edited_at_unix_ms": message.edited_at_unix_ms,
            "retracted": message.retracted,
            "reactions": message.reactions.into_iter().map(
                |(actor_ptid, reaction, created_at_unix_ms)| json!({
                    "actor_ptid": actor_ptid,
                    "reaction": reaction,
                    "created_at_unix_ms": created_at_unix_ms,
                })
            ).collect::<Vec<_>>(),
            "pinned_by_ptid": message.pinned_by_ptid,
            "pinned_at_unix_ms": message.pinned_at_unix_ms,
            "read_by_ptids": message.read_by_ptids,
        })).collect::<Vec<_>>()
    }))
}

#[tauri::command]
pub fn messaging_list_thread_messages(
    input: MessagingListThreadMessagesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    if input.conversation_id.trim().is_empty() || input.thread_root_message_id.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "conversation_id and thread_root_message_id are required",
            None,
        );
    }
    let (_, _, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let messages =
        match engine.thread_messages(&input.conversation_id, &input.thread_root_message_id) {
            Ok(messages) => messages,
            Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
        };
    AppResult::success(json!({
        "messages": messages.into_iter().map(|message| json!({
            "event_id": message.event_id,
            "event_sequence": message.event_sequence,
            "message_id": message.message_id,
            "sender_ptid": message.sender_ptid,
            "sender_device_id": message.sender_device_id,
            "plaintext": message.plaintext,
            "attachments": message.attachments.iter()
                .map(attachment_projection_json)
                .collect::<Vec<_>>(),
            "state": message.state,
            "timestamp_unix_ms": message.timestamp_unix_ms,
            "reply_to_message_id": message.reply_to_message_id,
            "thread_root_message_id": message.thread_root_message_id,
            "edited_text": message.edited_text,
            "edited_at_unix_ms": message.edited_at_unix_ms,
            "retracted": message.retracted,
            "reactions": message.reactions.into_iter().map(
                |(actor_ptid, reaction, created_at_unix_ms)| json!({
                    "actor_ptid": actor_ptid,
                    "reaction": reaction,
                    "created_at_unix_ms": created_at_unix_ms,
                })
            ).collect::<Vec<_>>(),
            "pinned_by_ptid": message.pinned_by_ptid,
            "pinned_at_unix_ms": message.pinned_at_unix_ms,
            "read_by_ptids": message.read_by_ptids,
        })).collect::<Vec<_>>()
    }))
}

#[tauri::command]
pub async fn messaging_open_attachment(
    input: MessagingOpenAttachmentInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> Result<AppResult<Value>, String> {
    if input.attachment_id.trim().is_empty() {
        return Ok(AppResult::fail(
            ErrorCode::InvalidArgument,
            "attachment_id is required",
            None,
        ));
    }
    let (_, token, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return Ok(error),
    };
    let attachment_id = input.attachment_id;
    let local_path = match tauri::async_runtime::spawn_blocking(move || {
        engine.open_attachment(&token, &attachment_id)
    })
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Ok(AppResult::fail(ErrorCode::InternalError, error, None)),
        Err(error) => {
            return Ok(AppResult::fail(
                ErrorCode::InternalError,
                format!("messaging attachment worker failed: {error}"),
                None,
            ))
        }
    };
    Ok(AppResult::success(json!({
        "local_path": local_path,
    })))
}

#[tauri::command]
pub fn messaging_search_messages(
    input: MessagingSearchMessagesInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let before = match (
        input.before_timestamp_unix_ms,
        input.before_message_id.as_deref(),
    ) {
        (None, None) => None,
        (Some(timestamp), Some(message_id)) => Some((timestamp, message_id)),
        _ => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "messaging search cursor is incomplete",
                None,
            )
        }
    };
    let (_, _, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let messages =
        match engine.search_messages(&input.conversation_id, &input.query, before, input.limit) {
            Ok(messages) => messages,
            Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
        };
    AppResult::success(json!({
        "messages": messages.into_iter().map(|message| json!({
            "event_id": message.event_id,
            "event_sequence": message.event_sequence,
            "message_id": message.message_id,
            "sender_ptid": message.sender_ptid,
            "sender_device_id": message.sender_device_id,
            "plaintext": message.plaintext,
            "attachments": message.attachments.iter()
                .map(attachment_projection_json)
                .collect::<Vec<_>>(),
            "state": message.state,
            "timestamp_unix_ms": message.timestamp_unix_ms,
            "reply_to_message_id": message.reply_to_message_id,
            "thread_root_message_id": message.thread_root_message_id,
            "edited_text": message.edited_text,
            "edited_at_unix_ms": message.edited_at_unix_ms,
            "retracted": message.retracted,
            "reactions": message.reactions.into_iter().map(
                |(actor_ptid, reaction, created_at_unix_ms)| json!({
                    "actor_ptid": actor_ptid,
                    "reaction": reaction,
                    "created_at_unix_ms": created_at_unix_ms,
                })
            ).collect::<Vec<_>>(),
            "pinned_by_ptid": message.pinned_by_ptid,
            "pinned_at_unix_ms": message.pinned_at_unix_ms,
            "read_by_ptids": message.read_by_ptids,
        })).collect::<Vec<_>>()
    }))
}
