use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};

use messaging_core::contracts::ConversationMessageProjection;
use messaging_core::outbox::{CommandDispatchProgress, MetadataInteraction};
use prost::Message;

use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;

use super::engine::{
    MessagingAttachmentOpenProgress, MessagingAttachmentStage, ATTACHMENT_STAGE_CHUNK_SIZE,
};
use super::lifecycle::{MessagingRuntimeStatus, MobileMessagingRuntime};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingActivateInput {
    station_peer_id: String,
    station_origin: String,
    actor_ptid: String,
    access_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingAccountInput {
    station_peer_id: String,
    actor_ptid: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingConversationInput {
    station_peer_id: String,
    actor_ptid: String,
    conversation_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingThreadInput {
    station_peer_id: String,
    actor_ptid: String,
    conversation_id: String,
    thread_root_message_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingSearchInput {
    station_peer_id: String,
    actor_ptid: String,
    conversation_id: String,
    query: String,
    before_timestamp_unix_ms: Option<i64>,
    before_message_id: Option<String>,
    #[serde(default = "default_search_limit")]
    limit: usize,
}

fn default_search_limit() -> usize {
    50
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingSendMessageInput {
    station_peer_id: String,
    actor_ptid: String,
    conversation_id: String,
    plaintext: String,
    #[serde(default)]
    reply_to_message_id: String,
    #[serde(default)]
    thread_root_message_id: String,
    #[serde(default)]
    attachment_stage_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingAttachmentStageBeginInput {
    station_peer_id: String,
    actor_ptid: String,
    filename: String,
    mime_type: String,
    plaintext_size: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingAttachmentStageWriteInput {
    station_peer_id: String,
    actor_ptid: String,
    stage_id: String,
    offset: u64,
    bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingAttachmentStageInput {
    station_peer_id: String,
    actor_ptid: String,
    stage_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingAttachmentTransferInput {
    station_peer_id: String,
    actor_ptid: String,
    attachment_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingEditInput {
    station_peer_id: String,
    actor_ptid: String,
    conversation_id: String,
    message_id: String,
    plaintext: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum MessagingMetadataInteraction {
    Retract,
    Reaction { reaction: String, remove: bool },
    Pin { remove: bool },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingMetadataInteractionInput {
    station_peer_id: String,
    actor_ptid: String,
    conversation_id: String,
    message_id: String,
    interaction: MessagingMetadataInteraction,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingReadCursorInput {
    station_peer_id: String,
    actor_ptid: String,
    conversation_id: String,
    last_read_sequence: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingTypingInput {
    station_peer_id: String,
    actor_ptid: String,
    conversation_id: String,
    is_typing: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingCommandStatusInput {
    station_peer_id: String,
    actor_ptid: String,
    command_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingCreateDirectInput {
    station_peer_id: String,
    actor_ptid: String,
    peer_ptid: String,
    federation_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingCreateGroupInput {
    station_peer_id: String,
    actor_ptid: String,
    conversation_id: String,
    name: String,
    member_ptids: Vec<String>,
    federation_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendRequestSendInput {
    station_peer_id: String,
    actor_ptid: String,
    receiver_ptid: String,
    receiver_home_station_peer_id: String,
    federation_id: String,
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendRequestDecisionInput {
    station_peer_id: String,
    actor_ptid: String,
    request_id: String,
    sender_ptid: String,
    receiver_ptid: String,
    sender_home_station_peer_id: String,
    receiver_home_station_peer_id: String,
    federation_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingConversationProjection {
    conversation_id: String,
    authority_station_id: String,
    federation_id: String,
    kind: i32,
    name: String,
    owner_ptid: String,
    member_ptids: Vec<String>,
    membership_epoch: i64,
    mls_epoch: i64,
    active: bool,
    updated_at_unix_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingAttachmentProjection {
    attachment_id: String,
    filename: String,
    mime_type: String,
    plaintext_size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    object_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    storage_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ciphertext_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    availability_state: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingReactionProjection {
    actor_ptid: String,
    reaction: String,
    created_at_unix_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingMessageProjection {
    #[serde(skip_serializing_if = "Option::is_none")]
    event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    event_sequence: Option<i64>,
    message_id: String,
    sender_ptid: String,
    sender_device_id: String,
    plaintext: String,
    attachments: Vec<MessagingAttachmentProjection>,
    state: String,
    timestamp_unix_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to_message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thread_root_message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    edited_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    edited_at_unix_ms: Option<i64>,
    retracted: bool,
    reactions: Vec<MessagingReactionProjection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pinned_by_ptid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pinned_at_unix_ms: Option<i64>,
    read_by_ptids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingCommandStatusProjection {
    command_id: String,
    conversation_id: String,
    state: String,
    last_error_code: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingSubmitCommandResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    command_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message_id: Option<String>,
    attachment_ids: Vec<String>,
    state: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MessagingConversationCreationState {
    Pending,
    Projected,
    Failed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingCreateConversationResult {
    conversation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    command_id: Option<String>,
    state: MessagingConversationCreationState,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingAttachmentStageProjection {
    stage_id: String,
    filename: String,
    mime_type: String,
    plaintext_size: u64,
    completed: bool,
    max_chunk_bytes: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum MessagingAttachmentOpenResult {
    Ready { local_path: String },
    Pending { next_attempt_at_unix_ms: i64 },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingSubmissionResult {
    submitted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingWakeResult {
    cycle_id: u64,
}

fn message_projection(
    message: ConversationMessageProjection,
    mut availability: impl FnMut(&str) -> Result<Option<String>, String>,
) -> Result<MessagingMessageProjection, String> {
    let attachments = message
        .attachments
        .into_iter()
        .map(|attachment| {
            let object = attachment.object.as_ref();
            Ok(MessagingAttachmentProjection {
                availability_state: availability(&attachment.attachment_id)?,
                attachment_id: attachment.attachment_id,
                filename: attachment.filename,
                mime_type: attachment.mime_type,
                plaintext_size: attachment.plaintext_size,
                object_id: object.map(|value| value.object_id.clone()),
                storage_ref: object.map(|value| value.storage_ref.clone()),
                ciphertext_size: object.map(|value| value.ciphertext_size),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(MessagingMessageProjection {
        event_id: message.event_id,
        event_sequence: message.event_sequence,
        message_id: message.message_id,
        sender_ptid: message.sender_ptid,
        sender_device_id: message.sender_device_id,
        plaintext: message.plaintext,
        attachments,
        state: message.state,
        timestamp_unix_ms: message.timestamp_unix_ms,
        reply_to_message_id: message.reply_to_message_id,
        thread_root_message_id: message.thread_root_message_id,
        edited_text: message.edited_text,
        edited_at_unix_ms: message.edited_at_unix_ms,
        retracted: message.retracted,
        reactions: message
            .reactions
            .into_iter()
            .map(
                |(actor_ptid, reaction, created_at_unix_ms)| MessagingReactionProjection {
                    actor_ptid,
                    reaction,
                    created_at_unix_ms,
                },
            )
            .collect(),
        pinned_by_ptid: message.pinned_by_ptid,
        pinned_at_unix_ms: message.pinned_at_unix_ms,
        read_by_ptids: message.read_by_ptids,
    })
}

fn attachment_stage_projection(
    stage: MessagingAttachmentStage,
) -> MessagingAttachmentStageProjection {
    MessagingAttachmentStageProjection {
        stage_id: stage.stage_id,
        filename: stage.filename,
        mime_type: stage.mime_type,
        plaintext_size: stage.plaintext_size,
        completed: stage.completed,
        max_chunk_bytes: ATTACHMENT_STAGE_CHUNK_SIZE,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingReconcileResult {
    device_enrolled: bool,
    processed: usize,
    cursor: i64,
    lane_head: i64,
    consumer_epoch: u64,
    delivery_receipt_submitted: bool,
    command_state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    command_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_attempt_at_unix_ms: Option<i64>,
}

#[tauri::command]
pub fn messaging_activate<R: Runtime>(
    app: AppHandle<R>,
    runtime: State<'_, MobileMessagingRuntime>,
    storage: State<'_, SecureStorage>,
    input: MessagingActivateInput,
) -> MobileResult<MessagingRuntimeStatus> {
    let data_root = app.path().app_data_dir().map_err(|error| {
        MobileError::messaging(format!("resolve mobile messaging data directory: {error}"))
    })?;
    runtime.activate(
        app,
        &data_root,
        &storage,
        input.station_peer_id,
        input.station_origin,
        input.actor_ptid,
        input.access_token,
    )
}

#[tauri::command]
pub fn messaging_suspend(runtime: State<'_, MobileMessagingRuntime>) -> MobileResult<()> {
    runtime.suspend()
}

#[tauri::command]
pub fn messaging_resume(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingAccountInput,
) -> MobileResult<()> {
    runtime.resume(&input.station_peer_id, &input.actor_ptid)
}

#[tauri::command]
pub fn messaging_wake(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingAccountInput,
) -> MobileResult<MessagingWakeResult> {
    runtime
        .wake(&input.station_peer_id, &input.actor_ptid)
        .map(|cycle_id| MessagingWakeResult { cycle_id })
}

#[tauri::command]
pub fn messaging_status(
    runtime: State<'_, MobileMessagingRuntime>,
) -> MobileResult<MessagingRuntimeStatus> {
    runtime.status()
}

#[tauri::command]
pub async fn social_friend_request_send(
    runtime: State<'_, MobileMessagingRuntime>,
    input: SocialFriendRequestSendInput,
) -> MobileResult<Vec<u8>> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    tauri::async_runtime::spawn_blocking(move || {
        engine
            .send_social_friend_request(
                &input.receiver_ptid,
                &input.receiver_home_station_peer_id,
                &input.federation_id,
                &input.message,
            )
            .map(|response| response.encode_to_vec())
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!("join Social Friend Request send task: {error}"))
    })?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn social_friend_request_accept(
    runtime: State<'_, MobileMessagingRuntime>,
    input: SocialFriendRequestDecisionInput,
) -> MobileResult<Vec<u8>> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    tauri::async_runtime::spawn_blocking(move || {
        engine
            .accept_social_friend_request(
                &input.request_id,
                &input.sender_ptid,
                &input.receiver_ptid,
                &input.sender_home_station_peer_id,
                &input.receiver_home_station_peer_id,
                &input.federation_id,
            )
            .map(|response| response.encode_to_vec())
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!("join Social Friend Request accept task: {error}"))
    })?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn social_friend_request_reject(
    runtime: State<'_, MobileMessagingRuntime>,
    input: SocialFriendRequestDecisionInput,
) -> MobileResult<Vec<u8>> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    tauri::async_runtime::spawn_blocking(move || {
        engine
            .reject_social_friend_request(
                &input.request_id,
                &input.sender_ptid,
                &input.receiver_ptid,
                &input.sender_home_station_peer_id,
                &input.receiver_home_station_peer_id,
                &input.federation_id,
            )
            .map(|response| response.encode_to_vec())
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!("join Social Friend Request reject task: {error}"))
    })?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn messaging_create_direct(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingCreateDirectInput,
) -> MobileResult<MessagingCreateConversationResult> {
    validate_direct_creation_input(&input)?;
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let creation_engine = engine.clone();
    let peer_ptid = input.peer_ptid;
    let federation_id = input.federation_id;
    let creation_federation_id = federation_id.clone();
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        creation_engine.create_direct_conversation(&peer_ptid, &creation_federation_id)
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!("join direct conversation creation task: {error}"))
    })?
    .map_err(MobileError::messaging)?;

    assist_creation_reconcile(&runtime, &input.station_peer_id, &input.actor_ptid).await;
    let projection_ready =
        conversation_projection_ready(&engine, &prepared.conversation_id, &federation_id);
    Ok(MessagingCreateConversationResult {
        conversation_id: prepared.conversation_id,
        command_id: Some(prepared.command_id),
        state: direct_creation_state(projection_ready),
    })
}

#[tauri::command]
pub async fn messaging_create_group(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingCreateGroupInput,
) -> MobileResult<MessagingCreateConversationResult> {
    validate_group_creation_input(&input)?;
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let creation_engine = engine.clone();
    let conversation_id = input.conversation_id;
    let name = input.name;
    let member_ptids = input.member_ptids;
    let federation_id = input.federation_id;
    let creation_federation_id = federation_id.clone();
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        creation_engine.create_group_conversation(
            &conversation_id,
            &name,
            &member_ptids,
            &creation_federation_id,
        )
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!("join group conversation creation task: {error}"))
    })?
    .map_err(MobileError::messaging)?;

    let initial_status = engine
        .command_status(&prepared.command_id)
        .map_err(MobileError::messaging)?
        .ok_or_else(|| {
            MobileError::messaging("mobile messaging group creation was not durably prepared")
        })?;
    assist_creation_reconcile(&runtime, &input.station_peer_id, &input.actor_ptid).await;
    let command_status = engine
        .command_status(&prepared.command_id)
        .map_err(MobileError::messaging)?
        .unwrap_or(initial_status);
    let projection_ready =
        conversation_projection_ready(&engine, &prepared.conversation_id, &federation_id);
    Ok(MessagingCreateConversationResult {
        conversation_id: prepared.conversation_id,
        command_id: Some(prepared.command_id),
        state: group_creation_state(&command_status.state, projection_ready),
    })
}

#[tauri::command]
pub fn messaging_list_conversations(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingAccountInput,
) -> MobileResult<Vec<MessagingConversationProjection>> {
    runtime
        .conversations(&input.station_peer_id, &input.actor_ptid)
        .map(|conversations| {
            conversations
                .into_iter()
                .map(|conversation| MessagingConversationProjection {
                    conversation_id: conversation.conversation_id,
                    authority_station_id: conversation.authority_station_id,
                    federation_id: conversation.federation_id,
                    kind: conversation.kind,
                    name: conversation.name,
                    owner_ptid: conversation.owner_ptid,
                    member_ptids: conversation.member_ptids,
                    membership_epoch: conversation.membership_epoch,
                    mls_epoch: conversation.mls_epoch,
                    active: conversation.active,
                    updated_at_unix_ms: conversation.updated_at_unix_ms,
                })
                .collect()
        })
}

#[tauri::command]
pub fn messaging_list_messages(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingConversationInput,
) -> MobileResult<Vec<MessagingMessageProjection>> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    engine
        .conversation_messages(&input.conversation_id)
        .and_then(|messages| {
            messages
                .into_iter()
                .map(|message| {
                    message_projection(message, |attachment_id| {
                        engine.attachment_availability_state(attachment_id)
                    })
                })
                .collect()
        })
        .map_err(MobileError::messaging)
}

#[tauri::command]
pub fn messaging_list_thread_messages(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingThreadInput,
) -> MobileResult<Vec<MessagingMessageProjection>> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    engine
        .thread_messages(&input.conversation_id, &input.thread_root_message_id)
        .and_then(|messages| {
            messages
                .into_iter()
                .map(|message| {
                    message_projection(message, |attachment_id| {
                        engine.attachment_availability_state(attachment_id)
                    })
                })
                .collect()
        })
        .map_err(MobileError::messaging)
}

#[tauri::command]
pub fn messaging_search_messages(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingSearchInput,
) -> MobileResult<Vec<MessagingMessageProjection>> {
    let before = match (
        input.before_timestamp_unix_ms,
        input.before_message_id.as_deref(),
    ) {
        (None, None) => None,
        (Some(timestamp), Some(message_id)) => Some((timestamp, message_id)),
        _ => {
            return Err(MobileError::invalid_input(
                "mobile messaging search cursor is incomplete",
            ))
        }
    };
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    engine
        .search_messages(&input.conversation_id, &input.query, before, input.limit)
        .and_then(|messages| {
            messages
                .into_iter()
                .map(|message| {
                    message_projection(message, |attachment_id| {
                        engine.attachment_availability_state(attachment_id)
                    })
                })
                .collect()
        })
        .map_err(MobileError::messaging)
}

#[tauri::command]
pub fn messaging_command_status(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingCommandStatusInput,
) -> MobileResult<MessagingCommandStatusProjection> {
    runtime
        .active_engine(&input.station_peer_id, &input.actor_ptid)?
        .command_status(&input.command_id)
        .map_err(MobileError::messaging)?
        .map(|status| MessagingCommandStatusProjection {
            command_id: status.command_id,
            conversation_id: status.conversation_id,
            state: status.state,
            last_error_code: status.last_error_code,
        })
        .ok_or_else(|| MobileError::messaging("mobile messaging command status not found"))
}

#[tauri::command]
pub async fn messaging_attachment_stage_begin(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingAttachmentStageBeginInput,
) -> MobileResult<MessagingAttachmentStageProjection> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    tauri::async_runtime::spawn_blocking(move || {
        engine
            .begin_attachment_stage(&input.filename, &input.mime_type, input.plaintext_size)
            .map(attachment_stage_projection)
    })
    .await
    .map_err(|error| MobileError::messaging(format!("join attachment stage task: {error}")))?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn messaging_attachment_stage_write(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingAttachmentStageWriteInput,
) -> MobileResult<MessagingAttachmentStageProjection> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    tauri::async_runtime::spawn_blocking(move || {
        engine
            .write_attachment_stage(&input.stage_id, input.offset, &input.bytes)
            .map(attachment_stage_projection)
    })
    .await
    .map_err(|error| MobileError::messaging(format!("join attachment write task: {error}")))?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn messaging_attachment_stage_complete(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingAttachmentStageInput,
) -> MobileResult<MessagingAttachmentStageProjection> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    tauri::async_runtime::spawn_blocking(move || {
        engine
            .complete_attachment_stage(&input.stage_id)
            .map(attachment_stage_projection)
    })
    .await
    .map_err(|error| MobileError::messaging(format!("join attachment completion task: {error}")))?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn messaging_attachment_stage_discard(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingAttachmentStageInput,
) -> MobileResult<()> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    tauri::async_runtime::spawn_blocking(move || engine.discard_attachment_stage(&input.stage_id))
        .await
        .map_err(|error| MobileError::messaging(format!("join attachment discard task: {error}")))?
        .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn messaging_send_message(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingSendMessageInput,
) -> MobileResult<MessagingSubmitCommandResult> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let station_peer_id = input.station_peer_id.clone();
    let actor_ptid = input.actor_ptid.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let outcome = engine.submit_message(
            &input.conversation_id,
            &input.plaintext,
            &input.reply_to_message_id,
            &input.thread_root_message_id,
            &input.attachment_stage_ids,
        )?;
        Ok::<_, String>(MessagingSubmitCommandResult {
            command_id: outcome.command_id,
            message_id: Some(outcome.message_id),
            attachment_ids: outcome.attachment_ids,
            state: outcome.state.to_string(),
        })
    })
    .await
    .map_err(|error| MobileError::messaging(format!("join messaging send task: {error}")))?
    .map_err(MobileError::messaging)?;
    wake_after_durable_prepare(&runtime, &station_peer_id, &actor_ptid);
    Ok(result)
}

#[tauri::command]
pub async fn messaging_submit_edit(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingEditInput,
) -> MobileResult<MessagingSubmitCommandResult> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let station_peer_id = input.station_peer_id.clone();
    let actor_ptid = input.actor_ptid.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let command_id =
            engine.submit_edit(&input.conversation_id, &input.message_id, &input.plaintext)?;
        Ok::<_, String>(MessagingSubmitCommandResult {
            command_id: Some(command_id),
            message_id: Some(input.message_id),
            attachment_ids: Vec::new(),
            state: "pending".to_string(),
        })
    })
    .await
    .map_err(|error| MobileError::messaging(format!("join messaging edit task: {error}")))?
    .map_err(MobileError::messaging)?;
    wake_after_durable_prepare(&runtime, &station_peer_id, &actor_ptid);
    Ok(result)
}

#[tauri::command]
pub async fn messaging_submit_metadata_interaction(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingMetadataInteractionInput,
) -> MobileResult<MessagingSubmitCommandResult> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let station_peer_id = input.station_peer_id.clone();
    let actor_ptid = input.actor_ptid.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let interaction = match &input.interaction {
            MessagingMetadataInteraction::Retract => MetadataInteraction::Retract,
            MessagingMetadataInteraction::Reaction { reaction, remove } => {
                MetadataInteraction::Reaction {
                    reaction,
                    remove: *remove,
                }
            }
            MessagingMetadataInteraction::Pin { remove } => {
                MetadataInteraction::Pin { remove: *remove }
            }
        };
        let command_id = engine.submit_metadata_interaction(
            &input.conversation_id,
            &input.message_id,
            interaction,
        )?;
        Ok::<_, String>(MessagingSubmitCommandResult {
            command_id: Some(command_id),
            message_id: Some(input.message_id),
            attachment_ids: Vec::new(),
            state: "pending".to_string(),
        })
    })
    .await
    .map_err(|error| MobileError::messaging(format!("join messaging interaction task: {error}")))?
    .map_err(MobileError::messaging)?;
    wake_after_durable_prepare(&runtime, &station_peer_id, &actor_ptid);
    Ok(result)
}

fn wake_after_durable_prepare(
    runtime: &MobileMessagingRuntime,
    station_peer_id: &str,
    actor_ptid: &str,
) {
    let wake_result = runtime.wake(station_peer_id, actor_ptid);
    // #region debug-point A:attachment-worker-wake
    {
        let debug_error = wake_result.as_ref().err().map(ToString::to_string);
        std::thread::spawn(move || {
            let _ = reqwest::blocking::Client::new().post("http://100.86.255.160:7785/event").header("Content-Type", "application/json").body(serde_json::json!({"sessionId":"mobile-attachment-delivery","runId":"post-fix","hypothesisId":"A","location":"apps/mobile/src-tauri/src/messaging/commands.rs:wake_after_durable_prepare","msg":"[DEBUG] Mobile messaging worker wake requested","data":{"error":debug_error}}).to_string()).send();
        });
    }
    // #endregion
    if let Err(error) = wake_result {
        log::warn!("mobile messaging worker wake failed after durable preparation: {error}");
    }
}

fn validate_direct_creation_input(input: &MessagingCreateDirectInput) -> MobileResult<()> {
    if !input.peer_ptid.starts_with("ptid:")
        || input.peer_ptid == input.actor_ptid
        || input.actor_ptid.trim().is_empty()
        || input.federation_id.trim().is_empty()
    {
        return Err(MobileError::invalid_input(
            "mobile messaging direct identity or federation scope is invalid",
        ));
    }
    Ok(())
}

fn validate_group_creation_input(input: &MessagingCreateGroupInput) -> MobileResult<()> {
    if input.conversation_id.trim().is_empty()
        || input.name.trim().is_empty()
        || input.member_ptids.is_empty()
        || input.federation_id.trim().is_empty()
        || input
            .member_ptids
            .iter()
            .any(|ptid| !ptid.starts_with("ptid:"))
    {
        return Err(MobileError::invalid_input(
            "mobile messaging group creation intent is incomplete",
        ));
    }
    Ok(())
}

async fn assist_creation_reconcile(
    runtime: &MobileMessagingRuntime,
    station_peer_id: &str,
    actor_ptid: &str,
) {
    let (waiter, cycle_id) = match runtime.request_reconcile(station_peer_id, actor_ptid) {
        Ok(reconcile) => reconcile,
        Err(error) => {
            log::warn!(
                "mobile messaging creation reconcile request failed after durable state: {error}"
            );
            return;
        }
    };
    match tauri::async_runtime::spawn_blocking(move || waiter.wait_for_cycle(cycle_id)).await {
        Ok(Ok(_)) => {}
        Ok(Err(error)) => {
            log::warn!("mobile messaging creation reconcile failed after durable state: {error}");
        }
        Err(error) => {
            log::warn!(
                "join mobile messaging creation reconcile task after durable state: {error}"
            );
        }
    }
}

fn conversation_projection_ready(
    engine: &super::engine::MobileMessagingEngine,
    conversation_id: &str,
    federation_id: &str,
) -> bool {
    match engine.conversations() {
        Ok(conversations) => conversations.iter().any(|conversation| {
            conversation.conversation_id == conversation_id
                && conversation.federation_id == federation_id
        }),
        Err(error) => {
            log::warn!(
                "mobile messaging conversation projection read failed after durable state: {error}"
            );
            false
        }
    }
}

fn direct_creation_state(projection_ready: bool) -> MessagingConversationCreationState {
    if projection_ready {
        MessagingConversationCreationState::Projected
    } else {
        MessagingConversationCreationState::Pending
    }
}

fn group_creation_state(
    durable_command_state: &str,
    projection_ready: bool,
) -> MessagingConversationCreationState {
    if projection_ready {
        return MessagingConversationCreationState::Projected;
    }
    if matches!(durable_command_state, "failed" | "superseded") {
        MessagingConversationCreationState::Failed
    } else {
        MessagingConversationCreationState::Pending
    }
}

#[tauri::command]
pub async fn messaging_submit_read_cursor(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingReadCursorInput,
) -> MobileResult<MessagingSubmissionResult> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    tauri::async_runtime::spawn_blocking(move || {
        engine.submit_read_cursor(&input.conversation_id, input.last_read_sequence)?;
        Ok::<_, String>(MessagingSubmissionResult { submitted: true })
    })
    .await
    .map_err(|error| MobileError::messaging(format!("join messaging read task: {error}")))?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn messaging_submit_typing(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingTypingInput,
) -> MobileResult<MessagingSubmissionResult> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    tauri::async_runtime::spawn_blocking(move || {
        engine.submit_typing(&input.conversation_id, input.is_typing)?;
        Ok::<_, String>(MessagingSubmissionResult { submitted: true })
    })
    .await
    .map_err(|error| MobileError::messaging(format!("join messaging typing task: {error}")))?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn messaging_open_attachment(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingAttachmentTransferInput,
) -> MobileResult<MessagingAttachmentOpenResult> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let first_engine = engine.clone();
    let attachment_id = input.attachment_id.clone();
    let first = tauri::async_runtime::spawn_blocking(move || {
        first_engine.prepare_attachment_open(&attachment_id)
    })
    .await
    .map_err(|error| MobileError::messaging(format!("join attachment open task: {error}")))?
    .map_err(MobileError::messaging)?;
    if matches!(first, MessagingAttachmentOpenProgress::Pending { .. }) {
        let (waiter, cycle_id) =
            runtime.request_reconcile(&input.station_peer_id, &input.actor_ptid)?;
        tauri::async_runtime::spawn_blocking(move || waiter.wait_for_cycle(cycle_id))
            .await
            .map_err(|error| {
                MobileError::messaging(format!("join attachment transfer cycle: {error}"))
            })?
            .map_err(MobileError::messaging)?;
    }
    let progress = tauri::async_runtime::spawn_blocking(move || {
        engine.prepare_attachment_open(&input.attachment_id)
    })
    .await
    .map_err(|error| MobileError::messaging(format!("join attachment readback task: {error}")))?
    .map_err(MobileError::messaging)?;
    Ok(match progress {
        MessagingAttachmentOpenProgress::Ready { local_path } => {
            MessagingAttachmentOpenResult::Ready { local_path }
        }
        MessagingAttachmentOpenProgress::Pending {
            next_attempt_at_unix_ms,
        } => MessagingAttachmentOpenResult::Pending {
            next_attempt_at_unix_ms,
        },
    })
}

#[tauri::command]
pub async fn messaging_cancel_attachment(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingAttachmentTransferInput,
) -> MobileResult<()> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    tauri::async_runtime::spawn_blocking(move || {
        engine.cancel_attachment_transfer(&input.attachment_id)
    })
    .await
    .map_err(|error| MobileError::messaging(format!("join attachment cancel task: {error}")))?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn messaging_reconcile(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingAccountInput,
) -> MobileResult<MessagingReconcileResult> {
    let (waiter, cycle_id) =
        runtime.request_reconcile(&input.station_peer_id, &input.actor_ptid)?;
    tauri::async_runtime::spawn_blocking(move || waiter.wait_for_cycle(cycle_id))
        .await
        .map_err(|error| MobileError::messaging(format!("join messaging reconcile task: {error}")))?
        .map_err(MobileError::messaging)
        .map(|result| {
            let (command_state, command_id, next_attempt_at_unix_ms) = match result.command {
                CommandDispatchProgress::Idle => ("idle", None, None),
                CommandDispatchProgress::Submitted { command_id } => {
                    ("submitted", Some(command_id), None)
                }
                CommandDispatchProgress::RetryScheduled {
                    command_id,
                    next_attempt_at_unix_ms,
                } => (
                    "retry_scheduled",
                    Some(command_id),
                    Some(next_attempt_at_unix_ms),
                ),
                CommandDispatchProgress::Failed { command_id, .. } => {
                    ("failed", Some(command_id), None)
                }
                CommandDispatchProgress::StaleDeliveryPlan { command_id, .. } => {
                    ("stale_delivery_plan", Some(command_id), None)
                }
                CommandDispatchProgress::StaleAuthorityPlan { command_id, .. } => {
                    ("stale_authority_plan", Some(command_id), None)
                }
            };
            MessagingReconcileResult {
                device_enrolled: result.device_enrolled,
                processed: result.drain.processed,
                cursor: result.drain.cursor,
                lane_head: result.drain.lane_head,
                consumer_epoch: result.drain.consumer_epoch,
                delivery_receipt_submitted: result.delivery_receipt_submitted,
                command_state,
                command_id,
                next_attempt_at_unix_ms,
            }
        })
}

#[tauri::command]
pub fn messaging_deactivate(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingAccountInput,
) -> MobileResult<MessagingRuntimeStatus> {
    runtime.deactivate(&input.station_peer_id, &input.actor_ptid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use messaging_core::contracts::ConversationMessageProjection;

    #[test]
    fn optional_projection_fields_are_omitted_from_json() {
        let status = serde_json::to_value(MessagingRuntimeStatus::inactive()).unwrap();
        assert!(status.get("profileId").is_none());
        assert!(status.get("stationPeerId").is_none());
        assert!(status.get("stationOrigin").is_none());
        assert!(status.get("actorPtid").is_none());
        assert!(status.get("deviceId").is_none());

        let message = message_projection(
            ConversationMessageProjection {
                event_id: None,
                event_sequence: None,
                message_id: "message-1".to_string(),
                sender_ptid: "ptid:alice".to_string(),
                sender_device_id: "device-1".to_string(),
                plaintext: "hello".to_string(),
                attachments: Vec::new(),
                state: "pending".to_string(),
                timestamp_unix_ms: 1,
                reply_to_message_id: None,
                thread_root_message_id: None,
                edited_text: None,
                edited_at_unix_ms: None,
                retracted: false,
                reactions: Vec::new(),
                pinned_by_ptid: None,
                pinned_at_unix_ms: None,
                read_by_ptids: Vec::new(),
            },
            |_| Ok(None),
        )
        .unwrap();
        let message = serde_json::to_value(message).unwrap();
        for field in [
            "eventId",
            "eventSequence",
            "replyToMessageId",
            "threadRootMessageId",
            "editedText",
            "editedAtUnixMs",
            "pinnedByPtid",
            "pinnedAtUnixMs",
        ] {
            assert!(message.get(field).is_none(), "{field} must be omitted");
        }

        let submission = serde_json::to_value(MessagingSubmitCommandResult {
            command_id: Some("command-1".to_string()),
            message_id: None,
            attachment_ids: Vec::new(),
            state: "pending".to_string(),
        })
        .unwrap();
        assert!(submission.get("messageId").is_none());

        let reconcile = serde_json::to_value(MessagingReconcileResult {
            device_enrolled: true,
            processed: 0,
            cursor: 0,
            lane_head: 0,
            consumer_epoch: 1,
            delivery_receipt_submitted: false,
            command_state: "idle",
            command_id: None,
            next_attempt_at_unix_ms: None,
        })
        .unwrap();
        assert!(reconcile.get("commandId").is_none());
        assert!(reconcile.get("nextAttemptAtUnixMs").is_none());
    }

    #[test]
    fn attachment_availability_is_omitted_when_store_has_no_projection_state() {
        let projection = MessagingAttachmentProjection {
            attachment_id: "attachment-1".to_string(),
            filename: "file.txt".to_string(),
            mime_type: "text/plain".to_string(),
            plaintext_size: 4,
            object_id: None,
            storage_ref: None,
            ciphertext_size: None,
            availability_state: None,
        };
        let value = serde_json::to_value(projection).unwrap();
        for field in [
            "objectId",
            "storageRef",
            "ciphertextSize",
            "availabilityState",
        ] {
            assert!(value.get(field).is_none(), "{field} must be omitted");
        }
    }

    #[test]
    fn conversation_creation_validation_rejects_invalid_identities() {
        assert!(validate_direct_creation_input(&MessagingCreateDirectInput {
            station_peer_id: "station-1".to_string(),
            actor_ptid: "ptid:alice".to_string(),
            peer_ptid: "ptid:alice".to_string(),
            federation_id: "federation-1".to_string(),
        })
        .is_err());
        assert!(validate_direct_creation_input(&MessagingCreateDirectInput {
            station_peer_id: "station-1".to_string(),
            actor_ptid: "ptid:alice".to_string(),
            peer_ptid: "ptid:bob".to_string(),
            federation_id: String::new(),
        })
        .is_err());
        assert!(validate_group_creation_input(&MessagingCreateGroupInput {
            station_peer_id: "station-1".to_string(),
            actor_ptid: "ptid:alice".to_string(),
            conversation_id: "group-1".to_string(),
            name: "Group".to_string(),
            member_ptids: vec![String::new()],
            federation_id: "federation-1".to_string(),
        })
        .is_err());
    }

    #[test]
    fn conversation_creation_state_requires_durable_projection_or_failure() {
        assert_eq!(
            direct_creation_state(false),
            MessagingConversationCreationState::Pending
        );
        assert_eq!(
            direct_creation_state(true),
            MessagingConversationCreationState::Projected
        );
        assert_eq!(
            group_creation_state("prepared", false),
            MessagingConversationCreationState::Pending
        );
        assert_eq!(
            group_creation_state("failed", false),
            MessagingConversationCreationState::Failed
        );
        assert_eq!(
            group_creation_state("superseded", true),
            MessagingConversationCreationState::Projected
        );
    }
}
