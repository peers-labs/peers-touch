use messaging_core::contracts::{
    ActorReadReceiveCommit, ConversationProjection, ConversationStateReceiveCommit,
    DeliveryReceiptReceiveCommit, DirectEditCommit, DirectReceiveCommit, InteractionReceiveCommit,
    PublicEventReceiveCommit, ReceiveCommitResult, ServicePlaintextMessageContent,
    ServicePlaintextReceiveCommit, SkippedEndpointReceiveCommit,
};
use messaging_core::crypto::double_ratchet::DrSkippedMessageKey;
use messaging_core::crypto::session::DirectSession;
use messaging_core::outbox::CommandOutboxEntry;
use messaging_core::store::MessagingRepository;
use std::sync::Mutex;

pub(crate) struct TestRepo {
    pub(crate) session: Mutex<Option<DirectSession>>,
    pub(crate) skipped_keys: Mutex<Vec<DrSkippedMessageKey>>,
    pub(crate) claimed: Mutex<Vec<String>>,
    pub(crate) committed_message: Mutex<Option<messaging_core::contracts::DirectMessageContent>>,
    pub(crate) committed_service: Mutex<Option<ServicePlaintextMessageContent>>,
    pub(crate) skipped_payloads: Mutex<Vec<String>>,
}

impl TestRepo {
    #[allow(dead_code)] // used by the Direct processor tests only
    pub(crate) fn new(session: DirectSession) -> Self {
        Self {
            session: Mutex::new(Some(session)),
            skipped_keys: Mutex::new(Vec::new()),
            claimed: Mutex::new(Vec::new()),
            committed_message: Mutex::new(None),
            committed_service: Mutex::new(None),
            skipped_payloads: Mutex::new(Vec::new()),
        }
    }

    /// Repo for processors that never touch Direct crypto state.
    #[allow(dead_code)] // used by the service-plaintext/skip tests only
    pub(crate) fn without_session() -> Self {
        Self {
            session: Mutex::new(None),
            skipped_keys: Mutex::new(Vec::new()),
            claimed: Mutex::new(Vec::new()),
            committed_message: Mutex::new(None),
            committed_service: Mutex::new(None),
            skipped_payloads: Mutex::new(Vec::new()),
        }
    }
}

impl MessagingRepository for TestRepo {
    fn persist_claimed_item(
        &self,
        item_id: &str,
        _event_id: &str,
        _conversation_id: &str,
        _lane_sequence: i64,
        _consumer_epoch: u64,
        _payload_sha256: &[u8],
        _opaque_payload: &[u8],
        _now_unix_ms: i64,
    ) -> Result<(), String> {
        self.claimed.lock().unwrap().push(item_id.to_string());
        Ok(())
    }

    fn consumption_marker_matches(
        &self,
        _item_id: &str,
        _payload_sha256: &[u8],
    ) -> Result<bool, String> {
        Ok(false)
    }

    fn lane_checkpoint(&self) -> Result<(i64, u64), String> {
        Ok((0, 0))
    }

    fn commit_conversation_state(
        &self,
        _commit: &ConversationStateReceiveCommit,
    ) -> Result<ReceiveCommitResult, String> {
        Ok(ReceiveCommitResult::Committed)
    }

    fn conversation_projections(&self) -> Result<Vec<ConversationProjection>, String> {
        Ok(Vec::new())
    }

    fn commit_public_event(
        &self,
        _commit: &PublicEventReceiveCommit,
    ) -> Result<ReceiveCommitResult, String> {
        Ok(ReceiveCommitResult::Committed)
    }

    fn commit_interaction_event(
        &self,
        _commit: &InteractionReceiveCommit,
    ) -> Result<ReceiveCommitResult, String> {
        Ok(ReceiveCommitResult::Committed)
    }

    fn commit_delivery_receipt(
        &self,
        _commit: &DeliveryReceiptReceiveCommit,
    ) -> Result<(), String> {
        Ok(())
    }

    fn commit_actor_read_cursor(&self, _commit: &ActorReadReceiveCommit) -> Result<(), String> {
        Ok(())
    }

    fn next_command(&self, _now_unix_ms: i64) -> Result<Option<CommandOutboxEntry>, String> {
        Ok(None)
    }

    fn mark_command_submitted(
        &self,
        _command_id: &str,
        _command_bytes: &[u8],
        _attempt_count: u32,
    ) -> Result<(), String> {
        Ok(())
    }

    fn mark_command_retry(
        &self,
        _command_id: &str,
        _command_bytes: &[u8],
        _attempt_count: u32,
        _next_attempt_at_unix_ms: i64,
        _error_code: &str,
    ) -> Result<(), String> {
        Ok(())
    }

    fn mark_command_failed(
        &self,
        _command_id: &str,
        _command_bytes: &[u8],
        _attempt_count: u32,
        _error_code: &str,
    ) -> Result<(), String> {
        Ok(())
    }

    fn mark_command_superseded(
        &self,
        _command_id: &str,
        _command_bytes: &[u8],
        _attempt_count: u32,
    ) -> Result<(), String> {
        Ok(())
    }

    fn authority_head(&self, _conversation_id: &str) -> Result<(i64, Vec<u8>), String> {
        Ok((0, Vec::new()))
    }

    fn load_direct_session(&self, _session_id: &str) -> Result<Option<DirectSession>, String> {
        Ok(self.session.lock().unwrap().clone())
    }

    fn load_direct_skipped_keys(
        &self,
        _session_id: &str,
    ) -> Result<Vec<DrSkippedMessageKey>, String> {
        Ok(self.skipped_keys.lock().unwrap().clone())
    }

    fn commit_direct_receive(
        &self,
        commit: &DirectReceiveCommit,
    ) -> Result<ReceiveCommitResult, String> {
        *self.committed_message.lock().unwrap() = Some(commit.projection.clone());
        *self.session.lock().unwrap() = Some(commit.session.clone());
        Ok(ReceiveCommitResult::Committed)
    }

    fn commit_direct_edit(
        &self,
        _commit: &DirectEditCommit,
    ) -> Result<ReceiveCommitResult, String> {
        Ok(ReceiveCommitResult::Committed)
    }

    fn commit_service_plaintext_receive(
        &self,
        commit: &ServicePlaintextReceiveCommit,
    ) -> Result<ReceiveCommitResult, String> {
        *self.committed_service.lock().unwrap() = Some(commit.projection.clone());
        Ok(ReceiveCommitResult::Committed)
    }

    fn commit_skipped_endpoint_payload(
        &self,
        commit: &SkippedEndpointReceiveCommit,
    ) -> Result<ReceiveCommitResult, String> {
        self.skipped_payloads
            .lock()
            .unwrap()
            .push(commit.item_id.to_string());
        Ok(ReceiveCommitResult::Committed)
    }

    fn load_signed_prekey(&self, _id: i32) -> Result<[u8; 32], String> {
        Err("not implemented in test".to_string())
    }

    fn load_one_time_prekey(&self, _id: i32) -> Result<[u8; 32], String> {
        Err("not implemented in test".to_string())
    }

    fn validate_integrity(&self) -> Result<(), String> {
        Ok(())
    }

    fn prepare_for_atomic_replace(&self) -> Result<(), String> {
        Ok(())
    }
}
