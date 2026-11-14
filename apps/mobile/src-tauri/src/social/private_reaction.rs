use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use prost::Message;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::error::{MobileError, MobileResult};
use crate::secure_content::private_comment::{
    source_comment_reaction_summaries, PrivateCommentProjection,
};
use crate::secure_content::proto::social::v1 as social;
use crate::secure_content::receiver::{
    canonical_reaction_summaries, merge_reaction_fields, source_reaction_summaries,
    PrivateMomentReadProjection, PrivatePollResultProjection, PrivateReactionSummaryProjection,
    PrivateReadContent, PrivateReadState,
};
use crate::secure_content::store::{
    PrivateSocialStore, ReactionCommandState, StoredReactionCommand,
};
use crate::secure_content::transport::{
    federated_private_interaction_signing_bytes, NativeSocialTransport, TransportDisposition,
    TransportError,
};
use crate::secure_content::NativeSocialSession;

use super::{MobilePrivateSocialRuntime, PrivateSocialEngine};

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[repr(i64)]
pub enum PrivateReactionOperation {
    React = 3,
    Unreact = 4,
    VotePoll = 5,
}

impl TryFrom<i64> for PrivateReactionOperation {
    type Error = String;
    fn try_from(value: i64) -> Result<Self, String> {
        match value {
            3 => Ok(Self::React),
            4 => Ok(Self::Unreact),
            5 => Ok(Self::VotePoll),
            _ => Err("private interaction operation is invalid".into()),
        }
    }
}

impl PrivateReactionOperation {
    fn wire(self) -> social::FederatedPrivateInteractionOperation {
        match self {
            Self::React => social::FederatedPrivateInteractionOperation::React,
            Self::Unreact => social::FederatedPrivateInteractionOperation::Unreact,
            Self::VotePoll => social::FederatedPrivateInteractionOperation::VotePoll,
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
    #[serde(default)]
    comment_id: String,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivateSocialPollInput {
    station_peer_id: String,
    actor_ptid: String,
    activation_generation: u64,
    post_id: String,
    selected_options: Vec<u32>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateReactionCommandProjection {
    pub command_id: String,
    pub post_id: String,
    pub comment_id: String,
    pub kind: i32,
    pub operation: PrivateReactionOperation,
    pub selected_opaque_option_ids: Vec<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poll: Option<PrivatePollResultProjection>,
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
    VotePoll(social::VotePrivatePollResponse),
}

impl ReactionResponse {
    fn comment_id(&self) -> &str {
        match self {
            Self::React(response) => &response.comment_id,
            Self::Unreact(response) => &response.comment_id,
            Self::VotePoll(_) => "",
        }
    }

    fn command_id(&self) -> &str {
        match self {
            Self::React(response) => &response.command_id,
            Self::Unreact(response) => &response.command_id,
            Self::VotePoll(response) => &response.command_id,
        }
    }

    fn success(&self) -> bool {
        match self {
            Self::React(response) => response.success,
            Self::Unreact(response) => response.success,
            Self::VotePoll(_) => true,
        }
    }

    fn reactions(&self) -> &[social::ReactionSummary] {
        match self {
            Self::React(response) => &response.reactions,
            Self::Unreact(response) => &response.reactions,
            Self::VotePoll(_) => &[],
        }
    }

    fn projection_revision(&self) -> u64 {
        match self {
            Self::React(response) => response.projection_revision,
            Self::Unreact(response) => response.projection_revision,
            Self::VotePoll(response) => response.projection_revision,
        }
    }

    fn exact_replay(&self) -> bool {
        match self {
            Self::React(response) => response.exact_replay,
            Self::Unreact(response) => response.exact_replay,
            Self::VotePoll(response) => response.exact_replay,
        }
    }

    fn encode(&self) -> Vec<u8> {
        match self {
            Self::React(response) => response.encode_to_vec(),
            Self::Unreact(response) => response.encode_to_vec(),
            Self::VotePoll(response) => response.encode_to_vec(),
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
        comment_id: &str,
        kind: i32,
        operation: PrivateReactionOperation,
    ) -> Result<PrivateReactionMutationResult, String> {
        validate_mutation(post_id, comment_id, kind)?;
        self.ensure_private_projection(post_id, comment_id)?;
        let command_id = format!("reaction-v1-{}", ulid::Ulid::new());
        let request_bytes =
            self.signed_request(post_id, comment_id, kind, &command_id, operation)?;
        let command = StoredReactionCommand {
            command_id: command_id.clone(),
            post_id: post_id.to_string(),
            comment_id: comment_id.to_string(),
            kind,
            operation,
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

    fn vote(
        &self,
        post_id: &str,
        indices: &[u32],
    ) -> Result<PrivateReactionMutationResult, String> {
        self.ensure_private_projection(post_id, "")?;
        let command_id = format!("reaction-v1-{}", ulid::Ulid::new());
        let mut request = super::private_poll::ballot_request(
            &self.load_projection(post_id)?,
            indices,
            &command_id,
            &self.session.signing_key_id,
        )?;
        request.actor_device_signature =
            self.session
                .sign(&federated_private_interaction_signing_bytes(
                    PrivateReactionOperation::VotePoll.wire(),
                    &request.encode_to_vec(),
                ));
        let request_bytes = request.encode_to_vec();
        self.store
            .persist_reaction_command(&StoredReactionCommand {
                command_id: command_id.clone(),
                post_id: post_id.into(),
                comment_id: String::new(),
                kind: 0,
                operation: PrivateReactionOperation::VotePoll,
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
            })?;
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
        self.ensure_private_projection(&command.post_id, &command.comment_id)?;
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
        self.ensure_private_projection(&command.post_id, &command.comment_id)?;
        if readback_first && command.operation != PrivateReactionOperation::VotePoll {
            let readback = if command.comment_id.is_empty() {
                self.transport
                    .get_private_moment(&command.post_id)
                    .map(|response| source_reaction_summaries(&response, &command.post_id))
            } else {
                self.transport
                    .get_private_comment(&command.post_id, &command.comment_id)
                    .map(|response| {
                        source_comment_reaction_summaries(
                            &response,
                            &command.post_id,
                            &command.comment_id,
                        )
                    })
            };
            match readback {
                Ok(readback) => {
                    let (summaries, revision, hydrated) = match readback {
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
        let response = match command.operation {
            PrivateReactionOperation::Unreact => self
                .transport
                .submit_private_unreaction(&command.post_id, &command.request_bytes)
                .map(ReactionResponse::Unreact),
            PrivateReactionOperation::React => self
                .transport
                .submit_private_reaction(&command.post_id, &command.request_bytes)
                .map(ReactionResponse::React),
            PrivateReactionOperation::VotePoll => self
                .transport
                .submit_private_poll_vote(&command.post_id, &command.request_bytes)
                .map(ReactionResponse::VotePoll),
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
        let operation = match &response {
            ReactionResponse::React(_) => PrivateReactionOperation::React,
            ReactionResponse::Unreact(_) => PrivateReactionOperation::Unreact,
            ReactionResponse::VotePoll(_) => PrivateReactionOperation::VotePoll,
        };
        if command.operation != operation
            || !response.success()
            || response.command_id() != command.command_id
            || response.comment_id() != command.comment_id
            || response.projection_revision() == 0
        {
            return Err("private Reaction response identity is invalid".to_string());
        }
        let summaries = canonical_reaction_summaries(response.reactions())?;
        let poll = match &response {
            ReactionResponse::VotePoll(response) => Some(super::private_poll::qualify_response(
                command,
                response,
                &self.load_projection(&command.post_id)?,
                &self.session.scope.actor_ptid,
            )?),
            _ => None,
        };
        let response_revision = response.projection_revision();
        let result_bytes = response.encode();
        let result_sha256: [u8; 32] = Sha256::digest(&result_bytes).into();
        let changed = self.store.mark_reaction_committed(
            command,
            &result_bytes,
            &result_sha256,
            response_revision,
            &summaries,
            poll.as_ref(),
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
        self.ensure_private_projection(&command.post_id, &command.comment_id)?;
        let poll = if command.operation == PrivateReactionOperation::VotePoll {
            let projection = self.load_projection(&command.post_id)?;
            let Some(PrivateReadContent::Poll { result, .. }) = projection.content else {
                return Err("SOCIAL_PRIVATE_NOT_A_POLL".into());
            };
            result
        } else {
            None
        };
        let (reactions, projection_revision) = if command.operation
            == PrivateReactionOperation::VotePoll
        {
            (
                Vec::new(),
                poll.as_ref()
                    .map(|p| p.projection_revision.clone())
                    .unwrap_or_else(|| "0".into()),
            )
        } else if command.comment_id.is_empty() {
            let projection = self.load_projection(&command.post_id)?;
            (projection.reactions, projection.reaction_revision)
        } else {
            let projection = self.load_comment_projection(&command.post_id, &command.comment_id)?;
            (projection.reactions, projection.reaction_revision)
        };
        let exact_replay = if let (Some(result_bytes), Some(result_sha256)) =
            (&command.result_bytes, command.result_sha256)
        {
            if Sha256::digest(result_bytes).as_slice() != result_sha256 {
                return Err("private Reaction durable result hash is invalid".to_string());
            }
            let response = match command.operation {
                PrivateReactionOperation::Unreact => ReactionResponse::Unreact(
                    social::UnreactToPostResponse::decode(result_bytes.as_slice())
                        .map_err(|_| "private Reaction durable result is malformed".to_string())?,
                ),
                PrivateReactionOperation::React => ReactionResponse::React(
                    social::ReactToPostResponse::decode(result_bytes.as_slice())
                        .map_err(|_| "private Reaction durable result is malformed".to_string())?,
                ),
                PrivateReactionOperation::VotePoll => {
                    let response = social::VotePrivatePollResponse::decode(result_bytes.as_slice())
                        .map_err(|_| "private poll durable result is malformed")?;
                    super::private_poll::qualify_response(
                        command,
                        &response,
                        &self.load_projection(&command.post_id)?,
                        &self.session.scope.actor_ptid,
                    )?;
                    ReactionResponse::VotePoll(response)
                }
            };
            if response.encode() != *result_bytes
                || response.command_id() != command.command_id
                || response.comment_id() != command.comment_id
                || response.projection_revision() != command.projection_revision
            {
                return Err("private Reaction durable result identity is invalid".to_string());
            }
            response.exact_replay()
        } else {
            false
        };
        Ok(PrivateReactionMutationResult {
            command: command_projection(command)?,
            reactions,
            projection_revision,
            exact_replay,
            poll,
        })
    }

    fn signed_request(
        &self,
        post_id: &str,
        comment_id: &str,
        kind: i32,
        command_id: &str,
        operation: PrivateReactionOperation,
    ) -> Result<Vec<u8>, String> {
        match operation {
            PrivateReactionOperation::React => {
                let mut request = social::ReactToPostRequest {
                    post_id: post_id.to_string(),
                    comment_id: comment_id.to_string(),
                    kind,
                    command_id: command_id.to_string(),
                    actor_signing_key_id: self.session.signing_key_id.clone(),
                    actor_device_signature: Vec::new(),
                };
                request.actor_device_signature =
                    self.session
                        .sign(&federated_private_interaction_signing_bytes(
                            operation.wire(),
                            &request.encode_to_vec(),
                        ));
                Ok(request.encode_to_vec())
            }
            PrivateReactionOperation::Unreact => {
                let mut request = social::UnreactToPostRequest {
                    post_id: post_id.to_string(),
                    comment_id: comment_id.to_string(),
                    kind,
                    command_id: command_id.to_string(),
                    actor_signing_key_id: self.session.signing_key_id.clone(),
                    actor_device_signature: Vec::new(),
                };
                request.actor_device_signature =
                    self.session
                        .sign(&federated_private_interaction_signing_bytes(
                            operation.wire(),
                            &request.encode_to_vec(),
                        ));
                Ok(request.encode_to_vec())
            }
            PrivateReactionOperation::VotePoll => {
                Err("private poll requires a complete ballot".into())
            }
        }
    }

    fn ensure_private_projection(&self, post_id: &str, comment_id: &str) -> Result<(), String> {
        let projection = self.load_projection(post_id)?;
        if projection.post_id != post_id || projection.state != PrivateReadState::ContentReady {
            return Err("private Reaction requires an authorized private Moment".to_string());
        }
        if !comment_id.is_empty() {
            validate_comment_target(
                post_id,
                comment_id,
                &self.load_comment_projection(post_id, comment_id)?,
            )?;
        }
        Ok(())
    }

    fn load_comment_projection(
        &self,
        post_id: &str,
        comment_id: &str,
    ) -> Result<PrivateCommentProjection, String> {
        let bytes = self
            .store
            .comment_projection(comment_id)?
            .ok_or_else(|| "private Reaction Comment projection is unavailable".to_string())?;
        let projection = PrivateCommentProjection::decode(&bytes)?;
        validate_comment_target(post_id, comment_id, &projection)?;
        Ok(projection)
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
) -> Result<PrivateReactionCommandProjection, String> {
    if Sha256::digest(&command.request_bytes).as_slice() != command.request_sha256 {
        return Err("private interaction durable request hash is invalid".into());
    }
    let selected_opaque_option_ids = if command.operation == PrivateReactionOperation::VotePoll {
        let request = social::VotePrivatePollRequest::decode(command.request_bytes.as_slice())
            .map_err(|_| "private poll durable request is malformed")?;
        if request.encode_to_vec() != command.request_bytes
            || request.command_id != command.command_id
            || request.post_id != command.post_id
        {
            return Err("private poll durable request identity is invalid".into());
        }
        request.opaque_option_ids.iter().map(hex::encode).collect()
    } else {
        Vec::new()
    };
    Ok(PrivateReactionCommandProjection {
        command_id: command.command_id.clone(),
        post_id: command.post_id.clone(),
        comment_id: command.comment_id.clone(),
        kind: command.kind,
        operation: command.operation,
        selected_opaque_option_ids,
        state: command.state.as_str().to_string(),
        attempt_count: command.attempt_count,
        projection_revision: command.projection_revision.to_string(),
        error_code: command.error_code.clone(),
        retry_after_seconds: command.retry_after_seconds,
        retry_not_before_unix_ms: command.retry_not_before_unix_ms,
    })
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
pub fn social_private_poll_vote(
    social: State<'_, MobilePrivateSocialRuntime>,
    input: PrivateSocialPollInput,
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
        .and_then(|orchestrator| orchestrator.vote(&input.post_id, &input.selected_options))
        .map_err(MobileError::social)
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
        .and_then(|orchestrator| {
            orchestrator.mutate(&input.post_id, &input.comment_id, input.kind, operation)
        })
        .map_err(MobileError::social)
}

fn validate_mutation(post_id: &str, comment_id: &str, kind: i32) -> Result<(), String> {
    let kind = social::ReactionKind::try_from(kind)
        .map_err(|_| "private Reaction kind is invalid".to_string())?;
    if post_id.trim().is_empty()
        || post_id != post_id.trim()
        || comment_id != comment_id.trim()
        || (!comment_id.is_empty() && kind != social::ReactionKind::ReactionLike)
        || kind == social::ReactionKind::ReactionUnspecified
    {
        return Err("private Reaction command is invalid".to_string());
    }
    Ok(())
}

fn validate_comment_target(
    post_id: &str,
    comment_id: &str,
    projection: &PrivateCommentProjection,
) -> Result<(), String> {
    if projection.post_id != post_id
        || projection.comment_id != comment_id
        || projection.state != "COMMENT_POSTED"
        || projection.text.is_none()
    {
        return Err("private Reaction requires an authorized private Comment".to_string());
    }
    Ok(())
}

/// Merge only reaction fields while the original journal holds the current target.
pub(crate) fn project_reaction_target(
    post_id: &str,
    comment_id: &str,
    current_bytes: &[u8],
    reactions: &[PrivateReactionSummaryProjection],
    revision: u64,
) -> Result<Vec<u8>, String> {
    if comment_id.is_empty() {
        let mut projection = PrivateMomentReadProjection::decode(current_bytes)?;
        if projection.post_id != post_id || projection.state != PrivateReadState::ContentReady {
            return Err("private Reaction parent projection is unavailable".to_string());
        }
        merge_reaction_fields(
            &mut projection.reaction_revision,
            &mut projection.reactions,
            &mut projection.reactions_hydrated,
            reactions,
            revision,
            true,
        )?;
        projection.encode()
    } else {
        let mut projection = PrivateCommentProjection::decode(current_bytes)?;
        validate_comment_target(post_id, comment_id, &projection)?;
        merge_reaction_fields(
            &mut projection.reaction_revision,
            &mut projection.reactions,
            &mut projection.reactions_hydrated,
            reactions,
            revision,
            true,
        )?;
        projection.update_reactions_count()?;
        projection.encode()
    }
}

fn reaction_state_matches(
    command: &StoredReactionCommand,
    reactions: &[PrivateReactionSummaryProjection],
) -> bool {
    let reacted = reactions
        .iter()
        .find(|reaction| reaction.kind == command.kind)
        .is_some_and(|reaction| reaction.reacted_by_viewer);
    reacted == (command.operation == PrivateReactionOperation::React)
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
    if command.operation == PrivateReactionOperation::Unreact {
        ReactionResponse::Unreact(social::UnreactToPostResponse {
            success: true,
            reactions: summaries,
            command_id: command.command_id.clone(),
            comment_id: command.comment_id.clone(),
            exact_replay: false,
            projection_revision,
        })
    } else {
        ReactionResponse::React(social::ReactToPostResponse {
            success: true,
            reactions: summaries,
            command_id: command.command_id.clone(),
            comment_id: command.comment_id.clone(),
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
            comment_id: String::new(),
            kind: social::ReactionKind::ReactionLike as i32,
            command_id: "reaction-v1-command".to_string(),
            actor_signing_key_id: "device-key-1".to_string(),
            actor_device_signature: Vec::new(),
        };
        let bytes = federated_private_interaction_signing_bytes(
            social::FederatedPrivateInteractionOperation::React,
            &request.encode_to_vec(),
        );
        let signature = key.sign(&bytes);

        assert!(key.verifying_key().verify(&bytes, &signature).is_ok());
        assert!(key
            .verifying_key()
            .verify(
                &federated_private_interaction_signing_bytes(
                    social::FederatedPrivateInteractionOperation::Unreact,
                    &request.encode_to_vec(),
                ),
                &signature,
            )
            .is_err());
        let altered = social::ReactToPostRequest {
            comment_id: "other-comment".into(),
            ..request
        };
        assert!(key
            .verifying_key()
            .verify(
                &federated_private_interaction_signing_bytes(
                    social::FederatedPrivateInteractionOperation::React,
                    &altered.encode_to_vec()
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
            comment_id: String::new(),
            kind: social::ReactionKind::ReactionLove as i32,
            operation: PrivateReactionOperation::React,
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
                operation: PrivateReactionOperation::Unreact,
                ..command
            },
            &reactions,
        ));
    }
}
