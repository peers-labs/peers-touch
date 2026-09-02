use crate::model::agent::{
    CapabilityOperation, CapabilityOperationError, CapabilityOperationEvent,
    CapabilityOperationStatus, ReportCapabilityOperationEventRequest,
};
use prost_types::Timestamp;

pub trait LocalOperationExecutor {
    fn execute(
        &self,
        operation_kind: &str,
        bounded_arguments: &[u8],
        external_idempotency_key: Option<&str>,
    ) -> Result<String, CapabilityOperationError>;

    fn cleanup(&self, operation: &CapabilityOperation) -> Result<(), String>;
}

pub trait OperationEventReporter {
    fn report(
        &self,
        request: ReportCapabilityOperationEventRequest,
    ) -> Result<CapabilityOperation, String>;
}

pub struct FencedOperationExecutor<'a> {
    device_id: &'a str,
    session_id: &'a str,
    executor: &'a dyn LocalOperationExecutor,
    reporter: &'a dyn OperationEventReporter,
}

impl<'a> FencedOperationExecutor<'a> {
    pub fn new(
        device_id: &'a str,
        session_id: &'a str,
        executor: &'a dyn LocalOperationExecutor,
        reporter: &'a dyn OperationEventReporter,
    ) -> Self {
        Self {
            device_id,
            session_id,
            executor,
            reporter,
        }
    }

    pub fn consume_at(
        &self,
        operation: CapabilityOperation,
        now_ms: i64,
    ) -> Result<CapabilityOperation, String> {
        validate_operation_envelope(&operation, self.device_id, self.session_id, now_ms)?;
        let running = self.reporter.report(self.business_event(
            &operation,
            CapabilityOperationStatus::Running,
            operation.last_event_sequence + 1,
            "",
            None,
        ))?;
        let idempotency_key = (!operation.external_idempotency_key.is_empty())
            .then_some(operation.external_idempotency_key.as_str());
        let (terminal_status, result_ref, error) = match self.executor.execute(
            &operation.operation_kind,
            &operation.bounded_arguments,
            idempotency_key,
        ) {
            Ok(result_ref) => (CapabilityOperationStatus::Succeeded, result_ref, None),
            Err(error) => (
                CapabilityOperationStatus::Failed,
                String::new(),
                Some(error),
            ),
        };
        let settling = self.reporter.report(self.business_event(
            &running,
            terminal_status,
            running.last_event_sequence + 1,
            &result_ref,
            error,
        ))?;
        self.settle_cleanup_at(settling, now_ms)
    }

    pub fn reconcile_at(
        &self,
        operation: CapabilityOperation,
        now_ms: i64,
    ) -> Result<CapabilityOperation, String> {
        validate_operation_scope(&operation, self.device_id, self.session_id)?;
        match CapabilityOperationStatus::try_from(operation.status)
            .unwrap_or(CapabilityOperationStatus::Unspecified)
        {
            CapabilityOperationStatus::Dispatched => self.consume_at(operation, now_ms),
            CapabilityOperationStatus::SettlingCleanup => self.settle_cleanup_at(operation, now_ms),
            CapabilityOperationStatus::Running
            | CapabilityOperationStatus::Disconnected
            | CapabilityOperationStatus::Reconnecting => {
                let settling = self.reporter.report(self.business_event(
                    &operation,
                    CapabilityOperationStatus::UnknownSideEffect,
                    operation.last_event_sequence + 1,
                    "",
                    Some(CapabilityOperationError {
                        code: crate::model::agent::CapabilityOperationErrorCode::UnknownSideEffect
                            as i32,
                        retryable: false,
                        recovery_action: "cleanup_only".to_string(),
                    }),
                ))?;
                self.settle_cleanup_at(settling, now_ms)
            }
            CapabilityOperationStatus::Succeeded
            | CapabilityOperationStatus::Cancelled
            | CapabilityOperationStatus::TimedOut
            | CapabilityOperationStatus::Failed
            | CapabilityOperationStatus::CleanupFailed
            | CapabilityOperationStatus::UnknownSideEffect => Ok(operation),
            _ => Err("CAPABILITY_OPERATION_RECONCILIATION_STATE_INVALID".to_string()),
        }
    }

    fn settle_cleanup_at(
        &self,
        settling: CapabilityOperation,
        now_ms: i64,
    ) -> Result<CapabilityOperation, String> {
        if settling.status != CapabilityOperationStatus::SettlingCleanup as i32
            || settling.cleanup_lease_id.is_empty()
            || settling.cleanup_epoch == 0
            || settling.cleanup_fencing_token == 0
        {
            return Err("CAPABILITY_OPERATION_CLEANUP_AUTHORITY_MISSING".to_string());
        }
        let cleanup_result = self.executor.cleanup(&settling);
        let final_status = if cleanup_result.is_ok() {
            CapabilityOperationStatus::try_from(settling.desired_terminal_outcome)
                .unwrap_or(CapabilityOperationStatus::Failed)
        } else {
            CapabilityOperationStatus::CleanupFailed
        };
        self.reporter.report(ReportCapabilityOperationEventRequest {
            event: Some(CapabilityOperationEvent {
                operation_id: settling.operation_id.clone(),
                attempt_epoch: settling.attempt_epoch,
                sequence: settling.last_event_sequence + 1,
                status: final_status as i32,
                fencing_token: settling.fencing_token,
                progress_percent: settling.progress_percent,
                result_ref: settling.result_ref.clone(),
                error: None,
                occurred_at: Some(timestamp_from_ms(now_ms)),
            }),
            target_device_id: self.device_id.to_string(),
            capability_session_id: self.session_id.to_string(),
            executor_lease_id: settling.executor_lease_id.clone(),
            cleanup_lease_id: settling.cleanup_lease_id.clone(),
            cleanup_epoch: settling.cleanup_epoch,
            cleanup_fencing_token: settling.cleanup_fencing_token,
            cleanup_outcome: if cleanup_result.is_ok() {
                "clean".to_string()
            } else {
                "failed".to_string()
            },
            command_proof: None,
        })
    }

    fn business_event(
        &self,
        operation: &CapabilityOperation,
        status: CapabilityOperationStatus,
        sequence: u64,
        result_ref: &str,
        error: Option<CapabilityOperationError>,
    ) -> ReportCapabilityOperationEventRequest {
        ReportCapabilityOperationEventRequest {
            event: Some(CapabilityOperationEvent {
                operation_id: operation.operation_id.clone(),
                attempt_epoch: operation.attempt_epoch,
                sequence,
                status: status as i32,
                fencing_token: operation.fencing_token,
                progress_percent: operation.progress_percent,
                result_ref: result_ref.to_string(),
                error,
                occurred_at: None,
            }),
            target_device_id: self.device_id.to_string(),
            capability_session_id: self.session_id.to_string(),
            executor_lease_id: operation.executor_lease_id.clone(),
            cleanup_lease_id: String::new(),
            cleanup_epoch: 0,
            cleanup_fencing_token: 0,
            cleanup_outcome: String::new(),
            command_proof: None,
        }
    }
}

fn validate_operation_envelope(
    operation: &CapabilityOperation,
    device_id: &str,
    session_id: &str,
    now_ms: i64,
) -> Result<(), String> {
    validate_operation_scope(operation, device_id, session_id)?;
    if operation.operation_id.trim().is_empty()
        || operation.operation_kind.trim().is_empty()
        || operation.executor_lease_id.trim().is_empty()
        || operation.attempt_epoch == 0
        || operation.fencing_token == 0
    {
        return Err("CAPABILITY_OPERATION_ENVELOPE_INCOMPLETE".to_string());
    }
    if operation.status != CapabilityOperationStatus::Dispatched as i32 {
        return Err("CAPABILITY_OPERATION_NOT_DISPATCHED".to_string());
    }
    if timestamp_ms(
        operation
            .deadline
            .as_ref()
            .ok_or_else(|| "CAPABILITY_OPERATION_DEADLINE_REQUIRED".to_string())?,
    )? <= now_ms
    {
        return Err("CAPABILITY_OPERATION_DEADLINE_EXPIRED".to_string());
    }
    Ok(())
}

fn validate_operation_scope(
    operation: &CapabilityOperation,
    device_id: &str,
    session_id: &str,
) -> Result<(), String> {
    if operation.target_device_id != device_id || operation.capability_session_id != session_id {
        return Err("CAPABILITY_OPERATION_AUTHORITY_MISMATCH".to_string());
    }
    Ok(())
}

fn timestamp_ms(value: &Timestamp) -> Result<i64, String> {
    value
        .seconds
        .checked_mul(1_000)
        .and_then(|seconds| seconds.checked_add(i64::from(value.nanos) / 1_000_000))
        .ok_or_else(|| "CAPABILITY_OPERATION_TIMESTAMP_OVERFLOW".to_string())
}

fn timestamp_from_ms(value: i64) -> Timestamp {
    Timestamp {
        seconds: value.div_euclid(1_000),
        nanos: (value.rem_euclid(1_000) * 1_000_000) as i32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Executor {
        cleanup_fails: bool,
    }

    impl LocalOperationExecutor for Executor {
        fn execute(
            &self,
            _operation_kind: &str,
            _bounded_arguments: &[u8],
            _external_idempotency_key: Option<&str>,
        ) -> Result<String, CapabilityOperationError> {
            Ok("result-ref".to_string())
        }

        fn cleanup(&self, _operation: &CapabilityOperation) -> Result<(), String> {
            if self.cleanup_fails {
                Err("cleanup failed".to_string())
            } else {
                Ok(())
            }
        }
    }

    struct Reporter {
        requests: RefCell<Vec<ReportCapabilityOperationEventRequest>>,
    }

    impl OperationEventReporter for Reporter {
        fn report(
            &self,
            request: ReportCapabilityOperationEventRequest,
        ) -> Result<CapabilityOperation, String> {
            let event = request.event.as_ref().expect("event");
            self.requests.borrow_mut().push(request.clone());
            let mut operation = fixture_operation();
            operation.last_event_sequence = event.sequence;
            operation.status = event.status;
            operation.result_ref = event.result_ref.clone();
            if event.status == CapabilityOperationStatus::Succeeded as i32
                && request.cleanup_outcome.is_empty()
            {
                operation.status = CapabilityOperationStatus::SettlingCleanup as i32;
                operation.desired_terminal_outcome = CapabilityOperationStatus::Succeeded as i32;
                operation.cleanup_lease_id = "cleanup-1".to_string();
                operation.cleanup_epoch = 1;
                operation.cleanup_fencing_token = 1;
            }
            Ok(operation)
        }
    }

    #[test]
    fn capability_operation_executor_reports_running_terminal_and_cleanup() {
        let reporter = Reporter {
            requests: RefCell::new(Vec::new()),
        };
        let executor = Executor {
            cleanup_fails: false,
        };
        let terminal = FencedOperationExecutor::new("device-1", "session-1", &executor, &reporter)
            .consume_at(fixture_operation(), 1_000)
            .expect("execute operation");

        assert_eq!(terminal.status, CapabilityOperationStatus::Succeeded as i32);
        let requests = reporter.requests.borrow();
        assert_eq!(requests.len(), 3);
        assert_eq!(
            requests[0].event.as_ref().unwrap().status,
            CapabilityOperationStatus::Running as i32
        );
        assert_eq!(requests[2].cleanup_outcome, "clean");
    }

    #[test]
    fn capability_operation_executor_rejects_wrong_device_before_side_effect() {
        let reporter = Reporter {
            requests: RefCell::new(Vec::new()),
        };
        let executor = Executor {
            cleanup_fails: false,
        };
        let error = FencedOperationExecutor::new("device-2", "session-1", &executor, &reporter)
            .consume_at(fixture_operation(), 1_000)
            .expect_err("wrong device must reject");

        assert_eq!(error, "CAPABILITY_OPERATION_AUTHORITY_MISMATCH");
        assert!(reporter.requests.borrow().is_empty());
    }

    fn fixture_operation() -> CapabilityOperation {
        CapabilityOperation {
            operation_id: "operation-1".to_string(),
            idempotency_key: "key-1".to_string(),
            payload_hash: "hash".to_string(),
            ptid: "ptid:person:owner".to_string(),
            capability_id: "mcp:test".to_string(),
            capability_version: "1".to_string(),
            target_device_id: "device-1".to_string(),
            capability_session_id: "session-1".to_string(),
            executor_lease_id: "lease-1".to_string(),
            operation_kind: "test".to_string(),
            status: CapabilityOperationStatus::Dispatched as i32,
            attempt: 1,
            attempt_epoch: 1,
            fencing_token: 1,
            revision: 1,
            deadline: Some(timestamp_from_ms(10_000)),
            last_event_sequence: 0,
            bounded_arguments: br#"{"probe":true}"#.to_vec(),
            ..Default::default()
        }
    }
}
