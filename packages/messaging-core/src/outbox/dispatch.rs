use crate::proto::chat::PrepareMessagingSendResponse;

#[derive(Debug, Clone, PartialEq)]
pub enum CommandSubmitFailure {
    Retryable { code: String },
    StaleDeliveryPlan { current_plan: PrepareMessagingSendResponse },
    StaleAuthorityPlan { expired: bool },
    Terminal { code: String },
}

pub trait CommandTransport: Send + Sync {
    fn submit(&self, exact_command_bytes: &[u8]) -> Result<(), CommandSubmitFailure>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommandRetryPolicy {
    pub initial_delay_ms: i64,
    pub maximum_delay_ms: i64,
}

impl CommandRetryPolicy {
    pub fn validate(self) -> Result<Self, String> {
        if self.initial_delay_ms <= 0 || self.maximum_delay_ms < self.initial_delay_ms {
            return Err("messaging command retry policy is invalid".to_string());
        }
        Ok(self)
    }
}

pub struct CommandOutboxEntry {
    pub command_id: String,
    pub command_bytes: Vec<u8>,
    pub attempt_count: u32,
}

pub trait OutboxStore: Send + Sync {
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
}

#[derive(Debug, Clone, PartialEq)]
pub enum CommandDispatchProgress {
    Idle,
    Submitted { command_id: String },
    RetryScheduled { command_id: String, next_attempt_at_unix_ms: i64 },
    Failed { command_id: String, code: String },
    StaleDeliveryPlan { command_id: String, current_plan: PrepareMessagingSendResponse },
    StaleAuthorityPlan { command_id: String, expired: bool },
}

pub struct CommandOutboxWorker<T: CommandTransport, S: OutboxStore> {
    store: S,
    transport: T,
    retry_policy: CommandRetryPolicy,
}

impl<T: CommandTransport, S: OutboxStore> CommandOutboxWorker<T, S> {
    pub fn new(store: S, transport: T, retry_policy: CommandRetryPolicy) -> Result<Self, String> {
        Ok(Self {
            store,
            transport,
            retry_policy: retry_policy.validate()?,
        })
    }

    pub fn dispatch_once(&self, now_unix_ms: i64) -> Result<CommandDispatchProgress, String> {
        if now_unix_ms <= 0 {
            return Err("messaging command dispatch time is invalid".to_string());
        }
        let Some(command) = self.store.next_command(now_unix_ms)? else {
            return Ok(CommandDispatchProgress::Idle);
        };
        match self.transport.submit(&command.command_bytes) {
            Ok(()) => {
                self.store.mark_command_submitted(
                    &command.command_id,
                    &command.command_bytes,
                    command.attempt_count,
                )?;
                Ok(CommandDispatchProgress::Submitted {
                    command_id: command.command_id,
                })
            }
            Err(CommandSubmitFailure::Retryable { code }) => {
                if code.trim().is_empty() {
                    return Err("messaging retryable command failure has no code".to_string());
                }
                let exponent = command.attempt_count.min(30);
                let multiplier = 1_i64 << exponent;
                let delay = self
                    .retry_policy
                    .initial_delay_ms
                    .saturating_mul(multiplier)
                    .min(self.retry_policy.maximum_delay_ms);
                let next_attempt_at_unix_ms = now_unix_ms.saturating_add(delay);
                self.store.mark_command_retry(
                    &command.command_id,
                    &command.command_bytes,
                    command.attempt_count,
                    next_attempt_at_unix_ms,
                    &code,
                )?;
                Ok(CommandDispatchProgress::RetryScheduled {
                    command_id: command.command_id,
                    next_attempt_at_unix_ms,
                })
            }
            Err(CommandSubmitFailure::StaleDeliveryPlan { current_plan }) => {
                self.store.mark_command_superseded(
                    &command.command_id,
                    &command.command_bytes,
                    command.attempt_count,
                )?;
                Ok(CommandDispatchProgress::StaleDeliveryPlan {
                    command_id: command.command_id,
                    current_plan,
                })
            }
            Err(CommandSubmitFailure::StaleAuthorityPlan { expired }) => {
                self.store.mark_command_superseded(
                    &command.command_id,
                    &command.command_bytes,
                    command.attempt_count,
                )?;
                Ok(CommandDispatchProgress::StaleAuthorityPlan {
                    command_id: command.command_id,
                    expired,
                })
            }
            Err(CommandSubmitFailure::Terminal { code }) => {
                if code.trim().is_empty() {
                    return Err("messaging terminal command failure has no code".to_string());
                }
                self.store.mark_command_failed(
                    &command.command_id,
                    &command.command_bytes,
                    command.attempt_count,
                    &code,
                )?;
                Ok(CommandDispatchProgress::Failed {
                    command_id: command.command_id,
                    code,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    struct RecordingTransport {
        outcomes: Mutex<VecDeque<Result<(), CommandSubmitFailure>>>,
    }

    impl CommandTransport for RecordingTransport {
        fn submit(&self, _exact_command_bytes: &[u8]) -> Result<(), CommandSubmitFailure> {
            self.outcomes.lock().unwrap().pop_front().unwrap()
        }
    }

    struct InMemoryOutbox {
        commands: Mutex<Vec<(CommandOutboxEntry, String)>>,
    }

    impl InMemoryOutbox {
        fn new() -> Self {
            Self { commands: Mutex::new(Vec::new()) }
        }

        fn insert(&self, id: &str, bytes: &[u8]) {
            self.commands.lock().unwrap().push((
                CommandOutboxEntry {
                    command_id: id.to_string(),
                    command_bytes: bytes.to_vec(),
                    attempt_count: 0,
                },
                "pending".to_string(),
            ));
        }
    }

    impl OutboxStore for InMemoryOutbox {
        fn next_command(&self, _now_unix_ms: i64) -> Result<Option<CommandOutboxEntry>, String> {
            let commands = self.commands.lock().unwrap();
            Ok(commands
                .iter()
                .find(|(_, status)| status == "pending")
                .map(|(entry, _)| CommandOutboxEntry {
                    command_id: entry.command_id.clone(),
                    command_bytes: entry.command_bytes.clone(),
                    attempt_count: entry.attempt_count,
                }))
        }

        fn mark_command_submitted(&self, id: &str, _bytes: &[u8], _attempt: u32) -> Result<(), String> {
            let mut commands = self.commands.lock().unwrap();
            if let Some((_, status)) = commands.iter_mut().find(|(e, _)| e.command_id == id) {
                *status = "submitted".to_string();
            }
            Ok(())
        }

        fn mark_command_retry(&self, id: &str, _bytes: &[u8], attempt: u32, _next: i64, _code: &str) -> Result<(), String> {
            let mut commands = self.commands.lock().unwrap();
            if let Some((entry, _)) = commands.iter_mut().find(|(e, _)| e.command_id == id) {
                entry.attempt_count = attempt + 1;
            }
            Ok(())
        }

        fn mark_command_failed(&self, id: &str, _bytes: &[u8], _attempt: u32, _code: &str) -> Result<(), String> {
            let mut commands = self.commands.lock().unwrap();
            if let Some((_, status)) = commands.iter_mut().find(|(e, _)| e.command_id == id) {
                *status = "failed".to_string();
            }
            Ok(())
        }

        fn mark_command_superseded(&self, id: &str, _bytes: &[u8], _attempt: u32) -> Result<(), String> {
            let mut commands = self.commands.lock().unwrap();
            if let Some((_, status)) = commands.iter_mut().find(|(e, _)| e.command_id == id) {
                *status = "superseded".to_string();
            }
            Ok(())
        }
    }

    #[test]
    fn submits_pending_command() {
        let store = InMemoryOutbox::new();
        store.insert("cmd-1", b"encrypted payload");
        let worker = CommandOutboxWorker::new(
            store,
            RecordingTransport { outcomes: Mutex::new(VecDeque::from([Ok(())])) },
            CommandRetryPolicy { initial_delay_ms: 10, maximum_delay_ms: 100 },
        ).unwrap();
        assert_eq!(
            worker.dispatch_once(100).unwrap(),
            CommandDispatchProgress::Submitted { command_id: "cmd-1".to_string() }
        );
    }

    #[test]
    fn retryable_failure_schedules_exponential_backoff() {
        let store = InMemoryOutbox::new();
        store.insert("cmd-2", b"payload");
        let worker = CommandOutboxWorker::new(
            store,
            RecordingTransport {
                outcomes: Mutex::new(VecDeque::from([
                    Err(CommandSubmitFailure::Retryable { code: "timeout".to_string() }),
                ])),
            },
            CommandRetryPolicy { initial_delay_ms: 10, maximum_delay_ms: 5000 },
        ).unwrap();
        assert_eq!(
            worker.dispatch_once(1000).unwrap(),
            CommandDispatchProgress::RetryScheduled {
                command_id: "cmd-2".to_string(),
                next_attempt_at_unix_ms: 1010,
            }
        );
    }

    #[test]
    fn terminal_failure_marks_command_failed() {
        let store = InMemoryOutbox::new();
        store.insert("cmd-3", b"payload");
        let worker = CommandOutboxWorker::new(
            store,
            RecordingTransport {
                outcomes: Mutex::new(VecDeque::from([
                    Err(CommandSubmitFailure::Terminal { code: "forbidden".to_string() }),
                ])),
            },
            CommandRetryPolicy { initial_delay_ms: 10, maximum_delay_ms: 100 },
        ).unwrap();
        assert_eq!(
            worker.dispatch_once(100).unwrap(),
            CommandDispatchProgress::Failed {
                command_id: "cmd-3".to_string(),
                code: "forbidden".to_string(),
            }
        );
    }

    #[test]
    fn idle_when_no_pending_commands() {
        let store = InMemoryOutbox::new();
        let worker = CommandOutboxWorker::new(
            store,
            RecordingTransport { outcomes: Mutex::new(VecDeque::new()) },
            CommandRetryPolicy { initial_delay_ms: 10, maximum_delay_ms: 100 },
        ).unwrap();
        assert_eq!(worker.dispatch_once(100).unwrap(), CommandDispatchProgress::Idle);
    }
}
