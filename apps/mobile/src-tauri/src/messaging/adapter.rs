use messaging_core::contracts::{
    ActorReadReceiveCommit, ConversationProjection, ConversationStateReceiveCommit,
    DeliveryReceiptReceiveCommit, DirectEditCommit, DirectReceiveCommit, InteractionReceiveCommit,
    PublicEventReceiveCommit, ReceiveCommitResult,
};
use messaging_core::crypto::double_ratchet::DrSkippedMessageKey;
use messaging_core::crypto::session::DirectSession;
use messaging_core::outbox::CommandOutboxEntry;
use messaging_core::store::MessagingRepository;

pub struct MobileMessagingStore {
    // TODO: Mobile SQLCipher connection, keychain, transport
}

impl MessagingRepository for MobileMessagingStore {
    fn persist_claimed_item(
        &self,
        _item_id: &str,
        _event_id: &str,
        _conversation_id: &str,
        _lane_sequence: i64,
        _consumer_epoch: u64,
        _payload_sha256: &[u8],
        _opaque_payload: &[u8],
        _now_unix_ms: i64,
    ) -> Result<(), String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn consumption_marker_matches(
        &self,
        _item_id: &str,
        _payload_sha256: &[u8],
    ) -> Result<bool, String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn lane_checkpoint(&self) -> Result<(i64, u64), String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn commit_conversation_state(
        &self,
        _commit: &ConversationStateReceiveCommit,
    ) -> Result<ReceiveCommitResult, String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn conversation_projections(&self) -> Result<Vec<ConversationProjection>, String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn commit_public_event(
        &self,
        _commit: &PublicEventReceiveCommit,
    ) -> Result<ReceiveCommitResult, String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn commit_interaction_event(
        &self,
        _commit: &InteractionReceiveCommit,
    ) -> Result<ReceiveCommitResult, String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn commit_delivery_receipt(
        &self,
        _commit: &DeliveryReceiptReceiveCommit,
    ) -> Result<(), String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn commit_actor_read_cursor(&self, _commit: &ActorReadReceiveCommit) -> Result<(), String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn next_command(&self, _now_unix_ms: i64) -> Result<Option<CommandOutboxEntry>, String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn mark_command_submitted(
        &self,
        _command_id: &str,
        _command_bytes: &[u8],
        _attempt_count: u32,
    ) -> Result<(), String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn mark_command_retry(
        &self,
        _command_id: &str,
        _command_bytes: &[u8],
        _attempt_count: u32,
        _next_attempt_at_unix_ms: i64,
        _error_code: &str,
    ) -> Result<(), String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn mark_command_failed(
        &self,
        _command_id: &str,
        _command_bytes: &[u8],
        _attempt_count: u32,
        _error_code: &str,
    ) -> Result<(), String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn mark_command_superseded(
        &self,
        _command_id: &str,
        _command_bytes: &[u8],
        _attempt_count: u32,
    ) -> Result<(), String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn authority_head(&self, _conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn load_direct_session(&self, _session_id: &str) -> Result<Option<DirectSession>, String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn load_direct_skipped_keys(
        &self,
        _session_id: &str,
    ) -> Result<Vec<DrSkippedMessageKey>, String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn commit_direct_receive(
        &self,
        _commit: &DirectReceiveCommit,
    ) -> Result<ReceiveCommitResult, String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn commit_direct_edit(
        &self,
        _commit: &DirectEditCommit,
    ) -> Result<ReceiveCommitResult, String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn load_signed_prekey(&self, _id: i32) -> Result<[u8; 32], String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn load_one_time_prekey(&self, _id: i32) -> Result<[u8; 32], String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn validate_integrity(&self) -> Result<(), String> {
        Err("Mobile adapter not yet implemented".into())
    }

    fn prepare_for_atomic_replace(&self) -> Result<(), String> {
        Err("Mobile adapter not yet implemented".into())
    }
}
