use crate::error::{AppResult, ErrorCode};
use crate::messaging::CommandDispatchProgress;
use crate::model::chat::{ConversationKind, MemberStatus, MessagingMembershipAction};
use crate::state::AppState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;
use tauri::{Manager, State, Window};

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

#[derive(Debug, Deserialize)]
pub struct MessagingCommandStatusInput {
    pub command_id: String,
}

#[cfg(feature = "acceptance-webdriver")]
#[derive(Debug, Deserialize)]
pub struct MessagingAcceptanceActorInput {
    pub expected_actor_ptid: String,
}

#[cfg(feature = "acceptance-webdriver")]
#[derive(Debug, Deserialize)]
pub struct MessagingAcceptanceInteractionSnapshotInput {
    pub expected_actor_ptid: String,
    pub conversation_id: String,
    pub message_id: String,
    #[serde(default)]
    pub command_id: String,
}

pub(crate) fn group_creation_state(
    progress: &CommandDispatchProgress,
    target_command_id: &str,
    projection_ready: bool,
) -> &'static str {
    let dispatched_command_id = match progress {
        CommandDispatchProgress::Idle => return "pending",
        CommandDispatchProgress::Submitted { command_id }
        | CommandDispatchProgress::RetryScheduled { command_id, .. }
        | CommandDispatchProgress::Failed { command_id, .. }
        | CommandDispatchProgress::StaleDeliveryPlan { command_id, .. }
        | CommandDispatchProgress::StaleAuthorityPlan { command_id, .. } => command_id,
    };
    if dispatched_command_id != target_command_id {
        return "pending";
    }
    match progress {
        CommandDispatchProgress::Submitted { .. } if projection_ready => "projected",
        CommandDispatchProgress::Submitted { .. }
        | CommandDispatchProgress::RetryScheduled { .. } => "pending",
        CommandDispatchProgress::Failed { .. }
        | CommandDispatchProgress::StaleDeliveryPlan { .. }
        | CommandDispatchProgress::StaleAuthorityPlan { .. } => "failed",
        CommandDispatchProgress::Idle => "pending",
    }
}

fn conversation_member_json(
    conversation_id: &str,
    member: &crate::messaging::ConversationMemberProjection,
) -> Value {
    json!({
        "conversation_id": conversation_id,
        "ptid": member.ptid,
        "role": member.role,
        "member_status": MemberStatus::Active as i32,
    })
}

pub(crate) fn conversation_projection_json(
    engine: &crate::messaging::MessagingEngine,
    conversation: &crate::messaging::ConversationProjection,
) -> Result<Value, String> {
    let mls_status = if conversation.kind == ConversationKind::Group as i32 {
        Some(engine.group_security_status(&conversation.conversation_id, conversation.mls_epoch)?)
    } else {
        None
    };
    let members = conversation
        .members
        .iter()
        .map(|member| conversation_member_json(&conversation.conversation_id, member))
        .collect::<Vec<_>>();
    Ok(json!({
        "conversation_id": conversation.conversation_id,
        "authority_station_id": conversation.authority_station_id,
        "kind": conversation.kind,
        "name": conversation.name,
        "owner_ptid": conversation.owner_ptid,
        "members": members,
        "membership_epoch": conversation.membership_epoch,
        "mls_epoch": conversation.mls_epoch,
        "mls_status": mls_status,
        "active": conversation.active,
        "updated_at_unix_ms": conversation.updated_at_unix_ms,
    }))
}

pub(crate) fn command_status_json(
    engine: &crate::messaging::MessagingEngine,
    command_id: &str,
) -> AppResult<Value> {
    if command_id.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "messaging command status requires command ID",
            None,
        );
    }
    match engine.command_status(command_id) {
        Ok(Some(status)) => AppResult::success(json!({
            "command_id": status.command_id,
            "conversation_id": status.conversation_id,
            "state": status.state,
            "last_error_code": status.last_error_code,
        })),
        Ok(None) => AppResult::fail(
            ErrorCode::NotFound,
            "messaging command status not found",
            None,
        ),
        Err(error) => AppResult::fail(ErrorCode::InternalError, error, None),
    }
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

#[cfg(feature = "acceptance-webdriver")]
fn require_acceptance_actor(
    expected_actor_ptid: &str,
    actual_actor_ptid: &str,
) -> Result<String, AppResult<Value>> {
    let expected = expected_actor_ptid.trim();
    if !expected.starts_with("ptid:") {
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            "acceptance.chat.expectedActorPtidInvalid",
            Some(json!({ "reason": "expected_actor_ptid_invalid" })),
        ));
    }
    if !actual_actor_ptid.starts_with("ptid:") {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "acceptance.chat.windowActorPtidInvalid",
            Some(json!({ "reason": "window_actor_ptid_invalid" })),
        ));
    }
    if expected != actual_actor_ptid {
        return Err(AppResult::fail(
            ErrorCode::Forbidden,
            "acceptance.chat.windowActorMismatch",
            Some(json!({ "reason": "window_actor_mismatch" })),
        ));
    }
    Ok(expected.to_string())
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

fn allow_attachment_preview(window: &Window, path: &Path) -> Result<(), String> {
    let scope = window.app_handle().asset_protocol_scope();
    scope
        .allow_file(path)
        .map_err(|error| format!("allow messaging attachment preview: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn messaging_pick_attachment_source(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> Result<AppResult<Value>, String> {
    let (_, _, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return Ok(error),
    };
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
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Attachment")
        .to_string();
    let mime_type = attachment_mime_type(path);
    let (preview_path, managed_source) = if metadata.len() == 0 {
        (path.to_path_buf(), false)
    } else {
        let selected_path = path.to_path_buf();
        let staging_engine = Arc::clone(&engine);
        let staging_filename = filename.clone();
        let local_path = match tauri::async_runtime::spawn_blocking(move || {
            staging_engine.stage_attachment_file(&staging_filename, &selected_path)
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
        (std::path::PathBuf::from(local_path), true)
    };
    if let Err(error) = allow_attachment_preview(&window, &preview_path) {
        let cleanup = if managed_source {
            engine
                .discard_staged_attachment_source(&preview_path.to_string_lossy())
                .err()
                .map(|cleanup| format!("; staged-source cleanup failed: {cleanup}"))
                .unwrap_or_default()
        } else {
            String::new()
        };
        return Ok(AppResult::fail(
            ErrorCode::InternalError,
            format!("{error}{cleanup}"),
            None,
        ));
    }
    Ok(AppResult::success(json!({
        "file_path": preview_path.to_string_lossy(),
        "filename": filename,
        "mime_type": mime_type,
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
    let mut projected = Vec::with_capacity(conversations.len());
    for conversation in conversations {
        match conversation_projection_json(&engine, &conversation) {
            Ok(value) => projected.push(value),
            Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
        }
    }
    AppResult::success(json!({
        "conversations": projected
    }))
}

#[tauri::command]
pub fn messaging_command_status(
    input: MessagingCommandStatusInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let (_, _, engine) = match active_engine(state.inner(), &window) {
        Ok(value) => value,
        Err(error) => return error,
    };
    command_status_json(&engine, &input.command_id)
}

#[cfg(feature = "acceptance-webdriver")]
#[tauri::command]
pub fn messaging_acceptance_current_endpoint(
    input: MessagingAcceptanceActorInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let session = match state.sessions.get(window.label()) {
        Some(session) => session,
        None => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "acceptance.chat.windowSessionMissing",
                Some(json!({ "reason": "window_session_missing" })),
            )
        }
    };
    let actor_ptid = match require_acceptance_actor(&input.expected_actor_ptid, &session.actor.ptid)
    {
        Ok(actor_ptid) => actor_ptid,
        Err(error) => return error,
    };
    let engine = match state.messaging_engines.get(&session.account_id) {
        Ok(Some(engine)) => engine,
        Ok(None) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "acceptance.chat.messagingEngineInactive",
                Some(json!({ "reason": "messaging_engine_inactive" })),
            )
        }
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("read active messaging engine for acceptance: {error}"),
                Some(json!({ "reason": "messaging_engine_lookup_failed" })),
            )
        }
    };
    if engine.endpoint().ptid != actor_ptid {
        return AppResult::fail(
            ErrorCode::Forbidden,
            "acceptance.chat.messagingEndpointActorMismatch",
            Some(json!({ "reason": "messaging_endpoint_actor_mismatch" })),
        );
    }
    AppResult::success(json!({
        "actor_ptid": actor_ptid,
        "device_id": engine.endpoint().device_id.as_str(),
    }))
}

#[cfg(feature = "acceptance-webdriver")]
#[tauri::command]
pub fn messaging_acceptance_interaction_snapshot(
    input: MessagingAcceptanceInteractionSnapshotInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let session = match state.sessions.get(window.label()) {
        Some(session) => session,
        None => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "acceptance.chat.windowSessionMissing",
                Some(json!({ "reason": "window_session_missing" })),
            )
        }
    };
    let actor_ptid = match require_acceptance_actor(&input.expected_actor_ptid, &session.actor.ptid)
    {
        Ok(actor_ptid) => actor_ptid,
        Err(error) => return error,
    };
    let engine = match state.messaging_engines.get(&session.account_id) {
        Ok(Some(engine)) => engine,
        Ok(None) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "acceptance.chat.messagingEngineInactive",
                Some(json!({ "reason": "messaging_engine_inactive" })),
            )
        }
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("read active messaging engine for acceptance: {error}"),
                Some(json!({ "reason": "messaging_engine_lookup_failed" })),
            )
        }
    };
    let mut snapshot = match engine.acceptance_interaction_snapshot(
        &input.conversation_id,
        &input.message_id,
        &input.command_id,
    ) {
        Ok(snapshot) => snapshot,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let Some(snapshot_object) = snapshot.as_object_mut() else {
        return AppResult::fail(
            ErrorCode::InternalError,
            "acceptance.chat.interactionSnapshotInvalid",
            Some(json!({ "reason": "interaction_snapshot_invalid" })),
        );
    };
    snapshot_object.insert("actorPtid".to_string(), json!(actor_ptid));
    AppResult::success(snapshot)
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
    let prepared = match engine.create_group_conversation(
        &token,
        &input.conversation_id,
        &input.name,
        &input.member_ptids,
    ) {
        Ok(prepared) => prepared,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let progress = match engine.dispatch_command_once(
        &token,
        crate::messaging::now_unix_ms(),
        crate::messaging::CommandRetryPolicy {
            initial_delay_ms: 1_000,
            maximum_delay_ms: 300_000,
        },
    ) {
        Ok(progress) => progress,
        Err(error) => {
            tracing::warn!(
                command_id = %prepared.command_id,
                conversation_id = %prepared.conversation_id,
                error = %error,
                "messaging group dispatch assist failed after durable preparation"
            );
            CommandDispatchProgress::Idle
        }
    };
    if let Err(error) = engine.drain_once(&token, 100) {
        tracing::warn!(
            command_id = %prepared.command_id,
            conversation_id = %prepared.conversation_id,
            error = %error,
            "messaging group drain assist failed after durable preparation"
        );
    }
    if let Err(error) = state.messaging_engines.wake_profile(&account_id) {
        tracing::warn!(
            command_id = %prepared.command_id,
            conversation_id = %prepared.conversation_id,
            error = %error,
            "messaging group lifecycle wake failed after durable preparation"
        );
    }
    let projection_ready = match engine.conversations() {
        Ok(conversations) => conversations
            .iter()
            .any(|conversation| conversation.conversation_id == prepared.conversation_id),
        Err(error) => {
            tracing::warn!(
                command_id = %prepared.command_id,
                conversation_id = %prepared.conversation_id,
                error = %error,
                "messaging group projection read failed after durable preparation"
            );
            false
        }
    };
    let creation_state = group_creation_state(&progress, &prepared.command_id, projection_ready);
    AppResult::success(json!({
        "conversation_id": prepared.conversation_id,
        "command_id": prepared.command_id,
        "state": creation_state,
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
    let staging_engine = Arc::clone(&engine);
    let local_path = match tauri::async_runtime::spawn_blocking(move || {
        staging_engine.stage_attachment_source(&input.filename, &input.bytes)
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
    if let Err(error) = allow_attachment_preview(&window, Path::new(&local_path)) {
        let cleanup = engine
            .discard_staged_attachment_source(&local_path)
            .err()
            .map(|cleanup| format!("; staged-source cleanup failed: {cleanup}"))
            .unwrap_or_default();
        return Ok(AppResult::fail(
            ErrorCode::InternalError,
            format!("{error}{cleanup}"),
            None,
        ));
    }
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
    if let Err(error) = allow_attachment_preview(&window, Path::new(&local_path)) {
        let cleanup = engine
            .discard_staged_attachment_source(&local_path)
            .err()
            .map(|cleanup| format!("; staged-source cleanup failed: {cleanup}"))
            .unwrap_or_default();
        return AppResult::fail(ErrorCode::InternalError, format!("{error}{cleanup}"), None);
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
    if let Err(error) = allow_attachment_preview(&window, Path::new(&local_path)) {
        return Ok(AppResult::fail(ErrorCode::InternalError, error, None));
    }
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

#[cfg(test)]
mod tests {
    #[cfg(feature = "acceptance-webdriver")]
    use super::require_acceptance_actor;
    use super::{conversation_member_json, group_creation_state};
    use crate::messaging::CommandDispatchProgress;
    use crate::model::chat::{MemberRole, MemberStatus};

    #[test]
    fn group_creation_only_reports_projected_for_its_own_consumed_command() {
        let target = CommandDispatchProgress::Submitted {
            command_id: "group-command".to_string(),
        };
        assert_eq!(
            group_creation_state(&target, "group-command", true),
            "projected"
        );
        assert_eq!(
            group_creation_state(&target, "group-command", false),
            "pending"
        );

        let other = CommandDispatchProgress::Submitted {
            command_id: "older-command".to_string(),
        };
        assert_eq!(
            group_creation_state(&other, "group-command", true),
            "pending"
        );
        let other_failed = CommandDispatchProgress::Failed {
            command_id: "older-command".to_string(),
            code: "terminal".to_string(),
        };
        assert_eq!(
            group_creation_state(&other_failed, "group-command", false),
            "pending"
        );
        assert_eq!(
            group_creation_state(&CommandDispatchProgress::Idle, "group-command", true),
            "pending"
        );
        let retrying = CommandDispatchProgress::RetryScheduled {
            command_id: "group-command".to_string(),
            next_attempt_at_unix_ms: 10,
        };
        assert_eq!(
            group_creation_state(&retrying, "group-command", false),
            "pending"
        );
    }

    #[test]
    fn group_creation_projects_target_dispatch_failure() {
        let failed = CommandDispatchProgress::Failed {
            command_id: "group-command".to_string(),
            code: "terminal".to_string(),
        };
        assert_eq!(
            group_creation_state(&failed, "group-command", false),
            "failed"
        );
    }

    #[test]
    fn conversation_member_projection_preserves_identity_and_owner_role() {
        let owner = conversation_member_json(
            "group-1",
            &crate::messaging::ConversationMemberProjection {
                ptid: "ptid:alice".to_string(),
                role: MemberRole::Owner as i32,
            },
        );
        assert_eq!(owner["conversation_id"], "group-1");
        assert_eq!(owner["ptid"], "ptid:alice");
        assert_eq!(owner["role"], MemberRole::Owner as i32);
        assert_eq!(owner["member_status"], MemberStatus::Active as i32);

        let admin = conversation_member_json(
            "group-1",
            &crate::messaging::ConversationMemberProjection {
                ptid: "ptid:bob".to_string(),
                role: MemberRole::Admin as i32,
            },
        );
        assert_eq!(admin["role"], MemberRole::Admin as i32);
    }

    #[cfg(feature = "acceptance-webdriver")]
    #[test]
    fn acceptance_actor_requires_the_bound_canonical_ptid() {
        assert_eq!(
            require_acceptance_actor(" ptid:v1:actor:alice ", "ptid:v1:actor:alice")
                .expect("matching canonical actor"),
            "ptid:v1:actor:alice"
        );

        let invalid =
            require_acceptance_actor("alice", "ptid:v1:actor:alice").expect_err("invalid PTID");
        assert_eq!(
            invalid
                .error
                .expect("invalid PTID error")
                .details
                .expect("invalid PTID details")["reason"],
            "expected_actor_ptid_invalid"
        );

        let mismatch = require_acceptance_actor("ptid:v1:actor:alice", "ptid:v1:actor:bob")
            .expect_err("actor mismatch");
        assert_eq!(
            mismatch
                .error
                .expect("actor mismatch error")
                .details
                .expect("actor mismatch details")["reason"],
            "window_actor_mismatch"
        );
    }
}
