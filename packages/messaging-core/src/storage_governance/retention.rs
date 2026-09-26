use super::cache::CacheCleanupOperation;
use crate::proto::chat::{
    ChatRetentionPreset, ChatStorageError, ChatStorageErrorCode, ChatStorageOperation,
    ChatStorageOperationKind, ChatStoragePolicy, ChatStorageScope,
};
use std::collections::{BTreeMap, HashMap};
use ulid::Ulid;

pub const RETENTION_SCOPE_KIND: &str = "retention";
const DAY_MILLIS: i64 = 24 * 60 * 60 * 1_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetentionFloor {
    pub conversation_id: String,
    pub pruned_through_sequence: i64,
    pub authority_event_hash: [u8; 32],
    pub policy_cutoff_unix_ms: Option<i64>,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetentionCandidate {
    pub conversation_id: String,
    pub event_id: String,
    pub event_sequence: i64,
    pub authority_event_hash: Vec<u8>,
    pub message_id: String,
    pub committed_at_unix_ms: i64,
    pub estimated_reclaimable_bytes: u64,
    pub durable_consumed: bool,
    pub reliability_protected: bool,
    pub active_transfer: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetentionBoundary {
    pub conversation_id: String,
    pub pruned_through_sequence: i64,
    pub authority_event_hash: [u8; 32],
    pub policy_cutoff_unix_ms: i64,
    pub message_ids: Vec<String>,
    pub event_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetentionPlan {
    pub preset: ChatRetentionPreset,
    pub cutoff_unix_ms: Option<i64>,
    pub boundaries: Vec<RetentionBoundary>,
    pub estimated_reclaimable_bytes: u64,
}

#[derive(Debug, Clone)]
pub struct RetentionApplyInput {
    pub scope: ChatStorageScope,
    pub scope_revision: String,
    pub retention_preset: i32,
    pub physical_bytes_before: u64,
    pub now_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetentionCommit {
    pub operation: CacheCleanupOperation,
    pub pruned_projection_count: u64,
    pub zero_reference_media_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetentionProgress {
    pub policy: ChatStoragePolicy,
    pub commit: RetentionCommit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetentionResume {
    pub policy: ChatStoragePolicy,
    pub operation: CacheCleanupOperation,
}

pub trait RetentionRepository {
    fn load_resumable_retention(
        &self,
        scope: &ChatStorageScope,
        scope_revision: &str,
    ) -> Result<Option<RetentionResume>, String>;

    fn load_retention_floors(
        &self,
        scope: &ChatStorageScope,
    ) -> Result<Vec<RetentionFloor>, String>;

    fn load_retention_candidates(
        &self,
        scope: &ChatStorageScope,
        cutoff_unix_ms: i64,
    ) -> Result<Vec<RetentionCandidate>, String>;

    fn commit_retention_plan(
        &self,
        scope: &ChatStorageScope,
        policy: &ChatStoragePolicy,
        operation: &CacheCleanupOperation,
        plan: &RetentionPlan,
    ) -> Result<RetentionCommit, String>;
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RetentionError {
    #[error("chat retention scope is incomplete")]
    ScopeIncomplete,
    #[error("chat retention scope revision is empty")]
    RevisionEmpty,
    #[error("chat retention timestamp is invalid")]
    InvalidTimestamp,
    #[error("chat retention preset is invalid")]
    InvalidPolicy,
    #[error("chat retention candidate is invalid: {0}")]
    InvalidCandidate(String),
    #[error("chat retention floor is invalid: {0}")]
    InvalidFloor(String),
    #[error("chat retention repository failed: {0}")]
    Repository(String),
}

impl RetentionError {
    pub fn code(&self) -> ChatStorageErrorCode {
        match self {
            Self::ScopeIncomplete | Self::RevisionEmpty => ChatStorageErrorCode::ScopeStale,
            Self::InvalidPolicy | Self::InvalidTimestamp => ChatStorageErrorCode::InvalidPolicy,
            Self::InvalidCandidate(_) | Self::InvalidFloor(_) => {
                ChatStorageErrorCode::ProtectedState
            }
            Self::Repository(_) => ChatStorageErrorCode::IoFailed,
        }
    }

    pub fn retryable(&self) -> bool {
        matches!(self, Self::InvalidCandidate(_) | Self::Repository(_))
    }
}

pub fn apply_retention<R: RetentionRepository>(
    repository: &R,
    input: RetentionApplyInput,
) -> Result<RetentionProgress, RetentionError> {
    validate_scope(&input.scope)?;
    if input.scope_revision.trim().is_empty() {
        return Err(RetentionError::RevisionEmpty);
    }
    if input.now_unix_ms <= 0 {
        return Err(RetentionError::InvalidTimestamp);
    }
    if repository
        .load_resumable_retention(&input.scope, &input.scope_revision)
        .map_err(RetentionError::Repository)?
        .is_some()
    {
        return Err(RetentionError::Repository(
            "chat retention has an unfinished cleanup operation".to_string(),
        ));
    }
    let preset = ChatRetentionPreset::try_from(input.retention_preset)
        .map_err(|_| RetentionError::InvalidPolicy)?;
    let cutoff_unix_ms = retention_cutoff_unix_ms(preset, input.now_unix_ms)?;
    let floors = repository
        .load_retention_floors(&input.scope)
        .map_err(RetentionError::Repository)?;
    let candidates = match cutoff_unix_ms {
        Some(cutoff) => repository
            .load_retention_candidates(&input.scope, cutoff)
            .map_err(RetentionError::Repository)?,
        None => Vec::new(),
    };
    let plan = build_retention_plan(preset, cutoff_unix_ms, floors, candidates)?;
    let policy = ChatStoragePolicy {
        scope: Some(input.scope.clone()),
        retention_preset: preset as i32,
        updated_at_unix_ms: input.now_unix_ms,
    };
    let operation = CacheCleanupOperation {
        operation_id: Ulid::new().to_string(),
        scope_revision: input.scope_revision,
        state: if plan.boundaries.is_empty() {
            crate::proto::chat::ChatStorageOperationState::Succeeded
        } else {
            crate::proto::chat::ChatStorageOperationState::DeletingRows
        },
        estimated_reclaimable_bytes: plan.estimated_reclaimable_bytes,
        physical_bytes_before: input.physical_bytes_before,
        physical_bytes_after: plan
            .boundaries
            .is_empty()
            .then_some(input.physical_bytes_before),
        last_error_code: None,
        created_at_unix_ms: input.now_unix_ms,
        updated_at_unix_ms: input.now_unix_ms,
    };
    let commit = repository
        .commit_retention_plan(&input.scope, &policy, &operation, &plan)
        .map_err(RetentionError::Repository)?;
    Ok(RetentionProgress { policy, commit })
}

pub fn build_retention_plan(
    preset: ChatRetentionPreset,
    cutoff_unix_ms: Option<i64>,
    floors: Vec<RetentionFloor>,
    mut candidates: Vec<RetentionCandidate>,
) -> Result<RetentionPlan, RetentionError> {
    if preset == ChatRetentionPreset::Unspecified {
        return Err(RetentionError::InvalidPolicy);
    }
    if preset == ChatRetentionPreset::Forever {
        if cutoff_unix_ms.is_some() {
            return Err(RetentionError::InvalidPolicy);
        }
        return Ok(RetentionPlan {
            preset,
            cutoff_unix_ms: None,
            boundaries: Vec::new(),
            estimated_reclaimable_bytes: 0,
        });
    }
    let cutoff = cutoff_unix_ms.ok_or(RetentionError::InvalidPolicy)?;
    if cutoff <= 0 {
        return Err(RetentionError::InvalidTimestamp);
    }

    let floor_by_conversation = validate_floors(floors)?;
    candidates.sort_by(|left, right| {
        left.conversation_id
            .cmp(&right.conversation_id)
            .then_with(|| left.event_sequence.cmp(&right.event_sequence))
            .then_with(|| left.event_id.cmp(&right.event_id))
    });

    let mut grouped = BTreeMap::<String, Vec<RetentionCandidate>>::new();
    for candidate in candidates {
        validate_candidate(&candidate)?;
        grouped
            .entry(candidate.conversation_id.clone())
            .or_default()
            .push(candidate);
    }

    let mut boundaries = Vec::new();
    let mut estimated_reclaimable_bytes = 0_u64;
    for (conversation_id, candidates) in grouped {
        let existing_floor = floor_by_conversation
            .get(&conversation_id)
            .map(|floor| floor.pruned_through_sequence)
            .unwrap_or(0);
        let mut selected = Vec::new();
        for candidate in candidates {
            if candidate.event_sequence <= existing_floor {
                continue;
            }
            if candidate.committed_at_unix_ms >= cutoff
                || !candidate.durable_consumed
                || candidate.reliability_protected
                || candidate.active_transfer
            {
                break;
            }
            selected.push(candidate);
        }
        let Some(last) = selected.last() else {
            continue;
        };
        let authority_event_hash: [u8; 32] = last
            .authority_event_hash
            .as_slice()
            .try_into()
            .map_err(|_| RetentionError::InvalidCandidate(last.event_id.clone()))?;
        estimated_reclaimable_bytes = selected
            .iter()
            .fold(estimated_reclaimable_bytes, |total, candidate| {
                total.saturating_add(candidate.estimated_reclaimable_bytes)
            });
        boundaries.push(RetentionBoundary {
            conversation_id,
            pruned_through_sequence: last.event_sequence,
            authority_event_hash,
            policy_cutoff_unix_ms: cutoff,
            message_ids: selected
                .iter()
                .map(|candidate| candidate.message_id.clone())
                .collect(),
            event_ids: selected
                .iter()
                .map(|candidate| candidate.event_id.clone())
                .collect(),
        });
    }

    Ok(RetentionPlan {
        preset,
        cutoff_unix_ms: Some(cutoff),
        boundaries,
        estimated_reclaimable_bytes,
    })
}

pub fn retention_cutoff_unix_ms(
    preset: ChatRetentionPreset,
    now_unix_ms: i64,
) -> Result<Option<i64>, RetentionError> {
    if now_unix_ms <= 0 {
        return Err(RetentionError::InvalidTimestamp);
    }
    let days = match preset {
        ChatRetentionPreset::Forever => return Ok(None),
        ChatRetentionPreset::ChatRetentionPreset365Days => 365,
        ChatRetentionPreset::ChatRetentionPreset90Days => 90,
        ChatRetentionPreset::ChatRetentionPreset30Days => 30,
        ChatRetentionPreset::Unspecified => return Err(RetentionError::InvalidPolicy),
    };
    now_unix_ms
        .checked_sub(days * DAY_MILLIS)
        .filter(|cutoff| *cutoff > 0)
        .map(Some)
        .ok_or(RetentionError::InvalidTimestamp)
}

pub fn retention_operation_proto(
    scope: ChatStorageScope,
    operation: &CacheCleanupOperation,
) -> ChatStorageOperation {
    ChatStorageOperation {
        operation_id: operation.operation_id.clone(),
        scope: Some(scope),
        scope_revision: operation.scope_revision.clone(),
        kind: ChatStorageOperationKind::ApplyRetention as i32,
        state: operation.state as i32,
        conversation_id: String::new(),
        estimated_reclaimable_bytes: operation.estimated_reclaimable_bytes,
        physical_bytes_before: operation.physical_bytes_before,
        physical_bytes_after: operation.physical_bytes_after.unwrap_or(0),
        created_at_unix_ms: operation.created_at_unix_ms,
        updated_at_unix_ms: operation.updated_at_unix_ms,
    }
}

pub fn retention_error_proto(error: &RetentionError) -> ChatStorageError {
    ChatStorageError {
        code: error.code() as i32,
        message: error.to_string(),
        retryable: error.retryable(),
    }
}

pub fn sequence_is_above_retention_floor(
    event_sequence: i64,
    floor: Option<&RetentionFloor>,
) -> bool {
    event_sequence
        > floor
            .map(|value| value.pruned_through_sequence)
            .unwrap_or(0)
}

fn validate_scope(scope: &ChatStorageScope) -> Result<(), RetentionError> {
    if scope.station_peer_id.trim().is_empty()
        || scope.actor_ptid.trim().is_empty()
        || scope.device_id.trim().is_empty()
    {
        return Err(RetentionError::ScopeIncomplete);
    }
    Ok(())
}

fn validate_floors(
    floors: Vec<RetentionFloor>,
) -> Result<HashMap<String, RetentionFloor>, RetentionError> {
    let mut result = HashMap::new();
    for floor in floors {
        if floor.conversation_id.trim().is_empty()
            || floor.pruned_through_sequence <= 0
            || floor.authority_event_hash.iter().all(|byte| *byte == 0)
            || floor
                .policy_cutoff_unix_ms
                .is_some_and(|cutoff| cutoff <= 0)
            || floor.updated_at_unix_ms <= 0
        {
            return Err(RetentionError::InvalidFloor(floor.conversation_id.clone()));
        }
        if result
            .insert(floor.conversation_id.clone(), floor)
            .is_some()
        {
            return Err(RetentionError::InvalidFloor(
                "duplicate conversation floor".to_string(),
            ));
        }
    }
    Ok(result)
}

fn validate_candidate(candidate: &RetentionCandidate) -> Result<(), RetentionError> {
    if candidate.conversation_id.trim().is_empty()
        || candidate.event_id.trim().is_empty()
        || candidate.message_id.trim().is_empty()
        || candidate.event_sequence <= 0
        || candidate.committed_at_unix_ms <= 0
        || candidate.authority_event_hash.len() != 32
        || candidate.authority_event_hash.iter().all(|byte| *byte == 0)
    {
        return Err(RetentionError::InvalidCandidate(
            candidate.message_id.clone(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryRetentionRepository {
        floors: Vec<RetentionFloor>,
        candidates: Vec<RetentionCandidate>,
        resumable: Option<RetentionResume>,
        committed: Mutex<Option<RetentionPlan>>,
    }

    impl RetentionRepository for MemoryRetentionRepository {
        fn load_resumable_retention(
            &self,
            _scope: &ChatStorageScope,
            _scope_revision: &str,
        ) -> Result<Option<RetentionResume>, String> {
            Ok(self.resumable.clone())
        }

        fn load_retention_floors(
            &self,
            _scope: &ChatStorageScope,
        ) -> Result<Vec<RetentionFloor>, String> {
            Ok(self.floors.clone())
        }

        fn load_retention_candidates(
            &self,
            _scope: &ChatStorageScope,
            _cutoff_unix_ms: i64,
        ) -> Result<Vec<RetentionCandidate>, String> {
            Ok(self.candidates.clone())
        }

        fn commit_retention_plan(
            &self,
            _scope: &ChatStorageScope,
            _policy: &ChatStoragePolicy,
            operation: &CacheCleanupOperation,
            plan: &RetentionPlan,
        ) -> Result<RetentionCommit, String> {
            *self.committed.lock().map_err(|_| "commit lock")? = Some(plan.clone());
            let mut operation = operation.clone();
            operation.state = crate::proto::chat::ChatStorageOperationState::Compacting;
            Ok(RetentionCommit {
                operation,
                pruned_projection_count: plan
                    .boundaries
                    .iter()
                    .map(|boundary| boundary.message_ids.len() as u64)
                    .sum(),
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

    fn candidate(
        conversation_id: &str,
        sequence: i64,
        durable_consumed: bool,
        reliability_protected: bool,
        active_transfer: bool,
    ) -> RetentionCandidate {
        RetentionCandidate {
            conversation_id: conversation_id.to_string(),
            event_id: format!("event-{sequence}"),
            event_sequence: sequence,
            authority_event_hash: vec![sequence as u8; 32],
            message_id: format!("message-{sequence}"),
            committed_at_unix_ms: sequence * 1_000,
            estimated_reclaimable_bytes: 10,
            durable_consumed,
            reliability_protected,
            active_transfer,
        }
    }

    #[test]
    fn all_four_presets_have_one_canonical_cutoff_meaning() {
        let now = 400 * DAY_MILLIS;
        assert_eq!(
            retention_cutoff_unix_ms(ChatRetentionPreset::Forever, now).unwrap(),
            None
        );
        assert_eq!(
            retention_cutoff_unix_ms(ChatRetentionPreset::ChatRetentionPreset365Days, now).unwrap(),
            Some(35 * DAY_MILLIS)
        );
        assert_eq!(
            retention_cutoff_unix_ms(ChatRetentionPreset::ChatRetentionPreset90Days, now).unwrap(),
            Some(310 * DAY_MILLIS)
        );
        assert_eq!(
            retention_cutoff_unix_ms(ChatRetentionPreset::ChatRetentionPreset30Days, now).unwrap(),
            Some(370 * DAY_MILLIS)
        );
    }

    #[test]
    fn protected_candidate_stops_the_conversation_floor_without_blocking_others() {
        let cutoff = 10_000;
        let plan = build_retention_plan(
            ChatRetentionPreset::ChatRetentionPreset30Days,
            Some(cutoff),
            Vec::new(),
            vec![
                candidate("conversation-a", 1, true, false, false),
                candidate("conversation-a", 2, true, true, false),
                candidate("conversation-a", 3, true, false, false),
                candidate("conversation-b", 1, true, false, false),
            ],
        )
        .unwrap();

        assert_eq!(plan.boundaries.len(), 2);
        assert_eq!(plan.boundaries[0].pruned_through_sequence, 1);
        assert_eq!(plan.boundaries[0].message_ids, vec!["message-1"]);
        assert_eq!(plan.boundaries[1].conversation_id, "conversation-b");
        assert_eq!(plan.estimated_reclaimable_bytes, 20);
    }

    #[test]
    fn floor_only_moves_forward_on_the_same_verified_candidate_chain() {
        let plan = build_retention_plan(
            ChatRetentionPreset::ChatRetentionPreset90Days,
            Some(10_000),
            vec![RetentionFloor {
                conversation_id: "conversation-a".to_string(),
                pruned_through_sequence: 2,
                authority_event_hash: [2; 32],
                policy_cutoff_unix_ms: Some(1_000),
                updated_at_unix_ms: 2_000,
            }],
            vec![
                candidate("conversation-a", 1, true, false, false),
                candidate("conversation-a", 2, true, false, false),
                candidate("conversation-a", 3, true, false, false),
            ],
        )
        .unwrap();

        assert_eq!(plan.boundaries.len(), 1);
        assert_eq!(plan.boundaries[0].pruned_through_sequence, 3);
        assert_eq!(plan.boundaries[0].authority_event_hash, [3; 32]);
        assert_eq!(plan.boundaries[0].message_ids, vec!["message-3"]);
    }

    #[test]
    fn invalid_or_unverified_candidate_fails_closed() {
        let mut invalid = candidate("conversation-a", 1, true, false, false);
        invalid.authority_event_hash = vec![0; 32];
        assert!(matches!(
            build_retention_plan(
                ChatRetentionPreset::ChatRetentionPreset30Days,
                Some(10_000),
                Vec::new(),
                vec![invalid],
            ),
            Err(RetentionError::InvalidCandidate(_))
        ));
    }

    #[test]
    fn newer_projection_stops_floor_before_later_old_projection() {
        let cutoff = 10_000;
        let mut newer = candidate("conversation-a", 2, true, false, false);
        newer.committed_at_unix_ms = cutoff;
        let plan = build_retention_plan(
            ChatRetentionPreset::ChatRetentionPreset30Days,
            Some(cutoff),
            Vec::new(),
            vec![
                candidate("conversation-a", 1, true, false, false),
                newer,
                candidate("conversation-a", 3, true, false, false),
            ],
        )
        .unwrap();

        assert_eq!(plan.boundaries.len(), 1);
        assert_eq!(plan.boundaries[0].pruned_through_sequence, 1);
        assert_eq!(plan.boundaries[0].message_ids, vec!["message-1"]);
    }

    #[test]
    fn apply_refuses_to_replace_an_unfinished_cleanup_operation() {
        let repository = MemoryRetentionRepository {
            resumable: Some(RetentionResume {
                policy: ChatStoragePolicy {
                    scope: Some(scope()),
                    retention_preset: ChatRetentionPreset::ChatRetentionPreset30Days as i32,
                    updated_at_unix_ms: 1,
                },
                operation: CacheCleanupOperation {
                    operation_id: "operation-1".to_string(),
                    scope_revision: "scope-1".to_string(),
                    state: crate::proto::chat::ChatStorageOperationState::CompactionPending,
                    estimated_reclaimable_bytes: 10,
                    physical_bytes_before: 100,
                    physical_bytes_after: None,
                    last_error_code: None,
                    created_at_unix_ms: 1,
                    updated_at_unix_ms: 1,
                },
            }),
            ..Default::default()
        };

        let error = apply_retention(
            &repository,
            RetentionApplyInput {
                scope: scope(),
                scope_revision: "scope-1".to_string(),
                retention_preset: ChatRetentionPreset::ChatRetentionPreset30Days as i32,
                physical_bytes_before: 100,
                now_unix_ms: 40 * DAY_MILLIS,
            },
        )
        .unwrap_err();

        assert!(matches!(error, RetentionError::Repository(_)));
        assert!(repository.committed.lock().unwrap().is_none());
    }

    #[test]
    fn apply_is_scope_fenced_and_commits_the_selected_plan() {
        let repository = MemoryRetentionRepository {
            candidates: vec![candidate("conversation-a", 1, true, false, false)],
            ..Default::default()
        };
        let progress = apply_retention(
            &repository,
            RetentionApplyInput {
                scope: scope(),
                scope_revision: "scope-1".to_string(),
                retention_preset: ChatRetentionPreset::ChatRetentionPreset30Days as i32,
                physical_bytes_before: 100,
                now_unix_ms: 40 * DAY_MILLIS,
            },
        )
        .unwrap();

        assert_eq!(
            progress.policy.retention_preset,
            ChatRetentionPreset::ChatRetentionPreset30Days as i32
        );
        assert_eq!(
            progress.commit.operation.state,
            crate::proto::chat::ChatStorageOperationState::Compacting
        );
        assert_eq!(progress.commit.pruned_projection_count, 1);
        assert_eq!(
            repository
                .committed
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .boundaries[0]
                .pruned_through_sequence,
            1
        );
    }

    #[test]
    fn ordinary_history_never_crosses_the_floor() {
        let floor = RetentionFloor {
            conversation_id: "conversation-a".to_string(),
            pruned_through_sequence: 9,
            authority_event_hash: [9; 32],
            policy_cutoff_unix_ms: Some(1_000),
            updated_at_unix_ms: 2_000,
        };
        assert!(!sequence_is_above_retention_floor(9, Some(&floor)));
        assert!(!sequence_is_above_retention_floor(8, Some(&floor)));
        assert!(sequence_is_above_retention_floor(10, Some(&floor)));
    }
}
