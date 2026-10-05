use std::collections::HashMap;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::station_origin::{normalize_station_origin, StationOriginPolicy};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use ed25519_dalek::VerifyingKey;
use messaging_core::attachment::{
    AttachmentRetryPolicy, AttachmentTransferControl, AttachmentTransferRecord,
    AttachmentTransferWorker,
};
use messaging_core::codec::verification::verify_device_event_delivery;
use messaging_core::contracts::{
    CommandStatusProjection, ConversationMessageProjection, ConversationProjection,
    CryptoEndpoint as CoreCryptoEndpoint,
};
use messaging_core::crypto::identity::IdentityKeyPair;
use messaging_core::crypto::prekeys::PreKeyPublisher;
use messaging_core::crypto::signaling_envelope;
use messaging_core::identity::{
    is_stale_endpoint_error, load_or_create_device_identity_for_device, DeviceEnrollmentManager,
    DeviceSigningKey, INITIAL_ACTOR_IDENTITY_PROFILE_VERSION,
};
use messaging_core::inbox::{
    AcknowledgedItemObserver, ClaimedItemConsumer, CommandResultLifecycle, CommandResultProcessor,
    ConversationStateProcessor, DeliveryReceiptProcessor, DirectMessageProcessor, DrainProgress,
    MessagingItemConsumer, MlsItemConsumer, PublicEventProcessor, QueueDrain,
};
use messaging_core::mls::actor_device_identity::ActorDeviceIdentity;
use messaging_core::mls::group::MlsGroupManager;
use messaging_core::mls::group_genesis::GroupGenesisPreparer;
use messaging_core::mls::key_packages::MlsKeyPackagePublisher;
use messaging_core::mls::leave_intent::{
    submit_leave_intent as submit_core_leave_intent, MlsLeaveIntentInput,
};
use messaging_core::mls::membership_transition::{
    MembershipTransitionIntentInput, MembershipTransitionPreparer,
};
use messaging_core::mls::outbound::{
    GroupEditTextIntent, GroupForwardIntent, GroupSendTextIntent, MlsOutboundPreparer,
};
use messaging_core::mls::startup::restore_persisted_mls_state;
use messaging_core::mls::{
    MlsApplicationProcessor, MlsRetirementProcessor, MlsSenderTransitionProcessor,
    MlsTransitionProcessor,
};
use messaging_core::outbox::{
    CommandDispatchProgress, CommandOutboxWorker, CommandRetryPolicy, DirectEditIntent,
    DirectForwardIntent, DirectOutboundPreparer, DirectSendIntent, DirectSessionBootstrapper,
    MetadataInteraction, MetadataInteractionPreparer,
};
use messaging_core::proto::actor::{ActorDevice, ActorKind, ActorRef};
use messaging_core::proto::chat::{
    chat_command, conversation_event, ActorReadCursor, AttachmentContentKind,
    AttachmentTransferState, ChatCommand, ChatStorageOperationState, ChatStoragePolicy,
    ChatStorageResult, ChatStorageScope, ChatStorageSnapshot, Conversation,
    ConversationCommandKind, ConversationKind, ConversationMemberAuthorityAction,
    ConversationMemberAuthorityCommand, ConversationStatus, CryptoEndpoint,
    DeviceConsumptionReceipt, DeviceInboxPayloadType, DissolveConversationIntent,
    DurableDeviceInboxItem, MemberRole, MessagingMembershipAction, MlsLeaveIntent,
    PrepareConversationCommandRequest, PrepareConversationCommandResponse,
    PreparedEndpointPayloadKind, PublicEventMarker, SubmitConversationReadCursorRequest,
    SubmitConversationTypingRequest, UpdateConversationIntent, VoiceNoteMetadata,
};
use messaging_core::proto::social::{
    AcceptSocialFriendRequestRequest, BlockSocialActorRequest, FriendRequestAction,
    FriendRequestCommand, FriendRequestCommandBody, FriendRequestCommandSigningInput,
    FriendRequestState, LookupFriendRequestCommandResultRequest,
    LookupFriendRequestCommandResultResponse, LookupSocialRelationshipCommandResultRequest,
    LookupSocialRelationshipCommandResultResponse, RejectSocialFriendRequestRequest,
    SendSocialFriendRequestRequest, SocialRelationshipAction, SocialRelationshipCommand,
    SocialRelationshipCommandBody, SocialRelationshipCommandSigningInput,
    UnblockSocialActorRequest,
};
use messaging_core::proto::{actor_device_ptid, actor_device_ref};
use messaging_core::storage_governance::cache::{
    cache_cleanup_error_proto, cache_cleanup_operation_proto, execute_cache_cleanup,
    finalize_cache_cleanup, prepare_cache_cleanup, storage_error_code_name, CacheCleanupError,
    CacheCleanupJournalRepository, CacheCleanupOperation, CacheCleanupPlanInput,
};
use messaging_core::storage_governance::conversation_clear::{
    clear_conversation, conversation_clear_error_proto, conversation_clear_operation_proto,
    ConversationClearInput, ConversationClearRepository,
};
use messaging_core::storage_governance::retention::{
    apply_retention, retention_error_proto, retention_operation_proto, RetentionApplyInput,
    RetentionRepository,
};
use messaging_core::storage_governance::{
    measure_storage, PhysicalStorageClass, PhysicalStoragePath, StorageAccountingInput,
};
use messaging_core::store::MessagingRepository;
use prost::Message;
use rand::rngs::OsRng;
use rand::RngCore;
use secure_content_core::object::{
    ObjectCryptoMaterial as AttachmentCryptoMaterial,
    OBJECT_MAX_PLAINTEXT_SIZE as ATTACHMENT_MAX_PLAINTEXT_SIZE,
};
use secure_content_core::ports::ObjectBlob as AttachmentBlob;
use sha2::{Digest, Sha256};
use ulid::Ulid;
use zeroize::Zeroizing;

use super::adapter::{
    load_storage_retention_policy, AttachmentDownloadProjection, CompletedSenderAttachmentSource,
    ConversationCommandCommit, ConversationMutation, ConversationMutationReceiveCommit,
    ConversationSummary, MobileConversationProjection, MobileMemberAuthorityProjection,
    MobileMessagingStore, MobileOutboxStore, PendingAttachmentUpload, PendingMembershipIntent,
    PendingMessageDraft,
};
use super::attachment_blob::FilesystemAttachmentBlob;
use super::mls_leave_intent::StationMlsLeaveIntentTransport;
use super::transport::{
    fetch_actor_identity_key, StationAttachmentTransferTransport, StationCommandTransport,
    StationConversationTransport, StationDeliveryReceiptTransport, StationDeviceTransport,
    StationKeyBundleTransport, StationMlsKeyPackageTransport, StationPreKeyTransport,
    StationQueueTransport, StationSocialTransport, StationTransportError,
};
use crate::runtime::reliability::{
    FriendRequestResolverTransport, FriendRequestTransportFailure, RelationshipResolverTransport,
    RelationshipTransportFailure,
};

const DRAIN_BATCH_LIMIT: u32 = 100;
pub const ATTACHMENT_STAGE_CHUNK_SIZE: usize = 1024 * 1024;
const FRIEND_REQUEST_COMMAND_FORMAT_VERSION: u32 = 1;
const FRIEND_REQUEST_COMMAND_LIFETIME_MS: i64 = 60 * 60 * 1_000;
const FRIEND_REQUEST_IDENTIFIER_MAX_BYTES: usize = 255;
const FRIEND_REQUEST_MESSAGE_MAX_BYTES: usize = 4_096;
const SOCIAL_RELATIONSHIP_COMMAND_FORMAT_VERSION: u32 = 1;
const SOCIAL_RELATIONSHIP_COMMAND_LIFETIME_MS: i64 = 60 * 60 * 1_000;
const MEMBER_AUTHORITY_COMMAND_LIFETIME_MS: i64 = 5 * 60 * 1_000;
const MEMBER_AUTHORITY_RECONCILE_ATTEMPTS: usize = 3;
const COMMAND_RETRY_POLICY: CommandRetryPolicy = CommandRetryPolicy {
    initial_delay_ms: 1_000,
    maximum_delay_ms: 60_000,
};

struct FriendRequestCommandIntent<'a> {
    action: FriendRequestAction,
    command_id: &'a str,
    request_id: &'a str,
    sender_ptid: &'a str,
    receiver_ptid: &'a str,
    sender_home_station_peer_id: &'a str,
    receiver_home_station_peer_id: &'a str,
    federation_id: &'a str,
    message: &'a str,
    created_at_unix_ms: i64,
}

struct RelationshipCommandIntent<'a> {
    action: SocialRelationshipAction,
    command_id: &'a str,
    target_ptid: &'a str,
    target_home_station_peer_id: &'a str,
    observed_revision: i64,
    created_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedSocialFriendRequestCommand {
    pub action: FriendRequestAction,
    pub command_id: String,
    pub request_id: String,
    pub ordering_key: String,
    pub payload_sha256: Vec<u8>,
    pub command_bytes: Vec<u8>,
    pub expires_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedSocialRelationshipCommand {
    pub action: SocialRelationshipAction,
    pub command_id: String,
    pub target_ptid: String,
    pub ordering_key: String,
    pub payload_sha256: Vec<u8>,
    pub command_bytes: Vec<u8>,
    pub expires_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageDraftResumeProgress {
    Idle,
    Prepared,
    RetryScheduled { next_attempt_at_unix_ms: i64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessagingAccountScope {
    pub station_peer_id: String,
    pub station_origin: String,
    pub actor_ptid: String,
    pub device_id: String,
}

pub(crate) struct SecureContentRuntimeIdentity {
    pub scope: MessagingAccountScope,
    pub access_token: Zeroizing<String>,
    pub signing_key_id: String,
    pub profile_version: u64,
    pub device_signing_key: DeviceSigningKey,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessagingSubmitMessageOutcome {
    pub command_id: Option<String>,
    pub message_id: String,
    pub attachment_ids: Vec<String>,
    pub state: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedGroupConversation {
    pub conversation_id: String,
    pub command_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedDirectConversation {
    pub conversation_id: String,
    pub command_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectedMemberAuthority {
    pub command_id: String,
    pub conversation_id: String,
    pub projection: Option<MobileMemberAuthorityProjection>,
    pub state: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberAuthorityCommandError {
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for MemberAuthorityCommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for MemberAuthorityCommandError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessagingAttachmentStage {
    pub stage_id: String,
    pub filename: String,
    pub mime_type: String,
    pub plaintext_size: u64,
    pub content_kind: i32,
    pub duration_ms: u32,
    pub voice_note: Option<VoiceNoteMetadata>,
    pub completed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessagingAttachmentOpenProgress {
    Ready { local_path: String },
    Pending { next_attempt_at_unix_ms: i64 },
}

#[derive(Debug, Clone)]
struct StagedAttachment {
    filename: String,
    mime_type: String,
    plaintext_size: u64,
    content_kind: i32,
    duration_ms: u32,
    voice_note: Option<VoiceNoteMetadata>,
    written_size: u64,
    completed: bool,
}

impl MessagingAccountScope {
    pub fn validate(&self) -> Result<(), String> {
        validate_account_scope(
            &self.station_peer_id,
            &self.station_origin,
            &self.actor_ptid,
        )?;
        if self.device_id.trim().is_empty() {
            return Err("mobile messaging account scope is incomplete".to_string());
        }
        Ok(())
    }
}

pub(crate) fn validate_account_scope(
    station_peer_id: &str,
    station_origin: &str,
    actor_ptid: &str,
) -> Result<(), String> {
    if station_peer_id.trim().is_empty()
        || station_origin.trim().is_empty()
        || !actor_ptid.starts_with("ptid:")
    {
        return Err("mobile messaging account scope is incomplete".to_string());
    }
    normalize_station_origin(station_origin, StationOriginPolicy::current_build())
        .map_err(|_| "mobile messaging Station origin is not canonical".to_string())?;
    Ok(())
}

fn validate_call_signal_input(
    peer_ptid: &str,
    session_ulid: &str,
    kind: &str,
) -> Result<(), String> {
    if !peer_ptid.starts_with("ptid:")
        || session_ulid.trim().is_empty()
        || !matches!(
            kind,
            "OFFER"
                | "ANSWER"
                | "CANDIDATE"
                | "HANGUP"
                | "CALL_REQUEST"
                | "CALL_ACCEPT"
                | "CALL_REJECT"
                | "CALL_END"
        )
    {
        return Err("mobile signaling context is invalid".to_string());
    }
    Ok(())
}

fn validate_attachment_content_metadata(
    mime_type: &str,
    content_kind: i32,
    duration_ms: u32,
) -> Result<(), String> {
    match AttachmentContentKind::try_from(content_kind) {
        Ok(AttachmentContentKind::Unspecified | AttachmentContentKind::File)
            if duration_ms == 0 =>
        {
            Ok(())
        }
        Ok(AttachmentContentKind::VoiceNote)
            if duration_ms > 0 && mime_type.to_ascii_lowercase().starts_with("audio/") =>
        {
            Ok(())
        }
        _ => Err("mobile messaging attachment content metadata is invalid".to_string()),
    }
}

struct MobileMlsItemConsumer {
    manager: Arc<MlsGroupManager>,
    application: MlsApplicationProcessor<MobileMessagingStore>,
    transition: MlsTransitionProcessor<MobileMessagingStore>,
    retirement: MlsRetirementProcessor<MobileMessagingStore>,
    sender_transition: MlsSenderTransitionProcessor<MobileMessagingStore>,
}

impl MlsItemConsumer for MobileMlsItemConsumer {
    fn consume_application(
        &self,
        item: &DurableDeviceInboxItem,
        consumer_epoch: u64,
    ) -> Result<(), String> {
        self.application.consume(item, consumer_epoch)
    }

    fn consume_transition(
        &self,
        item: &DurableDeviceInboxItem,
        consumer_epoch: u64,
    ) -> Result<(), String> {
        self.transition.consume(item, consumer_epoch)
    }

    fn consume_retirement(
        &self,
        item: &DurableDeviceInboxItem,
        consumer_epoch: u64,
    ) -> Result<(), String> {
        self.retirement.consume(item, consumer_epoch)
    }

    fn consume_sender_transition(
        &self,
        item: &DurableDeviceInboxItem,
        consumer_epoch: u64,
    ) -> Result<(), String> {
        self.sender_transition.consume(item, consumer_epoch)
    }
}

impl CommandResultLifecycle for MobileMlsItemConsumer {
    fn discard_pending_transition(&self, conversation_id: &str, transition_id: &str) {
        self.manager
            .discard_pending_transition_if_matches(conversation_id, transition_id);
    }
}

type CoreItemConsumer = MessagingItemConsumer<MobileMessagingStore, MobileMlsItemConsumer>;

pub struct MobileMessagingEngine {
    profile_id: String,
    scope: MessagingAccountScope,
    store: Arc<MobileMessagingStore>,
    attachment_root: PathBuf,
    attachment_stages: Mutex<HashMap<String, StagedAttachment>>,
    attachment_source_lock: Mutex<()>,
    storage_governance_lock: Mutex<()>,
    attachment_transfer_control: Arc<AttachmentTransferControl>,
    actor_identity: Arc<IdentityKeyPair>,
    mls_manager: Arc<MlsGroupManager>,
    consumer: Arc<CoreItemConsumer>,
    consumer_id: String,
    consumer_epoch: AtomicU64,
    drain_lock: Mutex<()>,
    dispatch_lock: Mutex<()>,
    send_intent_lock: Mutex<()>,
    membership_transition_lock: Mutex<()>,
    access_token: Mutex<Zeroizing<String>>,
}

impl MobileMessagingEngine {
    pub fn open(
        database_path: &Path,
        profile_id: String,
        station_peer_id: String,
        station_origin: String,
        actor_ptid: String,
        device_id: String,
        database_key: &[u8; 32],
        actor_identity_seed: [u8; 32],
        access_token: String,
    ) -> Result<Self, String> {
        validate_account_scope(&station_peer_id, &station_origin, &actor_ptid)?;
        if profile_id.trim().is_empty() || access_token.trim().is_empty() {
            return Err("mobile messaging runtime credentials are incomplete".to_string());
        }
        let actor_identity_seed = Zeroizing::new(actor_identity_seed);
        let store = Arc::new(MobileMessagingStore::open(database_path, database_key)?);
        store.reconcile_completed_attachment_uploads()?;
        let attachment_root = database_path
            .parent()
            .ok_or_else(|| "mobile messaging database parent is unavailable".to_string())?
            .join("attachments")
            .join(&profile_id);
        cleanup_incomplete_attachment_stages(&attachment_root, store.as_ref())?;
        let enrollment = load_or_create_device_identity_for_device(
            store.as_ref(),
            &actor_ptid,
            &device_id,
            *actor_identity_seed,
            INITIAL_ACTOR_IDENTITY_PROFILE_VERSION,
        )?;
        let device = enrollment
            .certificate
            .device
            .as_ref()
            .ok_or_else(|| "mobile messaging device identity has no endpoint".to_string())?;
        if actor_device_ptid(device)? != actor_ptid || device.device_id != device_id {
            return Err(
                "mobile messaging device identity does not match authenticated session".to_string(),
            );
        }
        let scope = MessagingAccountScope {
            station_peer_id,
            station_origin,
            actor_ptid,
            device_id: device.device_id.clone(),
        };
        let actor_identity = Arc::new(IdentityKeyPair::from_seed(&actor_identity_seed));
        let mls_identity = Arc::new(ActorDeviceIdentity::new());
        match store.load_mls_actor_identity()? {
            Some((ptid, device_id, state)) => {
                if ptid != scope.actor_ptid || device_id != scope.device_id {
                    return Err(
                        "mobile messaging MLS identity belongs to another account".to_string()
                    );
                }
                mls_identity.import(&scope.actor_ptid, &scope.device_id, &state)?;
            }
            None => {
                mls_identity.init(&scope.actor_ptid, &scope.device_id)?;
                let state = mls_identity.export(&scope.actor_ptid, &scope.device_id)?;
                store.save_mls_actor_identity(&scope.actor_ptid, &scope.device_id, &state)?;
            }
        }
        let mls_manager = Arc::new(MlsGroupManager::with_actor_identity(mls_identity));
        restore_persisted_mls_state(mls_manager.as_ref(), store.as_ref())?;

        let endpoint = CoreCryptoEndpoint {
            ptid: scope.actor_ptid.clone(),
            device_id: scope.device_id.clone(),
        };
        let direct = DirectMessageProcessor::with_actor_identity(
            store.clone(),
            endpoint.clone(),
            actor_identity.clone(),
            now_unix_ms,
        )?;
        let mls = Arc::new(MobileMlsItemConsumer {
            manager: mls_manager.clone(),
            application: MlsApplicationProcessor::new(
                mls_manager.clone(),
                store.clone(),
                endpoint.clone(),
                now_unix_ms,
            )?,
            transition: MlsTransitionProcessor::new(
                mls_manager.clone(),
                store.clone(),
                endpoint.clone(),
                now_unix_ms,
            )?,
            retirement: MlsRetirementProcessor::new(
                mls_manager.clone(),
                store.clone(),
                endpoint.clone(),
                now_unix_ms,
            )?,
            sender_transition: MlsSenderTransitionProcessor::new(
                mls_manager.clone(),
                store.clone(),
                endpoint.clone(),
                now_unix_ms,
            )?,
        });
        let command_result =
            CommandResultProcessor::new(store.clone(), mls.clone(), endpoint.clone(), now_unix_ms)?;
        let consumer = Arc::new(MessagingItemConsumer::new(
            direct,
            mls,
            PublicEventProcessor::new(store.clone(), endpoint.clone(), now_unix_ms)?,
            ConversationStateProcessor::new(store.clone(), endpoint.clone(), now_unix_ms)?,
            command_result,
            DeliveryReceiptProcessor::new(store.clone(), endpoint, now_unix_ms)?,
        ));
        let consumer_id = random_consumer_id();

        Ok(Self {
            profile_id,
            scope,
            store,
            attachment_root,
            attachment_stages: Mutex::new(HashMap::new()),
            attachment_source_lock: Mutex::new(()),
            storage_governance_lock: Mutex::new(()),
            attachment_transfer_control: Arc::new(AttachmentTransferControl::new()),
            actor_identity,
            mls_manager,
            consumer,
            consumer_id,
            consumer_epoch: AtomicU64::new(0),
            drain_lock: Mutex::new(()),
            dispatch_lock: Mutex::new(()),
            send_intent_lock: Mutex::new(()),
            membership_transition_lock: Mutex::new(()),
            access_token: Mutex::new(Zeroizing::new(access_token)),
        })
    }

    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    pub fn chat_storage_snapshot(
        &self,
        scope_revision: &str,
    ) -> Result<ChatStorageSnapshot, String> {
        if scope_revision.trim().is_empty() {
            return Err("chat storage scope revision is empty".to_string());
        }
        let database_path = self.store.storage_database_path()?;
        let mut physical_paths = vec![
            PhysicalStoragePath::required(database_path.clone(), PhysicalStorageClass::System),
            PhysicalStoragePath::optional(
                sqlite_sidecar_path(&database_path, "-wal"),
                PhysicalStorageClass::System,
            ),
            PhysicalStoragePath::optional(
                sqlite_sidecar_path(&database_path, "-shm"),
                PhysicalStorageClass::System,
            ),
            PhysicalStoragePath::optional(
                self.attachment_root.join("cache"),
                PhysicalStorageClass::Cache,
            ),
            PhysicalStoragePath::optional(
                self.attachment_root.join("sources"),
                PhysicalStorageClass::Protected,
            ),
        ];
        physical_paths.extend(
            self.store
                .storage_media_paths()?
                .into_iter()
                .map(|path| PhysicalStoragePath::required(path, PhysicalStorageClass::Media)),
        );

        let scope = ChatStorageScope {
            station_peer_id: self.scope.station_peer_id.clone(),
            actor_ptid: self.scope.actor_ptid.clone(),
            device_id: self.scope.device_id.clone(),
        };
        let mut snapshot = measure_storage(StorageAccountingInput {
            scope: scope.clone(),
            revision: scope_revision.to_string(),
            measured_at_unix_ms: now_unix_ms(),
            physical_paths,
            conversations: self.store.storage_logical_usage()?,
        })
        .map_err(|error| error.to_string())?;
        snapshot.retention_policy =
            Some(load_storage_retention_policy(self.store.as_ref(), &scope)?);
        Ok(snapshot)
    }

    pub fn chat_storage_clear_cache(
        &self,
        scope_revision: &str,
    ) -> Result<ChatStorageResult, String> {
        let _guard = self
            .storage_governance_lock
            .lock()
            .map_err(|_| "mobile chat storage governance lock poisoned".to_string())?;
        let before = self.chat_storage_snapshot(scope_revision)?;
        let cache_root = self.attachment_root.join("cache");
        let protected_paths = self.store.storage_cache_protected_paths()?;
        let operation = prepare_cache_cleanup(
            self.store.as_ref(),
            CacheCleanupPlanInput {
                scope_revision: scope_revision.to_string(),
                cache_roots: vec![cache_root.clone()],
                protected_paths: protected_paths.clone(),
                physical_bytes_before: before.physical_total_bytes,
                now_unix_ms: now_unix_ms(),
            },
        )
        .map_err(|error| error.to_string())?;
        let mut progress = execute_cache_cleanup(
            self.store.as_ref(),
            &operation,
            std::slice::from_ref(&cache_root),
            &protected_paths,
            now_unix_ms(),
        )
        .map_err(|error| error.to_string())?;

        if progress.operation.state == ChatStorageOperationState::Compacting {
            if self.store.storage_checkpoint().is_err() {
                let after = self.chat_storage_snapshot(scope_revision)?;
                progress.operation = self.store.update_cache_cleanup_operation(
                    &progress.operation.operation_id,
                    ChatStorageOperationState::CompactionPending,
                    Some(after.physical_total_bytes),
                    Some(storage_error_code_name(
                        messaging_core::proto::chat::ChatStorageErrorCode::CompactionPending,
                    )),
                    now_unix_ms(),
                )?;
                progress.error = Some(CacheCleanupError::CompactionPending);
                return Ok(cache_cleanup_result(after, progress));
            }
        }
        let after = self.chat_storage_snapshot(scope_revision)?;
        let execution_error = progress.error.clone();
        progress = finalize_cache_cleanup(
            self.store.as_ref(),
            &progress.operation,
            after.physical_total_bytes,
            now_unix_ms(),
        )
        .map_err(|error| error.to_string())?;
        if progress.error.is_none() {
            progress.error = execution_error;
        }
        Ok(cache_cleanup_result(after, progress))
    }

    pub fn chat_storage_set_retention(
        &self,
        scope_revision: &str,
        retention_preset: i32,
    ) -> Result<ChatStorageResult, String> {
        let _guard = self
            .storage_governance_lock
            .lock()
            .map_err(|_| "mobile chat storage governance lock poisoned".to_string())?;
        let mut before = self.chat_storage_snapshot(scope_revision)?;
        let scope = before
            .scope
            .clone()
            .ok_or_else(|| "mobile chat retention scope is unavailable".to_string())?;
        let cache_root = self.attachment_root.join("cache");

        if let Some(resume) = self
            .store
            .load_resumable_retention(&scope, scope_revision)?
        {
            let resumed_preset = resume.policy.retention_preset;
            let resumed = self.finish_retention_operation(
                scope_revision,
                resume.policy,
                resume.operation,
                &cache_root,
            )?;
            let resumed_succeeded = resumed.operation.as_ref().is_some_and(|operation| {
                operation.state == ChatStorageOperationState::Succeeded as i32
            });
            if !resumed_succeeded || resumed_preset == retention_preset {
                return Ok(resumed);
            }
            before = resumed.snapshot.clone().ok_or_else(|| {
                "mobile chat retention resume snapshot is unavailable".to_string()
            })?;
        }

        let retention = match apply_retention(
            self.store.as_ref(),
            RetentionApplyInput {
                scope,
                scope_revision: scope_revision.to_string(),
                retention_preset,
                physical_bytes_before: before.physical_total_bytes,
                now_unix_ms: now_unix_ms(),
            },
        ) {
            Ok(retention) => retention,
            Err(error) => {
                return Ok(ChatStorageResult {
                    snapshot: Some(before),
                    policy: None,
                    operation: None,
                    error: Some(retention_error_proto(&error)),
                })
            }
        };
        self.finish_retention_operation(
            scope_revision,
            retention.policy,
            retention.commit.operation,
            &cache_root,
        )
    }

    pub fn chat_storage_clear_conversation(
        &self,
        scope_revision: &str,
        conversation_id: &str,
    ) -> Result<ChatStorageResult, String> {
        let _guard = self
            .storage_governance_lock
            .lock()
            .map_err(|_| "mobile chat storage governance lock poisoned".to_string())?;
        let before = self.chat_storage_snapshot(scope_revision)?;
        let scope = before
            .scope
            .clone()
            .ok_or_else(|| "mobile chat conversation clear scope is unavailable".to_string())?;
        let cache_root = self.attachment_root.join("cache");

        let operation = if let Some(operation) =
            self.store
                .load_resumable_conversation_clear(&scope, scope_revision, conversation_id)?
        {
            operation
        } else {
            match clear_conversation(
                self.store.as_ref(),
                ConversationClearInput {
                    scope,
                    scope_revision: scope_revision.to_string(),
                    conversation_id: conversation_id.to_string(),
                    physical_bytes_before: before.physical_total_bytes,
                    now_unix_ms: now_unix_ms(),
                },
            ) {
                Ok(progress) => progress.commit.operation,
                Err(error) => {
                    return Ok(ChatStorageResult {
                        snapshot: Some(before),
                        policy: None,
                        operation: None,
                        error: Some(conversation_clear_error_proto(&error)),
                    })
                }
            }
        };
        self.finish_conversation_clear_operation(
            scope_revision,
            conversation_id,
            operation,
            &cache_root,
        )
    }

    fn finish_conversation_clear_operation(
        &self,
        scope_revision: &str,
        conversation_id: &str,
        mut operation: CacheCleanupOperation,
        cache_root: &PathBuf,
    ) -> Result<ChatStorageResult, String> {
        let protected_paths = self.store.storage_cache_protected_paths()?;
        let mut cleanup_error = None;
        let mut failed_item_count = 0;
        if matches!(
            operation.state,
            ChatStorageOperationState::DeletingFiles
                | ChatStorageOperationState::CompactionPending
                | ChatStorageOperationState::PausedScopeInactive
                | ChatStorageOperationState::FailedRetryable
        ) {
            let progress = execute_cache_cleanup(
                self.store.as_ref(),
                &operation,
                std::slice::from_ref(cache_root),
                &protected_paths,
                now_unix_ms(),
            )
            .map_err(|error| error.to_string())?;
            operation = progress.operation;
            cleanup_error = progress.error;
            failed_item_count = progress.failed_item_count;
        }
        if operation.state == ChatStorageOperationState::Compacting {
            if self.store.storage_compact().is_err() {
                operation = self.store.update_cache_cleanup_operation(
                    &operation.operation_id,
                    ChatStorageOperationState::CompactionPending,
                    None,
                    Some(storage_error_code_name(
                        messaging_core::proto::chat::ChatStorageErrorCode::CompactionPending,
                    )),
                    now_unix_ms(),
                )?;
                cleanup_error = Some(CacheCleanupError::CompactionPending);
            }
        }
        let after = self.chat_storage_snapshot(scope_revision)?;
        if operation.state == ChatStorageOperationState::Compacting {
            let progress = finalize_cache_cleanup(
                self.store.as_ref(),
                &operation,
                after.physical_total_bytes,
                now_unix_ms(),
            )
            .map_err(|error| error.to_string())?;
            operation = progress.operation;
            cleanup_error = cleanup_error.or(progress.error);
            failed_item_count = failed_item_count.max(progress.failed_item_count);
        }
        Ok(conversation_clear_result(
            after,
            operation,
            conversation_id,
            cleanup_error,
            failed_item_count,
        ))
    }

    fn finish_retention_operation(
        &self,
        scope_revision: &str,
        policy: ChatStoragePolicy,
        mut operation: CacheCleanupOperation,
        cache_root: &PathBuf,
    ) -> Result<ChatStorageResult, String> {
        let protected_paths = self.store.storage_cache_protected_paths()?;
        let mut cleanup_error = None;
        let mut failed_item_count = 0;
        if matches!(
            operation.state,
            ChatStorageOperationState::DeletingFiles
                | ChatStorageOperationState::CompactionPending
                | ChatStorageOperationState::PausedScopeInactive
                | ChatStorageOperationState::FailedRetryable
        ) {
            let progress = execute_cache_cleanup(
                self.store.as_ref(),
                &operation,
                std::slice::from_ref(cache_root),
                &protected_paths,
                now_unix_ms(),
            )
            .map_err(|error| error.to_string())?;
            operation = progress.operation;
            cleanup_error = progress.error;
            failed_item_count = progress.failed_item_count;
        }
        if operation.state == ChatStorageOperationState::Compacting {
            if self.store.storage_compact().is_err() {
                operation = self.store.update_cache_cleanup_operation(
                    &operation.operation_id,
                    ChatStorageOperationState::CompactionPending,
                    None,
                    Some(storage_error_code_name(
                        messaging_core::proto::chat::ChatStorageErrorCode::CompactionPending,
                    )),
                    now_unix_ms(),
                )?;
                cleanup_error = Some(CacheCleanupError::CompactionPending);
            }
        }
        let after = self.chat_storage_snapshot(scope_revision)?;
        if operation.state == ChatStorageOperationState::Compacting {
            let progress = finalize_cache_cleanup(
                self.store.as_ref(),
                &operation,
                after.physical_total_bytes,
                now_unix_ms(),
            )
            .map_err(|error| error.to_string())?;
            operation = progress.operation;
            cleanup_error = cleanup_error.or(progress.error);
            failed_item_count = failed_item_count.max(progress.failed_item_count);
        }
        Ok(retention_result(
            after,
            policy,
            operation,
            cleanup_error,
            failed_item_count,
        ))
    }

    #[cfg(any(test, feature = "acceptance-harness"))]
    pub fn seed_acceptance_storage_retention(
        &self,
        old_plaintext_bytes: usize,
    ) -> Result<(String, String, String, String), String> {
        let fixture = self.store.seed_acceptance_retention_fixture(
            &self.scope.station_peer_id,
            old_plaintext_bytes,
            now_unix_ms(),
        )?;
        Ok((
            fixture.conversation_id,
            fixture.pruned_message_id,
            fixture.protected_message_id,
            fixture.recent_message_id,
        ))
    }

    #[cfg(any(test, feature = "acceptance-harness"))]
    pub fn seed_acceptance_storage_conversation_clear(
        &self,
        plaintext_bytes: usize,
    ) -> Result<(String, String), String> {
        let fixture = self.store.seed_acceptance_conversation_clear_fixture(
            &self.scope.station_peer_id,
            plaintext_bytes,
            now_unix_ms(),
        )?;
        Ok((fixture.conversation_id, fixture.message_id))
    }

    #[cfg(any(test, feature = "acceptance-harness"))]
    pub fn seed_acceptance_storage_cache(&self, size_bytes: usize) -> Result<u64, String> {
        if size_bytes == 0 || size_bytes > 16 * 1024 * 1024 {
            return Err("acceptance cache fixture size is invalid".to_string());
        }
        let cache_root = self.attachment_root.join("cache");
        std::fs::create_dir_all(&cache_root)
            .map_err(|error| format!("create acceptance cache root: {error}"))?;
        let path = cache_root.join(format!("acceptance-rebuildable-{}.bin", Ulid::new()));
        std::fs::write(&path, vec![0x5a_u8; size_bytes])
            .map_err(|error| format!("write acceptance cache fixture: {error}"))?;
        Ok(size_bytes as u64)
    }

    pub fn scope(&self) -> &MessagingAccountScope {
        &self.scope
    }

    pub fn seal_call_signal(
        &self,
        peer_ptid: &str,
        session_ulid: &str,
        kind: &str,
        plaintext: &str,
    ) -> Result<String, String> {
        validate_call_signal_input(peer_ptid, session_ulid, kind)?;
        let peer_identity = self.fetch_call_peer_identity(peer_ptid)?;
        signaling_envelope::seal(
            self.actor_identity.as_ref(),
            &peer_identity,
            session_ulid,
            kind,
            plaintext.as_bytes(),
        )
        .map(|envelope| B64.encode(envelope))
    }

    pub fn open_call_signal(
        &self,
        peer_ptid: &str,
        session_ulid: &str,
        kind: &str,
        envelope: &[u8],
    ) -> Result<String, String> {
        validate_call_signal_input(peer_ptid, session_ulid, kind)?;
        let peer_identity = self.fetch_call_peer_identity(peer_ptid)?;
        let plaintext = signaling_envelope::open(
            self.actor_identity.as_ref(),
            &peer_identity,
            session_ulid,
            kind,
            envelope,
        )?;
        String::from_utf8(plaintext)
            .map_err(|_| "mobile signaling plaintext is not valid UTF-8".to_string())
    }

    fn fetch_call_peer_identity(&self, peer_ptid: &str) -> Result<VerifyingKey, String> {
        let encoded = fetch_actor_identity_key(
            &self.scope.station_origin,
            &self.access_token()?,
            &self.scope.actor_ptid,
            &self.scope.device_id,
            peer_ptid,
        )?;
        let decoded = B64
            .decode(encoded)
            .map_err(|_| "mobile signaling peer identity is not base64".to_string())?;
        let bytes: [u8; 32] = decoded
            .try_into()
            .map_err(|_| "mobile signaling peer identity must be 32 bytes".to_string())?;
        VerifyingKey::from_bytes(&bytes)
            .map_err(|_| "mobile signaling peer identity is invalid".to_string())
    }

    pub fn conversations(&self) -> Result<Vec<ConversationProjection>, String> {
        self.store.conversation_projections()
    }

    pub fn mobile_conversations(&self) -> Result<Vec<MobileConversationProjection>, String> {
        self.store.mobile_conversation_projections()
    }

    pub fn hydrate_conversation_authority_scopes(&self) -> Result<usize, String> {
        let incomplete_conversation_ids = self
            .store
            .conversation_projections()?
            .into_iter()
            .filter(|conversation| {
                conversation.active && conversation.federation_id.trim().is_empty()
            })
            .map(|conversation| conversation.conversation_id)
            .collect::<Vec<_>>();
        if incomplete_conversation_ids.is_empty() {
            return Ok(0);
        }
        let response = StationConversationTransport::new(
            self.scope.station_origin.clone(),
            self.access_token()?,
            self.scope.device_id.clone(),
            self.proto_endpoint(),
        )?
        .list_conversations()?;
        let mut repaired = 0;
        for conversation in response.conversations {
            if !incomplete_conversation_ids.contains(&conversation.conversation_id) {
                continue;
            }
            let (authority_station_id, federation_id) =
                conversation_authority_scope(&conversation)?;
            if self.store.reconcile_conversation_authority_scope(
                &conversation.conversation_id,
                authority_station_id,
                federation_id,
            )? {
                repaired += 1;
            }
        }
        Ok(repaired)
    }

    pub fn prepare_send_social_friend_request(
        &self,
        receiver_ptid: &str,
        receiver_home_station_peer_id: &str,
        federation_id: &str,
        message: &str,
    ) -> Result<PreparedSocialFriendRequestCommand, String> {
        let command_id = Ulid::new().to_string();
        let request_id = Ulid::new().to_string();
        let command = self.build_social_friend_request_command(FriendRequestCommandIntent {
            action: FriendRequestAction::Send,
            command_id: &command_id,
            request_id: &request_id,
            sender_ptid: &self.scope.actor_ptid,
            receiver_ptid,
            sender_home_station_peer_id: &self.scope.station_peer_id,
            receiver_home_station_peer_id,
            federation_id,
            message,
            created_at_unix_ms: now_unix_ms(),
        })?;
        prepared_social_friend_request_command(command)
    }

    pub fn prepare_accept_social_friend_request(
        &self,
        request_id: &str,
        sender_ptid: &str,
        receiver_ptid: &str,
        sender_home_station_peer_id: &str,
        receiver_home_station_peer_id: &str,
        federation_id: &str,
    ) -> Result<PreparedSocialFriendRequestCommand, String> {
        let command_id = Ulid::new().to_string();
        let command = self.build_social_friend_request_command(FriendRequestCommandIntent {
            action: FriendRequestAction::Accept,
            command_id: &command_id,
            request_id,
            sender_ptid,
            receiver_ptid,
            sender_home_station_peer_id,
            receiver_home_station_peer_id,
            federation_id,
            message: "",
            created_at_unix_ms: now_unix_ms(),
        })?;
        prepared_social_friend_request_command(command)
    }

    pub fn prepare_reject_social_friend_request(
        &self,
        request_id: &str,
        sender_ptid: &str,
        receiver_ptid: &str,
        sender_home_station_peer_id: &str,
        receiver_home_station_peer_id: &str,
        federation_id: &str,
    ) -> Result<PreparedSocialFriendRequestCommand, String> {
        let command_id = Ulid::new().to_string();
        let command = self.build_social_friend_request_command(FriendRequestCommandIntent {
            action: FriendRequestAction::Reject,
            command_id: &command_id,
            request_id,
            sender_ptid,
            receiver_ptid,
            sender_home_station_peer_id,
            receiver_home_station_peer_id,
            federation_id,
            message: "",
            created_at_unix_ms: now_unix_ms(),
        })?;
        prepared_social_friend_request_command(command)
    }

    pub fn dispatch_prepared_social_friend_request(
        &self,
        prepared: &PreparedSocialFriendRequestCommand,
    ) -> Result<Vec<u8>, FriendRequestTransportFailure> {
        let command = FriendRequestCommand::decode(prepared.command_bytes.as_slice())
            .map_err(|_| FriendRequestTransportFailure::ResponseDecode)?;
        if command.encode_to_vec() != prepared.command_bytes {
            return Err(FriendRequestTransportFailure::ResponseDecode);
        }
        let body = command
            .body
            .as_ref()
            .ok_or(FriendRequestTransportFailure::ResponseDecode)?;
        let payload_hash = Sha256::digest(&prepared.command_bytes);
        if body.command_id != prepared.command_id
            || body.request_id != prepared.request_id
            || FriendRequestAction::try_from(body.action).ok() != Some(prepared.action)
            || !payload_hash
                .as_slice()
                .eq(prepared.payload_sha256.as_slice())
        {
            return Err(FriendRequestTransportFailure::ResponseDecode);
        }
        let transport = StationSocialTransport::new(
            self.scope.station_origin.clone(),
            self.access_token()
                .map_err(|_| FriendRequestTransportFailure::Transport)?,
            self.scope.device_id.clone(),
        )
        .map_err(|_| FriendRequestTransportFailure::Transport)?;
        match prepared.action {
            FriendRequestAction::Send => transport
                .send_friend_request(&SendSocialFriendRequestRequest {
                    command: Some(command),
                })
                .map(|response| response.encode_to_vec()),
            FriendRequestAction::Accept => transport
                .accept_friend_request(&AcceptSocialFriendRequestRequest {
                    command: Some(command),
                })
                .map(|response| response.encode_to_vec()),
            FriendRequestAction::Reject => transport
                .reject_friend_request(&RejectSocialFriendRequestRequest {
                    command: Some(command),
                })
                .map(|response| response.encode_to_vec()),
            FriendRequestAction::Unspecified => Err(StationTransportError::Invalid),
        }
        .map_err(map_friend_request_transport_error)
    }

    pub fn lookup_social_friend_request_command_result(
        &self,
        command_id: &str,
        payload_sha256: &[u8],
    ) -> Result<LookupFriendRequestCommandResultResponse, FriendRequestTransportFailure> {
        StationSocialTransport::new(
            self.scope.station_origin.clone(),
            self.access_token()
                .map_err(|_| FriendRequestTransportFailure::Transport)?,
            self.scope.device_id.clone(),
        )
        .map_err(|_| FriendRequestTransportFailure::Transport)?
        .lookup_friend_request_command_result(&LookupFriendRequestCommandResultRequest {
            command_id: command_id.to_string(),
            command_payload_sha256: payload_sha256.to_vec(),
        })
        .map_err(map_friend_request_transport_error)
    }

    pub fn prepare_social_relationship_command(
        &self,
        action: SocialRelationshipAction,
        target_ptid: &str,
        target_home_station_peer_id: &str,
        observed_revision: i64,
    ) -> Result<PreparedSocialRelationshipCommand, String> {
        let command_id = Ulid::new().to_string();
        let command = self.build_social_relationship_command(RelationshipCommandIntent {
            action,
            command_id: &command_id,
            target_ptid,
            target_home_station_peer_id,
            observed_revision,
            created_at_unix_ms: now_unix_ms(),
        })?;
        prepared_social_relationship_command(command)
    }

    pub fn dispatch_prepared_social_relationship(
        &self,
        prepared: &PreparedSocialRelationshipCommand,
    ) -> Result<Vec<u8>, RelationshipTransportFailure> {
        let command = SocialRelationshipCommand::decode(prepared.command_bytes.as_slice())
            .map_err(|_| RelationshipTransportFailure::ResponseDecode)?;
        if command.encode_to_vec() != prepared.command_bytes {
            return Err(RelationshipTransportFailure::ResponseDecode);
        }
        let body = command
            .body
            .as_ref()
            .ok_or(RelationshipTransportFailure::ResponseDecode)?;
        let payload_hash = Sha256::digest(&prepared.command_bytes);
        if body.command_id != prepared.command_id
            || body.target_actor.as_ref().map(|actor| actor.ptid.as_str())
                != Some(prepared.target_ptid.as_str())
            || SocialRelationshipAction::try_from(body.action).ok() != Some(prepared.action)
            || payload_hash.as_slice() != prepared.payload_sha256.as_slice()
        {
            return Err(RelationshipTransportFailure::ResponseDecode);
        }
        let transport = StationSocialTransport::new(
            self.scope.station_origin.clone(),
            self.access_token()
                .map_err(|_| RelationshipTransportFailure::Transport)?,
            self.scope.device_id.clone(),
        )
        .map_err(|_| RelationshipTransportFailure::Transport)?;
        match prepared.action {
            SocialRelationshipAction::Block => transport
                .block_actor(&BlockSocialActorRequest {
                    command: Some(command),
                })
                .map(|response| response.encode_to_vec()),
            SocialRelationshipAction::Unblock => transport
                .unblock_actor(&UnblockSocialActorRequest {
                    command: Some(command),
                })
                .map(|response| response.encode_to_vec()),
            SocialRelationshipAction::Unspecified => Err(StationTransportError::Invalid),
        }
        .map_err(map_relationship_transport_error)
    }

    pub fn lookup_social_relationship_command_result(
        &self,
        command_id: &str,
        payload_sha256: &[u8],
    ) -> Result<LookupSocialRelationshipCommandResultResponse, RelationshipTransportFailure> {
        StationSocialTransport::new(
            self.scope.station_origin.clone(),
            self.access_token()
                .map_err(|_| RelationshipTransportFailure::Transport)?,
            self.scope.device_id.clone(),
        )
        .map_err(|_| RelationshipTransportFailure::Transport)?
        .lookup_relationship_command_result(&LookupSocialRelationshipCommandResultRequest {
            command_id: command_id.to_string(),
            command_payload_sha256: payload_sha256.to_vec(),
        })
        .map_err(map_relationship_transport_error)
    }

    fn build_social_friend_request_command(
        &self,
        intent: FriendRequestCommandIntent<'_>,
    ) -> Result<FriendRequestCommand, String> {
        let authorizing_ptid = match intent.action {
            FriendRequestAction::Send => intent.sender_ptid,
            FriendRequestAction::Accept | FriendRequestAction::Reject => intent.receiver_ptid,
            FriendRequestAction::Unspecified => "",
        };
        let source_home_station_peer_id = match intent.action {
            FriendRequestAction::Send => intent.sender_home_station_peer_id,
            FriendRequestAction::Accept | FriendRequestAction::Reject => {
                intent.receiver_home_station_peer_id
            }
            FriendRequestAction::Unspecified => "",
        };
        if authorizing_ptid != self.scope.actor_ptid
            || source_home_station_peer_id != self.scope.station_peer_id
        {
            return Err(
                "mobile Social Friend Request command authority does not match the active account"
                    .to_string(),
            );
        }
        let (enrollment, signing_key) = self.store.active_device_signing_identity()?;
        let certificate = &enrollment.certificate;
        let device = certificate
            .device
            .as_ref()
            .ok_or_else(|| "mobile messaging device identity has no endpoint".to_string())?;
        if actor_device_ptid(device)? != self.scope.actor_ptid
            || device.device_id != self.scope.device_id
        {
            return Err(
                "mobile Social Friend Request signer does not match the active endpoint"
                    .to_string(),
            );
        }
        build_signed_friend_request_command(
            intent,
            &signing_key,
            &certificate.signing_key_id,
            &device.device_id,
        )
    }

    fn build_social_relationship_command(
        &self,
        intent: RelationshipCommandIntent<'_>,
    ) -> Result<SocialRelationshipCommand, String> {
        if self.scope.station_peer_id.trim().is_empty() || self.scope.actor_ptid.trim().is_empty() {
            return Err("mobile Social relationship command authority is unavailable".to_string());
        }
        let (enrollment, signing_key) = self.store.active_device_signing_identity()?;
        let certificate = &enrollment.certificate;
        let device = certificate
            .device
            .as_ref()
            .ok_or_else(|| "mobile messaging device identity has no endpoint".to_string())?;
        if actor_device_ptid(device)? != self.scope.actor_ptid
            || device.device_id != self.scope.device_id
        {
            return Err(
                "mobile Social relationship signer does not match the active endpoint".to_string(),
            );
        }
        build_signed_social_relationship_command(
            &self.scope,
            intent,
            &signing_key,
            &certificate.signing_key_id,
            &device.device_id,
        )
    }

    pub fn create_direct_conversation(
        &self,
        peer_ptid: &str,
        federation_id: &str,
    ) -> Result<PreparedDirectConversation, String> {
        let command_id = Ulid::new().to_string();
        let result = self.try_create_direct_conversation(peer_ptid, federation_id, &command_id);
        match result {
            Ok(conversation) => Ok(conversation),
            Err(error) if is_stale_endpoint_error(&error) => {
                log::warn!(
                    "mobile messaging direct creation found stale enrollment; attempting recovery"
                );
                let _ = self.recover_stale_enrollment(&error);
                self.enroll_pending_device()?;
                self.try_create_direct_conversation(peer_ptid, federation_id, &command_id)
            }
            Err(error) => Err(error),
        }
    }

    fn try_create_direct_conversation(
        &self,
        peer_ptid: &str,
        federation_id: &str,
        command_id: &str,
    ) -> Result<PreparedDirectConversation, String> {
        let response = StationConversationTransport::new(
            self.scope.station_origin.clone(),
            self.access_token()?,
            self.scope.device_id.clone(),
            self.proto_endpoint(),
        )?
        .create_direct(peer_ptid, federation_id, command_id)?;
        let conversation = response.conversation.ok_or_else(|| {
            "mobile messaging Station returned no direct conversation".to_string()
        })?;
        if conversation.conversation_id.trim().is_empty()
            || conversation.kind != ConversationKind::Direct as i32
            || conversation.status != ConversationStatus::Active as i32
            || conversation.federation_id != federation_id
            || conversation.authority_station_peer_id.trim().is_empty()
        {
            return Err("mobile messaging direct conversation response is invalid".to_string());
        }
        self.store.reconcile_conversation_authority_scope(
            &conversation.conversation_id,
            &conversation.authority_station_peer_id,
            &conversation.federation_id,
        )?;
        let conversation_id = conversation.conversation_id;
        // Reopening an existing deterministic Direct does not commit a new event.
        if let Some(event) = response.event {
            if event.command_id != command_id || event.conversation_id != conversation_id {
                return Err(
                    "mobile messaging direct creation response binding mismatch".to_string()
                );
            }
        }
        Ok(PreparedDirectConversation {
            conversation_id,
            command_id: command_id.to_string(),
        })
    }

    pub fn create_group_conversation(
        &self,
        conversation_id: &str,
        name: &str,
        member_ptids: &[String],
        federation_id: &str,
    ) -> Result<PreparedGroupConversation, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "mobile messaging send intent lock poisoned".to_string())?;
        let plan = StationConversationTransport::new(
            self.scope.station_origin.clone(),
            self.access_token()?,
            self.scope.device_id.clone(),
            self.proto_endpoint(),
        )?
        .prepare_group_genesis(conversation_id, name, member_ptids, federation_id)?;
        let command = GroupGenesisPreparer::new(
            self.store.clone(),
            self.mls_manager.clone(),
            self.proto_endpoint(),
        )?
        .prepare(&plan, conversation_id, now_unix_ms())?;
        Ok(PreparedGroupConversation {
            conversation_id: conversation_id.to_string(),
            command_id: command.command_id,
        })
    }

    pub fn submit_mls_leave_intent(&self, conversation_id: &str) -> Result<MlsLeaveIntent, String> {
        let local = self
            .store
            .conversation_projections()?
            .into_iter()
            .find(|conversation| conversation.conversation_id == conversation_id)
            .ok_or_else(|| {
                "mobile messaging self-leave requires a local Conversation projection".to_string()
            })?;
        let transport = StationMlsLeaveIntentTransport::new(
            self.scope.station_origin.clone(),
            self.access_token()?,
            self.scope.device_id.clone(),
        )?;
        let authoritative = transport.get_conversation(conversation_id)?;
        let (authority_sequence, authority_hash) = self.store.authority_head(conversation_id)?;
        let input = self_leave_intent_input(
            &self.scope,
            &local,
            &authoritative,
            authority_sequence,
            authority_hash,
        )?;
        let (enrollment, device_signing_key) = self.store.active_device_signing_identity()?;
        let signing_key = ed25519_dalek::SigningKey::from_bytes(&device_signing_key.seed_bytes());
        submit_core_leave_intent(
            &enrollment.certificate.signing_key_id,
            &signing_key,
            &self.proto_endpoint(),
            &input,
            now_unix_ms(),
            &transport,
        )
    }

    pub fn prepare_membership_transition(
        &self,
        input: &MembershipTransitionIntentInput,
    ) -> Result<ChatCommand, String> {
        let _guard = self
            .membership_transition_lock
            .lock()
            .map_err(|_| "mobile messaging membership transition lock poisoned".to_string())?;
        let created_at_unix_ms = now_unix_ms();
        let intent_id = Ulid::new().to_string();
        self.store
            .create_membership_intent(&PendingMembershipIntent {
                intent_id: intent_id.clone(),
                conversation_id: input.conversation_id.clone(),
                action: input.action as i32,
                target_ptid: input.target_ptid.clone(),
                target_device_id: input.target_device_id.clone(),
                role: input.role.clone(),
                created_at_unix_ms,
            })?;
        let plan = StationConversationTransport::new(
            self.scope.station_origin.clone(),
            self.access_token()?,
            self.scope.device_id.clone(),
            self.proto_endpoint(),
        )?
        .prepare_membership_transition(input)?;
        MembershipTransitionPreparer::new(
            self.store.clone(),
            self.mls_manager.clone(),
            self.proto_endpoint(),
        )?
        .prepare(Some(&intent_id), input, &plan, created_at_unix_ms)
    }

    pub fn update_conversation(
        &self,
        conversation_id: &str,
        name: Option<String>,
        description: Option<String>,
    ) -> Result<ChatCommand, String> {
        if name.is_none() && description.is_none() {
            return Err("mobile messaging Conversation update is empty".to_string());
        }
        if name.as_ref().is_some_and(|value| value.trim().is_empty()) {
            return Err("mobile messaging Conversation name is empty".to_string());
        }
        self.prepare_conversation_mutation(
            conversation_id,
            chat_command::Payload::UpdateConversation(UpdateConversationIntent {
                name,
                description,
                ..Default::default()
            }),
            now_unix_ms(),
        )
    }

    pub fn dissolve_conversation(&self, conversation_id: &str) -> Result<ChatCommand, String> {
        self.prepare_conversation_mutation(
            conversation_id,
            chat_command::Payload::DissolveConversation(DissolveConversationIntent {}),
            now_unix_ms(),
        )
    }

    pub fn update_member_authority(
        &self,
        conversation_id: &str,
        target_ptid: &str,
        role: Option<MemberRole>,
        muted: Option<bool>,
        muted_until_unix_ms: Option<i64>,
    ) -> Result<ProjectedMemberAuthority, MemberAuthorityCommandError> {
        self.execute_member_authority(
            conversation_id,
            target_ptid,
            ConversationMemberAuthorityAction::UpdateMember,
            role,
            muted,
            muted_until_unix_ms,
        )
    }

    pub fn transfer_ownership(
        &self,
        conversation_id: &str,
        target_ptid: &str,
    ) -> Result<ProjectedMemberAuthority, MemberAuthorityCommandError> {
        self.execute_member_authority(
            conversation_id,
            target_ptid,
            ConversationMemberAuthorityAction::TransferOwnership,
            None,
            None,
            None,
        )
    }

    fn execute_member_authority(
        &self,
        conversation_id: &str,
        target_ptid: &str,
        action: ConversationMemberAuthorityAction,
        role: Option<MemberRole>,
        muted: Option<bool>,
        muted_until_unix_ms: Option<i64>,
    ) -> Result<ProjectedMemberAuthority, MemberAuthorityCommandError> {
        let _guard = self.membership_transition_lock.lock().map_err(|_| {
            local_member_authority_error("mobile messaging member-authority lock poisoned")
        })?;
        let local = self
            .store
            .conversation_projections()
            .map_err(local_member_authority_error)?
            .into_iter()
            .find(|conversation| conversation.conversation_id == conversation_id)
            .ok_or_else(|| {
                local_member_authority_error(
                    "mobile messaging member authority requires a local Conversation projection",
                )
            })?;
        let transport = StationConversationTransport::new(
            self.scope.station_origin.clone(),
            self.access_token().map_err(local_member_authority_error)?,
            self.scope.device_id.clone(),
            self.proto_endpoint(),
        )
        .map_err(local_member_authority_error)?;
        let authoritative = transport
            .get_conversation(conversation_id)
            .map_err(local_member_authority_error)?;
        let authority_head = self
            .store
            .authority_head(conversation_id)
            .map_err(local_member_authority_error)?;
        let command = prepare_member_authority_command(
            &self.scope,
            &local,
            &authoritative,
            authority_head,
            target_ptid,
            action,
            role,
            muted,
            muted_until_unix_ms,
            now_unix_ms(),
        )
        .map_err(|error| {
            if is_stale_member_authority_code(&error.code) {
                let _ = self.drain_once();
            }
            error
        })?;
        self.store
            .persist_member_authority_command(&command)
            .map_err(local_member_authority_error)?;
        let _ = self
            .dispatch_command_once()
            .map_err(local_member_authority_error)?;
        let projection = self.reconcile_member_authority_command(&command)?;
        Ok(ProjectedMemberAuthority {
            command_id: command.command_id.clone(),
            conversation_id: command.conversation_id,
            state: if projection.is_some() {
                "projected"
            } else {
                "pending"
            },
            projection,
        })
    }

    fn reconcile_member_authority_command(
        &self,
        command: &ConversationMemberAuthorityCommand,
    ) -> Result<Option<MobileMemberAuthorityProjection>, MemberAuthorityCommandError> {
        for attempt in 0..MEMBER_AUTHORITY_RECONCILE_ATTEMPTS {
            if let Some(projection) = self
                .store
                .mobile_member_authority_projection(&command.conversation_id)
                .map_err(local_member_authority_error)?
            {
                if projection.authority_sequence > command.authority_sequence {
                    let status = self
                        .command_status(&command.command_id)
                        .map_err(local_member_authority_error)?;
                    if status
                        .as_ref()
                        .is_some_and(|status| status.state == "committed")
                    {
                        return Ok(Some(projection));
                    }
                }
            }
            if let Some(status) = self
                .command_status(&command.command_id)
                .map_err(local_member_authority_error)?
            {
                if matches!(status.state.as_str(), "failed" | "superseded") {
                    return Err(MemberAuthorityCommandError {
                        code: status.last_error_code,
                        message: "mobile member-authority command was rejected".to_string(),
                    });
                }
            }
            self.drain_once().map_err(local_member_authority_error)?;
            if attempt + 1 < MEMBER_AUTHORITY_RECONCILE_ATTEMPTS {
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
        }
        Ok(None)
    }

    fn prepare_conversation_mutation(
        &self,
        conversation_id: &str,
        payload: chat_command::Payload,
        created_at_unix_ms: i64,
    ) -> Result<ChatCommand, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "mobile messaging send intent lock poisoned".to_string())?;
        let token = self.access_token()?;
        let plan = self.prepare_send_plan(&token, conversation_id)?;
        let command_id = Ulid::new().to_string();
        let command = prepare_conversation_mutation_command(
            &plan,
            self.proto_endpoint(),
            &command_id,
            payload,
            created_at_unix_ms,
        )?;
        self.store
            .persist_conversation_command(&ConversationCommandCommit {
                command: &command,
                expected_authority_sequence: plan.authority_sequence,
                expected_authority_hash: &plan.authority_hash,
                created_at_unix_ms,
            })?;
        Ok(command)
    }

    pub fn resume_membership_intent_once(&self) -> Result<bool, String> {
        let _guard = self
            .membership_transition_lock
            .lock()
            .map_err(|_| "mobile messaging membership transition lock poisoned".to_string())?;
        let Some(intent) = self.store.pending_membership_intents()?.into_iter().next() else {
            return Ok(false);
        };
        self.mls_manager
            .discard_pending_transition(&intent.conversation_id);
        let action = MessagingMembershipAction::try_from(intent.action)
            .map_err(|_| "persisted mobile messaging membership action is invalid".to_string())?;
        let input = MembershipTransitionIntentInput {
            conversation_id: intent.conversation_id,
            action,
            target_ptid: intent.target_ptid,
            target_device_id: intent.target_device_id,
            role: intent.role,
            leave_intent: None,
        };
        let plan = StationConversationTransport::new(
            self.scope.station_origin.clone(),
            self.access_token()?,
            self.scope.device_id.clone(),
            self.proto_endpoint(),
        )?
        .prepare_membership_transition(&input)?;
        MembershipTransitionPreparer::new(
            self.store.clone(),
            self.mls_manager.clone(),
            self.proto_endpoint(),
        )?
        .prepare(Some(&intent.intent_id), &input, &plan, now_unix_ms())?;
        Ok(true)
    }

    pub fn conversation_messages(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationMessageProjection>, String> {
        self.store.conversation_message_projections(conversation_id)
    }

    pub fn conversation_summary(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationSummary, String> {
        self.store
            .conversation_summary(conversation_id, &self.scope.actor_ptid)
    }

    pub fn thread_messages(
        &self,
        conversation_id: &str,
        thread_root_message_id: &str,
    ) -> Result<Vec<ConversationMessageProjection>, String> {
        self.store
            .thread_message_projections(conversation_id, thread_root_message_id)
    }

    pub fn search_messages(
        &self,
        conversation_id: &str,
        query: &str,
        before: Option<(i64, &str)>,
        limit: usize,
    ) -> Result<Vec<ConversationMessageProjection>, String> {
        self.store
            .search_message_projections(conversation_id, query, before, limit)
    }

    pub fn command_status(
        &self,
        command_id: &str,
    ) -> Result<Option<CommandStatusProjection>, String> {
        self.store.command_status(command_id)
    }

    pub fn attachment_availability_state(
        &self,
        attachment_id: &str,
    ) -> Result<Option<String>, String> {
        self.store.attachment_availability_state(attachment_id)
    }

    pub fn begin_attachment_stage(
        &self,
        filename: &str,
        mime_type: &str,
        plaintext_size: u64,
        content_kind: i32,
        duration_ms: u32,
        voice_note: Option<VoiceNoteMetadata>,
    ) -> Result<MessagingAttachmentStage, String> {
        if filename.trim().is_empty()
            || filename.len() > 1024
            || mime_type.trim().is_empty()
            || mime_type.len() > 255
            || plaintext_size == 0
            || plaintext_size > ATTACHMENT_MAX_PLAINTEXT_SIZE
        {
            return Err("mobile messaging attachment stage is invalid".to_string());
        }
        validate_attachment_content_metadata(mime_type, content_kind, duration_ms)?;
        messaging_core::codec::private_content::validate_voice_note_metadata(
            mime_type,
            voice_note.as_ref(),
        )?;
        let _guard = self
            .attachment_source_lock
            .lock()
            .map_err(|_| "mobile messaging attachment source lock poisoned".to_string())?;
        let stage_id = Ulid::new().to_string();
        let path = self.attachment_stage_path(&stage_id)?;
        let parent = path
            .parent()
            .ok_or_else(|| "mobile messaging attachment stage parent is unavailable".to_string())?;
        std::fs::create_dir_all(parent).map_err(|error| {
            format!("create mobile messaging attachment source directory: {error}")
        })?;
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(&path)
            .and_then(|file| file.sync_all())
            .map_err(|error| format!("create mobile messaging attachment stage: {error}"))?;
        let stage = StagedAttachment {
            filename: filename.to_string(),
            mime_type: mime_type.to_string(),
            plaintext_size,
            content_kind,
            duration_ms,
            voice_note,
            written_size: 0,
            completed: false,
        };
        self.attachment_stages
            .lock()
            .map_err(|_| "mobile messaging attachment stage lock poisoned".to_string())?
            .insert(stage_id.clone(), stage.clone());
        Ok(MessagingAttachmentStage {
            stage_id,
            filename: stage.filename,
            mime_type: stage.mime_type,
            plaintext_size,
            content_kind: stage.content_kind,
            duration_ms: stage.duration_ms,
            voice_note: stage.voice_note,
            completed: false,
        })
    }

    pub fn write_attachment_stage(
        &self,
        stage_id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<MessagingAttachmentStage, String> {
        if bytes.is_empty() || bytes.len() > ATTACHMENT_STAGE_CHUNK_SIZE {
            return Err("mobile messaging attachment stage chunk is invalid".to_string());
        }
        let _guard = self
            .attachment_source_lock
            .lock()
            .map_err(|_| "mobile messaging attachment source lock poisoned".to_string())?;
        let mut stages = self
            .attachment_stages
            .lock()
            .map_err(|_| "mobile messaging attachment stage lock poisoned".to_string())?;
        let stage = stages
            .get_mut(stage_id)
            .ok_or_else(|| "mobile messaging attachment stage is unavailable".to_string())?;
        let next_size = offset
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| "mobile messaging attachment stage size overflow".to_string())?;
        if stage.completed || offset != stage.written_size || next_size > stage.plaintext_size {
            return Err("mobile messaging attachment stage write is not contiguous".to_string());
        }
        self.attachment_blobs()?.write_chunk(
            self.attachment_stage_ref(stage_id)?.as_str(),
            offset,
            bytes,
        )?;
        stage.written_size = next_size;
        Ok(MessagingAttachmentStage {
            stage_id: stage_id.to_string(),
            filename: stage.filename.clone(),
            mime_type: stage.mime_type.clone(),
            plaintext_size: stage.plaintext_size,
            content_kind: stage.content_kind,
            duration_ms: stage.duration_ms,
            voice_note: stage.voice_note.clone(),
            completed: false,
        })
    }

    pub fn complete_attachment_stage(
        &self,
        stage_id: &str,
    ) -> Result<MessagingAttachmentStage, String> {
        let _guard = self
            .attachment_source_lock
            .lock()
            .map_err(|_| "mobile messaging attachment source lock poisoned".to_string())?;
        let mut stages = self
            .attachment_stages
            .lock()
            .map_err(|_| "mobile messaging attachment stage lock poisoned".to_string())?;
        let stage = stages
            .get_mut(stage_id)
            .ok_or_else(|| "mobile messaging attachment stage is unavailable".to_string())?;
        let path = self.attachment_stage_ref(stage_id)?;
        if stage.written_size != stage.plaintext_size
            || self.attachment_blobs()?.len(&path)? != stage.plaintext_size
        {
            return Err("mobile messaging attachment stage is incomplete".to_string());
        }
        stage.completed = true;
        Ok(MessagingAttachmentStage {
            stage_id: stage_id.to_string(),
            filename: stage.filename.clone(),
            mime_type: stage.mime_type.clone(),
            plaintext_size: stage.plaintext_size,
            content_kind: stage.content_kind,
            duration_ms: stage.duration_ms,
            voice_note: stage.voice_note.clone(),
            completed: true,
        })
    }

    pub fn discard_attachment_stage(&self, stage_id: &str) -> Result<(), String> {
        let _guard = self
            .attachment_source_lock
            .lock()
            .map_err(|_| "mobile messaging attachment source lock poisoned".to_string())?;
        let path = self.attachment_stage_ref(stage_id)?;
        if self.store.owns_attachment_source(&path)? {
            return Ok(());
        }
        self.attachment_stages
            .lock()
            .map_err(|_| "mobile messaging attachment stage lock poisoned".to_string())?
            .remove(stage_id);
        self.attachment_blobs()?.remove(&path)
    }

    pub fn submit_message(
        &self,
        conversation_id: &str,
        plaintext: &str,
        reply_to_message_id: &str,
        thread_root_message_id: &str,
        attachment_stage_ids: &[String],
    ) -> Result<MessagingSubmitMessageOutcome, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "mobile messaging send intent lock poisoned".to_string())?;
        if conversation_id.trim().is_empty()
            || (plaintext.is_empty() && attachment_stage_ids.is_empty())
        {
            return Err("mobile messaging message intent is incomplete".to_string());
        }
        if !attachment_stage_ids.is_empty() {
            return self.create_attachment_message_draft(
                ConversationCommandKind::SendMessage,
                conversation_id,
                plaintext,
                reply_to_message_id,
                thread_root_message_id,
                attachment_stage_ids,
            );
        }
        let token = self.access_token()?;
        let plan = self.prepare_send_plan(&token, conversation_id)?;
        let command_id = Ulid::new().to_string();
        let message_id = Ulid::new().to_string();
        let created_at_unix_ms = now_unix_ms();
        let endpoint = self.proto_endpoint();
        match ConversationKind::try_from(plan.conversation_kind)
            .map_err(|_| "mobile messaging conversation kind is invalid".to_string())?
        {
            ConversationKind::Direct => {
                let bootstraps = DirectSessionBootstrapper::new(
                    self.store.clone(),
                    self.core_endpoint(),
                    self.actor_identity.clone(),
                )?
                .prepare_missing(
                    conversation_id,
                    &plan.required_endpoints,
                    created_at_unix_ms,
                    &StationKeyBundleTransport::new(
                        self.scope.station_origin.clone(),
                        token,
                        self.scope.device_id.clone(),
                    )?,
                )?;
                DirectOutboundPreparer::new(self.store.clone(), endpoint)?.prepare_send(
                    &plan,
                    &DirectSendIntent {
                        command_id: &command_id,
                        message_id: &message_id,
                        conversation_id,
                        plaintext,
                        reply_to_message_id,
                        thread_root_message_id,
                        attachments: &[],
                        client_timestamp_unix_ms: created_at_unix_ms,
                    },
                    &bootstraps,
                )?;
            }
            ConversationKind::Group => {
                MlsOutboundPreparer::new(self.store.clone(), self.mls_manager.clone(), endpoint)?
                    .prepare_send(
                    &plan,
                    &GroupSendTextIntent {
                        command_id: &command_id,
                        message_id: &message_id,
                        conversation_id,
                        plaintext,
                        reply_to_message_id,
                        thread_root_message_id,
                        attachments: &[],
                        client_timestamp_unix_ms: created_at_unix_ms,
                    },
                )?;
            }
            ConversationKind::Unspecified => {
                return Err("mobile messaging conversation kind is required".to_string());
            }
        }
        Ok(MessagingSubmitMessageOutcome {
            command_id: Some(command_id),
            message_id,
            attachment_ids: Vec::new(),
            state: "pending",
        })
    }

    pub fn forward_message(
        &self,
        source_conversation_id: &str,
        source_message_id: &str,
        destination_conversation_id: &str,
    ) -> Result<MessagingSubmitMessageOutcome, String> {
        if source_conversation_id.trim().is_empty()
            || source_message_id.trim().is_empty()
            || destination_conversation_id.trim().is_empty()
        {
            return Err("mobile messaging forward intent is incomplete".to_string());
        }
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "mobile messaging send intent lock poisoned".to_string())?;
        let source = self
            .store
            .conversation_message_projections(source_conversation_id)?
            .into_iter()
            .find(|message| message.message_id == source_message_id)
            .ok_or_else(|| "mobile messaging forward source is unavailable".to_string())?;
        if source.retracted || source.event_id.is_none() || source.event_sequence.is_none() {
            return Err("mobile messaging forward source is not visible".to_string());
        }
        if source.plaintext.is_empty() && source.attachments.is_empty() {
            return Err("mobile messaging forward source has no content".to_string());
        }
        if !source.attachments.is_empty() {
            return self.create_forward_attachment_draft(
                source_conversation_id,
                &source,
                destination_conversation_id,
            );
        }

        let token = self.access_token()?;
        let plan = self.prepare_command_plan(
            &token,
            destination_conversation_id,
            ConversationCommandKind::ForwardMessage,
        )?;
        let command_id = Ulid::new().to_string();
        let destination_message_id = Ulid::new().to_string();
        let created_at_unix_ms = now_unix_ms();
        let endpoint = self.proto_endpoint();
        match ConversationKind::try_from(plan.conversation_kind)
            .map_err(|_| "mobile messaging destination kind is invalid".to_string())?
        {
            ConversationKind::Direct => {
                let bootstraps = DirectSessionBootstrapper::new(
                    self.store.clone(),
                    self.core_endpoint(),
                    self.actor_identity.clone(),
                )?
                .prepare_missing(
                    destination_conversation_id,
                    &plan.required_endpoints,
                    created_at_unix_ms,
                    &StationKeyBundleTransport::new(
                        self.scope.station_origin.clone(),
                        token,
                        self.scope.device_id.clone(),
                    )?,
                )?;
                DirectOutboundPreparer::new(self.store.clone(), endpoint)?.prepare_forward(
                    &plan,
                    &DirectForwardIntent {
                        command_id: &command_id,
                        destination_message_id: &destination_message_id,
                        conversation_id: destination_conversation_id,
                        plaintext: &source.plaintext,
                        attachments: &[],
                        client_timestamp_unix_ms: created_at_unix_ms,
                    },
                    &bootstraps,
                )?;
            }
            ConversationKind::Group => {
                MlsOutboundPreparer::new(self.store.clone(), self.mls_manager.clone(), endpoint)?
                    .prepare_forward(
                    &plan,
                    &GroupForwardIntent {
                        command_id: &command_id,
                        destination_message_id: &destination_message_id,
                        conversation_id: destination_conversation_id,
                        plaintext: &source.plaintext,
                        attachments: &[],
                        client_timestamp_unix_ms: created_at_unix_ms,
                    },
                )?;
            }
            ConversationKind::Unspecified => {
                return Err("mobile messaging destination kind is required".to_string());
            }
        }
        Ok(MessagingSubmitMessageOutcome {
            command_id: Some(command_id),
            message_id: destination_message_id,
            attachment_ids: Vec::new(),
            state: "pending",
        })
    }

    fn create_forward_attachment_draft(
        &self,
        source_conversation_id: &str,
        source: &ConversationMessageProjection,
        destination_conversation_id: &str,
    ) -> Result<MessagingSubmitMessageOutcome, String> {
        let destination = self
            .store
            .conversation_projections()?
            .into_iter()
            .find(|conversation| conversation.conversation_id == destination_conversation_id)
            .ok_or_else(|| {
                "mobile messaging destination Conversation projection is unavailable".to_string()
            })?;
        if !destination.active || destination.authority_station_id.trim().is_empty() {
            return Err("mobile messaging destination Conversation is not active".to_string());
        }
        let conversation_kind = ConversationKind::try_from(destination.kind)
            .map_err(|_| "mobile messaging destination kind is invalid".to_string())?;
        if conversation_kind == ConversationKind::Unspecified {
            return Err("mobile messaging destination kind is required".to_string());
        }

        let _source_guard = self
            .attachment_source_lock
            .lock()
            .map_err(|_| "mobile messaging attachment source lock poisoned".to_string())?;
        let blobs = self.attachment_blobs()?;
        let destination_message_id = Ulid::new().to_string();
        let created_at_unix_ms = now_unix_ms();
        let mut staged_refs = Vec::with_capacity(source.attachments.len());
        let result = (|| {
            let mut uploads = Vec::with_capacity(source.attachments.len());
            for attachment in &source.attachments {
                if let Some(sender_source) = self
                    .store
                    .completed_sender_attachment_source(&attachment.attachment_id)?
                {
                    if sender_source.message_id != source.message_id {
                        return Err(
                            "mobile messaging forward attachment source message mismatch"
                                .to_string(),
                        );
                    }
                    self.promote_sender_attachment_cache(&blobs, &sender_source)?;
                }
                let projection = self
                    .store
                    .attachment_download_projection(&attachment.attachment_id)?
                    .ok_or_else(|| {
                        "mobile messaging forward attachment projection is unavailable".to_string()
                    })?;
                if projection.conversation_id != source_conversation_id
                    || projection.message_id != source.message_id
                    || projection.metadata != *attachment
                {
                    return Err(
                        "mobile messaging forward attachment projection mismatch".to_string()
                    );
                }
                let cache_ref = projection.local_cache_path.as_deref().ok_or_else(|| {
                    "mobile messaging forward attachment must be downloaded first".to_string()
                })?;
                let expected_plaintext_sha256: [u8; 32] = attachment
                    .plaintext_sha256
                    .as_slice()
                    .try_into()
                    .map_err(|_| {
                        "mobile messaging forward attachment commitment is invalid".to_string()
                    })?;
                let stage_id = Ulid::new().to_string();
                let stage_ref = self.attachment_stage_ref(&stage_id)?;
                staged_refs.push(stage_ref.clone());
                copy_verified_attachment_source(
                    &blobs,
                    cache_ref,
                    &stage_ref,
                    attachment.plaintext_size,
                    &expected_plaintext_sha256,
                )?;
                let stage = StagedAttachment {
                    filename: attachment.filename.clone(),
                    mime_type: attachment.mime_type.clone(),
                    plaintext_size: attachment.plaintext_size,
                    content_kind: attachment.content_kind,
                    duration_ms: attachment.duration_ms,
                    voice_note: attachment.voice_note.clone(),
                    written_size: attachment.plaintext_size,
                    completed: true,
                };
                uploads.push(prepare_local_attachment_upload(
                    &blobs,
                    destination_conversation_id,
                    &destination_message_id,
                    &destination.authority_station_id,
                    &stage_ref,
                    &stage,
                    created_at_unix_ms,
                )?);
            }
            self.persist_attachment_message_draft(
                ConversationCommandKind::ForwardMessage,
                conversation_kind,
                destination_conversation_id,
                &destination_message_id,
                &source.plaintext,
                "",
                "",
                created_at_unix_ms,
                &mut uploads,
            )
        })();
        if result.is_err() {
            for stage_ref in &staged_refs {
                let _ = blobs.remove(stage_ref);
            }
        }
        result
    }

    fn create_attachment_message_draft(
        &self,
        command_kind: ConversationCommandKind,
        conversation_id: &str,
        plaintext: &str,
        reply_to_message_id: &str,
        thread_root_message_id: &str,
        attachment_stage_ids: &[String],
    ) -> Result<MessagingSubmitMessageOutcome, String> {
        let conversation = self
            .store
            .conversation_projections()?
            .into_iter()
            .find(|conversation| conversation.conversation_id == conversation_id)
            .ok_or_else(|| "mobile messaging conversation projection is unavailable".to_string())?;
        if !conversation.active || conversation.authority_station_id.trim().is_empty() {
            return Err("mobile messaging conversation is not active".to_string());
        }
        let conversation_kind = ConversationKind::try_from(conversation.kind)
            .map_err(|_| "mobile messaging conversation kind is invalid".to_string())?;
        if conversation_kind == ConversationKind::Unspecified {
            return Err("mobile messaging conversation kind is required".to_string());
        }

        let _source_guard = self
            .attachment_source_lock
            .lock()
            .map_err(|_| "mobile messaging attachment source lock poisoned".to_string())?;
        let mut stages = self
            .attachment_stages
            .lock()
            .map_err(|_| "mobile messaging attachment stage lock poisoned".to_string())?;
        let mut seen = std::collections::HashSet::with_capacity(attachment_stage_ids.len());
        if attachment_stage_ids
            .iter()
            .any(|stage_id| !seen.insert(stage_id.as_str()))
        {
            return Err("mobile messaging attachment stage is duplicated".to_string());
        }

        let message_id = Ulid::new().to_string();
        let created_at_unix_ms = now_unix_ms();
        let blobs = self.attachment_blobs()?;
        let mut uploads = attachment_stage_ids
            .iter()
            .map(|stage_id| {
                let stage = stages.get(stage_id).ok_or_else(|| {
                    "mobile messaging attachment stage is unavailable".to_string()
                })?;
                if !stage.completed {
                    return Err("mobile messaging attachment stage is incomplete".to_string());
                }
                prepare_local_attachment_upload(
                    &blobs,
                    conversation_id,
                    &message_id,
                    &conversation.authority_station_id,
                    &self.attachment_stage_ref(stage_id)?,
                    stage,
                    created_at_unix_ms,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        let outcome = self.persist_attachment_message_draft(
            command_kind,
            conversation_kind,
            conversation_id,
            &message_id,
            plaintext,
            reply_to_message_id,
            thread_root_message_id,
            created_at_unix_ms,
            &mut uploads,
        )?;
        for stage_id in attachment_stage_ids {
            stages.remove(stage_id);
        }
        Ok(outcome)
    }

    #[allow(clippy::too_many_arguments)]
    fn persist_attachment_message_draft(
        &self,
        command_kind: ConversationCommandKind,
        conversation_kind: ConversationKind,
        conversation_id: &str,
        message_id: &str,
        plaintext: &str,
        reply_to_message_id: &str,
        thread_root_message_id: &str,
        created_at_unix_ms: i64,
        uploads: &mut Vec<PendingAttachmentUpload>,
    ) -> Result<MessagingSubmitMessageOutcome, String> {
        let aggregate_plaintext_size = uploads.iter().try_fold(0_u64, |total, upload| {
            total
                .checked_add(upload.transfer.plaintext_size)
                .ok_or_else(|| {
                    "mobile messaging attachment aggregate size exceeds policy".to_string()
                })
        })?;
        if aggregate_plaintext_size > ATTACHMENT_MAX_PLAINTEXT_SIZE {
            return Err("mobile messaging attachment aggregate size exceeds policy".to_string());
        }
        uploads.sort_by(|left, right| {
            left.transfer
                .attachment_id
                .cmp(&right.transfer.attachment_id)
        });
        let attachment_ids = uploads
            .iter()
            .map(|upload| upload.transfer.attachment_id.clone())
            .collect::<Vec<_>>();
        self.store.create_message_draft_with_uploads(
            &PendingMessageDraft {
                conversation_id: conversation_id.to_string(),
                conversation_kind: conversation_kind as i32,
                command_kind: command_kind as i32,
                message_id: message_id.to_string(),
                sender_ptid: self.scope.actor_ptid.clone(),
                sender_device_id: self.scope.device_id.clone(),
                plaintext: plaintext.to_string(),
                reply_to_message_id: reply_to_message_id.to_string(),
                thread_root_message_id: thread_root_message_id.to_string(),
                attachments: Vec::new(),
                attempt_count: 0,
                created_at_unix_ms,
            },
            uploads,
        )?;
        Ok(MessagingSubmitMessageOutcome {
            command_id: None,
            message_id: message_id.to_string(),
            attachment_ids,
            state: "draft",
        })
    }

    pub fn submit_edit(
        &self,
        conversation_id: &str,
        message_id: &str,
        plaintext: &str,
    ) -> Result<String, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "mobile messaging send intent lock poisoned".to_string())?;
        if conversation_id.trim().is_empty()
            || message_id.trim().is_empty()
            || plaintext.trim().is_empty()
        {
            return Err("mobile messaging edit intent is incomplete".to_string());
        }
        if self
            .store
            .message_sender(conversation_id, message_id)?
            .as_deref()
            != Some(self.scope.actor_ptid.as_str())
        {
            return Err("mobile messaging edit target is not authored by this actor".to_string());
        }
        let token = self.access_token()?;
        let plan = self.prepare_send_plan(&token, conversation_id)?;
        let command_id = Ulid::new().to_string();
        let created_at_unix_ms = now_unix_ms();
        self.prepare_edit_with_plan(
            &token,
            &plan,
            &command_id,
            None,
            &command_id,
            message_id,
            plaintext.trim(),
            created_at_unix_ms,
        )?;
        Ok(command_id)
    }

    pub fn submit_metadata_interaction(
        &self,
        conversation_id: &str,
        message_id: &str,
        interaction: MetadataInteraction<'_>,
    ) -> Result<String, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "mobile messaging send intent lock poisoned".to_string())?;
        if conversation_id.trim().is_empty() || message_id.trim().is_empty() {
            return Err("mobile messaging interaction target is required".to_string());
        }
        let token = self.access_token()?;
        let command_kind = match interaction {
            MetadataInteraction::HideForActor => ConversationCommandKind::HideMessageForActor,
            MetadataInteraction::Moderate { .. } => ConversationCommandKind::ModerateMessage,
            MetadataInteraction::Retract => ConversationCommandKind::RetractMessage,
            MetadataInteraction::Reaction { .. } => ConversationCommandKind::React,
            MetadataInteraction::Pin { .. } => ConversationCommandKind::PinMessage,
        };
        let plan = self.prepare_command_plan(&token, conversation_id, command_kind)?;
        let command_id = Ulid::new().to_string();
        self.prepare_metadata_with_plan(
            &plan,
            &command_id,
            None,
            &command_id,
            message_id,
            interaction,
            now_unix_ms(),
        )?;
        Ok(command_id)
    }

    pub fn resume_superseded_interaction_once(&self) -> Result<bool, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "mobile messaging send intent lock poisoned".to_string())?;
        if let Some(intent) = self.store.next_superseded_conversation_command()? {
            let command = ChatCommand::decode(intent.command_bytes.as_slice()).map_err(|_| {
                "mobile messaging superseded Conversation command is invalid".to_string()
            })?;
            if command.command_id != intent.command_id
                || command.conversation_id != intent.conversation_id
                || command.sender.as_ref() != Some(&self.proto_endpoint())
            {
                return Err(
                    "mobile messaging superseded Conversation command binding mismatch".to_string(),
                );
            }
            let payload = match command.payload {
                Some(payload @ chat_command::Payload::UpdateConversation(_))
                | Some(payload @ chat_command::Payload::DissolveConversation(_)) => payload,
                _ => {
                    return Err(
                        "mobile messaging superseded Conversation payload mismatch".to_string()
                    )
                }
            };
            let token = self.access_token()?;
            let plan = self.prepare_send_plan(&token, &intent.conversation_id)?;
            let replacement_command_id =
                replacement_command_id(&intent.command_id, &plan.delivery_plan_sha256);
            if self.command_status(&replacement_command_id)?.is_none() {
                let replacement = prepare_conversation_mutation_command(
                    &plan,
                    self.proto_endpoint(),
                    &replacement_command_id,
                    payload,
                    intent.created_at_unix_ms,
                )?;
                self.store
                    .persist_conversation_command(&ConversationCommandCommit {
                        command: &replacement,
                        expected_authority_sequence: plan.authority_sequence,
                        expected_authority_hash: &plan.authority_hash,
                        created_at_unix_ms: intent.created_at_unix_ms,
                    })?;
            }
            self.store.mark_conversation_command_reprepared(
                &intent.command_id,
                &replacement_command_id,
            )?;
            return Ok(true);
        }
        let Some(intent) = self.store.next_superseded_interaction()? else {
            return Ok(false);
        };
        let command = ChatCommand::decode(intent.command_bytes.as_slice()).map_err(|_| {
            "mobile messaging superseded interaction command is invalid".to_string()
        })?;
        if command.command_id != intent.command_id
            || command.conversation_id != intent.conversation_id
            || command.sender.as_ref() != Some(&self.proto_endpoint())
        {
            return Err("mobile messaging superseded interaction binding mismatch".to_string());
        }
        let token = self.access_token()?;
        let plan = self.prepare_send_plan(&token, &intent.conversation_id)?;
        let replacement_command_id =
            replacement_command_id(&intent.command_id, &plan.delivery_plan_sha256);
        if self.command_status(&replacement_command_id)?.is_none() {
            match command.payload {
                Some(chat_command::Payload::EditMessage(edit))
                    if intent.interaction_kind == "edit"
                        && edit.message_id == intent.target_message_id =>
                {
                    let edited_text = intent.edited_text.as_deref().ok_or_else(|| {
                        "mobile messaging superseded edit content is unavailable".to_string()
                    })?;
                    self.prepare_edit_with_plan(
                        &token,
                        &plan,
                        &intent.intent_id,
                        Some(&intent.command_id),
                        &replacement_command_id,
                        &intent.target_message_id,
                        edited_text,
                        intent.created_at_unix_ms,
                    )?;
                }
                Some(chat_command::Payload::RetractMessage(retract))
                    if intent.interaction_kind == "retract"
                        && retract.message_id == intent.target_message_id =>
                {
                    self.prepare_metadata_with_plan(
                        &plan,
                        &intent.intent_id,
                        Some(&intent.command_id),
                        &replacement_command_id,
                        &intent.target_message_id,
                        MetadataInteraction::Retract,
                        intent.created_at_unix_ms,
                    )?;
                }
                Some(chat_command::Payload::Reaction(reaction))
                    if matches!(
                        intent.interaction_kind.as_str(),
                        "reaction-add" | "reaction-remove"
                    ) && reaction.message_id == intent.target_message_id
                        && reaction.remove == (intent.interaction_kind == "reaction-remove") =>
                {
                    self.prepare_metadata_with_plan(
                        &plan,
                        &intent.intent_id,
                        Some(&intent.command_id),
                        &replacement_command_id,
                        &intent.target_message_id,
                        MetadataInteraction::Reaction {
                            reaction: &reaction.reaction,
                            remove: reaction.remove,
                        },
                        intent.created_at_unix_ms,
                    )?;
                }
                Some(chat_command::Payload::PinMessage(pin))
                    if matches!(intent.interaction_kind.as_str(), "pin" | "unpin")
                        && pin.message_id == intent.target_message_id
                        && pin.remove == (intent.interaction_kind == "unpin") =>
                {
                    self.prepare_metadata_with_plan(
                        &plan,
                        &intent.intent_id,
                        Some(&intent.command_id),
                        &replacement_command_id,
                        &intent.target_message_id,
                        MetadataInteraction::Pin { remove: pin.remove },
                        intent.created_at_unix_ms,
                    )?;
                }
                _ => {
                    return Err(
                        "mobile messaging superseded interaction payload mismatch".to_string()
                    );
                }
            }
        }
        self.store
            .mark_interaction_reprepared(&intent.command_id, &replacement_command_id)?;
        Ok(true)
    }

    fn prepare_edit_with_plan(
        &self,
        access_token: &str,
        plan: &PrepareConversationCommandResponse,
        logical_intent_id: &str,
        replaces_command_id: Option<&str>,
        command_id: &str,
        message_id: &str,
        plaintext: &str,
        created_at_unix_ms: i64,
    ) -> Result<(), String> {
        let endpoint = self.proto_endpoint();
        match ConversationKind::try_from(plan.conversation_kind)
            .map_err(|_| "mobile messaging conversation kind is invalid".to_string())?
        {
            ConversationKind::Direct => {
                let bootstraps = DirectSessionBootstrapper::new(
                    self.store.clone(),
                    self.core_endpoint(),
                    self.actor_identity.clone(),
                )?
                .prepare_missing(
                    &plan.conversation_id,
                    &plan.required_endpoints,
                    created_at_unix_ms,
                    &StationKeyBundleTransport::new(
                        self.scope.station_origin.clone(),
                        access_token.to_string(),
                        self.scope.device_id.clone(),
                    )?,
                )?;
                DirectOutboundPreparer::new(self.store.clone(), endpoint)?.prepare_edit(
                    plan,
                    &DirectEditIntent {
                        logical_intent_id,
                        replaces_command_id,
                        command_id,
                        message_id,
                        conversation_id: &plan.conversation_id,
                        plaintext,
                        client_timestamp_unix_ms: created_at_unix_ms,
                    },
                    &bootstraps,
                )?;
            }
            ConversationKind::Group => {
                MlsOutboundPreparer::new(self.store.clone(), self.mls_manager.clone(), endpoint)?
                    .prepare_edit(
                    plan,
                    &GroupEditTextIntent {
                        logical_intent_id,
                        replaces_command_id,
                        command_id,
                        message_id,
                        conversation_id: &plan.conversation_id,
                        plaintext,
                        client_timestamp_unix_ms: created_at_unix_ms,
                    },
                )?;
            }
            ConversationKind::Unspecified => {
                return Err("mobile messaging edit conversation kind is required".to_string());
            }
        }
        Ok(())
    }

    fn prepare_metadata_with_plan(
        &self,
        plan: &PrepareConversationCommandResponse,
        logical_intent_id: &str,
        replaces_command_id: Option<&str>,
        command_id: &str,
        message_id: &str,
        interaction: MetadataInteraction<'_>,
        created_at_unix_ms: i64,
    ) -> Result<(), String> {
        MetadataInteractionPreparer::new(self.store.clone(), self.proto_endpoint())?.prepare(
            plan,
            logical_intent_id,
            replaces_command_id,
            command_id,
            message_id,
            interaction,
            created_at_unix_ms,
        )?;
        Ok(())
    }

    pub fn submit_read_cursor(
        &self,
        conversation_id: &str,
        last_read_sequence: i64,
    ) -> Result<(), String> {
        if conversation_id.trim().is_empty() || last_read_sequence <= 0 {
            return Err("mobile messaging read cursor is incomplete".to_string());
        }
        let (authority_sequence, _) =
            MessagingRepository::authority_head(self.store.as_ref(), conversation_id)?;
        if last_read_sequence > authority_sequence {
            return Err("mobile messaging read cursor exceeds local authority head".to_string());
        }
        let now = now_unix_ms();
        let token = self.access_token()?;
        StationCommandTransport::new(
            self.scope.station_origin.clone(),
            token,
            self.scope.device_id.clone(),
        )?
        .submit_read_cursor(&SubmitConversationReadCursorRequest {
            cursor: Some(ActorReadCursor {
                conversation_id: conversation_id.to_string(),
                reader_ptid: self.scope.actor_ptid.clone(),
                last_read_sequence,
                updated_at: Some(timestamp(now)),
            }),
        })?;
        self.store.update_read_cursor(
            conversation_id,
            &self.scope.actor_ptid,
            last_read_sequence,
            now,
        )
    }

    pub fn submit_typing(&self, conversation_id: &str, is_typing: bool) -> Result<(), String> {
        if conversation_id.trim().is_empty() {
            return Err("mobile messaging typing conversation ID is required".to_string());
        }
        self.store
            .conversation_authority_station_id(conversation_id)?;
        let token = self.access_token()?;
        StationCommandTransport::new(
            self.scope.station_origin.clone(),
            token,
            self.scope.device_id.clone(),
        )?
        .submit_typing(&SubmitConversationTypingRequest {
            conversation_id: conversation_id.to_string(),
            sender: Some(actor_device_ref(
                self.scope.actor_ptid.clone(),
                self.scope.device_id.clone(),
            )),
            pulse_generation: u64::try_from(now_unix_ms())
                .map_err(|_| "mobile messaging typing generation is invalid".to_string())?,
            expires_at: Some(timestamp(now_unix_ms().saturating_add(5_000))),
            is_typing,
        })
    }

    pub(crate) fn store(&self) -> &MobileMessagingStore {
        self.store.as_ref()
    }

    pub(crate) fn secure_content_runtime_identity(
        &self,
    ) -> Result<SecureContentRuntimeIdentity, String> {
        let (enrollment, device_signing_key) = self.store.active_device_signing_identity()?;
        let certificate = enrollment.certificate;
        let device = certificate
            .device
            .as_ref()
            .ok_or_else(|| "mobile secure content device identity has no endpoint".to_string())?;
        if actor_device_ptid(device)? != self.scope.actor_ptid
            || device.device_id != self.scope.device_id
            || device_signing_key.device_id() != self.scope.device_id
            || certificate.signing_key_id.trim().is_empty()
            || certificate.observed_profile_version == 0
        {
            return Err(
                "mobile secure content signer does not match the active account".to_string(),
            );
        }
        Ok(SecureContentRuntimeIdentity {
            scope: self.scope.clone(),
            access_token: Zeroizing::new(self.access_token()?),
            signing_key_id: certificate.signing_key_id,
            profile_version: certificate.observed_profile_version,
            device_signing_key,
        })
    }

    pub fn refresh_access_token(&self, access_token: String) -> Result<(), String> {
        if access_token.trim().is_empty() {
            return Err("mobile messaging access token is empty".to_string());
        }
        *self
            .access_token
            .lock()
            .map_err(|_| "mobile messaging access token lock poisoned".to_string())? =
            Zeroizing::new(access_token);
        Ok(())
    }

    pub fn consume(
        &self,
        item: &DurableDeviceInboxItem,
        consumer_epoch: u64,
    ) -> Result<(), String> {
        if self.consume_conversation_mutation_event(item, consumer_epoch)? {
            return Ok(());
        }
        self.consumer.consume(item, consumer_epoch)
    }

    fn consume_conversation_mutation_event(
        &self,
        item: &DurableDeviceInboxItem,
        consumer_epoch: u64,
    ) -> Result<bool, String> {
        if DeviceInboxPayloadType::try_from(item.payload_type).ok()
            != Some(DeviceInboxPayloadType::ConversationEvent)
        {
            return Ok(false);
        }
        let Ok(candidate) = messaging_core::proto::chat::DeviceEventDelivery::decode(
            item.opaque_payload.as_slice(),
        ) else {
            return Ok(false);
        };
        let Some(candidate_event) = candidate.event.as_ref() else {
            return Ok(false);
        };
        if !matches!(
            candidate_event.payload.as_ref(),
            Some(
                conversation_event::Payload::ConversationUpdated(_)
                    | conversation_event::Payload::ConversationDissolved(_)
            )
        ) {
            return Ok(false);
        }

        let consumed_at_unix_ms = now_unix_ms();
        MessagingRepository::persist_claimed_item(
            self.store.as_ref(),
            &item.item_id,
            &item.event_id,
            &item.conversation_id,
            item.lane_sequence,
            consumer_epoch,
            &item.payload_sha256,
            &item.opaque_payload,
            consumed_at_unix_ms,
        )?;
        if MessagingRepository::consumption_marker_matches(
            self.store.as_ref(),
            &item.item_id,
            &item.payload_sha256,
        )? {
            return Ok(true);
        }
        let delivery =
            verify_device_event_delivery(item, &self.scope.actor_ptid, &self.scope.device_id)?;
        if PreparedEndpointPayloadKind::try_from(delivery.payload_kind)
            .map_err(|_| "mobile messaging Conversation mutation payload kind is invalid")?
            != PreparedEndpointPayloadKind::PublicEvent
        {
            return Err(
                "mobile messaging Conversation mutation requires a public event".to_string(),
            );
        }
        let event = delivery.event.as_ref().ok_or_else(|| {
            "mobile messaging Conversation mutation event is unavailable".to_string()
        })?;
        let marker = PublicEventMarker::decode(delivery.endpoint_payload.as_slice())
            .map_err(|_| "mobile messaging Conversation mutation marker is invalid".to_string())?;
        if marker.conversation_id != event.conversation_id
            || marker.event_id != event.event_id
            || marker.command_id != event.command_id
            || marker.sending_endpoint != event.actor
        {
            return Err(
                "mobile messaging Conversation mutation marker binding mismatch".to_string(),
            );
        }
        let mutation = match event.payload.as_ref() {
            Some(conversation_event::Payload::ConversationUpdated(update)) => {
                ConversationMutation::Update {
                    name: update.name.as_deref(),
                    description: update.description.as_deref(),
                }
            }
            Some(conversation_event::Payload::ConversationDissolved(_)) => {
                ConversationMutation::Dissolve
            }
            _ => return Ok(false),
        };
        let receipt = DeviceConsumptionReceipt {
            receipt_id: format!("device-consumed:{}", item.item_id),
            conversation_id: event.conversation_id.clone(),
            event_id: event.event_id.clone(),
            consumer: Some(self.proto_endpoint()),
            event_sequence: event.sequence,
            lane_sequence: item.lane_sequence,
            payload_sha256: item.payload_sha256.clone(),
            consumed_at: Some(timestamp(consumed_at_unix_ms)),
        };
        let receipt_bytes = receipt.encode_to_vec();
        self.store
            .commit_conversation_mutation_event(&ConversationMutationReceiveCommit {
                item_id: &item.item_id,
                event_id: &event.event_id,
                conversation_id: &event.conversation_id,
                command_id: &event.command_id,
                event_sequence: event.sequence,
                lane_sequence: item.lane_sequence,
                consumer_epoch,
                payload_sha256: &item.payload_sha256,
                event_hash: &event.event_hash,
                previous_event_hash: &event.previous_hash,
                membership_epoch: event.membership_epoch,
                mls_epoch: event.mls_epoch,
                mutation,
                receipt_id: &receipt.receipt_id,
                receipt_bytes: &receipt_bytes,
                consumed_at_unix_ms,
            })?;
        Ok(true)
    }

    pub fn drain_once(&self) -> Result<DrainProgress, String> {
        self.drain_once_with_observer(None)
    }

    pub fn drain_once_with_observer(
        &self,
        observer: Option<AcknowledgedItemObserver>,
    ) -> Result<DrainProgress, String> {
        let _guard = self
            .drain_lock
            .lock()
            .map_err(|_| "mobile messaging drain lock poisoned".to_string())?;
        if let Err(error) = self.resume_redaction_file_cleanup() {
            log::warn!("mobile messaging redaction file cleanup remains pending: {error}");
        }
        let token = self.access_token()?;
        let (cursor, _) = MessagingRepository::lane_checkpoint(self.store.as_ref())?;
        let expected_epoch = self.consumer_epoch.load(Ordering::Acquire);
        let mut drain = QueueDrain::new(
            StationQueueTransport::new(
                self.scope.station_origin.clone(),
                token,
                self.scope.device_id.clone(),
            )?,
            self.consumer.clone(),
            actor_device_ref(self.scope.actor_ptid.clone(), self.scope.device_id.clone()),
            self.consumer_id.clone(),
            DRAIN_BATCH_LIMIT,
        )?;
        if let Some(observer) = observer {
            drain = drain.with_acknowledged_item_observer(observer);
        }
        let progress = drain.drain_once(cursor, expected_epoch)?;
        self.consumer_epoch
            .store(progress.consumer_epoch, Ordering::Release);
        if let Err(error) = self.resume_redaction_file_cleanup() {
            log::warn!("mobile messaging redaction file cleanup remains pending: {error}");
        }
        Ok(progress)
    }

    fn resume_redaction_file_cleanup(&self) -> Result<(), String> {
        let roots = [
            self.attachment_root.join("cache"),
            self.attachment_root.join("sources"),
        ];
        let protected_paths = self.store.storage_cache_protected_paths()?;
        for operation in self.store.pending_redaction_cleanup_operations()? {
            if matches!(
                operation.state,
                ChatStorageOperationState::Compacting
                    | ChatStorageOperationState::CompactionPending
                    | ChatStorageOperationState::FailedTerminal
            ) {
                self.finalize_redaction_cleanup_operation(&operation)?;
                continue;
            }
            let progress = execute_cache_cleanup(
                self.store.as_ref(),
                &operation,
                &roots,
                &protected_paths,
                now_unix_ms(),
            )
            .map_err(|error| error.to_string())?;
            if matches!(
                progress.operation.state,
                ChatStorageOperationState::Compacting | ChatStorageOperationState::FailedTerminal
            ) {
                self.finalize_redaction_cleanup_operation(&progress.operation)?;
            }
        }
        Ok(())
    }

    fn finalize_redaction_cleanup_operation(
        &self,
        operation: &CacheCleanupOperation,
    ) -> Result<(), String> {
        let now = now_unix_ms();
        let compacting = if operation.state == ChatStorageOperationState::Compacting {
            operation.clone()
        } else {
            self.store.update_cache_cleanup_operation(
                &operation.operation_id,
                ChatStorageOperationState::Compacting,
                operation.physical_bytes_after,
                operation.last_error_code.as_deref(),
                now,
            )?
        };
        if let Err(error) = self.store.storage_compact() {
            self.store.update_cache_cleanup_operation(
                &operation.operation_id,
                ChatStorageOperationState::CompactionPending,
                operation.physical_bytes_after,
                Some(storage_error_code_name(
                    CacheCleanupError::CompactionPending.code(),
                )),
                now_unix_ms(),
            )?;
            return Err(error);
        }
        let physical_bytes_after = self.store.storage_redaction_physical_bytes()?;
        finalize_cache_cleanup(
            self.store.as_ref(),
            &compacting,
            physical_bytes_after,
            now_unix_ms(),
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn dispatch_command_once(&self) -> Result<CommandDispatchProgress, String> {
        let _intent_guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "mobile messaging send intent lock poisoned".to_string())?;
        let _guard = self
            .dispatch_lock
            .lock()
            .map_err(|_| "mobile messaging dispatch lock poisoned".to_string())?;
        let token = self.access_token()?;
        let (enrollment, signing_key) = self.store.active_device_signing_identity()?;
        let progress = CommandOutboxWorker::new(
            MobileOutboxStore(self.store.clone()),
            StationCommandTransport::new(
                self.scope.station_origin.clone(),
                token,
                self.scope.device_id.clone(),
            )?
            .with_remote_command_identity(
                self.scope.actor_ptid.clone(),
                self.scope.station_peer_id.clone(),
                enrollment.certificate.signing_key_id,
                signing_key,
            )?,
            COMMAND_RETRY_POLICY,
        )?
        .dispatch_once(now_unix_ms())?;
        if let CommandDispatchProgress::StaleAuthorityPlan { command_id, .. }
        | CommandDispatchProgress::Failed { command_id, .. } = &progress
        {
            if let Some(status) = self.command_status(command_id)? {
                self.mls_manager
                    .discard_pending_transition(&status.conversation_id);
            }
        }
        Ok(progress)
    }

    pub fn resume_message_draft_once(
        &self,
        now_unix_ms: i64,
    ) -> Result<MessageDraftResumeProgress, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "mobile messaging send intent lock poisoned".to_string())?;
        let Some(draft) = self.store.next_due_message_draft(now_unix_ms)? else {
            return Ok(MessageDraftResumeProgress::Idle);
        };
        if self.prepare_message_draft(&draft).is_err() {
            let exponent = draft.attempt_count.min(8);
            let delay_ms = 1_000_i64
                .checked_mul(1_i64 << exponent)
                .unwrap_or(COMMAND_RETRY_POLICY.maximum_delay_ms)
                .min(COMMAND_RETRY_POLICY.maximum_delay_ms);
            self.store.schedule_message_draft_retry(
                &draft,
                now_unix_ms.saturating_add(delay_ms),
                "prepare_failed",
            )?;
            return Ok(MessageDraftResumeProgress::RetryScheduled {
                next_attempt_at_unix_ms: now_unix_ms.saturating_add(delay_ms),
            });
        }
        Ok(MessageDraftResumeProgress::Prepared)
    }

    pub fn next_scheduled_work_at(&self) -> Result<Option<i64>, String> {
        Ok(earlier_unix_timestamp(
            self.store.next_scheduled_work_at()?,
            self.store.next_attachment_retry_at()?,
        ))
    }

    pub fn resume_attachment_upload_once(&self, now_unix_ms: i64) -> Result<bool, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "mobile messaging send intent lock poisoned".to_string())?;
        let Some(attachment_id) = self.store.next_due_attachment_upload(now_unix_ms)? else {
            return Ok(false);
        };
        let progress = self
            .attachment_transfer_worker()?
            .run_upload_once(&attachment_id, now_unix_ms);
        progress?;
        Ok(true)
    }

    pub fn resume_attachment_download_once(&self, now_unix_ms: i64) -> Result<bool, String> {
        let Some(attachment_id) = self.store.next_due_attachment_download(now_unix_ms)? else {
            return Ok(false);
        };
        let projection = self
            .store
            .attachment_download_projection(&attachment_id)?
            .ok_or_else(|| {
                "mobile messaging attachment download projection is unavailable".to_string()
            })?;
        let descriptor = projection
            .metadata
            .object
            .as_ref()
            .ok_or_else(|| "mobile messaging attachment descriptor is missing".to_string())?;
        let plaintext_sha256: [u8; 32] = projection
            .metadata
            .plaintext_sha256
            .as_slice()
            .try_into()
            .map_err(|_| {
                "mobile messaging attachment plaintext commitment is invalid".to_string()
            })?;
        let cache_ref = self.attachment_cache_ref(&attachment_id)?;
        let progress = self.attachment_transfer_worker()?.run_download_once(
            &attachment_id,
            descriptor,
            &plaintext_sha256,
            &cache_ref,
            now_unix_ms,
        );
        progress?;
        Ok(true)
    }

    pub fn cleanup_completed_attachment_sources(&self) -> Result<usize, String> {
        let _guard = self
            .attachment_source_lock
            .lock()
            .map_err(|_| "mobile messaging attachment source lock poisoned".to_string())?;
        let blobs = self.attachment_blobs()?;
        let mut cleaned = 0;
        for source in self.store.completed_attachment_sources()? {
            self.promote_sender_attachment_cache(&blobs, &source)?;
            cleaned += 1;
        }
        Ok(cleaned)
    }

    pub fn prepare_attachment_open(
        &self,
        attachment_id: &str,
    ) -> Result<MessagingAttachmentOpenProgress, String> {
        if attachment_id.trim().is_empty() {
            return Err("mobile messaging attachment ID is required".to_string());
        }
        let projection = self
            .store
            .attachment_download_projection(attachment_id)?
            .ok_or_else(|| "mobile messaging attachment projection is unavailable".to_string())?;
        let expected_plaintext_sha256: [u8; 32] = projection
            .metadata
            .plaintext_sha256
            .as_slice()
            .try_into()
            .map_err(|_| {
                "mobile messaging attachment plaintext commitment is invalid".to_string()
            })?;
        let blobs = self.attachment_blobs()?;
        if let Some(cache_ref) = projection.local_cache_path.as_deref() {
            if blobs.exists(cache_ref)? && blobs.sha256(cache_ref)? == expected_plaintext_sha256 {
                return Ok(MessagingAttachmentOpenProgress::Ready {
                    local_path: cache_ref.to_string(),
                });
            }
            blobs.remove(cache_ref)?;
        }

        let transfer =
            attachment_download_transfer(&self.attachment_root, &projection, now_unix_ms())?;
        match self.store.attachment_transfer(attachment_id)? {
            Some(existing) if existing.direction == 1 => {
                self.store
                    .replace_completed_upload_with_download(&transfer)?;
            }
            Some(existing) if existing.direction == 2 => {}
            Some(_) => {
                return Err("mobile messaging attachment transfer direction is invalid".to_string())
            }
            None => {
                self.store.create_attachment_transfer(&transfer)?;
            }
        }
        let next_attempt_at_unix_ms = self
            .store
            .attachment_transfer(attachment_id)?
            .ok_or_else(|| "mobile messaging attachment transfer is unavailable".to_string())?
            .next_attempt_at_unix_ms;
        Ok(MessagingAttachmentOpenProgress::Pending {
            next_attempt_at_unix_ms,
        })
    }

    pub fn cancel_attachment_transfer(&self, attachment_id: &str) -> Result<(), String> {
        self.attachment_transfer_worker()?
            .cancel(attachment_id, now_unix_ms())
    }

    pub fn request_attachment_transfer_shutdown(&self) {
        self.attachment_transfer_control.request_shutdown();
    }

    pub(crate) fn attachment_transfer_control(&self) -> Arc<AttachmentTransferControl> {
        self.attachment_transfer_control.clone()
    }

    fn prepare_message_draft(&self, draft: &PendingMessageDraft) -> Result<String, String> {
        if draft.sender_ptid != self.scope.actor_ptid
            || draft.sender_device_id != self.scope.device_id
        {
            return Err("mobile messaging draft endpoint mismatch".to_string());
        }
        let command_kind = ConversationCommandKind::try_from(draft.command_kind)
            .map_err(|_| "mobile messaging draft command kind is invalid".to_string())?;
        if !matches!(
            command_kind,
            ConversationCommandKind::SendMessage | ConversationCommandKind::ForwardMessage
        ) || (command_kind == ConversationCommandKind::ForwardMessage
            && (!draft.reply_to_message_id.is_empty() || !draft.thread_root_message_id.is_empty()))
        {
            return Err("mobile messaging draft command kind is unsupported".to_string());
        }
        let token = self.access_token()?;
        let plan = self.prepare_command_plan(&token, &draft.conversation_id, command_kind)?;
        if plan.conversation_kind != draft.conversation_kind {
            return Err(
                "mobile messaging draft conversation kind does not match Station plan".to_string(),
            );
        }
        let command_id = Ulid::new().to_string();
        let endpoint = self.proto_endpoint();
        match ConversationKind::try_from(draft.conversation_kind)
            .map_err(|_| "mobile messaging draft conversation kind is invalid".to_string())?
        {
            ConversationKind::Direct => {
                let bootstraps = DirectSessionBootstrapper::new(
                    self.store.clone(),
                    self.core_endpoint(),
                    self.actor_identity.clone(),
                )?
                .prepare_missing(
                    &draft.conversation_id,
                    &plan.required_endpoints,
                    draft.created_at_unix_ms,
                    &StationKeyBundleTransport::new(
                        self.scope.station_origin.clone(),
                        token,
                        self.scope.device_id.clone(),
                    )?,
                )?;
                let preparer = DirectOutboundPreparer::new(self.store.clone(), endpoint)?;
                match command_kind {
                    ConversationCommandKind::SendMessage => preparer.prepare_send(
                        &plan,
                        &DirectSendIntent {
                            command_id: &command_id,
                            message_id: &draft.message_id,
                            conversation_id: &draft.conversation_id,
                            plaintext: &draft.plaintext,
                            reply_to_message_id: &draft.reply_to_message_id,
                            thread_root_message_id: &draft.thread_root_message_id,
                            attachments: &draft.attachments,
                            client_timestamp_unix_ms: draft.created_at_unix_ms,
                        },
                        &bootstraps,
                    )?,
                    ConversationCommandKind::ForwardMessage => preparer.prepare_forward(
                        &plan,
                        &DirectForwardIntent {
                            command_id: &command_id,
                            destination_message_id: &draft.message_id,
                            conversation_id: &draft.conversation_id,
                            plaintext: &draft.plaintext,
                            attachments: &draft.attachments,
                            client_timestamp_unix_ms: draft.created_at_unix_ms,
                        },
                        &bootstraps,
                    )?,
                    _ => unreachable!(),
                };
            }
            ConversationKind::Group => {
                let preparer = MlsOutboundPreparer::new(
                    self.store.clone(),
                    self.mls_manager.clone(),
                    endpoint,
                )?;
                match command_kind {
                    ConversationCommandKind::SendMessage => preparer.prepare_send(
                        &plan,
                        &GroupSendTextIntent {
                            command_id: &command_id,
                            message_id: &draft.message_id,
                            conversation_id: &draft.conversation_id,
                            plaintext: &draft.plaintext,
                            reply_to_message_id: &draft.reply_to_message_id,
                            thread_root_message_id: &draft.thread_root_message_id,
                            attachments: &draft.attachments,
                            client_timestamp_unix_ms: draft.created_at_unix_ms,
                        },
                    )?,
                    ConversationCommandKind::ForwardMessage => preparer.prepare_forward(
                        &plan,
                        &GroupForwardIntent {
                            command_id: &command_id,
                            destination_message_id: &draft.message_id,
                            conversation_id: &draft.conversation_id,
                            plaintext: &draft.plaintext,
                            attachments: &draft.attachments,
                            client_timestamp_unix_ms: draft.created_at_unix_ms,
                        },
                    )?,
                    _ => unreachable!(),
                };
            }
            ConversationKind::Unspecified => {
                return Err("mobile messaging draft conversation kind is required".to_string());
            }
        }
        Ok(command_id)
    }

    pub fn enroll_pending_device(&self) -> Result<Option<ActorDevice>, String> {
        let token = self.access_token()?;
        DeviceEnrollmentManager::new(
            self.store.clone(),
            self.scope.actor_ptid.clone(),
            self.scope.device_id.clone(),
        )?
        .enroll_pending(
            "Mobile".to_string(),
            &StationDeviceTransport::new(
                self.scope.station_origin.clone(),
                token,
                self.scope.device_id.clone(),
            )?,
        )
    }

    pub fn publish_prekeys(&self) -> Result<(), String> {
        let token = self.access_token()?;
        PreKeyPublisher::new(
            self.store.clone(),
            CoreCryptoEndpoint {
                ptid: self.scope.actor_ptid.clone(),
                device_id: self.scope.device_id.clone(),
            },
        )?
        .publish(
            self.actor_identity.as_ref(),
            now_unix_ms(),
            &StationPreKeyTransport::new(
                self.scope.station_origin.clone(),
                token,
                self.scope.device_id.clone(),
            )?,
        )
    }

    pub fn publish_mls_key_packages(&self) -> Result<(), String> {
        let token = self.access_token()?;
        MlsKeyPackagePublisher::new(
            self.store.clone(),
            self.mls_manager.clone(),
            CoreCryptoEndpoint {
                ptid: self.scope.actor_ptid.clone(),
                device_id: self.scope.device_id.clone(),
            },
        )?
        .publish(
            now_unix_ms(),
            &StationMlsKeyPackageTransport::new(
                self.scope.station_origin.clone(),
                token,
                self.scope.device_id.clone(),
            )?,
        )
    }

    pub fn dispatch_delivery_receipt_once(&self) -> Result<bool, String> {
        let Some((receipt_id, receipt_bytes, receipt)) =
            self.store.next_device_consumption_receipt()?
        else {
            return Ok(false);
        };
        let token = self.access_token()?;
        StationDeliveryReceiptTransport::new(
            self.scope.station_origin.clone(),
            token,
            self.scope.device_id.clone(),
        )?
        .submit(&receipt)?;
        self.store
            .mark_device_consumption_receipt_submitted(&receipt_id, &receipt_bytes)?;
        Ok(true)
    }

    pub fn recover_stale_enrollment(&self, error: &str) -> Result<bool, String> {
        DeviceEnrollmentManager::new(
            self.store.clone(),
            self.scope.actor_ptid.clone(),
            self.scope.device_id.clone(),
        )?
        .recover_stale(error)
    }

    fn prepare_send_plan(
        &self,
        access_token: &str,
        conversation_id: &str,
    ) -> Result<messaging_core::proto::chat::PrepareConversationCommandResponse, String> {
        self.prepare_command_plan(
            access_token,
            conversation_id,
            ConversationCommandKind::Unspecified,
        )
    }

    fn prepare_command_plan(
        &self,
        access_token: &str,
        conversation_id: &str,
        command_kind: ConversationCommandKind,
    ) -> Result<messaging_core::proto::chat::PrepareConversationCommandResponse, String> {
        if conversation_id.trim().is_empty() {
            return Err("mobile messaging send plan requires conversation ID".to_string());
        }
        let authority_station_id = self
            .store
            .conversation_authority_station_id(conversation_id)?;
        StationCommandTransport::new(
            self.scope.station_origin.clone(),
            access_token.to_string(),
            self.scope.device_id.clone(),
        )?
        .prepare_send(&PrepareConversationCommandRequest {
            conversation_id: conversation_id.to_string(),
            sender: Some(actor_device_ref(
                self.scope.actor_ptid.clone(),
                self.scope.device_id.clone(),
            )),
            authority_station_peer_id: authority_station_id,
            command_kind: command_kind as i32,
        })
    }

    fn core_endpoint(&self) -> CoreCryptoEndpoint {
        CoreCryptoEndpoint {
            ptid: self.scope.actor_ptid.clone(),
            device_id: self.scope.device_id.clone(),
        }
    }

    fn proto_endpoint(&self) -> CryptoEndpoint {
        CryptoEndpoint {
            ptid: self.scope.actor_ptid.clone(),
            device_id: self.scope.device_id.clone(),
        }
    }

    fn access_token(&self) -> Result<String, String> {
        self.access_token
            .lock()
            .map_err(|_| "mobile messaging access token lock poisoned".to_string())
            .map(|token| token.to_string())
    }

    fn attachment_transfer_worker(&self) -> Result<AttachmentTransferWorker, String> {
        let token = self.access_token()?;
        AttachmentTransferWorker::with_control(
            self.store.clone(),
            Arc::new(StationAttachmentTransferTransport::new(
                self.scope.station_origin.clone(),
                token,
                self.scope.device_id.clone(),
                self.proto_endpoint(),
            )?),
            Arc::new(self.attachment_blobs()?),
            self.attachment_transfer_control.clone(),
            AttachmentRetryPolicy::default(),
        )
    }

    fn attachment_stage_ref(&self, stage_id: &str) -> Result<String, String> {
        self.attachment_stage_path(stage_id)
            .map(|path| path.to_string_lossy().into_owned())
    }

    fn attachment_stage_path(&self, stage_id: &str) -> Result<PathBuf, String> {
        validate_opaque_file_id("attachment stage", stage_id)?;
        Ok(self
            .attachment_root
            .join("sources")
            .join(format!("{stage_id}.stage")))
    }

    fn attachment_cache_ref(&self, attachment_id: &str) -> Result<String, String> {
        validate_opaque_file_id("attachment", attachment_id)?;
        Ok(self
            .attachment_root
            .join("cache")
            .join(attachment_id)
            .to_string_lossy()
            .into_owned())
    }

    fn attachment_blobs(&self) -> Result<FilesystemAttachmentBlob, String> {
        FilesystemAttachmentBlob::new(&self.attachment_root)
    }

    fn promote_sender_attachment_cache(
        &self,
        blobs: &FilesystemAttachmentBlob,
        source: &CompletedSenderAttachmentSource,
    ) -> Result<(), String> {
        let expected_plaintext_sha256: [u8; 32] =
            source.plaintext_sha256.as_slice().try_into().map_err(|_| {
                "mobile messaging attachment plaintext commitment is invalid".to_string()
            })?;
        let cache_ref = self.attachment_cache_ref(&source.attachment_id)?;
        if blobs.exists(&cache_ref)? {
            if blobs.sha256(&cache_ref)? != expected_plaintext_sha256 {
                blobs.remove(&cache_ref)?;
            }
        }
        if !blobs.exists(&cache_ref)? {
            if !blobs.exists(&source.source_local_ref)?
                || blobs.sha256(&source.source_local_ref)? != expected_plaintext_sha256
            {
                return Err("mobile messaging attachment source is invalid".to_string());
            }
            blobs.promote(&source.source_local_ref, &cache_ref)?;
        }
        self.store
            .promote_completed_upload_cache(source, &cache_ref)?;
        if blobs.exists(&source.source_local_ref)? {
            blobs.remove(&source.source_local_ref)?;
        }
        self.store
            .clear_completed_attachment_source(source, &cache_ref)
    }
}

fn prepare_local_attachment_upload(
    blobs: &dyn AttachmentBlob,
    conversation_id: &str,
    message_id: &str,
    authority_station_id: &str,
    source_local_ref: &str,
    stage: &StagedAttachment,
    created_at_unix_ms: i64,
) -> Result<PendingAttachmentUpload, String> {
    if conversation_id.trim().is_empty()
        || message_id.trim().is_empty()
        || authority_station_id.trim().is_empty()
        || source_local_ref.trim().is_empty()
        || !stage.completed
        || created_at_unix_ms <= 0
    {
        return Err("mobile messaging local attachment intent is incomplete".to_string());
    }
    if blobs.len(source_local_ref)? != stage.plaintext_size {
        return Err("mobile messaging attachment source size changed".to_string());
    }
    let material = AttachmentCryptoMaterial::generate(stage.plaintext_size)?;
    let attachment_id = Ulid::new().to_string();
    Ok(PendingAttachmentUpload {
        transfer: AttachmentTransferRecord {
            attachment_id: attachment_id.clone(),
            conversation_id: conversation_id.to_string(),
            message_id: message_id.to_string(),
            authority_station_id: authority_station_id.to_string(),
            direction: 1,
            state: AttachmentTransferState::Queued as i32,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![0; material.chunk_count().div_ceil(8) as usize],
            source_local_ref: source_local_ref.to_string(),
            partial_local_ref: format!("{source_local_ref}.transfer-{attachment_id}.part"),
            object_key: material.object_key().to_vec(),
            base_nonce: material.base_nonce().to_vec(),
            plaintext_size: material.plaintext_size(),
            chunk_size: material.chunk_size(),
            attempt_count: 0,
            next_attempt_at_unix_ms: created_at_unix_ms,
            last_error_code: 0,
            updated_at_unix_ms: created_at_unix_ms,
        },
        filename: stage.filename.clone(),
        mime_type: stage.mime_type.clone(),
        plaintext_sha256: blobs.sha256(source_local_ref)?.to_vec(),
        content_kind: stage.content_kind,
        duration_ms: stage.duration_ms,
        voice_note: stage.voice_note.clone(),
    })
}

fn copy_verified_attachment_source(
    blobs: &dyn AttachmentBlob,
    source_ref: &str,
    target_ref: &str,
    plaintext_size: u64,
    expected_plaintext_sha256: &[u8; 32],
) -> Result<(), String> {
    if source_ref.trim().is_empty()
        || target_ref.trim().is_empty()
        || source_ref == target_ref
        || plaintext_size == 0
        || plaintext_size > ATTACHMENT_MAX_PLAINTEXT_SIZE
        || !blobs.exists(source_ref)?
        || blobs.len(source_ref)? != plaintext_size
        || blobs.sha256(source_ref)? != *expected_plaintext_sha256
    {
        return Err("mobile messaging forward attachment local source is invalid".to_string());
    }
    let mut offset = 0_u64;
    while offset < plaintext_size {
        let length =
            usize::try_from((plaintext_size - offset).min(ATTACHMENT_STAGE_CHUNK_SIZE as u64))
                .map_err(|_| {
                    "mobile messaging forward attachment chunk exceeds platform".to_string()
                })?;
        let bytes = blobs.read_chunk(source_ref, offset, length)?;
        blobs.write_chunk(target_ref, offset, &bytes)?;
        offset = offset.saturating_add(length as u64);
    }
    if blobs.len(target_ref)? != plaintext_size
        || blobs.sha256(target_ref)? != *expected_plaintext_sha256
    {
        return Err("mobile messaging forward attachment restaging failed".to_string());
    }
    Ok(())
}

fn attachment_download_transfer(
    attachment_root: &Path,
    projection: &AttachmentDownloadProjection,
    created_at_unix_ms: i64,
) -> Result<AttachmentTransferRecord, String> {
    let object = projection
        .metadata
        .object
        .as_ref()
        .ok_or_else(|| "mobile messaging attachment descriptor is missing".to_string())?;
    validate_opaque_file_id("attachment", &projection.metadata.attachment_id)?;
    let cache_path = attachment_root
        .join("cache")
        .join(&projection.metadata.attachment_id);
    Ok(AttachmentTransferRecord {
        attachment_id: projection.metadata.attachment_id.clone(),
        conversation_id: projection.conversation_id.clone(),
        message_id: projection.message_id.clone(),
        authority_station_id: projection.authority_station_id.clone(),
        direction: 2,
        state: AttachmentTransferState::Queued as i32,
        upload_id: String::new(),
        generation: 0,
        descriptor_sha256: vec![0; 32],
        completed_chunk_bitmap: vec![0; object.chunk_count.div_ceil(8) as usize],
        source_local_ref: String::new(),
        partial_local_ref: format!("{}.part", cache_path.display()),
        object_key: projection.metadata.object_key.clone(),
        base_nonce: projection.metadata.base_nonce.clone(),
        plaintext_size: projection.metadata.plaintext_size,
        chunk_size: object.chunk_size,
        attempt_count: 0,
        next_attempt_at_unix_ms: created_at_unix_ms,
        last_error_code: 0,
        updated_at_unix_ms: created_at_unix_ms,
    })
}

fn cleanup_incomplete_attachment_stages(
    attachment_root: &Path,
    store: &MobileMessagingStore,
) -> Result<(), String> {
    let source_root = attachment_root.join("sources");
    let entries = match std::fs::read_dir(&source_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "list mobile messaging attachment source directory: {error}"
            ))
        }
    };
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("read mobile messaging attachment source entry: {error}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let source_ref = path.to_string_lossy();
        if !store.owns_attachment_source(&source_ref)? {
            std::fs::remove_file(&path).map_err(|error| {
                format!("remove incomplete mobile messaging attachment stage: {error}")
            })?;
        }
    }
    Ok(())
}

fn validate_opaque_file_id(label: &str, value: &str) -> Result<(), String> {
    if value.len() != 26 || !value.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return Err(format!("mobile messaging {label} ID is invalid"));
    }
    Ok(())
}

fn earlier_unix_timestamp(left: Option<i64>, right: Option<i64>) -> Option<i64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

fn replacement_command_id(command_id: &str, delivery_plan_sha256: &[u8]) -> String {
    let mut hasher = Sha256::new();
    for value in [
        b"peers-touch:messaging:replacement-command:1".as_slice(),
        command_id.as_bytes(),
        delivery_plan_sha256,
    ] {
        hasher.update((value.len() as u64).to_be_bytes());
        hasher.update(value);
    }
    let digest = hasher.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    Ulid::from_bytes(bytes).to_string()
}

fn random_consumer_id() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    format!("mobile-engine:{}", hex_bytes(&bytes))
}

fn hex_bytes(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn retention_result(
    snapshot: ChatStorageSnapshot,
    policy: messaging_core::proto::chat::ChatStoragePolicy,
    operation: messaging_core::storage_governance::cache::CacheCleanupOperation,
    cleanup_error: Option<CacheCleanupError>,
    failed_item_count: usize,
) -> ChatStorageResult {
    let scope = snapshot.scope.clone().unwrap_or_default();
    let error = cleanup_error.as_ref().map(|error| {
        let mut value = cache_cleanup_error_proto(error);
        if failed_item_count > 0 {
            value.message = format!(
                "{}; {} retention media item(s) remain",
                value.message, failed_item_count
            );
        }
        value
    });
    ChatStorageResult {
        snapshot: Some(snapshot),
        policy: Some(policy),
        operation: Some(retention_operation_proto(scope, &operation)),
        error,
    }
}

fn conversation_clear_result(
    snapshot: ChatStorageSnapshot,
    operation: messaging_core::storage_governance::cache::CacheCleanupOperation,
    conversation_id: &str,
    cleanup_error: Option<CacheCleanupError>,
    failed_item_count: usize,
) -> ChatStorageResult {
    let scope = snapshot.scope.clone().unwrap_or_default();
    let error = cleanup_error.as_ref().map(|error| {
        let mut value = cache_cleanup_error_proto(error);
        if failed_item_count > 0 {
            value.message = format!(
                "{}; {} conversation media item(s) remain",
                value.message, failed_item_count
            );
        }
        value
    });
    ChatStorageResult {
        snapshot: Some(snapshot),
        policy: None,
        operation: Some(conversation_clear_operation_proto(
            scope,
            &operation,
            conversation_id,
        )),
        error,
    }
}

fn cache_cleanup_result(
    snapshot: ChatStorageSnapshot,
    progress: messaging_core::storage_governance::cache::CacheCleanupProgress,
) -> ChatStorageResult {
    let scope = snapshot.scope.clone().unwrap_or_default();
    let error = progress.error.as_ref().map(|error| {
        let mut value = cache_cleanup_error_proto(error);
        if progress.failed_item_count > 0 {
            value.message = format!(
                "{}; {} cache item(s) remain",
                value.message, progress.failed_item_count
            );
        }
        value
    });
    ChatStorageResult {
        snapshot: Some(snapshot),
        policy: None,
        operation: Some(cache_cleanup_operation_proto(scope, &progress.operation)),
        error,
    }
}

fn sqlite_sidecar_path(database_path: &Path, suffix: &str) -> PathBuf {
    let mut path = database_path.as_os_str().to_os_string();
    path.push(suffix);
    PathBuf::from(path)
}

fn build_signed_friend_request_command(
    intent: FriendRequestCommandIntent<'_>,
    device_signing_key: &DeviceSigningKey,
    signing_key_id: &str,
    device_id: &str,
) -> Result<FriendRequestCommand, String> {
    for (field, value) in [
        ("command_id", intent.command_id),
        ("request_id", intent.request_id),
        ("sender_ptid", intent.sender_ptid),
        ("receiver_ptid", intent.receiver_ptid),
        (
            "sender_home_station_peer_id",
            intent.sender_home_station_peer_id,
        ),
        (
            "receiver_home_station_peer_id",
            intent.receiver_home_station_peer_id,
        ),
        ("federation_id", intent.federation_id),
        ("signing_key_id", signing_key_id),
        ("device_id", device_id),
    ] {
        validate_friend_request_identifier(field, value)?;
    }
    if !intent.sender_ptid.starts_with("ptid:")
        || !intent.receiver_ptid.starts_with("ptid:")
        || intent.sender_ptid == intent.receiver_ptid
        || device_signing_key.device_id() != device_id
        || intent.message != intent.message.trim()
        || intent.message.len() > FRIEND_REQUEST_MESSAGE_MAX_BYTES
    {
        return Err("mobile Social Friend Request command input is invalid".to_string());
    }
    let observed_request_state = match intent.action {
        FriendRequestAction::Send => FriendRequestState::Unspecified,
        FriendRequestAction::Accept | FriendRequestAction::Reject if intent.message.is_empty() => {
            FriendRequestState::Pending
        }
        FriendRequestAction::Accept | FriendRequestAction::Reject => {
            return Err("mobile Social Friend Request decision message must be empty".to_string())
        }
        FriendRequestAction::Unspecified => {
            return Err("mobile Social Friend Request action is unspecified".to_string())
        }
    };
    let expires_at_unix_ms = intent
        .created_at_unix_ms
        .checked_add(FRIEND_REQUEST_COMMAND_LIFETIME_MS)
        .ok_or_else(|| "mobile Social Friend Request expiry overflow".to_string())?;
    let sender = human_actor_ref(intent.sender_ptid);
    let receiver = human_actor_ref(intent.receiver_ptid);
    let authorizing_actor = match intent.action {
        FriendRequestAction::Send => sender.clone(),
        FriendRequestAction::Accept | FriendRequestAction::Reject => receiver.clone(),
        FriendRequestAction::Unspecified => unreachable!(),
    };
    let body = FriendRequestCommandBody {
        format_version: FRIEND_REQUEST_COMMAND_FORMAT_VERSION,
        command_id: intent.command_id.to_string(),
        request_id: intent.request_id.to_string(),
        action: intent.action as i32,
        sender: Some(sender),
        receiver: Some(receiver),
        sender_home_station_peer_id: intent.sender_home_station_peer_id.to_string(),
        receiver_home_station_peer_id: intent.receiver_home_station_peer_id.to_string(),
        message: intent.message.to_string(),
        observed_request_state: observed_request_state as i32,
        created_at: Some(timestamp(intent.created_at_unix_ms)),
        expires_at: Some(timestamp(expires_at_unix_ms)),
        authorizing_device: Some(messaging_core::proto::actor::ActorDeviceRef {
            actor: Some(authorizing_actor),
            device_id: device_id.to_string(),
        }),
        federation_id: intent.federation_id.to_string(),
    };
    let signing_input = FriendRequestCommandSigningInput {
        body: Some(body.clone()),
        signing_key_id: signing_key_id.to_string(),
    }
    .encode_to_vec();
    Ok(FriendRequestCommand {
        body: Some(body),
        signing_key_id: signing_key_id.to_string(),
        actor_device_signature: device_signing_key.sign(&signing_input).to_bytes().to_vec(),
    })
}

fn build_signed_social_relationship_command(
    scope: &MessagingAccountScope,
    intent: RelationshipCommandIntent<'_>,
    device_signing_key: &DeviceSigningKey,
    signing_key_id: &str,
    device_id: &str,
) -> Result<SocialRelationshipCommand, String> {
    for (field, value) in [
        ("command_id", intent.command_id),
        ("actor_ptid", scope.actor_ptid.as_str()),
        ("target_ptid", intent.target_ptid),
        ("actor_home_station_peer_id", scope.station_peer_id.as_str()),
        (
            "target_home_station_peer_id",
            intent.target_home_station_peer_id,
        ),
        ("signing_key_id", signing_key_id),
        ("device_id", device_id),
    ] {
        validate_friend_request_identifier(field, value)?;
    }
    if !scope.actor_ptid.starts_with("ptid:")
        || !intent.target_ptid.starts_with("ptid:")
        || scope.actor_ptid == intent.target_ptid
        || intent.observed_revision < 0
        || device_signing_key.device_id() != device_id
        || !matches!(
            intent.action,
            SocialRelationshipAction::Block | SocialRelationshipAction::Unblock
        )
    {
        return Err("mobile Social relationship command input is invalid".to_string());
    }
    let expires_at_unix_ms = intent
        .created_at_unix_ms
        .checked_add(SOCIAL_RELATIONSHIP_COMMAND_LIFETIME_MS)
        .ok_or_else(|| "mobile Social relationship expiry overflow".to_string())?;
    let actor = human_actor_ref(&scope.actor_ptid);
    let body = SocialRelationshipCommandBody {
        format_version: SOCIAL_RELATIONSHIP_COMMAND_FORMAT_VERSION,
        command_id: intent.command_id.to_string(),
        action: intent.action as i32,
        actor: Some(actor.clone()),
        target_actor: Some(human_actor_ref(intent.target_ptid)),
        actor_home_station_peer_id: scope.station_peer_id.clone(),
        target_home_station_peer_id: intent.target_home_station_peer_id.to_string(),
        observed_revision: intent.observed_revision,
        created_at: Some(timestamp(intent.created_at_unix_ms)),
        expires_at: Some(timestamp(expires_at_unix_ms)),
        authorizing_device: Some(messaging_core::proto::actor::ActorDeviceRef {
            actor: Some(actor),
            device_id: device_id.to_string(),
        }),
    };
    let signing_input = SocialRelationshipCommandSigningInput {
        body: Some(body.clone()),
        signing_key_id: signing_key_id.to_string(),
    }
    .encode_to_vec();
    Ok(SocialRelationshipCommand {
        body: Some(body),
        signing_key_id: signing_key_id.to_string(),
        actor_device_signature: device_signing_key.sign(&signing_input).to_bytes().to_vec(),
    })
}

fn prepared_social_relationship_command(
    command: SocialRelationshipCommand,
) -> Result<PreparedSocialRelationshipCommand, String> {
    let body = command
        .body
        .as_ref()
        .ok_or_else(|| "prepared Social relationship command body is required".to_string())?;
    let action = SocialRelationshipAction::try_from(body.action)
        .map_err(|_| "prepared Social relationship action is invalid".to_string())?;
    if !matches!(
        action,
        SocialRelationshipAction::Block | SocialRelationshipAction::Unblock
    ) {
        return Err("prepared Social relationship action is unspecified".to_string());
    }
    let target_ptid = body
        .target_actor
        .as_ref()
        .map(|actor| actor.ptid.clone())
        .filter(|ptid| !ptid.is_empty())
        .ok_or_else(|| "prepared Social relationship target is required".to_string())?;
    let expires_at = body
        .expires_at
        .as_ref()
        .ok_or_else(|| "prepared Social relationship expiry is required".to_string())?;
    let expires_at_unix_ms = expires_at
        .seconds
        .checked_mul(1_000)
        .and_then(|value| value.checked_add(i64::from(expires_at.nanos) / 1_000_000))
        .ok_or_else(|| "prepared Social relationship expiry overflow".to_string())?;
    let command_bytes = command.encode_to_vec();
    let payload_sha256 = Sha256::digest(&command_bytes).to_vec();
    Ok(PreparedSocialRelationshipCommand {
        action,
        command_id: body.command_id.clone(),
        target_ptid: target_ptid.clone(),
        ordering_key: format!(
            "social-relationship-command:{}:{}",
            body.actor
                .as_ref()
                .map(|actor| actor.ptid.as_str())
                .unwrap_or(""),
            target_ptid,
        ),
        payload_sha256,
        command_bytes,
        expires_at_unix_ms,
    })
}

fn prepared_social_friend_request_command(
    command: FriendRequestCommand,
) -> Result<PreparedSocialFriendRequestCommand, String> {
    let body = command
        .body
        .as_ref()
        .ok_or_else(|| "prepared Social Friend Request command body is required".to_string())?;
    let action = FriendRequestAction::try_from(body.action)
        .map_err(|_| "prepared Social Friend Request action is invalid".to_string())?;
    if action == FriendRequestAction::Unspecified {
        return Err("prepared Social Friend Request action is unspecified".to_string());
    }
    let expires_at = body
        .expires_at
        .as_ref()
        .ok_or_else(|| "prepared Social Friend Request expiry is required".to_string())?;
    let expires_at_unix_ms = expires_at
        .seconds
        .checked_mul(1_000)
        .and_then(|value| value.checked_add(i64::from(expires_at.nanos) / 1_000_000))
        .ok_or_else(|| "prepared Social Friend Request expiry overflow".to_string())?;
    let command_bytes = command.encode_to_vec();
    let payload_sha256 = Sha256::digest(&command_bytes).to_vec();
    Ok(PreparedSocialFriendRequestCommand {
        action,
        command_id: body.command_id.clone(),
        request_id: body.request_id.clone(),
        ordering_key: format!("social-friend-request-command:{}", body.request_id),
        payload_sha256,
        command_bytes,
        expires_at_unix_ms,
    })
}

#[allow(clippy::too_many_arguments)]
fn prepare_member_authority_command(
    scope: &MessagingAccountScope,
    local: &ConversationProjection,
    authoritative: &Conversation,
    authority_head: (i64, Vec<u8>),
    target_ptid: &str,
    action: ConversationMemberAuthorityAction,
    role: Option<MemberRole>,
    muted: Option<bool>,
    muted_until_unix_ms: Option<i64>,
    created_at_unix_ms: i64,
) -> Result<ConversationMemberAuthorityCommand, MemberAuthorityCommandError> {
    if local.kind != ConversationKind::Group as i32
        || authoritative.kind != ConversationKind::Group as i32
        || authoritative.status != ConversationStatus::Active as i32
        || !local.active
        || authoritative.authority_epoch <= 0
        || authority_head.0 <= 0
        || authority_head.1.len() != 32
        || created_at_unix_ms <= 0
        || !target_ptid.starts_with("ptid:")
        || !local
            .members
            .iter()
            .any(|member| member.ptid == target_ptid)
    {
        return Err(local_member_authority_error(
            "mobile messaging member-authority scope is incomplete",
        ));
    }
    if local.conversation_id != authoritative.conversation_id
        || local.authority_station_id != authoritative.authority_station_peer_id
        || local.federation_id != authoritative.federation_id
        || local.owner_ptid != authoritative.owner_ptid
    {
        return Err(stale_member_authority_error(
            "CONVERSATION_STALE_AUTHORITY_HEAD",
            "mobile messaging Conversation authority scope is stale",
        ));
    }
    if local.membership_epoch != authoritative.membership_epoch {
        return Err(stale_member_authority_error(
            "CONVERSATION_STALE_MEMBERSHIP_EPOCH",
            "mobile messaging Conversation membership epoch is stale",
        ));
    }
    if local.mls_epoch != authoritative.mls_epoch {
        return Err(stale_member_authority_error(
            "CONVERSATION_STALE_MLS_EPOCH",
            "mobile messaging Conversation MLS epoch is stale",
        ));
    }
    match action {
        ConversationMemberAuthorityAction::UpdateMember => {
            if role.is_none() && muted.is_none() {
                return Err(local_member_authority_error(
                    "mobile messaging member-authority update is empty",
                ));
            }
            if role.is_some_and(|role| !matches!(role, MemberRole::Member | MemberRole::Admin)) {
                return Err(local_member_authority_error(
                    "mobile messaging member-authority role is invalid",
                ));
            }
            if muted_until_unix_ms.is_some() && muted != Some(true) {
                return Err(local_member_authority_error(
                    "mobile messaging mute deadline requires muted=true",
                ));
            }
            if muted_until_unix_ms.is_some_and(|deadline| deadline <= created_at_unix_ms) {
                return Err(MemberAuthorityCommandError {
                    code: "CONVERSATION_COMMAND_EXPIRED".to_string(),
                    message: "mobile messaging mute deadline has expired".to_string(),
                });
            }
        }
        ConversationMemberAuthorityAction::TransferOwnership => {
            if role.is_some() || muted.is_some() || muted_until_unix_ms.is_some() {
                return Err(local_member_authority_error(
                    "mobile messaging ownership transfer does not accept member patches",
                ));
            }
        }
        ConversationMemberAuthorityAction::Unspecified => {
            return Err(local_member_authority_error(
                "mobile messaging member-authority action is unspecified",
            ));
        }
    }
    Ok(ConversationMemberAuthorityCommand {
        version: 1,
        command_id: Ulid::new().to_string(),
        conversation_id: local.conversation_id.clone(),
        operator: Some(CryptoEndpoint {
            ptid: scope.actor_ptid.clone(),
            device_id: scope.device_id.clone(),
        }),
        target_ptid: target_ptid.to_string(),
        action: action as i32,
        role: role.map(|role| role as i32),
        muted,
        muted_until: muted_until_unix_ms.map(timestamp),
        federation_id: local.federation_id.clone(),
        authority_station_peer_id: local.authority_station_id.clone(),
        authority_epoch: authoritative.authority_epoch,
        authority_sequence: authority_head.0,
        authority_hash: authority_head.1,
        observed_membership_epoch: local.membership_epoch,
        observed_mls_epoch: local.mls_epoch,
        client_timestamp: Some(timestamp(created_at_unix_ms)),
        deadline: Some(timestamp(
            created_at_unix_ms.saturating_add(MEMBER_AUTHORITY_COMMAND_LIFETIME_MS),
        )),
    })
}

fn local_member_authority_error(message: impl Into<String>) -> MemberAuthorityCommandError {
    MemberAuthorityCommandError {
        code: "MOBILE_MESSAGING".to_string(),
        message: message.into(),
    }
}

fn stale_member_authority_error(
    code: &str,
    message: impl Into<String>,
) -> MemberAuthorityCommandError {
    MemberAuthorityCommandError {
        code: code.to_string(),
        message: message.into(),
    }
}

fn is_stale_member_authority_code(code: &str) -> bool {
    matches!(
        code,
        "CONVERSATION_STALE_AUTHORITY_HEAD"
            | "CONVERSATION_STALE_MEMBERSHIP_EPOCH"
            | "CONVERSATION_STALE_MLS_EPOCH"
    )
}

fn prepare_conversation_mutation_command(
    plan: &PrepareConversationCommandResponse,
    sender: CryptoEndpoint,
    command_id: &str,
    payload: chat_command::Payload,
    created_at_unix_ms: i64,
) -> Result<ChatCommand, String> {
    if command_id.trim().is_empty()
        || created_at_unix_ms <= 0
        || plan.conversation_id.trim().is_empty()
        || plan.conversation_kind != ConversationKind::Group as i32
        || plan.authority_station_peer_id.trim().is_empty()
        || plan.delivery_plan_sha256.len() != 32
        || plan.authority_sequence <= 0
        || plan.authority_hash.len() != 32
        || plan.membership_epoch <= 0
        || plan.mls_epoch <= 0
        || sender.ptid.trim().is_empty()
        || sender.device_id.trim().is_empty()
        || !plan.required_endpoints.iter().any(|endpoint| {
            actor_device_ptid(endpoint).ok() == Some(sender.ptid.as_str())
                && endpoint.device_id == sender.device_id
        })
        || !matches!(
            payload,
            chat_command::Payload::UpdateConversation(_)
                | chat_command::Payload::DissolveConversation(_)
        )
    {
        return Err("mobile messaging Conversation mutation plan is incomplete".to_string());
    }
    Ok(ChatCommand {
        command_id: command_id.to_string(),
        conversation_id: plan.conversation_id.clone(),
        sender: Some(sender),
        observed_membership_epoch: plan.membership_epoch,
        observed_mls_epoch: plan.mls_epoch,
        client_timestamp: Some(timestamp(created_at_unix_ms)),
        delivery_plan_sha256: plan.delivery_plan_sha256.clone(),
        authority_station_peer_id: plan.authority_station_peer_id.clone(),
        payload: Some(payload),
    })
}

impl FriendRequestResolverTransport for MobileMessagingEngine {
    fn dispatch(
        &self,
        exact_payload_bytes: &[u8],
    ) -> Result<Vec<u8>, FriendRequestTransportFailure> {
        let command = FriendRequestCommand::decode(exact_payload_bytes)
            .map_err(|_| FriendRequestTransportFailure::ResponseDecode)?;
        if command.encode_to_vec() != exact_payload_bytes {
            return Err(FriendRequestTransportFailure::ResponseDecode);
        }
        let prepared = prepared_social_friend_request_command(command)
            .map_err(|_| FriendRequestTransportFailure::ResponseDecode)?;
        self.dispatch_prepared_social_friend_request(&prepared)
    }

    fn lookup(
        &self,
        command_id: &str,
        payload_sha256: &[u8],
    ) -> Result<Vec<u8>, FriendRequestTransportFailure> {
        self.lookup_social_friend_request_command_result(command_id, payload_sha256)
            .map(|response| response.encode_to_vec())
    }
}

fn map_friend_request_transport_error(
    error: StationTransportError,
) -> FriendRequestTransportFailure {
    match error {
        StationTransportError::Deadline => FriendRequestTransportFailure::Deadline,
        StationTransportError::Decode | StationTransportError::Invalid => {
            FriendRequestTransportFailure::ResponseDecode
        }
        StationTransportError::Network | StationTransportError::HttpStatus(_) => {
            FriendRequestTransportFailure::Transport
        }
    }
}

fn map_relationship_transport_error(error: StationTransportError) -> RelationshipTransportFailure {
    match error {
        StationTransportError::Deadline => RelationshipTransportFailure::Deadline,
        StationTransportError::Decode | StationTransportError::Invalid => {
            RelationshipTransportFailure::ResponseDecode
        }
        StationTransportError::Network | StationTransportError::HttpStatus(_) => {
            RelationshipTransportFailure::Transport
        }
    }
}

impl RelationshipResolverTransport for MobileMessagingEngine {
    fn dispatch(
        &self,
        exact_payload_bytes: &[u8],
    ) -> Result<Vec<u8>, RelationshipTransportFailure> {
        let command = SocialRelationshipCommand::decode(exact_payload_bytes)
            .map_err(|_| RelationshipTransportFailure::ResponseDecode)?;
        let prepared = prepared_social_relationship_command(command)
            .map_err(|_| RelationshipTransportFailure::ResponseDecode)?;
        self.dispatch_prepared_social_relationship(&prepared)
    }

    fn lookup(
        &self,
        command_id: &str,
        payload_sha256: &[u8],
    ) -> Result<Vec<u8>, RelationshipTransportFailure> {
        self.lookup_social_relationship_command_result(command_id, payload_sha256)
            .map(|lookup| lookup.encode_to_vec())
    }
}

fn conversation_authority_scope(conversation: &Conversation) -> Result<(&str, &str), String> {
    if conversation.conversation_id.trim().is_empty()
        || conversation.authority_station_peer_id.trim().is_empty()
        || conversation.federation_id.trim().is_empty()
    {
        return Err(
            "mobile messaging Station returned an incomplete Conversation projection".to_string(),
        );
    }
    Ok((
        conversation.authority_station_peer_id.as_str(),
        conversation.federation_id.as_str(),
    ))
}

fn self_leave_intent_input(
    scope: &MessagingAccountScope,
    local: &ConversationProjection,
    authoritative: &Conversation,
    authority_sequence: i64,
    authority_hash: Vec<u8>,
) -> Result<MlsLeaveIntentInput, String> {
    if scope.station_peer_id.trim().is_empty()
        || !scope.actor_ptid.starts_with("ptid:")
        || local.conversation_id.trim().is_empty()
        || local.kind != ConversationKind::Group as i32
        || !local.active
        || !local.owner_ptid.starts_with("ptid:")
        || !local
            .members
            .iter()
            .any(|member| member.ptid == scope.actor_ptid)
        || local.owner_ptid == scope.actor_ptid
    {
        return Err(
            "mobile messaging self-leave requires a non-owner active group member".to_string(),
        );
    }
    if authoritative.conversation_id != local.conversation_id
        || authoritative.kind != ConversationKind::Group as i32
        || authoritative.status != ConversationStatus::Active as i32
        || authoritative.authority_station_peer_id != local.authority_station_id
        || authoritative.federation_id != local.federation_id
        || authoritative.owner_ptid != local.owner_ptid
        || authoritative.membership_epoch != local.membership_epoch
        || authoritative.mls_epoch != local.mls_epoch
    {
        return Err(
            "mobile messaging Station Conversation does not match local self-leave state"
                .to_string(),
        );
    }
    if authoritative.authority_station_peer_id.trim().is_empty()
        || authoritative.federation_id.trim().is_empty()
        || authoritative.authority_epoch <= 0
        || authoritative.membership_epoch <= 0
        || authoritative.mls_epoch <= 0
        || authority_sequence <= 0
        || authority_hash.len() != 32
    {
        return Err("mobile messaging self-leave authority scope is incomplete".to_string());
    }
    Ok(MlsLeaveIntentInput {
        federation_id: authoritative.federation_id.clone(),
        authority_station_peer_id: authoritative.authority_station_peer_id.clone(),
        authority_epoch: authoritative.authority_epoch,
        home_station_peer_id: scope.station_peer_id.clone(),
        conversation_id: authoritative.conversation_id.clone(),
        observed_membership_epoch: authoritative.membership_epoch,
        observed_mls_epoch: authoritative.mls_epoch,
        authority_sequence,
        authority_hash,
    })
}

fn human_actor_ref(ptid: &str) -> ActorRef {
    ActorRef {
        ptid: ptid.to_string(),
        kind: ActorKind::Person as i32,
        ..Default::default()
    }
}

fn validate_friend_request_identifier(field: &str, value: &str) -> Result<(), String> {
    if value.is_empty()
        || value != value.trim()
        || value.len() > FRIEND_REQUEST_IDENTIFIER_MAX_BYTES
        || value.contains('\0')
    {
        return Err(format!(
            "mobile Social Friend Request {field} is not canonical"
        ));
    }
    Ok(())
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn timestamp(unix_ms: i64) -> prost_types::Timestamp {
    prost_types::Timestamp {
        seconds: unix_ms.div_euclid(1_000),
        nanos: (unix_ms.rem_euclid(1_000) * 1_000_000) as i32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier};

    fn group_mutation_plan() -> PrepareConversationCommandResponse {
        PrepareConversationCommandResponse {
            conversation_id: "conversation-1".to_string(),
            conversation_kind: ConversationKind::Group as i32,
            authority_sequence: 7,
            authority_hash: vec![8; 32],
            membership_epoch: 3,
            mls_epoch: 4,
            delivery_plan_sha256: vec![9; 32],
            authority_station_peer_id: "station-authority".to_string(),
            required_endpoints: vec![
                actor_device_ref("ptid:alice", "alice-device"),
                actor_device_ref("ptid:bob", "bob-device"),
            ],
            ..Default::default()
        }
    }

    #[test]
    fn conversation_mutation_commands_preserve_plan_scope_and_intent() {
        let sender = CryptoEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: "alice-device".to_string(),
        };
        let update = prepare_conversation_mutation_command(
            &group_mutation_plan(),
            sender.clone(),
            "update-command",
            chat_command::Payload::UpdateConversation(UpdateConversationIntent {
                name: Some("Renamed".to_string()),
                description: Some(String::new()),
                ..Default::default()
            }),
            1_234,
        )
        .unwrap();
        assert_eq!(update.command_id, "update-command");
        assert_eq!(update.conversation_id, "conversation-1");
        assert_eq!(update.sender, Some(sender.clone()));
        assert_eq!(update.observed_membership_epoch, 3);
        assert_eq!(update.observed_mls_epoch, 4);
        assert_eq!(update.delivery_plan_sha256, vec![9; 32]);
        assert_eq!(update.authority_station_peer_id, "station-authority");
        match update.payload.unwrap() {
            chat_command::Payload::UpdateConversation(intent) => {
                assert_eq!(intent.name.as_deref(), Some("Renamed"));
                assert_eq!(intent.description.as_deref(), Some(""));
            }
            _ => panic!("unexpected Conversation update payload"),
        }

        let dissolve = prepare_conversation_mutation_command(
            &group_mutation_plan(),
            sender,
            "dissolve-command",
            chat_command::Payload::DissolveConversation(DissolveConversationIntent {}),
            1_235,
        )
        .unwrap();
        assert!(matches!(
            dissolve.payload,
            Some(chat_command::Payload::DissolveConversation(_))
        ));

        let mut stale = group_mutation_plan();
        stale.authority_hash.clear();
        assert!(prepare_conversation_mutation_command(
            &stale,
            CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            "invalid",
            chat_command::Payload::DissolveConversation(DissolveConversationIntent {}),
            1_236,
        )
        .is_err());
    }

    #[test]
    fn station_origin_policy_rejects_insecure_release_origins() {
        let remote = "http://192.0.2.10:18132";
        assert!(normalize_station_origin(
            "https://station.example",
            StationOriginPolicy::HttpsOnly,
        )
        .is_ok());
        assert!(normalize_station_origin(remote, StationOriginPolicy::Development).is_ok());
        assert!(normalize_station_origin(remote, StationOriginPolicy::HttpsOnly).is_err());
        assert!(
            normalize_station_origin("ftp://localhost", StationOriginPolicy::Development).is_err()
        );
    }

    #[test]
    fn station_origin_policy_requires_canonical_origins() {
        for rejected in [
            "http://192.0.2.10:18132/path",
            "http://192.0.2.10:18132/?query=1",
            "http://192.0.2.10:18132/#fragment",
            "http://user:password@192.0.2.10:18132",
            "ws://192.0.2.10:18132",
            "file:///tmp/station",
            "invalid origin",
        ] {
            assert!(
                normalize_station_origin(rejected, StationOriginPolicy::Development).is_err(),
                "accepted malformed origin: {rejected}"
            );
        }
        for rejected in [
            "https://user@station.example",
            "https://station.example/path",
            "https://station.example/?query=1",
            "https://station.example/#fragment",
        ] {
            assert!(normalize_station_origin(rejected, StationOriginPolicy::HttpsOnly).is_err());
        }
    }

    fn test_engine(label: &str) -> (MobileMessagingEngine, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "peers-mobile-messaging-engine-{label}-{}",
            Ulid::new()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let database_path = root.join("profile.sqlite3");
        let engine = MobileMessagingEngine::open(
            &database_path,
            "profile-1".to_string(),
            "station-1".to_string(),
            "https://station.example".to_string(),
            "ptid:alice".to_string(),
            "mobile-device-1".to_string(),
            &[7; 32],
            [8; 32],
            "token".to_string(),
        )
        .unwrap();
        (engine, root)
    }

    #[test]
    fn cache_cleanup_reclaims_seeded_file_and_preserves_endpoint() {
        let (engine, root) = test_engine("cache-cleanup");
        let revision = "station-1\u{1f}ptid:alice\u{1f}mobile-device-1\u{1f}1";
        let endpoint_before = engine.scope().clone();
        assert_eq!(
            engine
                .seed_acceptance_storage_cache(2 * 1024 * 1024)
                .unwrap(),
            2 * 1024 * 1024
        );
        let before = engine.chat_storage_snapshot(revision).unwrap();
        assert!(before.cache_bytes >= 2 * 1024 * 1024);

        let result = engine.chat_storage_clear_cache(revision).unwrap();
        let operation = result.operation.expect("cleanup operation");
        let after = result.snapshot.expect("post-cleanup snapshot");

        assert_eq!(operation.state, ChatStorageOperationState::Succeeded as i32);
        assert!(result.error.is_none());
        assert!(operation.physical_bytes_before > operation.physical_bytes_after);
        assert!(after.physical_total_bytes < before.physical_total_bytes);
        assert!(after.cache_bytes < before.cache_bytes);
        assert_eq!(engine.scope(), &endpoint_before);
        drop(engine);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replacement_command_identity_is_stable_per_attempt_and_plan() {
        let first = replacement_command_id("command-1", &[7; 32]);
        assert_eq!(first, replacement_command_id("command-1", &[7; 32]));
        assert_ne!(first, replacement_command_id("command-1", &[8; 32]));
        assert_ne!(first, replacement_command_id("command-2", &[7; 32]));
        assert!(Ulid::from_string(&first).is_ok());
    }

    #[test]
    fn friend_request_command_signing_is_deterministic_and_device_bound() {
        let actor_identity = messaging_core::identity::IdentityKeyPair::from_seed(&[7; 32]);
        let signing_key =
            DeviceSigningKey::generate_cross_signed(&actor_identity, "device-1", |_| Vec::new());
        let intent = || FriendRequestCommandIntent {
            action: FriendRequestAction::Send,
            command_id: "command-1",
            request_id: "request-1",
            sender_ptid: "ptid:alice",
            receiver_ptid: "ptid:bob",
            sender_home_station_peer_id: "station-a",
            receiver_home_station_peer_id: "station-b",
            federation_id: "federation-1",
            message: "hello",
            created_at_unix_ms: 1_800_000_000_000,
        };
        let first =
            build_signed_friend_request_command(intent(), &signing_key, "device-key-1", "device-1")
                .unwrap();
        let second =
            build_signed_friend_request_command(intent(), &signing_key, "device-key-1", "device-1")
                .unwrap();
        assert_eq!(first.encode_to_vec(), second.encode_to_vec());
        let prepared = prepared_social_friend_request_command(first.clone()).unwrap();
        assert_eq!(prepared.action, FriendRequestAction::Send);
        assert_eq!(prepared.command_id, "command-1");
        assert_eq!(prepared.request_id, "request-1");
        assert_eq!(
            prepared.ordering_key,
            "social-friend-request-command:request-1"
        );
        assert_eq!(prepared.command_bytes, first.encode_to_vec());
        assert_eq!(
            prepared.payload_sha256,
            Sha256::digest(&prepared.command_bytes).to_vec()
        );
        assert_eq!(prepared.expires_at_unix_ms, 1_800_003_600_000);

        let body = first.body.as_ref().unwrap();
        assert_eq!(body.federation_id, "federation-1");
        assert_eq!(body.sender_home_station_peer_id, "station-a");
        assert_eq!(body.receiver_home_station_peer_id, "station-b");
        assert_eq!(
            body.authorizing_device
                .as_ref()
                .and_then(|device| device.actor.as_ref())
                .map(|actor| actor.ptid.as_str()),
            Some("ptid:alice")
        );
        let signing_input = FriendRequestCommandSigningInput {
            body: Some(body.clone()),
            signing_key_id: first.signing_key_id.clone(),
        }
        .encode_to_vec();
        signing_key
            .verifying_key()
            .verify(
                &signing_input,
                &Signature::from_slice(&first.actor_device_signature).unwrap(),
            )
            .unwrap();
    }

    #[test]
    fn relationship_command_signing_binds_direction_revision_and_device() {
        let actor_identity = messaging_core::identity::IdentityKeyPair::from_seed(&[9; 32]);
        let signing_key =
            DeviceSigningKey::generate_cross_signed(&actor_identity, "device-3", |_| Vec::new());
        let scope = MessagingAccountScope {
            station_peer_id: "station-a".to_string(),
            station_origin: "https://station.example".to_string(),
            actor_ptid: "ptid:alice".to_string(),
            device_id: "device-3".to_string(),
        };
        let intent = || RelationshipCommandIntent {
            action: SocialRelationshipAction::Block,
            command_id: "relationship-command-1",
            target_ptid: "ptid:bob",
            target_home_station_peer_id: "station-b",
            observed_revision: 7,
            created_at_unix_ms: 1_800_000_000_000,
        };
        let first = build_signed_social_relationship_command(
            &scope,
            intent(),
            &signing_key,
            "device-key-3",
            "device-3",
        )
        .unwrap();
        let second = build_signed_social_relationship_command(
            &scope,
            intent(),
            &signing_key,
            "device-key-3",
            "device-3",
        )
        .unwrap();
        assert_eq!(first.encode_to_vec(), second.encode_to_vec());
        let prepared = prepared_social_relationship_command(first.clone()).unwrap();
        assert_eq!(prepared.action, SocialRelationshipAction::Block);
        assert_eq!(prepared.command_id, "relationship-command-1");
        assert_eq!(prepared.target_ptid, "ptid:bob");
        assert_eq!(
            prepared.ordering_key,
            "social-relationship-command:ptid:alice:ptid:bob"
        );
        assert_eq!(prepared.command_bytes, first.encode_to_vec());
        assert_eq!(
            prepared.payload_sha256,
            Sha256::digest(&prepared.command_bytes).to_vec()
        );

        let body = first.body.as_ref().unwrap();
        assert_eq!(body.observed_revision, 7);
        assert_eq!(body.actor_home_station_peer_id, "station-a");
        assert_eq!(body.target_home_station_peer_id, "station-b");
        let signing_input = SocialRelationshipCommandSigningInput {
            body: Some(body.clone()),
            signing_key_id: first.signing_key_id.clone(),
        }
        .encode_to_vec();
        signing_key
            .verifying_key()
            .verify(
                &signing_input,
                &Signature::from_slice(&first.actor_device_signature).unwrap(),
            )
            .unwrap();
    }

    #[test]
    fn friend_request_decision_binds_receiver_device_and_pending_state() {
        let actor_identity = messaging_core::identity::IdentityKeyPair::from_seed(&[8; 32]);
        let signing_key =
            DeviceSigningKey::generate_cross_signed(&actor_identity, "device-2", |_| Vec::new());
        let command = build_signed_friend_request_command(
            FriendRequestCommandIntent {
                action: FriendRequestAction::Accept,
                command_id: "command-accept",
                request_id: "request-1",
                sender_ptid: "ptid:alice",
                receiver_ptid: "ptid:bob",
                sender_home_station_peer_id: "station-a",
                receiver_home_station_peer_id: "station-b",
                federation_id: "federation-1",
                message: "",
                created_at_unix_ms: 1_800_000_000_000,
            },
            &signing_key,
            "device-key-2",
            "device-2",
        )
        .unwrap();
        let body = command.body.unwrap();
        assert_eq!(
            FriendRequestState::try_from(body.observed_request_state).unwrap(),
            FriendRequestState::Pending
        );
        assert_eq!(
            body.authorizing_device
                .as_ref()
                .and_then(|device| device.actor.as_ref())
                .map(|actor| actor.ptid.as_str()),
            Some("ptid:bob")
        );
        assert!(body.message.is_empty());
    }

    #[test]
    fn dissolved_conversation_scope_remains_repairable() {
        let conversation = Conversation {
            conversation_id: "conversation-1".to_string(),
            authority_station_peer_id: "station-authority".to_string(),
            federation_id: "federation-1".to_string(),
            status: ConversationStatus::Dissolved as i32,
            ..Default::default()
        };

        assert_eq!(
            conversation_authority_scope(&conversation).unwrap(),
            ("station-authority", "federation-1")
        );
    }

    #[test]
    fn self_leave_intent_uses_exact_local_and_station_heads() {
        let scope = MessagingAccountScope {
            station_peer_id: "station-home".to_string(),
            station_origin: "https://station.example".to_string(),
            actor_ptid: "ptid:alice".to_string(),
            device_id: "alice-device".to_string(),
        };
        let local = ConversationProjection {
            conversation_id: "conversation-1".to_string(),
            authority_station_id: "station-authority".to_string(),
            federation_id: "federation-1".to_string(),
            kind: ConversationKind::Group as i32,
            name: "Group".to_string(),
            description: String::new(),
            avatar_object_id: String::new(),
            owner_ptid: "ptid:bob".to_string(),
            members: vec![
                messaging_core::contracts::ConversationAuthorityMemberProjection {
                    ptid: "ptid:alice".to_string(),
                    role: MemberRole::Member as i32,
                    home_station_peer_id: "station-home".to_string(),
                    muted: false,
                    muted_until_unix_ms: None,
                },
                messaging_core::contracts::ConversationAuthorityMemberProjection {
                    ptid: "ptid:bob".to_string(),
                    role: MemberRole::Owner as i32,
                    home_station_peer_id: "station-authority".to_string(),
                    muted: false,
                    muted_until_unix_ms: None,
                },
            ],
            membership_epoch: 3,
            mls_epoch: 4,
            active: true,
            updated_at_unix_ms: 1,
        };
        let authoritative = Conversation {
            conversation_id: "conversation-1".to_string(),
            kind: ConversationKind::Group as i32,
            authority_station_peer_id: "station-authority".to_string(),
            membership_epoch: 3,
            status: ConversationStatus::Active as i32,
            owner_ptid: "ptid:bob".to_string(),
            mls_epoch: 4,
            federation_id: "federation-1".to_string(),
            authority_epoch: 7,
            ..Default::default()
        };

        let input =
            self_leave_intent_input(&scope, &local, &authoritative, 9, vec![5; 32]).unwrap();

        assert_eq!(input.home_station_peer_id, "station-home");
        assert_eq!(input.authority_station_peer_id, "station-authority");
        assert_eq!(input.authority_epoch, 7);
        assert_eq!(input.observed_membership_epoch, 3);
        assert_eq!(input.observed_mls_epoch, 4);
        assert_eq!(input.authority_sequence, 9);
        assert_eq!(input.authority_hash, vec![5; 32]);

        let mut stale = authoritative.clone();
        stale.mls_epoch += 1;
        assert!(self_leave_intent_input(&scope, &local, &stale, 9, vec![5; 32]).is_err());

        let mut owner = local;
        owner.owner_ptid = scope.actor_ptid.clone();
        assert!(self_leave_intent_input(&scope, &owner, &authoritative, 9, vec![5; 32]).is_err());
    }

    #[test]
    fn member_authority_command_binds_exact_local_and_station_heads() {
        let scope = MessagingAccountScope {
            station_peer_id: "station-home".to_string(),
            station_origin: "https://station.example".to_string(),
            actor_ptid: "ptid:alice".to_string(),
            device_id: "alice-device".to_string(),
        };
        let local = ConversationProjection {
            conversation_id: "conversation-1".to_string(),
            authority_station_id: "station-authority".to_string(),
            federation_id: "federation-1".to_string(),
            kind: ConversationKind::Group as i32,
            name: "Group".to_string(),
            description: String::new(),
            avatar_object_id: String::new(),
            owner_ptid: "ptid:alice".to_string(),
            members: vec![
                messaging_core::contracts::ConversationAuthorityMemberProjection {
                    ptid: "ptid:alice".to_string(),
                    role: MemberRole::Owner as i32,
                    home_station_peer_id: "station-home".to_string(),
                    muted: false,
                    muted_until_unix_ms: None,
                },
                messaging_core::contracts::ConversationAuthorityMemberProjection {
                    ptid: "ptid:bob".to_string(),
                    role: MemberRole::Member as i32,
                    home_station_peer_id: "station-authority".to_string(),
                    muted: false,
                    muted_until_unix_ms: None,
                },
            ],
            membership_epoch: 5,
            mls_epoch: 3,
            active: true,
            updated_at_unix_ms: 1,
        };
        let authoritative = Conversation {
            conversation_id: local.conversation_id.clone(),
            kind: ConversationKind::Group as i32,
            authority_station_peer_id: local.authority_station_id.clone(),
            membership_epoch: local.membership_epoch,
            status: ConversationStatus::Active as i32,
            owner_ptid: local.owner_ptid.clone(),
            mls_epoch: local.mls_epoch,
            federation_id: local.federation_id.clone(),
            authority_epoch: 7,
            ..Default::default()
        };
        let created_at = 1_800_000_000_000;
        let command = prepare_member_authority_command(
            &scope,
            &local,
            &authoritative,
            (9, vec![5; 32]),
            "ptid:bob",
            ConversationMemberAuthorityAction::UpdateMember,
            Some(MemberRole::Admin),
            Some(true),
            Some(created_at + 60_000),
            created_at,
        )
        .unwrap();

        assert_eq!(command.version, 1);
        assert_eq!(command.conversation_id, "conversation-1");
        assert_eq!(
            command.operator,
            Some(CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            })
        );
        assert_eq!(command.target_ptid, "ptid:bob");
        assert_eq!(
            command.action,
            ConversationMemberAuthorityAction::UpdateMember as i32
        );
        assert_eq!(command.role, Some(MemberRole::Admin as i32));
        assert_eq!(command.muted, Some(true));
        assert_eq!(command.muted_until, Some(timestamp(created_at + 60_000)));
        assert_eq!(command.federation_id, "federation-1");
        assert_eq!(command.authority_station_peer_id, "station-authority");
        assert_eq!(command.authority_epoch, 7);
        assert_eq!(command.authority_sequence, 9);
        assert_eq!(command.authority_hash, vec![5; 32]);
        assert_eq!(command.observed_membership_epoch, 5);
        assert_eq!(command.observed_mls_epoch, 3);
        assert_eq!(command.client_timestamp, Some(timestamp(created_at)));
        assert_eq!(
            command.deadline,
            Some(timestamp(created_at + MEMBER_AUTHORITY_COMMAND_LIFETIME_MS))
        );

        let transfer = prepare_member_authority_command(
            &scope,
            &local,
            &authoritative,
            (9, vec![5; 32]),
            "ptid:bob",
            ConversationMemberAuthorityAction::TransferOwnership,
            None,
            None,
            None,
            created_at,
        )
        .unwrap();
        assert!(transfer.role.is_none());
        assert!(transfer.muted.is_none());
        assert!(transfer.muted_until.is_none());

        let mut stale = authoritative;
        stale.membership_epoch += 1;
        assert_eq!(
            prepare_member_authority_command(
                &scope,
                &local,
                &stale,
                (9, vec![5; 32]),
                "ptid:bob",
                ConversationMemberAuthorityAction::UpdateMember,
                Some(MemberRole::Admin),
                None,
                None,
                created_at,
            )
            .unwrap_err()
            .code,
            "CONVERSATION_STALE_MEMBERSHIP_EPOCH",
        );
    }

    #[test]
    fn attachment_stage_requires_bounded_contiguous_chunks() {
        let (engine, root) = test_engine("attachment-stage");
        let stage = engine
            .begin_attachment_stage(
                "sample.txt",
                "text/plain",
                6,
                AttachmentContentKind::File as i32,
                0,
                None,
            )
            .unwrap();
        assert!(engine
            .write_attachment_stage(&stage.stage_id, 1, b"abc")
            .is_err());
        engine
            .write_attachment_stage(&stage.stage_id, 0, b"abc")
            .unwrap();
        assert!(engine.complete_attachment_stage(&stage.stage_id).is_err());
        engine
            .write_attachment_stage(&stage.stage_id, 3, b"def")
            .unwrap();
        let completed = engine.complete_attachment_stage(&stage.stage_id).unwrap();
        assert!(completed.completed);
        engine.discard_attachment_stage(&stage.stage_id).unwrap();
        assert!(!engine
            .attachment_stage_path(&stage.stage_id)
            .unwrap()
            .exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn forward_attachment_restaging_copies_only_verified_plaintext() {
        let (engine, root) = test_engine("forward-attachment-restaging");
        let blobs = engine.attachment_blobs().unwrap();
        let source_ref = engine
            .attachment_cache_ref(&Ulid::new().to_string())
            .unwrap();
        let target_ref = engine
            .attachment_stage_ref(&Ulid::new().to_string())
            .unwrap();
        let plaintext = b"forwarded attachment";
        blobs.write_chunk(&source_ref, 0, plaintext).unwrap();
        let expected_hash: [u8; 32] = Sha256::digest(plaintext).into();

        copy_verified_attachment_source(
            &blobs,
            &source_ref,
            &target_ref,
            plaintext.len() as u64,
            &expected_hash,
        )
        .unwrap();

        assert_eq!(
            blobs.read_chunk(&target_ref, 0, plaintext.len()).unwrap(),
            plaintext
        );
        assert_eq!(blobs.sha256(&target_ref).unwrap(), expected_hash);
        assert!(blobs.exists(&source_ref).unwrap());

        let rejected_ref = engine
            .attachment_stage_ref(&Ulid::new().to_string())
            .unwrap();
        assert!(copy_verified_attachment_source(
            &blobs,
            &source_ref,
            &rejected_ref,
            plaintext.len() as u64,
            &[0; 32],
        )
        .is_err());
        assert!(!blobs.exists(&rejected_ref).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }
}
