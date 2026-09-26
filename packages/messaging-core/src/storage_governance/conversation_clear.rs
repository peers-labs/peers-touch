use super::cache::CacheCleanupOperation;
use super::retention::{RetentionCandidate, RetentionFloor};
use crate::proto::chat::{
    ChatStorageError, ChatStorageErrorCode, ChatStorageOperation, ChatStorageOperationKind,
    ChatStorageOperationState, ChatStorageScope,
};
use ulid::Ulid;

pub const CONVERSATION_CLEAR_SCOPE_KIND: &str = "conversation";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationClearSnapshot {
    pub conversation_id: String,
    pub authority_sequence: i64,
    pub authority_event_hash: Vec<u8>,
    pub existing_floor: Option<RetentionFloor>,
    pub candidates: Vec<RetentionCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationClearPlan {
    pub conversation_id: String,
    pub pruned_through_sequence: i64,
    pub authority_event_hash: [u8; 32],
    pub message_ids: Vec<String>,
    pub event_ids: Vec<String>,
    pub estimated_reclaimable_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationClearCommit {
    pub operation: CacheCleanupOperation,
    pub pruned_projection_count: u64,
    pub zero_reference_media_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationClearProgress {
    pub commit: ConversationClearCommit,
}

#[derive(Debug, Clone)]
pub struct ConversationClearInput {
    pub scope: ChatStorageScope,
    pub scope_revision: String,
    pub conversation_id: String,
    pub physical_bytes_before: u64,
    pub now_unix_ms: i64,
}

pub trait ConversationClearRepository {
    fn load_resumable_conversation_clear(
        &self,
        scope: &ChatStorageScope,
        scope_revision: &str,
        conversation_id: &str,
    ) -> Result<Option<CacheCleanupOperation>, String>;

    fn load_conversation_clear_snapshot(
        &self,
        scope: &ChatStorageScope,
        conversation_id: &str,
    ) -> Result<ConversationClearSnapshot, String>;

    fn commit_conversation_clear(
        &self,
        scope: &ChatStorageScope,
        operation: &CacheCleanupOperation,
        plan: &ConversationClearPlan,
    ) -> Result<ConversationClearCommit, String>;
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ConversationClearError {
    #[error("chat conversation clear scope is incomplete")]
    ScopeIncomplete,
    #[error("chat conversation clear scope revision is empty")]
    RevisionEmpty,
    #[error("chat conversation clear identity is empty")]
    ConversationIdEmpty,
    #[error("chat conversation clear timestamp is invalid")]
    InvalidTimestamp,
    #[error("chat conversation clear authority boundary is invalid")]
    InvalidAuthorityBoundary,
    #[error("chat conversation clear candidate is protected: {0}")]
    ProtectedCandidate(String),
    #[error("chat conversation clear repository failed: {0}")]
    Repository(String),
}

impl ConversationClearError {
    pub fn code(&self) -> ChatStorageErrorCode {
        match self {
            Self::ScopeIncomplete | Self::RevisionEmpty => ChatStorageErrorCode::ScopeStale,
            Self::ConversationIdEmpty
            | Self::InvalidAuthorityBoundary
            | Self::ProtectedCandidate(_) => ChatStorageErrorCode::ProtectedState,
            Self::InvalidTimestamp | Self::Repository(_) => ChatStorageErrorCode::IoFailed,
        }
    }

    pub fn retryable(&self) -> bool {
        matches!(self, Self::ProtectedCandidate(_) | Self::Repository(_))
    }
}

pub fn clear_conversation<R: ConversationClearRepository>(
    repository: &R,
    input: ConversationClearInput,
) -> Result<ConversationClearProgress, ConversationClearError> {
    validate_input(&input)?;
    if repository
        .load_resumable_conversation_clear(
            &input.scope,
            &input.scope_revision,
            &input.conversation_id,
        )
        .map_err(ConversationClearError::Repository)?
        .is_some()
    {
        return Err(ConversationClearError::Repository(
            "chat conversation clear has an unfinished cleanup operation".to_string(),
        ));
    }

    let snapshot = repository
        .load_conversation_clear_snapshot(&input.scope, &input.conversation_id)
        .map_err(ConversationClearError::Repository)?;
    let plan = build_conversation_clear_plan(snapshot)?;
    let operation = CacheCleanupOperation {
        operation_id: Ulid::new().to_string(),
        scope_revision: input.scope_revision,
        state: ChatStorageOperationState::DeletingRows,
        estimated_reclaimable_bytes: plan.estimated_reclaimable_bytes,
        physical_bytes_before: input.physical_bytes_before,
        physical_bytes_after: None,
        last_error_code: None,
        created_at_unix_ms: input.now_unix_ms,
        updated_at_unix_ms: input.now_unix_ms,
    };
    let commit = repository
        .commit_conversation_clear(&input.scope, &operation, &plan)
        .map_err(ConversationClearError::Repository)?;
    Ok(ConversationClearProgress { commit })
}

pub fn build_conversation_clear_plan(
    mut snapshot: ConversationClearSnapshot,
) -> Result<ConversationClearPlan, ConversationClearError> {
    if snapshot.conversation_id.trim().is_empty()
        || snapshot.authority_sequence <= 0
        || snapshot.authority_event_hash.len() != 32
        || snapshot.authority_event_hash.iter().all(|byte| *byte == 0)
    {
        return Err(ConversationClearError::InvalidAuthorityBoundary);
    }
    if let Some(floor) = snapshot.existing_floor.as_ref() {
        if floor.conversation_id != snapshot.conversation_id
            || floor.pruned_through_sequence <= 0
            || floor.pruned_through_sequence > snapshot.authority_sequence
            || floor.authority_event_hash.iter().all(|byte| *byte == 0)
        {
            return Err(ConversationClearError::InvalidAuthorityBoundary);
        }
    }

    snapshot.candidates.sort_by(|left, right| {
        left.event_sequence
            .cmp(&right.event_sequence)
            .then_with(|| left.event_id.cmp(&right.event_id))
    });
    let existing_sequence = snapshot
        .existing_floor
        .as_ref()
        .map(|floor| floor.pruned_through_sequence)
        .unwrap_or(0);
    let mut previous_sequence = existing_sequence;
    let mut message_ids = Vec::with_capacity(snapshot.candidates.len());
    let mut event_ids = Vec::with_capacity(snapshot.candidates.len());
    let mut estimated_reclaimable_bytes = 0_u64;
    for candidate in snapshot.candidates {
        if candidate.conversation_id != snapshot.conversation_id
            || candidate.event_id.trim().is_empty()
            || candidate.message_id.trim().is_empty()
            || candidate.event_sequence <= previous_sequence
            || candidate.event_sequence > snapshot.authority_sequence
            || candidate.authority_event_hash.len() != 32
            || candidate.authority_event_hash.iter().all(|byte| *byte == 0)
        {
            return Err(ConversationClearError::InvalidAuthorityBoundary);
        }
        if !candidate.durable_consumed
            || candidate.reliability_protected
            || candidate.active_transfer
        {
            return Err(ConversationClearError::ProtectedCandidate(
                candidate.message_id,
            ));
        }
        previous_sequence = candidate.event_sequence;
        estimated_reclaimable_bytes =
            estimated_reclaimable_bytes.saturating_add(candidate.estimated_reclaimable_bytes);
        message_ids.push(candidate.message_id);
        event_ids.push(candidate.event_id);
    }

    Ok(ConversationClearPlan {
        conversation_id: snapshot.conversation_id,
        pruned_through_sequence: snapshot.authority_sequence,
        authority_event_hash: snapshot
            .authority_event_hash
            .try_into()
            .map_err(|_| ConversationClearError::InvalidAuthorityBoundary)?,
        message_ids,
        event_ids,
        estimated_reclaimable_bytes,
    })
}

pub fn conversation_clear_operation_proto(
    scope: ChatStorageScope,
    operation: &CacheCleanupOperation,
    conversation_id: &str,
) -> ChatStorageOperation {
    ChatStorageOperation {
        operation_id: operation.operation_id.clone(),
        scope: Some(scope),
        scope_revision: operation.scope_revision.clone(),
        kind: ChatStorageOperationKind::ClearConversation as i32,
        state: operation.state as i32,
        conversation_id: conversation_id.to_string(),
        estimated_reclaimable_bytes: operation.estimated_reclaimable_bytes,
        physical_bytes_before: operation.physical_bytes_before,
        physical_bytes_after: operation.physical_bytes_after.unwrap_or(0),
        created_at_unix_ms: operation.created_at_unix_ms,
        updated_at_unix_ms: operation.updated_at_unix_ms,
    }
}

pub fn conversation_clear_error_proto(error: &ConversationClearError) -> ChatStorageError {
    ChatStorageError {
        code: error.code() as i32,
        message: error.to_string(),
        retryable: error.retryable(),
    }
}

fn validate_input(input: &ConversationClearInput) -> Result<(), ConversationClearError> {
    if input.scope.station_peer_id.trim().is_empty()
        || input.scope.actor_ptid.trim().is_empty()
        || input.scope.device_id.trim().is_empty()
    {
        return Err(ConversationClearError::ScopeIncomplete);
    }
    if input.scope_revision.trim().is_empty() {
        return Err(ConversationClearError::RevisionEmpty);
    }
    if input.conversation_id.trim().is_empty() {
        return Err(ConversationClearError::ConversationIdEmpty);
    }
    if input.now_unix_ms <= 0 {
        return Err(ConversationClearError::InvalidTimestamp);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage_governance::retention::sequence_is_above_retention_floor;
    use std::sync::Mutex;

    struct MemoryRepository {
        resumable: Option<CacheCleanupOperation>,
        snapshot: ConversationClearSnapshot,
        committed: Mutex<Option<ConversationClearPlan>>,
    }

    impl ConversationClearRepository for MemoryRepository {
        fn load_resumable_conversation_clear(
            &self,
            _scope: &ChatStorageScope,
            _scope_revision: &str,
            _conversation_id: &str,
        ) -> Result<Option<CacheCleanupOperation>, String> {
            Ok(self.resumable.clone())
        }

        fn load_conversation_clear_snapshot(
            &self,
            _scope: &ChatStorageScope,
            _conversation_id: &str,
        ) -> Result<ConversationClearSnapshot, String> {
            Ok(self.snapshot.clone())
        }

        fn commit_conversation_clear(
            &self,
            _scope: &ChatStorageScope,
            operation: &CacheCleanupOperation,
            plan: &ConversationClearPlan,
        ) -> Result<ConversationClearCommit, String> {
            *self.committed.lock().map_err(|_| "commit lock")? = Some(plan.clone());
            let mut operation = operation.clone();
            operation.state = ChatStorageOperationState::Compacting;
            Ok(ConversationClearCommit {
                operation,
                pruned_projection_count: plan.message_ids.len() as u64,
                zero_reference_media_paths: Vec::new(),
            })
        }
    }

    fn scope() -> ChatStorageScope {
        ChatStorageScope {
            station_peer_id: "station-five".to_string(),
            actor_ptid: "ptid:alice".to_string(),
            device_id: "alice-device".to_string(),
        }
    }

    fn candidate(sequence: i64) -> RetentionCandidate {
        RetentionCandidate {
            conversation_id: "conversation-a".to_string(),
            event_id: format!("event-{sequence}"),
            event_sequence: sequence,
            authority_event_hash: vec![sequence as u8; 32],
            message_id: format!("message-{sequence}"),
            committed_at_unix_ms: sequence * 1_000,
            estimated_reclaimable_bytes: 16,
            durable_consumed: true,
            reliability_protected: false,
            active_transfer: false,
        }
    }

    fn snapshot() -> ConversationClearSnapshot {
        ConversationClearSnapshot {
            conversation_id: "conversation-a".to_string(),
            authority_sequence: 3,
            authority_event_hash: vec![3; 32],
            existing_floor: Some(RetentionFloor {
                conversation_id: "conversation-a".to_string(),
                pruned_through_sequence: 1,
                authority_event_hash: [1; 32],
                policy_cutoff_unix_ms: Some(1_000),
                updated_at_unix_ms: 1_000,
            }),
            candidates: vec![candidate(3), candidate(2)],
        }
    }

    #[test]
    fn conversation_clear_freezes_the_verified_head_and_orders_candidates() {
        let plan = build_conversation_clear_plan(snapshot()).unwrap();

        assert_eq!(plan.pruned_through_sequence, 3);
        assert_eq!(plan.authority_event_hash, [3; 32]);
        assert_eq!(plan.message_ids, vec!["message-2", "message-3"]);
        assert_eq!(plan.event_ids, vec!["event-2", "event-3"]);
        assert_eq!(plan.estimated_reclaimable_bytes, 32);
        let committed_floor = RetentionFloor {
            conversation_id: plan.conversation_id.clone(),
            pruned_through_sequence: plan.pruned_through_sequence,
            authority_event_hash: plan.authority_event_hash,
            policy_cutoff_unix_ms: None,
            updated_at_unix_ms: 2_000,
        };
        assert!(!sequence_is_above_retention_floor(
            plan.pruned_through_sequence,
            Some(&committed_floor),
        ));
        assert!(sequence_is_above_retention_floor(
            plan.pruned_through_sequence + 1,
            Some(&committed_floor),
        ));
    }

    #[test]
    fn conversation_clear_rejects_any_protected_candidate_before_commit() {
        let mut value = snapshot();
        value.candidates[0].active_transfer = true;
        let error = build_conversation_clear_plan(value).unwrap_err();

        assert_eq!(
            error,
            ConversationClearError::ProtectedCandidate("message-3".to_string())
        );
    }

    #[test]
    fn conversation_clear_rejects_non_monotonic_or_out_of_boundary_candidates() {
        let mut value = snapshot();
        value.candidates.push(candidate(4));

        assert_eq!(
            build_conversation_clear_plan(value),
            Err(ConversationClearError::InvalidAuthorityBoundary)
        );
    }

    #[test]
    fn conversation_clear_commits_one_device_local_plan() {
        let repository = MemoryRepository {
            resumable: None,
            snapshot: snapshot(),
            committed: Mutex::new(None),
        };
        let progress = clear_conversation(
            &repository,
            ConversationClearInput {
                scope: scope(),
                scope_revision: "scope-1".to_string(),
                conversation_id: "conversation-a".to_string(),
                physical_bytes_before: 4096,
                now_unix_ms: 2_000,
            },
        )
        .unwrap();

        assert_eq!(
            progress.commit.operation.state,
            ChatStorageOperationState::Compacting
        );
        assert_eq!(progress.commit.pruned_projection_count, 2);
        assert_eq!(
            repository
                .committed
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .pruned_through_sequence,
            3
        );
    }
}
