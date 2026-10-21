use super::outcome::{OperationErrorCode, OperationFailure};
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum OperationKind {
    ContentPreKeyPublication = 1,
    OwnerSubmission = 2,
    RecoveryContinuation = 3,
    ObjectTransferCheckpoint = 4,
}

impl TryFrom<i32> for OperationKind {
    type Error = OperationFailure;

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::ContentPreKeyPublication),
            2 => Ok(Self::OwnerSubmission),
            3 => Ok(Self::RecoveryContinuation),
            4 => Ok(Self::ObjectTransferCheckpoint),
            _ => Err(invalid_record("secure content operation kind is invalid")),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum OperationState {
    Prepared = 1,
    Pending = 2,
    InFlight = 3,
    UnknownOutcome = 4,
    CommittedPendingReadback = 5,
    Committed = 6,
    RetryWait = 7,
    Terminal = 8,
    Cancelled = 9,
}

impl TryFrom<i32> for OperationState {
    type Error = OperationFailure;

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::Prepared),
            2 => Ok(Self::Pending),
            3 => Ok(Self::InFlight),
            4 => Ok(Self::UnknownOutcome),
            5 => Ok(Self::CommittedPendingReadback),
            6 => Ok(Self::Committed),
            7 => Ok(Self::RetryWait),
            8 => Ok(Self::Terminal),
            9 => Ok(Self::Cancelled),
            _ => Err(invalid_record("secure content operation state is invalid")),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperationRecord {
    pub operation_id: String,
    pub command_id: String,
    pub kind: OperationKind,
    pub state: OperationState,
    pub command_sha256: [u8; 32],
    pub session_generation: u64,
    pub lease_generation: u64,
    pub attempt_count: u32,
    pub next_attempt_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperationLease {
    pub record: OperationRecord,
    pub reconciles_unknown_outcome: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OperationFence<'a> {
    pub operation_id: &'a str,
    pub session_generation: u64,
    pub lease_generation: u64,
}

impl OperationRecord {
    pub fn new(
        operation_id: impl Into<String>,
        command_id: impl Into<String>,
        kind: OperationKind,
        state: OperationState,
        command_bytes: &[u8],
        now_unix_ms: i64,
    ) -> Result<Self, OperationFailure> {
        if !matches!(state, OperationState::Prepared | OperationState::Pending) {
            return Err(invalid_record(
                "new secure content operations must be prepared or pending",
            ));
        }
        let record = Self {
            operation_id: operation_id.into(),
            command_id: command_id.into(),
            kind,
            state,
            command_sha256: Sha256::digest(command_bytes).into(),
            session_generation: 0,
            lease_generation: 0,
            attempt_count: 0,
            next_attempt_at_unix_ms: 0,
            updated_at_unix_ms: now_unix_ms,
        };
        record.validate_command_bytes(command_bytes)?;
        Ok(record)
    }

    pub fn fence(&self) -> OperationFence<'_> {
        OperationFence {
            operation_id: &self.operation_id,
            session_generation: self.session_generation,
            lease_generation: self.lease_generation,
        }
    }

    pub fn validate(&self) -> Result<(), OperationFailure> {
        if !valid_identifier(&self.operation_id)
            || !valid_identifier(&self.command_id)
            || self.command_sha256.iter().all(|byte| *byte == 0)
            || self.next_attempt_at_unix_ms < 0
            || self.updated_at_unix_ms <= 0
        {
            return Err(invalid_record(
                "secure content operation record is incomplete",
            ));
        }
        match self.state {
            OperationState::Prepared | OperationState::Pending => {
                if self.lease_generation != 0 || self.attempt_count != 0 {
                    return Err(invalid_record(
                        "undispatched operation cannot hold a lease or attempt",
                    ));
                }
            }
            OperationState::InFlight
            | OperationState::UnknownOutcome
            | OperationState::CommittedPendingReadback
            | OperationState::Committed
            | OperationState::RetryWait
            | OperationState::Terminal
            | OperationState::Cancelled => {
                if self.session_generation == 0 || self.lease_generation == 0 {
                    return Err(invalid_record(
                        "dispatched operation must retain its generation fence",
                    ));
                }
            }
        }
        if self.state == OperationState::RetryWait && self.next_attempt_at_unix_ms == 0 {
            return Err(invalid_record(
                "retry-wait operation requires a retry deadline",
            ));
        }
        Ok(())
    }

    pub fn validate_command_bytes(&self, command_bytes: &[u8]) -> Result<(), OperationFailure> {
        self.validate()?;
        if command_bytes.is_empty()
            || Sha256::digest(command_bytes).as_slice() != self.command_sha256
        {
            return Err(OperationFailure::terminal(
                OperationErrorCode::IntegrityFailed,
                "secure content operation command bytes changed",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DispatchCause {
    ExplicitUserAction,
    InitialReconciliation,
    ReadbackAuthorizedRetry,
    RetryDeadlineReached,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperationCompletion {
    UnknownOutcome,
    CommittedPendingReadback,
    Committed,
    RetryAt(i64),
    Terminal,
    Cancelled,
}

pub fn acquire_operation(
    record: &OperationRecord,
    session_generation: u64,
    cause: DispatchCause,
    now_unix_ms: i64,
) -> Result<OperationLease, OperationFailure> {
    record.validate()?;
    if session_generation == 0 || now_unix_ms <= 0 {
        return Err(invalid_record(
            "operation acquisition requires a current session and clock",
        ));
    }

    let allowed = match record.state {
        OperationState::Prepared => cause == DispatchCause::ExplicitUserAction,
        OperationState::Pending => matches!(
            cause,
            DispatchCause::ExplicitUserAction | DispatchCause::InitialReconciliation
        ),
        OperationState::UnknownOutcome => cause == DispatchCause::ReadbackAuthorizedRetry,
        OperationState::RetryWait => {
            cause == DispatchCause::RetryDeadlineReached
                && record.next_attempt_at_unix_ms <= now_unix_ms
        }
        _ => false,
    };
    if !allowed {
        return Err(OperationFailure::terminal(
            OperationErrorCode::InvalidTransition,
            "secure content operation is not dispatchable for this cause",
        ));
    }

    let reconciles_unknown_outcome = record.state == OperationState::UnknownOutcome;
    let mut acquired = record.clone();
    acquired.state = OperationState::InFlight;
    acquired.session_generation = session_generation;
    acquired.lease_generation = acquired
        .lease_generation
        .checked_add(1)
        .ok_or_else(|| invalid_record("operation lease generation is exhausted"))?;
    acquired.attempt_count = acquired
        .attempt_count
        .checked_add(1)
        .ok_or_else(|| invalid_record("operation attempt count is exhausted"))?;
    acquired.next_attempt_at_unix_ms = 0;
    acquired.updated_at_unix_ms = now_unix_ms;
    acquired.validate()?;
    Ok(OperationLease {
        record: acquired,
        reconciles_unknown_outcome,
    })
}

pub fn complete_operation(
    current: &OperationRecord,
    fence: OperationFence<'_>,
    completion: OperationCompletion,
    now_unix_ms: i64,
) -> Result<OperationRecord, OperationFailure> {
    current.validate()?;
    validate_fence(current, fence)?;
    if current.state != OperationState::InFlight || now_unix_ms <= 0 {
        return Err(OperationFailure::terminal(
            OperationErrorCode::InvalidTransition,
            "only an in-flight operation can complete",
        ));
    }

    let (state, retry_at) = match completion {
        OperationCompletion::UnknownOutcome => (OperationState::UnknownOutcome, 0),
        OperationCompletion::CommittedPendingReadback => {
            (OperationState::CommittedPendingReadback, 0)
        }
        OperationCompletion::Committed => (OperationState::Committed, 0),
        OperationCompletion::RetryAt(retry_at) if retry_at > now_unix_ms => {
            (OperationState::RetryWait, retry_at)
        }
        OperationCompletion::RetryAt(_) => {
            return Err(OperationFailure::terminal(
                OperationErrorCode::InvalidTransition,
                "operation retry deadline must be in the future",
            ))
        }
        OperationCompletion::Terminal => (OperationState::Terminal, 0),
        OperationCompletion::Cancelled => (OperationState::Cancelled, 0),
    };

    let mut completed = current.clone();
    completed.state = state;
    completed.next_attempt_at_unix_ms = retry_at;
    completed.updated_at_unix_ms = now_unix_ms;
    completed.validate()?;
    Ok(completed)
}

pub fn recover_interrupted_operation(
    record: &OperationRecord,
    now_unix_ms: i64,
) -> Result<OperationRecord, OperationFailure> {
    record.validate()?;
    if record.state != OperationState::InFlight {
        return Ok(record.clone());
    }
    let mut recovered = record.clone();
    recovered.state = OperationState::UnknownOutcome;
    recovered.updated_at_unix_ms = now_unix_ms;
    recovered.validate()?;
    Ok(recovered)
}

pub(crate) fn validate_fence(
    current: &OperationRecord,
    fence: OperationFence<'_>,
) -> Result<(), OperationFailure> {
    if current.operation_id != fence.operation_id {
        return Err(OperationFailure::terminal(
            OperationErrorCode::LostLease,
            "operation identity does not match its lease",
        ));
    }
    if current.session_generation != fence.session_generation {
        return Err(OperationFailure::terminal(
            OperationErrorCode::StaleSessionGeneration,
            "operation session generation is stale",
        ));
    }
    if current.lease_generation != fence.lease_generation {
        return Err(OperationFailure::terminal(
            OperationErrorCode::LostLease,
            "operation lease generation is stale",
        ));
    }
    Ok(())
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && !value.as_bytes().contains(&0)
        && value.len() <= 255
}

fn invalid_record(detail: impl Into<String>) -> OperationFailure {
    OperationFailure::terminal(OperationErrorCode::InvalidRecord, detail)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(state: OperationState) -> OperationRecord {
        let dispatched = !matches!(state, OperationState::Prepared | OperationState::Pending);
        OperationRecord {
            operation_id: "operation-1".to_string(),
            command_id: "command-1".to_string(),
            kind: OperationKind::OwnerSubmission,
            state,
            command_sha256: [7; 32],
            session_generation: if dispatched { 3 } else { 0 },
            lease_generation: if dispatched { 2 } else { 0 },
            attempt_count: if dispatched { 2 } else { 0 },
            next_attempt_at_unix_ms: if state == OperationState::RetryWait {
                2_000
            } else {
                0
            },
            updated_at_unix_ms: 1_000,
        }
    }

    #[test]
    fn prepared_operations_require_explicit_user_dispatch() {
        let prepared = record(OperationState::Prepared);
        assert!(
            acquire_operation(&prepared, 5, DispatchCause::InitialReconciliation, 1_100,).is_err()
        );

        let acquired =
            acquire_operation(&prepared, 5, DispatchCause::ExplicitUserAction, 1_100).unwrap();
        assert_eq!(acquired.record.state, OperationState::InFlight);
        assert_eq!(acquired.record.session_generation, 5);
        assert_eq!(acquired.record.lease_generation, 1);
        assert_eq!(acquired.record.attempt_count, 1);
        assert!(!acquired.reconciles_unknown_outcome);
    }

    #[test]
    fn unknown_outcome_cannot_dispatch_without_readback_authorization() {
        let unknown = record(OperationState::UnknownOutcome);
        for cause in [
            DispatchCause::ExplicitUserAction,
            DispatchCause::InitialReconciliation,
            DispatchCause::RetryDeadlineReached,
        ] {
            assert!(acquire_operation(&unknown, 5, cause, 2_100).is_err());
        }

        let acquired =
            acquire_operation(&unknown, 5, DispatchCause::ReadbackAuthorizedRetry, 2_100).unwrap();
        assert!(acquired.reconciles_unknown_outcome);
        assert_eq!(acquired.record.lease_generation, 3);
        assert_eq!(acquired.record.attempt_count, 3);
    }

    #[test]
    fn retry_wait_enforces_its_clock_deadline() {
        let waiting = record(OperationState::RetryWait);
        assert!(
            acquire_operation(&waiting, 4, DispatchCause::RetryDeadlineReached, 1_999,).is_err()
        );
        assert!(
            acquire_operation(&waiting, 4, DispatchCause::RetryDeadlineReached, 2_000,).is_ok()
        );
    }

    #[test]
    fn completion_is_generation_and_lease_fenced() {
        let current = record(OperationState::InFlight);
        let fence = current.fence();
        let completed =
            complete_operation(&current, fence, OperationCompletion::Committed, 1_100).unwrap();
        assert_eq!(completed.state, OperationState::Committed);

        let stale_session = OperationFence {
            session_generation: current.session_generation + 1,
            ..current.fence()
        };
        assert_eq!(
            complete_operation(
                &current,
                stale_session,
                OperationCompletion::Committed,
                1_100,
            )
            .unwrap_err()
            .code,
            OperationErrorCode::StaleSessionGeneration,
        );

        let stale_lease = OperationFence {
            lease_generation: current.lease_generation + 1,
            ..current.fence()
        };
        assert_eq!(
            complete_operation(&current, stale_lease, OperationCompletion::Committed, 1_100,)
                .unwrap_err()
                .code,
            OperationErrorCode::LostLease,
        );
    }

    #[test]
    fn interrupted_dispatch_resumes_as_unknown_outcome() {
        let current = record(OperationState::InFlight);
        let recovered = recover_interrupted_operation(&current, 1_200).unwrap();
        assert_eq!(recovered.state, OperationState::UnknownOutcome);
        assert_eq!(recovered.lease_generation, current.lease_generation);
        assert_eq!(recovered.session_generation, current.session_generation);
    }

    #[test]
    fn persisted_state_and_kind_values_are_stable() {
        for (value, expected) in [
            (1, OperationState::Prepared),
            (2, OperationState::Pending),
            (3, OperationState::InFlight),
            (4, OperationState::UnknownOutcome),
            (5, OperationState::CommittedPendingReadback),
            (6, OperationState::Committed),
            (7, OperationState::RetryWait),
            (8, OperationState::Terminal),
            (9, OperationState::Cancelled),
        ] {
            assert_eq!(OperationState::try_from(value).unwrap(), expected);
        }
        for (value, expected) in [
            (1, OperationKind::ContentPreKeyPublication),
            (2, OperationKind::OwnerSubmission),
            (3, OperationKind::RecoveryContinuation),
            (4, OperationKind::ObjectTransferCheckpoint),
        ] {
            assert_eq!(OperationKind::try_from(value).unwrap(), expected);
        }
        assert!(OperationState::try_from(0).is_err());
        assert!(OperationKind::try_from(0).is_err());
    }

    #[test]
    fn command_digest_is_part_of_the_durable_identity() {
        let command_bytes = b"canonical-command";
        let mut record = record(OperationState::Pending);
        record.command_sha256 = Sha256::digest(command_bytes).into();

        record.validate_command_bytes(command_bytes).unwrap();
        assert_eq!(
            record
                .validate_command_bytes(b"changed-command")
                .unwrap_err()
                .code,
            OperationErrorCode::IntegrityFailed,
        );
    }

    #[test]
    fn new_operation_owns_initial_state_and_command_identity() {
        let command_bytes = b"canonical-command";
        let record = OperationRecord::new(
            "operation-1",
            "command-1",
            OperationKind::OwnerSubmission,
            OperationState::Prepared,
            command_bytes,
            1,
        )
        .unwrap();
        let expected_sha256: [u8; 32] = Sha256::digest(command_bytes).into();

        assert_eq!(record.state, OperationState::Prepared);
        assert_eq!(record.command_sha256, expected_sha256);
        assert!(OperationRecord::new(
            "operation-1",
            "command-1",
            OperationKind::OwnerSubmission,
            OperationState::InFlight,
            command_bytes,
            1,
        )
        .is_err());
    }
}
