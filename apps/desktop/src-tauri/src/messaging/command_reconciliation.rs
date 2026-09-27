use super::{
    CommandReconciliation, CommandReconciliationDisposition, EngineEndpoint, MessagingStore,
    SubmittedCommand,
};
use crate::model::chat::{
    chat_command, ChatCommand, ConversationCommandProposalResult, ConversationCommandRejectCode,
    ConversationCommandResolutionState, ConversationCommandResultRef,
    ConversationMemberAuthorityCommand, CryptoEndpoint, ResolveConversationCommandResultsRequest,
    ResolvedConversationCommandResult,
};
use messaging_core::mls::group::MlsGroupManager;
use prost::Message;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;

pub trait CommandResultTransport: Send + Sync {
    fn resolve(
        &self,
        request: ResolveConversationCommandResultsRequest,
    ) -> Result<Vec<ResolvedConversationCommandResult>, String>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandReconciliationProgress {
    Idle,
    Reconciled {
        command_count: usize,
        retry_count: usize,
    },
}

pub struct CommandReconciliationWorker<T: CommandResultTransport> {
    store: Arc<MessagingStore>,
    mls_manager: Arc<MlsGroupManager>,
    endpoint: EngineEndpoint,
    transport: T,
}

impl<T: CommandResultTransport> CommandReconciliationWorker<T> {
    pub fn new(
        store: Arc<MessagingStore>,
        mls_manager: Arc<MlsGroupManager>,
        endpoint: EngineEndpoint,
        transport: T,
    ) -> Result<Self, String> {
        if endpoint.ptid.trim().is_empty() || endpoint.device_id.trim().is_empty() {
            return Err("messaging command reconciliation requires complete endpoint".to_string());
        }
        Ok(Self {
            store,
            mls_manager,
            endpoint,
            transport,
        })
    }

    pub fn reconcile_once(
        &self,
        retry_at_unix_ms: i64,
    ) -> Result<CommandReconciliationProgress, String> {
        if retry_at_unix_ms <= 0 {
            return Err("messaging command reconciliation time is invalid".to_string());
        }
        let submitted = self.store.submitted_commands()?;
        if submitted.is_empty() {
            return Ok(CommandReconciliationProgress::Idle);
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
        let results = self.transport.resolve(request)?;
        let reconciliations = validate_results(&submitted, results, &self.endpoint)?;
        let retry_count = reconciliations
            .iter()
            .filter(|result| {
                matches!(
                    result.disposition,
                    CommandReconciliationDisposition::NotFound
                )
            })
            .count();
        let terminal_membership_commands = reconciliations
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
        self.store
            .apply_command_reconciliations(&reconciliations, retry_at_unix_ms)?;
        for conversation_id in terminal_membership_commands {
            self.mls_manager
                .discard_pending_transition(&conversation_id);
        }
        Ok(CommandReconciliationProgress::Reconciled {
            command_count: reconciliations.len(),
            retry_count,
        })
    }
}

fn validate_results(
    submitted: &[SubmittedCommand],
    results: Vec<ResolvedConversationCommandResult>,
    endpoint: &EngineEndpoint,
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
    actor: Option<CryptoEndpoint>,
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
    use super::is_superseding_rejection;
    use crate::model::chat::ConversationCommandRejectCode;

    #[test]
    fn stale_authority_head_supersedes_the_exact_attempt() {
        assert!(is_superseding_rejection(
            ConversationCommandRejectCode::AuthorityHeadStale,
        ));
    }
}
