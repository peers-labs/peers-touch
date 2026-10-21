use crate::envelope::{open_content_key, ContentKey, SealedContentKey};
use crate::ports::{ContentKeyMaterial, LifecycleCancellation};
use crate::recovery::derive_recovery_prekey;

use super::outcome::{OperationErrorCode, OperationFailure};
use super::state::{validate_fence, OperationFence, OperationRecord, OperationState};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReadbackObservation {
    Committed { receipt_sha256: [u8; 32] },
    AuthoritativeAbsent,
    Unavailable { retry_after_unix_ms: Option<i64> },
    Invalid { detail: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReadbackDecision {
    CommitFromReadback { receipt_sha256: [u8; 32] },
    RetryExactCommand,
    KeepUnknown { retry_after_unix_ms: Option<i64> },
    KeepCommittedPendingReadback { retry_after_unix_ms: Option<i64> },
    TerminalIntegrityFailure { detail: String },
}

pub fn decide_unknown_outcome(
    operation: &OperationRecord,
    observation: ReadbackObservation,
) -> Result<ReadbackDecision, OperationFailure> {
    operation.validate()?;
    if operation.state != OperationState::UnknownOutcome {
        return Err(OperationFailure::terminal(
            OperationErrorCode::InvalidTransition,
            "authoritative readback is only valid for an unknown operation",
        ));
    }
    Ok(match observation {
        ReadbackObservation::Committed { receipt_sha256 } => {
            if receipt_sha256.iter().all(|byte| *byte == 0) {
                ReadbackDecision::TerminalIntegrityFailure {
                    detail: "authoritative readback receipt digest is invalid".to_string(),
                }
            } else {
                ReadbackDecision::CommitFromReadback { receipt_sha256 }
            }
        }
        ReadbackObservation::AuthoritativeAbsent => ReadbackDecision::RetryExactCommand,
        ReadbackObservation::Unavailable {
            retry_after_unix_ms,
        } => ReadbackDecision::KeepUnknown {
            retry_after_unix_ms,
        },
        ReadbackObservation::Invalid { detail } => {
            ReadbackDecision::TerminalIntegrityFailure { detail }
        }
    })
}

pub fn decide_committed_readback(
    operation: &OperationRecord,
    observation: ReadbackObservation,
) -> Result<ReadbackDecision, OperationFailure> {
    operation.validate()?;
    if operation.state != OperationState::CommittedPendingReadback {
        return Err(OperationFailure::terminal(
            OperationErrorCode::InvalidTransition,
            "committed readback is only valid for a committed-pending-readback operation",
        ));
    }
    Ok(match observation {
        ReadbackObservation::Committed { receipt_sha256 } => {
            if receipt_sha256.iter().all(|byte| *byte == 0) {
                ReadbackDecision::TerminalIntegrityFailure {
                    detail: "committed readback receipt digest is invalid".to_string(),
                }
            } else {
                ReadbackDecision::CommitFromReadback { receipt_sha256 }
            }
        }
        ReadbackObservation::AuthoritativeAbsent => {
            ReadbackDecision::KeepCommittedPendingReadback {
                retry_after_unix_ms: None,
            }
        }
        ReadbackObservation::Unavailable {
            retry_after_unix_ms,
        } => ReadbackDecision::KeepCommittedPendingReadback {
            retry_after_unix_ms,
        },
        ReadbackObservation::Invalid { detail } => {
            ReadbackDecision::TerminalIntegrityFailure { detail }
        }
    })
}

pub fn apply_readback_decision(
    operation: &OperationRecord,
    fence: OperationFence<'_>,
    decision: &ReadbackDecision,
    now_unix_ms: i64,
) -> Result<OperationRecord, OperationFailure> {
    operation.validate()?;
    validate_fence(operation, fence)?;
    if !matches!(
        operation.state,
        OperationState::UnknownOutcome | OperationState::CommittedPendingReadback
    ) || now_unix_ms <= 0
    {
        return Err(OperationFailure::terminal(
            OperationErrorCode::InvalidTransition,
            "readback decision cannot advance this operation",
        ));
    }

    let mut advanced = operation.clone();
    match decision {
        ReadbackDecision::CommitFromReadback { .. } => {
            advanced.state = OperationState::Committed;
            advanced.next_attempt_at_unix_ms = 0;
        }
        ReadbackDecision::RetryExactCommand => {
            if operation.state != OperationState::UnknownOutcome {
                return Err(OperationFailure::terminal(
                    OperationErrorCode::InvalidTransition,
                    "committed operation cannot retry its submit command",
                ));
            }
            advanced.next_attempt_at_unix_ms = 0;
        }
        ReadbackDecision::KeepUnknown {
            retry_after_unix_ms,
        } => {
            if operation.state != OperationState::UnknownOutcome {
                return Err(OperationFailure::terminal(
                    OperationErrorCode::InvalidTransition,
                    "committed operation cannot become unknown",
                ));
            }
            if retry_after_unix_ms.is_some_and(|deadline| deadline <= now_unix_ms) {
                return Err(OperationFailure::terminal(
                    OperationErrorCode::InvalidTransition,
                    "readback retry deadline must be in the future",
                ));
            }
            advanced.next_attempt_at_unix_ms = retry_after_unix_ms.unwrap_or_default();
        }
        ReadbackDecision::KeepCommittedPendingReadback {
            retry_after_unix_ms,
        } => {
            if operation.state != OperationState::CommittedPendingReadback {
                return Err(OperationFailure::terminal(
                    OperationErrorCode::InvalidTransition,
                    "unknown operation cannot claim a committed response",
                ));
            }
            if retry_after_unix_ms.is_some_and(|deadline| deadline <= now_unix_ms) {
                return Err(OperationFailure::terminal(
                    OperationErrorCode::InvalidTransition,
                    "committed readback retry deadline must be in the future",
                ));
            }
            advanced.next_attempt_at_unix_ms = retry_after_unix_ms.unwrap_or_default();
        }
        ReadbackDecision::TerminalIntegrityFailure { .. } => {
            advanced.state = OperationState::Terminal;
            advanced.next_attempt_at_unix_ms = 0;
        }
    }
    advanced.updated_at_unix_ms = now_unix_ms;
    advanced.validate()?;
    Ok(advanced)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecoveryEnvelopeContinuation {
    pub actor_ptid: String,
    pub recovery_epoch: u64,
    pub key_id: String,
    pub binding: Vec<u8>,
    pub encapsulated_key: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

pub fn continue_recovery_envelope(
    key_material: &dyn ContentKeyMaterial,
    cancellation: &dyn LifecycleCancellation,
    continuation: &RecoveryEnvelopeContinuation,
) -> Result<ContentKey, OperationFailure> {
    ensure_not_cancelled(cancellation)?;
    if continuation.actor_ptid.trim().is_empty()
        || continuation.actor_ptid.trim() != continuation.actor_ptid
        || continuation.recovery_epoch == 0
        || continuation.key_id.trim().is_empty()
        || continuation.key_id.trim() != continuation.key_id
        || continuation.binding.is_empty()
        || continuation.encapsulated_key.is_empty()
        || continuation.ciphertext.is_empty()
    {
        return Err(OperationFailure::terminal(
            OperationErrorCode::InvalidRecord,
            "secure content recovery continuation is incomplete",
        ));
    }

    let master = key_material
        .recovery_master(&continuation.actor_ptid, continuation.recovery_epoch)?
        .ok_or_else(|| {
            OperationFailure::terminal(
                OperationErrorCode::KeyMaterialUnavailable,
                "secure content recovery master is unavailable",
            )
        })?;
    ensure_not_cancelled(cancellation)?;
    let prekey = derive_recovery_prekey(
        &master,
        &continuation.actor_ptid,
        continuation.recovery_epoch,
        &continuation.key_id,
    )
    .map_err(|detail| OperationFailure::terminal(OperationErrorCode::IntegrityFailed, detail))?;
    ensure_not_cancelled(cancellation)?;
    open_content_key(
        prekey.private(),
        &continuation.binding,
        &SealedContentKey {
            encapsulated_key: continuation.encapsulated_key.clone(),
            ciphertext: continuation.ciphertext.clone(),
        },
    )
    .map_err(|detail| OperationFailure::terminal(OperationErrorCode::IntegrityFailed, detail))
}

fn ensure_not_cancelled(cancellation: &dyn LifecycleCancellation) -> Result<(), OperationFailure> {
    if cancellation.is_cancelled() {
        Err(OperationFailure::terminal(
            OperationErrorCode::Cancelled,
            "secure content lifecycle cancelled the operation",
        ))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::envelope::seal_content_key;
    use crate::operation::{OperationKind, OperationState};
    use crate::recovery::{derive_recovery_master, derive_recovery_prekey, RecoveryMaster};
    use std::sync::atomic::{AtomicBool, Ordering};

    fn operation(state: OperationState) -> OperationRecord {
        OperationRecord {
            operation_id: "operation-1".to_string(),
            command_id: "command-1".to_string(),
            kind: OperationKind::OwnerSubmission,
            state,
            command_sha256: [4; 32],
            session_generation: 1,
            lease_generation: 1,
            attempt_count: 1,
            next_attempt_at_unix_ms: 0,
            updated_at_unix_ms: 1,
        }
    }

    #[test]
    fn unknown_outcome_requires_readback_before_exact_retry() {
        let operation = operation(OperationState::UnknownOutcome);
        let committed = ReadbackDecision::CommitFromReadback {
            receipt_sha256: [7; 32],
        };
        assert_eq!(
            decide_unknown_outcome(
                &operation,
                ReadbackObservation::Committed {
                    receipt_sha256: [7; 32],
                },
            )
            .unwrap(),
            committed,
        );
        assert_eq!(
            apply_readback_decision(&operation, operation.fence(), &committed, 2)
                .unwrap()
                .state,
            OperationState::Committed,
        );
        let retry =
            decide_unknown_outcome(&operation, ReadbackObservation::AuthoritativeAbsent).unwrap();
        assert_eq!(retry, ReadbackDecision::RetryExactCommand);
        assert_eq!(
            apply_readback_decision(&operation, operation.fence(), &retry, 2)
                .unwrap()
                .state,
            OperationState::UnknownOutcome,
        );
        assert_eq!(
            decide_unknown_outcome(
                &operation,
                ReadbackObservation::Unavailable {
                    retry_after_unix_ms: Some(5_000),
                },
            )
            .unwrap(),
            ReadbackDecision::KeepUnknown {
                retry_after_unix_ms: Some(5_000),
            },
        );
    }

    #[test]
    fn readback_decision_preserves_generation_and_lease_fence() {
        let operation = operation(OperationState::UnknownOutcome);
        let stale = OperationFence {
            lease_generation: 2,
            ..operation.fence()
        };
        assert_eq!(
            apply_readback_decision(
                &operation,
                stale,
                &ReadbackDecision::CommitFromReadback {
                    receipt_sha256: [7; 32],
                },
                2,
            )
            .unwrap_err()
            .code,
            OperationErrorCode::LostLease,
        );
    }

    #[test]
    fn committed_pending_readback_never_retries_the_submit_command() {
        let operation = operation(OperationState::CommittedPendingReadback);
        let absent =
            decide_committed_readback(&operation, ReadbackObservation::AuthoritativeAbsent)
                .unwrap();
        assert_eq!(
            absent,
            ReadbackDecision::KeepCommittedPendingReadback {
                retry_after_unix_ms: None,
            },
        );
        assert_eq!(
            apply_readback_decision(&operation, operation.fence(), &absent, 2)
                .unwrap()
                .state,
            OperationState::CommittedPendingReadback,
        );
        assert_eq!(
            apply_readback_decision(
                &operation,
                operation.fence(),
                &ReadbackDecision::RetryExactCommand,
                2,
            )
            .unwrap_err()
            .code,
            OperationErrorCode::InvalidTransition,
        );

        let committed = decide_committed_readback(
            &operation,
            ReadbackObservation::Committed {
                receipt_sha256: [8; 32],
            },
        )
        .unwrap();
        assert_eq!(
            apply_readback_decision(&operation, operation.fence(), &committed, 2)
                .unwrap()
                .state,
            OperationState::Committed,
        );
    }

    #[test]
    fn non_unknown_operation_cannot_consume_readback_decision() {
        assert_eq!(
            decide_unknown_outcome(
                &operation(OperationState::Committed),
                ReadbackObservation::AuthoritativeAbsent,
            )
            .unwrap_err()
            .code,
            OperationErrorCode::InvalidTransition,
        );
    }

    struct FakeCancellation(AtomicBool);

    impl LifecycleCancellation for FakeCancellation {
        fn is_cancelled(&self) -> bool {
            self.0.load(Ordering::Acquire)
        }
    }

    struct FakeKeyMaterial {
        master: [u8; 32],
    }

    impl ContentKeyMaterial for FakeKeyMaterial {
        fn recovery_master(
            &self,
            _actor_ptid: &str,
            _recovery_epoch: u64,
        ) -> Result<Option<RecoveryMaster>, OperationFailure> {
            Ok(Some(RecoveryMaster::from_bytes(self.master)))
        }

        fn sign_device_payload(&self, _payload: &[u8]) -> Result<Vec<u8>, OperationFailure> {
            Ok(vec![1])
        }
    }

    #[test]
    fn recovery_continuation_honors_lifecycle_cancellation() {
        let actor_ptid = "ptid:v1:actor:peers:p:alice:key";
        let master = derive_recovery_master(&[0x0b; 32], actor_ptid, 7).unwrap();
        let key_id = "recovery-prekey-0001";
        let key_material = FakeKeyMaterial {
            master: master.to_bytes(),
        };
        let cancellation = FakeCancellation(AtomicBool::new(true));
        let continuation = RecoveryEnvelopeContinuation {
            actor_ptid: actor_ptid.to_string(),
            recovery_epoch: 7,
            key_id: key_id.to_string(),
            binding: vec![1],
            encapsulated_key: vec![2],
            ciphertext: vec![3],
        };

        let failure = match continue_recovery_envelope(&key_material, &cancellation, &continuation)
        {
            Ok(_) => panic!("cancelled recovery continuation must fail"),
            Err(failure) => failure,
        };
        assert_eq!(failure.code, OperationErrorCode::Cancelled);
    }

    #[test]
    fn recovery_continuation_loads_derives_and_opens() {
        let actor_ptid = "ptid:v1:actor:peers:p:alice:key";
        let master = derive_recovery_master(&[0x0b; 32], actor_ptid, 7).unwrap();
        let key_id = "recovery-prekey-0001";
        let pair = derive_recovery_prekey(&master, actor_ptid, 7, key_id).unwrap();
        let binding = b"canonical-recovery-binding".to_vec();
        let expected = ContentKey::from_bytes([0x42; 32]);
        let sealed = seal_content_key(pair.public(), &binding, &expected).unwrap();
        let key_material = FakeKeyMaterial {
            master: master.to_bytes(),
        };
        let cancellation = FakeCancellation(AtomicBool::new(false));
        let continuation = RecoveryEnvelopeContinuation {
            actor_ptid: actor_ptid.to_string(),
            recovery_epoch: 7,
            key_id: key_id.to_string(),
            binding,
            encapsulated_key: sealed.encapsulated_key,
            ciphertext: sealed.ciphertext,
        };

        let opened =
            continue_recovery_envelope(&key_material, &cancellation, &continuation).unwrap();
        assert_eq!(opened.as_bytes(), expected.as_bytes());
    }
}
