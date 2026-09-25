pub mod entry;
pub mod error;
mod fairness;
mod migration;
mod storage;

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use prost::Message;

use self::entry::{decode_admission, retry_decision, RetryDecision, ValidatedCommand};
pub use self::entry::{
    CommandScope, DispatchLease, ProductCommandState, ScopeKeyMetadata, TrustedCommandKey,
    MAX_ACTIVE_ORDERING_KEYS, MAX_PARTITION_BYTES, MAX_PAYLOAD_BYTES, MAX_TRANSPORT_ATTEMPTS,
    MAX_UNRESOLVED_COMMANDS, SCHEMA_REVISION,
};
pub use self::error::{LedgerCapacityExhaustionCause, LedgerError, LedgerErrorCode, LedgerResult};
use self::fairness::FairScheduler;
pub use self::migration::LegacyLedgerPaths;
pub use self::storage::{AdmissionOutcome, ProjectionCheckpoint};
use self::storage::{FenceOutcome, LedgerStorage};
use crate::runtime::reliability_proto::peers_touch::model::mobile::v1::{
    MobileDurableCommandEnvelopeV2, MobileDurableCommandErrorCode, MobileDurableCommandState,
};
use crate::runtime::reliability_proto::peers_touch::model::social::v1::{
    FriendRequestCommandLookupState, FriendRequestCommandResultKind,
    LookupFriendRequestCommandResultResponse, LookupSocialRelationshipCommandResultResponse,
    SocialRelationshipCommandLookupState, SocialRelationshipCommandResultKind,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerPaths {
    pub database_path: PathBuf,
    pub legacy_v1: Option<LegacyLedgerPaths>,
}

pub struct LedgerActivation {
    pub paths: LedgerPaths,
    pub scope: CommandScope,
    pub trusted_command_key: TrustedCommandKey,
    pub runtime_generation: u64,
    pub now_ms: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DispatchFenceResult {
    Ready(DispatchLease),
    NotDispatchable(MobileDurableCommandEnvelopeV2),
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuthoritativeTransition {
    pub envelope: MobileDurableCommandEnvelopeV2,
    pub retry_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandPayloadKind {
    FriendRequest,
    SocialRelationship,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerCapacityStatus {
    pub record_count: u64,
    pub record_limit: u64,
    pub byte_usage: u64,
    pub byte_limit: u64,
    pub exhaustion_causes: Vec<LedgerCapacityExhaustionCause>,
}

impl Default for LedgerCapacityStatus {
    fn default() -> Self {
        Self {
            record_count: 0,
            record_limit: MAX_UNRESOLVED_COMMANDS,
            byte_usage: 0,
            byte_limit: MAX_PARTITION_BYTES,
            exhaustion_causes: Vec::new(),
        }
    }
}

pub struct CommandLedger {
    inner: Mutex<Option<LedgerInner>>,
}

struct CapacityRejection {
    attempted_payload_bytes: u64,
    causes: Vec<LedgerCapacityExhaustionCause>,
}

struct LedgerInner {
    storage: LedgerStorage,
    scheduler: FairScheduler,
    scope: CommandScope,
    runtime_generation: u64,
    paths: LedgerPaths,
    capacity_rejection: Option<CapacityRejection>,
}

impl Default for CommandLedger {
    fn default() -> Self {
        Self::new()
    }
}

impl CommandLedger {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    pub fn activate(&self, activation: LedgerActivation) -> LedgerResult<()> {
        let mut guard = self.lock()?;
        if guard.is_some() {
            return Err(LedgerError::new(
                LedgerErrorCode::AlreadyInitialized,
                "activate command ledger",
                "a Station/PTID partition is already active",
            ));
        }
        validate_paths(&activation.paths)?;
        if let Some(legacy_paths) = activation.paths.legacy_v1.as_ref() {
            migration::quarantine_legacy_if_present(legacy_paths)?;
        }
        let storage = LedgerStorage::open(
            &activation.paths.database_path,
            activation.scope.clone(),
            activation.trusted_command_key,
            activation.now_ms,
        )?;
        *guard = Some(LedgerInner {
            storage,
            scheduler: FairScheduler::new(),
            scope: activation.scope,
            runtime_generation: activation.runtime_generation,
            paths: activation.paths,
            capacity_rejection: None,
        });
        Ok(())
    }

    pub fn deactivate(&self) -> LedgerResult<()> {
        let mut guard = self.lock()?;
        *guard = None;
        Ok(())
    }

    pub fn active_scope(&self) -> LedgerResult<Option<CommandScope>> {
        Ok(self.lock()?.as_ref().map(|inner| inner.scope.clone()))
    }

    pub fn active_paths(&self) -> LedgerResult<Option<LedgerPaths>> {
        Ok(self.lock()?.as_ref().map(|inner| inner.paths.clone()))
    }

    pub fn rebind_runtime_generation(&self, runtime_generation: u64) -> LedgerResult<()> {
        let mut guard = self.lock()?;
        let inner = active_mut(&mut guard)?;
        if runtime_generation < inner.runtime_generation {
            return Err(LedgerError::new(
                LedgerErrorCode::StateConflict,
                "rebind command-ledger generation",
                "new runtime generation is older than the active generation",
            ));
        }
        inner.runtime_generation = runtime_generation;
        Ok(())
    }

    pub fn admit_generated_envelope(
        &self,
        exact_envelope_bytes: &[u8],
    ) -> LedgerResult<AdmissionOutcome> {
        let mut guard = self.lock()?;
        let inner = active_mut(&mut guard)?;
        let command =
            decode_admission(exact_envelope_bytes, &inner.scope, inner.runtime_generation)?;
        let attempted_payload_bytes = command.payload_size() as u64;
        match inner.storage.admit(&command) {
            Ok(outcome) => Ok(outcome),
            Err(error) => {
                if error.code == LedgerErrorCode::CapacityExceeded {
                    inner.capacity_rejection = Some(CapacityRejection {
                        attempted_payload_bytes,
                        causes: error.capacity_exhaustion_causes().to_vec(),
                    });
                }
                Err(error)
            }
        }
    }

    pub fn get(&self, command_id: &str) -> LedgerResult<Option<MobileDurableCommandEnvelopeV2>> {
        let guard = self.lock()?;
        let inner = active(&guard)?;
        Ok(inner
            .storage
            .get(command_id)?
            .map(|command| command.envelope))
    }

    pub fn list(&self) -> LedgerResult<Vec<MobileDurableCommandEnvelopeV2>> {
        let guard = self.lock()?;
        let inner = active(&guard)?;
        Ok(inner
            .storage
            .list()?
            .into_iter()
            .map(|command| command.envelope)
            .collect())
    }

    pub fn capacity_status(&self) -> LedgerResult<LedgerCapacityStatus> {
        let mut guard = self.lock()?;
        let Some(inner) = guard.as_mut() else {
            return Ok(LedgerCapacityStatus::default());
        };
        let usage = inner.storage.capacity_usage()?;
        let mut exhaustion_causes = Vec::new();
        if usage.record_count >= MAX_UNRESOLVED_COMMANDS {
            exhaustion_causes.push(LedgerCapacityExhaustionCause::RecordCount);
        }
        if usage.byte_usage >= MAX_PARTITION_BYTES {
            exhaustion_causes.push(LedgerCapacityExhaustionCause::ByteCapacity);
        }
        let mut rejection_still_active = false;
        if let Some(rejection) = inner.capacity_rejection.as_ref() {
            for cause in &rejection.causes {
                let still_exhausted = match cause {
                    LedgerCapacityExhaustionCause::RecordCount => {
                        usage.record_count >= MAX_UNRESOLVED_COMMANDS
                    }
                    LedgerCapacityExhaustionCause::ByteCapacity => {
                        usage
                            .byte_usage
                            .saturating_add(rejection.attempted_payload_bytes)
                            > MAX_PARTITION_BYTES
                    }
                };
                if still_exhausted && !exhaustion_causes.contains(cause) {
                    exhaustion_causes.push(*cause);
                }
                rejection_still_active |= still_exhausted;
            }
        }
        if !rejection_still_active {
            inner.capacity_rejection = None;
        }
        Ok(LedgerCapacityStatus {
            record_count: usage.record_count,
            record_limit: MAX_UNRESOLVED_COMMANDS,
            byte_usage: usage.byte_usage,
            byte_limit: MAX_PARTITION_BYTES,
            exhaustion_causes,
        })
    }

    pub fn next_for_dispatch(
        &self,
        runtime_generation: u64,
        now_ms: i64,
    ) -> LedgerResult<Option<DispatchLease>> {
        self.next_for_dispatch_kind(runtime_generation, now_ms, None)
    }

    pub fn next_for_dispatch_kind(
        &self,
        runtime_generation: u64,
        now_ms: i64,
        payload_kind: Option<CommandPayloadKind>,
    ) -> LedgerResult<Option<DispatchLease>> {
        let mut guard = self.lock()?;
        let inner = active_mut(&mut guard)?;
        verify_generation(inner, runtime_generation)?;
        let mut candidates = inner.storage.dispatch_candidates(now_ms)?;
        while let Some(candidate) = inner.scheduler.select(&candidates) {
            if let Some(expected_kind) = payload_kind {
                let Some(command) = inner.storage.get(&candidate.command_id)? else {
                    candidates.retain(|item| item.command_id != candidate.command_id);
                    continue;
                };
                let actual_kind = match command.envelope.payload.as_ref() {
                    Some(
                        crate::runtime::reliability_proto::peers_touch::model::mobile::v1::mobile_durable_command_envelope_v2::Payload::FriendRequest(_),
                    ) => CommandPayloadKind::FriendRequest,
                    Some(
                        crate::runtime::reliability_proto::peers_touch::model::mobile::v1::mobile_durable_command_envelope_v2::Payload::SocialRelationship(_),
                    ) => CommandPayloadKind::SocialRelationship,
                    None => {
                        return Err(LedgerError::for_command(
                            LedgerErrorCode::InvalidEnvelope,
                            "select generated command for dispatch",
                            &candidate.command_id,
                            "generated command payload is missing",
                        ))
                    }
                };
                if actual_kind != expected_kind {
                    candidates.retain(|item| item.command_id != candidate.command_id);
                    continue;
                }
            }
            match inner.storage.fence_dispatch(
                &candidate.command_id,
                candidate.expected_state,
                now_ms,
            ) {
                Ok(FenceOutcome::Dispatch(command)) => {
                    return Ok(Some(dispatch_lease(command, runtime_generation)));
                }
                Ok(FenceOutcome::NotDispatchable(_)) => {
                    candidates.retain(|item| item.command_id != candidate.command_id);
                }
                Err(error) if error.code == LedgerErrorCode::StateConflict => {
                    candidates.retain(|item| item.command_id != candidate.command_id);
                }
                Err(error) => return Err(error),
            }
        }
        Ok(None)
    }

    pub fn compare_and_swap_dispatch_fence(
        &self,
        command_id: &str,
        expected_state: MobileDurableCommandState,
        runtime_generation: u64,
        now_ms: i64,
    ) -> LedgerResult<DispatchFenceResult> {
        let mut guard = self.lock()?;
        let inner = active_mut(&mut guard)?;
        verify_generation(inner, runtime_generation)?;
        match inner
            .storage
            .fence_dispatch(command_id, expected_state, now_ms)?
        {
            FenceOutcome::Dispatch(command) => Ok(DispatchFenceResult::Ready(dispatch_lease(
                command,
                runtime_generation,
            ))),
            FenceOutcome::NotDispatchable(command) => {
                Ok(DispatchFenceResult::NotDispatchable(command.envelope))
            }
        }
    }

    pub fn mark_submitting(
        &self,
        command_id: &str,
        runtime_generation: u64,
        now_ms: i64,
    ) -> LedgerResult<MobileDurableCommandEnvelopeV2> {
        self.transition(
            command_id,
            runtime_generation,
            &[MobileDurableCommandState::DispatchFenced],
            MobileDurableCommandState::Submitting,
            MobileDurableCommandErrorCode::Unspecified,
            now_ms,
            None,
        )
    }

    pub fn mark_unknown(
        &self,
        command_id: &str,
        runtime_generation: u64,
        typed_error: MobileDurableCommandErrorCode,
        now_ms: i64,
    ) -> LedgerResult<MobileDurableCommandEnvelopeV2> {
        if !matches!(
            typed_error,
            MobileDurableCommandErrorCode::Transport
                | MobileDurableCommandErrorCode::Deadline
                | MobileDurableCommandErrorCode::ResponseDecode
                | MobileDurableCommandErrorCode::LocalUnavailable
                | MobileDurableCommandErrorCode::ResultMismatch
        ) {
            return Err(LedgerError::for_command(
                LedgerErrorCode::InvalidEnvelope,
                "mark command outcome unknown",
                command_id,
                "unknown outcome requires a generated retry/reconciliation error code",
            ));
        }
        self.transition(
            command_id,
            runtime_generation,
            &[
                MobileDurableCommandState::DispatchFenced,
                MobileDurableCommandState::Submitting,
            ],
            MobileDurableCommandState::UnknownOutcome,
            typed_error,
            now_ms,
            None,
        )
    }

    pub fn mark_terminal_failure(
        &self,
        command_id: &str,
        expected_state: MobileDurableCommandState,
        runtime_generation: u64,
        typed_error: MobileDurableCommandErrorCode,
        now_ms: i64,
    ) -> LedgerResult<MobileDurableCommandEnvelopeV2> {
        if !matches!(
            expected_state,
            MobileDurableCommandState::Queued
                | MobileDurableCommandState::Submitting
                | MobileDurableCommandState::Reconciling
        ) || !matches!(
            typed_error,
            MobileDurableCommandErrorCode::Invalid
                | MobileDurableCommandErrorCode::Unauthorized
                | MobileDurableCommandErrorCode::PolicyRejected
                | MobileDurableCommandErrorCode::DomainExpired
        ) {
            return Err(LedgerError::for_command(
                LedgerErrorCode::InvalidEnvelope,
                "mark command terminal failure",
                command_id,
                "terminal failure requires an accepted source state and deterministic typed error",
            ));
        }
        self.transition(
            command_id,
            runtime_generation,
            &[expected_state],
            MobileDurableCommandState::FailedTerminal,
            typed_error,
            now_ms,
            None,
        )
    }

    pub fn cancel_before_dispatch(
        &self,
        command_id: &str,
        expected_state: MobileDurableCommandState,
        runtime_generation: u64,
        now_ms: i64,
    ) -> LedgerResult<MobileDurableCommandEnvelopeV2> {
        if !matches!(
            expected_state,
            MobileDurableCommandState::Queued | MobileDurableCommandState::RetryWait
        ) {
            return Err(LedgerError::for_command(
                LedgerErrorCode::StateConflict,
                "cancel command before dispatch",
                command_id,
                "cancellation requires queued or retry_wait expected state",
            ));
        }
        self.transition(
            command_id,
            runtime_generation,
            &[expected_state],
            MobileDurableCommandState::Cancelled,
            MobileDurableCommandErrorCode::Unspecified,
            now_ms,
            None,
        )
    }

    pub fn begin_reconciliation(
        &self,
        command_id: &str,
        expected_state: MobileDurableCommandState,
        runtime_generation: u64,
        now_ms: i64,
    ) -> LedgerResult<MobileDurableCommandEnvelopeV2> {
        if !matches!(
            expected_state,
            MobileDurableCommandState::UnknownOutcome | MobileDurableCommandState::Unresolved
        ) {
            return Err(LedgerError::for_command(
                LedgerErrorCode::StateConflict,
                "begin authoritative reconciliation",
                command_id,
                "reconciliation requires unknown_outcome or unresolved",
            ));
        }
        self.transition(
            command_id,
            runtime_generation,
            &[expected_state],
            MobileDurableCommandState::Reconciling,
            MobileDurableCommandErrorCode::Unspecified,
            now_ms,
            None,
        )
    }

    pub fn mark_reconciliation_unresolved(
        &self,
        command_id: &str,
        runtime_generation: u64,
        typed_error: MobileDurableCommandErrorCode,
        now_ms: i64,
    ) -> LedgerResult<MobileDurableCommandEnvelopeV2> {
        if !matches!(
            typed_error,
            MobileDurableCommandErrorCode::Transport
                | MobileDurableCommandErrorCode::Deadline
                | MobileDurableCommandErrorCode::ResponseDecode
                | MobileDurableCommandErrorCode::LocalUnavailable
                | MobileDurableCommandErrorCode::ResultMismatch
        ) {
            return Err(LedgerError::for_command(
                LedgerErrorCode::InvalidEnvelope,
                "finish authoritative reconciliation",
                command_id,
                "unresolved reconciliation requires a generated lookup error code",
            ));
        }
        self.transition(
            command_id,
            runtime_generation,
            &[MobileDurableCommandState::Reconciling],
            MobileDurableCommandState::Unresolved,
            typed_error,
            now_ms,
            None,
        )
    }

    pub fn transition_from_authoritative_lookup(
        &self,
        command_id: &str,
        exact_lookup_bytes: &[u8],
        runtime_generation: u64,
        now_ms: i64,
        retry_entropy: u64,
    ) -> LedgerResult<AuthoritativeTransition> {
        let mut guard = self.lock()?;
        let inner = active_mut(&mut guard)?;
        verify_generation(inner, runtime_generation)?;
        let current = inner.storage.get(command_id)?.ok_or_else(|| {
            LedgerError::for_command(
                LedgerErrorCode::CommandNotFound,
                "apply authoritative command lookup",
                command_id,
                "command does not exist",
            )
        })?;
        let lookup = decode_lookup(&current, exact_lookup_bytes)?;
        let current_state = current.state();
        if lookup.command_id != current.envelope.command_id
            || lookup.command_payload_sha256 != current.envelope.payload_sha256
        {
            let target = if current_state == MobileDurableCommandState::Reconciling {
                MobileDurableCommandState::Unresolved
            } else if current_state == MobileDurableCommandState::Submitting {
                MobileDurableCommandState::UnknownOutcome
            } else {
                return Err(LedgerError::for_command(
                    LedgerErrorCode::CommandConflict,
                    "apply authoritative command lookup",
                    command_id,
                    "lookup identity differs outside a resolvable state",
                ));
            };
            let command = inner.storage.transition(
                command_id,
                &[current_state],
                target,
                MobileDurableCommandErrorCode::ResultMismatch,
                now_ms,
                None,
            )?;
            return Ok(AuthoritativeTransition {
                envelope: command.envelope,
                retry_at_ms: None,
            });
        }

        let (next_state, typed_error, retry_at_ms) = match lookup.state {
            AuthoritativeLookupState::NotFound => {
                if !matches!(
                    current_state,
                    MobileDurableCommandState::Submitting | MobileDurableCommandState::Reconciling
                ) {
                    return Err(LedgerError::for_command(
                        LedgerErrorCode::StateConflict,
                        "apply authoritative command lookup",
                        command_id,
                        "not_found requires submitting or reconciling",
                    ));
                }
                let expires_at_ms = entry::timestamp_to_millis(
                    current.envelope.expires_at.as_ref(),
                    "expires_at",
                    command_id,
                )?;
                match retry_decision(
                    current.envelope.attempt_count,
                    expires_at_ms,
                    now_ms,
                    retry_entropy,
                ) {
                    RetryDecision::RetryAt(retry_at_ms) => (
                        MobileDurableCommandState::RetryWait,
                        MobileDurableCommandErrorCode::Unspecified,
                        Some(retry_at_ms),
                    ),
                    RetryDecision::Unresolved(error)
                        if current_state == MobileDurableCommandState::Submitting =>
                    {
                        inner.storage.transition(
                            command_id,
                            &[MobileDurableCommandState::Submitting],
                            MobileDurableCommandState::RetryWait,
                            error,
                            now_ms,
                            Some(now_ms),
                        )?;
                        let command = inner.storage.transition(
                            command_id,
                            &[MobileDurableCommandState::RetryWait],
                            MobileDurableCommandState::Unresolved,
                            error,
                            now_ms,
                            None,
                        )?;
                        return Ok(AuthoritativeTransition {
                            envelope: command.envelope,
                            retry_at_ms: None,
                        });
                    }
                    RetryDecision::Unresolved(error) => {
                        (MobileDurableCommandState::Unresolved, error, None)
                    }
                }
            }
            AuthoritativeLookupState::AcceptedPending => (
                MobileDurableCommandState::AcceptedPending,
                MobileDurableCommandErrorCode::Unspecified,
                None,
            ),
            AuthoritativeLookupState::TerminalResult => {
                let result_kind = lookup.result_kind.ok_or_else(|| {
                    LedgerError::for_command(
                        LedgerErrorCode::InvalidEnvelope,
                        "apply authoritative command lookup",
                        command_id,
                        "terminal lookup is missing its generated result",
                    )
                })?;
                match result_kind {
                    AuthoritativeResultKind::Committed | AuthoritativeResultKind::Duplicate => (
                        MobileDurableCommandState::Committed,
                        MobileDurableCommandErrorCode::Unspecified,
                        None,
                    ),
                    AuthoritativeResultKind::Rejected | AuthoritativeResultKind::Conflict => (
                        MobileDurableCommandState::FailedTerminal,
                        MobileDurableCommandErrorCode::PolicyRejected,
                        None,
                    ),
                }
            }
            AuthoritativeLookupState::Unresolved => match current_state {
                MobileDurableCommandState::Submitting => (
                    MobileDurableCommandState::UnknownOutcome,
                    MobileDurableCommandErrorCode::LocalUnavailable,
                    None,
                ),
                MobileDurableCommandState::Reconciling => (
                    MobileDurableCommandState::Unresolved,
                    MobileDurableCommandErrorCode::LocalUnavailable,
                    None,
                ),
                _ => {
                    return Err(LedgerError::for_command(
                        LedgerErrorCode::StateConflict,
                        "apply authoritative command lookup",
                        command_id,
                        "unresolved lookup requires submitting or reconciling",
                    ));
                }
            },
        };
        let command = inner.storage.transition(
            command_id,
            &[current_state],
            next_state,
            typed_error,
            now_ms,
            retry_at_ms,
        )?;
        Ok(AuthoritativeTransition {
            envelope: command.envelope,
            retry_at_ms,
        })
    }

    pub fn persist_projection_checkpoint_and_remove(
        &self,
        command_id: &str,
        exact_lookup_bytes: &[u8],
        runtime_generation: u64,
        now_ms: i64,
    ) -> LedgerResult<ProjectionCheckpoint> {
        let mut guard = self.lock()?;
        let inner = active_mut(&mut guard)?;
        verify_generation(inner, runtime_generation)?;
        inner
            .storage
            .persist_checkpoint_and_remove(command_id, exact_lookup_bytes, now_ms)
    }

    pub fn list_projection_checkpoints(&self) -> LedgerResult<Vec<ProjectionCheckpoint>> {
        let guard = self.lock()?;
        active(&guard)?.storage.list_checkpoints()
    }

    pub fn acknowledge_projection_checkpoint(
        &self,
        command_id: &str,
        payload_sha256: &[u8],
    ) -> LedgerResult<()> {
        let mut guard = self.lock()?;
        active_mut(&mut guard)?
            .storage
            .acknowledge_checkpoint(command_id, payload_sha256)
    }

    pub fn acknowledge_terminal_failure(
        &self,
        command_id: &str,
        runtime_generation: u64,
        now_ms: i64,
    ) -> LedgerResult<()> {
        let mut guard = self.lock()?;
        let inner = active_mut(&mut guard)?;
        verify_generation(inner, runtime_generation)?;
        let current = inner.storage.get(command_id)?.ok_or_else(|| {
            LedgerError::for_command(
                LedgerErrorCode::CommandNotFound,
                "acknowledge terminal command",
                command_id,
                "command does not exist",
            )
        })?;
        match current.state() {
            MobileDurableCommandState::FailedTerminal => {
                inner.storage.transition(
                    command_id,
                    &[MobileDurableCommandState::FailedTerminal],
                    MobileDurableCommandState::Acknowledged,
                    current
                        .envelope
                        .typed_last_error
                        .try_into()
                        .unwrap_or(MobileDurableCommandErrorCode::PolicyRejected),
                    now_ms,
                    None,
                )?;
            }
            MobileDurableCommandState::Acknowledged => {}
            actual => {
                return Err(LedgerError::for_command(
                    LedgerErrorCode::StateConflict,
                    "acknowledge terminal command",
                    command_id,
                    format!("expected failed_terminal or acknowledged, found {actual:?}"),
                ));
            }
        }
        inner
            .storage
            .purge_terminal(command_id, MobileDurableCommandState::Acknowledged)
    }

    pub fn purge_cancelled(&self, command_id: &str) -> LedgerResult<()> {
        let mut guard = self.lock()?;
        active_mut(&mut guard)?
            .storage
            .purge_terminal(command_id, MobileDurableCommandState::Cancelled)
    }

    pub fn discard_unresolved_tracking(
        &self,
        command_id: &str,
        runtime_generation: u64,
        now_ms: i64,
    ) -> LedgerResult<()> {
        let mut guard = self.lock()?;
        let inner = active_mut(&mut guard)?;
        verify_generation(inner, runtime_generation)?;
        let current = inner.storage.get(command_id)?.ok_or_else(|| {
            LedgerError::for_command(
                LedgerErrorCode::CommandNotFound,
                "discard unresolved command tracking",
                command_id,
                "command does not exist",
            )
        })?;
        match current.state() {
            MobileDurableCommandState::Unresolved => {
                inner.storage.transition(
                    command_id,
                    &[MobileDurableCommandState::Unresolved],
                    MobileDurableCommandState::Discarded,
                    current
                        .envelope
                        .typed_last_error
                        .try_into()
                        .unwrap_or(MobileDurableCommandErrorCode::LocalUnavailable),
                    now_ms,
                    None,
                )?;
            }
            MobileDurableCommandState::Discarded => {}
            actual => {
                return Err(LedgerError::for_command(
                    LedgerErrorCode::StateConflict,
                    "discard unresolved command tracking",
                    command_id,
                    format!("expected unresolved or discarded, found {actual:?}"),
                ));
            }
        }
        inner
            .storage
            .purge_terminal(command_id, MobileDurableCommandState::Discarded)
    }

    pub fn recovery_counts(&self) -> LedgerResult<(u64, u64)> {
        let guard = self.lock()?;
        let inner = match guard.as_ref() {
            Some(inner) => inner,
            None => return Ok((0, 0)),
        };
        let pending = inner.storage.count_states(&[
            MobileDurableCommandState::Queued,
            MobileDurableCommandState::DispatchFenced,
            MobileDurableCommandState::Submitting,
            MobileDurableCommandState::AcceptedPending,
            MobileDurableCommandState::RetryWait,
            MobileDurableCommandState::Checkpointing,
        ])?;
        let unknown = inner.storage.count_states(&[
            MobileDurableCommandState::UnknownOutcome,
            MobileDurableCommandState::Reconciling,
            MobileDurableCommandState::Unresolved,
        ])?;
        Ok((pending, unknown))
    }

    pub fn discard_legacy_archive(paths: &LegacyLedgerPaths) -> LedgerResult<()> {
        migration::discard_legacy_archive(paths)
    }

    pub fn remove_scope_database_for_authorized_reset(
        database_path: &std::path::Path,
    ) -> LedgerResult<()> {
        migration::remove_database_files(database_path)
    }

    fn transition(
        &self,
        command_id: &str,
        runtime_generation: u64,
        expected_states: &[MobileDurableCommandState],
        next_state: MobileDurableCommandState,
        typed_error: MobileDurableCommandErrorCode,
        now_ms: i64,
        next_attempt_at_ms: Option<i64>,
    ) -> LedgerResult<MobileDurableCommandEnvelopeV2> {
        let mut guard = self.lock()?;
        let inner = active_mut(&mut guard)?;
        verify_generation(inner, runtime_generation)?;
        Ok(inner
            .storage
            .transition(
                command_id,
                expected_states,
                next_state,
                typed_error,
                now_ms,
                next_attempt_at_ms,
            )?
            .envelope)
    }

    fn lock(&self) -> LedgerResult<MutexGuard<'_, Option<LedgerInner>>> {
        self.inner.lock().map_err(|_| {
            LedgerError::new(
                LedgerErrorCode::Storage,
                "lock command ledger",
                "command ledger mutex is poisoned",
            )
        })
    }
}

fn active(guard: &Option<LedgerInner>) -> LedgerResult<&LedgerInner> {
    guard.as_ref().ok_or_else(|| {
        LedgerError::new(
            LedgerErrorCode::NotInitialized,
            "access command ledger",
            "no Station/PTID partition is active",
        )
    })
}

fn active_mut(guard: &mut Option<LedgerInner>) -> LedgerResult<&mut LedgerInner> {
    guard.as_mut().ok_or_else(|| {
        LedgerError::new(
            LedgerErrorCode::NotInitialized,
            "access command ledger",
            "no Station/PTID partition is active",
        )
    })
}

fn verify_generation(inner: &LedgerInner, runtime_generation: u64) -> LedgerResult<()> {
    if runtime_generation != inner.runtime_generation {
        return Err(LedgerError::new(
            LedgerErrorCode::StateConflict,
            "verify command callback generation",
            "callback belongs to a stale runtime generation",
        ));
    }
    Ok(())
}

fn dispatch_lease(command: ValidatedCommand, runtime_generation: u64) -> DispatchLease {
    DispatchLease {
        envelope: command.envelope,
        exact_envelope_bytes: command.encoded_envelope,
        exact_payload_bytes: command.payload_bytes,
        runtime_generation,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuthoritativeLookupState {
    NotFound,
    AcceptedPending,
    TerminalResult,
    Unresolved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuthoritativeResultKind {
    Committed,
    Duplicate,
    Rejected,
    Conflict,
}

struct AuthoritativeLookup {
    state: AuthoritativeLookupState,
    command_id: String,
    command_payload_sha256: Vec<u8>,
    result_kind: Option<AuthoritativeResultKind>,
}

fn decode_lookup(
    command: &ValidatedCommand,
    exact_lookup_bytes: &[u8],
) -> LedgerResult<AuthoritativeLookup> {
    match command.envelope.payload.as_ref() {
        Some(
            crate::runtime::reliability_proto::peers_touch::model::mobile::v1::mobile_durable_command_envelope_v2::Payload::FriendRequest(_),
        ) => decode_friend_request_lookup(command.command_id(), exact_lookup_bytes),
        Some(
            crate::runtime::reliability_proto::peers_touch::model::mobile::v1::mobile_durable_command_envelope_v2::Payload::SocialRelationship(_),
        ) => decode_social_relationship_lookup(command.command_id(), exact_lookup_bytes),
        None => Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "decode authoritative command lookup",
            command.command_id(),
            "generated command payload is missing",
        )),
    }
}

fn decode_friend_request_lookup(
    command_id: &str,
    exact_lookup_bytes: &[u8],
) -> LedgerResult<AuthoritativeLookup> {
    let lookup =
        LookupFriendRequestCommandResultResponse::decode(exact_lookup_bytes).map_err(|error| {
            LedgerError::for_command(
                LedgerErrorCode::Serialization,
                "decode authoritative command lookup",
                command_id,
                error.to_string(),
            )
        })?;
    if lookup.encode_to_vec() != exact_lookup_bytes {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "decode authoritative command lookup",
            command_id,
            "lookup bytes are not the canonical generated encoding",
        ));
    }
    let state = match FriendRequestCommandLookupState::try_from(lookup.state).map_err(|_| {
        LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "decode authoritative command lookup",
            command_id,
            "lookup state is unknown",
        )
    })? {
        FriendRequestCommandLookupState::NotFound => AuthoritativeLookupState::NotFound,
        FriendRequestCommandLookupState::AcceptedPending => {
            AuthoritativeLookupState::AcceptedPending
        }
        FriendRequestCommandLookupState::TerminalResult => AuthoritativeLookupState::TerminalResult,
        FriendRequestCommandLookupState::Unresolved => AuthoritativeLookupState::Unresolved,
        FriendRequestCommandLookupState::Unspecified => {
            return Err(LedgerError::for_command(
                LedgerErrorCode::InvalidEnvelope,
                "decode authoritative command lookup",
                command_id,
                "lookup state is unspecified",
            ))
        }
    };
    let result_kind = lookup
        .terminal_result
        .as_ref()
        .map(|result| {
            if result.command_id != lookup.command_id
                || result.command_payload_sha256 != lookup.command_payload_sha256
            {
                return Err(LedgerError::for_command(
                    LedgerErrorCode::CommandConflict,
                    "decode authoritative command lookup",
                    command_id,
                    "terminal result identity or hash differs",
                ));
            }
            match FriendRequestCommandResultKind::try_from(result.kind).map_err(|_| {
                LedgerError::for_command(
                    LedgerErrorCode::InvalidEnvelope,
                    "decode authoritative command lookup",
                    command_id,
                    "terminal result kind is unknown",
                )
            })? {
                FriendRequestCommandResultKind::Committed => Ok(AuthoritativeResultKind::Committed),
                FriendRequestCommandResultKind::Duplicate => Ok(AuthoritativeResultKind::Duplicate),
                FriendRequestCommandResultKind::Rejected => Ok(AuthoritativeResultKind::Rejected),
                FriendRequestCommandResultKind::Conflict => Ok(AuthoritativeResultKind::Conflict),
                FriendRequestCommandResultKind::Unspecified => Err(LedgerError::for_command(
                    LedgerErrorCode::InvalidEnvelope,
                    "decode authoritative command lookup",
                    command_id,
                    "terminal result kind is unspecified",
                )),
            }
        })
        .transpose()?;
    Ok(AuthoritativeLookup {
        state,
        command_id: lookup.command_id,
        command_payload_sha256: lookup.command_payload_sha256,
        result_kind,
    })
}

fn decode_social_relationship_lookup(
    command_id: &str,
    exact_lookup_bytes: &[u8],
) -> LedgerResult<AuthoritativeLookup> {
    let lookup = LookupSocialRelationshipCommandResultResponse::decode(exact_lookup_bytes)
        .map_err(|error| {
            LedgerError::for_command(
                LedgerErrorCode::Serialization,
                "decode authoritative relationship lookup",
                command_id,
                error.to_string(),
            )
        })?;
    if lookup.encode_to_vec() != exact_lookup_bytes {
        return Err(LedgerError::for_command(
            LedgerErrorCode::InvalidEnvelope,
            "decode authoritative relationship lookup",
            command_id,
            "lookup bytes are not the canonical generated encoding",
        ));
    }
    let state =
        match SocialRelationshipCommandLookupState::try_from(lookup.state).map_err(|_| {
            LedgerError::for_command(
                LedgerErrorCode::InvalidEnvelope,
                "decode authoritative relationship lookup",
                command_id,
                "lookup state is unknown",
            )
        })? {
            SocialRelationshipCommandLookupState::NotFound => AuthoritativeLookupState::NotFound,
            SocialRelationshipCommandLookupState::AcceptedPending => {
                AuthoritativeLookupState::AcceptedPending
            }
            SocialRelationshipCommandLookupState::TerminalResult => {
                AuthoritativeLookupState::TerminalResult
            }
            SocialRelationshipCommandLookupState::Unresolved => {
                AuthoritativeLookupState::Unresolved
            }
            SocialRelationshipCommandLookupState::Unspecified => {
                return Err(LedgerError::for_command(
                    LedgerErrorCode::InvalidEnvelope,
                    "decode authoritative relationship lookup",
                    command_id,
                    "lookup state is unspecified",
                ))
            }
        };
    let result_kind = lookup
        .terminal_result
        .as_ref()
        .map(|result| {
            if result.command_id != lookup.command_id
                || result.command_payload_sha256 != lookup.command_payload_sha256
            {
                return Err(LedgerError::for_command(
                    LedgerErrorCode::CommandConflict,
                    "decode authoritative relationship lookup",
                    command_id,
                    "terminal result identity or hash differs",
                ));
            }
            match SocialRelationshipCommandResultKind::try_from(result.kind).map_err(|_| {
                LedgerError::for_command(
                    LedgerErrorCode::InvalidEnvelope,
                    "decode authoritative relationship lookup",
                    command_id,
                    "terminal result kind is unknown",
                )
            })? {
                SocialRelationshipCommandResultKind::Committed => {
                    Ok(AuthoritativeResultKind::Committed)
                }
                SocialRelationshipCommandResultKind::Duplicate => {
                    Ok(AuthoritativeResultKind::Duplicate)
                }
                SocialRelationshipCommandResultKind::Rejected => {
                    Ok(AuthoritativeResultKind::Rejected)
                }
                SocialRelationshipCommandResultKind::Conflict => {
                    Ok(AuthoritativeResultKind::Conflict)
                }
                SocialRelationshipCommandResultKind::Unspecified => Err(LedgerError::for_command(
                    LedgerErrorCode::InvalidEnvelope,
                    "decode authoritative relationship lookup",
                    command_id,
                    "terminal result kind is unspecified",
                )),
            }
        })
        .transpose()?;
    Ok(AuthoritativeLookup {
        state,
        command_id: lookup.command_id,
        command_payload_sha256: lookup.command_payload_sha256,
        result_kind,
    })
}

fn validate_paths(paths: &LedgerPaths) -> LedgerResult<()> {
    if let Some(legacy) = paths.legacy_v1.as_ref() {
        if legacy.database_path == paths.database_path {
            return Err(LedgerError::new(
                LedgerErrorCode::InvalidConfiguration,
                "activate command ledger",
                "v2 database and unscoped v1 database paths must differ",
            ));
        }
        if legacy.manifest_path == paths.database_path
            || legacy.quarantine_directory == paths.database_path
        {
            return Err(LedgerError::new(
                LedgerErrorCode::InvalidConfiguration,
                "activate command ledger",
                "v2 database path overlaps legacy quarantine paths",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
