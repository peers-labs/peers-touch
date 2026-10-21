use crate::contracts::CryptoEndpoint;
use crate::ports::CommandResultTransport;
use crate::proto::chat::{
    chat_command, ChatCommand, ConversationCommandProposalResult, ConversationCommandRejectCode,
    ConversationCommandResolutionState, ConversationCommandResultRef,
    ConversationMemberAuthorityCommand, CryptoEndpoint as ProtoCryptoEndpoint,
    ResolveConversationCommandResultsRequest, ResolvedConversationCommandResult,
};
use crate::store::MessagingRepository;
use prost::Message;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub const COMMAND_RECONCILIATION_BATCH_LIMIT: usize = 64;
pub const COMMAND_RECONCILIATION_RETRY_DELAY_MS: i64 = 1_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubmittedCommand {
    pub command_id: String,
    pub conversation_id: String,
    pub command_bytes: Vec<u8>,
    pub command_sha256: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommandReconciliationDisposition {
    HomePending,
    Accepted,
    Failed(String),
    Superseded(String),
    NotFound,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandReconciliation {
    pub command_id: String,
    pub conversation_id: String,
    pub command_bytes: Vec<u8>,
    pub command_sha256: Vec<u8>,
    pub disposition: CommandReconciliationDisposition,
}

pub trait CommandReconciliationRepository: Send + Sync {
    fn submitted_commands(&self) -> Result<Vec<SubmittedCommand>, String>;

    fn apply_command_reconciliations(
        &self,
        reconciliations: &[CommandReconciliation],
        retry_at_unix_ms: i64,
    ) -> Result<(), String>;
}

impl<R: MessagingRepository> CommandReconciliationRepository for R {
    fn submitted_commands(&self) -> Result<Vec<SubmittedCommand>, String> {
        MessagingRepository::submitted_commands(self)
    }

    fn apply_command_reconciliations(
        &self,
        reconciliations: &[CommandReconciliation],
        retry_at_unix_ms: i64,
    ) -> Result<(), String> {
        MessagingRepository::apply_command_reconciliations(self, reconciliations, retry_at_unix_ms)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommandReconciliationProgress {
    Idle,
    Reconciled {
        command_count: usize,
        transition_count: usize,
        retry_count: usize,
        next_reconciliation_at_unix_ms: Option<i64>,
        terminal_membership_conversations: Vec<String>,
    },
}

impl CommandReconciliationProgress {
    pub fn has_immediate_follow_up(&self) -> bool {
        matches!(
            self,
            Self::Reconciled {
                transition_count,
                ..
            } if *transition_count > 0
        )
    }

    pub fn next_reconciliation_at_unix_ms(&self) -> Option<i64> {
        match self {
            Self::Idle => None,
            Self::Reconciled {
                next_reconciliation_at_unix_ms,
                ..
            } => *next_reconciliation_at_unix_ms,
        }
    }
}

pub fn reconcile_submitted_commands<R, T>(
    repository: &R,
    transport: &T,
    endpoint: &CryptoEndpoint,
    now_unix_ms: i64,
) -> Result<CommandReconciliationProgress, String>
where
    R: CommandReconciliationRepository,
    T: CommandResultTransport,
{
    endpoint.validate()?;
    if now_unix_ms <= 0 {
        return Err("messaging command reconciliation time is invalid".to_string());
    }
    let retry_at_unix_ms = now_unix_ms
        .checked_add(COMMAND_RECONCILIATION_RETRY_DELAY_MS)
        .ok_or_else(|| "messaging command reconciliation retry time overflowed".to_string())?;
    let submitted = repository.submitted_commands()?;
    if submitted.is_empty() {
        return Ok(CommandReconciliationProgress::Idle);
    }
    if submitted.len() > COMMAND_RECONCILIATION_BATCH_LIMIT {
        return Err("messaging command reconciliation batch exceeds limit".to_string());
    }

    let request = ResolveConversationCommandResultsRequest {
        commands: submitted
            .iter()
            .map(|command| ConversationCommandResultRef {
                conversation_id: command.conversation_id.clone(),
                command_id: command.command_id.clone(),
                command_sha256: command.command_sha256.clone(),
            })
            .collect(),
    };
    let reconciliations = validate_results(&submitted, transport.resolve(request)?, endpoint)?;
    let home_pending_count = reconciliations
        .iter()
        .filter(|result| {
            matches!(
                result.disposition,
                CommandReconciliationDisposition::HomePending
            )
        })
        .count();
    let transition_count = reconciliations.len().saturating_sub(home_pending_count);
    let retry_count = reconciliations
        .iter()
        .filter(|result| {
            matches!(
                result.disposition,
                CommandReconciliationDisposition::NotFound
            )
        })
        .count();
    let terminal_membership_conversations = reconciliations
        .iter()
        .filter(|result| {
            matches!(
                result.disposition,
                CommandReconciliationDisposition::Failed(_)
                    | CommandReconciliationDisposition::Superseded(_)
            )
        })
        .filter_map(|result| {
            ChatCommand::decode(result.command_bytes.as_slice())
                .ok()
                .filter(|command| {
                    matches!(
                        command.payload,
                        Some(chat_command::Payload::MembershipTransition(_))
                    )
                })
                .map(|command| command.conversation_id)
        })
        .collect::<Vec<_>>();

    repository.apply_command_reconciliations(&reconciliations, retry_at_unix_ms)?;
    Ok(CommandReconciliationProgress::Reconciled {
        command_count: reconciliations.len(),
        transition_count,
        retry_count,
        next_reconciliation_at_unix_ms: (home_pending_count > 0).then_some(retry_at_unix_ms),
        terminal_membership_conversations,
    })
}

fn validate_results(
    submitted: &[SubmittedCommand],
    results: Vec<ResolvedConversationCommandResult>,
    endpoint: &CryptoEndpoint,
) -> Result<Vec<CommandReconciliation>, String> {
    if results.len() != submitted.len() {
        return Err("messaging command reconciliation response count mismatch".to_string());
    }
    let mut by_identity = HashMap::with_capacity(results.len());
    for result in results {
        let identity = (result.conversation_id.clone(), result.command_id.clone());
        if by_identity.insert(identity, result).is_some() {
            return Err("messaging command reconciliation response is duplicated".to_string());
        }
    }

    submitted
        .iter()
        .map(|submitted| {
            let result = by_identity
                .remove(&(
                    submitted.conversation_id.clone(),
                    submitted.command_id.clone(),
                ))
                .ok_or_else(|| {
                    "messaging command reconciliation response identity mismatch".to_string()
                })?;
            if result.command_sha256 != submitted.command_sha256
                || submitted.command_sha256.len() != 32
                || Sha256::digest(&submitted.command_bytes).as_slice() != submitted.command_sha256
            {
                return Err("messaging command reconciliation command hash mismatch".to_string());
            }
            let command = decode_submitted_command(&submitted.command_bytes)?;
            if command.command_id != submitted.command_id
                || command.conversation_id != submitted.conversation_id
                || command.actor.as_ref().map(|actor| actor.ptid.as_str())
                    != Some(endpoint.ptid.as_str())
                || command.actor.as_ref().map(|actor| actor.device_id.as_str())
                    != Some(endpoint.device_id.as_str())
            {
                return Err(
                    "messaging command reconciliation does not match local command".to_string(),
                );
            }
            let disposition = validate_result(&command, &result)?;
            Ok(CommandReconciliation {
                command_id: submitted.command_id.clone(),
                conversation_id: submitted.conversation_id.clone(),
                command_bytes: submitted.command_bytes.clone(),
                command_sha256: submitted.command_sha256.clone(),
                disposition,
            })
        })
        .collect()
}

struct DecodedSubmittedCommand {
    command_id: String,
    conversation_id: String,
    authority_station_peer_id: String,
    actor: Option<ProtoCryptoEndpoint>,
}

fn decode_submitted_command(bytes: &[u8]) -> Result<DecodedSubmittedCommand, String> {
    if let Ok(command) = ChatCommand::decode(bytes) {
        if command.encode_to_vec() == bytes {
            return Ok(DecodedSubmittedCommand {
                command_id: command.command_id,
                conversation_id: command.conversation_id,
                authority_station_peer_id: command.authority_station_peer_id,
                actor: command.sender,
            });
        }
    }
    let command = ConversationMemberAuthorityCommand::decode(bytes)
        .map_err(|error| format!("decode submitted messaging command: {error}"))?;
    if command.encode_to_vec() != bytes {
        return Err("submitted messaging command bytes are not canonical".to_string());
    }
    Ok(DecodedSubmittedCommand {
        command_id: command.command_id,
        conversation_id: command.conversation_id,
        authority_station_peer_id: command.authority_station_peer_id,
        actor: command.operator,
    })
}

fn validate_result(
    command: &DecodedSubmittedCommand,
    resolved: &ResolvedConversationCommandResult,
) -> Result<CommandReconciliationDisposition, String> {
    let state = ConversationCommandResolutionState::try_from(resolved.state)
        .map_err(|_| "messaging command reconciliation state is invalid".to_string())?;
    let terminal_code = ConversationCommandRejectCode::try_from(resolved.terminal_error_code)
        .map_err(|_| "messaging command reconciliation reject code is invalid".to_string())?;
    match state {
        ConversationCommandResolutionState::HomePending => {
            require_empty_result(resolved, terminal_code)?;
            Ok(CommandReconciliationDisposition::HomePending)
        }
        ConversationCommandResolutionState::Accepted => {
            if terminal_code != ConversationCommandRejectCode::Unspecified {
                return Err("messaging accepted reconciliation has terminal error code".to_string());
            }
            validate_accepted_result(
                command,
                resolved.result.as_ref().ok_or_else(|| {
                    "messaging accepted reconciliation has no canonical result".to_string()
                })?,
            )?;
            Ok(CommandReconciliationDisposition::Accepted)
        }
        ConversationCommandResolutionState::TerminalRejected => {
            if terminal_code == ConversationCommandRejectCode::Unspecified {
                return Err(
                    "messaging rejected reconciliation has no terminal error code".to_string(),
                );
            }
            if let Some(result) = resolved.result.as_ref() {
                validate_rejected_result(command, result, terminal_code)?;
            }
            let error_code = reject_error_code(terminal_code)?;
            if is_superseding_rejection(terminal_code) {
                Ok(CommandReconciliationDisposition::Superseded(error_code))
            } else {
                Ok(CommandReconciliationDisposition::Failed(error_code))
            }
        }
        ConversationCommandResolutionState::NotFound => {
            require_empty_result(resolved, terminal_code)?;
            Ok(CommandReconciliationDisposition::NotFound)
        }
        ConversationCommandResolutionState::Unspecified => {
            Err("messaging command reconciliation state is unspecified".to_string())
        }
    }
}

fn require_empty_result(
    resolved: &ResolvedConversationCommandResult,
    terminal_code: ConversationCommandRejectCode,
) -> Result<(), String> {
    if resolved.result.is_some() || terminal_code != ConversationCommandRejectCode::Unspecified {
        return Err("messaging nonterminal reconciliation carries a result".to_string());
    }
    Ok(())
}

fn validate_accepted_result(
    command: &DecodedSubmittedCommand,
    result: &ConversationCommandProposalResult,
) -> Result<(), String> {
    let reject_code = ConversationCommandRejectCode::try_from(result.reject_code)
        .map_err(|_| "messaging accepted reconciliation reject code is invalid".to_string())?;
    let event = result
        .event
        .as_ref()
        .ok_or_else(|| "messaging accepted reconciliation has no authority event".to_string())?;
    if result.command_id != command.command_id
        || !result.accepted
        || result.retryable
        || reject_code != ConversationCommandRejectCode::Unspecified
        || result.authority_sequence != event.sequence
        || result.authority_event_hash != event.event_hash
        || event.command_id != command.command_id
        || event.conversation_id != command.conversation_id
        || event.authority_station_peer_id != command.authority_station_peer_id
        || event.actor != command.actor
        || event.sequence <= 0
        || event.event_hash.len() != 32
    {
        return Err("messaging accepted reconciliation result is invalid".to_string());
    }
    Ok(())
}

fn validate_rejected_result(
    command: &DecodedSubmittedCommand,
    result: &ConversationCommandProposalResult,
    terminal_code: ConversationCommandRejectCode,
) -> Result<(), String> {
    let reject_code = ConversationCommandRejectCode::try_from(result.reject_code)
        .map_err(|_| "messaging rejected reconciliation reject code is invalid".to_string())?;
    if result.command_id != command.command_id
        || result.accepted
        || result.retryable
        || result.event.is_some()
        || reject_code != terminal_code
    {
        return Err("messaging rejected reconciliation result is invalid".to_string());
    }
    Ok(())
}

fn reject_error_code(code: ConversationCommandRejectCode) -> Result<String, String> {
    code.as_str_name()
        .strip_prefix("CONVERSATION_COMMAND_REJECT_CODE_")
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "messaging command reject code is invalid".to_string())
}

fn is_superseding_rejection(code: ConversationCommandRejectCode) -> bool {
    matches!(
        code,
        ConversationCommandRejectCode::StaleDeliveryPlan
            | ConversationCommandRejectCode::AuthorityHeadStale
            | ConversationCommandRejectCode::MembershipEpochStale
            | ConversationCommandRejectCode::MlsEpochMismatch
            | ConversationCommandRejectCode::AuthorityPlanStale
            | ConversationCommandRejectCode::AuthorityPlanExpired
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct Repository {
        submitted: Vec<SubmittedCommand>,
        applied: Mutex<Vec<CommandReconciliation>>,
    }

    impl CommandReconciliationRepository for Repository {
        fn submitted_commands(&self) -> Result<Vec<SubmittedCommand>, String> {
            Ok(self.submitted.clone())
        }

        fn apply_command_reconciliations(
            &self,
            reconciliations: &[CommandReconciliation],
            _retry_at_unix_ms: i64,
        ) -> Result<(), String> {
            self.applied
                .lock()
                .unwrap()
                .extend_from_slice(reconciliations);
            Ok(())
        }
    }

    struct Transport {
        results: Vec<ResolvedConversationCommandResult>,
    }

    impl CommandResultTransport for Transport {
        fn resolve(
            &self,
            _request: ResolveConversationCommandResultsRequest,
        ) -> Result<Vec<ResolvedConversationCommandResult>, String> {
            Ok(self.results.clone())
        }
    }

    fn endpoint() -> CryptoEndpoint {
        CryptoEndpoint::new("ptid:alice", "device-1").unwrap()
    }

    fn command(command_id: &str) -> SubmittedCommand {
        let bytes = ChatCommand {
            command_id: command_id.to_string(),
            conversation_id: "conversation-1".to_string(),
            authority_station_peer_id: "station-1".to_string(),
            sender: Some(ProtoCryptoEndpoint {
                ptid: "ptid:alice".to_string(),
                device_id: "device-1".to_string(),
            }),
            ..ChatCommand::default()
        }
        .encode_to_vec();
        SubmittedCommand {
            command_id: command_id.to_string(),
            conversation_id: "conversation-1".to_string(),
            command_sha256: Sha256::digest(&bytes).to_vec(),
            command_bytes: bytes,
        }
    }

    fn result(
        command_id: &str,
        state: ConversationCommandResolutionState,
    ) -> ResolvedConversationCommandResult {
        let command = command(command_id);
        ResolvedConversationCommandResult {
            conversation_id: command.conversation_id,
            command_id: command.command_id,
            command_sha256: command.command_sha256,
            state: state as i32,
            terminal_error_code: ConversationCommandRejectCode::Unspecified as i32,
            ..ResolvedConversationCommandResult::default()
        }
    }

    #[test]
    fn not_found_is_persisted_for_exact_command_retry() {
        let repository = Repository {
            submitted: vec![command("command-1")],
            applied: Mutex::new(Vec::new()),
        };
        let progress = reconcile_submitted_commands(
            &repository,
            &Transport {
                results: vec![result(
                    "command-1",
                    ConversationCommandResolutionState::NotFound,
                )],
            },
            &endpoint(),
            100,
        )
        .unwrap();

        assert_eq!(
            progress,
            CommandReconciliationProgress::Reconciled {
                command_count: 1,
                transition_count: 1,
                retry_count: 1,
                next_reconciliation_at_unix_ms: None,
                terminal_membership_conversations: Vec::new(),
            }
        );
        assert!(matches!(
            repository.applied.lock().unwrap()[0].disposition,
            CommandReconciliationDisposition::NotFound
        ));
    }

    #[test]
    fn home_pending_is_deferred_without_reporting_immediate_progress() {
        let repository = Repository {
            submitted: vec![command("command-1")],
            applied: Mutex::new(Vec::new()),
        };
        let progress = reconcile_submitted_commands(
            &repository,
            &Transport {
                results: vec![result(
                    "command-1",
                    ConversationCommandResolutionState::HomePending,
                )],
            },
            &endpoint(),
            100,
        )
        .unwrap();

        assert_eq!(
            progress,
            CommandReconciliationProgress::Reconciled {
                command_count: 1,
                transition_count: 0,
                retry_count: 0,
                next_reconciliation_at_unix_ms: Some(100 + COMMAND_RECONCILIATION_RETRY_DELAY_MS,),
                terminal_membership_conversations: Vec::new(),
            }
        );
        assert!(!progress.has_immediate_follow_up());
        assert_eq!(
            progress.next_reconciliation_at_unix_ms(),
            Some(100 + COMMAND_RECONCILIATION_RETRY_DELAY_MS),
        );
        assert!(matches!(
            repository.applied.lock().unwrap()[0].disposition,
            CommandReconciliationDisposition::HomePending
        ));
    }

    #[test]
    fn response_count_identity_and_hash_mismatches_fail_closed() {
        let repository = Repository {
            submitted: vec![command("command-1")],
            applied: Mutex::new(Vec::new()),
        };
        assert!(reconcile_submitted_commands(
            &repository,
            &Transport { results: vec![] },
            &endpoint(),
            100,
        )
        .is_err());

        let mut wrong_hash = result("command-1", ConversationCommandResolutionState::NotFound);
        wrong_hash.command_sha256 = vec![9; 32];
        assert!(reconcile_submitted_commands(
            &repository,
            &Transport {
                results: vec![wrong_hash],
            },
            &endpoint(),
            100,
        )
        .is_err());
        assert!(repository.applied.lock().unwrap().is_empty());
    }

    #[test]
    fn reconciliation_is_scoped_to_the_active_device_endpoint() {
        let repository = Repository {
            submitted: vec![command("command-1")],
            applied: Mutex::new(Vec::new()),
        };

        assert!(reconcile_submitted_commands(
            &repository,
            &Transport {
                results: vec![result(
                    "command-1",
                    ConversationCommandResolutionState::NotFound,
                )],
            },
            &CryptoEndpoint::new("ptid:alice", "device-2").unwrap(),
            100,
        )
        .is_err());
    }

    #[test]
    fn empty_submitted_set_is_idle_without_transport() {
        let repository = Repository {
            submitted: Vec::new(),
            applied: Mutex::new(Vec::new()),
        };

        assert_eq!(
            reconcile_submitted_commands(
                &repository,
                &Transport {
                    results: Vec::new(),
                },
                &endpoint(),
                100,
            )
            .unwrap(),
            CommandReconciliationProgress::Idle
        );
    }

    #[test]
    fn stale_rejections_are_superseding() {
        assert!(is_superseding_rejection(
            ConversationCommandRejectCode::AuthorityHeadStale,
        ));
        assert!(!is_superseding_rejection(
            ConversationCommandRejectCode::PermissionDenied,
        ));
    }
}
