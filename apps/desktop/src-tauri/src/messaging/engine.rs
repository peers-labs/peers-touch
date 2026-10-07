use super::recovery::{
    fetch_recovery_events_to_target, reconcile_archive_authority_events,
    restore_profile_database_atomically, MessagingRecoveryArchive, RecoveryReconciliation,
};
use super::store::{
    load_storage_retention_policy, CompletedSenderAttachmentSource, ConversationCommandCommit,
    DirectAuthorityCheckpoint,
};
use super::{
    verify_device_event_delivery, AttachmentDownloadProjection, AttachmentRetryPolicy,
    AttachmentTransferControl, AttachmentTransferProgress, AttachmentTransferRecord,
    AttachmentTransferWorker, CommandDispatchProgress, CommandOutboxWorker,
    CommandReconciliationProgress, CommandReconciliationWorker, CommandRetryPolicy,
    ConversationMemberProjection, ConversationMessagePage, ConversationMessageProjection,
    ConversationProjection, ConversationSummaryProjection, DirectSessionBootstrapper,
    DrainProgress, EditTextIntent, MessageRetryDisposition, MessagingItemConsumer,
    MessagingLifecycleWorker, MessagingStore, PendingAttachmentUpload, PendingMembershipIntent,
    PendingMessageDraft, PreKeyPublisher, QueueDrain, SendPreparer, SendTextIntent,
    StationAttachmentTransferTransport, StationCommandTransport, StationDeliveryReceiptTransport,
    StationDeviceTransport, StationGroupGenesisTransport, StationKeyBundleTransport,
    StationMembershipTransitionTransport, StationMlsKeyPackageTransport,
    StationMlsLeaveIntentTransport, StationPreKeyTransport, StationQueueTransport,
    SupersededInteractionIntent, ThreadCountProjection,
};
use crate::domain::crypto::IdentityKeyPair;
use crate::infrastructure::attachment_blob::FilesystemAttachmentBlob;
use crate::infrastructure::station_client;
use crate::infrastructure::storage::{self, StorageKind};
use crate::model::chat::{
    chat_command, ActorReadCursor, AttachmentContentKind, AttachmentTransferState, ChatCommand,
    Conversation, ConversationCommandKind, ConversationEvent, ConversationKind,
    ConversationMemberAuthorityAction, ConversationMemberAuthorityCommand,
    ConversationPublicHeadSource, CreateDirectConversationRequest,
    CreateDirectConversationResponse, CryptoEndpoint, DeviceConsumptionReceipt,
    DeviceEventDelivery, DeviceInboxPayloadType, DissolveConversationIntent,
    DurableDeviceInboxItem, GetConversationPublicHeadRequest, GetConversationPublicHeadResponse,
    GetConversationRequest, GetConversationResponse, ListConversationEventsRequest,
    ListConversationEventsResponse, MemberRole, MessagingMembershipAction, MessagingProjectionKind,
    MlsLeaveIntent, PrepareConversationCommandRequest, PrepareConversationCommandResponse,
    PreparedEndpointPayloadKind, SubmitConversationReadCursorRequest,
    SubmitConversationReadCursorResponse, SubmitConversationTypingRequest,
    UpdateConversationIntent,
};
use messaging_core::codec::verification::{verify_authority_event, verify_direct_genesis_event};
use messaging_core::contracts::CryptoEndpoint as CoreCryptoEndpoint;
use messaging_core::identity::enrollment::load_or_create_device_identity_from_seed;
use messaging_core::identity::{
    is_stale_endpoint_error, DeviceEnrollmentManager, FreshDeviceEnrollment,
    FreshDeviceIdentityState,
};
use messaging_core::mls::actor_device_identity::ActorDeviceIdentity;
use messaging_core::mls::group::MlsGroupManager;
use messaging_core::mls::group_genesis::GroupGenesisPreparer;
use messaging_core::mls::key_packages::MlsKeyPackagePublisher;
use messaging_core::mls::leave_intent::{
    list_leave_intents, submit_leave_intent, MlsLeaveIntentInput,
};
use messaging_core::mls::membership_transition::{
    MembershipTransitionIntentInput, MembershipTransitionPreparer,
};
use messaging_core::mls::startup::restore_persisted_mls_state;
pub use messaging_core::outbox::MetadataInteraction;
use messaging_core::outbox::MetadataInteractionPreparer;
use messaging_core::proto::actor::ActorDevice;
use messaging_core::proto::actor_device_ref;
use messaging_core::proto::chat::{
    ChatStorageOperationState, ChatStoragePolicy, ChatStorageResult, ChatStorageScope,
    ChatStorageSnapshot,
};
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
use prost::Message;
use reqwest::Method;
use secure_content_core::object::{
    ObjectCryptoMaterial as AttachmentCryptoMaterial, OBJECT_CHUNK_SIZE as ATTACHMENT_CHUNK_SIZE,
    OBJECT_MAX_PLAINTEXT_SIZE as ATTACHMENT_MAX_PLAINTEXT_SIZE,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use ulid::Ulid;
use zeroize::Zeroizing;

const INTERACTION_PREFLIGHT_DRAIN_LIMIT: u32 = 100;
const ATTACHMENT_OPEN_TIMEOUT: Duration = Duration::from_secs(30);
const ATTACHMENT_OPEN_RETRY_FLOOR: Duration = Duration::from_millis(10);
const PREKEY_INVENTORY_RECONCILIATION_INTERVAL_MS: i64 = 60_000;
const SENDER_ATTACHMENT_SOURCE_INVALID: &str = "messaging sender attachment source is invalid";
const MEMBER_AUTHORITY_COMMAND_LIFETIME_MS: i64 = 5 * 60 * 1_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessagingProjectionChange {
    pub profile_id: String,
    pub actor_ptid: String,
    pub home_station_peer_id: String,
    pub device_id: String,
    pub conversation_id: String,
    pub event_id: String,
    pub lane_sequence: i64,
    pub kind: MessagingProjectionKind,
    pub message_id: String,
    pub message_removed_from_projection: bool,
}

pub type MessagingProjectionNotifier = Arc<dyn Fn(MessagingProjectionChange) + Send + Sync>;

fn projection_change_metadata(
    item: &DurableDeviceInboxItem,
    actor_ptid: &str,
) -> (MessagingProjectionKind, String, bool) {
    if DeviceInboxPayloadType::try_from(item.payload_type).ok()
        != Some(DeviceInboxPayloadType::ConversationEvent)
    {
        return (MessagingProjectionKind::Conversation, String::new(), false);
    }
    let Ok(delivery) = DeviceEventDelivery::decode(item.opaque_payload.as_slice()) else {
        return (MessagingProjectionKind::Conversation, String::new(), false);
    };
    let Some(event) = delivery.event else {
        return (MessagingProjectionKind::Conversation, String::new(), false);
    };
    match event.payload {
        Some(crate::model::chat::conversation_event::Payload::MessageHiddenForActor(fact))
            if fact.actor_ptid == actor_ptid =>
        {
            (MessagingProjectionKind::Message, fact.message_id, true)
        }
        _ => (MessagingProjectionKind::Conversation, String::new(), false),
    }
}

#[derive(Default)]
struct PreKeyMaintenanceState {
    next_inventory_reconciliation_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineEndpoint {
    pub ptid: String,
    pub device_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubmitMessageOutcome {
    pub command_id: Option<String>,
    pub message_id: String,
    pub attachment_ids: Vec<String>,
    pub state: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetryMessageOutcome {
    pub command_id: Option<String>,
    pub message_id: String,
    pub state: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedGroupConversation {
    pub conversation_id: String,
    pub command_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalAttachmentIntent {
    pub source_local_ref: String,
    pub filename: String,
    pub mime_type: String,
    pub content_kind: i32,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum AttachmentOpenProgress {
    Ready(String),
    Pending { next_attempt_at_unix_ms: i64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DurableInteraction {
    Edit(String),
    Retract,
    Reaction { reaction: String, remove: bool },
    Pin { remove: bool },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DirectAuthorityCheckpointTarget {
    conversation_id: String,
    conversation_kind: i32,
    event_sequence: i64,
    event_hash: Vec<u8>,
    membership_epoch: i64,
    mls_epoch: i64,
    authority_station_peer_id: String,
}

impl From<&PrepareConversationCommandResponse> for DirectAuthorityCheckpointTarget {
    fn from(plan: &PrepareConversationCommandResponse) -> Self {
        Self {
            conversation_id: plan.conversation_id.clone(),
            conversation_kind: plan.conversation_kind,
            event_sequence: plan.authority_sequence,
            event_hash: plan.authority_hash.clone(),
            membership_epoch: plan.membership_epoch,
            mls_epoch: plan.mls_epoch,
            authority_station_peer_id: plan.authority_station_peer_id.clone(),
        }
    }
}

fn direct_authority_checkpoint_projection(
    events: &[ConversationEvent],
    target: &DirectAuthorityCheckpointTarget,
    local_ptid: &str,
    observed_at_unix_ms: i64,
) -> Result<ConversationProjection, String> {
    let genesis = events
        .first()
        .ok_or_else(|| "messaging Direct authority checkpoint has no events".to_string())?;
    let created = verify_direct_genesis_event(genesis, local_ptid)?;
    let snapshot = created
        .post_state
        .as_ref()
        .ok_or_else(|| "messaging Direct genesis authority snapshot is missing".to_string())?;
    let mut previous_hash = Vec::new();
    for (index, event) in events.iter().enumerate() {
        verify_authority_event(event)?;
        let expected_sequence = i64::try_from(index + 1)
            .map_err(|_| "messaging Direct authority checkpoint is too large".to_string())?;
        if event.conversation_id != genesis.conversation_id
            || event.authority_station_peer_id != genesis.authority_station_peer_id
            || event.sequence != expected_sequence
            || event.previous_hash != previous_hash
        {
            return Err(
                "messaging Direct authority checkpoint chain is not contiguous".to_string(),
            );
        }
        previous_hash = event.event_hash.clone();
    }
    let head = events
        .last()
        .ok_or_else(|| "messaging Direct authority checkpoint has no head".to_string())?;
    if target.conversation_id != genesis.conversation_id
        || target.conversation_kind != ConversationKind::Direct as i32
        || target.event_sequence != head.sequence
        || target.event_hash != head.event_hash
        || target.membership_epoch != head.membership_epoch
        || target.mls_epoch != head.mls_epoch
        || target.authority_station_peer_id != head.authority_station_peer_id
        || observed_at_unix_ms <= 0
    {
        return Err("messaging Direct authority checkpoint does not match target head".to_string());
    }
    Ok(ConversationProjection {
        conversation_id: genesis.conversation_id.clone(),
        authority_station_id: genesis.authority_station_peer_id.clone(),
        federation_id: snapshot.federation_id.clone(),
        kind: snapshot.kind,
        name: snapshot.name.clone(),
        description: snapshot.description.clone(),
        avatar_object_id: snapshot.avatar_object_id.clone(),
        owner_ptid: snapshot.owner_ptid.clone(),
        members: snapshot
            .active_members
            .iter()
            .map(|member| ConversationMemberProjection {
                ptid: member.ptid.clone(),
                role: MemberRole::Member as i32,
                home_station_peer_id: member.home_station_peer_id.clone(),
                muted: member.muted,
                muted_until_unix_ms: member.muted_until.as_ref().map(|value| {
                    value
                        .seconds
                        .saturating_mul(1_000)
                        .saturating_add(i64::from(value.nanos) / 1_000_000)
                }),
            })
            .collect(),
        membership_epoch: snapshot.membership_epoch,
        mls_epoch: snapshot.mls_epoch,
        active: true,
        updated_at_unix_ms: observed_at_unix_ms,
    })
}

fn fetch_direct_authority_events(
    token: &str,
    device_id: &str,
    target: &DirectAuthorityCheckpointTarget,
) -> Result<Vec<ConversationEvent>, String> {
    if token.trim().is_empty()
        || device_id.trim().is_empty()
        || target.conversation_id.trim().is_empty()
        || target.event_sequence <= 0
        || target.event_hash.len() != 32
        || target.authority_station_peer_id.trim().is_empty()
    {
        return Err("messaging Direct authority checkpoint target is invalid".to_string());
    }

    const PAGE_LIMIT: i64 = 100;
    const MAX_PAGES: usize = 1_000;
    let mut events = Vec::new();
    let mut after_sequence = 0_i64;
    for _ in 0..MAX_PAGES {
        if after_sequence >= target.event_sequence {
            break;
        }
        let limit = i32::try_from((target.event_sequence - after_sequence).min(PAGE_LIMIT))
            .map_err(|_| "messaging Direct authority checkpoint page is invalid".to_string())?;
        let query = [
            ("conversation_id", target.conversation_id.clone()),
            ("after_seq", after_sequence.to_string()),
            ("limit", limit.to_string()),
        ];
        let response = station_client::request_proto_for_device::<
            ListConversationEventsRequest,
            ListConversationEventsResponse,
        >(
            Method::GET,
            "/conversation/events",
            token,
            Some(&query),
            None,
            device_id,
        )
        .map_err(|error| format!("fetch Direct authority events: {error}"))?;
        let next_sequence = response
            .events
            .last()
            .map(|event| event.sequence)
            .ok_or_else(|| {
                "messaging Direct authority checkpoint event log is incomplete".to_string()
            })?;
        if next_sequence <= after_sequence || next_sequence > target.event_sequence {
            return Err(
                "messaging Direct authority checkpoint event page is out of range".to_string(),
            );
        }
        after_sequence = next_sequence;
        events.extend(response.events);
    }
    if after_sequence != target.event_sequence {
        return Err("messaging Direct authority checkpoint exceeded replay bound".to_string());
    }
    Ok(events)
}

fn apply_direct_authority_checkpoint(
    store: &MessagingStore,
    local_ptid: &str,
    target: &DirectAuthorityCheckpointTarget,
    events: &[ConversationEvent],
    observed_at_unix_ms: i64,
) -> Result<bool, String> {
    let projection =
        direct_authority_checkpoint_projection(events, target, local_ptid, observed_at_unix_ms)?;
    store.bootstrap_direct_authority_head(&DirectAuthorityCheckpoint {
        projection: &projection,
        event_sequence: target.event_sequence,
        event_hash: &target.event_hash,
        observed_at_unix_ms,
    })
}

fn pending_direct_receiver_checkpoint(
    store: &MessagingStore,
    endpoint: &EngineEndpoint,
    item: &DurableDeviceInboxItem,
) -> Result<Option<DirectAuthorityCheckpointTarget>, String> {
    if DeviceInboxPayloadType::try_from(item.payload_type).ok()
        != Some(DeviceInboxPayloadType::ConversationEvent)
    {
        return Ok(None);
    }
    let Ok(delivery) = DeviceEventDelivery::decode(item.opaque_payload.as_slice()) else {
        return Ok(None);
    };
    if PreparedEndpointPayloadKind::try_from(delivery.payload_kind).ok()
        != Some(PreparedEndpointPayloadKind::DirectCiphertext)
    {
        return Ok(None);
    }
    let delivery = verify_device_event_delivery(item, &endpoint.ptid, &endpoint.device_id)?;
    let event = delivery
        .event
        .as_ref()
        .ok_or_else(|| "messaging Direct delivery has no authority event".to_string())?;
    if event.sequence <= 1 {
        return Ok(None);
    }
    if event.previous_hash.len() != 32 {
        return Err(
            "messaging fresh Direct receiver event has invalid previous authority hash".to_string(),
        );
    }
    let (local_sequence, local_hash) = store.authority_head(&event.conversation_id)?;
    if local_sequence != 0 || !local_hash.is_empty() {
        return Ok(None);
    }
    Ok(Some(DirectAuthorityCheckpointTarget {
        conversation_id: event.conversation_id.clone(),
        conversation_kind: ConversationKind::Direct as i32,
        event_sequence: event.sequence - 1,
        event_hash: event.previous_hash.clone(),
        membership_epoch: event.membership_epoch,
        mls_epoch: event.mls_epoch,
        authority_station_peer_id: event.authority_station_peer_id.clone(),
    }))
}

fn checkpoint_fresh_direct_receiver(
    store: &MessagingStore,
    endpoint: &EngineEndpoint,
    token: &str,
    item: &DurableDeviceInboxItem,
) -> Result<bool, String> {
    let Some(target) = pending_direct_receiver_checkpoint(store, endpoint, item)? else {
        return Ok(false);
    };
    let events = fetch_direct_authority_events(token, &endpoint.device_id, &target)?;
    let bootstrapped =
        apply_direct_authority_checkpoint(store, &endpoint.ptid, &target, &events, now_unix_ms())?;
    Ok(bootstrapped)
}

fn drive_attachment_open<F, S>(
    deadline: Instant,
    mut open_once: F,
    mut sleep: S,
) -> Result<String, String>
where
    F: FnMut() -> Result<AttachmentOpenProgress, String>,
    S: FnMut(Duration),
{
    loop {
        match open_once()? {
            AttachmentOpenProgress::Ready(path) => return Ok(path),
            AttachmentOpenProgress::Pending {
                next_attempt_at_unix_ms,
            } => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(
                        "messaging attachment download did not complete before open deadline"
                            .to_string(),
                    );
                }
                let retry_delay_ms = next_attempt_at_unix_ms
                    .saturating_sub(now_unix_ms())
                    .max(ATTACHMENT_OPEN_RETRY_FLOOR.as_millis() as i64);
                sleep(Duration::from_millis(retry_delay_ms as u64).min(remaining));
            }
        }
    }
}

pub struct MessagingEngine {
    profile_id: String,
    endpoint: EngineEndpoint,
    consumer_id: String,
    store: Arc<MessagingStore>,
    actor_identity: Option<Arc<IdentityKeyPair>>,
    mls_manager: Arc<MlsGroupManager>,
    consumer: Arc<MessagingItemConsumer>,
    drain_lock: Mutex<()>,
    dispatch_lock: Mutex<()>,
    send_intent_lock: Mutex<()>,
    membership_transition_lock: Mutex<()>,
    prekey_maintenance: Mutex<PreKeyMaintenanceState>,
    attachment_source_lock: Mutex<()>,
    storage_governance_lock: Mutex<()>,
    attachment_transfer_control: Arc<AttachmentTransferControl>,
    runtime_consumer_epoch: Arc<AtomicU64>,
    projection_notifier: Mutex<Option<MessagingProjectionNotifier>>,
}

impl MessagingEngine {
    pub fn open_profile(
        profile_id: String,
        ptid: String,
        actor_identity_seed: &[u8; 32],
        actor_profile_version: u64,
    ) -> Result<Self, String> {
        if profile_id.trim().is_empty() || ptid.trim().is_empty() || actor_profile_version == 0 {
            return Err(
                "messaging profile requires PTID, identity, and profile version".to_string(),
            );
        }
        let store = Arc::new(MessagingStore::open(&profile_id)?);
        Self::from_profile_store(
            profile_id,
            ptid,
            actor_identity_seed,
            actor_profile_version,
            store,
        )
    }

    fn from_profile_store(
        profile_id: String,
        ptid: String,
        actor_identity_seed: &[u8; 32],
        actor_profile_version: u64,
        store: Arc<MessagingStore>,
    ) -> Result<Self, String> {
        let enrollment = load_or_create_device_identity_from_seed(
            store.as_ref(),
            &ptid,
            actor_identity_seed,
            actor_profile_version,
        )?;
        let device = enrollment
            .certificate
            .device
            .as_ref()
            .ok_or_else(|| "messaging device certificate has no endpoint".to_string())?;
        let endpoint = EngineEndpoint {
            ptid,
            device_id: device.device_id.clone(),
        };
        Self::from_store_with_identity(
            profile_id,
            endpoint,
            store,
            Some(Arc::new(IdentityKeyPair::from_seed(actor_identity_seed))),
        )
    }

    pub fn open(profile_id: String, endpoint: EngineEndpoint) -> Result<Self, String> {
        validate_identity(&profile_id, &endpoint)?;
        let store = Arc::new(MessagingStore::open(&profile_id)?);
        Self::from_store(profile_id, endpoint, store)
    }

    #[cfg(test)]
    pub(super) fn in_memory(profile_id: String, endpoint: EngineEndpoint) -> Result<Self, String> {
        validate_identity(&profile_id, &endpoint)?;
        Self::from_store(profile_id, endpoint, Arc::new(MessagingStore::in_memory()?))
    }

    fn from_store(
        profile_id: String,
        endpoint: EngineEndpoint,
        store: Arc<MessagingStore>,
    ) -> Result<Self, String> {
        Self::from_store_with_identity(profile_id, endpoint, store, None)
    }

    fn from_store_with_identity(
        profile_id: String,
        endpoint: EngineEndpoint,
        store: Arc<MessagingStore>,
        profile_actor_identity: Option<Arc<IdentityKeyPair>>,
    ) -> Result<Self, String> {
        store.reconcile_completed_attachment_uploads()?;
        let mls_actor_identity = Arc::new(ActorDeviceIdentity::new());
        match store.load_mls_actor_identity()? {
            Some((ptid, device_id, state)) => {
                if ptid != endpoint.ptid || device_id != endpoint.device_id {
                    return Err("messaging MLS identity belongs to another endpoint".to_string());
                }
                mls_actor_identity.import(&endpoint.ptid, &endpoint.device_id, &state)?;
            }
            None => {
                mls_actor_identity.init(&endpoint.ptid, &endpoint.device_id)?;
                let state = mls_actor_identity.export(&endpoint.ptid, &endpoint.device_id)?;
                store.save_mls_actor_identity(&endpoint.ptid, &endpoint.device_id, &state)?;
            }
        }
        let mls_manager = Arc::new(MlsGroupManager::with_actor_identity(mls_actor_identity));
        restore_persisted_mls_state(mls_manager.as_ref(), store.as_ref())?;
        let consumer = Arc::new(MessagingItemConsumer::new(
            store.clone(),
            mls_manager.clone(),
            endpoint.clone(),
            profile_actor_identity.clone(),
            now_unix_ms,
        )?);
        Ok(Self {
            profile_id,
            endpoint,
            consumer_id: format!("desktop-engine:{}", Ulid::new()),
            store,
            actor_identity: profile_actor_identity,
            mls_manager,
            consumer,
            drain_lock: Mutex::new(()),
            dispatch_lock: Mutex::new(()),
            send_intent_lock: Mutex::new(()),
            membership_transition_lock: Mutex::new(()),
            prekey_maintenance: Mutex::new(PreKeyMaintenanceState::default()),
            attachment_source_lock: Mutex::new(()),
            storage_governance_lock: Mutex::new(()),
            attachment_transfer_control: Arc::new(AttachmentTransferControl::new()),
            runtime_consumer_epoch: Arc::new(AtomicU64::new(0)),
            projection_notifier: Mutex::new(None),
        })
    }

    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    pub fn chat_storage_snapshot(
        &self,
        station_peer_id: &str,
        scope_revision: &str,
    ) -> Result<ChatStorageSnapshot, String> {
        if station_peer_id.trim().is_empty() || scope_revision.trim().is_empty() {
            return Err("chat storage scope is incomplete".to_string());
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
                attachment_source_root(&self.profile_id)?,
                PhysicalStorageClass::Protected,
            ),
        ];
        let cache_root = attachment_cache_path(&self.profile_id, "root")?
            .parent()
            .ok_or_else(|| "messaging attachment cache root is unavailable".to_string())?
            .to_path_buf();
        physical_paths.push(PhysicalStoragePath::optional(
            cache_root,
            PhysicalStorageClass::Cache,
        ));
        physical_paths.extend(
            self.store
                .storage_media_paths()?
                .into_iter()
                .map(|path| PhysicalStoragePath::required(path, PhysicalStorageClass::Media)),
        );

        let scope = ChatStorageScope {
            station_peer_id: station_peer_id.to_string(),
            actor_ptid: self.endpoint.ptid.clone(),
            device_id: self.endpoint.device_id.clone(),
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
        station_peer_id: &str,
        scope_revision: &str,
    ) -> Result<ChatStorageResult, String> {
        let _guard = self
            .storage_governance_lock
            .lock()
            .map_err(|_| "chat storage governance lock poisoned".to_string())?;
        let before = self.chat_storage_snapshot(station_peer_id, scope_revision)?;
        let cache_root = attachment_cache_path(&self.profile_id, "root")?
            .parent()
            .ok_or_else(|| "messaging attachment cache root is unavailable".to_string())?
            .to_path_buf();
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
                let after = self.chat_storage_snapshot(station_peer_id, scope_revision)?;
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
        let after = self.chat_storage_snapshot(station_peer_id, scope_revision)?;
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
        station_peer_id: &str,
        scope_revision: &str,
        retention_preset: i32,
    ) -> Result<ChatStorageResult, String> {
        let _guard = self
            .storage_governance_lock
            .lock()
            .map_err(|_| "chat storage governance lock poisoned".to_string())?;
        let mut before = self.chat_storage_snapshot(station_peer_id, scope_revision)?;
        let scope = before
            .scope
            .clone()
            .ok_or_else(|| "chat retention scope is unavailable".to_string())?;
        let cache_root = attachment_cache_path(&self.profile_id, "root")?
            .parent()
            .ok_or_else(|| "messaging attachment cache root is unavailable".to_string())?
            .to_path_buf();

        if let Some(resume) = self
            .store
            .load_resumable_retention(&scope, scope_revision)?
        {
            let resumed_preset = resume.policy.retention_preset;
            let resumed = self.finish_retention_operation(
                station_peer_id,
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
            before = resumed
                .snapshot
                .clone()
                .ok_or_else(|| "chat retention resume snapshot is unavailable".to_string())?;
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
            station_peer_id,
            scope_revision,
            retention.policy,
            retention.commit.operation,
            &cache_root,
        )
    }

    pub fn chat_storage_clear_conversation(
        &self,
        station_peer_id: &str,
        scope_revision: &str,
        conversation_id: &str,
    ) -> Result<ChatStorageResult, String> {
        let _guard = self
            .storage_governance_lock
            .lock()
            .map_err(|_| "chat storage governance lock poisoned".to_string())?;
        let before = self.chat_storage_snapshot(station_peer_id, scope_revision)?;
        let scope = before
            .scope
            .clone()
            .ok_or_else(|| "chat conversation clear scope is unavailable".to_string())?;
        let cache_root = attachment_cache_path(&self.profile_id, "root")?
            .parent()
            .ok_or_else(|| "messaging attachment cache root is unavailable".to_string())?
            .to_path_buf();

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
            station_peer_id,
            scope_revision,
            conversation_id,
            operation,
            &cache_root,
        )
    }

    fn finish_conversation_clear_operation(
        &self,
        station_peer_id: &str,
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
        let after = self.chat_storage_snapshot(station_peer_id, scope_revision)?;
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
        station_peer_id: &str,
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
        let after = self.chat_storage_snapshot(station_peer_id, scope_revision)?;
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

    #[cfg(feature = "acceptance-webdriver")]
    pub fn seed_acceptance_storage_conversation_clear(
        &self,
        station_peer_id: &str,
        plaintext_bytes: usize,
    ) -> Result<(String, String), String> {
        self.store.acceptance_seed_conversation_clear_fixture(
            station_peer_id,
            plaintext_bytes,
            now_unix_ms(),
        )
    }

    #[cfg(feature = "acceptance-webdriver")]
    pub fn seed_acceptance_storage_cache(&self, size_bytes: usize) -> Result<PathBuf, String> {
        if size_bytes == 0 || size_bytes > 16 * 1024 * 1024 {
            return Err("acceptance cache fixture size is invalid".to_string());
        }
        let cache_root = attachment_cache_path(&self.profile_id, "root")?
            .parent()
            .ok_or_else(|| "messaging attachment cache root is unavailable".to_string())?
            .to_path_buf();
        std::fs::create_dir_all(&cache_root)
            .map_err(|error| format!("create acceptance cache root: {error}"))?;
        let path = cache_root.join(format!("acceptance-rebuildable-{}.bin", Ulid::new()));
        std::fs::write(&path, vec![0x5a_u8; size_bytes])
            .map_err(|error| format!("write acceptance cache fixture: {error}"))?;
        Ok(path)
    }

    pub fn endpoint(&self) -> &EngineEndpoint {
        &self.endpoint
    }

    pub fn actor_device_identity(&self) -> Arc<ActorDeviceIdentity> {
        self.mls_manager.actor_identity()
    }

    pub fn device_signing_identity(
        &self,
    ) -> Result<Option<(String, ed25519_dalek::SigningKey)>, String> {
        let Some((seed, key_id)) = self.store.device_signing_seed()? else {
            return Ok(None);
        };
        Ok(Some((key_id, ed25519_dalek::SigningKey::from_bytes(&seed))))
    }

    pub fn store(&self) -> &MessagingStore {
        self.store.as_ref()
    }

    pub fn attachment_transfer_worker(
        &self,
        token: String,
    ) -> Result<AttachmentTransferWorker, String> {
        let transport = StationAttachmentTransferTransport::new(
            token,
            CryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            },
        )?;
        AttachmentTransferWorker::with_control(
            self.store.clone(),
            Arc::new(transport),
            Arc::new(FilesystemAttachmentBlob),
            self.attachment_transfer_control.clone(),
            AttachmentRetryPolicy::default(),
        )
    }

    pub fn request_attachment_transfer_shutdown(&self) {
        self.attachment_transfer_control.request_shutdown();
    }

    pub fn stage_attachment_source(&self, filename: &str, bytes: &[u8]) -> Result<String, String> {
        self.persist_attachment_source(filename, bytes.len() as u64, bytes)
    }

    pub fn stage_attachment_file(
        &self,
        filename: &str,
        source_path: &Path,
    ) -> Result<String, String> {
        let source = File::open(source_path)
            .map_err(|error| format!("open selected messaging attachment: {error}"))?;
        let plaintext_size = source
            .metadata()
            .map_err(|error| format!("stat selected messaging attachment: {error}"))?
            .len();
        self.persist_attachment_source(filename, plaintext_size, source)
    }

    fn persist_attachment_source(
        &self,
        filename: &str,
        plaintext_size: u64,
        mut source: impl Read,
    ) -> Result<String, String> {
        if filename.trim().is_empty()
            || filename.len() > 1024
            || plaintext_size == 0
            || plaintext_size > ATTACHMENT_MAX_PLAINTEXT_SIZE
        {
            return Err("messaging attachment source is invalid".to_string());
        }
        let root = attachment_source_root(&self.profile_id)?;
        std::fs::create_dir_all(&root)
            .map_err(|error| format!("create messaging attachment source directory: {error}"))?;
        let path = root.join(Ulid::new().to_string());
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&path)
            .map_err(|error| format!("create messaging attachment source: {error}"))?;
        let persisted = std::io::copy(&mut source, &mut file)
            .and_then(|copied| {
                file.sync_all()?;
                Ok(copied)
            })
            .map_err(|error| {
                let _ = std::fs::remove_file(&path);
                format!("persist messaging attachment source: {error}")
            })?;
        if persisted != plaintext_size {
            let _ = std::fs::remove_file(&path);
            return Err("messaging attachment source size changed while staging".to_string());
        }
        Ok(path.display().to_string())
    }

    pub fn discard_staged_attachment_source(&self, source_local_ref: &str) -> Result<(), String> {
        let _guard = self
            .attachment_source_lock
            .lock()
            .map_err(|_| "messaging attachment source lock poisoned".to_string())?;
        let path = Path::new(source_local_ref);
        if !managed_attachment_source(&self.profile_id, path)? {
            return Err("messaging attachment source is not Engine-managed".to_string());
        }
        if self.store.owns_attachment_source(source_local_ref)? {
            return Ok(());
        }
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("remove messaging attachment source: {error}")),
        }
    }

    pub fn cleanup_completed_attachment_sources(&self) -> Result<usize, String> {
        let _guard = self
            .attachment_source_lock
            .lock()
            .map_err(|_| "messaging attachment source lock poisoned".to_string())?;
        let mut cleaned = 0;
        let completed_sources = self.store.completed_attachment_sources()?;
        for source in completed_sources {
            let source_path = Path::new(&source.source_local_ref);
            let cache_path = self.promote_sender_attachment_cache(&source)?;
            let cache_path_string = cache_path.display().to_string();
            let expected_plaintext_sha256: [u8; 32] =
                source.plaintext_sha256.as_slice().try_into().map_err(|_| {
                    "messaging attachment plaintext commitment is invalid".to_string()
                })?;
            if sha256_path(&cache_path)? != expected_plaintext_sha256 {
                return Err("messaging promoted attachment cache is invalid".to_string());
            }
            let path = source_path;
            if !managed_attachment_source(&self.profile_id, path)? {
                continue;
            }
            match std::fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "remove completed messaging attachment source: {error}"
                    ))
                }
            }
            self.store
                .clear_completed_attachment_source(&source, &cache_path_string)?;
            cleaned += 1;
        }
        Ok(cleaned)
    }

    pub fn open_attachment(&self, token: &str, attachment_id: &str) -> Result<String, String> {
        drive_attachment_open(
            Instant::now() + ATTACHMENT_OPEN_TIMEOUT,
            || self.open_attachment_once(token, attachment_id),
            std::thread::sleep,
        )
    }

    fn open_attachment_once(
        &self,
        token: &str,
        attachment_id: &str,
    ) -> Result<AttachmentOpenProgress, String> {
        if token.trim().is_empty() || attachment_id.trim().is_empty() {
            return Err("messaging attachment open intent is incomplete".to_string());
        }
        let sender_cache = {
            let _guard = self
                .attachment_source_lock
                .lock()
                .map_err(|_| "messaging attachment source lock poisoned".to_string())?;
            match self
                .store
                .completed_sender_attachment_source(attachment_id)?
            {
                Some(source) => match self.promote_sender_attachment_cache(&source) {
                    Ok(cache_path) => Some(cache_path),
                    Err(error)
                        if error == SENDER_ATTACHMENT_SOURCE_INVALID
                            && self
                                .store
                                .attachment_download_projection(attachment_id)?
                                .is_some() =>
                    {
                        None
                    }
                    Err(error) => return Err(error),
                },
                None => None,
            }
        };
        if let Some(cache_path) = sender_cache {
            return Ok(AttachmentOpenProgress::Ready(
                cache_path.display().to_string(),
            ));
        }
        let projection = self.store.attachment_download_projection(attachment_id)?;
        let projection = projection
            .ok_or_else(|| "messaging attachment projection is unavailable".to_string())?;
        let expected_plaintext_sha256: [u8; 32] = projection
            .metadata
            .plaintext_sha256
            .as_slice()
            .try_into()
            .map_err(|_| "messaging attachment plaintext commitment is invalid".to_string())?;
        if let Some(cache_path) = projection.local_cache_path.as_deref() {
            let path = Path::new(cache_path);
            if path.is_file() && sha256_path(path)? == expected_plaintext_sha256 {
                return Ok(AttachmentOpenProgress::Ready(cache_path.to_string()));
            }
        }
        let download_transfer =
            attachment_download_transfer(&self.profile_id, &projection, now_unix_ms())?;
        {
            let _guard = self
                .attachment_source_lock
                .lock()
                .map_err(|_| "messaging attachment source lock poisoned".to_string())?;
            match self.store.attachment_transfer(attachment_id)? {
                Some(transfer) if transfer.direction == 1 => {
                    self.store
                        .replace_completed_upload_with_download(&download_transfer)?;
                    let source_path = Path::new(&transfer.source_local_ref);
                    if !transfer.source_local_ref.is_empty()
                        && managed_attachment_source(&self.profile_id, source_path)?
                    {
                        match std::fs::remove_file(source_path) {
                            Ok(()) => {}
                            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                            Err(error) => {
                                return Err(format!(
                                    "remove invalid messaging attachment source: {error}"
                                ))
                            }
                        }
                    }
                }
                Some(transfer) if transfer.direction == 2 => {}
                Some(_) => {
                    return Err("messaging attachment transfer direction is invalid".to_string())
                }
                None => {
                    self.store.create_attachment_transfer(&download_transfer)?;
                }
            }
        }
        let object = projection
            .metadata
            .object
            .as_ref()
            .ok_or_else(|| "messaging attachment descriptor is missing".to_string())?;
        let cache_path = attachment_cache_path(&self.profile_id, attachment_id)?;
        let cache_ref = cache_path.to_string_lossy();
        let worker = self.attachment_transfer_worker(token.to_string())?;
        match worker.run_download_once(
            attachment_id,
            object,
            &expected_plaintext_sha256,
            &cache_ref,
            now_unix_ms(),
        )? {
            AttachmentTransferProgress::Complete => Ok(AttachmentOpenProgress::Ready(
                cache_path.display().to_string(),
            )),
            AttachmentTransferProgress::Deferred {
                next_attempt_at_unix_ms,
            }
            | AttachmentTransferProgress::RetryScheduled {
                next_attempt_at_unix_ms,
            } => Ok(AttachmentOpenProgress::Pending {
                next_attempt_at_unix_ms,
            }),
            AttachmentTransferProgress::Terminal { .. } => {
                Err("messaging attachment download failed".to_string())
            }
        }
    }

    fn promote_sender_attachment_cache(
        &self,
        source: &CompletedSenderAttachmentSource,
    ) -> Result<PathBuf, String> {
        let source_path = Path::new(&source.source_local_ref);
        if !managed_attachment_source(&self.profile_id, source_path)? {
            return Err("messaging attachment source is not Engine-managed".to_string());
        }
        let expected_plaintext_sha256: [u8; 32] = source
            .plaintext_sha256
            .as_slice()
            .try_into()
            .map_err(|_| "messaging attachment plaintext commitment is invalid".to_string())?;
        let cache_path = attachment_cache_path(&self.profile_id, &source.attachment_id)?;
        if source
            .local_cache_path
            .as_deref()
            .is_some_and(|recorded| Path::new(recorded) != cache_path)
        {
            return Err("messaging sender attachment cache path conflicts".to_string());
        }
        let source_moved =
            materialize_attachment_cache(source_path, &cache_path, &expected_plaintext_sha256)?;
        let cache_path_string = cache_path.display().to_string();
        if let Err(error) = self
            .store
            .promote_completed_upload_cache(source, &cache_path_string)
        {
            if source_moved {
                std::fs::rename(&cache_path, source_path).map_err(|rollback_error| {
                    format!(
                        "{error}; restore messaging attachment source after cache promotion failure: {rollback_error}"
                    )
                })?;
            }
            return Err(error);
        }
        Ok(cache_path)
    }

    pub fn resume_attachment_download_once(
        &self,
        token: &str,
        now_unix_ms: i64,
    ) -> Result<bool, String> {
        let Some(attachment_id) = self.store.next_due_attachment_download(now_unix_ms)? else {
            return Ok(false);
        };
        self.open_attachment_once(token, &attachment_id)?;
        Ok(true)
    }

    pub fn build_recovery_archive(
        &self,
        actor_profile_version: u64,
    ) -> Result<MessagingRecoveryArchive, String> {
        let actor_identity_seed = Zeroizing::new(
            self.actor_identity
                .as_ref()
                .ok_or_else(|| "messaging profile actor identity is unavailable".to_string())?
                .seed_bytes(),
        );
        self.store.build_recovery_archive(
            &self.endpoint.ptid,
            &actor_identity_seed,
            actor_profile_version,
        )
    }

    pub fn reconcile_recovery_archive_redactions(
        &self,
        token: &str,
        archive: &MessagingRecoveryArchive,
    ) -> Result<RecoveryReconciliation, String> {
        if token.trim().is_empty() || archive.ptid != self.endpoint.ptid {
            return Err("messaging recovery reconciliation identity is invalid".to_string());
        }

        const PAGE_LIMIT: i32 = 500;
        const MAX_PAGES_PER_CONVERSATION: usize = 1_000;
        let mut reconciliation = RecoveryReconciliation::default();
        for conversation in &archive.conversations {
            let conversation_id = &conversation.conversation_id;
            let query = [("conversation_id", conversation_id.clone())];
            let response = station_client::request_proto_for_device::<
                GetConversationPublicHeadRequest,
                GetConversationPublicHeadResponse,
            >(
                Method::GET,
                "/conversation/public-head",
                token,
                Some(&query),
                None,
                &self.endpoint.device_id,
            )
            .map_err(|error| format!("snapshot messaging recovery authority head: {error}"))?;
            let mut target = response.head.ok_or_else(|| {
                "messaging recovery reconciliation authority snapshot is missing".to_string()
            })?;
            let mut source =
                ConversationPublicHeadSource::try_from(target.source).map_err(|_| {
                    "messaging recovery reconciliation authority snapshot source is invalid"
                        .to_string()
                })?;
            let authority_url = if source == ConversationPublicHeadSource::Follower {
                let matches = station_client::station_registry()
                    .list()
                    .into_iter()
                    .filter(|entry| entry.station_peer_id == conversation.authority_station_id)
                    .collect::<Vec<_>>();
                if matches.len() != 1 {
                    return Err(
                        "messaging recovery authority Station route is unavailable".to_string()
                    );
                }
                let authority_url = matches[0]
                    .active_route()
                    .map(|route| route.endpoint_origin.clone())
                    .ok_or_else(|| {
                        "messaging recovery authority Station route is unavailable".to_string()
                    })?;
                let authority_pin = station_client::station_registry()
                    .federation_signing_key_pin(&conversation.authority_station_id)
                    .map_err(|error| {
                        format!("messaging recovery authority Station pin is invalid: {error}")
                    })?
                    .ok_or_else(|| {
                        "messaging recovery authority Station route is not pinned".to_string()
                    })?;
                if authority_pin.station_peer_id != conversation.authority_station_id {
                    return Err(
                        "messaging recovery authority Station pin binding mismatch".to_string()
                    );
                }
                let authority_response = station_client::request_proto_for_device_at::<
                    GetConversationPublicHeadRequest,
                    GetConversationPublicHeadResponse,
                >(
                    &authority_url,
                    Method::GET,
                    "/conversation/public-head",
                    token,
                    Some(&query),
                    None,
                    &self.endpoint.device_id,
                )
                .map_err(|error| {
                    format!("snapshot messaging recovery authority head directly: {error}")
                })?;
                target = authority_response.head.ok_or_else(|| {
                    "messaging recovery authority Station snapshot is missing".to_string()
                })?;
                source = ConversationPublicHeadSource::try_from(target.source).map_err(|_| {
                    "messaging recovery authority Station snapshot source is invalid".to_string()
                })?;
                Some(authority_url)
            } else {
                None
            };
            if target.conversation_id != *conversation_id
                || target.authority_station_peer_id != conversation.authority_station_id
                || target.federation_id != conversation.federation_id
                || source != ConversationPublicHeadSource::Authority
            {
                return Err(
                    "messaging recovery reconciliation authority snapshot binding mismatch"
                        .to_string(),
                );
            }
            let archive_head = archive
                .authority_heads
                .iter()
                .find(|head| head.conversation_id == *conversation_id)
                .ok_or_else(|| {
                    "messaging recovery reconciliation authority head is missing".to_string()
                })?;
            let events = fetch_recovery_events_to_target(
                archive_head.event_sequence,
                target.group_seq,
                PAGE_LIMIT,
                MAX_PAGES_PER_CONVERSATION,
                |after_sequence, limit| {
                    let query = [
                        ("conversation_id", conversation_id.clone()),
                        ("after_seq", after_sequence.to_string()),
                        ("limit", limit.to_string()),
                    ];
                    let response = match authority_url.as_deref() {
                        Some(authority_url) => station_client::request_proto_for_device_at::<
                            ListConversationEventsRequest,
                            ListConversationEventsResponse,
                        >(
                            authority_url,
                            Method::GET,
                            "/conversation/events",
                            token,
                            Some(&query),
                            None,
                            &self.endpoint.device_id,
                        ),
                        None => station_client::request_proto_for_device::<
                            ListConversationEventsRequest,
                            ListConversationEventsResponse,
                        >(
                            Method::GET,
                            "/conversation/events",
                            token,
                            Some(&query),
                            None,
                            &self.endpoint.device_id,
                        ),
                    };
                    response.map(|response| response.events).map_err(|error| {
                        format!("reconcile messaging recovery redactions: {error}")
                    })
                },
            )?;
            reconciliation
                .redactions
                .extend(reconcile_archive_authority_events(
                    archive,
                    conversation_id,
                    target.group_seq,
                    &target.event_hash,
                    &events,
                )?);
        }
        Ok(reconciliation)
    }

    pub fn mls_manager(&self) -> Arc<MlsGroupManager> {
        self.mls_manager.clone()
    }

    pub fn consumer(&self) -> Arc<MessagingItemConsumer> {
        self.consumer.clone()
    }

    pub fn drain_once(&self, token: &str, batch_limit: u32) -> Result<DrainProgress, String> {
        let _guard = self
            .drain_lock
            .lock()
            .map_err(|_| "messaging drain lock poisoned".to_string())?;
        if let Err(error) = self.resume_redaction_file_cleanup() {
            tracing::warn!(error = %error, "messaging redaction file cleanup remains pending");
        }
        let (cursor, _) = self.store.lane_checkpoint()?;
        let consumer_epoch = self.runtime_consumer_epoch.load(Ordering::Acquire);
        let transport = StationQueueTransport::new(
            token.to_string(),
            actor_device_ref(&self.endpoint.ptid, &self.endpoint.device_id),
        )?;
        let mut drain = QueueDrain::new(
            transport,
            self.consumer.clone(),
            actor_device_ref(&self.endpoint.ptid, &self.endpoint.device_id),
            self.consumer_id.clone(),
            batch_limit,
        )?;
        let checkpoint_store = self.store.clone();
        let checkpoint_endpoint = self.endpoint.clone();
        let checkpoint_token = token.to_string();
        drain = drain.with_before_consume_hook(Arc::new(move |item| {
            checkpoint_fresh_direct_receiver(
                checkpoint_store.as_ref(),
                &checkpoint_endpoint,
                &checkpoint_token,
                item,
            )
            .map(|_| ())
        }));
        let runtime_consumer_epoch = self.runtime_consumer_epoch.clone();
        drain = drain.with_consumer_epoch_observer(Arc::new(move |epoch| {
            runtime_consumer_epoch.store(epoch, Ordering::Release);
        }));
        let notifier = self
            .projection_notifier
            .lock()
            .map_err(|_| "messaging projection notifier lock poisoned".to_string())?
            .clone();
        if let Some(notifier) = notifier {
            let profile_id = self.profile_id.clone();
            let actor_ptid = self.endpoint.ptid.clone();
            let device_id = self.endpoint.device_id.clone();
            let home_station_peer_id =
                station_client::active_station_peer_id().ok_or_else(|| {
                    "messaging projection Home Station identity is unavailable".to_string()
                })?;
            drain = drain.with_acknowledged_item_observer(Arc::new(move |item| {
                let (kind, message_id, message_removed_from_projection) =
                    projection_change_metadata(item, &actor_ptid);
                notifier(MessagingProjectionChange {
                    profile_id: profile_id.clone(),
                    actor_ptid: actor_ptid.clone(),
                    home_station_peer_id: home_station_peer_id.clone(),
                    device_id: device_id.clone(),
                    conversation_id: item.conversation_id.clone(),
                    event_id: item.event_id.clone(),
                    lane_sequence: item.lane_sequence,
                    kind,
                    message_id,
                    message_removed_from_projection,
                });
            }));
        }
        let progress = drain.drain_once(cursor, consumer_epoch)?;
        if let Err(error) = self.resume_redaction_file_cleanup() {
            tracing::warn!(error = %error, "messaging redaction file cleanup remains pending");
        }
        Ok(progress)
    }

    fn resume_redaction_file_cleanup(&self) -> Result<(), String> {
        let cache_root = attachment_cache_path(&self.profile_id, "root")?
            .parent()
            .ok_or_else(|| "messaging attachment cache root is unavailable".to_string())?
            .to_path_buf();
        let source_root = attachment_source_root(&self.profile_id)?;
        let roots = [cache_root, source_root];
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

    pub fn dispatch_delivery_receipt_once(&self, token: &str) -> Result<bool, String> {
        let Some(entry) = self.store.next_delivery_receipt()? else {
            return Ok(false);
        };
        let receipt = DeviceConsumptionReceipt::decode(entry.receipt_bytes.as_slice())
            .map_err(|error| format!("decode messaging device consumption receipt: {error}"))?;
        let consumer = receipt
            .consumer
            .as_ref()
            .ok_or_else(|| "messaging delivery receipt has no consumer".to_string())?;
        if consumer.ptid != self.endpoint.ptid || consumer.device_id != self.endpoint.device_id {
            return Err("messaging delivery receipt endpoint mismatch".to_string());
        }
        StationDeliveryReceiptTransport::new(token.to_string(), self.endpoint.device_id.clone())?
            .submit(&receipt)?;
        self.store
            .mark_delivery_receipt_submitted(&entry.receipt_id, &entry.receipt_bytes)?;
        Ok(true)
    }

    pub fn set_projection_notifier(
        &self,
        notifier: Option<MessagingProjectionNotifier>,
    ) -> Result<(), String> {
        *self
            .projection_notifier
            .lock()
            .map_err(|_| "messaging projection notifier lock poisoned".to_string())? = notifier;
        Ok(())
    }

    pub fn reconcile_submitted_commands_once(
        &self,
        token: &str,
        now_unix_ms: i64,
    ) -> Result<CommandReconciliationProgress, String> {
        let _guard = self
            .dispatch_lock
            .lock()
            .map_err(|_| "messaging command dispatch lock poisoned".to_string())?;
        CommandReconciliationWorker::new(
            self.store.clone(),
            self.mls_manager.clone(),
            self.endpoint.clone(),
            StationCommandTransport::new(token.to_string(), self.endpoint.device_id.clone())?,
        )?
        .reconcile_once(now_unix_ms)
    }

    pub fn dispatch_command_once(
        &self,
        token: &str,
        now_unix_ms: i64,
        retry_policy: CommandRetryPolicy,
    ) -> Result<CommandDispatchProgress, String> {
        let _guard = self
            .dispatch_lock
            .lock()
            .map_err(|_| "messaging command dispatch lock poisoned".to_string())?;
        let home_station_peer_id = station_client::active_station_peer_id()
            .ok_or_else(|| "messaging command Home Station identity is unavailable".to_string())?;
        let (signing_key_id, signing_key) = self.device_signing_identity()?.ok_or_else(|| {
            "messaging command device signing identity is unavailable".to_string()
        })?;
        let progress = CommandOutboxWorker::new(
            self.store.clone(),
            StationCommandTransport::new(token.to_string(), self.endpoint.device_id.clone())?
                .with_remote_command_identity(
                    self.endpoint.ptid.clone(),
                    home_station_peer_id,
                    signing_key_id,
                    signing_key,
                )?,
            retry_policy,
        )?
        .dispatch_once(now_unix_ms)?;
        if let CommandDispatchProgress::StaleAuthorityPlan { command_id, .. }
        | CommandDispatchProgress::Failed { command_id, .. } = &progress
        {
            if let Some(conversation_id) =
                self.store.mls_transition_command_conversation(command_id)?
            {
                self.mls_manager
                    .discard_pending_transition(&conversation_id);
            }
        }
        Ok(progress)
    }

    pub fn prepare_send_plan(
        &self,
        token: &str,
        conversation_id: &str,
    ) -> Result<PrepareConversationCommandResponse, String> {
        self.prepare_command_plan(token, conversation_id, ConversationCommandKind::SendMessage)
    }

    fn prepare_command_plan(
        &self,
        token: &str,
        conversation_id: &str,
        command_kind: ConversationCommandKind,
    ) -> Result<PrepareConversationCommandResponse, String> {
        if conversation_id.trim().is_empty() {
            return Err("messaging send plan requires conversation ID".to_string());
        }
        let authority_station_id = self
            .store
            .conversation_authority_station_id(conversation_id)?;
        StationCommandTransport::new(token.to_string(), self.endpoint.device_id.clone())?
            .prepare_send(&PrepareConversationCommandRequest {
                conversation_id: conversation_id.to_string(),
                sender: Some(actor_device_ref(
                    &self.endpoint.ptid,
                    &self.endpoint.device_id,
                )),
                authority_station_peer_id: authority_station_id,
                command_kind: command_kind as i32,
            })
    }

    pub fn prepare_direct_text(
        &self,
        plan: &PrepareConversationCommandResponse,
        intent: &SendTextIntent<'_>,
    ) -> Result<ChatCommand, String> {
        SendPreparer::new(
            self.store.clone(),
            self.endpoint.clone(),
            self.mls_manager.clone(),
        )?
        .prepare_direct_text(plan, intent)
    }

    pub fn prepare_direct_text_with_bootstraps(
        &self,
        plan: &PrepareConversationCommandResponse,
        intent: &SendTextIntent<'_>,
        bootstraps: &[super::DirectSessionBootstrap],
    ) -> Result<ChatCommand, String> {
        SendPreparer::new(
            self.store.clone(),
            self.endpoint.clone(),
            self.mls_manager.clone(),
        )?
        .prepare_direct_text_with_bootstraps(plan, intent, bootstraps)
    }

    pub fn prepare_group_text(
        &self,
        plan: &PrepareConversationCommandResponse,
        intent: &SendTextIntent<'_>,
    ) -> Result<ChatCommand, String> {
        SendPreparer::new(
            self.store.clone(),
            self.endpoint.clone(),
            self.mls_manager.clone(),
        )?
        .prepare_group_text(plan, intent)
    }

    pub fn submit_message(
        &self,
        token: &str,
        conversation_id: &str,
        conversation_kind: ConversationKind,
        plaintext: &str,
        reply_to_message_id: &str,
        thread_root_message_id: &str,
        attachment_intents: &[LocalAttachmentIntent],
    ) -> Result<SubmitMessageOutcome, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "messaging send intent lock poisoned".to_string())?;
        if conversation_id.trim().is_empty()
            || (plaintext.is_empty() && attachment_intents.is_empty())
            || conversation_kind == ConversationKind::Unspecified
            || attachment_intents.len() > super::private_content::MESSAGE_MAX_ATTACHMENT_COUNT
        {
            return Err("messaging message intent is incomplete".to_string());
        }
        let conversation = self
            .store
            .conversation_projections()?
            .into_iter()
            .find(|conversation| conversation.conversation_id == conversation_id)
            .ok_or_else(|| "messaging conversation projection is unavailable".to_string())?;
        if conversation.kind != conversation_kind as i32
            || conversation.authority_station_id.trim().is_empty()
        {
            return Err("messaging conversation projection does not match intent".to_string());
        }

        let message_id = Ulid::new().to_string();
        let created_at_unix_ms = now_unix_ms();
        let mut uploads = attachment_intents
            .iter()
            .map(|intent| {
                prepare_local_attachment_upload(
                    conversation_id,
                    &message_id,
                    &conversation.authority_station_id,
                    intent,
                    created_at_unix_ms,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        let aggregate_plaintext_size = uploads.iter().try_fold(0_u64, |total, upload| {
            total
                .checked_add(upload.transfer.plaintext_size)
                .ok_or_else(|| "messaging attachment aggregate size exceeds policy".to_string())
        })?;
        if aggregate_plaintext_size > ATTACHMENT_MAX_PLAINTEXT_SIZE {
            return Err("messaging attachment aggregate size exceeds policy".to_string());
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
        let draft = PendingMessageDraft {
            conversation_id: conversation_id.to_string(),
            conversation_kind: conversation_kind as i32,
            message_id: message_id.clone(),
            sender_ptid: self.endpoint.ptid.clone(),
            sender_device_id: self.endpoint.device_id.clone(),
            plaintext: plaintext.to_string(),
            reply_to_message_id: reply_to_message_id.to_string(),
            thread_root_message_id: thread_root_message_id.to_string(),
            attachments: Vec::new(),
            attempt_count: 0,
            created_at_unix_ms,
        };
        if uploads.is_empty() {
            self.store.create_message_draft(&draft)?;
        } else {
            {
                let _source_guard = self
                    .attachment_source_lock
                    .lock()
                    .map_err(|_| "messaging attachment source lock poisoned".to_string())?;
                self.store
                    .create_message_draft_with_uploads(&draft, &uploads)?;
            }
            let worker = self.attachment_transfer_worker(token.to_string())?;
            for attachment_id in &attachment_ids {
                let progress = worker.run_upload_once(attachment_id, now_unix_ms())?;
                match progress {
                    AttachmentTransferProgress::Complete => {}
                    AttachmentTransferProgress::Deferred { .. }
                    | AttachmentTransferProgress::RetryScheduled { .. } => {
                        return Ok(SubmitMessageOutcome {
                            command_id: None,
                            message_id,
                            attachment_ids,
                            state: "draft",
                        });
                    }
                    AttachmentTransferProgress::Terminal { .. } => {
                        return Ok(SubmitMessageOutcome {
                            command_id: None,
                            message_id,
                            attachment_ids,
                            state: "attachment_failed",
                        });
                    }
                }
            }
        }
        let ready_draft = self
            .store
            .message_draft(&message_id)?
            .ok_or_else(|| "messaging completed draft is unavailable".to_string())?;
        match self.prepare_message_draft(token, &ready_draft) {
            Ok(command_id) => Ok(SubmitMessageOutcome {
                command_id: Some(command_id),
                message_id,
                attachment_ids,
                state: "pending",
            }),
            Err(error) => {
                tracing::warn!(
                    conversation_id = %ready_draft.conversation_id,
                    message_id = %ready_draft.message_id,
                    error = %error,
                    "messaging message draft preparation deferred"
                );
                self.schedule_message_draft_retry(&ready_draft, now_unix_ms())?;
                Ok(SubmitMessageOutcome {
                    command_id: None,
                    message_id,
                    attachment_ids,
                    state: "draft",
                })
            }
        }
    }

    pub fn resume_attachment_upload_once(
        &self,
        token: &str,
        now_unix_ms: i64,
    ) -> Result<bool, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "messaging send intent lock poisoned".to_string())?;
        let Some(attachment_id) = self.store.next_due_attachment_upload(now_unix_ms)? else {
            return Ok(false);
        };
        self.attachment_transfer_worker(token.to_string())?
            .run_upload_once(&attachment_id, now_unix_ms)?;
        Ok(true)
    }

    pub fn resume_message_draft_once(&self, token: &str, now_unix_ms: i64) -> Result<bool, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "messaging send intent lock poisoned".to_string())?;
        let Some(draft) = self.store.next_due_message_draft(now_unix_ms)? else {
            return Ok(false);
        };
        if let Err(error) = self.prepare_message_draft(token, &draft) {
            tracing::warn!(
                conversation_id = %draft.conversation_id,
                message_id = %draft.message_id,
                error = %error,
                "messaging message draft resume deferred"
            );
            self.schedule_message_draft_retry(&draft, now_unix_ms)?;
        }
        Ok(true)
    }

    pub fn resume_interaction_intent_once(
        &self,
        token: &str,
        now_unix_ms: i64,
    ) -> Result<bool, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "messaging send intent lock poisoned".to_string())?;
        let Some(intent) = self.store.next_superseded_interaction_intent()? else {
            return Ok(false);
        };
        self.reprepare_interaction_intent(token, &intent, now_unix_ms)?;
        Ok(true)
    }

    fn reprepare_interaction_intent(
        &self,
        token: &str,
        pending: &SupersededInteractionIntent,
        now_unix_ms: i64,
    ) -> Result<String, String> {
        if now_unix_ms <= 0 {
            return Err("messaging interaction reprepare time is invalid".to_string());
        }
        let interaction = decode_superseded_interaction(pending, &self.endpoint)?;
        let plan = self.prepare_fresh_interaction_plan(token, &pending.conversation_id)?;
        let conversation_kind = ConversationKind::try_from(plan.conversation_kind)
            .map_err(|_| "messaging interaction conversation kind is invalid".to_string())?;
        let command_id = Ulid::new().to_string();
        match interaction {
            DurableInteraction::Edit(plaintext) => {
                let intent = EditTextIntent {
                    logical_intent_id: &pending.intent_id,
                    replaces_command_id: Some(&pending.command_id),
                    command_id: &command_id,
                    message_id: &pending.target_message_id,
                    conversation_id: &pending.conversation_id,
                    plaintext: &plaintext,
                    client_timestamp_unix_ms: now_unix_ms,
                };
                let preparer = SendPreparer::new(
                    self.store.clone(),
                    self.endpoint.clone(),
                    self.mls_manager.clone(),
                )?;
                match conversation_kind {
                    ConversationKind::Direct => {
                        let actor_identity = self.actor_identity.clone().ok_or_else(|| {
                            "messaging Direct bootstrap requires profile actor identity".to_string()
                        })?;
                        let bootstraps = DirectSessionBootstrapper::new(
                            self.store.clone(),
                            CoreCryptoEndpoint {
                                ptid: self.endpoint.ptid.clone(),
                                device_id: self.endpoint.device_id.clone(),
                            },
                            actor_identity,
                        )?
                        .prepare_missing(
                            &pending.conversation_id,
                            &plan.required_endpoints,
                            now_unix_ms,
                            &StationKeyBundleTransport::new(
                                token.to_string(),
                                self.endpoint.device_id.clone(),
                            )?,
                        )?;
                        preparer.prepare_direct_edit_with_bootstraps(
                            &plan,
                            &intent,
                            &bootstraps,
                        )?;
                    }
                    ConversationKind::Group => {
                        preparer.prepare_group_edit(&plan, &intent)?;
                    }
                    ConversationKind::Unspecified => unreachable!(),
                }
            }
            DurableInteraction::Retract => {
                self.prepare_replacement_metadata_interaction(
                    &plan,
                    pending,
                    &command_id,
                    MetadataInteraction::Retract,
                    now_unix_ms,
                )?;
            }
            DurableInteraction::Reaction { reaction, remove } => {
                self.prepare_replacement_metadata_interaction(
                    &plan,
                    pending,
                    &command_id,
                    MetadataInteraction::Reaction {
                        reaction: &reaction,
                        remove,
                    },
                    now_unix_ms,
                )?;
            }
            DurableInteraction::Pin { remove } => {
                self.prepare_replacement_metadata_interaction(
                    &plan,
                    pending,
                    &command_id,
                    MetadataInteraction::Pin { remove },
                    now_unix_ms,
                )?;
            }
        }
        Ok(command_id)
    }

    fn prepare_replacement_metadata_interaction(
        &self,
        plan: &PrepareConversationCommandResponse,
        pending: &SupersededInteractionIntent,
        command_id: &str,
        interaction: MetadataInteraction<'_>,
        now_unix_ms: i64,
    ) -> Result<(), String> {
        MetadataInteractionPreparer::new(
            self.store.clone(),
            CryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            },
        )?
        .prepare(
            plan,
            &pending.intent_id,
            Some(&pending.command_id),
            command_id,
            &pending.target_message_id,
            interaction,
            now_unix_ms,
        )
        .map(|_| ())
    }

    fn prepare_message_draft(
        &self,
        token: &str,
        draft: &PendingMessageDraft,
    ) -> Result<String, String> {
        if draft.sender_ptid != self.endpoint.ptid
            || draft.sender_device_id != self.endpoint.device_id
        {
            return Err("messaging draft endpoint mismatch".to_string());
        }
        let conversation_kind = ConversationKind::try_from(draft.conversation_kind)
            .map_err(|_| "messaging draft conversation kind is invalid".to_string())?;
        let plan = self.prepare_send_plan(token, &draft.conversation_id)?;
        // Drain inbox until the local authority head matches the send plan.
        // A single drain may not suffice if the conversation was just created
        // and the creation event hasn't arrived in the device inbox yet.
        for _ in 0..5 {
            let (local_seq, local_hash) = self.store.authority_head(&draft.conversation_id)?;
            if local_seq == plan.authority_sequence && local_hash == plan.authority_hash {
                break;
            }
            self.drain_once(token, INTERACTION_PREFLIGHT_DRAIN_LIMIT)?;
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        let (local_sequence, local_hash) = self.store.authority_head(&draft.conversation_id)?;
        if conversation_kind == ConversationKind::Direct
            && (local_sequence != plan.authority_sequence || local_hash != plan.authority_hash)
        {
            self.bootstrap_direct_authority_checkpoint(token, &plan)?;
        }
        if plan.conversation_kind != draft.conversation_kind {
            return Err("messaging conversation kind does not match Station plan".to_string());
        }
        let command_id = Ulid::new().to_string();
        let intent = SendTextIntent {
            command_id: &command_id,
            message_id: &draft.message_id,
            conversation_id: &draft.conversation_id,
            plaintext: &draft.plaintext,
            reply_to_message_id: &draft.reply_to_message_id,
            thread_root_message_id: &draft.thread_root_message_id,
            attachments: &draft.attachments,
            client_timestamp_unix_ms: draft.created_at_unix_ms,
        };
        match conversation_kind {
            ConversationKind::Direct => {
                let actor_identity = self.actor_identity.clone().ok_or_else(|| {
                    "messaging Direct bootstrap requires profile actor identity".to_string()
                })?;
                let bootstraps = DirectSessionBootstrapper::new(
                    self.store.clone(),
                    CoreCryptoEndpoint {
                        ptid: self.endpoint.ptid.clone(),
                        device_id: self.endpoint.device_id.clone(),
                    },
                    actor_identity,
                )?
                .prepare_missing(
                    &draft.conversation_id,
                    &plan.required_endpoints,
                    intent.client_timestamp_unix_ms,
                    &StationKeyBundleTransport::new(
                        token.to_string(),
                        self.endpoint.device_id.clone(),
                    )?,
                )?;
                self.prepare_direct_text_with_bootstraps(&plan, &intent, &bootstraps)?
            }
            ConversationKind::Group => self.prepare_group_text(&plan, &intent)?,
            ConversationKind::Unspecified => {
                return Err("messaging conversation kind is required".to_string());
            }
        };
        Ok(command_id)
    }

    fn prepare_fresh_interaction_plan(
        &self,
        token: &str,
        conversation_id: &str,
    ) -> Result<PrepareConversationCommandResponse, String> {
        self.drain_once(token, INTERACTION_PREFLIGHT_DRAIN_LIMIT)?;
        let plan = self.prepare_send_plan(token, conversation_id)?;
        for _ in 0..5 {
            let (local_sequence, local_hash) = self.store.authority_head(conversation_id)?;
            if local_sequence == plan.authority_sequence && local_hash == plan.authority_hash {
                return Ok(plan);
            }
            self.drain_once(token, INTERACTION_PREFLIGHT_DRAIN_LIMIT)?;
            std::thread::sleep(Duration::from_millis(200));
        }
        let conversation_kind = ConversationKind::try_from(plan.conversation_kind)
            .map_err(|_| "messaging interaction conversation kind is invalid".to_string())?;
        if conversation_kind == ConversationKind::Direct {
            self.bootstrap_direct_authority_checkpoint(token, &plan)?;
        }
        let (local_sequence, local_hash) = self.store.authority_head(conversation_id)?;
        if local_sequence != plan.authority_sequence || local_hash != plan.authority_hash {
            return Err("messaging local authority head is behind interaction plan".to_string());
        }
        Ok(plan)
    }

    fn bootstrap_direct_authority_checkpoint(
        &self,
        token: &str,
        plan: &PrepareConversationCommandResponse,
    ) -> Result<bool, String> {
        let (local_sequence, local_hash) = self.store.authority_head(&plan.conversation_id)?;
        if local_sequence == plan.authority_sequence && local_hash == plan.authority_hash {
            return Ok(false);
        }
        if local_sequence != 0 || !local_hash.is_empty() {
            return Err(
                "messaging Direct authority checkpoint conflicts with local head".to_string(),
            );
        }
        if plan.authority_sequence <= 0 || plan.authority_hash.len() != 32 {
            return Err("messaging Direct authority checkpoint send plan is invalid".to_string());
        }
        let target = DirectAuthorityCheckpointTarget::from(plan);
        let events = fetch_direct_authority_events(token, &self.endpoint.device_id, &target)?;
        let bootstrapped = apply_direct_authority_checkpoint(
            self.store.as_ref(),
            &self.endpoint.ptid,
            &target,
            &events,
            now_unix_ms(),
        )?;
        Ok(bootstrapped)
    }

    fn schedule_message_draft_retry(
        &self,
        draft: &PendingMessageDraft,
        now_unix_ms: i64,
    ) -> Result<(), String> {
        let exponent = draft.attempt_count.min(8);
        let delay_ms = 1_000_i64
            .checked_mul(1_i64 << exponent)
            .unwrap_or(300_000)
            .min(300_000);
        self.store.schedule_message_draft_retry(
            &draft.conversation_id,
            &draft.message_id,
            now_unix_ms.saturating_add(delay_ms),
            "prepare_failed",
        )
    }

    pub fn retry_message(
        &self,
        token: &str,
        conversation_id: &str,
        message_id: &str,
    ) -> Result<RetryMessageOutcome, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "messaging send intent lock poisoned".to_string())?;
        let now = now_unix_ms();
        match self
            .store
            .prepare_message_retry(conversation_id, message_id, now)?
        {
            MessageRetryDisposition::ExactCommand { command_id } => Ok(RetryMessageOutcome {
                command_id: Some(command_id),
                message_id: message_id.to_string(),
                state: "retrying",
            }),
            MessageRetryDisposition::DraftReady => {
                let draft = self
                    .store
                    .message_draft(message_id)?
                    .ok_or_else(|| "messaging retry draft is unavailable".to_string())?;
                if draft.conversation_id != conversation_id
                    || draft.sender_ptid != self.endpoint.ptid
                    || draft.sender_device_id != self.endpoint.device_id
                {
                    return Err("messaging retry draft identity mismatch".to_string());
                }
                match self.prepare_message_draft(token, &draft) {
                    Ok(command_id) => Ok(RetryMessageOutcome {
                        command_id: Some(command_id),
                        message_id: message_id.to_string(),
                        state: "pending",
                    }),
                    Err(error) => {
                        tracing::warn!(
                            conversation_id,
                            message_id,
                            error = %error,
                            "messaging manual retry preparation deferred"
                        );
                        self.schedule_message_draft_retry(&draft, now)?;
                        Ok(RetryMessageOutcome {
                            command_id: None,
                            message_id: message_id.to_string(),
                            state: "retrying",
                        })
                    }
                }
            }
        }
    }

    pub fn conversation_messages(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationMessageProjection>, String> {
        self.store.conversation_message_projections(conversation_id)
    }

    pub fn conversation_message_page(
        &self,
        conversation_id: &str,
        before_sequence: Option<i64>,
        limit: usize,
    ) -> Result<ConversationMessagePage, String> {
        self.store
            .conversation_message_page(conversation_id, before_sequence, limit)
    }

    pub fn conversation_summary(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationSummaryProjection, String> {
        self.store
            .conversation_summary_projection(conversation_id, &self.endpoint.ptid)
    }

    pub fn thread_messages(
        &self,
        conversation_id: &str,
        thread_root_message_id: &str,
    ) -> Result<Vec<ConversationMessageProjection>, String> {
        self.store
            .thread_message_projections(conversation_id, thread_root_message_id)
    }

    pub fn thread_counts(
        &self,
        conversation_id: &str,
        thread_root_message_ids: &[String],
    ) -> Result<Vec<ThreadCountProjection>, String> {
        self.store.thread_count_projections(
            conversation_id,
            thread_root_message_ids,
            &self.endpoint.ptid,
        )
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

    pub fn create_direct_conversation(
        &self,
        token: &str,
        peer_ptid: &str,
        federation_id: &str,
    ) -> Result<String, String> {
        if peer_ptid.trim().is_empty()
            || federation_id.trim().is_empty()
            || peer_ptid == self.endpoint.ptid
        {
            return Err("messaging direct peer identity is invalid".to_string());
        }
        let command_id = Ulid::new().to_string();
        let result =
            self.try_create_direct_conversation(token, peer_ptid, federation_id, &command_id);
        match result {
            Ok(id) => Ok(id),
            Err(error) if is_stale_endpoint_error(&error) => {
                tracing::warn!(error = %error, "createDirect: device not active, attempting re-enrollment");
                let _ = self.recover_stale_enrollment(&error);
                self.enroll_pending_device(token, "Desktop".to_string())?;
                self.try_create_direct_conversation(token, peer_ptid, federation_id, &command_id)
            }
            Err(error) => Err(error),
        }
    }

    fn try_create_direct_conversation(
        &self,
        token: &str,
        peer_ptid: &str,
        federation_id: &str,
        command_id: &str,
    ) -> Result<String, String> {
        let response = crate::infrastructure::station_client::request_proto_for_device::<
            CreateDirectConversationRequest,
            CreateDirectConversationResponse,
        >(
            Method::POST,
            "/conversation/direct",
            token,
            None,
            Some(&CreateDirectConversationRequest {
                peer_ptid: peer_ptid.to_string(),
                federation_id: federation_id.to_string(),
                creator: Some(actor_device_ref(
                    &self.endpoint.ptid,
                    &self.endpoint.device_id,
                )),
                command_id: command_id.to_string(),
            }),
            &self.endpoint.device_id,
        )
        .map_err(|error| error.to_string())?;
        response
            .conversation
            .map(|conversation| conversation.conversation_id)
            .filter(|conversation_id| !conversation_id.is_empty())
            .ok_or_else(|| "messaging Station returned no direct conversation".to_string())
    }

    pub fn submit_edit(
        &self,
        token: &str,
        conversation_id: &str,
        message_id: &str,
        plaintext: &str,
    ) -> Result<String, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "messaging send intent lock poisoned".to_string())?;
        if conversation_id.trim().is_empty()
            || message_id.trim().is_empty()
            || plaintext.trim().is_empty()
        {
            return Err("messaging edit intent is incomplete".to_string());
        }
        self.drain_once(token, INTERACTION_PREFLIGHT_DRAIN_LIMIT)?;
        let (projection, _) = self
            .store
            .message_projection(conversation_id, message_id)?
            .ok_or_else(|| "messaging edit target projection is unavailable".to_string())?;
        if projection.sender_ptid != self.endpoint.ptid {
            return Err("messaging edit target is not authored by this actor".to_string());
        }
        let plan = self.prepare_command_plan(
            token,
            conversation_id,
            ConversationCommandKind::EditMessage,
        )?;
        let conversation_kind = ConversationKind::try_from(plan.conversation_kind)
            .map_err(|_| "messaging edit conversation kind is invalid".to_string())?;
        let command_id = Ulid::new().to_string();
        let now = now_unix_ms();
        let intent = EditTextIntent {
            logical_intent_id: &command_id,
            replaces_command_id: None,
            command_id: &command_id,
            message_id,
            conversation_id,
            plaintext: plaintext.trim(),
            client_timestamp_unix_ms: now,
        };
        let preparer = SendPreparer::new(
            self.store.clone(),
            self.endpoint.clone(),
            self.mls_manager.clone(),
        )?;
        match conversation_kind {
            ConversationKind::Direct => {
                let actor_identity = self.actor_identity.clone().ok_or_else(|| {
                    "messaging Direct bootstrap requires profile actor identity".to_string()
                })?;
                let bootstraps = DirectSessionBootstrapper::new(
                    self.store.clone(),
                    CoreCryptoEndpoint {
                        ptid: self.endpoint.ptid.clone(),
                        device_id: self.endpoint.device_id.clone(),
                    },
                    actor_identity,
                )?
                .prepare_missing(
                    conversation_id,
                    &plan.required_endpoints,
                    now,
                    &StationKeyBundleTransport::new(
                        token.to_string(),
                        self.endpoint.device_id.clone(),
                    )?,
                )?;
                preparer.prepare_direct_edit_with_bootstraps(&plan, &intent, &bootstraps)?;
            }
            ConversationKind::Group => {
                preparer.prepare_group_edit(&plan, &intent)?;
            }
            ConversationKind::Unspecified => {
                return Err("messaging edit conversation kind is required".to_string());
            }
        }
        Ok(command_id)
    }

    pub fn submit_metadata_interaction(
        &self,
        token: &str,
        conversation_id: &str,
        message_id: &str,
        interaction: MetadataInteraction<'_>,
    ) -> Result<String, String> {
        if conversation_id.trim().is_empty() || message_id.trim().is_empty() {
            return Err("messaging interaction target is required".to_string());
        }
        self.drain_once(token, INTERACTION_PREFLIGHT_DRAIN_LIMIT)?;
        let command_kind = match interaction {
            MetadataInteraction::HideForActor => ConversationCommandKind::HideMessageForActor,
            MetadataInteraction::Moderate { .. } => ConversationCommandKind::ModerateMessage,
            MetadataInteraction::Retract => ConversationCommandKind::RetractMessage,
            MetadataInteraction::Reaction { .. } => ConversationCommandKind::React,
            MetadataInteraction::Pin { .. } => ConversationCommandKind::PinMessage,
        };
        let plan = self.prepare_command_plan(token, conversation_id, command_kind)?;
        let command_id = Ulid::new().to_string();
        let now = now_unix_ms();
        MetadataInteractionPreparer::new(
            self.store.clone(),
            CryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            },
        )?
        .prepare(
            &plan,
            &command_id,
            None,
            &command_id,
            message_id,
            interaction,
            now,
        )?;
        Ok(command_id)
    }

    pub fn submit_typing(
        &self,
        token: &str,
        conversation_id: &str,
        is_typing: bool,
    ) -> Result<(), String> {
        if conversation_id.trim().is_empty() {
            return Err("messaging typing conversation ID is required".to_string());
        }
        let now = now_unix_ms();
        StationCommandTransport::new(token.to_string(), self.endpoint.device_id.clone())?
            .submit_typing(&SubmitConversationTypingRequest {
                conversation_id: conversation_id.to_string(),
                sender: Some(actor_device_ref(
                    &self.endpoint.ptid,
                    &self.endpoint.device_id,
                )),
                pulse_generation: u64::try_from(now)
                    .map_err(|_| "messaging typing generation is invalid".to_string())?,
                expires_at: Some(prost_types::Timestamp {
                    seconds: now.saturating_add(5_000).div_euclid(1_000),
                    nanos: (now.saturating_add(5_000).rem_euclid(1_000) * 1_000_000) as i32,
                }),
                is_typing,
            })
    }

    pub fn submit_read_cursor(
        &self,
        token: &str,
        conversation_id: &str,
        last_read_sequence: i64,
    ) -> Result<(), String> {
        if conversation_id.trim().is_empty() || last_read_sequence <= 0 {
            return Err("messaging read cursor is incomplete".to_string());
        }
        let (authority_sequence, _) = self.store.authority_head(conversation_id)?;
        if last_read_sequence > authority_sequence {
            return Err("messaging read cursor exceeds local authority head".to_string());
        }
        let now = now_unix_ms();
        crate::infrastructure::station_client::request_proto_for_device::<
            SubmitConversationReadCursorRequest,
            SubmitConversationReadCursorResponse,
        >(
            Method::POST,
            "/conversation/read-cursor",
            token,
            None,
            Some(&SubmitConversationReadCursorRequest {
                cursor: Some(ActorReadCursor {
                    conversation_id: conversation_id.to_string(),
                    reader_ptid: self.endpoint.ptid.clone(),
                    last_read_sequence,
                    updated_at: Some(prost_types::Timestamp {
                        seconds: now.div_euclid(1_000),
                        nanos: (now.rem_euclid(1_000) * 1_000_000) as i32,
                    }),
                }),
            }),
            &self.endpoint.device_id,
        )
        .map_err(|error| error.to_string())?;
        self.store.update_read_cursor(
            conversation_id,
            &self.endpoint.ptid,
            last_read_sequence,
            now,
        )
    }

    pub fn conversations(&self) -> Result<Vec<ConversationProjection>, String> {
        self.store.conversation_projections()
    }

    pub fn command_status(
        &self,
        command_id: &str,
    ) -> Result<Option<super::CommandStatusProjection>, String> {
        self.store.command_status(command_id)
    }

    pub fn group_security_status(
        &self,
        conversation_id: &str,
        expected_mls_epoch: i64,
    ) -> Result<&'static str, String> {
        let expected_epoch = u64::try_from(expected_mls_epoch)
            .map_err(|_| "messaging group MLS epoch is invalid".to_string())?;
        if expected_epoch == 0 || self.mls_manager.has_pending_transition(conversation_id) {
            return Ok("establishing");
        }
        if self
            .mls_manager
            .is_local_leaf_active_at_epoch(conversation_id, expected_epoch)?
        {
            return Ok("active");
        }
        if self.mls_manager.has_session(conversation_id) {
            return Ok("crypto_desynced");
        }
        Ok("establishing")
    }

    #[cfg(feature = "acceptance-webdriver")]
    pub fn acceptance_stage_restorable_command_fixture(
        &self,
        conversation_id: &str,
        message_id: &str,
        command_id: &str,
    ) -> Result<serde_json::Value, String> {
        self.store.acceptance_stage_restorable_command_fixture(
            conversation_id,
            message_id,
            command_id,
        )
    }

    #[cfg(feature = "acceptance-webdriver")]
    pub fn acceptance_prepare_submitted_command_fixture(
        &self,
        conversation_id: &str,
        message_id: &str,
        command_id: &str,
    ) -> Result<serde_json::Value, String> {
        self.store.acceptance_prepare_submitted_command_fixture(
            conversation_id,
            message_id,
            command_id,
        )
    }

    #[cfg(feature = "acceptance-webdriver")]
    pub fn acceptance_interaction_snapshot(
        &self,
        conversation_id: &str,
        message_id: &str,
        command_id: &str,
    ) -> Result<serde_json::Value, String> {
        self.store
            .acceptance_interaction_snapshot(conversation_id, message_id, command_id)
    }

    pub fn create_group_conversation(
        &self,
        token: &str,
        conversation_id: &str,
        name: &str,
        member_ptids: &[String],
        federation_id: &str,
    ) -> Result<PreparedGroupConversation, station_client::StationClientError> {
        let transport =
            StationGroupGenesisTransport::new(token.to_string(), self.endpoint.clone())?;
        let plan = transport.prepare(conversation_id, name, member_ptids, federation_id)?;
        let command = GroupGenesisPreparer::new(
            self.store.clone(),
            self.mls_manager.clone(),
            CryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            },
        )
        .map_err(|error| {
            station_client::StationClientError::new(
                station_client::StationClientErrorKind::InvalidResponse,
                error,
                None,
            )
        })?
        .prepare(&plan, conversation_id, now_unix_ms())
        .map_err(|error| {
            station_client::StationClientError::new(
                station_client::StationClientErrorKind::InvalidResponse,
                error,
                None,
            )
        })?;
        Ok(PreparedGroupConversation {
            conversation_id: conversation_id.to_string(),
            command_id: command.command_id,
        })
    }

    pub fn prepare_membership_transition(
        &self,
        token: &str,
        input: &MembershipTransitionIntentInput,
    ) -> Result<ChatCommand, String> {
        let _guard = self
            .membership_transition_lock
            .lock()
            .map_err(|_| "messaging membership transition lock poisoned".to_string())?;
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
        let transport =
            StationMembershipTransitionTransport::new(token.to_string(), self.endpoint.clone())?;
        let plan = transport.prepare(input)?;
        MembershipTransitionPreparer::new(
            self.store.clone(),
            self.mls_manager.clone(),
            CryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            },
        )?
        .prepare(Some(&intent_id), input, &plan, created_at_unix_ms)
    }

    pub fn resume_membership_intent_once(&self, token: &str) -> Result<bool, String> {
        let _guard = self
            .membership_transition_lock
            .lock()
            .map_err(|_| "messaging membership transition lock poisoned".to_string())?;
        let Some(intent) = self.store.pending_membership_intents()?.into_iter().next() else {
            return Ok(false);
        };
        self.mls_manager
            .discard_pending_transition(&intent.conversation_id);
        let action = MessagingMembershipAction::try_from(intent.action)
            .map_err(|_| "persisted messaging membership action is invalid".to_string())?;
        let input = MembershipTransitionIntentInput {
            conversation_id: intent.conversation_id,
            action,
            target_ptid: intent.target_ptid,
            target_device_id: intent.target_device_id,
            role: intent.role,
            leave_intent: None,
        };
        let transport =
            StationMembershipTransitionTransport::new(token.to_string(), self.endpoint.clone())?;
        let plan = transport.prepare(&input)?;
        MembershipTransitionPreparer::new(
            self.store.clone(),
            self.mls_manager.clone(),
            CryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            },
        )?
        .prepare(Some(&intent.intent_id), &input, &plan, now_unix_ms())?;
        Ok(true)
    }

    pub fn update_conversation(
        &self,
        token: &str,
        conversation_id: &str,
        name: Option<String>,
        description: Option<String>,
        avatar_object_id: Option<String>,
    ) -> Result<String, String> {
        if name.is_none() && description.is_none() && avatar_object_id.is_none() {
            return Err("messaging Conversation update is empty".to_string());
        }
        if name.as_ref().is_some_and(|value| value.trim().is_empty()) {
            return Err("messaging Conversation name is empty".to_string());
        }
        self.prepare_conversation_mutation(
            token,
            conversation_id,
            ConversationCommandKind::UpdateSettings,
            chat_command::Payload::UpdateConversation(UpdateConversationIntent {
                name,
                description,
                avatar_object_id,
                ..Default::default()
            }),
        )
    }

    pub fn dissolve_conversation(
        &self,
        token: &str,
        conversation_id: &str,
    ) -> Result<String, String> {
        self.prepare_conversation_mutation(
            token,
            conversation_id,
            ConversationCommandKind::Dissolve,
            chat_command::Payload::DissolveConversation(DissolveConversationIntent {}),
        )
    }

    fn prepare_conversation_mutation(
        &self,
        token: &str,
        conversation_id: &str,
        command_kind: ConversationCommandKind,
        payload: chat_command::Payload,
    ) -> Result<String, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "messaging Conversation command lock poisoned".to_string())?;
        let plan = self.prepare_command_plan(token, conversation_id, command_kind)?;
        if ConversationKind::try_from(plan.conversation_kind).ok() != Some(ConversationKind::Group)
            || plan.authority_sequence <= 0
            || plan.authority_hash.len() != 32
            || plan.delivery_plan_sha256.len() != 32
        {
            return Err("messaging Conversation mutation plan is invalid".to_string());
        }
        let created_at_unix_ms = now_unix_ms();
        let command = ChatCommand {
            command_id: Ulid::new().to_string(),
            conversation_id: conversation_id.to_string(),
            sender: Some(CryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            }),
            observed_membership_epoch: plan.membership_epoch,
            observed_mls_epoch: plan.mls_epoch,
            client_timestamp: Some(timestamp(created_at_unix_ms)),
            delivery_plan_sha256: plan.delivery_plan_sha256.clone(),
            authority_station_peer_id: plan.authority_station_peer_id.clone(),
            payload: Some(payload),
        };
        self.store
            .persist_conversation_command(&ConversationCommandCommit {
                command: &command,
                expected_authority_sequence: plan.authority_sequence,
                expected_authority_hash: &plan.authority_hash,
                created_at_unix_ms,
            })?;
        Ok(command.command_id)
    }

    pub fn update_member_authority(
        &self,
        token: &str,
        conversation_id: &str,
        target_ptid: &str,
        role: Option<MemberRole>,
        muted: Option<bool>,
        muted_until_unix_ms: Option<i64>,
    ) -> Result<String, String> {
        self.prepare_member_authority_command(
            token,
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
        token: &str,
        conversation_id: &str,
        target_ptid: &str,
    ) -> Result<String, String> {
        self.prepare_member_authority_command(
            token,
            conversation_id,
            target_ptid,
            ConversationMemberAuthorityAction::TransferOwnership,
            None,
            None,
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare_member_authority_command(
        &self,
        token: &str,
        conversation_id: &str,
        target_ptid: &str,
        action: ConversationMemberAuthorityAction,
        role: Option<MemberRole>,
        muted: Option<bool>,
        muted_until_unix_ms: Option<i64>,
    ) -> Result<String, String> {
        let _guard = self
            .membership_transition_lock
            .lock()
            .map_err(|_| "messaging member-authority lock poisoned".to_string())?;
        let local = self
            .store
            .conversation_projections()?
            .into_iter()
            .find(|conversation| conversation.conversation_id == conversation_id)
            .ok_or_else(|| {
                "messaging member authority requires a local Conversation projection".to_string()
            })?;
        let authoritative = self.get_authoritative_conversation(token, conversation_id)?;
        let (authority_sequence, authority_hash) = self.store.authority_head(conversation_id)?;
        let created_at_unix_ms = now_unix_ms();
        if local.kind != ConversationKind::Group as i32
            || authoritative.kind != ConversationKind::Group as i32
            || authoritative.status != crate::model::chat::ConversationStatus::Active as i32
            || !local.active
            || authoritative.authority_epoch <= 0
            || authority_sequence <= 0
            || authority_hash.len() != 32
            || !target_ptid.starts_with("ptid:")
            || !local
                .members
                .iter()
                .any(|member| member.ptid == target_ptid)
            || local.conversation_id != authoritative.conversation_id
            || local.authority_station_id != authoritative.authority_station_peer_id
            || local.federation_id != authoritative.federation_id
            || local.owner_ptid != authoritative.owner_ptid
            || local.membership_epoch != authoritative.membership_epoch
            || local.mls_epoch != authoritative.mls_epoch
        {
            return Err("messaging member-authority scope is stale or incomplete".to_string());
        }
        match action {
            ConversationMemberAuthorityAction::UpdateMember => {
                if role.is_none() && muted.is_none() {
                    return Err("messaging member-authority update is empty".to_string());
                }
                if role.is_some_and(|role| !matches!(role, MemberRole::Member | MemberRole::Admin))
                {
                    return Err("messaging member-authority role is invalid".to_string());
                }
                if muted_until_unix_ms.is_some() && muted != Some(true) {
                    return Err("messaging mute deadline requires muted=true".to_string());
                }
            }
            ConversationMemberAuthorityAction::TransferOwnership => {
                if role.is_some() || muted.is_some() || muted_until_unix_ms.is_some() {
                    return Err(
                        "messaging ownership transfer does not accept member patches".to_string(),
                    );
                }
            }
            ConversationMemberAuthorityAction::Unspecified => {
                return Err("messaging member-authority action is unspecified".to_string());
            }
        }
        let command = ConversationMemberAuthorityCommand {
            version: 1,
            command_id: Ulid::new().to_string(),
            conversation_id: conversation_id.to_string(),
            operator: Some(CryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            }),
            target_ptid: target_ptid.to_string(),
            action: action as i32,
            role: role.map(|role| role as i32),
            muted,
            muted_until: muted_until_unix_ms.map(timestamp),
            federation_id: local.federation_id,
            authority_station_peer_id: local.authority_station_id,
            authority_epoch: authoritative.authority_epoch,
            authority_sequence,
            authority_hash,
            observed_membership_epoch: local.membership_epoch,
            observed_mls_epoch: local.mls_epoch,
            client_timestamp: Some(timestamp(created_at_unix_ms)),
            deadline: Some(timestamp(
                created_at_unix_ms.saturating_add(MEMBER_AUTHORITY_COMMAND_LIFETIME_MS),
            )),
        };
        self.store.persist_member_authority_command(&command)?;
        Ok(command.command_id)
    }

    fn get_authoritative_conversation(
        &self,
        token: &str,
        conversation_id: &str,
    ) -> Result<Conversation, String> {
        let query = [("conversation_id", conversation_id.to_string())];
        let response = station_client::request_proto_for_device::<
            GetConversationRequest,
            GetConversationResponse,
        >(
            Method::GET,
            "/conversation/get",
            token,
            Some(&query),
            None,
            &self.endpoint.device_id,
        )
        .map_err(|error| error.to_string())?;
        response
            .conversation
            .filter(|conversation| conversation.conversation_id == conversation_id)
            .ok_or_else(|| "Station returned another Conversation".to_string())
    }

    pub fn leave_conversation(
        &self,
        token: &str,
        conversation_id: &str,
    ) -> Result<MlsLeaveIntent, String> {
        let conversation = self.get_authoritative_conversation(token, conversation_id)?;
        if conversation.owner_ptid == self.endpoint.ptid {
            return Err("Conversation owner must transfer ownership or dissolve first".to_string());
        }
        let home_station_peer_id = station_client::active_station_peer_id()
            .ok_or_else(|| "messaging Home Station identity is unavailable".to_string())?;
        self.submit_mls_leave_intent(
            token,
            &MlsLeaveIntentInput {
                federation_id: conversation.federation_id,
                authority_station_peer_id: conversation.authority_station_peer_id,
                authority_epoch: conversation.authority_epoch,
                home_station_peer_id,
                conversation_id: conversation_id.to_string(),
                observed_membership_epoch: conversation.membership_epoch,
                observed_mls_epoch: conversation.mls_epoch,
                authority_sequence: 0,
                authority_hash: Vec::new(),
            },
        )
    }

    pub fn submit_mls_leave_intent(
        &self,
        token: &str,
        input: &MlsLeaveIntentInput,
    ) -> Result<MlsLeaveIntent, String> {
        let transport = StationMlsLeaveIntentTransport::new(
            token.to_string(),
            self.endpoint.device_id.clone(),
        )?;
        let (signing_key_id, signing_key) = self.device_signing_identity()?.ok_or_else(|| {
            "messaging leave intent device signing identity is unavailable".to_string()
        })?;
        let (authority_sequence, authority_hash) =
            self.store.authority_head(&input.conversation_id)?;
        let mut bound_input = input.clone();
        bound_input.authority_sequence = authority_sequence;
        bound_input.authority_hash = authority_hash;
        submit_leave_intent(
            &signing_key_id,
            &signing_key,
            &CryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            },
            &bound_input,
            now_unix_ms(),
            &transport,
        )
    }

    pub fn list_mls_leave_intents(
        &self,
        token: &str,
        conversation_id: &str,
    ) -> Result<Vec<MlsLeaveIntent>, String> {
        let transport = StationMlsLeaveIntentTransport::new(
            token.to_string(),
            self.endpoint.device_id.clone(),
        )?;
        list_leave_intents(conversation_id, &transport)
    }

    pub fn resume_leave_intent_once(&self, token: &str) -> Result<bool, String> {
        for conversation in self.store.conversation_projections()? {
            if !can_commit_pending_leave(&conversation, &self.endpoint.ptid) {
                continue;
            }
            let Some(intent) = self
                .list_mls_leave_intents(token, &conversation.conversation_id)?
                .into_iter()
                .find(|intent| intent.actor_ptid != self.endpoint.ptid)
            else {
                continue;
            };
            self.prepare_delegated_leave(token, intent)?;
            return Ok(true);
        }
        Ok(false)
    }

    pub fn prepare_delegated_leave(
        &self,
        token: &str,
        leave_intent: MlsLeaveIntent,
    ) -> Result<ChatCommand, String> {
        let _guard = self
            .membership_transition_lock
            .lock()
            .map_err(|_| "messaging membership transition lock poisoned".to_string())?;
        let input = MembershipTransitionIntentInput {
            conversation_id: leave_intent.conversation_id.clone(),
            action: MessagingMembershipAction::Leave,
            target_ptid: leave_intent.actor_ptid.clone(),
            target_device_id: String::new(),
            role: String::new(),
            leave_intent: Some(leave_intent),
        };
        let transport =
            StationMembershipTransitionTransport::new(token.to_string(), self.endpoint.clone())?;
        let plan = transport.prepare(&input)?;
        MembershipTransitionPreparer::new(
            self.store.clone(),
            self.mls_manager.clone(),
            CryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            },
        )?
        .prepare(None, &input, &plan, now_unix_ms())
    }

    pub fn enroll_pending_device(
        &self,
        token: &str,
        label: String,
    ) -> Result<Option<ActorDevice>, String> {
        DeviceEnrollmentManager::new(
            self.store.clone(),
            self.endpoint.ptid.clone(),
            self.endpoint.device_id.clone(),
        )?
        .enroll_pending(
            label,
            &StationDeviceTransport::new(token.to_string(), self.endpoint.device_id.clone())?,
        )
    }

    pub fn recover_stale_enrollment(&self, error: &str) -> bool {
        let manager = match DeviceEnrollmentManager::new(
            self.store.clone(),
            self.endpoint.ptid.clone(),
            self.endpoint.device_id.clone(),
        ) {
            Ok(manager) => manager,
            Err(error) => {
                tracing::error!(error = %error, "failed to construct device enrollment manager");
                return false;
            }
        };
        match manager.recover_stale(error) {
            Ok(true) => {
                tracing::warn!(
                    device_id = %self.endpoint.device_id,
                    "detected stale device enrollment; reset to pending for re-enrollment"
                );
                true
            }
            Ok(false) => false,
            Err(err) => {
                tracing::error!(error = %err, "failed to reset stale device enrollment");
                false
            }
        }
    }

    pub fn publish_prekeys(&self, token: &str) -> Result<(), String> {
        let mut maintenance = self
            .prekey_maintenance
            .lock()
            .map_err(|_| "messaging prekey maintenance lock poisoned".to_string())?;
        let actor_identity = self
            .actor_identity
            .as_ref()
            .ok_or_else(|| "messaging profile actor identity is unavailable".to_string())?;
        let publisher = PreKeyPublisher::new(
            self.store.clone(),
            CoreCryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            },
        )?;
        let now = now_unix_ms();
        let transport =
            StationPreKeyTransport::new(token.to_string(), self.endpoint.device_id.clone())?;
        publisher
            .publish(actor_identity.as_ref(), now, &transport)
            .and_then(|_| {
                if maintenance.next_inventory_reconciliation_at_unix_ms > now {
                    return Ok(());
                }
                publisher
                    .reconcile(actor_identity.as_ref(), &transport)
                    .map(|_| {
                        maintenance.next_inventory_reconciliation_at_unix_ms =
                            now.saturating_add(PREKEY_INVENTORY_RECONCILIATION_INTERVAL_MS);
                    })
            })
    }

    pub fn publish_mls_key_packages(&self, token: &str) -> Result<(), String> {
        MlsKeyPackagePublisher::new(
            self.store.clone(),
            self.mls_manager.clone(),
            CoreCryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            },
        )?
        .publish(
            now_unix_ms(),
            &StationMlsKeyPackageTransport::new(
                token.to_string(),
                self.endpoint.device_id.clone(),
            )?,
        )
    }

    pub fn hydrate_conversation_projections(
        &self,
        projections: &[super::ConversationProjection],
    ) -> Result<usize, String> {
        let mut bootstrapped = 0;
        for projection in projections {
            if self.store.bootstrap_conversation_projection(projection)? {
                bootstrapped += 1;
            }
        }
        Ok(bootstrapped)
    }
}

impl Drop for MessagingEngine {
    fn drop(&mut self) {
        self.attachment_transfer_control.request_shutdown();
    }
}

#[derive(Default)]
pub struct EngineRegistry {
    engines: Mutex<HashMap<String, Arc<MessagingEngine>>>,
    workers: Mutex<HashMap<String, MessagingLifecycleWorker>>,
    projection_notifier: Mutex<Option<MessagingProjectionNotifier>>,
}

impl EngineRegistry {
    pub fn get(&self, profile_id: &str) -> Result<Option<Arc<MessagingEngine>>, String> {
        self.engines
            .lock()
            .map_err(|_| "messaging engine registry lock poisoned".to_string())
            .map(|engines| engines.get(profile_id).cloned())
    }

    pub fn profile_ids(&self) -> Result<Vec<String>, String> {
        self.engines
            .lock()
            .map_err(|_| "messaging engine registry lock poisoned".to_string())
            .map(|engines| engines.keys().cloned().collect())
    }

    pub fn activate_profile(
        &self,
        profile_id: String,
        ptid: String,
        actor_identity_seed: &[u8; 32],
        actor_profile_version: u64,
    ) -> Result<Arc<MessagingEngine>, String> {
        let notifier = self
            .projection_notifier
            .lock()
            .map_err(|_| "messaging projection notifier registry lock poisoned".to_string())?
            .clone();
        let mut engines = self
            .engines
            .lock()
            .map_err(|_| "messaging engine registry lock poisoned".to_string())?;
        if let Some(existing) = engines.get(&profile_id) {
            if existing.endpoint().ptid != ptid {
                return Err("messaging profile is already bound to another actor".to_string());
            }
            return Ok(existing.clone());
        }
        let engine = Arc::new(MessagingEngine::open_profile(
            profile_id.clone(),
            ptid,
            actor_identity_seed,
            actor_profile_version,
        )?);
        engine.set_projection_notifier(notifier)?;
        engines.insert(profile_id, engine.clone());
        Ok(engine)
    }

    pub fn activate(
        &self,
        profile_id: String,
        endpoint: EngineEndpoint,
    ) -> Result<Arc<MessagingEngine>, String> {
        let notifier = self
            .projection_notifier
            .lock()
            .map_err(|_| "messaging projection notifier registry lock poisoned".to_string())?
            .clone();
        let mut engines = self
            .engines
            .lock()
            .map_err(|_| "messaging engine registry lock poisoned".to_string())?;
        if let Some(existing) = engines.get(&profile_id) {
            if existing.endpoint() != &endpoint {
                return Err("messaging profile is already bound to another endpoint".to_string());
            }
            return Ok(existing.clone());
        }
        let engine = Arc::new(MessagingEngine::open(profile_id.clone(), endpoint)?);
        engine.set_projection_notifier(notifier)?;
        engines.insert(profile_id, engine.clone());
        Ok(engine)
    }

    pub fn set_projection_notifier(
        &self,
        notifier: MessagingProjectionNotifier,
    ) -> Result<(), String> {
        *self
            .projection_notifier
            .lock()
            .map_err(|_| "messaging projection notifier registry lock poisoned".to_string())? =
            Some(notifier.clone());
        let engines = self
            .engines
            .lock()
            .map_err(|_| "messaging engine registry lock poisoned".to_string())?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for engine in engines {
            engine.set_projection_notifier(Some(notifier.clone()))?;
        }
        Ok(())
    }

    pub fn activate_profile_worker(&self, profile_id: &str, token: String) -> Result<(), String> {
        let engine = self
            .engines
            .lock()
            .map_err(|_| "messaging engine registry lock poisoned".to_string())?
            .get(profile_id)
            .cloned()
            .ok_or_else(|| "messaging lifecycle requires active profile engine".to_string())?;
        let mut workers = self
            .workers
            .lock()
            .map_err(|_| "messaging worker registry lock poisoned".to_string())?;
        if let Some(worker) = workers.get(profile_id) {
            if worker.is_active()? {
                worker.refresh_token(token.clone())?;
                if worker.is_active()? {
                    return Ok(());
                }
            }
        }
        if let Some(worker) = workers.remove(profile_id) {
            if let Err(error) = worker.stop() {
                tracing::warn!(
                    profile_id,
                    error = %error,
                    "replacing terminated messaging lifecycle worker"
                );
            }
        }
        workers.insert(
            profile_id.to_string(),
            MessagingLifecycleWorker::start(engine, token)?,
        );
        Ok(())
    }

    pub fn profile_worker_token(&self, profile_id: &str) -> Result<Option<String>, String> {
        let workers = self
            .workers
            .lock()
            .map_err(|_| "messaging worker registry lock poisoned".to_string())?;
        let Some(worker) = workers.get(profile_id) else {
            return Ok(None);
        };
        if !worker.is_active()? {
            return Ok(None);
        }
        worker.token().map(Some)
    }

    pub fn deactivate_profile_worker(&self, profile_id: &str) -> Result<(), String> {
        let worker = self
            .workers
            .lock()
            .map_err(|_| "messaging worker registry lock poisoned".to_string())?
            .remove(profile_id);
        if let Some(worker) = worker {
            worker.stop()?;
        }
        Ok(())
    }

    pub fn wake_profile(&self, profile_id: &str) -> Result<(), String> {
        self.workers
            .lock()
            .map_err(|_| "messaging worker registry lock poisoned".to_string())?
            .get(profile_id)
            .ok_or_else(|| "messaging profile worker is not active".to_string())?
            .wake()
    }

    pub fn deactivate(&self, profile_id: &str) -> Result<Option<Arc<MessagingEngine>>, String> {
        let worker = self
            .workers
            .lock()
            .map_err(|_| "messaging worker registry lock poisoned".to_string())?
            .remove(profile_id);
        if let Some(worker) = worker {
            worker.stop()?;
        }
        self.engines
            .lock()
            .map_err(|_| "messaging engine registry lock poisoned".to_string())
            .map(|mut engines| engines.remove(profile_id))
    }

    pub fn deactivate_all(&self) -> Result<Vec<Arc<MessagingEngine>>, String> {
        let workers = self
            .workers
            .lock()
            .map_err(|_| "messaging worker registry lock poisoned".to_string())?
            .drain()
            .map(|(_, worker)| worker)
            .collect::<Vec<_>>();
        for worker in workers {
            worker.stop()?;
        }
        self.engines
            .lock()
            .map_err(|_| "messaging engine registry lock poisoned".to_string())
            .map(|mut engines| engines.drain().map(|(_, engine)| engine).collect())
    }

    pub fn restore_profile(
        &self,
        profile_id: &str,
        archive: &MessagingRecoveryArchive,
        reconciliation: &RecoveryReconciliation,
    ) -> Result<FreshDeviceEnrollment, String> {
        let (previous_ptid, previous_seed, previous_profile_version, device_identity) = {
            let engines = self
                .engines
                .lock()
                .map_err(|_| "messaging engine registry lock poisoned".to_string())?;
            let engine = engines.get(profile_id).ok_or_else(|| {
                "messaging recovery requires an active profile engine".to_string()
            })?;
            // The registry and its active lifecycle worker each hold one Arc.
            if engine.endpoint.ptid != archive.ptid || Arc::strong_count(engine) != 2 {
                return Err(
                    "messaging recovery requires exclusive ownership of the matching profile"
                        .to_string(),
                );
            }
            let previous_seed = Zeroizing::new(
                engine
                    .actor_identity
                    .as_ref()
                    .ok_or_else(|| "messaging profile actor identity is unavailable".to_string())?
                    .seed_bytes(),
            );
            let enrollment = engine
                .store
                .device_enrollment()?
                .ok_or_else(|| "messaging profile device enrollment is unavailable".to_string())?;
            let previous_profile_version = enrollment.certificate.observed_profile_version;
            let (device_signing_seed, signing_key_id) = engine
                .store
                .device_signing_seed()?
                .ok_or_else(|| "messaging profile device signing key is unavailable".to_string())?;
            if enrollment.certificate.signing_key_id != signing_key_id {
                return Err(
                    "messaging profile device signing key identity is inconsistent".to_string(),
                );
            }
            (
                engine.endpoint.ptid.clone(),
                previous_seed,
                previous_profile_version,
                FreshDeviceIdentityState {
                    enrollment,
                    device_signing_seed,
                },
            )
        };
        let (worker, worker_token) = {
            let mut workers = self
                .workers
                .lock()
                .map_err(|_| "messaging worker registry lock poisoned".to_string())?;
            let worker = workers.get(profile_id).ok_or_else(|| {
                "messaging recovery requires an active profile worker".to_string()
            })?;
            let token = worker.token()?;
            let worker = workers
                .remove(profile_id)
                .ok_or_else(|| "messaging profile worker disappeared".to_string())?;
            (worker, token)
        };
        if let Err(error) = worker.stop() {
            return match self.restart_existing_profile_worker(profile_id, worker_token) {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(format!(
                    "{error}; messaging recovery worker rollback failed: {rollback_error}"
                )),
            };
        }
        let mut engines = self
            .engines
            .lock()
            .map_err(|_| "messaging engine registry lock poisoned".to_string())?;
        let engine = engines
            .remove(profile_id)
            .ok_or_else(|| "messaging recovery requires an active profile engine".to_string())?;
        if Arc::strong_count(&engine) != 1 {
            engines.insert(profile_id.to_string(), engine);
            drop(engines);
            self.restart_existing_profile_worker(profile_id, worker_token)?;
            return Err(
                "messaging recovery requires exclusive ownership of the matching profile"
                    .to_string(),
            );
        }
        if let Err(error) = engine.store.prepare_for_atomic_replace() {
            engines.insert(profile_id.to_string(), engine);
            drop(engines);
            self.restart_existing_profile_worker(profile_id, worker_token)?;
            return Err(error);
        }
        drop(engine);
        drop(engines);

        match restore_profile_database_atomically(
            profile_id,
            archive,
            reconciliation,
            &device_identity,
        ) {
            Ok(enrollment) => {
                let engine = Arc::new(MessagingEngine::open_profile(
                    profile_id.to_string(),
                    archive.ptid.clone(),
                    &archive.actor_identity_seed,
                    archive.actor_profile_version,
                )?);
                self.install_profile_runtime(profile_id, engine, worker_token)?;
                Ok(enrollment)
            }
            Err(error) => {
                let rollback = MessagingEngine::open_profile(
                    profile_id.to_string(),
                    previous_ptid,
                    &previous_seed,
                    previous_profile_version,
                )
                .and_then(|engine| {
                    self.install_profile_runtime(profile_id, Arc::new(engine), worker_token)
                });
                match rollback {
                    Ok(()) => Err(error),
                    Err(rollback_error) => Err(format!(
                        "{error}; messaging recovery runtime rollback failed: {rollback_error}"
                    )),
                }
            }
        }
    }

    fn restart_existing_profile_worker(
        &self,
        profile_id: &str,
        token: String,
    ) -> Result<(), String> {
        let engine = self
            .engines
            .lock()
            .map_err(|_| "messaging engine registry lock poisoned".to_string())?
            .get(profile_id)
            .cloned()
            .ok_or_else(|| "messaging recovery rollback profile is unavailable".to_string())?;
        let worker = MessagingLifecycleWorker::start(engine, token)?;
        self.workers
            .lock()
            .map_err(|_| "messaging worker registry lock poisoned".to_string())?
            .insert(profile_id.to_string(), worker);
        Ok(())
    }

    fn install_profile_runtime(
        &self,
        profile_id: &str,
        engine: Arc<MessagingEngine>,
        token: String,
    ) -> Result<(), String> {
        let notifier = self
            .projection_notifier
            .lock()
            .map_err(|_| "messaging projection notifier registry lock poisoned".to_string())?
            .clone();
        engine.set_projection_notifier(notifier)?;
        let worker = MessagingLifecycleWorker::start(engine.clone(), token)?;
        let mut engines = self
            .engines
            .lock()
            .map_err(|_| "messaging engine registry lock poisoned".to_string())?;
        let mut workers = self
            .workers
            .lock()
            .map_err(|_| "messaging worker registry lock poisoned".to_string())?;
        if engines.contains_key(profile_id) || workers.contains_key(profile_id) {
            drop(workers);
            drop(engines);
            worker.stop()?;
            return Err("messaging profile runtime is already active".to_string());
        }
        engines.insert(profile_id.to_string(), engine);
        workers.insert(profile_id.to_string(), worker);
        Ok(())
    }

    #[cfg(test)]
    fn activate_in_memory(
        &self,
        profile_id: String,
        endpoint: EngineEndpoint,
    ) -> Result<Arc<MessagingEngine>, String> {
        let mut engines = self
            .engines
            .lock()
            .map_err(|_| "messaging engine registry lock poisoned".to_string())?;
        if let Some(existing) = engines.get(&profile_id) {
            if existing.endpoint() != &endpoint {
                return Err("messaging profile is already bound to another endpoint".to_string());
            }
            return Ok(existing.clone());
        }
        let engine = Arc::new(MessagingEngine::in_memory(profile_id.clone(), endpoint)?);
        engines.insert(profile_id, engine.clone());
        Ok(engine)
    }
}

fn decode_superseded_interaction(
    pending: &SupersededInteractionIntent,
    endpoint: &EngineEndpoint,
) -> Result<DurableInteraction, String> {
    let command = ChatCommand::decode(pending.command_bytes.as_slice())
        .map_err(|error| format!("decode superseded messaging interaction: {error}"))?;
    if command.encode_to_vec() != pending.command_bytes
        || command.command_id != pending.command_id
        || command.conversation_id != pending.conversation_id
        || command.sender.as_ref().map(|sender| sender.ptid.as_str())
            != Some(endpoint.ptid.as_str())
        || command
            .sender
            .as_ref()
            .map(|sender| sender.device_id.as_str())
            != Some(endpoint.device_id.as_str())
    {
        return Err("messaging superseded interaction identity mismatch".to_string());
    }
    let interaction = match command.payload {
        Some(chat_command::Payload::EditMessage(edit))
            if pending.interaction_kind == "edit"
                && edit.message_id == pending.target_message_id =>
        {
            DurableInteraction::Edit(
                pending
                    .edited_text
                    .clone()
                    .filter(|plaintext| !plaintext.trim().is_empty())
                    .ok_or_else(|| {
                        "messaging superseded edit content is unavailable".to_string()
                    })?,
            )
        }
        Some(chat_command::Payload::RetractMessage(retract))
            if pending.interaction_kind == "retract"
                && retract.message_id == pending.target_message_id =>
        {
            DurableInteraction::Retract
        }
        Some(chat_command::Payload::Reaction(reaction))
            if reaction.message_id == pending.target_message_id
                && pending.interaction_kind
                    == if reaction.remove {
                        "reaction-remove"
                    } else {
                        "reaction-add"
                    } =>
        {
            DurableInteraction::Reaction {
                reaction: reaction.reaction,
                remove: reaction.remove,
            }
        }
        Some(chat_command::Payload::PinMessage(pin))
            if pin.message_id == pending.target_message_id
                && pending.interaction_kind == if pin.remove { "unpin" } else { "pin" } =>
        {
            DurableInteraction::Pin { remove: pin.remove }
        }
        _ => return Err("messaging superseded interaction payload mismatch".to_string()),
    };
    Ok(interaction)
}

fn can_commit_pending_leave(conversation: &ConversationProjection, actor_ptid: &str) -> bool {
    conversation.active
        && conversation.kind == ConversationKind::Group as i32
        && conversation.members.iter().any(|member| {
            member.ptid == actor_ptid
                && matches!(
                    MemberRole::try_from(member.role),
                    Ok(MemberRole::Admin | MemberRole::Owner)
                )
        })
}

fn validate_identity(profile_id: &str, endpoint: &EngineEndpoint) -> Result<(), String> {
    if profile_id.trim().is_empty()
        || endpoint.ptid.trim().is_empty()
        || endpoint.device_id.trim().is_empty()
    {
        return Err("messaging engine requires profile and complete endpoint".to_string());
    }
    Ok(())
}

fn prepare_local_attachment_upload(
    conversation_id: &str,
    message_id: &str,
    authority_station_id: &str,
    intent: &LocalAttachmentIntent,
    created_at_unix_ms: i64,
) -> Result<PendingAttachmentUpload, String> {
    if intent.source_local_ref.trim().is_empty()
        || intent.filename.trim().is_empty()
        || intent.filename.len() > 1024
        || intent.mime_type.trim().is_empty()
        || intent.mime_type.len() > 255
        || created_at_unix_ms <= 0
    {
        return Err("messaging local attachment intent is incomplete".to_string());
    }
    match AttachmentContentKind::try_from(intent.content_kind) {
        Ok(AttachmentContentKind::File) if intent.duration_ms == 0 => {}
        Ok(AttachmentContentKind::VoiceNote)
            if intent.duration_ms > 0
                && intent.mime_type.to_ascii_lowercase().starts_with("audio/") => {}
        _ => return Err("messaging local attachment media intent is invalid".to_string()),
    }
    let source = std::fs::canonicalize(Path::new(&intent.source_local_ref))
        .map_err(|error| format!("resolve messaging attachment source: {error}"))?;
    let metadata = source
        .metadata()
        .map_err(|error| format!("stat messaging attachment source: {error}"))?;
    if !metadata.is_file() {
        return Err("messaging attachment source is not a file".to_string());
    }
    let material = AttachmentCryptoMaterial::generate(metadata.len())?;
    let mut plaintext = File::open(&source)
        .map_err(|error| format!("open messaging attachment source: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; ATTACHMENT_CHUNK_SIZE as usize];
    loop {
        let read = plaintext
            .read(&mut buffer)
            .map_err(|error| format!("hash messaging attachment source: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let attachment_id = Ulid::new().to_string();
    let partial_local_ref = format!("{}.peers-transfer-{}.part", source.display(), attachment_id);
    let chunk_count = material.chunk_count();
    Ok(PendingAttachmentUpload {
        transfer: AttachmentTransferRecord {
            attachment_id,
            conversation_id: conversation_id.to_string(),
            message_id: message_id.to_string(),
            authority_station_id: authority_station_id.to_string(),
            direction: 1,
            state: AttachmentTransferState::Queued as i32,
            upload_id: String::new(),
            generation: 0,
            descriptor_sha256: vec![0; 32],
            completed_chunk_bitmap: vec![0; chunk_count.div_ceil(8) as usize],
            source_local_ref: source.display().to_string(),
            partial_local_ref,
            object_key: material.object_key().to_vec(),
            base_nonce: material.base_nonce().to_vec(),
            plaintext_size: material.plaintext_size(),
            chunk_size: material.chunk_size(),
            attempt_count: 0,
            next_attempt_at_unix_ms: created_at_unix_ms,
            last_error_code: 0,
            updated_at_unix_ms: created_at_unix_ms,
        },
        filename: intent.filename.clone(),
        mime_type: intent.mime_type.clone(),
        plaintext_sha256: hasher.finalize().to_vec(),
        content_kind: intent.content_kind,
        duration_ms: intent.duration_ms,
    })
}

fn attachment_download_transfer(
    profile_id: &str,
    projection: &AttachmentDownloadProjection,
    created_at_unix_ms: i64,
) -> Result<AttachmentTransferRecord, String> {
    let object = projection
        .metadata
        .object
        .as_ref()
        .ok_or_else(|| "messaging attachment descriptor is missing".to_string())?;
    let cache_path = attachment_cache_path(profile_id, &projection.metadata.attachment_id)?;
    let partial_local_ref = format!("{}.part", cache_path.display());
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
        partial_local_ref,
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

fn attachment_source_root(profile_id: &str) -> Result<PathBuf, String> {
    if profile_id.trim().is_empty() {
        return Err("messaging attachment source profile is required".to_string());
    }
    let profile_hash = hex::encode(Sha256::digest(profile_id.as_bytes()));
    storage::app_file_path(
        "desktop",
        StorageKind::Temp,
        &["messaging-sources", &profile_hash],
    )
    .map_err(|error| format!("resolve messaging attachment source root: {error}"))
}

fn managed_attachment_source(profile_id: &str, path: &Path) -> Result<bool, String> {
    let root = attachment_source_root(profile_id)?;
    let Some(parent) = path.parent() else {
        return Ok(false);
    };
    let canonical_root = std::fs::canonicalize(&root)
        .map_err(|error| format!("resolve messaging attachment source root: {error}"))?;
    let canonical_parent = std::fs::canonicalize(parent)
        .map_err(|error| format!("resolve messaging attachment source parent: {error}"))?;
    Ok(canonical_parent == canonical_root
        && path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| {
                value.len() == 26 && value.chars().all(|ch| ch.is_ascii_alphanumeric())
            }))
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

fn attachment_cache_path(profile_id: &str, attachment_id: &str) -> Result<PathBuf, String> {
    if profile_id.trim().is_empty() || attachment_id.trim().is_empty() {
        return Err("messaging attachment cache identity is incomplete".to_string());
    }
    let profile_hash = hex::encode(Sha256::digest(profile_id.as_bytes()));
    storage::app_file_path(
        "desktop",
        StorageKind::Cache,
        &["messaging-cache", &profile_hash, attachment_id],
    )
    .map_err(|error| format!("resolve messaging attachment cache path: {error}"))
}

fn sqlite_sidecar_path(database_path: &Path, suffix: &str) -> PathBuf {
    let mut path = database_path.as_os_str().to_os_string();
    path.push(suffix);
    PathBuf::from(path)
}

fn materialize_attachment_cache(
    source_path: &Path,
    cache_path: &Path,
    expected_plaintext_sha256: &[u8; 32],
) -> Result<bool, String> {
    if cache_path.is_file() && sha256_path(cache_path)? == *expected_plaintext_sha256 {
        return Ok(false);
    }
    let source_valid =
        source_path.is_file() && sha256_path(source_path)? == *expected_plaintext_sha256;
    if cache_path.exists() {
        if !source_valid {
            return Err(SENDER_ATTACHMENT_SOURCE_INVALID.to_string());
        }
        std::fs::remove_file(cache_path).map_err(|error| {
            format!("remove invalid messaging sender attachment cache: {error}")
        })?;
    }
    if !source_valid {
        return Err(SENDER_ATTACHMENT_SOURCE_INVALID.to_string());
    }
    let parent = cache_path
        .parent()
        .ok_or_else(|| "messaging attachment cache parent is unavailable".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("create messaging attachment cache directory: {error}"))?;
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(source_path)
        .and_then(|source| source.sync_all())
        .map_err(|error| format!("sync messaging attachment source: {error}"))?;
    std::fs::rename(source_path, cache_path)
        .map_err(|error| format!("promote messaging attachment cache: {error}"))?;
    #[cfg(unix)]
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("sync messaging attachment cache directory: {error}"))?;
    if sha256_path(cache_path)? != *expected_plaintext_sha256 {
        let _ = std::fs::rename(cache_path, source_path);
        return Err("messaging promoted attachment cache is invalid".to_string());
    }
    Ok(true)
}

fn sha256_path(path: &Path) -> Result<[u8; 32], String> {
    let mut file =
        File::open(path).map_err(|error| format!("open messaging attachment cache: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; ATTACHMENT_CHUNK_SIZE as usize];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("hash messaging attachment cache: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().into())
}

pub(crate) fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or_default()
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
    use crate::model::chat::{
        conversation_event, ConversationAuthorityEndpoint, ConversationAuthorityMember,
        ConversationAuthoritySnapshot, ConversationCreatedFact, DeviceEventDelivery,
        DeviceInboxPayloadType, DurableDeviceInboxItem, MessageCommittedFact,
        MessageHiddenForActorFact, MessagingContentKind, PreparedEndpointPayloadKind,
    };
    use messaging_core::mls::group::MlsMemberKeyPackage;
    use messaging_core::proto::actor_device_ptid;
    use std::collections::VecDeque;
    use std::sync::mpsc;
    use std::thread;

    fn endpoint(device_id: &str) -> EngineEndpoint {
        EngineEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: device_id.to_string(),
        }
    }

    fn direct_genesis_event() -> ConversationEvent {
        let alice = CryptoEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: "alice-device".to_string(),
        };
        let bob = CryptoEndpoint {
            ptid: "ptid:bob".to_string(),
            device_id: "bob-device".to_string(),
        };
        let members = vec![
            ConversationAuthorityMember {
                ptid: alice.ptid.clone(),
                role: "member".to_string(),
                home_station_peer_id: "station-local".to_string(),
                muted: false,
                muted_until: None,
            },
            ConversationAuthorityMember {
                ptid: bob.ptid.clone(),
                role: "member".to_string(),
                home_station_peer_id: "station-local".to_string(),
                muted: false,
                muted_until: None,
            },
        ];
        let mut event = ConversationEvent {
            event_id: "created:direct-1".to_string(),
            conversation_id: "direct-1".to_string(),
            sequence: 1,
            command_id: "create:direct-1".to_string(),
            actor: Some(alice.clone()),
            previous_hash: Vec::new(),
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 1,
                nanos: 0,
            }),
            delivery_commitments: vec![vec![1; 32], vec![2; 32]],
            membership_epoch: 1,
            mls_epoch: 0,
            authority_station_peer_id: "station-local".to_string(),
            payload: Some(conversation_event::Payload::ConversationCreated(
                ConversationCreatedFact {
                    kind: ConversationKind::Direct as i32,
                    name: String::new(),
                    owner_ptid: alice.ptid.clone(),
                    members: members.clone(),
                    post_state: Some(ConversationAuthoritySnapshot {
                        kind: ConversationKind::Direct as i32,
                        name: String::new(),
                        owner_ptid: alice.ptid.clone(),
                        active_members: members,
                        active_endpoints: vec![alice.clone(), bob.clone()],
                        membership_epoch: 1,
                        mls_epoch: 0,
                        active_endpoint_routes: vec![
                            ConversationAuthorityEndpoint {
                                endpoint: Some(alice),
                                home_station_peer_id: "station-local".to_string(),
                            },
                            ConversationAuthorityEndpoint {
                                endpoint: Some(bob),
                                home_station_peer_id: "station-local".to_string(),
                            },
                        ],
                        federation_id: "federation-1".to_string(),
                        authority_epoch: 1,
                        ..Default::default()
                    }),
                },
            )),
        };
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        event
    }

    fn direct_send_plan(event: &ConversationEvent) -> PrepareConversationCommandResponse {
        PrepareConversationCommandResponse {
            conversation_id: event.conversation_id.clone(),
            conversation_kind: ConversationKind::Direct as i32,
            authority_sequence: event.sequence,
            authority_hash: event.event_hash.clone(),
            membership_epoch: event.membership_epoch,
            mls_epoch: event.mls_epoch,
            authority_station_peer_id: event.authority_station_peer_id.clone(),
            ..Default::default()
        }
    }

    fn direct_message_event(previous: &ConversationEvent) -> ConversationEvent {
        let mut event = ConversationEvent {
            event_id: "message:direct-1".to_string(),
            conversation_id: previous.conversation_id.clone(),
            sequence: previous.sequence + 1,
            command_id: "send:direct-1".to_string(),
            actor: previous.actor.clone(),
            previous_hash: previous.event_hash.clone(),
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 2,
                nanos: 0,
            }),
            delivery_commitments: vec![vec![3; 32], vec![4; 32]],
            membership_epoch: previous.membership_epoch,
            mls_epoch: previous.mls_epoch,
            authority_station_peer_id: previous.authority_station_peer_id.clone(),
            payload: Some(conversation_event::Payload::MessageCommitted(
                MessageCommittedFact {
                    message_id: "message-1".to_string(),
                    sender: previous.actor.clone(),
                    content_kind: MessagingContentKind::Text as i32,
                    ..Default::default()
                },
            )),
        };
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        event
    }

    fn direct_delivery_item(
        mut event: ConversationEvent,
        recipient: CryptoEndpoint,
        payload_kind: PreparedEndpointPayloadKind,
    ) -> DurableDeviceInboxItem {
        let endpoint_payload = b"endpoint payload".to_vec();
        let endpoint_payload_sha256 = Sha256::digest(&endpoint_payload).to_vec();
        let commitment = messaging_core::codec::verification::delivery_commitment(
            &event.conversation_id,
            &event.event_id,
            &recipient.ptid,
            &recipient.device_id,
            payload_kind,
            &endpoint_payload_sha256,
        );
        event.delivery_commitments = vec![commitment.to_vec()];
        event.event_hash.clear();
        event.event_hash = Sha256::digest(event.encode_to_vec()).to_vec();
        let delivery = DeviceEventDelivery {
            event: Some(event.clone()),
            recipient: Some(recipient.clone()),
            payload_kind: payload_kind as i32,
            endpoint_payload,
            endpoint_payload_sha256,
            delivery_commitment: commitment.to_vec(),
            sender_actor_identity_public_key: vec![9; 32],
        };
        let opaque_payload = delivery.encode_to_vec();
        DurableDeviceInboxItem {
            item_id: format!("item:{}", event.event_id),
            recipient: Some(actor_device_ref(&recipient.ptid, &recipient.device_id)),
            lane_sequence: 1,
            event_id: event.event_id,
            conversation_id: event.conversation_id,
            idempotency_key: "event:current".to_string(),
            payload_type: DeviceInboxPayloadType::ConversationEvent as i32,
            opaque_payload: opaque_payload.clone(),
            payload_sha256: Sha256::digest(&opaque_payload).to_vec(),
            ..Default::default()
        }
    }

    #[test]
    fn projection_change_identifies_actor_hidden_message_removal() {
        let genesis = direct_genesis_event();
        let previous = direct_message_event(&genesis);
        let mut hidden = ConversationEvent {
            event_id: "hide:direct-1".to_string(),
            conversation_id: previous.conversation_id.clone(),
            sequence: previous.sequence + 1,
            command_id: "hide-command".to_string(),
            actor: previous.actor.clone(),
            previous_hash: previous.event_hash.clone(),
            event_hash: Vec::new(),
            committed_at: Some(prost_types::Timestamp {
                seconds: 3,
                nanos: 0,
            }),
            delivery_commitments: Vec::new(),
            membership_epoch: previous.membership_epoch,
            mls_epoch: previous.mls_epoch,
            authority_station_peer_id: previous.authority_station_peer_id,
            payload: Some(conversation_event::Payload::MessageHiddenForActor(
                MessageHiddenForActorFact {
                    message_id: "message-1".to_string(),
                    actor_ptid: "ptid:alice".to_string(),
                    ..Default::default()
                },
            )),
        };
        hidden.event_hash = Sha256::digest(hidden.encode_to_vec()).to_vec();
        let item = direct_delivery_item(
            hidden,
            CryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "alice-device".to_string(),
            },
            PreparedEndpointPayloadKind::PublicEvent,
        );

        assert_eq!(
            projection_change_metadata(&item, "ptid:alice"),
            (
                MessagingProjectionKind::Message,
                "message-1".to_string(),
                true,
            )
        );
        assert_eq!(
            projection_change_metadata(&item, "ptid:bob"),
            (MessagingProjectionKind::Conversation, String::new(), false,)
        );
    }

    #[test]
    fn direct_authority_checkpoint_requires_full_chain_plan_and_member_binding() {
        let genesis = direct_genesis_event();
        let message = direct_message_event(&genesis);
        let plan = direct_send_plan(&message);
        let target = DirectAuthorityCheckpointTarget::from(&plan);
        let projection = direct_authority_checkpoint_projection(
            &[genesis.clone(), message.clone()],
            &target,
            "ptid:bob",
            100,
        )
        .unwrap();
        assert_eq!(projection.conversation_id, genesis.conversation_id);
        assert_eq!(projection.membership_epoch, 1);
        assert_eq!(projection.mls_epoch, 0);
        assert_eq!(
            projection
                .members
                .iter()
                .map(|member| member.ptid.as_str())
                .collect::<Vec<_>>(),
            vec!["ptid:alice", "ptid:bob"]
        );

        let mut wrong_plan = plan.clone();
        wrong_plan.authority_sequence = 1;
        let wrong_target = DirectAuthorityCheckpointTarget::from(&wrong_plan);
        assert_eq!(
            direct_authority_checkpoint_projection(
                &[genesis.clone(), message.clone()],
                &wrong_target,
                "ptid:bob",
                100,
            )
            .unwrap_err(),
            "messaging Direct authority checkpoint does not match target head"
        );

        let mut group_plan = plan.clone();
        group_plan.conversation_kind = ConversationKind::Group as i32;
        let group_target = DirectAuthorityCheckpointTarget::from(&group_plan);
        assert_eq!(
            direct_authority_checkpoint_projection(
                &[genesis.clone(), message.clone()],
                &group_target,
                "ptid:bob",
                100,
            )
            .unwrap_err(),
            "messaging Direct authority checkpoint does not match target head"
        );

        let mut non_contiguous = message.clone();
        non_contiguous.previous_hash = vec![9; 32];
        non_contiguous.event_hash.clear();
        non_contiguous.event_hash = Sha256::digest(non_contiguous.encode_to_vec()).to_vec();
        assert_eq!(
            direct_authority_checkpoint_projection(
                &[genesis.clone(), non_contiguous],
                &target,
                "ptid:bob",
                100,
            )
            .unwrap_err(),
            "messaging Direct authority checkpoint chain is not contiguous"
        );

        let mut tampered = genesis;
        tampered.membership_epoch = 2;
        assert_eq!(
            direct_authority_checkpoint_projection(&[tampered, message], &target, "ptid:bob", 100,)
                .unwrap_err(),
            "messaging authority event hash mismatch"
        );
    }

    #[test]
    fn fresh_direct_receiver_targets_only_the_previous_authority_head() {
        let genesis = direct_genesis_event();
        let historical_message = direct_message_event(&genesis);
        let current_message = direct_message_event(&historical_message);
        let endpoint = endpoint("alice-device");
        let item = direct_delivery_item(
            current_message.clone(),
            CryptoEndpoint {
                ptid: endpoint.ptid.clone(),
                device_id: endpoint.device_id.clone(),
            },
            PreparedEndpointPayloadKind::DirectCiphertext,
        );
        let store = MessagingStore::in_memory().unwrap();

        let target = pending_direct_receiver_checkpoint(&store, &endpoint, &item)
            .unwrap()
            .expect("fresh Direct receiver must require a checkpoint");

        assert_eq!(target.conversation_id, current_message.conversation_id);
        assert_eq!(target.event_sequence, current_message.sequence - 1);
        assert_eq!(target.event_hash, current_message.previous_hash);
        assert_eq!(
            target.authority_station_peer_id,
            current_message.authority_station_peer_id
        );
    }

    #[test]
    fn receiver_checkpoint_skips_non_direct_and_existing_authority_heads() {
        let genesis = direct_genesis_event();
        let historical_message = direct_message_event(&genesis);
        let current_message = direct_message_event(&historical_message);
        let endpoint = endpoint("alice-device");
        let recipient = CryptoEndpoint {
            ptid: endpoint.ptid.clone(),
            device_id: endpoint.device_id.clone(),
        };
        let store = MessagingStore::in_memory().unwrap();
        let non_direct = direct_delivery_item(
            current_message.clone(),
            recipient.clone(),
            PreparedEndpointPayloadKind::PublicEvent,
        );
        assert!(
            pending_direct_receiver_checkpoint(&store, &endpoint, &non_direct)
                .unwrap()
                .is_none()
        );

        let historical_target =
            DirectAuthorityCheckpointTarget::from(&direct_send_plan(&historical_message));
        let projection = direct_authority_checkpoint_projection(
            &[genesis.clone(), historical_message.clone()],
            &historical_target,
            &endpoint.ptid,
            100,
        )
        .unwrap();
        store
            .bootstrap_conversation_projection(&projection)
            .unwrap();
        assert!(apply_direct_authority_checkpoint(
            &store,
            &endpoint.ptid,
            &historical_target,
            &[genesis, historical_message],
            100,
        )
        .unwrap());

        let direct = direct_delivery_item(
            current_message,
            recipient,
            PreparedEndpointPayloadKind::DirectCiphertext,
        );
        assert!(
            pending_direct_receiver_checkpoint(&store, &endpoint, &direct)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn attachment_open_retries_pending_transfer_until_ready() {
        let mut attempts = VecDeque::from([
            AttachmentOpenProgress::Pending {
                next_attempt_at_unix_ms: now_unix_ms(),
            },
            AttachmentOpenProgress::Ready("/tmp/verified-cache".to_string()),
        ]);
        let mut sleeps = Vec::new();

        let path = drive_attachment_open(
            Instant::now() + Duration::from_secs(1),
            || Ok(attempts.pop_front().expect("attachment open attempt")),
            |delay| sleeps.push(delay),
        )
        .expect("pending attachment should become ready");

        assert_eq!(path, "/tmp/verified-cache");
        assert!(attempts.is_empty());
        assert_eq!(sleeps, vec![ATTACHMENT_OPEN_RETRY_FLOOR]);
    }

    #[test]
    fn attachment_open_stops_at_deadline() {
        let error = drive_attachment_open(
            Instant::now(),
            || {
                Ok(AttachmentOpenProgress::Pending {
                    next_attempt_at_unix_ms: now_unix_ms(),
                })
            },
            |_| panic!("expired attachment open must not sleep"),
        )
        .expect_err("expired attachment open must fail");

        assert_eq!(
            error,
            "messaging attachment download did not complete before open deadline"
        );
    }

    #[test]
    fn attachment_paths_use_canonical_desktop_storage_layout() {
        let profile_id = "profile-1";
        let profile_hash = hex::encode(Sha256::digest(profile_id.as_bytes()));

        assert_eq!(
            attachment_source_root(profile_id).unwrap(),
            storage::app_file_path(
                "desktop",
                StorageKind::Temp,
                &["messaging-sources", &profile_hash],
            )
            .unwrap()
        );
        assert_eq!(
            attachment_cache_path(profile_id, "attachment-1").unwrap(),
            storage::app_file_path(
                "desktop",
                StorageKind::Cache,
                &["messaging-cache", &profile_hash, "attachment-1"],
            )
            .unwrap()
        );
    }

    #[test]
    fn sender_attachment_source_is_atomically_promoted_to_durable_cache() {
        let root = std::env::temp_dir().join(format!("sender-cache-{}", Ulid::new()));
        let source_path = root.join("sources").join("attachment");
        let cache_path = root.join("cache").join("attachment-1");
        let bytes = b"verified sender attachment";
        std::fs::create_dir_all(source_path.parent().unwrap()).unwrap();
        std::fs::write(&source_path, bytes).unwrap();
        let expected: [u8; 32] = Sha256::digest(bytes).into();

        assert!(materialize_attachment_cache(&source_path, &cache_path, &expected).unwrap());

        assert!(!source_path.exists());
        assert_eq!(std::fs::read(&cache_path).unwrap(), bytes);
        assert_eq!(sha256_path(&cache_path).unwrap(), expected);
        assert!(!materialize_attachment_cache(&source_path, &cache_path, &expected).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_sender_attachment_cache_promotion_retains_source() {
        let root = std::env::temp_dir().join(format!("sender-cache-{}", Ulid::new()));
        let source_path = root.join("sources").join("attachment");
        let cache_path = root.join("cache").join("attachment-1");
        std::fs::create_dir_all(source_path.parent().unwrap()).unwrap();
        std::fs::write(&source_path, b"unexpected bytes").unwrap();

        let error = materialize_attachment_cache(&source_path, &cache_path, &[7; 32])
            .expect_err("hash mismatch must fail closed");

        assert_eq!(error, "messaging sender attachment source is invalid");
        assert!(source_path.is_file());
        assert!(!cache_path.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn native_attachment_file_is_copied_into_engine_managed_staging() {
        let profile_id = format!("native-picker-{}", Ulid::new());
        let engine = MessagingEngine::in_memory(profile_id.clone(), endpoint("device-a")).unwrap();
        let root = std::env::temp_dir().join(format!("native-picker-source-{}", Ulid::new()));
        let source_path = root.join("selected.png");
        let bytes = b"selected attachment bytes";
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&source_path, bytes).unwrap();

        let staged_path = engine
            .stage_attachment_file("selected.png", &source_path)
            .unwrap();
        let staged_path = PathBuf::from(staged_path);

        assert!(source_path.is_file());
        assert!(managed_attachment_source(&profile_id, &staged_path).unwrap());
        let canonical_staged_path = std::fs::canonicalize(&staged_path).unwrap();
        assert!(managed_attachment_source(&profile_id, &canonical_staged_path).unwrap());
        assert_eq!(std::fs::read(&staged_path).unwrap(), bytes);

        engine
            .discard_staged_attachment_source(&staged_path.display().to_string())
            .unwrap();
        assert!(!staged_path.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn background_attachment_resume_waits_for_active_send_intent() {
        let engine = Arc::new(
            MessagingEngine::in_memory(
                format!("attachment-resume-{}", Ulid::new()),
                endpoint("device-a"),
            )
            .unwrap(),
        );
        let send_guard = engine.send_intent_lock.lock().unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();
        let worker_engine = engine.clone();
        let handle = thread::spawn(move || {
            started_tx.send(()).unwrap();
            finished_tx
                .send(worker_engine.resume_attachment_upload_once("token", now_unix_ms()))
                .unwrap();
        });

        started_rx.recv().unwrap();
        assert!(finished_rx.recv_timeout(Duration::from_millis(50)).is_err());

        drop(send_guard);
        assert!(!finished_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap());
        handle.join().unwrap();
    }

    #[test]
    fn one_engine_exists_per_profile_and_endpoint() {
        let registry = EngineRegistry::default();
        let first = registry
            .activate_in_memory("alice-profile".to_string(), endpoint("device-1"))
            .unwrap();
        let repeated = registry
            .activate_in_memory("alice-profile".to_string(), endpoint("device-1"))
            .unwrap();
        assert!(Arc::ptr_eq(&first, &repeated));
        assert!(registry
            .activate_in_memory("alice-profile".to_string(), endpoint("device-2"))
            .is_err());

        let removed = registry.deactivate("alice-profile").unwrap().unwrap();
        assert!(Arc::ptr_eq(&first, &removed));
        let replacement = registry
            .activate_in_memory("alice-profile".to_string(), endpoint("device-2"))
            .unwrap();
        assert_eq!(replacement.endpoint(), &endpoint("device-2"));
    }

    #[test]
    fn engine_reopens_same_device_bound_mls_identity() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let first = MessagingEngine::from_store(
            "alice-profile".to_string(),
            endpoint("device-1"),
            store.clone(),
        )
        .unwrap();
        let first_identity = first
            .mls_manager()
            .actor_identity()
            .signing_identity()
            .unwrap();
        drop(first);

        let reopened = MessagingEngine::from_store(
            "alice-profile".to_string(),
            endpoint("device-1"),
            store.clone(),
        )
        .unwrap();
        assert_eq!(
            reopened
                .mls_manager()
                .actor_identity()
                .signing_identity()
                .unwrap(),
            first_identity
        );
        assert!(MessagingEngine::from_store(
            "alice-profile".to_string(),
            endpoint("device-2"),
            store,
        )
        .is_err());
    }

    #[test]
    fn engine_rehydrates_pending_mls_transition_after_restart() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let first = MessagingEngine::from_store(
            "alice-profile".to_string(),
            endpoint("alice-device"),
            store.clone(),
        )
        .unwrap();
        let bob = MlsGroupManager::new();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        let prepared = first
            .mls_manager()
            .create_group(
                "conversation-pending",
                &[MlsMemberKeyPackage {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                    key_package: bob.generate_key_package().unwrap(),
                }],
            )
            .unwrap();
        let pending_state = first
            .mls_manager()
            .export_pending_transition("conversation-pending")
            .unwrap();
        messaging_core::store::MlsTransitionRepository::persist_mls_transition(
            store.as_ref(),
            &messaging_core::store::MlsTransitionSendCommit {
                logical_intent_id: None,
                command_id: "command-pending",
                conversation_id: "conversation-pending",
                transition_id: &prepared.transition_id,
                delivery_plan_sha256: &[7; 32],
                command_bytes: b"command",
                pending_transition_state: &pending_state,
                created_at_unix_ms: 100,
            },
        )
        .unwrap();
        drop(first);

        let reopened = MessagingEngine::from_store(
            "alice-profile".to_string(),
            endpoint("alice-device"),
            store,
        )
        .unwrap();

        assert!(reopened
            .mls_manager()
            .has_pending_transition("conversation-pending"));
        assert_eq!(
            reopened
                .group_security_status("conversation-pending", 1)
                .unwrap(),
            "establishing"
        );
    }

    #[test]
    fn group_security_status_uses_profile_scoped_mls_manager() {
        let engine =
            MessagingEngine::in_memory("alice-profile".to_string(), endpoint("alice-device"))
                .unwrap();
        let bob = MlsGroupManager::new();
        bob.actor_identity().init("ptid:bob", "bob-device").unwrap();
        let created = engine
            .mls_manager()
            .create_group(
                "conversation-1",
                &[MlsMemberKeyPackage {
                    ptid: "ptid:bob".to_string(),
                    device_id: "bob-device".to_string(),
                    key_package: bob.generate_key_package().unwrap(),
                }],
            )
            .unwrap();

        assert_eq!(
            engine.group_security_status("conversation-1", 1).unwrap(),
            "establishing"
        );
        engine
            .mls_manager()
            .accept_pending_transition("conversation-1", &created.transition_id)
            .unwrap();
        assert_eq!(
            engine.group_security_status("conversation-1", 1).unwrap(),
            "active"
        );
        assert_eq!(
            engine.group_security_status("conversation-1", 2).unwrap(),
            "crypto_desynced"
        );
    }

    #[test]
    fn profile_engine_owns_stable_cross_signed_endpoint_identity() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        let first = MessagingEngine::from_profile_store(
            "alice-profile".to_string(),
            "ptid:alice".to_string(),
            &[17; 32],
            3,
            store.clone(),
        )
        .unwrap();
        let device_id = first.endpoint().device_id.clone();
        assert!(!device_id.is_empty());
        let pending = store.pending_device_enrollment().unwrap().unwrap();
        let pending_device = pending.certificate.device.as_ref().unwrap();
        assert_eq!(actor_device_ptid(pending_device).unwrap(), "ptid:alice");
        assert_eq!(pending_device.device_id, device_id);
        assert_eq!(pending.certificate.observed_profile_version, 3);
        drop(first);

        let reopened = MessagingEngine::from_profile_store(
            "alice-profile".to_string(),
            "ptid:alice".to_string(),
            &[17; 32],
            3,
            store.clone(),
        )
        .unwrap();
        assert_eq!(reopened.endpoint().device_id, device_id);
        drop(reopened);

        assert!(MessagingEngine::from_profile_store(
            "alice-profile".to_string(),
            "ptid:alice".to_string(),
            &[18; 32],
            3,
            store.clone(),
        )
        .is_err());
        assert!(MessagingEngine::from_profile_store(
            "alice-profile".to_string(),
            "ptid:alice".to_string(),
            &[17; 32],
            4,
            store,
        )
        .is_err());
    }

    #[test]
    fn restore_exclusive_ownership_rejection_keeps_profile_runtime_active() {
        let registry = EngineRegistry::default();
        let engine = Arc::new(
            MessagingEngine::from_profile_store(
                "alice-profile".to_string(),
                "ptid:alice".to_string(),
                &[17; 32],
                3,
                Arc::new(MessagingStore::in_memory().unwrap()),
            )
            .unwrap(),
        );
        registry
            .engines
            .lock()
            .unwrap()
            .insert("alice-profile".to_string(), engine.clone());
        registry
            .activate_profile_worker("alice-profile", "token-a".to_string())
            .unwrap();
        let archive = MessagingRecoveryArchive {
            ptid: "ptid:alice".to_string(),
            actor_identity_seed: [17; 32],
            actor_profile_version: 3,
            conversations: Vec::new(),
            messages: Vec::new(),
            retention_floors: Vec::new(),
            authority_heads: Vec::new(),
            redaction_tombstones: Vec::new(),
            attachments: Vec::new(),
            trust: Vec::new(),
        };

        assert!(registry
            .restore_profile(
                "alice-profile",
                &archive,
                &RecoveryReconciliation::default(),
            )
            .is_err());
        let registered = registry.get("alice-profile").unwrap().unwrap();
        assert!(Arc::ptr_eq(&engine, &registered));
        assert!(registry.wake_profile("alice-profile").is_ok());
        registry.deactivate("alice-profile").unwrap();
    }

    #[test]
    fn profile_worker_token_can_be_restored_without_removing_engine() {
        let registry = EngineRegistry::default();
        let engine = Arc::new(
            MessagingEngine::from_profile_store(
                "alice-profile".to_string(),
                "ptid:alice".to_string(),
                &[17; 32],
                3,
                Arc::new(MessagingStore::in_memory().unwrap()),
            )
            .unwrap(),
        );
        registry
            .engines
            .lock()
            .unwrap()
            .insert("alice-profile".to_string(), engine.clone());
        registry
            .activate_profile_worker("alice-profile", "token-old".to_string())
            .unwrap();
        registry
            .activate_profile_worker("alice-profile", "token-new".to_string())
            .unwrap();
        assert_eq!(
            registry.profile_worker_token("alice-profile").unwrap(),
            Some("token-new".to_string())
        );

        registry
            .activate_profile_worker("alice-profile", "token-old".to_string())
            .unwrap();
        assert_eq!(
            registry.profile_worker_token("alice-profile").unwrap(),
            Some("token-old".to_string())
        );
        registry.deactivate_profile_worker("alice-profile").unwrap();
        assert_eq!(
            registry.profile_worker_token("alice-profile").unwrap(),
            None
        );
        assert!(Arc::ptr_eq(
            &engine,
            &registry.get("alice-profile").unwrap().unwrap()
        ));
        registry.deactivate("alice-profile").unwrap();
    }

    #[test]
    fn terminated_profile_worker_is_restarted_before_activation_succeeds() {
        let registry = EngineRegistry::default();
        let engine = Arc::new(
            MessagingEngine::from_profile_store(
                "alice-profile".to_string(),
                "ptid:alice".to_string(),
                &[17; 32],
                3,
                Arc::new(MessagingStore::in_memory().unwrap()),
            )
            .unwrap(),
        );
        registry
            .engines
            .lock()
            .unwrap()
            .insert("alice-profile".to_string(), engine);
        registry
            .activate_profile_worker("alice-profile", "token-old".to_string())
            .unwrap();
        registry
            .workers
            .lock()
            .unwrap()
            .get_mut("alice-profile")
            .unwrap()
            .terminate_for_test()
            .unwrap();

        assert_eq!(
            registry.profile_worker_token("alice-profile").unwrap(),
            None
        );
        registry
            .activate_profile_worker("alice-profile", "token-new".to_string())
            .unwrap();
        assert_eq!(
            registry.profile_worker_token("alice-profile").unwrap(),
            Some("token-new".to_string())
        );
        registry.deactivate("alice-profile").unwrap();
    }
}
