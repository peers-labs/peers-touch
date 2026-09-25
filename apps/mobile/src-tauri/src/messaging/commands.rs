use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};

use messaging_core::contracts::ConversationMessageProjection;
use messaging_core::mls::membership_transition::MembershipTransitionIntentInput;
use messaging_core::outbox::{CommandDispatchProgress, MetadataInteraction};
use messaging_core::proto::chat::{MemberRole, MessagingMembershipAction, VoiceNoteMetadata};
use messaging_core::proto::social::SocialRelationshipAction;
use rand::rngs::OsRng;
use rand::RngCore;

use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;
use crate::runtime::command_ledger::entry::{product_state, state_of, ProductCommandState};
#[cfg(feature = "acceptance-harness")]
use crate::runtime::command_ledger::LedgerErrorCode;
use crate::runtime::command_ledger::{CommandLedger, LedgerError};
use crate::runtime::oauth::session::authenticated_native_session;
use crate::runtime::reliability::{
    ActiveReliabilityScope, FriendRequestResolution, FriendRequestResolver,
    PreparedFriendRequestAdmission, PreparedRelationshipAdmission, RelationshipResolution,
    RelationshipResolver, ReliabilityRuntime,
};
#[cfg(feature = "acceptance-harness")]
use crate::runtime::reliability::{FriendRequestResolverTransport, FriendRequestTransportFailure};
use crate::runtime::reliability_proto::peers_touch::model::mobile::v1::MobileDurableCommandState;

use super::engine::{
    MemberAuthorityCommandError, MessagingAttachmentOpenProgress, MessagingAttachmentStage,
    MobileMessagingEngine, PreparedSocialFriendRequestCommand, PreparedSocialRelationshipCommand,
    ProjectedMemberAuthority, ATTACHMENT_STAGE_CHUNK_SIZE,
};
use super::lifecycle::{MessagingRuntimeStatus, MobileMessagingRuntime};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingActivateInput {
    station_peer_id: String,
    actor_ptid: String,
    session_id: String,
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
    #[serde(default)]
    voice_note: Option<MessagingVoiceNoteInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingVoiceNoteInput {
    duration_ms: u32,
    codec: String,
    #[serde(default)]
    waveform: Vec<u32>,
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
#[serde(rename_all = "camelCase")]
pub struct MessagingForwardInput {
    station_peer_id: String,
    actor_ptid: String,
    source_conversation_id: String,
    source_message_id: String,
    destination_conversation_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum MessagingMetadataInteraction {
    Retract,
    HideForActor,
    Moderate { reason_code: String },
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
pub struct MessagingCallSignalSealInput {
    station_peer_id: String,
    actor_ptid: String,
    peer_ptid: String,
    session_ulid: String,
    kind: String,
    plaintext: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingCallSignalOpenInput {
    station_peer_id: String,
    actor_ptid: String,
    peer_ptid: String,
    session_ulid: String,
    kind: String,
    payload: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingCallSignalSealResult {
    payload_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingCallSignalOpenResult {
    plaintext: String,
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
pub struct MessagingMembershipTransitionInput {
    station_peer_id: String,
    actor_ptid: String,
    conversation_id: String,
    action: String,
    target_ptid: String,
    #[serde(default)]
    target_device_id: String,
    #[serde(default)]
    role: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingUpdateConversationInput {
    station_peer_id: String,
    actor_ptid: String,
    conversation_id: String,
    name: Option<String>,
    description: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingUpdateMemberAuthorityInput {
    station_peer_id: String,
    actor_ptid: String,
    conversation_id: String,
    target_ptid: String,
    role: Option<String>,
    muted: Option<bool>,
    muted_until_unix_ms: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingTransferOwnershipInput {
    station_peer_id: String,
    actor_ptid: String,
    conversation_id: String,
    next_owner_ptid: String,
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
pub struct SocialFriendRequestCommandProjection {
    command_id: String,
    request_id: String,
    payload_sha256: Vec<u8>,
    state: &'static str,
    response_bytes: Option<Vec<u8>>,
    checkpoint_ready: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialRelationshipMutationInput {
    station_peer_id: String,
    actor_ptid: String,
    target_ptid: String,
    target_home_station_peer_id: String,
    observed_revision: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialRelationshipCommandProjection {
    command_id: String,
    target_ptid: String,
    payload_sha256: Vec<u8>,
    state: &'static str,
    response_bytes: Option<Vec<u8>>,
    checkpoint_ready: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingConversationProjection {
    conversation_id: String,
    authority_station_id: String,
    federation_id: String,
    kind: i32,
    name: String,
    description: String,
    owner_ptid: String,
    member_ptids: Vec<String>,
    members: Vec<MessagingMemberAuthorityMemberProjection>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    voice_note: Option<MessagingVoiceNoteProjection>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingVoiceNoteProjection {
    duration_ms: u32,
    codec: String,
    waveform: Vec<u32>,
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
    moderated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    moderation_reason_code: Option<String>,
    reactions: Vec<MessagingReactionProjection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pinned_by_ptid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pinned_at_unix_ms: Option<i64>,
    read_by_ptids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingConversationSummary {
    last_message: Option<MessagingMessageProjection>,
    unread_count: u64,
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
pub struct MessagingPendingConversationCommandResult {
    command_id: String,
    state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingMemberAuthorityMemberProjection {
    ptid: String,
    role: i32,
    home_station_peer_id: String,
    muted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    muted_until_unix_ms: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingMemberAuthorityResult {
    command_id: String,
    conversation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_ptid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    members: Option<Vec<MessagingMemberAuthorityMemberProjection>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    authority_sequence: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    authority_hash: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    membership_epoch: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mls_epoch: Option<i64>,
    state: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingLeaveIntentSubmissionResult {
    intent_id: String,
    state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingAttachmentStageProjection {
    stage_id: String,
    filename: String,
    mime_type: String,
    plaintext_size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    voice_note: Option<MessagingVoiceNoteProjection>,
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
                voice_note: attachment
                    .voice_note
                    .map(|voice_note| MessagingVoiceNoteProjection {
                        duration_ms: voice_note.duration_ms,
                        codec: voice_note.codec,
                        waveform: voice_note.waveform,
                    }),
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
        moderated: message.moderated,
        moderation_reason_code: message.moderation_reason_code,
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
        voice_note: stage
            .voice_note
            .map(|voice_note| MessagingVoiceNoteProjection {
                duration_ms: voice_note.duration_ms,
                codec: voice_note.codec,
                waveform: voice_note.waveform,
            }),
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
    let session = authenticated_native_session(
        &storage,
        &input.station_peer_id,
        &input.actor_ptid,
        &input.session_id,
    )?;
    let data_root = app.path().app_data_dir().map_err(|error| {
        MobileError::messaging(format!("resolve mobile messaging data directory: {error}"))
    })?;
    runtime.activate(
        app,
        &data_root,
        &storage,
        session.station_peer_id().to_string(),
        session.station_origin().to_string(),
        session.actor_ptid().to_string(),
        session.device_id().to_string(),
        session.access_token().to_string(),
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
pub async fn messaging_call_signal_seal(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingCallSignalSealInput,
) -> MobileResult<MessagingCallSignalSealResult> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    tauri::async_runtime::spawn_blocking(move || {
        engine
            .seal_call_signal(
                &input.peer_ptid,
                &input.session_ulid,
                &input.kind,
                &input.plaintext,
            )
            .map(|payload_base64| MessagingCallSignalSealResult { payload_base64 })
    })
    .await
    .map_err(|error| MobileError::messaging(format!("join signaling seal task: {error}")))?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn messaging_call_signal_open(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingCallSignalOpenInput,
) -> MobileResult<MessagingCallSignalOpenResult> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    tauri::async_runtime::spawn_blocking(move || {
        engine
            .open_call_signal(
                &input.peer_ptid,
                &input.session_ulid,
                &input.kind,
                &input.payload,
            )
            .map(|plaintext| MessagingCallSignalOpenResult { plaintext })
    })
    .await
    .map_err(|error| MobileError::messaging(format!("join signaling open task: {error}")))?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn social_friend_request_send(
    messaging: State<'_, MobileMessagingRuntime>,
    reliability: State<'_, ReliabilityRuntime>,
    input: SocialFriendRequestSendInput,
) -> MobileResult<SocialFriendRequestCommandProjection> {
    let engine = messaging.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let active = reliability
        .active_for_admission(&input.station_peer_id, &input.actor_ptid)
        .map_err(|error| MobileError::reliability(error.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = engine.prepare_send_social_friend_request(
            &input.receiver_ptid,
            &input.receiver_home_station_peer_id,
            &input.federation_id,
            &input.message,
        )?;
        submit_prepared_friend_request(active.as_ref(), engine.as_ref(), prepared)
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!("join Social Friend Request send task: {error}"))
    })?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn social_friend_request_accept(
    messaging: State<'_, MobileMessagingRuntime>,
    reliability: State<'_, ReliabilityRuntime>,
    input: SocialFriendRequestDecisionInput,
) -> MobileResult<SocialFriendRequestCommandProjection> {
    let engine = messaging.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let active = reliability
        .active_for_admission(&input.station_peer_id, &input.actor_ptid)
        .map_err(|error| MobileError::reliability(error.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = engine.prepare_accept_social_friend_request(
            &input.request_id,
            &input.sender_ptid,
            &input.receiver_ptid,
            &input.sender_home_station_peer_id,
            &input.receiver_home_station_peer_id,
            &input.federation_id,
        )?;
        submit_prepared_friend_request(active.as_ref(), engine.as_ref(), prepared)
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!("join Social Friend Request accept task: {error}"))
    })?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn social_friend_request_reject(
    messaging: State<'_, MobileMessagingRuntime>,
    reliability: State<'_, ReliabilityRuntime>,
    input: SocialFriendRequestDecisionInput,
) -> MobileResult<SocialFriendRequestCommandProjection> {
    let engine = messaging.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let active = reliability
        .active_for_admission(&input.station_peer_id, &input.actor_ptid)
        .map_err(|error| MobileError::reliability(error.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = engine.prepare_reject_social_friend_request(
            &input.request_id,
            &input.sender_ptid,
            &input.receiver_ptid,
            &input.sender_home_station_peer_id,
            &input.receiver_home_station_peer_id,
            &input.federation_id,
        )?;
        submit_prepared_friend_request(active.as_ref(), engine.as_ref(), prepared)
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!("join Social Friend Request reject task: {error}"))
    })?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn social_friend_request_reconcile(
    messaging: State<'_, MobileMessagingRuntime>,
    reliability: State<'_, ReliabilityRuntime>,
    input: MessagingAccountInput,
) -> MobileResult<Vec<SocialFriendRequestCommandProjection>> {
    let engine = messaging.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let active = reliability
        .active_for_scope(&input.station_peer_id, &input.actor_ptid)
        .map_err(|error| MobileError::reliability(error.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || {
        reconcile_friend_requests(
            &active.ledger,
            engine.as_ref(),
            active.runtime_generation(),
            crate::commands::ledger::now_unix_ms().map_err(|error| error.to_string())?,
            OsRng.next_u64(),
        )
        .map(|resolutions| {
            resolutions
                .into_iter()
                .map(|resolution| friend_request_projection(String::new(), resolution))
                .collect()
        })
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!(
            "join Social Friend Request reconcile task: {error}"
        ))
    })?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn social_relationship_block(
    messaging: State<'_, MobileMessagingRuntime>,
    reliability: State<'_, ReliabilityRuntime>,
    input: SocialRelationshipMutationInput,
) -> MobileResult<SocialRelationshipCommandProjection> {
    submit_social_relationship_command(
        messaging,
        reliability,
        input,
        SocialRelationshipAction::Block,
    )
    .await
}

#[tauri::command]
pub async fn social_relationship_unblock(
    messaging: State<'_, MobileMessagingRuntime>,
    reliability: State<'_, ReliabilityRuntime>,
    input: SocialRelationshipMutationInput,
) -> MobileResult<SocialRelationshipCommandProjection> {
    submit_social_relationship_command(
        messaging,
        reliability,
        input,
        SocialRelationshipAction::Unblock,
    )
    .await
}

async fn submit_social_relationship_command(
    messaging: State<'_, MobileMessagingRuntime>,
    reliability: State<'_, ReliabilityRuntime>,
    input: SocialRelationshipMutationInput,
    action: SocialRelationshipAction,
) -> MobileResult<SocialRelationshipCommandProjection> {
    let engine = messaging.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let active = reliability
        .active_for_admission(&input.station_peer_id, &input.actor_ptid)
        .map_err(|error| MobileError::reliability(error.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = engine.prepare_social_relationship_command(
            action,
            &input.target_ptid,
            &input.target_home_station_peer_id,
            input.observed_revision,
        )?;
        submit_prepared_relationship(active.as_ref(), engine.as_ref(), prepared)
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!("join Social relationship command task: {error}"))
    })?
    .map_err(MobileError::messaging)
}

#[tauri::command]
pub async fn social_relationship_reconcile(
    messaging: State<'_, MobileMessagingRuntime>,
    reliability: State<'_, ReliabilityRuntime>,
    input: MessagingAccountInput,
) -> MobileResult<Vec<SocialRelationshipCommandProjection>> {
    let engine = messaging.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let active = reliability
        .active_for_scope(&input.station_peer_id, &input.actor_ptid)
        .map_err(|error| MobileError::reliability(error.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || {
        reconcile_relationships(
            &active.ledger,
            engine.as_ref(),
            active.runtime_generation(),
            crate::commands::ledger::now_unix_ms().map_err(|error| error.to_string())?,
            OsRng.next_u64(),
        )
        .map(|resolutions| {
            resolutions
                .into_iter()
                .map(|resolution| relationship_projection(String::new(), resolution))
                .collect()
        })
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!("join Social relationship reconcile task: {error}"))
    })?
    .map_err(MobileError::messaging)
}

fn submit_prepared_friend_request(
    active: &ActiveReliabilityScope,
    engine: &MobileMessagingEngine,
    prepared: PreparedSocialFriendRequestCommand,
) -> Result<SocialFriendRequestCommandProjection, String> {
    let command_id = prepared.command_id.clone();
    let request_id = prepared.request_id.clone();
    let payload_sha256 = prepared.payload_sha256.clone();
    let runtime_generation = active.runtime_generation();
    FriendRequestResolver::admit(
        &active.ledger,
        &active.scope,
        runtime_generation,
        PreparedFriendRequestAdmission {
            command_id: command_id.clone(),
            ordering_key: prepared.ordering_key,
            payload_sha256: payload_sha256.clone(),
            exact_payload_bytes: prepared.command_bytes,
        },
    )
    .map_err(|error| error.to_string())?;

    #[cfg(feature = "acceptance-harness")]
    if crate::runtime::reliability::acceptance::hold_before_dispatch()
        .map_err(|error| error.to_string())?
    {
        return pending_friend_request_resolution(active, &command_id, &payload_sha256)
            .map(|resolution| friend_request_projection(request_id, resolution));
    }

    let resolution = resolve_friend_request(
        &active.ledger,
        engine,
        runtime_generation,
        crate::commands::ledger::now_unix_ms().map_err(|error| error.to_string())?,
        OsRng.next_u64(),
    )
    .map_err(|error| error.to_string())?;
    let resolution = match resolution {
        Some(resolution) if resolution.command_id == command_id => resolution,
        _ => pending_friend_request_resolution(active, &command_id, &payload_sha256)?,
    };
    Ok(friend_request_projection(request_id, resolution))
}

fn submit_prepared_relationship(
    active: &ActiveReliabilityScope,
    engine: &MobileMessagingEngine,
    prepared: PreparedSocialRelationshipCommand,
) -> Result<SocialRelationshipCommandProjection, String> {
    let command_id = prepared.command_id.clone();
    let target_ptid = prepared.target_ptid.clone();
    let payload_sha256 = prepared.payload_sha256.clone();
    let runtime_generation = active.runtime_generation();
    RelationshipResolver::admit(
        &active.ledger,
        &active.scope,
        runtime_generation,
        PreparedRelationshipAdmission {
            command_id: command_id.clone(),
            ordering_key: prepared.ordering_key,
            payload_sha256: payload_sha256.clone(),
            exact_payload_bytes: prepared.command_bytes,
        },
    )
    .map_err(|error| error.to_string())?;

    #[cfg(feature = "acceptance-harness")]
    if crate::runtime::reliability::acceptance::hold_before_dispatch()
        .map_err(|error| error.to_string())?
    {
        return pending_relationship_resolution(active, &command_id, &payload_sha256)
            .map(|resolution| relationship_projection(target_ptid, resolution));
    }

    let resolution = resolve_relationship(
        &active.ledger,
        engine,
        runtime_generation,
        crate::commands::ledger::now_unix_ms().map_err(|error| error.to_string())?,
        OsRng.next_u64(),
    )
    .map_err(|error| error.to_string())?;
    let resolution = match resolution {
        Some(resolution) if resolution.command_id == command_id => resolution,
        _ => pending_relationship_resolution(active, &command_id, &payload_sha256)?,
    };
    Ok(relationship_projection(target_ptid, resolution))
}

#[cfg(not(feature = "acceptance-harness"))]
fn resolve_relationship(
    ledger: &CommandLedger,
    engine: &MobileMessagingEngine,
    runtime_generation: u64,
    now_ms: i64,
    retry_entropy: u64,
) -> Result<Option<RelationshipResolution>, LedgerError> {
    RelationshipResolver::resolve_next(ledger, engine, runtime_generation, now_ms, retry_entropy)
}

#[cfg(feature = "acceptance-harness")]
fn resolve_relationship(
    ledger: &CommandLedger,
    engine: &MobileMessagingEngine,
    runtime_generation: u64,
    now_ms: i64,
    retry_entropy: u64,
) -> Result<Option<RelationshipResolution>, LedgerError> {
    let lose_response =
        crate::runtime::reliability::acceptance::lose_dispatch_response_and_readback()
            .map_err(acceptance_fault_error)?;
    RelationshipResolver::resolve_next(
        ledger,
        &AcceptanceRelationshipTransport {
            engine,
            lose_response,
        },
        runtime_generation,
        now_ms,
        retry_entropy,
    )
}

#[cfg(not(feature = "acceptance-harness"))]
fn reconcile_relationships(
    ledger: &CommandLedger,
    engine: &MobileMessagingEngine,
    runtime_generation: u64,
    now_ms: i64,
    retry_entropy: u64,
) -> Result<Vec<RelationshipResolution>, LedgerError> {
    RelationshipResolver::reconcile_existing(
        ledger,
        engine,
        runtime_generation,
        now_ms,
        retry_entropy,
    )
}

#[cfg(feature = "acceptance-harness")]
fn reconcile_relationships(
    ledger: &CommandLedger,
    engine: &MobileMessagingEngine,
    runtime_generation: u64,
    now_ms: i64,
    retry_entropy: u64,
) -> Result<Vec<RelationshipResolution>, LedgerError> {
    if crate::runtime::reliability::acceptance::hold_before_dispatch()
        .map_err(acceptance_fault_error)?
    {
        return Ok(Vec::new());
    }
    let lose_response =
        crate::runtime::reliability::acceptance::lose_dispatch_response_and_readback()
            .map_err(acceptance_fault_error)?;
    RelationshipResolver::reconcile_existing(
        ledger,
        &AcceptanceRelationshipTransport {
            engine,
            lose_response,
        },
        runtime_generation,
        now_ms,
        retry_entropy,
    )
}

#[cfg(not(feature = "acceptance-harness"))]
fn resolve_friend_request(
    ledger: &CommandLedger,
    engine: &MobileMessagingEngine,
    runtime_generation: u64,
    now_ms: i64,
    retry_entropy: u64,
) -> Result<Option<FriendRequestResolution>, LedgerError> {
    FriendRequestResolver::resolve_next(ledger, engine, runtime_generation, now_ms, retry_entropy)
}

#[cfg(feature = "acceptance-harness")]
fn resolve_friend_request(
    ledger: &CommandLedger,
    engine: &MobileMessagingEngine,
    runtime_generation: u64,
    now_ms: i64,
    retry_entropy: u64,
) -> Result<Option<FriendRequestResolution>, LedgerError> {
    let lose_response =
        crate::runtime::reliability::acceptance::lose_dispatch_response_and_readback()
            .map_err(acceptance_fault_error)?;
    FriendRequestResolver::resolve_next(
        ledger,
        &AcceptanceFriendRequestTransport {
            engine,
            lose_response,
        },
        runtime_generation,
        now_ms,
        retry_entropy,
    )
}

#[cfg(not(feature = "acceptance-harness"))]
fn reconcile_friend_requests(
    ledger: &CommandLedger,
    engine: &MobileMessagingEngine,
    runtime_generation: u64,
    now_ms: i64,
    retry_entropy: u64,
) -> Result<Vec<FriendRequestResolution>, LedgerError> {
    FriendRequestResolver::reconcile_existing(
        ledger,
        engine,
        runtime_generation,
        now_ms,
        retry_entropy,
    )
}

#[cfg(feature = "acceptance-harness")]
fn reconcile_friend_requests(
    ledger: &CommandLedger,
    engine: &MobileMessagingEngine,
    runtime_generation: u64,
    now_ms: i64,
    retry_entropy: u64,
) -> Result<Vec<FriendRequestResolution>, LedgerError> {
    if crate::runtime::reliability::acceptance::hold_before_dispatch()
        .map_err(acceptance_fault_error)?
    {
        return Ok(Vec::new());
    }
    let lose_response =
        crate::runtime::reliability::acceptance::lose_dispatch_response_and_readback()
            .map_err(acceptance_fault_error)?;
    FriendRequestResolver::reconcile_existing(
        ledger,
        &AcceptanceFriendRequestTransport {
            engine,
            lose_response,
        },
        runtime_generation,
        now_ms,
        retry_entropy,
    )
}

#[cfg(feature = "acceptance-harness")]
struct AcceptanceFriendRequestTransport<'a> {
    engine: &'a MobileMessagingEngine,
    lose_response: bool,
}

#[cfg(feature = "acceptance-harness")]
impl FriendRequestResolverTransport for AcceptanceFriendRequestTransport<'_> {
    fn dispatch(
        &self,
        exact_payload_bytes: &[u8],
    ) -> Result<Vec<u8>, FriendRequestTransportFailure> {
        let result = self.engine.dispatch(exact_payload_bytes);
        if self.lose_response && result.is_ok() {
            return Err(FriendRequestTransportFailure::Transport);
        }
        result
    }

    fn lookup(
        &self,
        command_id: &str,
        payload_sha256: &[u8],
    ) -> Result<Vec<u8>, FriendRequestTransportFailure> {
        if self.lose_response {
            return Err(FriendRequestTransportFailure::Transport);
        }
        self.engine.lookup(command_id, payload_sha256)
    }
}

#[cfg(feature = "acceptance-harness")]
struct AcceptanceRelationshipTransport<'a> {
    engine: &'a MobileMessagingEngine,
    lose_response: bool,
}

#[cfg(feature = "acceptance-harness")]
impl crate::runtime::reliability::RelationshipResolverTransport
    for AcceptanceRelationshipTransport<'_>
{
    fn dispatch(
        &self,
        exact_payload_bytes: &[u8],
    ) -> Result<Vec<u8>, crate::runtime::reliability::RelationshipTransportFailure> {
        let result = crate::runtime::reliability::RelationshipResolverTransport::dispatch(
            self.engine,
            exact_payload_bytes,
        );
        if self.lose_response && result.is_ok() {
            return Err(crate::runtime::reliability::RelationshipTransportFailure::Transport);
        }
        result
    }

    fn lookup(
        &self,
        command_id: &str,
        payload_sha256: &[u8],
    ) -> Result<Vec<u8>, crate::runtime::reliability::RelationshipTransportFailure> {
        if self.lose_response {
            return Err(crate::runtime::reliability::RelationshipTransportFailure::Transport);
        }
        crate::runtime::reliability::RelationshipResolverTransport::lookup(
            self.engine,
            command_id,
            payload_sha256,
        )
    }
}

#[cfg(feature = "acceptance-harness")]
fn acceptance_fault_error(error: crate::runtime::reliability::ReliabilityError) -> LedgerError {
    LedgerError::new(
        LedgerErrorCode::Storage,
        "read reliability Acceptance fault",
        error.to_string(),
    )
}

fn pending_friend_request_resolution(
    active: &ActiveReliabilityScope,
    command_id: &str,
    payload_sha256: &[u8],
) -> Result<FriendRequestResolution, String> {
    let envelope = active
        .ledger
        .get(command_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "admitted Friend Request command disappeared".to_string())?;
    Ok(FriendRequestResolution {
        command_id: command_id.to_string(),
        payload_sha256: payload_sha256.to_vec(),
        state: state_of(&envelope).map_err(|error| error.to_string())?,
        dispatch_response_bytes: None,
        projection_checkpoint: None,
    })
}

fn pending_relationship_resolution(
    active: &ActiveReliabilityScope,
    command_id: &str,
    payload_sha256: &[u8],
) -> Result<RelationshipResolution, String> {
    let envelope = active
        .ledger
        .get(command_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "admitted Social relationship command disappeared".to_string())?;
    Ok(RelationshipResolution {
        command_id: command_id.to_string(),
        payload_sha256: payload_sha256.to_vec(),
        state: state_of(&envelope).map_err(|error| error.to_string())?,
        dispatch_response_bytes: None,
        projection_checkpoint: None,
    })
}

fn friend_request_projection(
    request_id: String,
    resolution: FriendRequestResolution,
) -> SocialFriendRequestCommandProjection {
    SocialFriendRequestCommandProjection {
        command_id: resolution.command_id,
        request_id,
        payload_sha256: resolution.payload_sha256,
        state: durable_command_state_name(resolution.state),
        response_bytes: resolution.dispatch_response_bytes,
        checkpoint_ready: resolution.projection_checkpoint.is_some(),
    }
}

fn relationship_projection(
    target_ptid: String,
    resolution: RelationshipResolution,
) -> SocialRelationshipCommandProjection {
    SocialRelationshipCommandProjection {
        command_id: resolution.command_id,
        target_ptid,
        payload_sha256: resolution.payload_sha256,
        state: durable_command_state_name(resolution.state),
        response_bytes: resolution.dispatch_response_bytes,
        checkpoint_ready: resolution.projection_checkpoint.is_some(),
    }
}

fn durable_command_state_name(state: MobileDurableCommandState) -> &'static str {
    if state == MobileDurableCommandState::Unspecified {
        return "invalid";
    }
    match product_state(state) {
        ProductCommandState::Pending => "pending",
        ProductCommandState::FailedRetryable => "failed-retryable",
        ProductCommandState::Committed => "committed",
        ProductCommandState::FailedTerminal => "failed-terminal",
        ProductCommandState::UnknownOutcome => "unknown-outcome",
        ProductCommandState::Reconciling => "reconciling",
        ProductCommandState::Cancelled => "cancelled",
    }
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
pub async fn messaging_submit_leave_intent(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingConversationInput,
) -> MobileResult<MessagingLeaveIntentSubmissionResult> {
    if input.conversation_id.trim().is_empty() {
        return Err(MobileError::invalid_input(
            "mobile messaging self-leave requires conversation ID",
        ));
    }
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let intent = tauri::async_runtime::spawn_blocking(move || {
        engine.submit_mls_leave_intent(&input.conversation_id)
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!("join messaging self-leave intent task: {error}"))
    })?
    .map_err(MobileError::messaging)?;
    Ok(MessagingLeaveIntentSubmissionResult {
        intent_id: intent.intent_id,
        state: "pending".to_string(),
    })
}

#[tauri::command]
pub async fn messaging_membership_transition(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingMembershipTransitionInput,
) -> MobileResult<MessagingPendingConversationCommandResult> {
    if input.conversation_id.trim().is_empty() || !input.target_ptid.starts_with("ptid:") {
        return Err(MobileError::invalid_input(
            "mobile messaging membership target is invalid",
        ));
    }
    let action = membership_transition_action(&input.action)?;
    if matches!(
        action,
        MessagingMembershipAction::AddDevice | MessagingMembershipAction::RemoveDevice
    ) && input.target_device_id.trim().is_empty()
    {
        return Err(MobileError::invalid_input(
            "mobile messaging membership device target is required",
        ));
    }

    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let station_peer_id = input.station_peer_id.clone();
    let actor_ptid = input.actor_ptid.clone();
    let command = tauri::async_runtime::spawn_blocking(move || {
        engine.prepare_membership_transition(&MembershipTransitionIntentInput {
            conversation_id: input.conversation_id,
            action,
            target_ptid: input.target_ptid,
            target_device_id: input.target_device_id,
            role: input.role,
            leave_intent: None,
        })
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!(
            "join messaging membership transition task: {error}"
        ))
    })?
    .map_err(MobileError::messaging)?;
    wake_after_durable_prepare(&runtime, &station_peer_id, &actor_ptid);
    assist_creation_reconcile(&runtime, &station_peer_id, &actor_ptid).await;
    Ok(MessagingPendingConversationCommandResult {
        command_id: command.command_id,
        state: "pending".to_string(),
    })
}

#[tauri::command]
pub async fn messaging_update_conversation(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingUpdateConversationInput,
) -> MobileResult<MessagingPendingConversationCommandResult> {
    if input.conversation_id.trim().is_empty()
        || (input.name.is_none() && input.description.is_none())
        || input
            .name
            .as_ref()
            .is_some_and(|name| name.trim().is_empty())
    {
        return Err(MobileError::invalid_input(
            "mobile messaging Conversation update is invalid",
        ));
    }
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let station_peer_id = input.station_peer_id.clone();
    let actor_ptid = input.actor_ptid.clone();
    let command = tauri::async_runtime::spawn_blocking(move || {
        engine.update_conversation(&input.conversation_id, input.name, input.description)
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!("join messaging Conversation update task: {error}"))
    })?
    .map_err(MobileError::messaging)?;
    wake_after_durable_prepare(&runtime, &station_peer_id, &actor_ptid);
    assist_creation_reconcile(&runtime, &station_peer_id, &actor_ptid).await;
    Ok(MessagingPendingConversationCommandResult {
        command_id: command.command_id,
        state: "pending".to_string(),
    })
}

#[tauri::command]
pub async fn messaging_dissolve_conversation(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingConversationInput,
) -> MobileResult<MessagingPendingConversationCommandResult> {
    if input.conversation_id.trim().is_empty() {
        return Err(MobileError::invalid_input(
            "mobile messaging Conversation dissolve requires conversation ID",
        ));
    }
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let station_peer_id = input.station_peer_id.clone();
    let actor_ptid = input.actor_ptid.clone();
    let command = tauri::async_runtime::spawn_blocking(move || {
        engine.dissolve_conversation(&input.conversation_id)
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!(
            "join messaging Conversation dissolve task: {error}"
        ))
    })?
    .map_err(MobileError::messaging)?;
    wake_after_durable_prepare(&runtime, &station_peer_id, &actor_ptid);
    assist_creation_reconcile(&runtime, &station_peer_id, &actor_ptid).await;
    Ok(MessagingPendingConversationCommandResult {
        command_id: command.command_id,
        state: "pending".to_string(),
    })
}

#[tauri::command]
pub async fn messaging_update_member_authority(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingUpdateMemberAuthorityInput,
) -> MobileResult<MessagingMemberAuthorityResult> {
    if input.conversation_id.trim().is_empty() || !input.target_ptid.starts_with("ptid:") {
        return Err(MobileError::invalid_input(
            "mobile member-authority target is invalid",
        ));
    }
    let role = input
        .role
        .as_deref()
        .map(member_authority_role)
        .transpose()?;
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let station_peer_id = input.station_peer_id.clone();
    let actor_ptid = input.actor_ptid.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        engine.update_member_authority(
            &input.conversation_id,
            &input.target_ptid,
            role,
            input.muted,
            input.muted_until_unix_ms,
        )
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!("join mobile member-authority update task: {error}"))
    })?
    .map_err(member_authority_error)?;
    wake_after_durable_prepare(&runtime, &station_peer_id, &actor_ptid);
    Ok(member_authority_result(result))
}

#[tauri::command]
pub async fn messaging_transfer_ownership(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingTransferOwnershipInput,
) -> MobileResult<MessagingMemberAuthorityResult> {
    if input.conversation_id.trim().is_empty() || !input.next_owner_ptid.starts_with("ptid:") {
        return Err(MobileError::invalid_input(
            "mobile ownership-transfer target is invalid",
        ));
    }
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let station_peer_id = input.station_peer_id.clone();
    let actor_ptid = input.actor_ptid.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        engine.transfer_ownership(&input.conversation_id, &input.next_owner_ptid)
    })
    .await
    .map_err(|error| {
        MobileError::messaging(format!("join mobile ownership-transfer task: {error}"))
    })?
    .map_err(member_authority_error)?;
    wake_after_durable_prepare(&runtime, &station_peer_id, &actor_ptid);
    Ok(member_authority_result(result))
}

fn membership_transition_action(action: &str) -> MobileResult<MessagingMembershipAction> {
    match action {
        "add_actor" => Ok(MessagingMembershipAction::AddActor),
        "remove_actor" => Ok(MessagingMembershipAction::RemoveActor),
        "add_device" => Ok(MessagingMembershipAction::AddDevice),
        "remove_device" => Ok(MessagingMembershipAction::RemoveDevice),
        _ => Err(MobileError::invalid_input(
            "mobile messaging membership action is unsupported",
        )),
    }
}

fn member_authority_role(role: &str) -> MobileResult<MemberRole> {
    match role {
        "member" => Ok(MemberRole::Member),
        "admin" => Ok(MemberRole::Admin),
        _ => Err(MobileError::invalid_input(
            "mobile member-authority role must be member or admin",
        )),
    }
}

fn member_authority_result(result: ProjectedMemberAuthority) -> MessagingMemberAuthorityResult {
    let projection = result.projection;
    MessagingMemberAuthorityResult {
        command_id: result.command_id,
        conversation_id: result.conversation_id,
        owner_ptid: projection
            .as_ref()
            .map(|projection| projection.conversation.owner_ptid.clone()),
        members: projection.as_ref().map(|projection| {
            projection
                .conversation
                .members
                .iter()
                .cloned()
                .map(|member| MessagingMemberAuthorityMemberProjection {
                    ptid: member.ptid,
                    role: member.role,
                    home_station_peer_id: member.home_station_peer_id,
                    muted: member.muted,
                    muted_until_unix_ms: member.muted_until_unix_ms,
                })
                .collect()
        }),
        authority_sequence: projection
            .as_ref()
            .map(|projection| projection.authority_sequence),
        authority_hash: projection
            .as_ref()
            .map(|projection| projection.authority_hash.clone()),
        membership_epoch: projection
            .as_ref()
            .map(|projection| projection.conversation.membership_epoch),
        mls_epoch: projection
            .as_ref()
            .map(|projection| projection.conversation.mls_epoch),
        state: result.state,
    }
}

fn member_authority_error(error: MemberAuthorityCommandError) -> MobileError {
    let code = match error.code.as_str() {
        "CONVERSATION_UNAUTHORIZED" => "CONVERSATION_UNAUTHORIZED",
        "CONVERSATION_TARGET_NOT_MEMBER" => "CONVERSATION_TARGET_NOT_MEMBER",
        "CONVERSATION_OWNER_PROTECTED" => "CONVERSATION_OWNER_PROTECTED",
        "CONVERSATION_COMMAND_EXPIRED" => "CONVERSATION_COMMAND_EXPIRED",
        "CONVERSATION_MEMBER_MUTED" => "CONVERSATION_MEMBER_MUTED",
        "CONVERSATION_INACTIVE" => "CONVERSATION_INACTIVE",
        "CONVERSATION_READ_ONLY" => "CONVERSATION_READ_ONLY",
        "CONVERSATION_MEMBERSHIP_CONFLICT" => "CONVERSATION_MEMBERSHIP_CONFLICT",
        "CONVERSATION_STALE_AUTHORITY_HEAD" => "CONVERSATION_STALE_AUTHORITY_HEAD",
        "CONVERSATION_STALE_MEMBERSHIP_EPOCH" => "CONVERSATION_STALE_MEMBERSHIP_EPOCH",
        "CONVERSATION_STALE_MLS_EPOCH" => "CONVERSATION_STALE_MLS_EPOCH",
        "CONVERSATION_COMMAND_CONFLICT" => "CONVERSATION_COMMAND_CONFLICT",
        "MOBILE_MEMBER_AUTHORITY_NETWORK" => "MOBILE_MEMBER_AUTHORITY_NETWORK",
        "MOBILE_MEMBER_AUTHORITY_DEADLINE" => "MOBILE_MEMBER_AUTHORITY_DEADLINE",
        "MOBILE_MEMBER_AUTHORITY_PROJECTION_PENDING" => {
            "MOBILE_MEMBER_AUTHORITY_PROJECTION_PENDING"
        }
        "MOBILE_MEMBER_AUTHORITY_RESPONSE_INVALID" => "MOBILE_MEMBER_AUTHORITY_RESPONSE_INVALID",
        _ => "MOBILE_MESSAGING",
    };
    MobileError::coded(code, error.message)
}

#[tauri::command]
pub fn messaging_list_conversations(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingAccountInput,
) -> MobileResult<Vec<MessagingConversationProjection>> {
    runtime
        .active_engine(&input.station_peer_id, &input.actor_ptid)?
        .mobile_conversations()
        .map(|conversations| {
            conversations
                .into_iter()
                .map(|conversation| {
                    let members = conversation
                        .members
                        .into_iter()
                        .map(|member| MessagingMemberAuthorityMemberProjection {
                            ptid: member.ptid,
                            role: member.role,
                            home_station_peer_id: member.home_station_peer_id,
                            muted: member.muted,
                            muted_until_unix_ms: member.muted_until_unix_ms,
                        })
                        .collect::<Vec<_>>();
                    MessagingConversationProjection {
                        conversation_id: conversation.conversation_id,
                        authority_station_id: conversation.authority_station_id,
                        federation_id: conversation.federation_id,
                        kind: conversation.kind,
                        name: conversation.name,
                        description: conversation.description,
                        owner_ptid: conversation.owner_ptid,
                        member_ptids: members.iter().map(|member| member.ptid.clone()).collect(),
                        members,
                        membership_epoch: conversation.membership_epoch,
                        mls_epoch: conversation.mls_epoch,
                        active: conversation.active,
                        updated_at_unix_ms: conversation.updated_at_unix_ms,
                    }
                })
                .collect()
        })
        .map_err(MobileError::messaging)
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
pub fn messaging_conversation_summary(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingConversationInput,
) -> MobileResult<MessagingConversationSummary> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let summary = engine
        .conversation_summary(&input.conversation_id)
        .map_err(MobileError::messaging)?;
    let last_message = summary
        .last_message
        .map(|message| {
            message_projection(message, |attachment_id| {
                engine.attachment_availability_state(attachment_id)
            })
        })
        .transpose()
        .map_err(MobileError::messaging)?;
    Ok(MessagingConversationSummary {
        last_message,
        unread_count: summary.unread_count,
    })
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
            .begin_attachment_stage(
                &input.filename,
                &input.mime_type,
                input.plaintext_size,
                input.voice_note.map(|voice_note| VoiceNoteMetadata {
                    duration_ms: voice_note.duration_ms,
                    codec: voice_note.codec,
                    waveform: voice_note.waveform,
                }),
            )
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
pub async fn messaging_forward_message(
    runtime: State<'_, MobileMessagingRuntime>,
    input: MessagingForwardInput,
) -> MobileResult<MessagingSubmitCommandResult> {
    let engine = runtime.active_engine(&input.station_peer_id, &input.actor_ptid)?;
    let station_peer_id = input.station_peer_id.clone();
    let actor_ptid = input.actor_ptid.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let outcome = engine.forward_message(
            &input.source_conversation_id,
            &input.source_message_id,
            &input.destination_conversation_id,
        )?;
        Ok::<_, String>(MessagingSubmitCommandResult {
            command_id: outcome.command_id,
            message_id: Some(outcome.message_id),
            attachment_ids: outcome.attachment_ids,
            state: outcome.state.to_string(),
        })
    })
    .await
    .map_err(|error| MobileError::messaging(format!("join messaging forward task: {error}")))?
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
            MessagingMetadataInteraction::HideForActor => MetadataInteraction::HideForActor,
            MessagingMetadataInteraction::Moderate { reason_code } => {
                MetadataInteraction::Moderate { reason_code }
            }
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
    fn internal_unresolved_command_projects_as_unknown_outcome() {
        assert_eq!(
            durable_command_state_name(MobileDurableCommandState::Unresolved),
            "unknown-outcome"
        );
    }

    #[test]
    fn empty_conversation_summary_preserves_explicit_null_and_count() {
        let summary = serde_json::to_value(MessagingConversationSummary {
            last_message: None,
            unread_count: 0,
        })
        .unwrap();
        assert_eq!(
            summary,
            serde_json::json!({ "lastMessage": null, "unreadCount": 0 })
        );
    }

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
                moderated: false,
                moderation_reason_code: None,
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

        let pending = serde_json::to_value(member_authority_result(ProjectedMemberAuthority {
            command_id: "member-command".to_string(),
            conversation_id: "conversation-1".to_string(),
            projection: None,
            state: "pending",
        }))
        .unwrap();
        assert_eq!(
            pending,
            serde_json::json!({
                "commandId": "member-command",
                "conversationId": "conversation-1",
                "state": "pending"
            })
        );
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
            voice_note: None,
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

    #[test]
    fn membership_transition_actions_are_closed() {
        assert_eq!(
            membership_transition_action("add_actor").unwrap(),
            MessagingMembershipAction::AddActor
        );
        assert_eq!(
            membership_transition_action("remove_actor").unwrap(),
            MessagingMembershipAction::RemoveActor
        );
        assert!(membership_transition_action("change_role").is_err());
        assert!(membership_transition_action("leave").is_err());
    }
}
