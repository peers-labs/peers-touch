use super::identity::{
    generate_fresh_device_identity, validate_enrollment_actor, FreshDeviceEnrollment,
};
use super::recovery::{restore_profile_database_atomically, MessagingRecoveryArchive};
use super::{
    AttachmentTransferWorker, CommandDispatchProgress, CommandOutboxWorker, CommandRetryPolicy,
    ConversationMessageProjection, ConversationProjection, DirectSessionBootstrapper,
    DrainProgress, GroupGenesisPreparer, MembershipTransitionIntentInput,
    MembershipTransitionPreparer, MessagingItemConsumer, MessagingLifecycleWorker, MessagingStore,
    MlsKeyPackagePublisher, PendingMembershipIntent, PendingMessageDraft, PreKeyPublisher,
    QueueDrain, SendPreparer, SendTextIntent, StationAttachmentTransferTransport,
    StationCommandTransport, StationDeviceTransport, StationGroupGenesisTransport,
    StationKeyBundleTransport, StationMembershipTransitionTransport, StationMlsKeyPackageTransport,
    StationPreKeyTransport, StationQueueTransport,
};
use crate::domain::actor_device_identity::ActorDeviceIdentity;
use crate::domain::crypto::IdentityKeyPair;
use crate::domain::mls_group::MlsGroupManager;
use crate::model::chat::{
    ChatCommand, ConversationKind, CreateMessagingDirectConversationRequest,
    CreateMessagingDirectConversationResponse, CryptoEndpoint, EnrollMessagingDeviceRequest,
    MessagingDevice, MessagingDeviceStatus, MessagingMembershipAction, PrepareMessagingSendRequest,
    PrepareMessagingSendResponse,
};
use reqwest::Method;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use ulid::Ulid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessagingProjectionChange {
    pub profile_id: String,
    pub conversation_id: String,
    pub event_id: String,
    pub lane_sequence: i64,
}

pub type MessagingProjectionNotifier = Arc<dyn Fn(MessagingProjectionChange) + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineEndpoint {
    pub ptid: String,
    pub device_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubmitTextOutcome {
    pub command_id: Option<String>,
    pub message_id: String,
    pub state: &'static str,
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
    runtime_consumer_epoch: Arc<AtomicU64>,
    projection_notifier: Mutex<Option<MessagingProjectionNotifier>>,
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
    fn in_memory(profile_id: String, endpoint: EngineEndpoint) -> Result<Self, String> {
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
        Ok(AttachmentTransferWorker::new(
            self.store.clone(),
            Arc::new(transport),
        ))
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

    pub fn submit_text(
        &self,
        token: &str,
        conversation_id: &str,
        conversation_kind: ConversationKind,
        plaintext: &str,
    ) -> Result<SubmitTextOutcome, String> {
        let _guard = self
            .send_intent_lock
            .lock()
            .map_err(|_| "messaging send intent lock poisoned".to_string())?;
        if conversation_id.trim().is_empty()
            || plaintext.is_empty()
            || conversation_kind == ConversationKind::Unspecified
        {
            return Err("messaging text intent is incomplete".to_string());
        }
        let message_id = Ulid::new().to_string();
        let draft = PendingMessageDraft {
            conversation_id: conversation_id.to_string(),
            conversation_kind: conversation_kind as i32,
            message_id: message_id.clone(),
            sender_ptid: self.endpoint.ptid.clone(),
            sender_device_id: self.endpoint.device_id.clone(),
            plaintext: plaintext.to_string(),
            attempt_count: 0,
            created_at_unix_ms: now_unix_ms(),
        };
        self.store.create_message_draft(&draft)?;
        match self.prepare_message_draft(token, &draft) {
            Ok(command_id) => Ok(SubmitTextOutcome {
                command_id: Some(command_id),
                message_id,
                state: "pending",
            }),
            Err(_) => {
                self.schedule_message_draft_retry(&draft, now_unix_ms())?;
                Ok(SubmitTextOutcome {
                    command_id: None,
                    message_id,
                    state: "draft",
                })
            }
        }
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

    pub fn create_direct_conversation(
        &self,
        token: &str,
        peer_ptid: &str,
    ) -> Result<String, String> {
        if peer_ptid.trim().is_empty() || peer_ptid == self.endpoint.ptid {
            return Err("messaging direct peer identity is invalid".to_string());
        }
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

    pub fn conversations(&self) -> Result<Vec<ConversationProjection>, String> {
        self.store.conversation_projections()
    }

    pub fn create_group_conversation(
        &self,
        token: &str,
        conversation_id: &str,
        name: &str,
        member_ptids: &[String],
    ) -> Result<String, String> {
        let transport =
            StationGroupGenesisTransport::new(token.to_string(), self.endpoint.clone())?;
        let plan = transport.prepare(conversation_id, name, member_ptids)?;
        GroupGenesisPreparer::new(
            self.store.clone(),
            self.mls_manager.clone(),
            self.endpoint.clone(),
        )?
        .prepare(&plan, conversation_id, now_unix_ms())?;
        Ok(conversation_id.to_string())
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

    pub fn reprepare_superseded_text(
        &self,
        superseded_command_id: &str,
        plan: &PrepareMessagingSendResponse,
        now_unix_ms: i64,
    ) -> Result<ChatCommand, String> {
        let draft = self.store.superseded_message_draft(superseded_command_id)?;
        if draft.sender_ptid != self.endpoint.ptid
            || draft.sender_device_id != self.endpoint.device_id
            || draft.conversation_id != plan.conversation_id
        {
            return Err("messaging superseded draft endpoint mismatch".to_string());
        }
        let replacement_command_id = Ulid::new().to_string();
        let intent = SendTextIntent {
            command_id: &replacement_command_id,
            message_id: &draft.message_id,
            conversation_id: &draft.conversation_id,
            plaintext: &draft.plaintext,
            client_timestamp_unix_ms: now_unix_ms,
        };
        match ConversationKind::try_from(plan.conversation_kind)
            .map_err(|_| "messaging replacement plan kind is invalid".to_string())?
        {
            ConversationKind::Direct => self.prepare_direct_text(plan, &intent),
            ConversationKind::Group => self.prepare_group_text(plan, &intent),
            ConversationKind::Unspecified => {
                Err("messaging replacement plan kind is unspecified".to_string())
            }
        }
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

pub(crate) fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn endpoint(device_id: &str) -> EngineEndpoint {
        EngineEndpoint {
            ptid: "ptid:alice".to_string(),
            device_id: device_id.to_string(),
        }
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
