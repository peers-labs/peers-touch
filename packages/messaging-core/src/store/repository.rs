use crate::contracts::{
    ActorReadReceiveCommit, ConversationProjection, ConversationStateReceiveCommit,
    DeliveryReceiptReceiveCommit, DirectEditCommit, DirectReceiveCommit,
    InteractionReceiveCommit, PublicEventReceiveCommit, ReceiveCommitResult,
};
use crate::crypto::double_ratchet::DrSkippedMessageKey;
use crate::crypto::session::DirectSession;
use crate::outbox::CommandOutboxEntry;

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

    fn commit_delivery_receipt(
        &self,
        commit: &DeliveryReceiptReceiveCommit,
    ) -> Result<(), String>;

    fn commit_actor_read_cursor(
        &self,
        commit: &ActorReadReceiveCommit,
    ) -> Result<(), String>;

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

    fn commit_direct_edit(
        &self,
        commit: &DirectEditCommit,
    ) -> Result<ReceiveCommitResult, String>;

    // --- Prekeys ---

    fn load_signed_prekey(&self, id: i32) -> Result<[u8; 32], String>;

    fn load_one_time_prekey(&self, id: i32) -> Result<[u8; 32], String>;

    // --- Lifecycle ---

    fn validate_integrity(&self) -> Result<(), String>;

    fn prepare_for_atomic_replace(&self) -> Result<(), String>;
}
