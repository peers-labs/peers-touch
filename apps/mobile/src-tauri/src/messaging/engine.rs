use std::collections::HashMap;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use messaging_core::attachment::{
    AttachmentCryptoMaterial, AttachmentRetryPolicy, AttachmentTransferControl,
    AttachmentTransferRecord, AttachmentTransferWorker, ATTACHMENT_MAX_PLAINTEXT_SIZE,
};
use messaging_core::contracts::{
    CommandStatusProjection, ConversationMessageProjection, ConversationProjection,
    CryptoEndpoint as CoreCryptoEndpoint,
};
use messaging_core::crypto::identity::IdentityKeyPair;
use messaging_core::crypto::prekeys::PreKeyPublisher;
use messaging_core::identity::{
    is_stale_endpoint_error, load_or_create_device_identity, DeviceEnrollmentManager,
    INITIAL_ACTOR_IDENTITY_PROFILE_VERSION,
};
use messaging_core::inbox::{
    AcknowledgedItemObserver, ClaimedItemConsumer, ConversationStateProcessor,
    DeliveryReceiptProcessor, DirectMessageProcessor, DrainProgress, MessagingItemConsumer,
    MlsItemConsumer, PublicEventProcessor, QueueDrain,
};
use messaging_core::mls::actor_device_identity::ActorDeviceIdentity;
use messaging_core::mls::group::MlsGroupManager;
use messaging_core::mls::group_genesis::GroupGenesisPreparer;
use messaging_core::mls::key_packages::MlsKeyPackagePublisher;
use messaging_core::mls::outbound::{
    GroupEditTextIntent, GroupSendTextIntent, MlsOutboundPreparer,
};
use messaging_core::mls::startup::restore_persisted_mls_state;
use messaging_core::mls::{
    MlsApplicationProcessor, MlsRetirementProcessor, MlsSenderTransitionProcessor,
    MlsTransitionProcessor,
};
use messaging_core::outbox::{
    CommandDispatchProgress, CommandOutboxWorker, CommandRetryPolicy, DeliveryReceiptRepository,
    DirectEditIntent, DirectOutboundPreparer, DirectSendIntent, DirectSessionBootstrapper,
    MetadataInteraction, MetadataInteractionPreparer,
};
use messaging_core::ports::AttachmentBlob;
use messaging_core::proto::actor::{ActorDevice, ActorDeviceRef, ActorRef};
use messaging_core::proto::chat::{
    chat_command, ActorReadCursor, AttachmentTransferState, ChatCommand, ConversationKind,
    CryptoEndpoint, DeviceConsumptionReceipt, DurableDeviceInboxItem,
    PrepareConversationCommandRequest, PrepareConversationCommandResponse,
    SubmitConversationReadCursorRequest, SubmitConversationTypingRequest,
};
use messaging_core::store::MessagingRepository;
use prost::Message;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};
use ulid::Ulid;
use zeroize::Zeroizing;

use super::adapter::{
    AttachmentDownloadProjection, CompletedSenderAttachmentSource, MobileMessagingStore,
    MobileOutboxStore, PendingAttachmentUpload, PendingMessageDraft,
};
use super::attachment_blob::FilesystemAttachmentBlob;
use super::transport::{
    StationAttachmentTransferTransport, StationCommandTransport, StationConversationTransport,
    StationDeliveryReceiptTransport, StationDeviceTransport, StationKeyBundleTransport,
    StationMlsKeyPackageTransport, StationPreKeyTransport, StationQueueTransport,
};

const DRAIN_BATCH_LIMIT: u32 = 100;
pub const ATTACHMENT_STAGE_CHUNK_SIZE: usize = 1024 * 1024;
const TYPING_PULSE_TTL_MS: i64 = 6_000;
const COMMAND_RETRY_POLICY: CommandRetryPolicy = CommandRetryPolicy {
    initial_delay_ms: 1_000,
    maximum_delay_ms: 60_000,
};

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
pub struct MessagingAttachmentStage {
    pub stage_id: String,
    pub filename: String,
    pub mime_type: String,
    pub plaintext_size: u64,
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
    let origin = reqwest::Url::parse(station_origin)
        .map_err(|_| "mobile messaging Station origin is invalid".to_string())?;
    let host = origin
        .host_str()
        .ok_or_else(|| "mobile messaging Station origin has no host".to_string())?;
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if (origin.scheme() != "https" && !(cfg!(debug_assertions) && loopback))
        || !origin.username().is_empty()
        || origin.password().is_some()
        || origin.query().is_some()
        || origin.fragment().is_some()
        || origin.path() != "/"
    {
        return Err("mobile messaging Station origin is not canonical".to_string());
    }
    Ok(())
}

struct MobileMlsItemConsumer {
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

type CoreItemConsumer = MessagingItemConsumer<MobileMessagingStore, MobileMlsItemConsumer>;

pub struct MobileMessagingEngine {
    profile_id: String,
    scope: MessagingAccountScope,
    store: Arc<MobileMessagingStore>,
    attachment_root: PathBuf,
    attachment_stages: Mutex<HashMap<String, StagedAttachment>>,
    attachment_source_lock: Mutex<()>,
    attachment_transfer_control: Arc<AttachmentTransferControl>,
    actor_identity: Arc<IdentityKeyPair>,
    mls_manager: Arc<MlsGroupManager>,
    consumer: Arc<CoreItemConsumer>,
    consumer_id: String,
    consumer_epoch: AtomicU64,
    typing_pulse_generation: AtomicU64,
    drain_lock: Mutex<()>,
    dispatch_lock: Mutex<()>,
    send_intent_lock: Mutex<()>,
    access_token: Mutex<Zeroizing<String>>,
}

impl MobileMessagingEngine {
    pub fn open(
        database_path: &Path,
        profile_id: String,
        station_peer_id: String,
        station_origin: String,
        actor_ptid: String,
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
        let enrollment = load_or_create_device_identity(
            store.as_ref(),
            &actor_ptid,
            *actor_identity_seed,
            INITIAL_ACTOR_IDENTITY_PROFILE_VERSION,
        )?;
        let enrolled_device = enrollment
            .certificate
            .device
            .as_ref()
            .ok_or_else(|| "mobile messaging device certificate has no device".to_string())?;
        if enrolled_device
            .actor
            .as_ref()
            .map(|actor| actor.ptid.as_str())
            != Some(actor_ptid.as_str())
        {
            return Err("mobile messaging device certificate actor mismatch".to_string());
        }
        let scope = MessagingAccountScope {
            station_peer_id,
            station_origin,
            actor_ptid,
            device_id: enrolled_device.device_id.clone(),
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
        let consumer = Arc::new(MessagingItemConsumer::new(
            direct,
            mls,
            PublicEventProcessor::new(store.clone(), endpoint.clone(), now_unix_ms)?,
            ConversationStateProcessor::new(store.clone(), endpoint.clone(), now_unix_ms)?,
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
            attachment_transfer_control: Arc::new(AttachmentTransferControl::new()),
            actor_identity,
            mls_manager,
            consumer,
            consumer_id,
            consumer_epoch: AtomicU64::new(0),
            typing_pulse_generation: AtomicU64::new(
                u64::try_from(now_unix_ms()).unwrap_or_default(),
            ),
            drain_lock: Mutex::new(()),
            dispatch_lock: Mutex::new(()),
            send_intent_lock: Mutex::new(()),
            access_token: Mutex::new(Zeroizing::new(access_token)),
        })
    }

    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    pub fn scope(&self) -> &MessagingAccountScope {
        &self.scope
    }

    pub fn conversations(&self) -> Result<Vec<ConversationProjection>, String> {
        self.store.conversation_projections()
    }

    pub fn create_direct_conversation(&self, peer_ptid: &str) -> Result<String, String> {
        let result = self.try_create_direct_conversation(peer_ptid);
        match result {
            Ok(conversation_id) => Ok(conversation_id),
            Err(error) if is_stale_endpoint_error(&error) => {
                log::warn!(
                    "mobile messaging direct creation found stale enrollment; attempting recovery"
                );
                let _ = self.recover_stale_enrollment(&error);
                self.enroll_pending_device()?;
                self.try_create_direct_conversation(peer_ptid)
            }
            Err(error) => Err(error),
        }
    }

    fn try_create_direct_conversation(&self, peer_ptid: &str) -> Result<String, String> {
        let response = StationConversationTransport::new(
            self.scope.station_origin.clone(),
            self.access_token()?,
            self.scope.device_id.clone(),
            self.proto_endpoint(),
        )?
        .create_direct(peer_ptid)?;
        response
            .conversation
            .map(|conversation| conversation.conversation_id)
            .filter(|conversation_id| !conversation_id.trim().is_empty())
            .ok_or_else(|| "mobile messaging Station returned no direct conversation".to_string())
    }

    pub fn create_group_conversation(
        &self,
        conversation_id: &str,
        name: &str,
        member_ptids: &[String],
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
        .prepare_group_genesis(conversation_id, name, member_ptids)?;
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

    pub fn conversation_messages(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationMessageProjection>, String> {
        self.store.conversation_message_projections(conversation_id)
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
                    &crypto_endpoints(&plan.required_endpoints)?,
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

    fn create_attachment_message_draft(
        &self,
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
                message_id: message_id.clone(),
                sender_ptid: self.scope.actor_ptid.clone(),
                sender_device_id: self.scope.device_id.clone(),
                plaintext: plaintext.to_string(),
                reply_to_message_id: reply_to_message_id.to_string(),
                thread_root_message_id: thread_root_message_id.to_string(),
                attachments: Vec::new(),
                attempt_count: 0,
                created_at_unix_ms,
            },
            &uploads,
        )?;
        for stage_id in attachment_stage_ids {
            stages.remove(stage_id);
        }
        Ok(MessagingSubmitMessageOutcome {
            command_id: None,
            message_id,
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
        let plan = self.prepare_send_plan(&token, conversation_id)?;
        let command_id = Ulid::new().to_string();
        self.prepare_metadata_with_plan(
            &plan,
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
                    &crypto_endpoints(&plan.required_endpoints)?,
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
        command_id: &str,
        message_id: &str,
        interaction: MetadataInteraction<'_>,
        created_at_unix_ms: i64,
    ) -> Result<(), String> {
        MetadataInteractionPreparer::new(self.store.clone(), self.proto_endpoint())?.prepare(
            plan,
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
        let now = now_unix_ms();
        let pulse_generation = self
            .typing_pulse_generation
            .fetch_add(1, Ordering::AcqRel)
            .checked_add(1)
            .ok_or_else(|| "mobile messaging typing pulse generation overflow".to_string())?;
        let token = self.access_token()?;
        StationCommandTransport::new(
            self.scope.station_origin.clone(),
            token,
            self.scope.device_id.clone(),
        )?
        .submit_typing(&SubmitConversationTypingRequest {
            conversation_id: conversation_id.to_string(),
            sender: Some(self.actor_device_ref()),
            pulse_generation,
            expires_at: Some(timestamp(now.saturating_add(TYPING_PULSE_TTL_MS))),
            is_typing,
        })
    }

    pub(crate) fn store(&self) -> &MobileMessagingStore {
        self.store.as_ref()
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
        self.consumer.consume(item, consumer_epoch)
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
            self.actor_device_ref(),
            self.consumer_id.clone(),
            DRAIN_BATCH_LIMIT,
        )?;
        if let Some(observer) = observer {
            drain = drain.with_acknowledged_item_observer(observer);
        }
        let progress = drain.drain_once(cursor, expected_epoch)?;
        self.consumer_epoch
            .store(progress.consumer_epoch, Ordering::Release);
        Ok(progress)
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
        let progress = CommandOutboxWorker::new(
            MobileOutboxStore(self.store.clone()),
            StationCommandTransport::new(
                self.scope.station_origin.clone(),
                token,
                self.scope.device_id.clone(),
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
        self.attachment_transfer_worker()?
            .run_upload_once(&attachment_id, now_unix_ms)?;
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
        self.attachment_transfer_worker()?.run_download_once(
            &attachment_id,
            descriptor,
            &plaintext_sha256,
            &cache_ref,
            now_unix_ms,
        )?;
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
        let token = self.access_token()?;
        let plan = self.prepare_send_plan(&token, &draft.conversation_id)?;
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
                    &crypto_endpoints(&plan.required_endpoints)?,
                    draft.created_at_unix_ms,
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
                        message_id: &draft.message_id,
                        conversation_id: &draft.conversation_id,
                        plaintext: &draft.plaintext,
                        reply_to_message_id: &draft.reply_to_message_id,
                        thread_root_message_id: &draft.thread_root_message_id,
                        attachments: &draft.attachments,
                        client_timestamp_unix_ms: draft.created_at_unix_ms,
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
                        message_id: &draft.message_id,
                        conversation_id: &draft.conversation_id,
                        plaintext: &draft.plaintext,
                        reply_to_message_id: &draft.reply_to_message_id,
                        thread_root_message_id: &draft.thread_root_message_id,
                        attachments: &draft.attachments,
                        client_timestamp_unix_ms: draft.created_at_unix_ms,
                    },
                )?;
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
        let Some(entry) = DeliveryReceiptRepository::next_delivery_receipt(self.store.as_ref())?
        else {
            return Ok(false);
        };
        let receipt = DeviceConsumptionReceipt::decode(entry.receipt_bytes.as_slice())
            .map_err(|error| format!("decode mobile messaging consumption receipt: {error}"))?;
        let token = self.access_token()?;
        StationDeliveryReceiptTransport::new(
            self.scope.station_origin.clone(),
            token,
            self.scope.device_id.clone(),
        )?
        .submit(&receipt)?;
        DeliveryReceiptRepository::mark_delivery_receipt_submitted(
            self.store.as_ref(),
            &entry.receipt_id,
            &entry.receipt_bytes,
        )?;
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
    ) -> Result<PrepareConversationCommandResponse, String> {
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
            sender: Some(self.actor_device_ref()),
            authority_station_peer_id: authority_station_id,
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

    fn actor_device_ref(&self) -> ActorDeviceRef {
        ActorDeviceRef {
            actor: Some(ActorRef {
                ptid: self.scope.actor_ptid.clone(),
                ..Default::default()
            }),
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
    })
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

fn crypto_endpoints(devices: &[ActorDeviceRef]) -> Result<Vec<CryptoEndpoint>, String> {
    devices
        .iter()
        .map(|device| {
            let actor = device.actor.as_ref().ok_or_else(|| {
                "mobile messaging canonical device endpoint has no actor".to_string()
            })?;
            if actor.ptid.trim().is_empty() || device.device_id.trim().is_empty() {
                return Err("mobile messaging canonical device endpoint is incomplete".to_string());
            }
            Ok(CryptoEndpoint {
                ptid: actor.ptid.clone(),
                device_id: device.device_id.clone(),
            })
        })
        .collect()
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
            &[7; 32],
            [8; 32],
            "token".to_string(),
        )
        .unwrap();
        (engine, root)
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
    fn attachment_stage_requires_bounded_contiguous_chunks() {
        let (engine, root) = test_engine("attachment-stage");
        let stage = engine
            .begin_attachment_stage("sample.txt", "text/plain", 6)
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
}
