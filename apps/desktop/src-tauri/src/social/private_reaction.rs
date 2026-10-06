use prost::Message;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::model::social;
use crate::secure_content::adapter::{
    NativeErrorDisposition, NativeTransportError, SecureContentTransport,
};
use crate::secure_content::store::{
    ReactionCommandState, SecureContentStore, StoredReactionCommand,
};
use crate::secure_content::{SecureContentLease, SecureContentSupervisor};

use super::projection::{
    canonical_reaction_summaries, PrivateMomentProjection, PrivateReactionCommandProjection,
    PrivateReactionOperation, PrivateReactionSummaryProjection,
};

const FEDERATED_PRIVATE_INTERACTION_SIGNING_DOMAIN: &[u8] =
    b"peers-touch:social:federated-private-interaction:v1\0";

impl PrivateReactionOperation {
    fn wire(self) -> social::FederatedPrivateInteractionOperation {
        match self {
            Self::React => social::FederatedPrivateInteractionOperation::React,
            Self::Unreact => social::FederatedPrivateInteractionOperation::Unreact,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct PrivateReactionMutationInput {
    pub actor_ptid: String,
    pub renderer_generation: u64,
    pub post_id: String,
    pub kind: i32,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PrivateReactionRetryInput {
    pub actor_ptid: String,
    pub renderer_generation: u64,
    pub command_id: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct PrivateReactionMutationResult {
    pub command: PrivateReactionCommandProjection,
    pub reactions: Vec<PrivateReactionSummaryProjection>,
    pub projection_revision: String,
    pub exact_replay: bool,
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

pub struct PrivateReactionOrchestrator<'a> {
    supervisor: &'a SecureContentSupervisor,
    lease: SecureContentLease,
    transport: SecureContentTransport,
}

impl<'a> PrivateReactionOrchestrator<'a> {
    pub fn new(
        supervisor: &'a SecureContentSupervisor,
        lease: SecureContentLease,
    ) -> Result<Self, String> {
        let transport = SecureContentTransport::new(lease.session.clone())?;
        Ok(Self {
            supervisor,
            lease,
            transport,
        })
    }

    pub fn mutate(
        &self,
        input: &PrivateReactionMutationInput,
        operation: PrivateReactionOperation,
    ) -> Result<PrivateReactionMutationResult, String> {
        validate_mutation(input, operation)?;
        self.ensure_private_projection(&input.post_id)?;
        let command_id = format!("reaction-v1-{}", ulid::Ulid::new());
        let request_bytes =
            self.signed_request(&input.post_id, input.kind, &command_id, operation)?;
        let request_sha256: [u8; 32] = Sha256::digest(&request_bytes).into();
        self.with_current_store(|store| {
            store.persist_reaction_command(&StoredReactionCommand {
                command_id: command_id.clone(),
                post_id: input.post_id.clone(),
                kind: input.kind,
                remove: operation == PrivateReactionOperation::Unreact,
                request_sha256,
                request_bytes,
                result_sha256: None,
                result_bytes: None,
                state: ReactionCommandState::Pending,
                session_generation: self.lease.session.key.session_generation,
                lease_generation: 0,
                attempt_count: 0,
                projection_revision: 0,
                error_code: None,
                retry_after_seconds: None,
                retry_not_before_unix_ms: None,
            })
        })?;
        self.dispatch(&command_id)
    }

    pub fn retry(
        &self,
        input: &PrivateReactionRetryInput,
    ) -> Result<PrivateReactionMutationResult, String> {
        if input.command_id.trim().is_empty() {
            return Err("private Reaction retry command ID is required".to_string());
        }
        let command = self
            .with_current_store(|store| store.reaction_command(&input.command_id))?
            .ok_or_else(|| "private Reaction command is unavailable".to_string())?;
        if command.state == ReactionCommandState::Committed {
            return self.result_from_command(&command);
        }
        if command.state == ReactionCommandState::Rejected {
            return Err("private Reaction command was terminally rejected".to_string());
        }
        self.ensure_private_projection(&command.post_id)?;
        self.dispatch(&command.command_id)
    }

    fn dispatch(&self, command_id: &str) -> Result<PrivateReactionMutationResult, String> {
        let command = self.with_current_store(|store| {
            store.acquire_reaction_command(command_id, self.lease.session.key.session_generation)
        })?;
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
            Ok(response) => match self.commit_response(&command, response) {
                Ok(result) => Ok(result),
                Err(error) => self.persist_response_failure(&command, error),
            },
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
        let projection_bytes = projection.encode_local()?;
        let changed = self.with_current_store(|store| {
            store.mark_reaction_committed(
                &command.command_id,
                command.lease_generation,
                command.session_generation,
                &result_bytes,
                &result_sha256,
                response_revision,
                &command.post_id,
                &projection_bytes,
            )
        })?;
        if !changed {
            return Err("private Reaction completion lost its session fence".to_string());
        }
        self.result_from_command(
            &self
                .with_current_store(|store| store.reaction_command(&command.command_id))?
                .ok_or_else(|| "private Reaction completion is unavailable".to_string())?,
        )
    }

    fn persist_transport_failure(
        &self,
        command: &StoredReactionCommand,
        error: NativeTransportError,
    ) -> Result<PrivateReactionMutationResult, String> {
        let state = match error.disposition {
            NativeErrorDisposition::UnknownCommit => ReactionCommandState::UnknownCommit,
            NativeErrorDisposition::Retryable | NativeErrorDisposition::PoolNotFound => {
                ReactionCommandState::Retrying
            }
            NativeErrorDisposition::Terminal => ReactionCommandState::Rejected,
        };
        let code = stable_error_code(&error);
        let changed = self.with_current_store(|store| {
            store.mark_reaction_failure(
                &command.command_id,
                command.lease_generation,
                command.session_generation,
                state,
                &code,
                error.retry_after_seconds,
            )
        })?;
        if !changed {
            return Err("private Reaction failure lost its session fence".to_string());
        }
        self.result_from_command(
            &self
                .with_current_store(|store| store.reaction_command(&command.command_id))?
                .ok_or_else(|| "private Reaction retry state is unavailable".to_string())?,
        )
    }

    fn persist_response_failure(
        &self,
        command: &StoredReactionCommand,
        error: String,
    ) -> Result<PrivateReactionMutationResult, String> {
        let changed = self.with_current_store(|store| {
            store.mark_reaction_failure(
                &command.command_id,
                command.lease_generation,
                command.session_generation,
                ReactionCommandState::UnknownCommit,
                "REACTION_RESULT_INVALID",
                None,
            )
        })?;
        if !changed {
            return Err(error);
        }
        let persisted = self
            .with_current_store(|store| store.reaction_command(&command.command_id))?
            .ok_or_else(|| "private Reaction retry state is unavailable".to_string())?;
        self.result_from_command(&persisted).or(Err(error))
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
            command: command_projection(command)?,
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
                    actor_signing_key_id: self.lease.session.signing_key_id.clone(),
                    actor_device_signature: Vec::new(),
                };
                request.actor_device_signature = self.lease.session.sign(
                    &reaction_signing_bytes(operation.wire(), &request.encode_to_vec()),
                )?;
                Ok(request.encode_to_vec())
            }
            PrivateReactionOperation::Unreact => {
                let mut request = social::UnreactToPostRequest {
                    post_id: post_id.to_string(),
                    kind,
                    command_id: command_id.to_string(),
                    actor_signing_key_id: self.lease.session.signing_key_id.clone(),
                    actor_device_signature: Vec::new(),
                };
                request.actor_device_signature = self.lease.session.sign(
                    &reaction_signing_bytes(operation.wire(), &request.encode_to_vec()),
                )?;
                Ok(request.encode_to_vec())
            }
        }
    }

    fn ensure_private_projection(&self, post_id: &str) -> Result<(), String> {
        let projection = self.load_projection(post_id)?;
        if projection.post_id != post_id
            || projection.state != super::projection::PrivateReadState::ContentReady
        {
            return Err("private Reaction requires an authorized private Moment".to_string());
        }
        Ok(())
    }

    fn load_projection(&self, post_id: &str) -> Result<PrivateMomentProjection, String> {
        let bytes = self
            .with_current_store(|store| store.projection(post_id))?
            .ok_or_else(|| "private Reaction projection is unavailable".to_string())?;
        PrivateMomentProjection::decode_local(&bytes)
    }

    fn with_current_store<T>(
        &self,
        operation: impl FnOnce(&SecureContentStore) -> Result<T, String>,
    ) -> Result<T, String> {
        self.supervisor
            .with_current(&self.lease.session.key, |lease| {
                Ok(operation(lease.store.as_ref()))
            })?
    }
}

pub(super) fn command_projection(
    command: &StoredReactionCommand,
) -> Result<PrivateReactionCommandProjection, String> {
    Ok(PrivateReactionCommandProjection {
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
    })
}

fn validate_mutation(
    input: &PrivateReactionMutationInput,
    _operation: PrivateReactionOperation,
) -> Result<(), String> {
    let kind = social::ReactionKind::try_from(input.kind)
        .map_err(|_| "private Reaction kind is invalid".to_string())?;
    if input.actor_ptid.trim().is_empty()
        || input.renderer_generation == 0
        || input.post_id.trim().is_empty()
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

fn stable_error_code(error: &NativeTransportError) -> String {
    let message = error.message.trim();
    if !message.is_empty()
        && message.len() <= 128
        && message
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return message.to_string();
    }
    match error.disposition {
        NativeErrorDisposition::UnknownCommit => "REACTION_RESULT_UNKNOWN",
        NativeErrorDisposition::Retryable | NativeErrorDisposition::PoolNotFound => {
            "REACTION_RETRYABLE"
        }
        NativeErrorDisposition::Terminal => "REACTION_REJECTED",
    }
    .to_string()
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
    fn private_reaction_sanitizes_transport_errors_for_projection() {
        let error = NativeTransportError {
            http_status: None,
            stable_code: 0,
            retry_after_seconds: None,
            disposition: NativeErrorDisposition::UnknownCommit,
            message: "connection failed for https://private.invalid".to_string(),
        };
        assert_eq!(stable_error_code(&error), "REACTION_RESULT_UNKNOWN");
    }

    #[test]
    fn private_reaction_requires_an_explicit_kind_for_both_operations() {
        let input = PrivateReactionMutationInput {
            actor_ptid: "ptid:bob".to_string(),
            renderer_generation: 1,
            post_id: "post-1".to_string(),
            kind: social::ReactionKind::ReactionUnspecified as i32,
        };
        assert!(validate_mutation(&input, PrivateReactionOperation::React).is_err());
        assert!(validate_mutation(&input, PrivateReactionOperation::Unreact).is_err());
    }
}
