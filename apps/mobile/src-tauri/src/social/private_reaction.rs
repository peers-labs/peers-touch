use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use prost::Message;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::error::{MobileError, MobileResult};
use crate::secure_content::proto::social::v1 as social;
use crate::secure_content::receiver::{
    canonical_reaction_summaries, source_reaction_summaries, PrivateMomentReadProjection,
    PrivateReactionSummaryProjection, PrivateReadState,
};
use crate::secure_content::store::{
    PrivateSocialStore, ReactionCommandState, StoredReactionCommand,
};
use crate::secure_content::transport::{
    NativeSocialTransport, TransportDisposition, TransportError,
};
use crate::secure_content::NativeSocialSession;

use super::{MobilePrivateSocialRuntime, PrivateSocialEngine};

const FEDERATED_PRIVATE_INTERACTION_SIGNING_DOMAIN: &[u8] =
    b"peers-touch:social:federated-private-interaction:v1\0";

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrivateReactionOperation {
    React,
    Unreact,
}

impl PrivateReactionOperation {
    fn wire(self) -> social::FederatedPrivateInteractionOperation {
        match self {
            Self::React => social::FederatedPrivateInteractionOperation::React,
            Self::Unreact => social::FederatedPrivateInteractionOperation::Unreact,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivateSocialReactionInput {
    station_peer_id: String,
    actor_ptid: String,
    activation_generation: u64,
    post_id: String,
    kind: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivateSocialReactionRetryInput {
    station_peer_id: String,
    actor_ptid: String,
    activation_generation: u64,
    command_id: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateReactionCommandProjection {
    pub command_id: String,
    pub post_id: String,
    pub kind: i32,
    pub operation: PrivateReactionOperation,
    pub state: String,
    pub attempt_count: u32,
    pub projection_revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_not_before_unix_ms: Option<i64>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateReactionMutationResult {
    pub command: PrivateReactionCommandProjection,
    pub reactions: Vec<PrivateReactionSummaryProjection>,
    pub projection_revision: String,
    pub exact_replay: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PrivateReactionReconcileReport {
    pub processed: u32,
    pub unknown: u32,
    pub terminal: u32,
}

enum ReactionResponse {
    React(social::ReactToPostResponse),
    Unreact(social::UnreactToPostResponse),
}

impl ReactionResponse {
    fn command_id(&self) -> &str {
        match self {
            Self::React(response) => &response.command_id,
            Self::Unreact(response) => &response.command_id,
        }
    }

    fn success(&self) -> bool {
        match self {
            Self::React(response) => response.success,
            Self::Unreact(response) => response.success,
        }
    }

    fn reactions(&self) -> &[social::ReactionSummary] {
        match self {
            Self::React(response) => &response.reactions,
            Self::Unreact(response) => &response.reactions,
        }
    }

    fn projection_revision(&self) -> u64 {
        match self {
            Self::React(response) => response.projection_revision,
            Self::Unreact(response) => response.projection_revision,
        }
    }

    fn exact_replay(&self) -> bool {
        match self {
            Self::React(response) => response.exact_replay,
            Self::Unreact(response) => response.exact_replay,
        }
    }

    fn encode(&self) -> Vec<u8> {
        match self {
            Self::React(response) => response.encode_to_vec(),
            Self::Unreact(response) => response.encode_to_vec(),
        }
    }
}

struct PrivateReactionOrchestrator {
    session: Arc<NativeSocialSession>,
    store: Arc<PrivateSocialStore>,
    transport: NativeSocialTransport,
    activation_generation: u64,
}

impl PrivateReactionOrchestrator {
    fn new(engine: &PrivateSocialEngine) -> Result<Self, String> {
        Ok(Self {
            session: engine.session.clone(),
            store: engine.store.clone(),
            transport: NativeSocialTransport::new(engine.session.clone())?,
            activation_generation: engine.activation_generation,
        })
    }

    fn mutate(
        &self,
        post_id: &str,
        kind: i32,
        operation: PrivateReactionOperation,
    ) -> Result<PrivateReactionMutationResult, String> {
        validate_mutation(post_id, kind)?;
        self.ensure_private_projection(post_id)?;
        let command_id = format!("reaction-v1-{}", ulid::Ulid::new());
        let request_bytes = self.signed_request(post_id, kind, &command_id, operation)?;
        let command = StoredReactionCommand {
            command_id: command_id.clone(),
            post_id: post_id.to_string(),
            kind,
            remove: operation == PrivateReactionOperation::Unreact,
            request_sha256: Sha256::digest(&request_bytes).into(),
            request_bytes,
            result_sha256: None,
            result_bytes: None,
            state: ReactionCommandState::Pending,
            session_generation: self.activation_generation,
            lease_generation: 0,
            attempt_count: 0,
            projection_revision: 0,
            error_code: None,
            retry_after_seconds: None,
            retry_not_before_unix_ms: None,
        };
        self.store.persist_reaction_command(&command)?;
        self.dispatch(&command_id, false)
    }

    fn retry(&self, command_id: &str) -> Result<PrivateReactionMutationResult, String> {
        if command_id.trim().is_empty() || command_id != command_id.trim() {
            return Err("private Reaction retry command ID is invalid".to_string());
        }
        let command = self
            .store
            .reaction_command(command_id)?
            .ok_or_else(|| "private Reaction command is unavailable".to_string())?;
        match command.state {
            ReactionCommandState::Committed | ReactionCommandState::Rejected => {
                self.result_from_command(&command)
            }
            ReactionCommandState::Pending => self.dispatch(command_id, false),
            ReactionCommandState::UnknownOutcome | ReactionCommandState::Retrying => {
                self.dispatch(command_id, true)
            }
            ReactionCommandState::InFlight => self.result_from_command(&command),
        }
    }

    fn reconcile(&self) -> Result<PrivateReactionReconcileReport, String> {
        let mut report = PrivateReactionReconcileReport::default();
        for command in self.store.reaction_commands()? {
            if command.state == ReactionCommandState::Retrying
                && command
                    .retry_not_before_unix_ms
                    .is_some_and(|deadline| deadline > now_unix_ms())
            {
                continue;
            }
            let result = match command.state {
                ReactionCommandState::Pending => self.dispatch(&command.command_id, false),
                ReactionCommandState::UnknownOutcome | ReactionCommandState::Retrying => {
                    self.dispatch(&command.command_id, true)
                }
                ReactionCommandState::InFlight => continue,
                ReactionCommandState::Committed | ReactionCommandState::Rejected => {
                    self.result_from_command(&command)
                }
            }?;
            report.processed = report.processed.saturating_add(1);
            match result.command.state.as_str() {
                "REACTION_UNKNOWN_OUTCOME" => report.unknown = report.unknown.saturating_add(1),
                "REACTION_REJECTED" => report.terminal = report.terminal.saturating_add(1),
                _ => {}
            }
        }
        Ok(report)
    }

    fn dispatch(
        &self,
        command_id: &str,
        readback_first: bool,
    ) -> Result<PrivateReactionMutationResult, String> {
        let command = self
            .store
            .acquire_reaction_command(command_id, self.activation_generation)?;
        if readback_first {
            match self.transport.get_private_moment(&command.post_id) {
                Ok(response) => {
                    let (summaries, revision, hydrated) =
                        match source_reaction_summaries(&response, &command.post_id) {
                            Ok(readback) => readback,
                            Err(error) => return self.persist_response_failure(&command, error),
                        };
                    if hydrated && reaction_state_matches(&command, &summaries) {
                        let revision = revision.parse::<u64>().map_err(|_| {
                            "private Reaction readback revision is invalid".to_string()
                        })?;
                        return self.commit_response(
                            &command,
                            response_from_readback(&command, &summaries, revision),
                        );
                    }
                }
                Err(error) if error.disposition == TransportDisposition::Terminal => {
                    return self.persist_transport_failure(&command, error)
                }
                Err(_) => {}
            }
        }
        let response = if command.remove {
            self.transport
                .submit_private_unreaction(&command.post_id, &command.request_bytes)
                .map(ReactionResponse::Unreact)
        } else {
            self.transport
                .submit_private_reaction(&command.post_id, &command.request_bytes)
                .map(ReactionResponse::React)
        };
        match response {
            Ok(response) => self
                .commit_response(&command, response)
                .or_else(|error| self.persist_response_failure(&command, error)),
            Err(error) => self.persist_transport_failure(&command, error),
        }
    }

    fn commit_response(
        &self,
        command: &StoredReactionCommand,
        response: ReactionResponse,
    ) -> Result<PrivateReactionMutationResult, String> {
        if !response.success()
            || response.command_id() != command.command_id
            || response.projection_revision() == 0
        {
            return Err("private Reaction response identity is invalid".to_string());
        }
        let summaries = canonical_reaction_summaries(response.reactions())?;
        let mut projection = self.load_projection(&command.post_id)?;
        let current_revision = projection
            .reaction_revision
            .parse::<u64>()
            .map_err(|_| "private Reaction projection revision is invalid".to_string())?;
        let response_revision = response.projection_revision();
        if response_revision > current_revision {
            projection.reactions = summaries.clone();
            projection.reaction_revision = response_revision.to_string();
            projection.reactions_hydrated = true;
        } else if response_revision == current_revision
            && projection.reactions_hydrated
            && projection.reactions != summaries
        {
            return Err("private Reaction response conflicts at the same revision".to_string());
        }
        let result_bytes = response.encode();
        let result_sha256: [u8; 32] = Sha256::digest(&result_bytes).into();
        let changed = self.store.mark_reaction_committed(
            &command.command_id,
            command.lease_generation,
            command.session_generation,
            &result_bytes,
            &result_sha256,
            response_revision,
            &command.post_id,
            &projection.encode()?,
        )?;
        if !changed {
            return Err("private Reaction completion lost its session fence".to_string());
        }
        self.result_from_command(
            &self
                .store
                .reaction_command(&command.command_id)?
                .ok_or_else(|| "private Reaction completion is unavailable".to_string())?,
        )
    }

    fn persist_transport_failure(
        &self,
        command: &StoredReactionCommand,
        error: TransportError,
    ) -> Result<PrivateReactionMutationResult, String> {
        let state = match error.disposition {
            TransportDisposition::UnknownOutcome => ReactionCommandState::UnknownOutcome,
            TransportDisposition::Retryable | TransportDisposition::PoolNotFound => {
                ReactionCommandState::Retrying
            }
            TransportDisposition::Terminal => ReactionCommandState::Rejected,
        };
        let changed = self.store.mark_reaction_failure(
            &command.command_id,
            command.lease_generation,
            command.session_generation,
            state,
            &stable_error_code(&error),
            error.retry_after_seconds,
        )?;
        if !changed {
            return Err("private Reaction failure lost its session fence".to_string());
        }
        self.result_from_command(
            &self
                .store
                .reaction_command(&command.command_id)?
                .ok_or_else(|| "private Reaction retry state is unavailable".to_string())?,
        )
    }

    fn persist_response_failure(
        &self,
        command: &StoredReactionCommand,
        error: String,
    ) -> Result<PrivateReactionMutationResult, String> {
        let changed = self.store.mark_reaction_failure(
            &command.command_id,
            command.lease_generation,
            command.session_generation,
            ReactionCommandState::UnknownOutcome,
            "REACTION_RESULT_INVALID",
            None,
        )?;
        if !changed {
            return Err(error);
        }
        self.result_from_command(
            &self
                .store
                .reaction_command(&command.command_id)?
                .ok_or_else(|| "private Reaction retry state is unavailable".to_string())?,
        )
    }

    fn result_from_command(
        &self,
        command: &StoredReactionCommand,
    ) -> Result<PrivateReactionMutationResult, String> {
        let projection = self.load_projection(&command.post_id)?;
        let exact_replay = if let (Some(result_bytes), Some(result_sha256)) =
            (&command.result_bytes, command.result_sha256)
        {
            if Sha256::digest(result_bytes).as_slice() != result_sha256 {
                return Err("private Reaction durable result hash is invalid".to_string());
            }
            let response = if command.remove {
                ReactionResponse::Unreact(
                    social::UnreactToPostResponse::decode(result_bytes.as_slice())
                        .map_err(|_| "private Reaction durable result is malformed".to_string())?,
                )
            } else {
                ReactionResponse::React(
                    social::ReactToPostResponse::decode(result_bytes.as_slice())
                        .map_err(|_| "private Reaction durable result is malformed".to_string())?,
                )
            };
            if response.encode() != *result_bytes
                || response.command_id() != command.command_id
                || response.projection_revision() != command.projection_revision
            {
                return Err("private Reaction durable result identity is invalid".to_string());
            }
            response.exact_replay()
        } else {
            false
        };
        Ok(PrivateReactionMutationResult {
            command: command_projection(command),
            reactions: projection.reactions,
            projection_revision: projection.reaction_revision,
            exact_replay,
        })
    }

    fn signed_request(
        &self,
        post_id: &str,
        kind: i32,
        command_id: &str,
        operation: PrivateReactionOperation,
    ) -> Result<Vec<u8>, String> {
        match operation {
            PrivateReactionOperation::React => {
                let mut request = social::ReactToPostRequest {
                    post_id: post_id.to_string(),
                    kind,
                    command_id: command_id.to_string(),
                    actor_signing_key_id: self.session.signing_key_id.clone(),
                    actor_device_signature: Vec::new(),
                };
                request.actor_device_signature = self.session.sign(&reaction_signing_bytes(
                    operation.wire(),
                    &request.encode_to_vec(),
                ));
                Ok(request.encode_to_vec())
            }
            PrivateReactionOperation::Unreact => {
                let mut request = social::UnreactToPostRequest {
                    post_id: post_id.to_string(),
                    kind,
                    command_id: command_id.to_string(),
                    actor_signing_key_id: self.session.signing_key_id.clone(),
                    actor_device_signature: Vec::new(),
                };
                request.actor_device_signature = self.session.sign(&reaction_signing_bytes(
                    operation.wire(),
                    &request.encode_to_vec(),
                ));
                Ok(request.encode_to_vec())
            }
        }
    }

    fn ensure_private_projection(&self, post_id: &str) -> Result<(), String> {
        let projection = self.load_projection(post_id)?;
        if projection.post_id != post_id || projection.state != PrivateReadState::ContentReady {
            return Err("private Reaction requires an authorized private Moment".to_string());
        }
        Ok(())
    }

    fn load_projection(&self, post_id: &str) -> Result<PrivateMomentReadProjection, String> {
        let bytes = self
            .store
            .read_projection(post_id)?
            .ok_or_else(|| "private Reaction projection is unavailable".to_string())?;
        PrivateMomentReadProjection::decode(&bytes)
    }
}

pub(super) fn command_projection(
    command: &StoredReactionCommand,
) -> PrivateReactionCommandProjection {
    PrivateReactionCommandProjection {
        command_id: command.command_id.clone(),
        post_id: command.post_id.clone(),
        kind: command.kind,
        operation: if command.remove {
            PrivateReactionOperation::Unreact
        } else {
            PrivateReactionOperation::React
        },
        state: command.state.as_str().to_string(),
        attempt_count: command.attempt_count,
        projection_revision: command.projection_revision.to_string(),
        error_code: command.error_code.clone(),
        retry_after_seconds: command.retry_after_seconds,
        retry_not_before_unix_ms: command.retry_not_before_unix_ms,
    }
}

pub(super) fn reconcile_private_reactions(
    engine: &PrivateSocialEngine,
) -> Result<PrivateReactionReconcileReport, String> {
    PrivateReactionOrchestrator::new(engine)?.reconcile()
}

#[tauri::command]
pub fn social_private_react(
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialReactionInput,
) -> MobileResult<PrivateReactionMutationResult> {
    mutate(&social, input, PrivateReactionOperation::React)
}

#[tauri::command]
pub fn social_private_unreact(
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialReactionInput,
) -> MobileResult<PrivateReactionMutationResult> {
    mutate(&social, input, PrivateReactionOperation::Unreact)
}

#[tauri::command]
pub fn social_private_reaction_retry(
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialReactionRetryInput,
) -> MobileResult<PrivateReactionMutationResult> {
    let engine = social.active_engine_at_generation(
        &input.station_peer_id,
        &input.actor_ptid,
        input.activation_generation,
    )?;
    let _operation = engine
        .operation_lock
        .lock()
        .map_err(|_| MobileError::social("private Social operation lock poisoned"))?;
    engine.ensure_current().map_err(MobileError::social)?;
    PrivateReactionOrchestrator::new(&engine)
        .and_then(|orchestrator| orchestrator.retry(&input.command_id))
        .map_err(MobileError::social)
}

fn mutate(
    social: &MobilePrivateSocialRuntime,
    input: PrivateSocialReactionInput,
    operation: PrivateReactionOperation,
) -> MobileResult<PrivateReactionMutationResult> {
    let engine = social.active_engine_at_generation(
        &input.station_peer_id,
        &input.actor_ptid,
        input.activation_generation,
    )?;
    let _operation = engine
        .operation_lock
        .lock()
        .map_err(|_| MobileError::social("private Social operation lock poisoned"))?;
    engine.ensure_current().map_err(MobileError::social)?;
    PrivateReactionOrchestrator::new(&engine)
        .and_then(|orchestrator| orchestrator.mutate(&input.post_id, input.kind, operation))
        .map_err(MobileError::social)
}

fn validate_mutation(post_id: &str, kind: i32) -> Result<(), String> {
    let kind = social::ReactionKind::try_from(kind)
        .map_err(|_| "private Reaction kind is invalid".to_string())?;
    if post_id.trim().is_empty()
        || post_id != post_id.trim()
        || kind == social::ReactionKind::ReactionUnspecified
    {
        return Err("private Reaction command is invalid".to_string());
    }
    Ok(())
}

fn reaction_signing_bytes(
    operation: social::FederatedPrivateInteractionOperation,
    canonical_operation: &[u8],
) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(
        FEDERATED_PRIVATE_INTERACTION_SIGNING_DOMAIN.len()
            + std::mem::size_of::<u32>()
            + canonical_operation.len(),
    );
    bytes.extend_from_slice(FEDERATED_PRIVATE_INTERACTION_SIGNING_DOMAIN);
    bytes.extend_from_slice(&(operation as u32).to_be_bytes());
    bytes.extend_from_slice(canonical_operation);
    bytes
}

fn reaction_state_matches(
    command: &StoredReactionCommand,
    reactions: &[PrivateReactionSummaryProjection],
) -> bool {
    let reacted = reactions
        .iter()
        .find(|reaction| reaction.kind == command.kind)
        .is_some_and(|reaction| reaction.reacted_by_viewer);
    reacted != command.remove
}

fn response_from_readback(
    command: &StoredReactionCommand,
    reactions: &[PrivateReactionSummaryProjection],
    projection_revision: u64,
) -> ReactionResponse {
    let summaries = reactions
        .iter()
        .map(|reaction| social::ReactionSummary {
            kind: reaction.kind,
            count: reaction.count.parse::<i64>().unwrap_or_default(),
            reacted_by_viewer: reaction.reacted_by_viewer,
        })
        .collect();
    if command.remove {
        ReactionResponse::Unreact(social::UnreactToPostResponse {
            success: true,
            reactions: summaries,
            command_id: command.command_id.clone(),
            exact_replay: false,
            projection_revision,
        })
    } else {
        ReactionResponse::React(social::ReactToPostResponse {
            success: true,
            reactions: summaries,
            command_id: command.command_id.clone(),
            exact_replay: false,
            projection_revision,
        })
    }
}

fn stable_error_code(error: &TransportError) -> String {
    if let Some(code) = error.private_content_code.as_deref() {
        if !code.trim().is_empty() && code.len() <= 128 {
            return code.to_string();
        }
    }
    if error.stable_code > 0 {
        return format!("SOCIAL_{}", error.stable_code);
    }
    match error.disposition {
        TransportDisposition::UnknownOutcome => "REACTION_RESULT_UNKNOWN",
        TransportDisposition::Retryable | TransportDisposition::PoolNotFound => {
            "REACTION_RETRYABLE"
        }
        TransportDisposition::Terminal => "REACTION_REJECTED",
    }
    .to_string()
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey, Verifier};

    #[test]
    fn private_reaction_signature_binds_operation_and_exact_request() {
        let key = SigningKey::from_bytes(&[7; 32]);
        let request = social::ReactToPostRequest {
            post_id: "post-1".to_string(),
            kind: social::ReactionKind::ReactionLike as i32,
            command_id: "reaction-v1-command".to_string(),
            actor_signing_key_id: "device-key-1".to_string(),
            actor_device_signature: Vec::new(),
        };
        let bytes = reaction_signing_bytes(
            social::FederatedPrivateInteractionOperation::React,
            &request.encode_to_vec(),
        );
        let signature = key.sign(&bytes);

        assert!(key.verifying_key().verify(&bytes, &signature).is_ok());
        assert!(key
            .verifying_key()
            .verify(
                &reaction_signing_bytes(
                    social::FederatedPrivateInteractionOperation::Unreact,
                    &request.encode_to_vec(),
                ),
                &signature,
            )
            .is_err());
    }

    #[test]
    fn readback_match_distinguishes_react_and_unreact() {
        let command = StoredReactionCommand {
            command_id: "reaction-1".to_string(),
            post_id: "post-1".to_string(),
            kind: social::ReactionKind::ReactionLove as i32,
            remove: false,
            request_sha256: [0; 32],
            request_bytes: Vec::new(),
            result_sha256: None,
            result_bytes: None,
            state: ReactionCommandState::UnknownOutcome,
            session_generation: 1,
            lease_generation: 0,
            attempt_count: 1,
            projection_revision: 0,
            error_code: None,
            retry_after_seconds: None,
            retry_not_before_unix_ms: None,
        };
        let reactions = vec![PrivateReactionSummaryProjection {
            kind: command.kind,
            count: "1".to_string(),
            reacted_by_viewer: true,
        }];

        assert!(reaction_state_matches(&command, &reactions));
        assert!(!reaction_state_matches(
            &StoredReactionCommand {
                remove: true,
                ..command
            },
            &reactions,
        ));
    }
}
