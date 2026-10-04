use std::collections::{HashMap, HashSet};

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use prost::Message;
use rand::{rngs::OsRng, RngCore};
use secure_content_core::envelope::{open_content_key, ContentKey, SealedContentKey};
use secure_content_core::payload::{
    decrypt_payload, derive_payload_key, encrypt_payload, EncryptedPayload as CoreEncryptedPayload,
    PayloadKeyContext, PAYLOAD_FORMAT_VERSION,
};
use secure_content_core::prekey::ContentPreKeyPrivate;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::model::{actor, secure_content as wire, social};
use crate::secure_content::adapter::{
    NativeErrorDisposition, NativeTransportError, SecureContentTransport,
};
use crate::secure_content::recovery::open_recovery_content_key;
use crate::secure_content::station_trust::{
    current_session_sender_signing_key, verify_profile_actor_device_signing_key,
};
use crate::secure_content::store::{
    CommentState, PublicationState, SecureContentStore, StoredCommentDraft,
};
use crate::secure_content::worker::maintain_content_prekeys;
use crate::secure_content::{SecureContentLease, SecureContentSupervisor};

use super::crypto::{bounded_command_id, seal_content_envelopes, validate_content_plan};
use super::private_mention::{
    build_signed_mention_routing, canonical_private_mentions, validated_mention_routing_hash,
    verify_decrypted_mentions, PrivateMentionIntent,
};
use super::projection::{
    canonical_identifier, checked_timestamp_millis, current_unix_seconds,
    object_descriptor_set_hash, validated_object_descriptor_set_hash, verify_station_attestation,
    verify_viewer_envelope, PrivateMentionProjection, SenderKeyRequirement,
};

const PRIVATE_COMMENT_LIMIT_DEFAULT: u32 = 20;
const PRIVATE_COMMENT_LIMIT_MAX: u32 = 100;
const PRIVATE_COMMENT_PAYLOAD_KIND: u32 = social::PrivateMomentKind::Text as u32;
const CLOCK_SKEW_SECONDS: i64 = 60;
const COMMENT_READBACK_PENDING: &str = "COMMENT_READBACK_PENDING";
const PRIVATE_CONTENT_STALE_PLAN: &str = "SOCIAL_PRIVATE_STALE_PLAN";
const FEDERATED_PRIVATE_INTERACTION_SIGNING_DOMAIN: &[u8] =
    b"peers-touch:social:federated-private-interaction:v1\0";

#[derive(Clone, Debug, Deserialize)]
pub struct PrivateCommentIntent {
    pub actor_ptid: String,
    pub renderer_generation: u64,
    pub draft_id: String,
    pub draft_revision: u64,
    pub post_id: String,
    #[serde(default)]
    pub reply_to_comment_id: String,
    pub text: String,
    #[serde(default)]
    pub mentions: Vec<PrivateMentionIntent>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PrivateCommentSubmitInput {
    pub actor_ptid: String,
    pub renderer_generation: u64,
    pub draft_id: String,
    pub draft_revision: u64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PrivateCommentListInput {
    pub actor_ptid: String,
    pub renderer_generation: u64,
    pub post_id: String,
    #[serde(default)]
    pub cursor: String,
    #[serde(default = "default_comment_limit")]
    pub limit: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PrivateCommentProjection {
    pub comment_id: String,
    pub content_id: String,
    pub generation: String,
    pub post_id: String,
    pub reply_to_comment_id: String,
    pub author_ptid: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_acct: Option<String>,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default)]
    pub mentions: Vec<PrivateMentionProjection>,
    pub reactions_count: i64,
    pub replies_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at_millis: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at_millis: Option<i64>,
}

impl PrivateCommentProjection {
    fn encode_local(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(self).map_err(|error| error.to_string())
    }

    fn decode_local(bytes: &[u8]) -> Result<Self, String> {
        serde_json::from_slice(bytes).map_err(|error| error.to_string())
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct PrivateCommentDraftProjection {
    pub draft_id: String,
    pub draft_revision: u64,
    pub post_id: String,
    pub reply_to_comment_id: String,
    pub text: String,
    pub mentions: Vec<PrivateMentionIntent>,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_not_before_unix_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publication_state: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct PrivateCommentsSnapshot {
    pub actor_ptid: String,
    pub device_id: String,
    pub session_generation: String,
    pub drafts: Vec<PrivateCommentDraftProjection>,
    pub comments: Vec<PrivateCommentProjection>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct PrivateCommentPage {
    pub post_id: String,
    pub comments: Vec<PrivateCommentProjection>,
    pub next_cursor: String,
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct PrivateCommentSubmitResult {
    pub draft: PrivateCommentDraftProjection,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<PrivateCommentProjection>,
}

#[derive(Debug)]
pub struct PrivateCommentFailure {
    pub state: CommentState,
    pub code: String,
    pub message: String,
    pub retry_after_seconds: Option<u64>,
    pub retry_not_before_unix_ms: Option<i64>,
}

impl PrivateCommentFailure {
    fn failed(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            state: CommentState::Failed,
            code: code.into(),
            message: message.into(),
            retry_after_seconds: None,
            retry_not_before_unix_ms: None,
        }
    }

    fn from_transport(error: NativeTransportError) -> Self {
        let state = if error.http_status == Some(429) {
            CommentState::RateLimited
        } else if matches!(error.http_status, Some(403 | 404 | 410)) {
            CommentState::ParentUnavailable
        } else {
            CommentState::Failed
        };
        Self {
            state,
            code: error.message.clone(),
            message: error.to_string(),
            retry_after_seconds: error.retry_after_seconds,
            retry_not_before_unix_ms: retry_not_before_unix_ms(error.retry_after_seconds),
        }
    }

    fn from_submit_transport(error: NativeTransportError) -> Self {
        Self::from_transport(error)
    }
}

struct DecryptedPrivateComment {
    projection: PrivateCommentProjection,
    content_key: ContentKey,
    consumed_prekey: Option<String>,
}

pub struct PrivateCommentOrchestrator<'a> {
    supervisor: &'a SecureContentSupervisor,
    lease: SecureContentLease,
    transport: SecureContentTransport,
}

impl<'a> PrivateCommentOrchestrator<'a> {
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

    pub fn snapshot(&self) -> Result<PrivateCommentsSnapshot, String> {
        self.supervisor
            .with_current(&self.lease.session.key, |lease| {
                let comments = lease
                    .store
                    .comment_projections()?
                    .iter()
                    .map(|bytes| PrivateCommentProjection::decode_local(bytes))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(PrivateCommentsSnapshot {
                    actor_ptid: lease.session.key.actor_ptid.clone(),
                    device_id: lease.session.key.device_id.clone(),
                    session_generation: lease.session.key.session_generation.to_string(),
                    drafts: lease
                        .store
                        .comment_drafts()?
                        .iter()
                        .map(draft_projection)
                        .collect::<Result<Vec<_>, _>>()?,
                    comments,
                })
            })
    }

    pub fn stage(
        &self,
        intent: &PrivateCommentIntent,
    ) -> Result<PrivateCommentDraftProjection, PrivateCommentFailure> {
        validate_intent(intent)?;
        let mention_intent_json = serde_json::to_string(&intent.mentions).map_err(|error| {
            PrivateCommentFailure::failed("COMMENT_DRAFT_INVALID", error.to_string())
        })?;
        let mention_commitment_salt = if intent.mentions.is_empty() {
            None
        } else {
            let mut salt = [0u8; 32];
            OsRng.fill_bytes(&mut salt);
            Some(salt)
        };
        let candidate = StoredCommentDraft {
            draft_id: intent.draft_id.clone(),
            draft_revision: intent.draft_revision,
            post_id: intent.post_id.clone(),
            content_id: ulid::Ulid::new().to_string(),
            generation: 0,
            reply_to_comment_id: intent.reply_to_comment_id.clone(),
            text: intent.text.clone(),
            mention_intent_json,
            mention_commitment_salt,
            intent_sha256: intent_hash(intent)?,
            prepare_command_id: bounded_command_id(
                "comment-prepare",
                &intent.draft_id,
                intent.draft_revision,
            ),
            submit_command_id: None,
            plan_bytes: None,
            request_bytes: None,
            request_sha256: None,
            root_key: None,
            publication_state: None,
            session_generation: self.lease.session.key.session_generation,
            comment_id: None,
            state: CommentState::Editing,
            error_code: None,
            retry_after_seconds: None,
            retry_not_before_unix_ms: None,
        };
        self.with_current_store("COMMENT_DRAFT_FAILED", |store| {
            store.reserve_comment_draft(&candidate)
        })
        .and_then(|draft| draft_projection(&draft))
    }

    pub fn prepare(
        &self,
        intent: &PrivateCommentIntent,
    ) -> Result<PrivateCommentDraftProjection, PrivateCommentFailure> {
        validate_intent(intent)?;
        let result = (|| {
            let _guard = self
                .supervisor
                .begin_private_publish(
                    &self.lease.session.key,
                    &format!("comment:{}", intent.draft_id),
                    intent.draft_revision,
                )
                .map_err(|error| PrivateCommentFailure::failed("COMMENT_BUSY", error))?;
            self.stage(intent)?;
            let mut stored = self
                .with_current_store("COMMENT_DRAFT_FAILED", |store| {
                    store.comment_draft(&intent.draft_id, intent.draft_revision)
                })?
                .ok_or_else(|| {
                    PrivateCommentFailure::failed(
                        "COMMENT_DRAFT_FAILED",
                        "private Comment draft is unavailable",
                    )
                })?;
            enforce_comment_retry_deadline(&stored)?;
            if stored.request_bytes.is_some() {
                if comment_requires_reprepare(&stored)? {
                    stored = self.reset_comment_for_reprepare(&stored)?;
                } else {
                    return draft_projection(&stored);
                }
            }
            maintain_content_prekeys(self.supervisor, &self.lease)
                .map_err(|error| PrivateCommentFailure::failed("COMMENT_PREKEY_FAILED", error))?;
            self.set_state(intent, CommentState::Encrypting, None, None)?;
            let mut prepare_request = social::PreparePrivateCommentRequest {
                post_id: stored.post_id.clone(),
                comment_content_id: stored.content_id.clone(),
                reply_to_comment_id: stored.reply_to_comment_id.clone(),
                object_count: 0,
                command_id: stored.prepare_command_id.clone(),
                actor_signing_key_id: self.lease.session.signing_key_id.clone(),
                actor_device_signature: Vec::new(),
            };
            prepare_request.actor_device_signature = self
                .lease
                .session
                .sign(&federated_private_interaction_request_signing_bytes(
                    social::FederatedPrivateInteractionOperation::PrepareComment,
                    &prepare_request.encode_to_vec(),
                ))
                .map_err(|error| PrivateCommentFailure::failed("COMMENT_PREPARE_INVALID", error))?;
            let prepare_response = match self
                .transport
                .prepare_private_comment(&stored.post_id, &prepare_request)
            {
                Ok(response) => response,
                Err(error) => {
                    return Err(PrivateCommentFailure::from_transport(error));
                }
            };
            let station_attestation = prepare_response.station_signing_key_attestation.clone();
            let plan = prepare_response.plan.ok_or_else(|| {
                PrivateCommentFailure::failed(
                    "COMMENT_PREPARE_INVALID",
                    "private Comment prepare response omitted its plan",
                )
            })?;
            self.ensure_current()?;
            let domain_binding =
                comment_domain_binding(&stored.post_id, &stored.reply_to_comment_id);
            validate_content_plan(
                &plan,
                station_attestation.as_ref(),
                &self.lease,
                &stored.content_id,
                0,
                &domain_binding,
                "private Comment",
            )
            .map_err(|error| PrivateCommentFailure::failed("COMMENT_PLAN_INVALID", error))?;
            let resource = plan.resource.as_ref().ok_or_else(|| {
                PrivateCommentFailure::failed(
                    "COMMENT_PLAN_INVALID",
                    "private Comment plan resource is unavailable",
                )
            })?;
            let authorization_snapshot: [u8; 32] = plan
                .authorization_snapshot_sha256
                .as_slice()
                .try_into()
                .map_err(|_| {
                    PrivateCommentFailure::failed(
                        "COMMENT_PLAN_INVALID",
                        "private Comment authorization snapshot is invalid",
                    )
                })?;
            let root = ContentKey::generate();
            let mention_intents = stored_comment_mentions(&stored)?;
            let mentions =
                canonical_private_mentions(&stored.text, &mention_intents, "private Comment")
                    .map_err(|error| {
                        PrivateCommentFailure::failed("COMMENT_DRAFT_INVALID", error)
                    })?;
            let payload_key = derive_payload_key(
                root.as_bytes(),
                &authorization_snapshot,
                &PayloadKeyContext {
                    protocol_version: PAYLOAD_FORMAT_VERSION,
                    owner_domain: resource.owner_domain as u32,
                    content_id: &resource.content_id,
                    generation: resource.generation,
                    payload_kind: PRIVATE_COMMENT_PAYLOAD_KIND,
                },
            )
            .map_err(|error| PrivateCommentFailure::failed("COMMENT_ENCRYPT_FAILED", error))?;
            let plaintext = social::PrivateCommentContent {
                format_version: PAYLOAD_FORMAT_VERSION,
                content_id: stored.content_id.clone(),
                parent_content_id: stored.post_id.clone(),
                text: stored.text.clone(),
                mentions: mentions.clone(),
                mention_commitment_salt: stored
                    .mention_commitment_salt
                    .map(|salt| salt.to_vec())
                    .unwrap_or_default(),
            }
            .encode_to_vec();
            let encrypted = encrypt_payload(&payload_key, &plaintext, &domain_binding)
                .map_err(|error| PrivateCommentFailure::failed("COMMENT_ENCRYPT_FAILED", error))?;
            let payload = wire::EncryptedPayload {
                format_version: PAYLOAD_FORMAT_VERSION,
                resource: Some(resource.clone()),
                suite: wire::PayloadEncryptionSuite::Aes256Gcm as i32,
                nonce: encrypted.nonce.to_vec(),
                ciphertext: encrypted.ciphertext,
                ciphertext_sha256: encrypted.ciphertext_sha256.to_vec(),
                aad_sha256: encrypted.aad_sha256.to_vec(),
            };
            let mention_routing = build_signed_mention_routing(
                &mentions,
                stored.mention_commitment_salt.as_ref(),
                &plan,
                &payload,
                self.lease.session.as_ref(),
                "private Comment",
            )
            .map_err(|error| PrivateCommentFailure::failed("COMMENT_ENCRYPT_FAILED", error))?;
            let envelopes = seal_content_envelopes(
                self.lease.session.as_ref(),
                &plan,
                &payload,
                object_descriptor_set_hash(&[]).map_err(|error| {
                    PrivateCommentFailure::failed("COMMENT_ENCRYPT_FAILED", error)
                })?,
                &root,
                "private Comment",
            )
            .map_err(|error| PrivateCommentFailure::failed("COMMENT_ENCRYPT_FAILED", error))?;
            let submit_command_id = bounded_command_id(
                "comment-submit",
                &format!("{}:{}", intent.draft_id, stored.content_id),
                intent.draft_revision,
            );
            let mut request = social::SubmitPrivateCommentRequest {
                plan: Some(plan.clone()),
                payload: Some(payload),
                envelopes,
                objects: Vec::new(),
                mention_routing,
                command_id: submit_command_id.clone(),
                post_id: intent.post_id.clone(),
                actor_signing_key_id: self.lease.session.signing_key_id.clone(),
                actor_device_signature: Vec::new(),
            };
            request.actor_device_signature = self
                .lease
                .session
                .sign(&federated_private_interaction_request_signing_bytes(
                    social::FederatedPrivateInteractionOperation::SubmitComment,
                    &request.encode_to_vec(),
                ))
                .map_err(|error| PrivateCommentFailure::failed("COMMENT_ENCRYPT_FAILED", error))?;
            let request_bytes = request.encode_to_vec();
            self.with_current_store("COMMENT_DRAFT_FAILED", |store| {
                store.persist_comment_submission(
                    &intent.draft_id,
                    intent.draft_revision,
                    resource.generation,
                    &submit_command_id,
                    &plan.encode_to_vec(),
                    &request_bytes,
                    &Sha256::digest(&request_bytes).into(),
                    root.as_bytes(),
                    self.lease.session.key.session_generation,
                )
            })?;
            let prepared = self
                .with_current_store("COMMENT_DRAFT_FAILED", |store| {
                    store.comment_draft(&intent.draft_id, intent.draft_revision)
                })?
                .ok_or_else(|| {
                    PrivateCommentFailure::failed(
                        "COMMENT_DRAFT_FAILED",
                        "prepared private Comment draft is unavailable",
                    )
                })?;
            draft_projection(&prepared)
        })();
        if let Err(failure) = &result {
            self.persist_failure(intent, failure)?;
        }
        result
    }

    pub fn submit(
        &self,
        input: &PrivateCommentSubmitInput,
    ) -> Result<PrivateCommentSubmitResult, PrivateCommentFailure> {
        if input.actor_ptid.trim().is_empty()
            || input.renderer_generation == 0
            || input.draft_id.trim().is_empty()
            || input.draft_revision == 0
        {
            return Err(PrivateCommentFailure::failed(
                "COMMENT_SUBMIT_INVALID",
                "private Comment submit identity is invalid",
            ));
        }
        let _guard = self
            .supervisor
            .begin_private_publish(
                &self.lease.session.key,
                &format!("comment:{}", input.draft_id),
                input.draft_revision,
            )
            .map_err(|error| PrivateCommentFailure::failed("COMMENT_BUSY", error))?;
        let existing = self.load_draft(input)?;
        enforce_comment_retry_deadline(&existing)?;
        if existing.state == CommentState::Posted {
            let comment_id = existing.comment_id.as_deref().ok_or_else(|| {
                PrivateCommentFailure::failed(
                    "COMMENT_PROJECTION_INVALID",
                    "posted private Comment has no Comment ID",
                )
            })?;
            let comment = self
                .with_current_store("COMMENT_PROJECTION_INVALID", |store| {
                    store.comment_projection(&existing.post_id, comment_id)
                })?
                .ok_or_else(|| {
                    PrivateCommentFailure::failed(
                        "COMMENT_PROJECTION_INVALID",
                        "posted private Comment projection is unavailable",
                    )
                })
                .and_then(|bytes| {
                    PrivateCommentProjection::decode_local(&bytes).map_err(|error| {
                        PrivateCommentFailure::failed("COMMENT_PROJECTION_INVALID", error)
                    })
                })?;
            return Ok(PrivateCommentSubmitResult {
                draft: draft_projection(&existing)?,
                comment: Some(comment),
            });
        }
        if existing.publication_state == Some(PublicationState::CommittedPendingReadback) {
            return self.reconcile_committed_submit(existing);
        }
        if comment_requires_reprepare(&existing)? {
            let failure = PrivateCommentFailure::failed(
                "COMMENT_REPREPARE_REQUIRED",
                "private Comment retry requires a fresh encryption plan",
            );
            let changed = self.with_current_store("COMMENT_DRAFT_FAILED", |store| {
                store.set_comment_draft_state(
                    &existing.draft_id,
                    existing.draft_revision,
                    CommentState::Failed,
                    Some(&failure.code),
                    None,
                )
            })?;
            if !changed {
                return Err(PrivateCommentFailure::failed(
                    "COMMENT_DRAFT_FAILED",
                    "private Comment reprepare transition lost its revision fence",
                ));
            }
            return Err(failure);
        }
        let request_bytes = existing.request_bytes.as_deref().ok_or_else(|| {
            PrivateCommentFailure::failed(
                "COMMENT_SUBMIT_INVALID",
                "private Comment submission is unavailable",
            )
        })?;
        let draft = self.with_current_store("COMMENT_SUBMIT_FAILED", |store| {
            store.acquire_comment_submission(
                &input.draft_id,
                input.draft_revision,
                self.lease.session.key.session_generation,
            )
        })?;
        match self
            .transport
            .submit_private_comment(&draft.post_id, request_bytes)
        {
            Ok(_) => {
                let committed = self.mark_comment_committed(&draft)?;
                self.reconcile_committed_submit(committed)
            }
            Err(error) => {
                if error
                    .http_status
                    .is_some_and(|status| (200..300).contains(&status))
                {
                    let committed = self.mark_comment_committed(&draft)?;
                    let failure =
                        PrivateCommentFailure::failed(COMMENT_READBACK_PENDING, error.to_string());
                    self.persist_readback_failure(&committed, &failure)?;
                    return Err(failure);
                }
                let mut publication_state = submit_failure_publication_state(&error);
                let failure = self.classify_submit_transport_failure(&draft, error);
                if failure.state == CommentState::ParentUnavailable {
                    publication_state = PublicationState::Terminal;
                }
                self.persist_submit_failure(&draft, &failure, publication_state)?;
                Err(failure)
            }
        }
    }

    pub fn list(
        &self,
        input: &PrivateCommentListInput,
    ) -> Result<PrivateCommentPage, PrivateCommentFailure> {
        if input.post_id.trim().is_empty()
            || input.limit == 0
            || input.limit > PRIVATE_COMMENT_LIMIT_MAX
        {
            return Err(PrivateCommentFailure::failed(
                "COMMENT_LIST_INVALID",
                "private Comment list request is invalid",
            ));
        }
        let response = self
            .transport
            .list_moment_comments(&input.post_id, &input.cursor, input.limit)
            .map_err(PrivateCommentFailure::from_transport)?;
        self.ensure_current()?;
        let mut recovery_ids = HashSet::new();
        for resource in &response.comments {
            if comment_needs_recovery(self.lease.store.as_ref(), resource)? {
                let comment_id = resource
                    .metadata
                    .as_ref()
                    .map(|metadata| metadata.comment_id.trim())
                    .filter(|comment_id| !comment_id.is_empty())
                    .ok_or_else(|| {
                        PrivateCommentFailure::failed(
                            "COMMENT_INTEGRITY_FAILURE",
                            "private Comment recovery identity is unavailable",
                        )
                    })?;
                recovery_ids.insert(comment_id.to_string());
            }
        }
        let recovery_entries = if recovery_ids.is_empty() {
            HashMap::new()
        } else {
            self.comment_recovery_entries(&input.post_id, &recovery_ids)?
        };
        let mut comments = Vec::with_capacity(response.comments.len());
        for resource in &response.comments {
            let comment_id = resource
                .metadata
                .as_ref()
                .map(|metadata| metadata.comment_id.as_str())
                .unwrap_or_default();
            let decrypted = if recovery_ids.contains(comment_id) {
                let recoverable = recovery_entries.get(comment_id).ok_or_else(|| {
                    PrivateCommentFailure::failed(
                        "COMMENT_RECOVERY_KEY_UNAVAILABLE",
                        "private Comment recovery envelope is unavailable",
                    )
                })?;
                self.decrypt_recovered_comment(&input.post_id, comment_id, resource, recoverable)?
            } else {
                let sender_key = self.sender_signing_key(&input.post_id, comment_id, resource)?;
                decrypt_comment_resource(
                    self.lease.session.as_ref(),
                    self.lease.store.as_ref(),
                    &input.post_id,
                    comment_id,
                    resource,
                    &sender_key,
                    None,
                    None,
                )?
            };
            self.persist_decrypted(&decrypted)?;
            comments.push(decrypted.projection);
        }
        Ok(PrivateCommentPage {
            post_id: input.post_id.clone(),
            comments,
            next_cursor: response.next_cursor,
            has_more: response.has_more,
        })
    }

    fn comment_recovery_entries(
        &self,
        post_id: &str,
        comment_ids: &HashSet<String>,
    ) -> Result<HashMap<String, social::RecoverablePrivateContent>, PrivateCommentFailure> {
        let mut cursor = String::new();
        let mut recovered = HashMap::new();
        loop {
            let response = self
                .transport
                .list_recoverable(&cursor, PRIVATE_COMMENT_LIMIT_MAX)
                .map_err(PrivateCommentFailure::from_transport)?;
            self.ensure_current()?;
            for resource in response.resources {
                let Some(content_id) =
                    validate_comment_recovery_record(post_id, comment_ids, &resource)?
                else {
                    continue;
                };
                if recovered.insert(content_id, resource).is_some() {
                    return Err(PrivateCommentFailure::failed(
                        "COMMENT_INTEGRITY_FAILURE",
                        "private Comment recovery record is duplicated",
                    ));
                }
            }
            if recovered.len() == comment_ids.len() || !response.has_more {
                break;
            }
            if response.next_cursor.trim().is_empty() || response.next_cursor == cursor {
                return Err(PrivateCommentFailure::failed(
                    "COMMENT_INTEGRITY_FAILURE",
                    "private Comment recovery pagination did not advance",
                ));
            }
            cursor = response.next_cursor;
        }
        Ok(recovered)
    }

    fn decrypt_recovered_comment(
        &self,
        post_id: &str,
        comment_id: &str,
        resource: &social::CommentResource,
        recoverable: &social::RecoverablePrivateContent,
    ) -> Result<DecryptedPrivateComment, PrivateCommentFailure> {
        let recovery_envelope = recoverable.recovery_envelope.as_ref().ok_or_else(|| {
            PrivateCommentFailure::failed(
                "COMMENT_RECOVERY_KEY_UNAVAILABLE",
                "private Comment recovery envelope is unavailable",
            )
        })?;
        let private = match resource.body.as_ref() {
            Some(social::comment_resource::Body::PrivateContent(private)) => private,
            _ => {
                return Err(PrivateCommentFailure::failed(
                    "COMMENT_INTEGRITY_FAILURE",
                    "Comment recovery resource is not private",
                ))
            }
        };
        let payload = private.payload.as_ref().ok_or_else(|| {
            PrivateCommentFailure::failed(
                "COMMENT_INTEGRITY_FAILURE",
                "private Comment recovery payload is unavailable",
            )
        })?;
        if payload.resource.as_ref() != recoverable.resource.as_ref()
            || payload.ciphertext_sha256 != recoverable.payload_ciphertext_sha256
        {
            return Err(PrivateCommentFailure::failed(
                "COMMENT_INTEGRITY_FAILURE",
                "private Comment recovery record does not match point read",
            ));
        }
        let mut recovered_resource = resource.clone();
        attach_comment_recovery_envelope(&mut recovered_resource, recovery_envelope)?;
        let sender_key = self.sender_signing_key(post_id, comment_id, &recovered_resource)?;
        let root = open_recovery_content_key(
            self.lease.store.as_ref(),
            &self.lease.session.key.actor_ptid,
            recovery_envelope,
        )
        .map_err(|error| {
            PrivateCommentFailure::failed("COMMENT_RECOVERY_KEY_UNAVAILABLE", error)
        })?;
        decrypt_comment_resource(
            self.lease.session.as_ref(),
            self.lease.store.as_ref(),
            post_id,
            comment_id,
            &recovered_resource,
            &sender_key,
            Some(root),
            Some(recovery_envelope.principal_epoch),
        )
    }

    fn finish_committed_submit(
        &self,
        draft: StoredCommentDraft,
    ) -> Result<PrivateCommentSubmitResult, PrivateCommentFailure> {
        let comment_id = draft
            .comment_id
            .clone()
            .filter(|comment_id| comment_id == &draft.content_id)
            .ok_or_else(|| {
                PrivateCommentFailure::failed(
                    COMMENT_READBACK_PENDING,
                    "committed private Comment identity is unavailable",
                )
            })?;
        let point = self
            .transport
            .get_private_comment(&draft.post_id, &comment_id)
            .map_err(PrivateCommentFailure::from_transport)?;
        self.ensure_current()?;
        let resource = point.comment.as_ref().ok_or_else(|| {
            PrivateCommentFailure::failed(
                "COMMENT_READBACK_FAILED",
                "private Comment point read omitted the resource",
            )
        })?;
        let sender_key = self.sender_signing_key(&draft.post_id, &comment_id, resource)?;
        let root = draft.root_key.ok_or_else(|| {
            PrivateCommentFailure::failed(
                "COMMENT_READBACK_FAILED",
                "private Comment root is unavailable",
            )
        })?;
        let decrypted = decrypt_comment_resource(
            self.lease.session.as_ref(),
            self.lease.store.as_ref(),
            &draft.post_id,
            &comment_id,
            resource,
            &sender_key,
            Some(ContentKey::from_bytes(root)),
            None,
        )?;
        self.persist_decrypted(&decrypted)?;
        let changed = self.with_current_store("COMMENT_DRAFT_FAILED", |store| {
            store.mark_comment_posted(
                &draft.draft_id,
                draft.draft_revision,
                draft.session_generation,
                &comment_id,
            )
        })?;
        if !changed {
            return Err(PrivateCommentFailure::failed(
                "COMMENT_DRAFT_FAILED",
                "private Comment completion lost its generation fence",
            ));
        }
        let posted = self.load_draft(&PrivateCommentSubmitInput {
            actor_ptid: self.lease.session.key.actor_ptid.clone(),
            renderer_generation: self.lease.renderer_generation,
            draft_id: draft.draft_id,
            draft_revision: draft.draft_revision,
        })?;
        Ok(PrivateCommentSubmitResult {
            draft: draft_projection(&posted)?,
            comment: Some(decrypted.projection),
        })
    }

    fn reconcile_committed_submit(
        &self,
        draft: StoredCommentDraft,
    ) -> Result<PrivateCommentSubmitResult, PrivateCommentFailure> {
        match self.finish_committed_submit(draft.clone()) {
            Ok(result) => Ok(result),
            Err(failure) => {
                let failure = if failure.state == CommentState::ParentUnavailable {
                    failure
                } else {
                    PrivateCommentFailure {
                        state: CommentState::Failed,
                        code: COMMENT_READBACK_PENDING.to_string(),
                        message: failure.message,
                        retry_after_seconds: failure.retry_after_seconds,
                        retry_not_before_unix_ms: failure.retry_not_before_unix_ms,
                    }
                };
                self.persist_readback_failure(&draft, &failure)?;
                Err(failure)
            }
        }
    }

    fn mark_comment_committed(
        &self,
        draft: &StoredCommentDraft,
    ) -> Result<StoredCommentDraft, PrivateCommentFailure> {
        let changed = self.with_current_store("COMMENT_DRAFT_FAILED", |store| {
            store.mark_comment_committed_pending_readback(
                &draft.draft_id,
                draft.draft_revision,
                draft.session_generation,
                &draft.content_id,
            )
        })?;
        if !changed {
            return Err(PrivateCommentFailure::failed(
                "COMMENT_DRAFT_FAILED",
                "private Comment commit transition lost its generation fence",
            ));
        }
        self.load_draft(&PrivateCommentSubmitInput {
            actor_ptid: self.lease.session.key.actor_ptid.clone(),
            renderer_generation: self.lease.renderer_generation,
            draft_id: draft.draft_id.clone(),
            draft_revision: draft.draft_revision,
        })
    }

    fn reset_comment_for_reprepare(
        &self,
        draft: &StoredCommentDraft,
    ) -> Result<StoredCommentDraft, PrivateCommentFailure> {
        let content_id = ulid::Ulid::new().to_string();
        let prepare_command_id = bounded_command_id(
            "comment-prepare-retry",
            &format!("{}:{content_id}", draft.draft_id),
            draft.draft_revision,
        );
        let changed = self.with_current_store("COMMENT_DRAFT_FAILED", |store| {
            store.reset_comment_submission_for_reprepare(
                &draft.draft_id,
                draft.draft_revision,
                self.lease.session.key.session_generation,
                &content_id,
                &prepare_command_id,
            )
        })?;
        if !changed {
            return Err(PrivateCommentFailure::failed(
                "COMMENT_DRAFT_FAILED",
                "private Comment reprepare transition lost its generation fence",
            ));
        }
        self.load_draft(&PrivateCommentSubmitInput {
            actor_ptid: self.lease.session.key.actor_ptid.clone(),
            renderer_generation: self.lease.renderer_generation,
            draft_id: draft.draft_id.clone(),
            draft_revision: draft.draft_revision,
        })
    }

    fn classify_submit_transport_failure(
        &self,
        draft: &StoredCommentDraft,
        error: NativeTransportError,
    ) -> PrivateCommentFailure {
        let stale_plan = error.message == PRIVATE_CONTENT_STALE_PLAN;
        let mut failure = PrivateCommentFailure::from_submit_transport(error);
        if stale_plan && self.parent_or_reply_unavailable(draft) {
            failure.state = CommentState::ParentUnavailable;
            failure.code = "COMMENT_PARENT_UNAVAILABLE".to_string();
        }
        failure
    }

    fn parent_or_reply_unavailable(&self, draft: &StoredCommentDraft) -> bool {
        if self
            .transport
            .get_private_moment(&draft.post_id)
            .is_err_and(|error| matches!(error.http_status, Some(403 | 404 | 410)))
        {
            return true;
        }
        !draft.reply_to_comment_id.is_empty()
            && self
                .transport
                .get_private_comment(&draft.post_id, &draft.reply_to_comment_id)
                .is_err_and(|error| matches!(error.http_status, Some(403 | 404 | 410)))
    }

    fn persist_readback_failure(
        &self,
        draft: &StoredCommentDraft,
        failure: &PrivateCommentFailure,
    ) -> Result<(), PrivateCommentFailure> {
        self.with_current_store("COMMENT_DRAFT_FAILED", |store| {
            if failure.state == CommentState::ParentUnavailable {
                if !store.mark_comment_terminal(
                    &draft.draft_id,
                    draft.draft_revision,
                    draft.session_generation,
                    failure.state,
                    &failure.code,
                )? {
                    return Err(
                        "private Comment readback terminal transition lost its generation fence"
                            .to_string(),
                    );
                }
                store.clear_comment_projections(&draft.post_id)?;
                return Ok(());
            }
            if !store.mark_comment_readback_failed(
                &draft.draft_id,
                draft.draft_revision,
                draft.session_generation,
                COMMENT_READBACK_PENDING,
                failure.retry_after_seconds,
            )? {
                return Err(
                    "private Comment readback transition lost its generation fence".to_string(),
                );
            }
            Ok(())
        })
    }

    fn sender_signing_key(
        &self,
        post_id: &str,
        comment_id: &str,
        resource: &social::CommentResource,
    ) -> Result<VerifyingKey, PrivateCommentFailure> {
        let requirement = comment_sender_key_requirement(post_id, comment_id, resource)
            .map_err(|error| PrivateCommentFailure::failed("COMMENT_INTEGRITY_FAILURE", error))?;
        let signing_key_id = requirement.signing_key_id.as_deref().ok_or_else(|| {
            PrivateCommentFailure::failed(
                "COMMENT_INTEGRITY_FAILURE",
                "private Comment sender signing key ID is unavailable",
            )
        })?;
        if let Some(key) = current_session_sender_signing_key(
            self.lease.session.as_ref(),
            &requirement.sender,
            signing_key_id,
        )
        .map_err(|error| PrivateCommentFailure::failed("COMMENT_INTEGRITY_FAILURE", error))?
        {
            return Ok(key);
        }
        if let Some(key) = receiver_verified_comment_sender_key(
            resource,
            &requirement.sender,
            signing_key_id,
            requirement.committed_at_unix_ms,
        )
        .map_err(|error| PrivateCommentFailure::failed("COMMENT_INTEGRITY_FAILURE", error))?
        {
            return Ok(key);
        }
        let actor = requirement.sender.actor.as_ref().ok_or_else(|| {
            PrivateCommentFailure::failed(
                "COMMENT_INTEGRITY_FAILURE",
                "private Comment sender actor is unavailable",
            )
        })?;
        let profile = self
            .transport
            .get_actor_federation_profile(actor)
            .map_err(PrivateCommentFailure::from_transport)?;
        verify_profile_actor_device_signing_key(
            &profile,
            &self.lease.session.trusted_station_signing_key,
            &profile.federated_handle,
            &self.lease.session.key.station_peer_id,
            &requirement.sender,
            signing_key_id,
            requirement.committed_at_unix_ms,
            super::crypto::now_unix_ms(),
        )
        .map_err(|error| PrivateCommentFailure::failed("COMMENT_INTEGRITY_FAILURE", error))
    }

    fn persist_decrypted(
        &self,
        decrypted: &DecryptedPrivateComment,
    ) -> Result<(), PrivateCommentFailure> {
        let generation = decrypted
            .projection
            .generation
            .parse::<u64>()
            .map_err(|_| {
                PrivateCommentFailure::failed(
                    "COMMENT_PROJECTION_INVALID",
                    "private Comment projection generation is invalid",
                )
            })?;
        let projection_bytes = decrypted
            .projection
            .encode_local()
            .map_err(|error| PrivateCommentFailure::failed("COMMENT_PROJECTION_INVALID", error))?;
        self.with_current_store("COMMENT_PROJECTION_INVALID", |store| {
            store.commit_comment_root(
                &decrypted.projection.content_id,
                generation,
                &decrypted.projection.post_id,
                &decrypted.projection.comment_id,
                decrypted.content_key.as_bytes(),
                decrypted.consumed_prekey.as_deref(),
                &projection_bytes,
            )
        })
    }

    fn persist_submit_failure(
        &self,
        draft: &StoredCommentDraft,
        failure: &PrivateCommentFailure,
        publication_state: PublicationState,
    ) -> Result<(), PrivateCommentFailure> {
        self.with_current_store("COMMENT_DRAFT_FAILED", |store| {
            if publication_state == PublicationState::Terminal {
                if !store.mark_comment_terminal(
                    &draft.draft_id,
                    draft.draft_revision,
                    draft.session_generation,
                    failure.state,
                    &failure.code,
                )? {
                    return Err(
                        "private Comment terminal transition lost its generation fence".to_string(),
                    );
                }
                if failure.state == CommentState::ParentUnavailable {
                    store.clear_comment_projections(&draft.post_id)?;
                }
                return Ok(());
            }

            if !store.mark_comment_retryable(
                &draft.draft_id,
                draft.draft_revision,
                draft.session_generation,
                publication_state,
                failure.state,
                &failure.code,
                failure.retry_after_seconds,
            )? {
                return Err(
                    "private Comment retry transition lost its generation fence".to_string()
                );
            }
            Ok(())
        })
    }

    fn load_draft(
        &self,
        input: &PrivateCommentSubmitInput,
    ) -> Result<StoredCommentDraft, PrivateCommentFailure> {
        self.with_current_store("COMMENT_DRAFT_FAILED", |store| {
            store.comment_draft(&input.draft_id, input.draft_revision)
        })?
        .filter(|draft| draft.post_id.trim() != "")
        .ok_or_else(|| {
            PrivateCommentFailure::failed(
                "COMMENT_DRAFT_FAILED",
                "private Comment draft is unavailable",
            )
        })
    }

    fn set_state(
        &self,
        intent: &PrivateCommentIntent,
        state: CommentState,
        error_code: Option<&str>,
        retry_after_seconds: Option<u64>,
    ) -> Result<(), PrivateCommentFailure> {
        let changed = self.with_current_store("COMMENT_DRAFT_FAILED", |store| {
            store.set_comment_draft_state(
                &intent.draft_id,
                intent.draft_revision,
                state,
                error_code,
                retry_after_seconds,
            )
        })?;
        if changed {
            Ok(())
        } else {
            Err(PrivateCommentFailure::failed(
                "COMMENT_DRAFT_FAILED",
                "private Comment draft state update was fenced",
            ))
        }
    }

    fn persist_failure(
        &self,
        intent: &PrivateCommentIntent,
        failure: &PrivateCommentFailure,
    ) -> Result<(), PrivateCommentFailure> {
        let exists = self.with_current_store("COMMENT_DRAFT_FAILED", |store| {
            store.comment_draft(&intent.draft_id, intent.draft_revision)
        })?;
        let current_intent_hash = intent_hash(intent)?;
        if exists
            .as_ref()
            .is_none_or(|draft| draft.intent_sha256 != current_intent_hash)
        {
            return Ok(());
        }
        self.set_state(
            intent,
            failure.state,
            Some(&failure.code),
            failure.retry_after_seconds,
        )
    }

    fn with_current_store<T>(
        &self,
        error_code: &'static str,
        operation: impl FnOnce(&SecureContentStore) -> Result<T, String>,
    ) -> Result<T, PrivateCommentFailure> {
        self.supervisor
            .with_current(&self.lease.session.key, |lease| {
                Ok(operation(lease.store.as_ref()))
            })
            .map_err(|error| PrivateCommentFailure::failed("COMMENT_SESSION_STALE", error))?
            .map_err(|error| PrivateCommentFailure::failed(error_code, error))
    }

    fn ensure_current(&self) -> Result<(), PrivateCommentFailure> {
        self.supervisor
            .with_current(&self.lease.session.key, |_| Ok(()))
            .map_err(|error| PrivateCommentFailure::failed("COMMENT_SESSION_STALE", error))
    }
}

fn receiver_verified_comment_sender_key(
    resource: &social::CommentResource,
    expected_sender: &actor::ActorDeviceRef,
    expected_signing_key_id: &str,
    committed_at_unix_ms: i64,
) -> Result<Option<VerifyingKey>, String> {
    let key = match resource
        .body
        .as_ref()
        .and_then(|body| match body {
            social::comment_resource::Body::PrivateContent(private) => {
                private.verification.as_ref()
            }
            _ => None,
        })
        .and_then(|verification| verification.receiver_verified_sender_signing_key.as_ref())
    {
        Some(key) => key,
        None => return Ok(None),
    };
    let expected_actor_ptid = expected_sender
        .actor
        .as_ref()
        .map(|actor| actor.ptid.as_str())
        .unwrap_or_default();
    if expected_actor_ptid.is_empty()
        || expected_sender.device_id.is_empty()
        || expected_signing_key_id.is_empty()
        || key.actor_ptid != expected_actor_ptid
        || key.actor_device_id != expected_sender.device_id
        || key.home_station_peer_id.trim().is_empty()
        || key.signing_key_id != expected_signing_key_id
        || key.ed25519_public_key.len() != 32
        || key.profile_version <= 0
        || key.valid_from_unix_ms <= 0
        || key.valid_from_unix_ms > committed_at_unix_ms
        || (key.revoked_at_unix_ms != 0
            && (key.revoked_at_unix_ms <= key.valid_from_unix_ms
                || committed_at_unix_ms >= key.revoked_at_unix_ms))
        || !matches!(
            actor::ActorSigningKeyVerificationSource::try_from(key.verification_source).ok(),
            Some(actor::ActorSigningKeyVerificationSource::LocalDeviceRegistration)
                | Some(actor::ActorSigningKeyVerificationSource::VerifiedProfile)
                | Some(actor::ActorSigningKeyVerificationSource::VerifiedLocator)
        )
    {
        return Err("receiver-verified private Comment sender signing key is invalid".to_string());
    }
    VerifyingKey::from_bytes(key.ed25519_public_key.as_slice().try_into().map_err(|_| {
        "receiver-verified private Comment sender signing key is invalid".to_string()
    })?)
    .map(Some)
    .map_err(|_| "receiver-verified private Comment sender signing key is invalid".to_string())
}

fn submit_failure_publication_state(error: &NativeTransportError) -> PublicationState {
    if matches!(
        error.message.as_str(),
        PRIVATE_CONTENT_STALE_PLAN | "SOCIAL_PRIVATE_EXPIRED_PLAN"
    ) {
        return PublicationState::PendingPublication;
    }
    match error.http_status {
        Some(403 | 404 | 409 | 410) => PublicationState::Terminal,
        Some(429) => PublicationState::PendingPublication,
        _ => match error.disposition {
            NativeErrorDisposition::Retryable => PublicationState::PendingPublication,
            NativeErrorDisposition::UnknownCommit => PublicationState::UnknownCommit,
            NativeErrorDisposition::Terminal | NativeErrorDisposition::PoolNotFound => {
                PublicationState::Terminal
            }
        },
    }
}

fn default_comment_limit() -> u32 {
    PRIVATE_COMMENT_LIMIT_DEFAULT
}

fn validate_intent(intent: &PrivateCommentIntent) -> Result<(), PrivateCommentFailure> {
    if intent.actor_ptid.trim().is_empty()
        || intent.renderer_generation == 0
        || intent.draft_id.trim().is_empty()
        || intent.draft_revision == 0
        || intent.post_id.trim().is_empty()
        || intent.text.trim().is_empty()
        || intent.text.len() > 8 * 1024
        || (!intent.reply_to_comment_id.is_empty()
            && intent.reply_to_comment_id.trim() != intent.reply_to_comment_id)
    {
        return Err(PrivateCommentFailure::failed(
            "COMMENT_DRAFT_INVALID",
            "private Comment draft is invalid",
        ));
    }
    canonical_private_mentions(&intent.text, &intent.mentions, "private Comment")
        .map_err(|error| PrivateCommentFailure::failed("COMMENT_DRAFT_INVALID", error))?;
    Ok(())
}

fn intent_hash(intent: &PrivateCommentIntent) -> Result<[u8; 32], PrivateCommentFailure> {
    let encoded = serde_json::to_vec(&(
        &intent.actor_ptid,
        &intent.draft_id,
        intent.draft_revision,
        &intent.post_id,
        &intent.reply_to_comment_id,
        &intent.text,
        &intent.mentions,
    ))
    .map_err(|error| PrivateCommentFailure::failed("COMMENT_DRAFT_INVALID", error.to_string()))?;
    Ok(Sha256::digest(encoded).into())
}

fn draft_projection(
    draft: &StoredCommentDraft,
) -> Result<PrivateCommentDraftProjection, PrivateCommentFailure> {
    Ok(PrivateCommentDraftProjection {
        draft_id: draft.draft_id.clone(),
        draft_revision: draft.draft_revision,
        post_id: draft.post_id.clone(),
        reply_to_comment_id: draft.reply_to_comment_id.clone(),
        text: draft.text.clone(),
        mentions: stored_comment_mentions(draft)?,
        state: draft.state.as_str().to_string(),
        comment_id: draft.comment_id.clone(),
        error_code: draft.error_code.clone(),
        retry_after_seconds: draft.retry_after_seconds,
        retry_not_before_unix_ms: draft.retry_not_before_unix_ms,
        publication_state: draft.publication_state.map(publication_state_name),
    })
}

fn stored_comment_mentions(
    draft: &StoredCommentDraft,
) -> Result<Vec<PrivateMentionIntent>, PrivateCommentFailure> {
    serde_json::from_str(&draft.mention_intent_json).map_err(|error| {
        PrivateCommentFailure::failed(
            "COMMENT_DRAFT_FAILED",
            format!("private Comment mention intent is malformed: {error}"),
        )
    })
}

fn publication_state_name(state: PublicationState) -> String {
    match state {
        PublicationState::PendingPublication => "PENDING_PUBLICATION",
        PublicationState::InFlight => "IN_FLIGHT",
        PublicationState::UnknownCommit => "UNKNOWN_COMMIT",
        PublicationState::Published => "PUBLISHED",
        PublicationState::Terminal => "TERMINAL",
        PublicationState::CommittedPendingReadback => "COMMITTED_PENDING_READBACK",
    }
    .to_string()
}

fn retry_not_before_unix_ms(retry_after_seconds: Option<u64>) -> Option<i64> {
    let delay = i64::try_from(retry_after_seconds?.checked_mul(1_000)?).ok()?;
    super::crypto::now_unix_ms().checked_add(delay)
}

fn federated_private_interaction_request_signing_bytes(
    operation: social::FederatedPrivateInteractionOperation,
    canonical_operation: &[u8],
) -> Vec<u8> {
    let mut signing_bytes = Vec::with_capacity(
        FEDERATED_PRIVATE_INTERACTION_SIGNING_DOMAIN.len()
            + std::mem::size_of::<u32>()
            + canonical_operation.len(),
    );
    signing_bytes.extend_from_slice(FEDERATED_PRIVATE_INTERACTION_SIGNING_DOMAIN);
    signing_bytes.extend_from_slice(&(operation as u32).to_be_bytes());
    signing_bytes.extend_from_slice(canonical_operation);
    signing_bytes
}

fn enforce_comment_retry_deadline(draft: &StoredCommentDraft) -> Result<(), PrivateCommentFailure> {
    let deadline = draft.retry_not_before_unix_ms;
    if deadline.is_none() && draft.state != CommentState::RateLimited {
        return Ok(());
    }
    let deadline = deadline.ok_or_else(|| {
        PrivateCommentFailure::failed(
            "COMMENT_RETRY_DEADLINE_MISSING",
            "rate-limited private Comment has no retry deadline",
        )
    })?;
    let now = super::crypto::now_unix_ms();
    if deadline <= now {
        return Ok(());
    }
    let remaining_millis = deadline.saturating_sub(now);
    let retry_after_seconds =
        u64::try_from(remaining_millis.saturating_add(999) / 1_000).unwrap_or(u64::MAX);
    Err(PrivateCommentFailure {
        state: CommentState::RateLimited,
        code: draft
            .error_code
            .clone()
            .unwrap_or_else(|| "COMMENT_RATE_LIMITED".to_string()),
        message: "private Comment retry deadline has not elapsed".to_string(),
        retry_after_seconds: Some(retry_after_seconds),
        retry_not_before_unix_ms: Some(deadline),
    })
}

fn comment_plan_expired(draft: &StoredCommentDraft) -> Result<bool, PrivateCommentFailure> {
    let plan = draft
        .plan_bytes
        .as_deref()
        .ok_or_else(|| {
            PrivateCommentFailure::failed(
                "COMMENT_PLAN_INVALID",
                "private Comment retry plan is unavailable",
            )
        })
        .and_then(|bytes| {
            wire::ContentEncryptionPlan::decode(bytes).map_err(|_| {
                PrivateCommentFailure::failed(
                    "COMMENT_PLAN_INVALID",
                    "private Comment retry plan is malformed",
                )
            })
        })?;
    let expires_at = plan.expires_at.as_ref().ok_or_else(|| {
        PrivateCommentFailure::failed(
            "COMMENT_PLAN_INVALID",
            "private Comment retry plan expiry is unavailable",
        )
    })?;
    let expires_at_unix_ms = expires_at
        .seconds
        .checked_mul(1_000)
        .and_then(|millis| millis.checked_add(i64::from(expires_at.nanos) / 1_000_000))
        .ok_or_else(|| {
            PrivateCommentFailure::failed(
                "COMMENT_PLAN_INVALID",
                "private Comment retry plan expiry is invalid",
            )
        })?;
    Ok(expires_at.nanos < 0
        || expires_at.nanos >= 1_000_000_000
        || expires_at_unix_ms <= super::crypto::now_unix_ms())
}

fn comment_requires_reprepare(draft: &StoredCommentDraft) -> Result<bool, PrivateCommentFailure> {
    if draft.publication_state != Some(PublicationState::PendingPublication)
        || draft.request_bytes.is_none()
    {
        return Ok(false);
    }
    if draft.error_code.as_deref().is_some_and(|code| {
        matches!(
            code,
            PRIVATE_CONTENT_STALE_PLAN | "SOCIAL_PRIVATE_EXPIRED_PLAN"
        )
    }) {
        return Ok(true);
    }
    comment_plan_expired(draft)
}

fn comment_needs_recovery(
    store: &SecureContentStore,
    comment: &social::CommentResource,
) -> Result<bool, PrivateCommentFailure> {
    let private = match comment.body.as_ref() {
        Some(social::comment_resource::Body::PrivateContent(private)) => private,
        _ => return Ok(false),
    };
    let payload = private.payload.as_ref().ok_or_else(|| {
        PrivateCommentFailure::failed(
            "COMMENT_INTEGRITY_FAILURE",
            "private Comment payload is unavailable",
        )
    })?;
    let resource = payload.resource.as_ref().ok_or_else(|| {
        PrivateCommentFailure::failed(
            "COMMENT_INTEGRITY_FAILURE",
            "private Comment resource is unavailable",
        )
    })?;
    if store
        .content_root(&resource.content_id, resource.generation)
        .map_err(|error| PrivateCommentFailure::failed("COMMENT_DECRYPT_FAILED", error))?
        .is_some()
    {
        return Ok(false);
    }
    let Some(envelope) = private.viewer_envelope.as_ref() else {
        return Ok(true);
    };
    let binding = envelope.binding.as_ref().ok_or_else(|| {
        PrivateCommentFailure::failed(
            "COMMENT_INTEGRITY_FAILURE",
            "private Comment envelope binding is unavailable",
        )
    })?;
    match envelope.recipient.as_ref() {
        Some(wire::viewer_content_key_envelope::Recipient::Endpoint(_)) => store
            .endpoint_prekey(&binding.recipient_key_id)
            .map(|key| key.is_none())
            .map_err(|error| PrivateCommentFailure::failed("COMMENT_DECRYPT_FAILED", error)),
        Some(wire::viewer_content_key_envelope::Recipient::RecoveryActor(_)) => Ok(true),
        None => Ok(true),
    }
}

fn attach_comment_recovery_envelope(
    comment: &mut social::CommentResource,
    envelope: &wire::ViewerContentKeyEnvelope,
) -> Result<(), PrivateCommentFailure> {
    let private = match comment.body.as_mut() {
        Some(social::comment_resource::Body::PrivateContent(private)) => private,
        _ => {
            return Err(PrivateCommentFailure::failed(
                "COMMENT_INTEGRITY_FAILURE",
                "Comment recovery resource is not private",
            ))
        }
    };
    private.viewer_envelope = Some(envelope.clone());
    Ok(())
}

fn validate_comment_recovery_record(
    post_id: &str,
    comment_ids: &HashSet<String>,
    recoverable: &social::RecoverablePrivateContent,
) -> Result<Option<String>, PrivateCommentFailure> {
    let Some(reference) = recoverable.resource.as_ref() else {
        return Ok(None);
    };
    if !comment_ids.contains(&reference.content_id) {
        return Ok(None);
    }
    let locator = recoverable
        .locator
        .as_ref()
        .and_then(|locator| locator.resource.as_ref());
    let matches = matches!(
        locator,
        Some(social::social_private_content_locator::Resource::Comment(comment))
            if comment.post_id == post_id
                && comment.comment_id == reference.content_id
    );
    if !matches
        || reference.owner_domain != wire::SecureContentOwnerDomain::Social as i32
        || reference.generation == 0
        || recoverable.payload_ciphertext_sha256.len() != 32
        || recoverable.recovery_envelope.is_none()
    {
        return Err(PrivateCommentFailure::failed(
            "COMMENT_INTEGRITY_FAILURE",
            "private Comment recovery record is invalid",
        ));
    }
    Ok(Some(reference.content_id.clone()))
}

fn comment_domain_binding(post_id: &str, reply_to_comment_id: &str) -> Vec<u8> {
    social::PrivateCommentDomainBinding {
        format_version: PAYLOAD_FORMAT_VERSION,
        post_id: post_id.to_string(),
        reply_to_comment_id: reply_to_comment_id.to_string(),
    }
    .encode_to_vec()
}

fn comment_sender_key_requirement(
    expected_post_id: &str,
    expected_comment_id: &str,
    comment: &social::CommentResource,
) -> Result<SenderKeyRequirement, String> {
    let metadata = comment
        .metadata
        .as_ref()
        .ok_or_else(|| "private Comment metadata is unavailable".to_string())?;
    let private = match comment.body.as_ref() {
        Some(social::comment_resource::Body::PrivateContent(private)) => private,
        _ => return Err("Comment resource is not private".to_string()),
    };
    let proof = private
        .verification
        .as_ref()
        .and_then(|verification| verification.commit_proof.as_ref())
        .ok_or_else(|| "private Comment commit proof is unavailable".to_string())?;
    let proof_author = proof
        .author
        .as_ref()
        .ok_or_else(|| "private Comment proof author is unavailable".to_string())?;
    let proof_actor = proof_author
        .actor
        .as_ref()
        .ok_or_else(|| "private Comment proof actor is unavailable".to_string())?;
    let metadata_author = metadata
        .author
        .as_ref()
        .ok_or_else(|| "private Comment metadata author is unavailable".to_string())?;
    let envelope_binding = private
        .viewer_envelope
        .as_ref()
        .and_then(|envelope| envelope.binding.as_ref());
    let committed_at =
        checked_timestamp_millis(proof.committed_at.as_ref(), "private Comment commit time")?;
    let created_at = checked_timestamp_millis(
        metadata.created_at.as_ref(),
        "private Comment creation time",
    )?;
    let updated_at =
        checked_timestamp_millis(metadata.updated_at.as_ref(), "private Comment update time")?;
    if !canonical_identifier(expected_post_id)
        || !canonical_identifier(expected_comment_id)
        || metadata.post_id != expected_post_id
        || metadata.comment_id != expected_comment_id
        || metadata.content_id != expected_comment_id
        || proof.domain_commit_id != expected_comment_id
        || metadata.is_deleted
        || metadata_author != proof_actor
        || proof_actor.ptid.trim().is_empty()
        || proof_author.device_id.trim().is_empty()
        || envelope_binding
            .and_then(|binding| binding.sender.as_ref())
            .is_some_and(|sender| sender != proof_author)
        || envelope_binding
            .is_some_and(|binding| !canonical_identifier(&binding.sender_signing_key_id))
        || created_at != committed_at
        || updated_at < committed_at
    {
        return Err("private Comment resource identity is invalid".to_string());
    }
    Ok(SenderKeyRequirement {
        sender: proof_author.clone(),
        signing_key_id: envelope_binding.map(|binding| binding.sender_signing_key_id.clone()),
        committed_at_unix_ms: committed_at,
    })
}

#[allow(clippy::too_many_arguments)]
fn decrypt_comment_resource(
    session: &crate::secure_content::SecureContentSession,
    store: &crate::secure_content::store::SecureContentStore,
    expected_post_id: &str,
    expected_comment_id: &str,
    comment: &social::CommentResource,
    sender_signing_key: &VerifyingKey,
    supplied_root: Option<ContentKey>,
    expected_recovery_epoch: Option<u64>,
) -> Result<DecryptedPrivateComment, PrivateCommentFailure> {
    let requirement =
        comment_sender_key_requirement(expected_post_id, expected_comment_id, comment)
            .map_err(|error| PrivateCommentFailure::failed("COMMENT_INTEGRITY_FAILURE", error))?;
    if requirement.committed_at_unix_ms
        > current_unix_seconds()
            .saturating_add(CLOCK_SKEW_SECONDS)
            .saturating_mul(1_000)
    {
        return Err(PrivateCommentFailure::failed(
            "COMMENT_INTEGRITY_FAILURE",
            "private Comment commit time is in the future",
        ));
    }
    let metadata = comment.metadata.as_ref().unwrap();
    let metadata_author = metadata.author.as_ref().unwrap();
    let private = match comment.body.as_ref().unwrap() {
        social::comment_resource::Body::PrivateContent(private) => private,
        _ => unreachable!(),
    };
    let payload = private.payload.as_ref().ok_or_else(|| {
        PrivateCommentFailure::failed(
            "COMMENT_INTEGRITY_FAILURE",
            "private Comment payload is unavailable",
        )
    })?;
    let resource = payload.resource.as_ref().ok_or_else(|| {
        PrivateCommentFailure::failed(
            "COMMENT_INTEGRITY_FAILURE",
            "private Comment resource is unavailable",
        )
    })?;
    let verification = private.verification.as_ref().ok_or_else(|| {
        PrivateCommentFailure::failed(
            "COMMENT_INTEGRITY_FAILURE",
            "private Comment verification is unavailable",
        )
    })?;
    let proof = verification.commit_proof.as_ref().ok_or_else(|| {
        PrivateCommentFailure::failed(
            "COMMENT_INTEGRITY_FAILURE",
            "private Comment commit proof is unavailable",
        )
    })?;
    let domain_binding = comment_domain_binding(expected_post_id, &metadata.reply_to_comment_id);
    let domain_binding_hash = Sha256::digest(&domain_binding);
    let object_set_hash = validated_object_descriptor_set_hash(private, resource)
        .map_err(|error| PrivateCommentFailure::failed("COMMENT_INTEGRITY_FAILURE", error))?;
    let empty_hash = Sha256::digest([]);
    let mention_routing_hash = validated_mention_routing_hash(
        verification,
        proof,
        resource,
        payload,
        &requirement.sender,
        requirement.signing_key_id.as_deref(),
        Some(sender_signing_key),
        "private Comment",
    )
    .map_err(|error| PrivateCommentFailure::failed("COMMENT_INTEGRITY_FAILURE", error))?;
    let attestation = verification
        .station_signing_key_attestation
        .as_ref()
        .ok_or_else(|| {
            PrivateCommentFailure::failed(
                "COMMENT_INTEGRITY_FAILURE",
                "private Comment Station attestation is unavailable",
            )
        })?;
    if resource.owner_domain != wire::SecureContentOwnerDomain::Social as i32
        || resource.content_id != expected_comment_id
        || resource.generation == 0
        || payload.format_version != PAYLOAD_FORMAT_VERSION
        || payload.resource.as_ref() != Some(resource)
        || payload.suite != wire::PayloadEncryptionSuite::Aes256Gcm as i32
        || payload.nonce.len() != 12
        || payload.ciphertext.len() < 16
        || payload.ciphertext.len() > 1024 * 1024
        || payload.ciphertext_sha256.len() != 32
        || payload.aad_sha256 != domain_binding_hash.as_slice()
        || Sha256::digest(&payload.ciphertext).as_slice() != payload.ciphertext_sha256
        || proof.format_version != PAYLOAD_FORMAT_VERSION
        || proof.resource.as_ref() != Some(resource)
        || proof.canonical_plan_sha256.len() != 32
        || proof.authorization_snapshot_sha256.len() != 32
        || proof.domain_binding_sha256 != domain_binding_hash.as_slice()
        || proof.encrypted_payload_sha256 != Sha256::digest(payload.encode_to_vec()).as_slice()
        || proof.object_descriptor_set_sha256 != object_set_hash
        || proof.mention_routing_sha256 != mention_routing_hash.as_slice()
        || proof.subtype_authority_sha256 != empty_hash.as_slice()
        || verification.subtype_authority.is_some()
        || private.poll.is_some()
        || !private.objects.is_empty()
        || proof.station_signing_key_id != attestation.proof_signing_key_id
        || !canonical_identifier(&proof.station_signing_key_id)
        || proof.station_signature.len() != 64
    {
        return Err(PrivateCommentFailure::failed(
            "COMMENT_INTEGRITY_FAILURE",
            "private Comment cryptographic binding is invalid",
        ));
    }
    let envelope = private.viewer_envelope.as_ref().ok_or_else(|| {
        PrivateCommentFailure::failed(
            "COMMENT_INTEGRITY_FAILURE",
            "private Comment envelope is unavailable",
        )
    })?;
    verify_viewer_envelope(
        session,
        envelope,
        payload,
        proof,
        resource,
        &object_set_hash,
        sender_signing_key,
        requirement.signing_key_id.as_deref().unwrap_or_default(),
        expected_recovery_epoch,
    )
    .map_err(|error| PrivateCommentFailure::failed("COMMENT_INTEGRITY_FAILURE", error))?;
    let proof_key = verify_station_attestation(session, attestation, current_unix_seconds())
        .map_err(|error| PrivateCommentFailure::failed("COMMENT_INTEGRITY_FAILURE", error))?;
    let mut proof_unsigned = proof.clone();
    let proof_signature =
        Signature::from_slice(&proof_unsigned.station_signature).map_err(|_| {
            PrivateCommentFailure::failed(
                "COMMENT_INTEGRITY_FAILURE",
                "private Comment proof signature is invalid",
            )
        })?;
    proof_unsigned.station_signature.clear();
    proof_key
        .verify(&proof_unsigned.encode_to_vec(), &proof_signature)
        .map_err(|_| {
            PrivateCommentFailure::failed(
                "COMMENT_INTEGRITY_FAILURE",
                "private Comment proof signature is invalid",
            )
        })?;
    let (content_key, consumed_prekey) = if let Some(root) = supplied_root {
        (root, None)
    } else if let Some(root) = store
        .content_root(&resource.content_id, resource.generation)
        .map_err(|error| PrivateCommentFailure::failed("COMMENT_DECRYPT_FAILED", error))?
    {
        (ContentKey::from_bytes(root), None)
    } else {
        let binding = envelope.binding.as_ref().ok_or_else(|| {
            PrivateCommentFailure::failed(
                "COMMENT_DECRYPT_FAILED",
                "private Comment envelope binding is unavailable",
            )
        })?;
        let endpoint = match envelope.recipient.as_ref() {
            Some(wire::viewer_content_key_envelope::Recipient::Endpoint(endpoint)) => endpoint,
            _ => {
                return Err(PrivateCommentFailure::failed(
                    "COMMENT_DECRYPT_FAILED",
                    "private Comment endpoint key is unavailable",
                ))
            }
        };
        if endpoint.actor.as_ref().map(|actor| actor.ptid.as_str())
            != Some(session.key.actor_ptid.as_str())
            || endpoint.device_id != session.key.device_id
        {
            return Err(PrivateCommentFailure::failed(
                "COMMENT_INTEGRITY_FAILURE",
                "private Comment envelope targets another endpoint",
            ));
        }
        let stored = store
            .endpoint_prekey(&binding.recipient_key_id)
            .map_err(|error| PrivateCommentFailure::failed("COMMENT_DECRYPT_FAILED", error))?
            .ok_or_else(|| {
                PrivateCommentFailure::failed(
                    "COMMENT_DECRYPT_FAILED",
                    "private Comment endpoint key is unavailable",
                )
            })?;
        if binding.recipient_key_kind != wire::ContentPreKeyKind::ContentPrekeyKindEndpoint as i32
            || envelope.principal_epoch != stored.pool_epoch
        {
            return Err(PrivateCommentFailure::failed(
                "COMMENT_INTEGRITY_FAILURE",
                "private Comment endpoint key binding is invalid",
            ));
        }
        let key = open_content_key(
            &ContentPreKeyPrivate::from_bytes(stored.private_key),
            &binding.encode_to_vec(),
            &SealedContentKey {
                encapsulated_key: envelope.hpke_encapsulated_key.clone(),
                ciphertext: envelope.hpke_ciphertext.clone(),
            },
        )
        .map_err(|error| PrivateCommentFailure::failed("COMMENT_DECRYPT_FAILED", error))?;
        (key, Some(stored.key_id))
    };
    let authorization_snapshot: [u8; 32] = proof
        .authorization_snapshot_sha256
        .as_slice()
        .try_into()
        .map_err(|_| {
            PrivateCommentFailure::failed(
                "COMMENT_INTEGRITY_FAILURE",
                "private Comment authorization snapshot is invalid",
            )
        })?;
    let payload_key = derive_payload_key(
        content_key.as_bytes(),
        &authorization_snapshot,
        &PayloadKeyContext {
            protocol_version: payload.format_version,
            owner_domain: resource.owner_domain as u32,
            content_id: &resource.content_id,
            generation: resource.generation,
            payload_kind: PRIVATE_COMMENT_PAYLOAD_KIND,
        },
    )
    .map_err(|error| PrivateCommentFailure::failed("COMMENT_DECRYPT_FAILED", error))?;
    let plaintext =
        decrypt_payload(
            &payload_key,
            &CoreEncryptedPayload {
                nonce: payload.nonce.as_slice().try_into().map_err(|_| {
                    PrivateCommentFailure::failed(
                        "COMMENT_INTEGRITY_FAILURE",
                        "private Comment nonce is invalid",
                    )
                })?,
                ciphertext: payload.ciphertext.clone(),
                ciphertext_sha256: payload.ciphertext_sha256.as_slice().try_into().map_err(
                    |_| {
                        PrivateCommentFailure::failed(
                            "COMMENT_INTEGRITY_FAILURE",
                            "private Comment ciphertext hash is invalid",
                        )
                    },
                )?,
                aad_sha256: payload.aad_sha256.as_slice().try_into().map_err(|_| {
                    PrivateCommentFailure::failed(
                        "COMMENT_INTEGRITY_FAILURE",
                        "private Comment AAD hash is invalid",
                    )
                })?,
            },
            &domain_binding,
        )
        .map_err(|error| PrivateCommentFailure::failed("COMMENT_DECRYPT_FAILED", error))?;
    let decoded = social::PrivateCommentContent::decode(plaintext.as_slice()).map_err(|_| {
        PrivateCommentFailure::failed(
            "COMMENT_DECRYPT_FAILED",
            "private Comment plaintext is malformed",
        )
    })?;
    if decoded.format_version != PAYLOAD_FORMAT_VERSION
        || decoded.content_id != expected_comment_id
        || decoded.parent_content_id != expected_post_id
        || decoded.text.trim().is_empty()
    {
        return Err(PrivateCommentFailure::failed(
            "COMMENT_INTEGRITY_FAILURE",
            "private Comment plaintext binding is invalid",
        ));
    }
    let mentions = verify_decrypted_mentions(
        &decoded.text,
        &decoded.mentions,
        &decoded.mention_commitment_salt,
        verification.mention_routing.as_ref(),
        "private Comment",
    )
    .map_err(|error| PrivateCommentFailure::failed("COMMENT_INTEGRITY_FAILURE", error))?
    .into_iter()
    .map(|mention| PrivateMentionProjection {
        actor_ptid: mention.actor_ptid,
        offset: mention.offset,
        length: mention.length,
        display: mention.display,
    })
    .collect();
    Ok(DecryptedPrivateComment {
        projection: PrivateCommentProjection {
            comment_id: metadata.comment_id.clone(),
            content_id: metadata.content_id.clone(),
            generation: resource.generation.to_string(),
            post_id: metadata.post_id.clone(),
            reply_to_comment_id: metadata.reply_to_comment_id.clone(),
            author_ptid: metadata_author.ptid.clone(),
            author_acct: (!metadata_author.acct.is_empty()).then(|| metadata_author.acct.clone()),
            state: CommentState::Posted.as_str().to_string(),
            text: Some(decoded.text),
            mentions,
            reactions_count: metadata.reactions_count,
            replies_count: metadata.replies_count,
            created_at_millis: timestamp_millis(metadata.created_at.as_ref()),
            updated_at_millis: timestamp_millis(metadata.updated_at.as_ref()),
        },
        content_key,
        consumed_prekey,
    })
}

fn timestamp_millis(value: Option<&prost_types::Timestamp>) -> Option<i64> {
    value.and_then(|timestamp| {
        timestamp
            .seconds
            .checked_mul(1_000)
            .and_then(|millis| millis.checked_add(i64::from(timestamp.nanos) / 1_000_000))
    })
}

impl From<PrivateCommentFailure> for String {
    fn from(error: PrivateCommentFailure) -> Self {
        error.message
    }
}

impl From<String> for PrivateCommentFailure {
    fn from(message: String) -> Self {
        Self::failed("COMMENT_NATIVE_FAILED", message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secure_content::station_trust::TrustedStationSigningKey;
    use crate::secure_content::{SecureContentSession, SecureContentSessionKey};
    use ed25519_dalek::{Signer, SigningKey};
    use std::sync::Arc;

    fn session() -> SecureContentSession {
        let station_key = SigningKey::from_bytes(&[8; 32]);
        SecureContentSession::new(
            SecureContentSessionKey {
                station_peer_id: "station-1".to_string(),
                actor_ptid: "ptid:alice".to_string(),
                device_id: "device-1".to_string(),
                jwt_session_id: "session-1".to_string(),
                window_label: "main".to_string(),
                session_generation: 0,
            },
            "account-1".to_string(),
            "https://station.test".to_string(),
            "token".to_string(),
            "device-key-1".to_string(),
            1,
            SigningKey::from_bytes(&[7; 32]),
            TrustedStationSigningKey {
                key_id: "station-key-current".to_string(),
                verifying_key: station_key.verifying_key(),
            },
        )
    }

    #[test]
    fn remote_private_comment_uses_source_verified_author_key() {
        let signing_key = SigningKey::from_bytes(&[6; 32]);
        let sender = actor::ActorDeviceRef {
            actor: Some(actor::ActorRef {
                ptid: "ptid:bob".to_string(),
                acct: "bob@station.remote".to_string(),
                kind: actor::ActorKind::Person as i32,
            }),
            device_id: "bob-device".to_string(),
        };
        let signing_bytes = b"remote Comment envelope";
        let signature = signing_key.sign(signing_bytes).to_bytes().to_vec();
        let resource = social::CommentResource {
            body: Some(social::comment_resource::Body::PrivateContent(
                social::PrivateContentAccess {
                    verification: Some(social::PrivateContentVerification {
                        receiver_verified_sender_signing_key: Some(
                            actor::VerifiedActorDeviceSigningKey {
                                actor_ptid: "ptid:bob".to_string(),
                                actor_device_id: "bob-device".to_string(),
                                home_station_peer_id: "station-remote".to_string(),
                                signing_key_id: "bob-signing-key".to_string(),
                                ed25519_public_key: signing_key.verifying_key().to_bytes().to_vec(),
                                profile_version: 1,
                                verification_source:
                                    actor::ActorSigningKeyVerificationSource::VerifiedProfile as i32,
                                valid_from_unix_ms: 1_000,
                                revoked_at_unix_ms: 0,
                            },
                        ),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )),
            ..Default::default()
        };

        assert_eq!(
            receiver_verified_comment_sender_key(&resource, &sender, "bob-signing-key", 2_000,)
                .unwrap(),
            Some(signing_key.verifying_key()),
        );
        assert!(
            receiver_verified_comment_sender_key(&resource, &sender, "bob-signing-key", 2_000,)
                .unwrap()
                .unwrap()
                .verify(signing_bytes, &Signature::from_slice(&signature).unwrap())
                .is_ok()
        );
    }

    fn comment_draft(draft_id: &str, session_generation: u64) -> StoredCommentDraft {
        StoredCommentDraft {
            draft_id: draft_id.to_string(),
            draft_revision: 1,
            post_id: "post-1".to_string(),
            content_id: format!("{draft_id}-content"),
            generation: 0,
            reply_to_comment_id: String::new(),
            text: "private comment".to_string(),
            mention_intent_json: "[]".to_string(),
            mention_commitment_salt: None,
            intent_sha256: [3; 32],
            prepare_command_id: format!("{draft_id}-prepare"),
            submit_command_id: None,
            plan_bytes: None,
            request_bytes: None,
            request_sha256: None,
            root_key: None,
            publication_state: None,
            session_generation,
            comment_id: None,
            state: CommentState::Editing,
            error_code: None,
            retry_after_seconds: None,
            retry_not_before_unix_ms: None,
        }
    }

    fn recoverable_comment(post_id: &str, comment_id: &str) -> social::RecoverablePrivateContent {
        social::RecoverablePrivateContent {
            resource: Some(wire::SecureResourceRef {
                owner_domain: wire::SecureContentOwnerDomain::Social as i32,
                content_id: comment_id.to_string(),
                generation: 3,
            }),
            locator: Some(social::SocialPrivateContentLocator {
                resource: Some(social::social_private_content_locator::Resource::Comment(
                    social::PrivateCommentLocator {
                        post_id: post_id.to_string(),
                        comment_id: comment_id.to_string(),
                    },
                )),
            }),
            recovery_envelope: Some(wire::ViewerContentKeyEnvelope {
                principal_epoch: 7,
                ..Default::default()
            }),
            payload_ciphertext_sha256: vec![9; 32],
        }
    }

    #[test]
    fn comment_recovery_requires_exact_locator_and_attaches_recovery_envelope() {
        let comment_ids = HashSet::from(["comment-1".to_string()]);
        let recoverable = recoverable_comment("post-1", "comment-1");

        assert_eq!(
            validate_comment_recovery_record("post-1", &comment_ids, &recoverable).unwrap(),
            Some("comment-1".to_string())
        );

        let mut resource = social::CommentResource {
            body: Some(social::comment_resource::Body::PrivateContent(
                social::PrivateContentAccess::default(),
            )),
            ..Default::default()
        };
        attach_comment_recovery_envelope(
            &mut resource,
            recoverable.recovery_envelope.as_ref().unwrap(),
        )
        .unwrap();
        assert_eq!(
            resource
                .body
                .as_ref()
                .and_then(|body| match body {
                    social::comment_resource::Body::PrivateContent(private) => {
                        private.viewer_envelope.as_ref()
                    }
                    _ => None,
                })
                .map(|envelope| envelope.principal_epoch),
            Some(7)
        );
    }

    #[test]
    fn comment_recovery_rejects_malformed_matching_records() {
        let comment_ids = HashSet::from(["comment-1".to_string()]);
        let mut wrong_parent = recoverable_comment("post-other", "comment-1");
        assert_eq!(
            validate_comment_recovery_record("post-1", &comment_ids, &wrong_parent)
                .unwrap_err()
                .code,
            "COMMENT_INTEGRITY_FAILURE"
        );

        wrong_parent = recoverable_comment("post-1", "comment-1");
        wrong_parent.payload_ciphertext_sha256.pop();
        assert_eq!(
            validate_comment_recovery_record("post-1", &comment_ids, &wrong_parent)
                .unwrap_err()
                .code,
            "COMMENT_INTEGRITY_FAILURE"
        );

        let mut missing_envelope = recoverable_comment("post-1", "comment-1");
        missing_envelope.recovery_envelope = None;
        assert_eq!(
            validate_comment_recovery_record("post-1", &comment_ids, &missing_envelope)
                .unwrap_err()
                .code,
            "COMMENT_INTEGRITY_FAILURE"
        );
    }

    #[test]
    fn generic_submit_conflict_is_terminal_without_fabricating_parent_loss() {
        let error = NativeTransportError {
            http_status: Some(409),
            stable_code: crate::model::error::ErrorCode::InvalidRequest as i32,
            retry_after_seconds: None,
            disposition: NativeErrorDisposition::Terminal,
            message: "SOCIAL_PRIVATE_CONFLICT".to_string(),
        };
        assert_eq!(
            submit_failure_publication_state(&error),
            PublicationState::Terminal
        );
        let failure = PrivateCommentFailure::from_submit_transport(error);

        assert_eq!(failure.state, CommentState::Failed);

        for code in [PRIVATE_CONTENT_STALE_PLAN, "SOCIAL_PRIVATE_EXPIRED_PLAN"] {
            let retryable_plan = NativeTransportError {
                http_status: Some(409),
                stable_code: crate::model::error::ErrorCode::InvalidRequest as i32,
                retry_after_seconds: None,
                disposition: NativeErrorDisposition::Terminal,
                message: code.to_string(),
            };
            assert_eq!(
                submit_failure_publication_state(&retryable_plan),
                PublicationState::PendingPublication
            );
        }
    }

    #[test]
    fn submit_transport_disposition_controls_retry_state() {
        let retryable = NativeTransportError {
            http_status: Some(429),
            stable_code: crate::model::error::ErrorCode::InvalidRequest as i32,
            retry_after_seconds: Some(3_599),
            disposition: NativeErrorDisposition::Retryable,
            message: "ERROR_CODE_INVALID_REQUEST".to_string(),
        };
        assert_eq!(
            submit_failure_publication_state(&retryable),
            PublicationState::PendingPublication
        );
        let unknown = NativeTransportError {
            http_status: Some(503),
            stable_code: crate::model::error::ErrorCode::InternalServerError as i32,
            retry_after_seconds: None,
            disposition: NativeErrorDisposition::UnknownCommit,
            message: "ERROR_CODE_INTERNAL_SERVER_ERROR".to_string(),
        };
        assert_eq!(
            submit_failure_publication_state(&unknown),
            PublicationState::UnknownCommit
        );
    }

    #[test]
    fn retry_deadlines_cover_publication_and_committed_readback() {
        let now = crate::social::crypto::now_unix_ms();
        let mut draft = comment_draft("draft-rate-limit", 1);
        draft.state = CommentState::RateLimited;
        draft.retry_not_before_unix_ms = Some(now + 60_000);
        assert_eq!(
            enforce_comment_retry_deadline(&draft).unwrap_err().code,
            "COMMENT_RATE_LIMITED"
        );

        draft.state = CommentState::Failed;
        draft.publication_state = Some(PublicationState::CommittedPendingReadback);
        draft.error_code = Some(COMMENT_READBACK_PENDING.to_string());
        assert_eq!(
            enforce_comment_retry_deadline(&draft).unwrap_err().code,
            COMMENT_READBACK_PENDING
        );

        draft.retry_not_before_unix_ms = Some(now - 1);
        assert!(enforce_comment_retry_deadline(&draft).is_ok());
    }

    #[test]
    fn expired_comment_plan_requires_fresh_encryption_material() {
        let now_seconds = crate::social::crypto::now_unix_ms() / 1_000;
        let mut draft = comment_draft("draft-expired-plan", 1);
        draft.publication_state = Some(PublicationState::PendingPublication);
        draft.state = CommentState::Submitting;
        draft.request_bytes = Some(b"persisted-request".to_vec());
        draft.plan_bytes = Some(
            wire::ContentEncryptionPlan {
                expires_at: Some(prost_types::Timestamp {
                    seconds: now_seconds - 1,
                    nanos: 0,
                }),
                ..Default::default()
            }
            .encode_to_vec(),
        );
        assert!(comment_plan_expired(&draft).unwrap());
        assert!(comment_requires_reprepare(&draft).unwrap());

        draft.plan_bytes = Some(
            wire::ContentEncryptionPlan {
                expires_at: Some(prost_types::Timestamp {
                    seconds: now_seconds + 60,
                    nanos: 0,
                }),
                ..Default::default()
            }
            .encode_to_vec(),
        );
        assert!(!comment_plan_expired(&draft).unwrap());
        assert!(!comment_requires_reprepare(&draft).unwrap());

        draft.state = CommentState::Failed;
        draft.error_code = Some(PRIVATE_CONTENT_STALE_PLAN.to_string());
        assert!(comment_requires_reprepare(&draft).unwrap());

        draft.publication_state = Some(PublicationState::UnknownCommit);
        assert!(!comment_requires_reprepare(&draft).unwrap());
    }

    #[test]
    fn retry_deadline_rejects_prepare_before_prekey_transport() {
        let supervisor = SecureContentSupervisor::new();
        let store = Arc::new(SecureContentStore::in_memory().unwrap());
        let lease = supervisor
            .activate_with_store_for_test(session(), 1, store.clone())
            .unwrap();
        let orchestrator = PrivateCommentOrchestrator {
            supervisor: &supervisor,
            transport: SecureContentTransport::new(lease.session.clone()).unwrap(),
            lease,
        };
        let intent = PrivateCommentIntent {
            actor_ptid: "ptid:alice".to_string(),
            renderer_generation: 1,
            draft_id: "draft-rate-limited-prepare".to_string(),
            draft_revision: 1,
            post_id: "post-1".to_string(),
            reply_to_comment_id: String::new(),
            text: "retained private comment".to_string(),
            mentions: Vec::new(),
        };
        orchestrator.stage(&intent).unwrap();
        store
            .set_comment_draft_state(
                &intent.draft_id,
                intent.draft_revision,
                CommentState::RateLimited,
                Some("COMMENT_RATE_LIMITED"),
                Some(60),
            )
            .unwrap();

        let failure = orchestrator.prepare(&intent).unwrap_err();

        assert_eq!(failure.code, "COMMENT_RATE_LIMITED");
        assert!(failure.retry_not_before_unix_ms.is_some());
    }

    #[test]
    fn comment_draft_preserves_typed_mentions_and_first_random_salt() {
        let supervisor = SecureContentSupervisor::new();
        let store = Arc::new(SecureContentStore::in_memory().unwrap());
        let lease = supervisor
            .activate_with_store_for_test(session(), 1, store.clone())
            .unwrap();
        let orchestrator = PrivateCommentOrchestrator {
            supervisor: &supervisor,
            transport: SecureContentTransport::new(lease.session.clone()).unwrap(),
            lease,
        };
        let intent = PrivateCommentIntent {
            actor_ptid: "ptid:alice".to_string(),
            renderer_generation: 1,
            draft_id: "draft-mentioned-comment".to_string(),
            draft_revision: 1,
            post_id: "post-1".to_string(),
            reply_to_comment_id: String::new(),
            text: "hello Bob".to_string(),
            mentions: vec![PrivateMentionIntent {
                actor_ptid: "ptid:bob".to_string(),
                offset: 6,
                length: 3,
                display: "Bob".to_string(),
            }],
        };

        let first = orchestrator.stage(&intent).unwrap();
        let first_persisted = store
            .comment_draft(&intent.draft_id, intent.draft_revision)
            .unwrap()
            .unwrap();
        let replay = orchestrator.stage(&intent).unwrap();
        let replay_persisted = store
            .comment_draft(&intent.draft_id, intent.draft_revision)
            .unwrap()
            .unwrap();

        assert_eq!(first.mentions, intent.mentions);
        assert_eq!(replay.mentions, intent.mentions);
        assert_eq!(
            first_persisted.mention_commitment_salt,
            replay_persisted.mention_commitment_salt,
        );
        assert!(first_persisted.mention_commitment_salt.is_some());

        let mut conflicting = intent;
        conflicting.mentions[0].actor_ptid = "ptid:eve".to_string();
        assert_eq!(
            orchestrator.stage(&conflicting).unwrap_err().code,
            "COMMENT_DRAFT_FAILED",
        );
    }

    #[test]
    fn known_commit_readback_failure_never_becomes_retryable_publication() {
        let supervisor = SecureContentSupervisor::new();
        let store = Arc::new(SecureContentStore::in_memory().unwrap());
        let lease = supervisor
            .activate_with_store_for_test(session(), 1, store.clone())
            .unwrap();
        let session_generation = lease.session.key.session_generation;
        let draft = comment_draft("draft-post-submit", session_generation);
        store.reserve_comment_draft(&draft).unwrap();
        let request = b"encrypted-comment-request";
        let request_sha256: [u8; 32] = Sha256::digest(request).into();
        store
            .persist_comment_submission(
                &draft.draft_id,
                draft.draft_revision,
                1,
                "comment-submit-1",
                b"comment-plan",
                request,
                &request_sha256,
                &[9; 32],
                session_generation,
            )
            .unwrap();
        let in_flight = store
            .acquire_comment_submission(&draft.draft_id, draft.draft_revision, session_generation)
            .unwrap();
        let orchestrator = PrivateCommentOrchestrator {
            supervisor: &supervisor,
            transport: SecureContentTransport::new(lease.session.clone()).unwrap(),
            lease,
        };
        let failure = PrivateCommentFailure::failed("COMMENT_READBACK_FAILED", "readback failed");

        let committed = orchestrator.mark_comment_committed(&in_flight).unwrap();
        orchestrator
            .persist_readback_failure(&committed, &failure)
            .unwrap();

        let persisted = store
            .comment_draft(&draft.draft_id, draft.draft_revision)
            .unwrap()
            .unwrap();
        assert_eq!(
            persisted.publication_state,
            Some(PublicationState::CommittedPendingReadback)
        );
        assert_eq!(persisted.state, CommentState::Failed);
        assert!(persisted.text.is_empty());
        assert!(store
            .acquire_comment_submission(&draft.draft_id, draft.draft_revision, session_generation,)
            .is_err());
    }

    #[test]
    fn parent_unavailable_terminates_draft_and_clears_cached_thread() {
        let supervisor = SecureContentSupervisor::new();
        let store = Arc::new(SecureContentStore::in_memory().unwrap());
        let lease = supervisor
            .activate_with_store_for_test(session(), 1, store.clone())
            .unwrap();
        let draft = comment_draft("draft-parent-gone", lease.session.key.session_generation);
        store.reserve_comment_draft(&draft).unwrap();
        let request = b"encrypted-comment-request";
        let request_sha256: [u8; 32] = Sha256::digest(request).into();
        store
            .persist_comment_submission(
                &draft.draft_id,
                draft.draft_revision,
                1,
                "comment-submit-parent-gone",
                b"comment-plan",
                request,
                &request_sha256,
                &[9; 32],
                lease.session.key.session_generation,
            )
            .unwrap();
        let in_flight = store
            .acquire_comment_submission(
                &draft.draft_id,
                draft.draft_revision,
                lease.session.key.session_generation,
            )
            .unwrap();
        store
            .commit_comment_root(
                "cached-content",
                1,
                &draft.post_id,
                "cached-comment",
                &[7; 32],
                None,
                b"{\"cached\":true}",
            )
            .unwrap();
        let orchestrator = PrivateCommentOrchestrator {
            supervisor: &supervisor,
            transport: SecureContentTransport::new(lease.session.clone()).unwrap(),
            lease,
        };
        let failure = PrivateCommentFailure {
            state: CommentState::ParentUnavailable,
            code: "ERROR_CODE_INVALID_REQUEST".to_string(),
            message: "parent unavailable".to_string(),
            retry_after_seconds: None,
            retry_not_before_unix_ms: None,
        };

        orchestrator
            .persist_submit_failure(&in_flight, &failure, PublicationState::Terminal)
            .unwrap();

        let persisted = store
            .comment_draft(&draft.draft_id, draft.draft_revision)
            .unwrap()
            .unwrap();
        assert_eq!(
            persisted.publication_state,
            Some(PublicationState::Terminal)
        );
        assert_eq!(persisted.state, CommentState::ParentUnavailable);
        assert!(store
            .comment_projection(&draft.post_id, "cached-comment")
            .unwrap()
            .is_none());
    }

    #[test]
    fn stale_session_cannot_mutate_comment_draft() {
        let supervisor = SecureContentSupervisor::new();
        let store = Arc::new(SecureContentStore::in_memory().unwrap());
        let lease = supervisor
            .activate_with_store_for_test(session(), 1, store.clone())
            .unwrap();
        let draft = comment_draft("draft-stale", lease.session.key.session_generation);
        store.reserve_comment_draft(&draft).unwrap();
        let orchestrator = PrivateCommentOrchestrator {
            supervisor: &supervisor,
            transport: SecureContentTransport::new(lease.session.clone()).unwrap(),
            lease,
        };
        let mut replacement_session = session();
        replacement_session.key.jwt_session_id = "session-2".to_string();
        supervisor
            .activate_with_store_for_test(
                replacement_session,
                2,
                Arc::new(SecureContentStore::in_memory().unwrap()),
            )
            .unwrap();
        let intent = PrivateCommentIntent {
            actor_ptid: "ptid:alice".to_string(),
            renderer_generation: 1,
            draft_id: draft.draft_id.clone(),
            draft_revision: draft.draft_revision,
            post_id: draft.post_id.clone(),
            reply_to_comment_id: String::new(),
            text: draft.text.clone(),
            mentions: Vec::new(),
        };

        let failure = orchestrator
            .set_state(&intent, CommentState::Encrypting, None, None)
            .unwrap_err();

        assert_eq!(failure.code, "COMMENT_SESSION_STALE");
        assert_eq!(
            store
                .comment_draft(&draft.draft_id, draft.draft_revision)
                .unwrap()
                .unwrap()
                .state,
            CommentState::Editing
        );
    }

    #[test]
    fn conflicting_replay_does_not_poison_the_retained_draft() {
        let supervisor = SecureContentSupervisor::new();
        let store = Arc::new(SecureContentStore::in_memory().unwrap());
        let lease = supervisor
            .activate_with_store_for_test(session(), 1, store.clone())
            .unwrap();
        let draft = comment_draft("draft-conflict", lease.session.key.session_generation);
        store.reserve_comment_draft(&draft).unwrap();
        let orchestrator = PrivateCommentOrchestrator {
            supervisor: &supervisor,
            transport: SecureContentTransport::new(lease.session.clone()).unwrap(),
            lease,
        };
        let conflicting_intent = PrivateCommentIntent {
            actor_ptid: "ptid:alice".to_string(),
            renderer_generation: 1,
            draft_id: draft.draft_id.clone(),
            draft_revision: draft.draft_revision,
            post_id: draft.post_id.clone(),
            reply_to_comment_id: String::new(),
            text: "different private comment".to_string(),
            mentions: Vec::new(),
        };
        let failure = PrivateCommentFailure::failed(
            "COMMENT_DRAFT_FAILED",
            "private Comment draft replay conflict",
        );

        orchestrator
            .persist_failure(&conflicting_intent, &failure)
            .unwrap();

        assert_eq!(
            store
                .comment_draft(&draft.draft_id, draft.draft_revision)
                .unwrap()
                .unwrap()
                .state,
            CommentState::Editing
        );
    }
}
