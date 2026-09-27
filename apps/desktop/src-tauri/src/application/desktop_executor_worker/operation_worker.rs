use super::operation_executor::{
    FencedOperationExecutor, LocalOperationExecutor, OperationEventReporter,
    ACCEPTANCE_WORKER_INTERRUPTED,
};
use super::operation_ledger::OperationLedger;
use crate::model::agent::{
    CapabilityOperation, PullCapabilityOperationsResponse, ReconcileCapabilityOperationResponse,
};

pub trait OperationTransport: OperationEventReporter {
    fn pull_operations(
        &self,
        capability_session_id: &str,
        after_sequence: u64,
        limit: u32,
    ) -> Result<PullCapabilityOperationsResponse, String>;

    fn reconcile_operation(
        &self,
        operation_id: &str,
        after_sequence: u64,
    ) -> Result<ReconcileCapabilityOperationResponse, String>;
}

pub struct CapabilityOperationWorker<'a> {
    station_url: &'a str,
    device_id: &'a str,
    session_id: &'a str,
    ledger: &'a OperationLedger,
    executor: &'a dyn LocalOperationExecutor,
    transport: &'a dyn OperationTransport,
}

impl<'a> CapabilityOperationWorker<'a> {
    pub fn new(
        station_url: &'a str,
        device_id: &'a str,
        session_id: &'a str,
        ledger: &'a OperationLedger,
        executor: &'a dyn LocalOperationExecutor,
        transport: &'a dyn OperationTransport,
    ) -> Self {
        Self {
            station_url,
            device_id,
            session_id,
            ledger,
            executor,
            transport,
        }
    }

    pub fn tick_at(&self, now_ms: i64) -> Result<u64, String> {
        self.tick_at_with_scenario_hook(now_ms, &mut |_, _| Ok(false))
    }

    pub fn tick_at_with_scenario_hook(
        &self,
        now_ms: i64,
        hook: &mut dyn FnMut(&str, &CapabilityOperation) -> Result<bool, String>,
    ) -> Result<u64, String> {
        let mut cursor = self.ledger.cursor(self.station_url, self.session_id)?;
        let response = self
            .transport
            .pull_operations(self.session_id, cursor, 32)?;
        let response_last_sequence = response.last_sequence;
        let had_operations = !response.operations.is_empty();
        for operation in response.operations {
            if operation.dispatch_sequence <= cursor
                || operation.dispatch_sequence > response_last_sequence
            {
                return Err("CAPABILITY_OPERATION_PULL_SEQUENCE_INVALID".to_string());
            }
            let checkpoint = self.ledger.load(
                &operation.operation_id,
                operation.attempt_epoch,
                operation.fencing_token,
            )?;
            let reconciled = self
                .transport
                .reconcile_operation(&operation.operation_id, operation.last_event_sequence)?;
            let current = reconciled
                .operation
                .ok_or_else(|| "CAPABILITY_OPERATION_RECONCILIATION_MISSING".to_string())?;
            self.ledger.store(self.station_url, &current, "received")?;
            let kernel = FencedOperationExecutor::new(
                self.device_id,
                self.session_id,
                self.executor,
                self.transport,
            );
            let execution = if checkpoint.is_some()
                || current.status
                    != crate::model::agent::CapabilityOperationStatus::Dispatched as i32
            {
                kernel.reconcile_at_with_scenario_hook(current, now_ms, hook)?
            } else {
                match kernel.consume_at_with_scenario_hook(current.clone(), now_ms, hook) {
                    Ok(terminal) => terminal,
                    Err(execution_error) if execution_error == ACCEPTANCE_WORKER_INTERRUPTED => {
                        return Err(execution_error);
                    }
                    Err(execution_error) => {
                        let reconciled = self.transport.reconcile_operation(
                            &current.operation_id,
                            current.last_event_sequence,
                        )?;
                        let authoritative = reconciled.operation.ok_or_else(|| {
                            "CAPABILITY_OPERATION_RECONCILIATION_MISSING".to_string()
                        })?;
                        if authoritative.revision <= current.revision {
                            return Err(execution_error);
                        }
                        kernel.reconcile_at_with_scenario_hook(authoritative, now_ms, hook)?
                    }
                }
            };
            self.ledger
                .store(self.station_url, &execution, "terminal")?;
            self.ledger.advance_cursor(
                self.station_url,
                self.session_id,
                cursor,
                operation.dispatch_sequence,
            )?;
            cursor = operation.dispatch_sequence;
        }
        if had_operations && cursor != response_last_sequence {
            return Err("CAPABILITY_OPERATION_PULL_CURSOR_INCOMPLETE".to_string());
        }
        if !had_operations && response_last_sequence < cursor {
            return Err("CAPABILITY_OPERATION_PULL_CURSOR_REGRESSION".to_string());
        }
        Ok(cursor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::agent::{
        CapabilityOperationError, CapabilityOperationEvent, CapabilityOperationStatus,
        ReportCapabilityOperationEventRequest,
    };
    use prost_types::Timestamp;
    use std::cell::RefCell;

    struct Executor {
        calls: RefCell<u32>,
    }

    impl LocalOperationExecutor for Executor {
        fn execute(
            &self,
            _operation: &CapabilityOperation,
            _external_idempotency_key: Option<&str>,
        ) -> Result<String, CapabilityOperationError> {
            *self.calls.borrow_mut() += 1;
            Ok("result".to_string())
        }

        fn cleanup(&self, _operation: &CapabilityOperation) -> Result<(), String> {
            Ok(())
        }
    }

    struct Transport {
        operation: RefCell<CapabilityOperation>,
    }

    impl OperationTransport for Transport {
        fn pull_operations(
            &self,
            _capability_session_id: &str,
            after_sequence: u64,
            _limit: u32,
        ) -> Result<PullCapabilityOperationsResponse, String> {
            let operation = self.operation.borrow().clone();
            Ok(PullCapabilityOperationsResponse {
                operations: (operation.dispatch_sequence > after_sequence)
                    .then_some(operation.clone())
                    .into_iter()
                    .collect(),
                last_sequence: operation.dispatch_sequence.max(after_sequence),
                error_code: 0,
            })
        }

        fn reconcile_operation(
            &self,
            _operation_id: &str,
            _after_sequence: u64,
        ) -> Result<ReconcileCapabilityOperationResponse, String> {
            Ok(ReconcileCapabilityOperationResponse {
                operation: Some(self.operation.borrow().clone()),
                events: Vec::new(),
            })
        }
    }

    impl OperationEventReporter for Transport {
        fn report(
            &self,
            request: ReportCapabilityOperationEventRequest,
        ) -> Result<CapabilityOperation, String> {
            let event = request.event.expect("event");
            let mut operation = self.operation.borrow_mut();
            operation.last_event_sequence = event.sequence;
            operation.status = event.status;
            if event.status == CapabilityOperationStatus::Succeeded as i32
                && request.cleanup_outcome.is_empty()
            {
                operation.status = CapabilityOperationStatus::SettlingCleanup as i32;
                operation.desired_terminal_outcome = CapabilityOperationStatus::Succeeded as i32;
                operation.cleanup_lease_id = "cleanup-1".to_string();
                operation.cleanup_epoch = 1;
                operation.cleanup_fencing_token = 1;
            }
            Ok(operation.clone())
        }
    }

    #[test]
    fn capability_operation_worker_persists_cursor_and_avoids_restart_reexecution() {
        let path = std::env::temp_dir().join(format!(
            "peers-operation-worker-{}.sqlite3",
            ulid::Ulid::new()
        ));
        let ledger = OperationLedger::open_test(&path).expect("open ledger");
        let executor = Executor {
            calls: RefCell::new(0),
        };
        let transport = Transport {
            operation: RefCell::new(operation()),
        };
        let worker = CapabilityOperationWorker::new(
            "http://station",
            "device-1",
            "session-1",
            &ledger,
            &executor,
            &transport,
        );
        assert_eq!(worker.tick_at(1_000).unwrap(), 1);
        assert_eq!(*executor.calls.borrow(), 1);
        drop(worker);

        let reopened = OperationLedger::open_test(&path).expect("reopen ledger");
        let restarted = CapabilityOperationWorker::new(
            "http://station",
            "device-1",
            "session-1",
            &reopened,
            &executor,
            &transport,
        );
        assert_eq!(restarted.tick_at(1_001).unwrap(), 1);
        assert_eq!(*executor.calls.borrow(), 1);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn capability_operation_worker_reconciles_cancellation_before_side_effect() {
        let path = std::env::temp_dir().join(format!(
            "peers-operation-worker-cancelled-{}.sqlite3",
            ulid::Ulid::new()
        ));
        let ledger = OperationLedger::open_test(&path).expect("open ledger");
        let executor = Executor {
            calls: RefCell::new(0),
        };
        let mut cancelled = operation();
        cancelled.status = CapabilityOperationStatus::SettlingCleanup as i32;
        cancelled.desired_terminal_outcome = CapabilityOperationStatus::Cancelled as i32;
        cancelled.cleanup_lease_id = "cleanup-1".to_string();
        cancelled.cleanup_epoch = 1;
        cancelled.cleanup_fencing_token = 1;
        let transport = Transport {
            operation: RefCell::new(cancelled),
        };
        let worker = CapabilityOperationWorker::new(
            "http://station",
            "device-1",
            "session-1",
            &ledger,
            &executor,
            &transport,
        );

        assert_eq!(worker.tick_at(1_000).unwrap(), 1);
        assert_eq!(*executor.calls.borrow(), 0);
        assert_eq!(
            transport.operation.borrow().status,
            CapabilityOperationStatus::Cancelled as i32,
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn capability_operation_worker_interrupt_stops_the_current_generation() {
        let path = std::env::temp_dir().join(format!(
            "peers-operation-worker-interrupt-{}.sqlite3",
            ulid::Ulid::new()
        ));
        let ledger = OperationLedger::open_test(&path).expect("open ledger");
        let executor = Executor {
            calls: RefCell::new(0),
        };
        let transport = Transport {
            operation: RefCell::new(operation()),
        };
        let worker = CapabilityOperationWorker::new(
            "http://station",
            "device-1",
            "session-1",
            &ledger,
            &executor,
            &transport,
        );

        let error = worker
            .tick_at_with_scenario_hook(1_000, &mut |barrier, _| {
                Ok(barrier
                    == super::super::operation_executor::ACCEPTANCE_BARRIER_OPERATION_PREPARED_BEFORE_EFFECT)
            })
            .expect_err("acceptance interrupt must stop this worker generation");

        assert_eq!(error, ACCEPTANCE_WORKER_INTERRUPTED);
        assert_eq!(*executor.calls.borrow(), 0);
        assert_eq!(ledger.cursor("http://station", "session-1").unwrap(), 0);
        let _ = std::fs::remove_file(path);
    }

    fn operation() -> CapabilityOperation {
        CapabilityOperation {
            operation_id: "operation-1".to_string(),
            target_device_id: "device-1".to_string(),
            capability_session_id: "session-1".to_string(),
            executor_lease_id: "lease-1".to_string(),
            operation_kind: "test".to_string(),
            status: CapabilityOperationStatus::Dispatched as i32,
            attempt: 1,
            attempt_epoch: 1,
            fencing_token: 1,
            deadline: Some(Timestamp {
                seconds: 10,
                nanos: 0,
            }),
            dispatch_sequence: 1,
            ..Default::default()
        }
    }
}
