use super::identity::{
    generate_fresh_device_identity, validate_enrollment_actor, FreshDeviceEnrollment,
};
use super::recovery::{restore_profile_database_atomically, MessagingRecoveryArchive};
use super::store::CompletedSenderAttachmentSource;
use super::{
    AttachmentCryptoMaterial, AttachmentDownloadProjection, AttachmentRetryPolicy,
    AttachmentTransferControl, AttachmentTransferProgress, AttachmentTransferRecord,
    AttachmentTransferWorker, CommandDispatchProgress, CommandOutboxWorker, CommandRetryPolicy,
    ConversationMessageProjection, ConversationProjection, DirectSessionBootstrapper,
    DrainProgress, EditTextIntent, GroupGenesisPreparer, InteractionCommandCommit,
    MembershipTransitionIntentInput, MembershipTransitionPreparer, MessagingItemConsumer,
    MessagingLifecycleWorker, MessagingStore, MlsKeyPackagePublisher, PendingAttachmentUpload,
    PendingMembershipIntent, PendingMessageDraft, PreKeyPublisher, QueueDrain, SendPreparer,
    SendTextIntent, StationAttachmentTransferTransport, StationCommandTransport,
    StationDeliveryReceiptTransport, StationDeviceTransport, StationGroupGenesisTransport,
    StationKeyBundleTransport, StationMembershipTransitionTransport, StationMlsKeyPackageTransport,
    StationPreKeyTransport, StationQueueTransport,
};
use crate::domain::actor_device_identity::ActorDeviceIdentity;
use crate::domain::crypto::IdentityKeyPair;
use crate::domain::mls_group::MlsGroupManager;
use crate::model::chat::{
    chat_command, ActorReadCursor, AttachmentTransferState, ChatCommand, ConversationCommand,
    ConversationKind, CreateMessagingDirectConversationRequest,
    CreateMessagingDirectConversationResponse, CryptoEndpoint, EnrollMessagingDeviceRequest,
    MessageReceipt, MessagingDevice, MessagingDeviceStatus, MessagingMembershipAction,
    MessagingReceiptKind, PinMessageIntent, PrepareMessagingSendRequest,
    PrepareMessagingSendResponse, ReactionIntent, ReceiptType, RetractMessageIntent,
    SubmitMessagingReceiptRequest, SubmitMessagingReceiptResponse, TypingCommand,
};
use prost::Message;
use reqwest::Method;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use ulid::Ulid;

const INTERACTION_PREFLIGHT_DRAIN_LIMIT: u32 = 100;
const ATTACHMENT_OPEN_TIMEOUT: Duration = Duration::from_secs(30);
const ATTACHMENT_OPEN_RETRY_FLOOR: Duration = Duration::from_millis(10);
const SENDER_ATTACHMENT_SOURCE_INVALID: &str = "messaging sender attachment source is invalid";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessagingProjectionChange {
    pub profile_id: String,
    pub conversation_id: String,
    pub event_id: String,
    pub lane_sequence: i64,
}

pub enum MetadataInteraction<'a> {
    Retract,
    Reaction { reaction: &'a str, remove: bool },
    Pin { remove: bool },
}

pub type MessagingProjectionNotifier = Arc<dyn Fn(MessagingProjectionChange) + Send + Sync>;

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
pub struct PreparedGroupConversation {
    pub conversation_id: String,
    pub command_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalAttachmentIntent {
    pub source_local_ref: String,
    pub filename: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum AttachmentOpenProgress {
    Ready(String),
    Pending { next_attempt_at_unix_ms: i64 },
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
    attachment_source_lock: Mutex<()>,
    attachment_transfer_control: Arc<AttachmentTransferControl>,
    runtime_consumer_epoch: Arc<AtomicU64>,
    projection_notifier: Mutex<Option<MessagingProjectionNotifier>>,
}

fn is_stale_endpoint_error(error: &str) -> bool {
    if error.contains("endpoint is not active") {
        return true;
    }
    if error.contains("station returned 403") {
        return true;
    }
    false
}

impl MessagingEngine {
    pub fn open_profile(
        profile_id: String,
        ptid: String,
        actor_identity_seed: [u8; 32],
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
        actor_identity_seed: [u8; 32],
        actor_profile_version: u64,
        store: Arc<MessagingStore>,
    ) -> Result<Self, String> {
        let enrollment = match store.device_enrollment()? {
            Some(enrollment) => {
                validate_enrollment_actor(
                    &enrollment,
                    &ptid,
                    actor_identity_seed,
                    actor_profile_version,
                )?;
                enrollment
            }
            None => {
                let identity = generate_fresh_device_identity(
                    &ptid,
                    actor_identity_seed,
                    actor_profile_version,
                )?;
                store.install_fresh_device_identity(&identity)?;
                identity.enrollment
            }
        };
        let endpoint = EngineEndpoint {
            ptid,
            device_id: enrollment.certificate.device_id,
        };
        Self::from_store_with_identity(
            profile_id,
            endpoint,
            store,
            Some(Arc::new(IdentityKeyPair::from_seed(&actor_identity_seed))),
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
        for (conversation_id, session_state) in store.list_mls_session_states()? {
            mls_manager.import_session_state(&conversation_id, &session_state)?;
        }
        if let Some(provider_pool) = store.load_mls_join_provider_pool()? {
            mls_manager.import_pending_join_providers(&provider_pool)?;
        }
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
            attachment_source_lock: Mutex::new(()),
            attachment_transfer_control: Arc::new(AttachmentTransferControl::new()),
            runtime_consumer_epoch: Arc::new(AtomicU64::new(0)),
            projection_notifier: Mutex::new(None),
        })
    }

    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    pub fn endpoint(&self) -> &EngineEndpoint {
        &self.endpoint
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
            || plaintext_size > super::attachment::ATTACHMENT_MAX_PLAINTEXT_SIZE
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
        let worker = self.attachment_transfer_worker(token.to_string())?;
        match worker.run_download_once(
            attachment_id,
            object,
            &expected_plaintext_sha256,
            &cache_path,
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
        let actor_identity_seed = self
            .actor_identity
            .as_ref()
            .ok_or_else(|| "messaging profile actor identity is unavailable".to_string())?
            .seed_bytes();
        self.store.build_recovery_archive(
            &self.endpoint.ptid,
            actor_identity_seed,
            actor_profile_version,
        )
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
        let (cursor, _) = self.store.lane_checkpoint()?;
        let consumer_epoch = self.runtime_consumer_epoch.load(Ordering::Acquire);
        let transport =
            StationQueueTransport::new(token.to_string(), self.endpoint.device_id.clone())?;
        let mut drain = QueueDrain::new(
            transport,
            self.consumer.clone(),
            self.endpoint.device_id.clone(),
            self.consumer_id.clone(),
            batch_limit,
        )?;
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
            drain = drain.with_acknowledged_item_observer(Arc::new(move |item| {
                notifier(MessagingProjectionChange {
                    profile_id: profile_id.clone(),
                    conversation_id: item.conversation_id.clone(),
                    event_id: item.event_id.clone(),
                    lane_sequence: item.lane_sequence,
                });
            }));
        }
        drain.drain_once(cursor, consumer_epoch)
    }

    pub fn dispatch_delivery_receipt_once(&self, token: &str) -> Result<bool, String> {
        let Some(entry) = self.store.next_delivery_receipt()? else {
            return Ok(false);
        };
        let receipt = MessageReceipt::decode(entry.receipt_bytes.as_slice())
            .map_err(|error| format!("decode messaging delivery receipt: {error}"))?;
        if receipt.receipt_type != ReceiptType::Delivered as i32 {
            return Err("messaging delivery receipt has invalid type".to_string());
        }
        StationDeliveryReceiptTransport::new(token.to_string(), self.endpoint.device_id.clone())?
            .submit(&receipt)?;
        self.store
            .mark_delivery_receipt_submitted(&entry.receipt_id, &entry.receipt_bytes)?;
        tracing::info!(
            message_id = %receipt.message_id,
            receipt_type = receipt.receipt_type,
            "messaging delivery receipt submitted"
        );
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
        let progress = CommandOutboxWorker::new(
            self.store.clone(),
            StationCommandTransport::new(token.to_string(), self.endpoint.device_id.clone())?,
            retry_policy,
        )?
        .dispatch_once(now_unix_ms)?;
        if matches!(progress, CommandDispatchProgress::StaleAuthorityPlan { .. }) {
            for intent in self.store.pending_membership_intents()? {
                self.mls_manager
                    .discard_pending_transition(&intent.conversation_id);
            }
        }
        Ok(progress)
    }

    pub fn prepare_send_plan(
        &self,
        token: &str,
        conversation_id: &str,
    ) -> Result<PrepareMessagingSendResponse, String> {
        if conversation_id.trim().is_empty() {
            return Err("messaging send plan requires conversation ID".to_string());
        }
        let authority_station_id = self
            .store
            .conversation_authority_station_id(conversation_id)?;
        StationCommandTransport::new(token.to_string(), self.endpoint.device_id.clone())?
            .prepare_send(&PrepareMessagingSendRequest {
                conversation_id: conversation_id.to_string(),
                sender: Some(CryptoEndpoint {
                    ptid: self.endpoint.ptid.clone(),
                    device_id: self.endpoint.device_id.clone(),
                }),
                authority_station_id,
            })
    }

    pub fn prepare_direct_text(
        &self,
        plan: &PrepareMessagingSendResponse,
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
        plan: &PrepareMessagingSendResponse,
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
        plan: &PrepareMessagingSendResponse,
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
        if aggregate_plaintext_size > super::attachment::ATTACHMENT_MAX_PLAINTEXT_SIZE {
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
            Err(_) => {
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
        if self.prepare_message_draft(token, &draft).is_err() {
            self.schedule_message_draft_retry(&draft, now_unix_ms)?;
        }
        Ok(true)
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
                    self.endpoint.clone(),
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

    pub fn create_direct_conversation(
        &self,
        token: &str,
        peer_ptid: &str,
    ) -> Result<String, String> {
        if peer_ptid.trim().is_empty() || peer_ptid == self.endpoint.ptid {
            return Err("messaging direct peer identity is invalid".to_string());
        }
        let result = self.try_create_direct_conversation(token, peer_ptid);
        match result {
            Ok(id) => Ok(id),
            Err(error) if is_stale_endpoint_error(&error) => {
                tracing::warn!(error = %error, "createDirect: device not active, attempting re-enrollment");
                let _ = self.recover_stale_enrollment(&error);
                self.enroll_pending_device(token, "Desktop".to_string())?;
                self.try_create_direct_conversation(token, peer_ptid)
            }
            Err(error) => Err(error),
        }
    }

    fn try_create_direct_conversation(
        &self,
        token: &str,
        peer_ptid: &str,
    ) -> Result<String, String> {
        let response = crate::infrastructure::station_client::request_proto_for_device::<
            CreateMessagingDirectConversationRequest,
            CreateMessagingDirectConversationResponse,
        >(
            Method::POST,
            "/messaging/conversation/direct",
            token,
            None,
            Some(&CreateMessagingDirectConversationRequest {
                peer_ptid: peer_ptid.to_string(),
                creator: Some(CryptoEndpoint {
                    ptid: self.endpoint.ptid.clone(),
                    device_id: self.endpoint.device_id.clone(),
                }),
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
        let plan = self.prepare_send_plan(token, conversation_id)?;
        let conversation_kind = ConversationKind::try_from(plan.conversation_kind)
            .map_err(|_| "messaging edit conversation kind is invalid".to_string())?;
        let command_id = Ulid::new().to_string();
        let now = now_unix_ms();
        let intent = EditTextIntent {
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
                    self.endpoint.clone(),
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
        let (projection, _) = self
            .store
            .message_projection(conversation_id, message_id)?
            .ok_or_else(|| "messaging interaction target projection is unavailable".to_string())?;
        if matches!(interaction, MetadataInteraction::Retract)
            && projection.sender_ptid != self.endpoint.ptid
        {
            return Err("messaging retract target is not authored by this actor".to_string());
        }
        let plan = self.prepare_send_plan(token, conversation_id)?;
        let (local_sequence, local_hash) = self.store.authority_head(conversation_id)?;
        if local_sequence != plan.authority_sequence || local_hash != plan.authority_hash {
            return Err("messaging local authority head is behind interaction plan".to_string());
        }
        let (payload, interaction_kind) = match interaction {
            MetadataInteraction::Retract => (
                chat_command::Payload::RetractMessage(RetractMessageIntent {
                    message_id: message_id.to_string(),
                }),
                "retract",
            ),
            MetadataInteraction::Reaction { reaction, remove } => {
                if reaction.trim().is_empty() {
                    return Err("messaging reaction value is required".to_string());
                }
                (
                    chat_command::Payload::Reaction(ReactionIntent {
                        message_id: message_id.to_string(),
                        reaction: reaction.to_string(),
                        remove,
                    }),
                    if remove {
                        "reaction-remove"
                    } else {
                        "reaction-add"
                    },
                )
            }
            MetadataInteraction::Pin { remove } => (
                chat_command::Payload::PinMessage(PinMessageIntent {
                    message_id: message_id.to_string(),
                    remove,
                }),
                if remove { "unpin" } else { "pin" },
            ),
        };
        let command_id = Ulid::new().to_string();
        let now = now_unix_ms();
        let command = ChatCommand {
            command_id: command_id.clone(),
            conversation_id: conversation_id.to_string(),
            sender: Some(CryptoEndpoint {
                ptid: self.endpoint.ptid.clone(),
                device_id: self.endpoint.device_id.clone(),
            }),
            observed_membership_epoch: plan.membership_epoch,
            observed_mls_epoch: plan.mls_epoch,
            client_timestamp: Some(prost_types::Timestamp {
                seconds: now.div_euclid(1_000),
                nanos: (now.rem_euclid(1_000) * 1_000_000) as i32,
            }),
            delivery_plan_sha256: plan.delivery_plan_sha256.clone(),
            authority_station_id: plan.authority_station_id,
            payload: Some(payload),
        };
        let command_bytes = command.encode_to_vec();
        self.store
            .persist_interaction_command(&InteractionCommandCommit {
                command_id: &command_id,
                conversation_id,
                target_message_id: message_id,
                interaction_kind,
                edited_text: None,
                command_bytes: &command_bytes,
                delivery_plan_sha256: &plan.delivery_plan_sha256,
                created_at_unix_ms: now,
            })?;
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
        crate::infrastructure::station_client::request_proto_for_device::<
            ConversationCommand,
            SubmitMessagingReceiptResponse,
        >(
            Method::POST,
            "/messaging/typing/submit",
            token,
            None,
            Some(&ConversationCommand {
                command_id: Ulid::new().to_string(),
                conversation_id: conversation_id.to_string(),
                sender_ptid: self.endpoint.ptid.clone(),
                sender_device_id: self.endpoint.device_id.clone(),
                client_ts: Some(prost_types::Timestamp {
                    seconds: now.div_euclid(1_000),
                    nanos: (now.rem_euclid(1_000) * 1_000_000) as i32,
                }),
                payload: Some(crate::model::chat::conversation_command::Payload::Typing(
                    TypingCommand { is_typing },
                )),
                ..Default::default()
            }),
            &self.endpoint.device_id,
        )
        .map_err(|error| error.to_string())?;
        Ok(())
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
            SubmitMessagingReceiptRequest,
            SubmitMessagingReceiptResponse,
        >(
            Method::POST,
            "/messaging/receipt/submit",
            token,
            None,
            Some(&SubmitMessagingReceiptRequest {
                kind: MessagingReceiptKind::ActorRead as i32,
                device_consumed: None,
                actor_read: Some(ActorReadCursor {
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
    ) -> Result<PreparedGroupConversation, String> {
        let transport =
            StationGroupGenesisTransport::new(token.to_string(), self.endpoint.clone())?;
        let plan = transport.prepare(conversation_id, name, member_ptids)?;
        let command = GroupGenesisPreparer::new(
            self.store.clone(),
            self.mls_manager.clone(),
            self.endpoint.clone(),
        )?
        .prepare(&plan, conversation_id, now_unix_ms())?;
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
            self.endpoint.clone(),
        )?
        .prepare(&intent_id, input, &plan, created_at_unix_ms)
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
        };
        let transport =
            StationMembershipTransitionTransport::new(token.to_string(), self.endpoint.clone())?;
        let plan = transport.prepare(&input)?;
        MembershipTransitionPreparer::new(
            self.store.clone(),
            self.mls_manager.clone(),
            self.endpoint.clone(),
        )?
        .prepare(&intent.intent_id, &input, &plan, now_unix_ms())?;
        Ok(true)
    }

    pub fn enroll_pending_device(
        &self,
        token: &str,
        label: String,
    ) -> Result<Option<MessagingDevice>, String> {
        let Some(enrollment) = self.store.pending_device_enrollment()? else {
            return Ok(None);
        };
        let certificate = &enrollment.certificate;
        if certificate.ptid != self.endpoint.ptid
            || certificate.device_id != self.endpoint.device_id
        {
            return Err("messaging pending enrollment belongs to another endpoint".to_string());
        }
        let transport =
            StationDeviceTransport::new(token.to_string(), self.endpoint.device_id.clone())?;
        let response = transport.enroll(&EnrollMessagingDeviceRequest {
            certificate: Some(certificate.clone()),
            label,
            actor_cross_signature: enrollment.actor_cross_signature.to_vec(),
        })?;
        let device = response
            .device
            .ok_or_else(|| "messaging enrollment response has no device".to_string())?;
        if MessagingDeviceStatus::try_from(device.status)
            .map_err(|_| "messaging enrollment response status is invalid".to_string())?
            != MessagingDeviceStatus::Active
            || device
                .endpoint
                .as_ref()
                .map(|endpoint| endpoint.ptid.as_str())
                != Some(self.endpoint.ptid.as_str())
            || device
                .endpoint
                .as_ref()
                .map(|endpoint| endpoint.device_id.as_str())
                != Some(self.endpoint.device_id.as_str())
            || device.signing_key_id != certificate.signing_key_id
            || device.profile_version != certificate.observed_profile_version
            || device.actor_identity_key_fingerprint != certificate.actor_identity_key_fingerprint
        {
            return Err("messaging enrollment response binding mismatch".to_string());
        }
        self.store
            .complete_device_enrollment(&self.endpoint.device_id)?;
        Ok(Some(device))
    }

    pub fn recover_stale_enrollment(&self, error: &str) -> bool {
        if !is_stale_endpoint_error(error) {
            return false;
        }
        match self.store.reset_device_enrollment() {
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
        let actor_identity = self
            .actor_identity
            .as_ref()
            .ok_or_else(|| "messaging profile actor identity is unavailable".to_string())?;
        PreKeyPublisher::new(self.store.clone(), self.endpoint.clone())?.publish(
            actor_identity.as_ref(),
            now_unix_ms(),
            &StationPreKeyTransport::new(token.to_string(), self.endpoint.device_id.clone())?,
        )
    }

    pub fn publish_mls_key_packages(&self, token: &str) -> Result<(), String> {
        MlsKeyPackagePublisher::new(
            self.store.clone(),
            self.mls_manager.clone(),
            self.endpoint.clone(),
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
        if !self.store.conversation_projections()?.is_empty() {
            return Ok(0);
        }
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

    pub fn activate_profile(
        &self,
        profile_id: String,
        ptid: String,
        actor_identity_seed: [u8; 32],
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
            return worker.refresh_token(token);
        }
        workers.insert(
            profile_id.to_string(),
            MessagingLifecycleWorker::start(engine, token)?,
        );
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
    ) -> Result<FreshDeviceEnrollment, String> {
        let (previous_ptid, previous_seed, previous_profile_version) = {
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
            let previous_seed = engine
                .actor_identity
                .as_ref()
                .ok_or_else(|| "messaging profile actor identity is unavailable".to_string())?
                .seed_bytes();
            let previous_profile_version = engine
                .store
                .device_enrollment()?
                .ok_or_else(|| "messaging profile device enrollment is unavailable".to_string())?
                .certificate
                .observed_profile_version;
            (
                engine.endpoint.ptid.clone(),
                previous_seed,
                previous_profile_version,
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

        match restore_profile_database_atomically(profile_id, archive) {
            Ok(enrollment) => {
                let engine = Arc::new(MessagingEngine::open_profile(
                    profile_id.to_string(),
                    archive.ptid.clone(),
                    archive.actor_identity_seed,
                    archive.actor_profile_version,
                )?);
                self.install_profile_runtime(profile_id, engine, worker_token)?;
                Ok(enrollment)
            }
            Err(error) => {
                let rollback = MessagingEngine::open_profile(
                    profile_id.to_string(),
                    previous_ptid,
                    previous_seed,
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
    let mut buffer = vec![0_u8; super::attachment::ATTACHMENT_CHUNK_SIZE as usize];
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
    Ok(std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(".peers-touch")
        .join("messaging-sources")
        .join(profile_hash))
}

fn managed_attachment_source(profile_id: &str, path: &Path) -> Result<bool, String> {
    let root = attachment_source_root(profile_id)?;
    Ok(path.parent() == Some(root.as_path())
        && path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| {
                value.len() == 26 && value.chars().all(|ch| ch.is_ascii_alphanumeric())
            }))
}

fn attachment_cache_path(profile_id: &str, attachment_id: &str) -> Result<PathBuf, String> {
    if profile_id.trim().is_empty() || attachment_id.trim().is_empty() {
        return Err("messaging attachment cache identity is incomplete".to_string());
    }
    let profile_hash = hex::encode(Sha256::digest(profile_id.as_bytes()));
    let root = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(".peers-touch")
        .join("messaging-cache")
        .join(profile_hash);
    Ok(root.join(attachment_id))
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
    File::open(source_path)
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
    let mut buffer = vec![0_u8; super::attachment::ATTACHMENT_CHUNK_SIZE as usize];
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::mls_group::MlsMemberKeyPackage;
    use std::collections::VecDeque;
    use std::sync::mpsc;
    use std::thread;

    fn endpoint(device_id: &str) -> EngineEndpoint {
        EngineEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: device_id.to_string(),
        }
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
            [17; 32],
            3,
            store.clone(),
        )
        .unwrap();
        let device_id = first.endpoint().device_id.clone();
        assert!(!device_id.is_empty());
        let pending = store.pending_device_enrollment().unwrap().unwrap();
        assert_eq!(pending.certificate.ptid, "ptid:alice");
        assert_eq!(pending.certificate.device_id, device_id);
        assert_eq!(pending.certificate.observed_profile_version, 3);
        drop(first);

        let reopened = MessagingEngine::from_profile_store(
            "alice-profile".to_string(),
            "ptid:alice".to_string(),
            [17; 32],
            3,
            store.clone(),
        )
        .unwrap();
        assert_eq!(reopened.endpoint().device_id, device_id);
        drop(reopened);

        assert!(MessagingEngine::from_profile_store(
            "alice-profile".to_string(),
            "ptid:alice".to_string(),
            [18; 32],
            3,
            store.clone(),
        )
        .is_err());
        assert!(MessagingEngine::from_profile_store(
            "alice-profile".to_string(),
            "ptid:alice".to_string(),
            [17; 32],
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
                [17; 32],
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
            attachments: Vec::new(),
            trust: Vec::new(),
        };

        assert!(registry.restore_profile("alice-profile", &archive).is_err());
        let registered = registry.get("alice-profile").unwrap().unwrap();
        assert!(Arc::ptr_eq(&engine, &registered));
        assert!(registry.wake_profile("alice-profile").is_ok());
        registry.deactivate("alice-profile").unwrap();
    }
}
