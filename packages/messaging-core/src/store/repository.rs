use crate::contracts::{
    ActorReadReceiveCommit, ConversationProjection, ConversationStateReceiveCommit,
    DeliveryReceiptReceiveCommit, DirectEditCommit, DirectReceiveCommit, InteractionReceiveCommit,
    MlsApplicationReceiveCommit, MlsRetirementReceiveCommit, MlsSenderTransitionReceiveCommit,
    MlsTransitionReceiveCommit, PendingMlsKeyPackage, PendingMlsTransitionState,
    PublicEventReceiveCommit, ReceiveCommitResult,
};
use crate::crypto::double_ratchet::DrSkippedMessageKey;
use crate::crypto::session::DirectSession;
use crate::outbox::CommandOutboxEntry;
use crate::proto::chat::AttachmentPlaintextMetadata;

pub struct PendingSenderProjection<'a> {
    pub command_id: &'a str,
    pub conversation_id: &'a str,
    pub conversation_kind: i32,
    pub message_id: &'a str,
    pub sender_ptid: &'a str,
    pub sender_device_id: &'a str,
    pub plaintext: &'a str,
    pub reply_to_message_id: &'a str,
    pub thread_root_message_id: &'a str,
    pub attachments: &'a [AttachmentPlaintextMetadata],
    pub private_content: &'a [u8],
    pub delivery_plan_sha256: &'a [u8],
    pub created_at_unix_ms: i64,
}

#[derive(Clone)]
pub struct DirectOutboundSession {
    pub session: DirectSession,
    pub session_init: Option<Vec<u8>>,
}

#[derive(Clone)]
pub struct DirectSessionAdvance {
    pub previous: Option<DirectSession>,
    pub advanced: DirectSession,
    pub session_init: Option<Vec<u8>>,
}

pub struct DirectOutboundSendCommit<'a> {
    pub command_bytes: &'a [u8],
    pub expected_authority_sequence: i64,
    pub expected_authority_hash: &'a [u8],
    pub session_advances: &'a [DirectSessionAdvance],
    pub projection: PendingSenderProjection<'a>,
}

pub struct DirectOutboundEditCommit<'a> {
    pub command_id: &'a str,
    pub conversation_id: &'a str,
    pub target_message_id: &'a str,
    pub edited_text: &'a str,
    pub command_bytes: &'a [u8],
    pub delivery_plan_sha256: &'a [u8],
    pub expected_authority_sequence: i64,
    pub expected_authority_hash: &'a [u8],
    pub session_advances: &'a [DirectSessionAdvance],
    pub created_at_unix_ms: i64,
}

pub trait DirectOutboundRepository: Send + Sync {
    fn validate_sender_attachments_ready(
        &self,
        conversation_id: &str,
        message_id: &str,
        attachments: &[AttachmentPlaintextMetadata],
    ) -> Result<(), String>;

    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String>;

    fn load_direct_outbound_session(
        &self,
        conversation_id: &str,
        peer: &crate::contracts::CryptoEndpoint,
    ) -> Result<Option<DirectOutboundSession>, String>;

    fn next_direct_session_generation(
        &self,
        conversation_id: &str,
        peer: &crate::contracts::CryptoEndpoint,
    ) -> Result<u64, String>;

    fn persist_direct_outbound_send(
        &self,
        commit: &DirectOutboundSendCommit<'_>,
    ) -> Result<(), String>;

    fn persist_direct_outbound_edit(
        &self,
        commit: &DirectOutboundEditCommit<'_>,
    ) -> Result<(), String>;
}

pub struct MlsOutboundSendCommit<'a> {
    pub command_bytes: &'a [u8],
    pub expected_authority_sequence: i64,
    pub expected_authority_hash: &'a [u8],
    pub session_state: &'a [u8],
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub projection: PendingSenderProjection<'a>,
}

pub struct MlsOutboundEditCommit<'a> {
    pub command_id: &'a str,
    pub conversation_id: &'a str,
    pub target_message_id: &'a str,
    pub edited_text: &'a str,
    pub command_bytes: &'a [u8],
    pub delivery_plan_sha256: &'a [u8],
    pub expected_authority_sequence: i64,
    pub expected_authority_hash: &'a [u8],
    pub session_state: &'a [u8],
    pub membership_epoch: i64,
    pub mls_epoch: i64,
    pub created_at_unix_ms: i64,
}

pub trait MlsOutboundRepository: Send + Sync {
    fn validate_sender_attachments_ready(
        &self,
        conversation_id: &str,
        message_id: &str,
        attachments: &[AttachmentPlaintextMetadata],
    ) -> Result<(), String>;

    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String>;

    fn persist_mls_outbound_send(&self, commit: &MlsOutboundSendCommit<'_>) -> Result<(), String>;

    fn persist_mls_outbound_edit(&self, commit: &MlsOutboundEditCommit<'_>) -> Result<(), String>;
}

pub struct MlsTransitionSendCommit<'a> {
    pub logical_intent_id: Option<&'a str>,
    pub command_id: &'a str,
    pub conversation_id: &'a str,
    pub transition_id: &'a str,
    pub delivery_plan_sha256: &'a [u8],
    pub command_bytes: &'a [u8],
    pub pending_transition_state: &'a [u8],
    pub created_at_unix_ms: i64,
}

pub trait MlsTransitionRepository: Send + Sync {
    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String>;

    fn persist_mls_transition(&self, commit: &MlsTransitionSendCommit<'_>) -> Result<(), String>;
}

pub trait MlsKeyPackageRepository: Send + Sync {
    fn has_mls_key_packages(&self) -> Result<bool, String>;

    fn install_fresh_mls_key_packages(
        &self,
        packages: &[Vec<u8>],
        provider_pool_state: &[u8],
        created_at_unix_ms: i64,
    ) -> Result<(), String>;

    fn pending_mls_key_packages(&self) -> Result<Vec<PendingMlsKeyPackage>, String>;

    fn complete_mls_key_package_publication(&self, package_id: &str) -> Result<(), String>;
}

pub trait MlsStartupRepository: Send + Sync {
    fn list_mls_session_states(&self) -> Result<Vec<(String, Vec<u8>)>, String>;

    fn load_mls_join_provider_pool(&self) -> Result<Option<Vec<u8>>, String>;

    fn list_pending_mls_transitions(&self) -> Result<Vec<(String, Vec<u8>)>, String>;
}

pub trait MlsInboundRepository: Send + Sync {
    fn persist_claimed_item(
        &self,
        item_id: &str,
        event_id: &str,
        conversation_id: &str,
        lane_sequence: i64,
        consumer_epoch: u64,
        payload_sha256: &[u8],
        opaque_payload: &[u8],
        now_unix_ms: i64,
    ) -> Result<(), String>;

    fn consumption_marker_matches(
        &self,
        item_id: &str,
        payload_sha256: &[u8],
    ) -> Result<bool, String>;

    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String>;

    fn load_mls_session_state(&self, conversation_id: &str) -> Result<Option<Vec<u8>>, String>;

    fn load_mls_join_provider_pool(&self) -> Result<Option<Vec<u8>>, String>;

    fn has_mls_retired_checkpoint(&self, conversation_id: &str) -> Result<bool, String>;

    fn pending_mls_transition(
        &self,
        conversation_id: &str,
    ) -> Result<Option<PendingMlsTransitionState>, String>;

    fn commit_interaction_event(
        &self,
        commit: &InteractionReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String>;

    fn commit_mls_application(
        &self,
        commit: &MlsApplicationReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String>;

    fn commit_mls_transition_receive(
        &self,
        commit: &MlsTransitionReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String>;

    fn commit_mls_sender_transition(
        &self,
        commit: &MlsSenderTransitionReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String>;

    fn commit_mls_retirement(
        &self,
        commit: &MlsRetirementReceiveCommit<'_>,
    ) -> Result<ReceiveCommitResult, String>;
}

pub trait MessagingRepository: Send + Sync {
    // --- Queue consumption ---

    fn persist_claimed_item(
        &self,
        item_id: &str,
        event_id: &str,
        conversation_id: &str,
        lane_sequence: i64,
        consumer_epoch: u64,
        payload_sha256: &[u8],
        opaque_payload: &[u8],
        now_unix_ms: i64,
    ) -> Result<(), String>;

    fn consumption_marker_matches(
        &self,
        item_id: &str,
        payload_sha256: &[u8],
    ) -> Result<bool, String>;

    fn lane_checkpoint(&self) -> Result<(i64, u64), String>;

    // --- Conversation state ---

    fn commit_conversation_state(
        &self,
        commit: &ConversationStateReceiveCommit,
    ) -> Result<ReceiveCommitResult, String>;

    fn conversation_projections(&self) -> Result<Vec<ConversationProjection>, String>;

    // --- Public events ---

    fn commit_public_event(
        &self,
        commit: &PublicEventReceiveCommit,
    ) -> Result<ReceiveCommitResult, String>;

    fn commit_interaction_event(
        &self,
        commit: &InteractionReceiveCommit,
    ) -> Result<ReceiveCommitResult, String>;

    // --- Receipts ---

    fn commit_delivery_receipt(&self, commit: &DeliveryReceiptReceiveCommit) -> Result<(), String>;

    fn commit_actor_read_cursor(&self, commit: &ActorReadReceiveCommit) -> Result<(), String>;

    // --- Command outbox ---

    fn next_command(&self, now_unix_ms: i64) -> Result<Option<CommandOutboxEntry>, String>;

    fn mark_command_submitted(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        attempt_count: u32,
    ) -> Result<(), String>;

    fn mark_command_retry(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        attempt_count: u32,
        next_attempt_at_unix_ms: i64,
        error_code: &str,
    ) -> Result<(), String>;

    fn mark_command_failed(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        attempt_count: u32,
        error_code: &str,
    ) -> Result<(), String>;

    fn mark_command_superseded(
        &self,
        command_id: &str,
        command_bytes: &[u8],
        attempt_count: u32,
    ) -> Result<(), String>;

    // --- Authority state ---

    fn authority_head(&self, conversation_id: &str) -> Result<(i64, Vec<u8>), String>;

    // --- Direct sessions ---

    fn load_direct_session(&self, session_id: &str) -> Result<Option<DirectSession>, String>;

    fn load_direct_skipped_keys(
        &self,
        session_id: &str,
    ) -> Result<Vec<DrSkippedMessageKey>, String>;

    fn commit_direct_receive(
        &self,
        commit: &DirectReceiveCommit,
    ) -> Result<ReceiveCommitResult, String>;

    fn commit_direct_edit(&self, commit: &DirectEditCommit) -> Result<ReceiveCommitResult, String>;

    // --- Prekeys ---

    fn load_signed_prekey(&self, id: i32) -> Result<[u8; 32], String>;

    fn load_one_time_prekey(&self, id: i32) -> Result<[u8; 32], String>;

    // --- Lifecycle ---

    fn validate_integrity(&self) -> Result<(), String>;

    fn prepare_for_atomic_replace(&self) -> Result<(), String>;
}
