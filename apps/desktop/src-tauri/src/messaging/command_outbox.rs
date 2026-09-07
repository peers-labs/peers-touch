use super::MessagingStore;
use crate::model::chat::PrepareConversationCommandResponse;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq)]
pub enum CommandSubmitFailure {
    Retryable {
        code: String,
    },
    StaleDeliveryPlan {
        current_plan: PrepareConversationCommandResponse,
    },
    StaleAuthorityPlan {
        expired: bool,
    },
    Terminal {
        code: String,
    },
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

#[derive(Debug, Clone, PartialEq)]
pub enum CommandDispatchProgress {
    Idle,
    Submitted {
        command_id: String,
    },
    RetryScheduled {
        command_id: String,
        next_attempt_at_unix_ms: i64,
    },
    Failed {
        command_id: String,
        code: String,
    },
    StaleDeliveryPlan {
        command_id: String,
        current_plan: PrepareConversationCommandResponse,
    },
    StaleAuthorityPlan {
        command_id: String,
        expired: bool,
    },
}

pub struct CommandOutboxWorker<T: CommandTransport> {
    store: Arc<MessagingStore>,
    transport: T,
    retry_policy: CommandRetryPolicy,
}

impl<T: CommandTransport> CommandOutboxWorker<T> {
    pub fn new(
        store: Arc<MessagingStore>,
        transport: T,
        retry_policy: CommandRetryPolicy,
    ) -> Result<Self, String> {
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
    use crate::domain::crypto::double_ratchet::DrSessionState;
    use crate::domain::crypto::{CryptoEndpoint, DirectSession, DirectSessionKey};
    use crate::messaging::{DirectSendCommit, PendingSenderProjection};
    use std::collections::VecDeque;
    use std::sync::Mutex;

    struct RecordingTransport {
        outcomes: Mutex<VecDeque<Result<(), CommandSubmitFailure>>>,
        submitted: Mutex<Vec<Vec<u8>>>,
    }

    impl CommandTransport for RecordingTransport {
        fn submit(&self, exact_command_bytes: &[u8]) -> Result<(), CommandSubmitFailure> {
            self.submitted
                .lock()
                .unwrap()
                .push(exact_command_bytes.to_vec());
            self.outcomes.lock().unwrap().pop_front().unwrap()
        }
    }

    fn session() -> DirectSession {
        DirectSession {
            session_id: "session-1".to_string(),
            key: DirectSessionKey::new(
                "conversation-1",
                CryptoEndpoint::new("ptid:alice", "alice-device").unwrap(),
                CryptoEndpoint::new("ptid:bob", "bob-device").unwrap(),
                1,
            )
            .unwrap(),
            protocol_version: 1,
            established: true,
            peer_identity_key: [1; 32],
            ratchet: DrSessionState {
                session_id: "session-1".to_string(),
                root_key: [2; 32],
                self_priv: [3; 32],
                self_pub: [4; 32],
                peer_pub: Some([5; 32]),
                send_chain_key: Some([6; 32]),
                recv_chain_key: Some([7; 32]),
                n_send: 1,
                n_recv: 0,
                n_prev: 0,
            },
            updated_at_unix_ms: 10,
        }
    }

    fn prepare(store: &MessagingStore, command_id: &str) {
        let private_content =
            crate::messaging::encode_message_private_content("draft survives", &[]).unwrap();
        store
            .persist_direct_send(&DirectSendCommit {
                command_bytes: b"immutable encrypted command",
                advanced_sessions: &[session()],
                session_inits: &[],
                projection: PendingSenderProjection {
                    command_id,
                    conversation_id: "conversation-1",
                    conversation_kind: 1,
                    message_id: command_id,
                    sender_ptid: "ptid:alice",
                    sender_device_id: "alice-device",
                    plaintext: "draft survives",
                    reply_to_message_id: "",
                    thread_root_message_id: "",
                    attachments: &[],
                    private_content: &private_content,
                    delivery_plan_sha256: &[1; 32],
                    created_at_unix_ms: 10,
                },
            })
            .unwrap();
    }

    #[test]
    fn retry_reuses_exact_command_bytes_without_repreparing_crypto() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        prepare(&store, "command-1");
        let transport = RecordingTransport {
            outcomes: Mutex::new(VecDeque::from([
                Err(CommandSubmitFailure::Retryable {
                    code: "network".to_string(),
                }),
                Ok(()),
            ])),
            submitted: Mutex::new(Vec::new()),
        };
        let worker = CommandOutboxWorker::new(
            store,
            transport,
            CommandRetryPolicy {
                initial_delay_ms: 10,
                maximum_delay_ms: 100,
            },
        )
        .unwrap();
        assert_eq!(
            worker.dispatch_once(100).unwrap(),
            CommandDispatchProgress::RetryScheduled {
                command_id: "command-1".to_string(),
                next_attempt_at_unix_ms: 110,
            }
        );
        assert_eq!(
            worker.dispatch_once(109).unwrap(),
            CommandDispatchProgress::Idle
        );
        assert_eq!(
            worker.dispatch_once(110).unwrap(),
            CommandDispatchProgress::Submitted {
                command_id: "command-1".to_string(),
            }
        );
        let submitted = worker.transport.submitted.lock().unwrap();
        assert_eq!(submitted.len(), 2);
        assert_eq!(submitted[0], b"immutable encrypted command");
        assert_eq!(submitted[1], submitted[0]);
    }

    #[test]
    fn terminal_failure_retains_plaintext_draft_as_failed_projection() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        prepare(&store, "command-failed");
        let worker = CommandOutboxWorker::new(
            store.clone(),
            RecordingTransport {
                outcomes: Mutex::new(VecDeque::from([Err(CommandSubmitFailure::Terminal {
                    code: "forbidden".to_string(),
                })])),
                submitted: Mutex::new(Vec::new()),
            },
            CommandRetryPolicy {
                initial_delay_ms: 10,
                maximum_delay_ms: 100,
            },
        )
        .unwrap();
        assert_eq!(
            worker.dispatch_once(100).unwrap(),
            CommandDispatchProgress::Failed {
                command_id: "command-failed".to_string(),
                code: "forbidden".to_string(),
            }
        );
        assert_eq!(
            store
                .pending_sender_projection("command-failed")
                .unwrap()
                .unwrap(),
            ("draft survives".to_string(), "failed".to_string())
        );
        assert!(store.next_command(1_000).unwrap().is_none());
    }

    #[test]
    fn stale_plan_supersedes_old_ciphertext_without_losing_logical_draft() {
        let store = Arc::new(MessagingStore::in_memory().unwrap());
        prepare(&store, "command-stale");
        let current_plan = PrepareConversationCommandResponse {
            conversation_id: "conversation-1".to_string(),
            delivery_plan_sha256: vec![7; 32],
            ..Default::default()
        };
        let worker = CommandOutboxWorker::new(
            store.clone(),
            RecordingTransport {
                outcomes: Mutex::new(VecDeque::from([Err(
                    CommandSubmitFailure::StaleDeliveryPlan {
                        current_plan: current_plan.clone(),
                    },
                )])),
                submitted: Mutex::new(Vec::new()),
            },
            CommandRetryPolicy {
                initial_delay_ms: 10,
                maximum_delay_ms: 100,
            },
        )
        .unwrap();
        assert_eq!(
            worker.dispatch_once(100).unwrap(),
            CommandDispatchProgress::StaleDeliveryPlan {
                command_id: "command-stale".to_string(),
                current_plan,
            }
        );
        assert_eq!(
            store
                .pending_sender_projection("command-stale")
                .unwrap()
                .unwrap(),
            ("draft survives".to_string(), "draft".to_string())
        );
        assert_eq!(
            store
                .next_due_message_draft(100)
                .unwrap()
                .unwrap()
                .message_id,
            "command-stale"
        );
        assert!(store.next_command(1_000).unwrap().is_none());
    }
}
