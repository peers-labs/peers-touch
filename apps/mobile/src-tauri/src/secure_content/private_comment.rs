use std::collections::{HashMap, HashSet};

use ed25519_dalek::{Signature, Verifier};
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
use ulid::Ulid;

use crate::secure_content::adapter::seal_envelopes;
use crate::secure_content::private_mention::{
    build_signed_mention_routing, canonical_private_mentions, validated_mention_routing_hash,
    verify_decrypted_mentions, PrivateMentionIntent,
};
use crate::secure_content::proto::{
    actor::v1 as actor, secure_content::v1 as wire, social::v1 as social,
};
use crate::secure_content::receiver::{
    canonical_identifier, checked_timestamp_millis, current_unix_seconds,
    object_descriptor_set_hash, purges_private_material, terminal_projection_for_transport_error,
    verify_recovery_viewer_envelope, verify_station_attestation, verify_viewer_envelope,
    PrivateMentionProjection,
};
use crate::secure_content::recovery::open_recovery_content_key;
use crate::secure_content::store::{CommentState, PrivateSocialStore, StoredCommentDraft};
use crate::secure_content::transport::{NativeSocialTransport, TransportError};
use crate::secure_content::NativeSocialSession;

const COMMENT_PAYLOAD_KIND: u32 = social::PrivateMomentKind::Text as u32;
const CLOCK_SKEW_SECONDS: i64 = 60;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivateCommentIntent {
    pub draft_id: String,
    pub draft_revision: u64,
    pub post_id: String,
    #[serde(default)]
    pub reply_to_comment_id: String,
    pub text: String,
    #[serde(default)]
    pub mentions: Vec<PrivateMentionIntent>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateCommentProjection {
    pub comment_id: String,
    pub content_id: String,
    pub generation: String,
    pub post_id: String,
    pub reply_to_comment_id: String,
    pub author_ptid: String,
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
    fn encode(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(self).map_err(|error| error.to_string())
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        serde_json::from_slice(bytes).map_err(|error| error.to_string())
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
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
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateCommentSubmitResult {
    pub draft: PrivateCommentDraftProjection,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<PrivateCommentProjection>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateCommentPage {
    pub post_id: String,
    pub comments: Vec<PrivateCommentProjection>,
    pub next_cursor: String,
    pub has_more: bool,
}

struct DecryptedPrivateComment {
    projection: PrivateCommentProjection,
    content_key: ContentKey,
    consumed_prekey_id: Option<String>,
}

struct CommentRecoveryTarget {
    resource: wire::SecureResourceRef,
    payload_ciphertext_sha256: Vec<u8>,
}

pub fn submit(
    session: &NativeSocialSession,
    store: &PrivateSocialStore,
    transport: &NativeSocialTransport,
    session_generation: u64,
    intent: &PrivateCommentIntent,
) -> Result<PrivateCommentSubmitResult, String> {
    validate_intent(intent)?;
    let intent_sha256 = intent_hash(intent)?;
    let mut salt = (!intent.mentions.is_empty()).then_some([0_u8; 32]);
    if let Some(value) = salt.as_mut() {
        OsRng.fill_bytes(value);
    }
    let candidate = StoredCommentDraft {
        draft_id: intent.draft_id.clone(),
        draft_revision: intent.draft_revision,
        post_id: intent.post_id.clone(),
        reply_to_comment_id: intent.reply_to_comment_id.clone(),
        text: intent.text.clone(),
        mention_intent_json: serde_json::to_string(&intent.mentions)
            .map_err(|error| error.to_string())?,
        mention_commitment_salt: salt,
        intent_sha256,
        content_id: Ulid::new().to_string(),
        prepare_command_id: bounded_command_id(
            "mobile-comment-prepare",
            &intent.draft_id,
            intent.draft_revision,
        ),
        submit_command_id: None,
        request_bytes: None,
        request_sha256: None,
        root_key: None,
        generation: 0,
        state: CommentState::Editing,
        comment_id: None,
        error_code: None,
        retry_after_seconds: None,
    };
    let mut stored = store.reserve_comment_draft(&candidate)?;
    if stored.state == CommentState::Posted {
        let comment_id = stored
            .comment_id
            .as_deref()
            .ok_or_else(|| "posted private Comment has no identity".to_string())?;
        let comment = store
            .comment_projection(comment_id)?
            .map(|bytes| PrivateCommentProjection::decode(&bytes))
            .transpose()?;
        return Ok(PrivateCommentSubmitResult {
            draft: draft_projection(&stored)?,
            comment,
        });
    }
    if stored.request_bytes.is_none() {
        let plan = transport
            .prepare_private_comment(
                &stored.post_id,
                &social::PreparePrivateCommentRequest {
                    post_id: stored.post_id.clone(),
                    comment_content_id: stored.content_id.clone(),
                    reply_to_comment_id: stored.reply_to_comment_id.clone(),
                    object_count: 0,
                    command_id: stored.prepare_command_id.clone(),
                },
            )
            .map_err(|error| finish_failure(store, &stored, error))?
            .plan
            .ok_or_else(|| "private Comment prepare response omitted its plan".to_string())?;
        let domain_binding = comment_domain_binding(&stored.post_id, &stored.reply_to_comment_id);
        validate_comment_plan(session, &plan, &stored.content_id, &domain_binding)?;
        let resource = plan
            .resource
            .clone()
            .ok_or_else(|| "private Comment plan resource is unavailable".to_string())?;
        let authorization_snapshot: [u8; 32] = plan
            .authorization_snapshot_sha256
            .as_slice()
            .try_into()
            .map_err(|_| "private Comment authorization snapshot is invalid".to_string())?;
        let root = ContentKey::generate();
        let mentions =
            canonical_private_mentions(&stored.text, &intent.mentions, "private Comment")?;
        let plaintext = social::PrivateCommentContent {
            format_version: PAYLOAD_FORMAT_VERSION,
            content_id: stored.content_id.clone(),
            parent_content_id: stored.post_id.clone(),
            text: stored.text.clone(),
            mentions: mentions.clone(),
            mention_commitment_salt: stored
                .mention_commitment_salt
                .map(|value| value.to_vec())
                .unwrap_or_default(),
        }
        .encode_to_vec();
        let payload_key = derive_payload_key(
            root.as_bytes(),
            &authorization_snapshot,
            &PayloadKeyContext {
                protocol_version: PAYLOAD_FORMAT_VERSION,
                owner_domain: resource.owner_domain as u32,
                content_id: &resource.content_id,
                generation: resource.generation,
                payload_kind: COMMENT_PAYLOAD_KIND,
            },
        )?;
        let encrypted = encrypt_payload(&payload_key, &plaintext, &domain_binding)?;
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
            session,
            "private Comment",
        )?;
        let envelopes = seal_envelopes(
            session,
            &plan,
            &payload,
            object_descriptor_set_hash(&[])?,
            &root,
        )?;
        let request = social::SubmitPrivateCommentRequest {
            plan: Some(plan),
            payload: Some(payload),
            envelopes,
            objects: Vec::new(),
            mention_routing,
            command_id: bounded_command_id(
                "mobile-comment-submit",
                &intent.draft_id,
                intent.draft_revision,
            ),
            post_id: stored.post_id.clone(),
        };
        let request_bytes = request.encode_to_vec();
        let request_sha256: [u8; 32] = Sha256::digest(&request_bytes).into();
        store.persist_comment_request(
            &stored.draft_id,
            stored.draft_revision,
            resource.generation,
            &request.command_id,
            &request_bytes,
            &request_sha256,
            root.as_bytes(),
        )?;
        stored = store
            .comment_draft(&stored.draft_id, stored.draft_revision)?
            .ok_or_else(|| "prepared private Comment disappeared".to_string())?;
    }
    let request = social::SubmitPrivateCommentRequest::decode(
        stored
            .request_bytes
            .as_deref()
            .ok_or_else(|| "private Comment request is unavailable".to_string())?,
    )
    .map_err(|_| "private Comment request is malformed".to_string())?;
    let response = transport
        .submit_private_comment(&stored.post_id, &request)
        .map_err(|error| finish_failure(store, &stored, error))?;
    let comment = response
        .comment
        .as_ref()
        .ok_or_else(|| "private Comment submit response omitted Comment".to_string())?;
    let root = stored
        .root_key
        .map(ContentKey::from_bytes)
        .ok_or_else(|| "private Comment root key is unavailable".to_string())?;
    let decrypted = decrypt_comment(
        session,
        store,
        transport,
        &stored.post_id,
        comment,
        Some(root),
        None,
    )?;
    store.commit_comment_receiver_projection(
        session_generation,
        &decrypted.projection.content_id,
        stored.generation,
        &decrypted.projection.post_id,
        &decrypted.projection.comment_id,
        decrypted.content_key.as_bytes(),
        decrypted.consumed_prekey_id.as_deref(),
        &decrypted.projection.encode()?,
    )?;
    store.finish_comment(
        &stored.draft_id,
        stored.draft_revision,
        CommentState::Posted,
        Some(&decrypted.projection.comment_id),
        None,
        None,
    )?;
    stored = store
        .comment_draft(&stored.draft_id, stored.draft_revision)?
        .ok_or_else(|| "posted private Comment disappeared".to_string())?;
    Ok(PrivateCommentSubmitResult {
        draft: draft_projection(&stored)?,
        comment: Some(decrypted.projection),
    })
}
pub fn list(
    session: &NativeSocialSession,
    store: &PrivateSocialStore,
    transport: &NativeSocialTransport,
    session_generation: u64,
    post_id: &str,
    cursor: &str,
    limit: u32,
) -> Result<PrivateCommentPage, String> {
    if !canonical_identifier(post_id) || limit == 0 || limit > 100 {
        return Err("private Comment list input is invalid".to_string());
    }
    let response = match transport.list_moment_comments(post_id, cursor, limit) {
        Ok(response) => response,
        Err(error) => {
            if let Some(projection) = terminal_projection_for_transport_error(post_id, &error) {
                store.persist_receiver_failure(
                    session_generation,
                    post_id,
                    &projection.encode()?,
                    purges_private_material(&projection.state),
                )?;
            }
            return Err(error.to_string());
        }
    };
    let mut recovery_targets = HashMap::new();
    for comment in &response.comments {
        if comment_needs_recovery(store, comment)? {
            let (comment_id, target) = comment_recovery_target(comment)?;
            if recovery_targets.insert(comment_id, target).is_some() {
                return Err("private Comment recovery target is duplicated".to_string());
            }
        }
    }
    let recovery_entries = if recovery_targets.is_empty() {
        HashMap::new()
    } else {
        comment_recovery_entries(transport, post_id, &recovery_targets)?
    };
    let mut comments = Vec::with_capacity(response.comments.len());
    for comment in &response.comments {
        let comment_id = comment
            .metadata
            .as_ref()
            .map(|metadata| metadata.comment_id.as_str())
            .unwrap_or_default();
        let decrypted = if recovery_targets.contains_key(comment_id) {
            let recoverable = recovery_entries
                .get(comment_id)
                .ok_or_else(|| "private Comment recovery envelope is unavailable".to_string())?;
            decrypt_recovered_comment(
                session,
                store,
                transport,
                post_id,
                comment_id,
                comment,
                recoverable,
            )?
        } else {
            decrypt_comment(session, store, transport, post_id, comment, None, None)?
        };
        let generation = decrypted
            .projection
            .generation
            .parse::<u64>()
            .map_err(|_| "private Comment generation is invalid".to_string())?;
        store.commit_comment_receiver_projection(
            session_generation,
            &decrypted.projection.content_id,
            generation,
            &decrypted.projection.post_id,
            &decrypted.projection.comment_id,
            decrypted.content_key.as_bytes(),
            decrypted.consumed_prekey_id.as_deref(),
            &decrypted.projection.encode()?,
        )?;
        comments.push(decrypted.projection);
    }
    Ok(PrivateCommentPage {
        post_id: post_id.to_string(),
        comments,
        next_cursor: response.next_cursor,
        has_more: response.has_more,
    })
}

fn comment_recovery_entries(
    transport: &NativeSocialTransport,
    post_id: &str,
    recovery_targets: &HashMap<String, CommentRecoveryTarget>,
) -> Result<HashMap<String, social::RecoverablePrivateContent>, String> {
    let mut cursor = String::new();
    let mut recovered = HashMap::new();
    let mut visited_cursors = HashSet::from([cursor.clone()]);
    loop {
        let response = transport
            .list_recoverable(&cursor, 100)
            .map_err(|error| error.to_string())?;
        for resource in response.resources {
            let Some(content_id) =
                validate_comment_recovery_record(post_id, recovery_targets, &resource)?
            else {
                continue;
            };
            if recovered.insert(content_id, resource).is_some() {
                return Err("private Comment recovery record is duplicated".to_string());
            }
        }
        if recovered.len() == recovery_targets.len() || !response.has_more {
            break;
        }
        if response.next_cursor.trim().is_empty()
            || !visited_cursors.insert(response.next_cursor.clone())
        {
            return Err("private Comment recovery pagination did not advance".to_string());
        }
        cursor = response.next_cursor;
    }
    Ok(recovered)
}

fn decrypt_recovered_comment(
    session: &NativeSocialSession,
    store: &PrivateSocialStore,
    transport: &NativeSocialTransport,
    post_id: &str,
    comment_id: &str,
    comment: &social::CommentResource,
    recoverable: &social::RecoverablePrivateContent,
) -> Result<DecryptedPrivateComment, String> {
    let recovery_envelope = recoverable
        .recovery_envelope
        .as_ref()
        .ok_or_else(|| "private Comment recovery envelope is unavailable".to_string())?;
    let private = match comment.body.as_ref() {
        Some(social::comment_resource::Body::PrivateContent(private)) => private,
        _ => return Err("Comment recovery resource is not private".to_string()),
    };
    let payload = private
        .payload
        .as_ref()
        .ok_or_else(|| "private Comment recovery payload is unavailable".to_string())?;
    if recoverable
        .resource
        .as_ref()
        .map(|resource| resource.content_id.as_str())
        != Some(comment_id)
        || payload.resource.as_ref() != recoverable.resource.as_ref()
        || payload.ciphertext_sha256 != recoverable.payload_ciphertext_sha256
    {
        return Err("private Comment recovery record does not match point read".to_string());
    }
    let resource = payload
        .resource
        .as_ref()
        .ok_or_else(|| "private Comment recovery resource is unavailable".to_string())?;
    let verification = private
        .verification
        .as_ref()
        .ok_or_else(|| "private Comment recovery verification is unavailable".to_string())?;
    let proof = verification
        .commit_proof
        .as_ref()
        .ok_or_else(|| "private Comment recovery proof is unavailable".to_string())?;
    let (sender, signing_key_id, committed_at) = comment_sender_requirement(post_id, comment)?;
    let sender_key = transport
        .sender_signing_key(&sender, &signing_key_id, committed_at)
        .map_err(|error| error.to_string())?;
    let object_hash = object_descriptor_set_hash(&[])?;
    verify_recovery_viewer_envelope(
        session,
        recovery_envelope,
        payload,
        proof,
        resource,
        &object_hash,
        &sender_key,
    )?;
    let root = open_recovery_content_key(store, &session.scope.actor_ptid, recovery_envelope)
        .map_err(|_| "private Comment recovery key is unavailable".to_string())?;
    let mut recovered_comment = comment.clone();
    attach_comment_recovery_envelope(&mut recovered_comment, recovery_envelope)?;
    decrypt_comment(
        session,
        store,
        transport,
        post_id,
        &recovered_comment,
        Some(root),
        Some(recovery_envelope.principal_epoch),
    )
}

fn finish_failure(
    store: &PrivateSocialStore,
    draft: &StoredCommentDraft,
    error: TransportError,
) -> String {
    let state = match error.http_status {
        Some(429) => CommentState::RateLimited,
        Some(403 | 404 | 410) => CommentState::ParentUnavailable,
        _ => CommentState::Failed,
    };
    let code = format!("SOCIAL_PRIVATE_COMMENT_{}", error.stable_code);
    let _ = store.finish_comment(
        &draft.draft_id,
        draft.draft_revision,
        state,
        None,
        Some(&code),
        error.retry_after_seconds,
    );
    error.to_string()
}

fn validate_intent(intent: &PrivateCommentIntent) -> Result<(), String> {
    if !canonical_identifier(&intent.draft_id)
        || intent.draft_revision == 0
        || !canonical_identifier(&intent.post_id)
        || (!intent.reply_to_comment_id.is_empty()
            && !canonical_identifier(&intent.reply_to_comment_id))
        || intent.text.trim().is_empty()
        || intent.text.len() > 8 * 1024
    {
        return Err("private Comment draft is invalid".to_string());
    }
    canonical_private_mentions(&intent.text, &intent.mentions, "private Comment")?;
    Ok(())
}

fn intent_hash(intent: &PrivateCommentIntent) -> Result<[u8; 32], String> {
    serde_json::to_vec(intent)
        .map(|value| Sha256::digest(value).into())
        .map_err(|error| error.to_string())
}

pub(crate) fn draft_projection(
    draft: &StoredCommentDraft,
) -> Result<PrivateCommentDraftProjection, String> {
    Ok(PrivateCommentDraftProjection {
        draft_id: draft.draft_id.clone(),
        draft_revision: draft.draft_revision,
        post_id: draft.post_id.clone(),
        reply_to_comment_id: draft.reply_to_comment_id.clone(),
        text: draft.text.clone(),
        mentions: serde_json::from_str(&draft.mention_intent_json)
            .map_err(|error| error.to_string())?,
        state: draft.state.as_str().to_string(),
        comment_id: draft.comment_id.clone(),
        error_code: draft.error_code.clone(),
        retry_after_seconds: draft.retry_after_seconds,
    })
}

fn bounded_command_id(prefix: &str, draft_id: &str, revision: u64) -> String {
    format!(
        "{prefix}-{}",
        hex(&Sha256::digest(
            format!("{prefix}:{draft_id}:{revision}").as_bytes()
        ))
    )
}

fn comment_needs_recovery(
    store: &PrivateSocialStore,
    comment: &social::CommentResource,
) -> Result<bool, String> {
    let private = match comment.body.as_ref() {
        Some(social::comment_resource::Body::PrivateContent(private)) => private,
        _ => return Ok(false),
    };
    let payload = private
        .payload
        .as_ref()
        .ok_or_else(|| "private Comment payload is unavailable".to_string())?;
    let resource = payload
        .resource
        .as_ref()
        .ok_or_else(|| "private Comment resource is unavailable".to_string())?;
    if store
        .content_root(&resource.content_id, resource.generation)?
        .is_some()
    {
        return Ok(false);
    }
    let Some(envelope) = private.viewer_envelope.as_ref() else {
        return Ok(true);
    };
    let binding = envelope
        .binding
        .as_ref()
        .ok_or_else(|| "private Comment envelope binding is unavailable".to_string())?;
    match envelope.recipient.as_ref() {
        Some(wire::viewer_content_key_envelope::Recipient::Endpoint(_)) => store
            .endpoint_prekey(&binding.recipient_key_id)
            .map(|key| key.is_none()),
        Some(wire::viewer_content_key_envelope::Recipient::RecoveryActor(_)) | None => Ok(true),
    }
}

fn comment_recovery_target(
    comment: &social::CommentResource,
) -> Result<(String, CommentRecoveryTarget), String> {
    let comment_id = comment
        .metadata
        .as_ref()
        .map(|metadata| metadata.comment_id.as_str())
        .filter(|comment_id| canonical_identifier(comment_id))
        .ok_or_else(|| "private Comment recovery identity is unavailable".to_string())?;
    let private = match comment.body.as_ref() {
        Some(social::comment_resource::Body::PrivateContent(private)) => private,
        _ => return Err("Comment recovery resource is not private".to_string()),
    };
    let payload = private
        .payload
        .as_ref()
        .ok_or_else(|| "private Comment recovery payload is unavailable".to_string())?;
    let resource = payload
        .resource
        .as_ref()
        .filter(|resource| {
            resource.owner_domain == wire::SecureContentOwnerDomain::Social as i32
                && resource.content_id == comment_id
                && resource.generation > 0
        })
        .cloned()
        .ok_or_else(|| "private Comment recovery resource is invalid".to_string())?;
    if payload.ciphertext_sha256.len() != 32 {
        return Err("private Comment recovery ciphertext hash is invalid".to_string());
    }
    Ok((
        comment_id.to_string(),
        CommentRecoveryTarget {
            resource,
            payload_ciphertext_sha256: payload.ciphertext_sha256.clone(),
        },
    ))
}

fn attach_comment_recovery_envelope(
    comment: &mut social::CommentResource,
    envelope: &wire::ViewerContentKeyEnvelope,
) -> Result<(), String> {
    let private = match comment.body.as_mut() {
        Some(social::comment_resource::Body::PrivateContent(private)) => private,
        _ => return Err("Comment recovery resource is not private".to_string()),
    };
    private.viewer_envelope = Some(envelope.clone());
    Ok(())
}

fn validate_comment_recovery_record(
    post_id: &str,
    recovery_targets: &HashMap<String, CommentRecoveryTarget>,
    recoverable: &social::RecoverablePrivateContent,
) -> Result<Option<String>, String> {
    let Some(reference) = recoverable.resource.as_ref() else {
        return Ok(None);
    };
    let Some(target) = recovery_targets.get(&reference.content_id) else {
        return Ok(None);
    };
    let locator = recoverable
        .locator
        .as_ref()
        .and_then(|locator| locator.resource.as_ref());
    let exact_locator = matches!(
        locator,
        Some(social::social_private_content_locator::Resource::Comment(comment))
            if comment.post_id == post_id && comment.comment_id == reference.content_id
    );
    if !exact_locator
        || reference != &target.resource
        || recoverable.payload_ciphertext_sha256 != target.payload_ciphertext_sha256
        || recoverable.recovery_envelope.is_none()
    {
        return Err("private Comment recovery record is invalid".to_string());
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

fn validate_comment_plan(
    session: &NativeSocialSession,
    plan: &wire::ContentEncryptionPlan,
    content_id: &str,
    domain_binding: &[u8],
) -> Result<(), String> {
    let resource = plan
        .resource
        .as_ref()
        .ok_or_else(|| "private Comment plan resource is unavailable".to_string())?;
    let author = plan
        .author
        .as_ref()
        .ok_or_else(|| "private Comment plan author is unavailable".to_string())?;
    if plan.format_version != PAYLOAD_FORMAT_VERSION
        || !canonical_identifier(&plan.plan_id)
        || resource.owner_domain != wire::SecureContentOwnerDomain::Social as i32
        || resource.content_id != content_id
        || resource.generation == 0
        || author.actor.as_ref().map(|actor| actor.ptid.as_str())
            != Some(session.scope.actor_ptid.as_str())
        || author.device_id != session.scope.device_id
        || plan.authorization_snapshot_sha256.len() != 32
        || plan.domain_binding_sha256 != Sha256::digest(domain_binding).as_slice()
        || plan.canonical_plan_sha256.len() != 32
        || plan.station_signing_key_id != session.trusted_station_signing_key.key_id
        || plan.station_signature.len() != 64
        || plan.required_slots.is_empty()
        || plan.required_slots.len() > 1000
        || !plan.object_ids.is_empty()
    {
        return Err("private Comment plan binding is invalid".to_string());
    }
    if plan.required_slots.iter().any(|slot| {
        !canonical_identifier(&slot.recipient_slot_id)
            || !canonical_identifier(&slot.one_time_key_id)
            || slot.one_time_public_key.len() != 32
            || slot.principal_binding_sha256.len() != 32
    }) || plan
        .required_slots
        .windows(2)
        .any(|pair| pair[0].recipient_slot_id >= pair[1].recipient_slot_id)
    {
        return Err("private Comment plan slots are invalid".to_string());
    }
    let mut hash_input = plan.clone();
    hash_input.canonical_plan_sha256.clear();
    hash_input.station_signature.clear();
    if Sha256::digest(hash_input.encode_to_vec()).as_slice() != plan.canonical_plan_sha256 {
        return Err("private Comment plan hash is invalid".to_string());
    }
    let mut signed = plan.clone();
    signed.station_signature.clear();
    session
        .trusted_station_signing_key
        .verifying_key
        .verify(
            &signed.encode_to_vec(),
            &Signature::from_slice(&plan.station_signature)
                .map_err(|_| "private Comment plan signature is invalid".to_string())?,
        )
        .map_err(|_| "private Comment plan signature is invalid".to_string())
}

fn comment_sender_requirement(
    expected_post_id: &str,
    comment: &social::CommentResource,
) -> Result<(actor::ActorDeviceRef, String, i64), String> {
    let metadata = comment
        .metadata
        .as_ref()
        .ok_or_else(|| "private Comment metadata is unavailable".to_string())?;
    let private = match comment.body.as_ref() {
        Some(social::comment_resource::Body::PrivateContent(value)) => value,
        _ => return Err("Comment resource is not private".to_string()),
    };
    let verification = private
        .verification
        .as_ref()
        .ok_or_else(|| "private Comment verification is unavailable".to_string())?;
    let proof = verification
        .commit_proof
        .as_ref()
        .ok_or_else(|| "private Comment proof is unavailable".to_string())?;
    let sender = proof
        .author
        .as_ref()
        .ok_or_else(|| "private Comment sender is unavailable".to_string())?;
    let sender_actor = sender
        .actor
        .as_ref()
        .ok_or_else(|| "private Comment sender actor is unavailable".to_string())?;
    let signing_key_id = private
        .viewer_envelope
        .as_ref()
        .and_then(|value| value.binding.as_ref())
        .map(|value| value.sender_signing_key_id.as_str())
        .or_else(|| {
            verification
                .mention_routing
                .as_ref()
                .map(|value| value.sender_signing_key_id.as_str())
        })
        .ok_or_else(|| "private Comment sender signing key is unavailable".to_string())?;
    let committed_at =
        checked_timestamp_millis(proof.committed_at.as_ref(), "private Comment commit time")?;
    let created_at = checked_timestamp_millis(
        metadata.created_at.as_ref(),
        "private Comment creation time",
    )?;
    let updated_at =
        checked_timestamp_millis(metadata.updated_at.as_ref(), "private Comment update time")?;
    if metadata.post_id != expected_post_id
        || metadata.comment_id != metadata.content_id
        || metadata.is_deleted
        || metadata.author.as_ref() != Some(sender_actor)
        || !canonical_identifier(&metadata.comment_id)
        || !canonical_identifier(&sender.device_id)
        || !canonical_identifier(signing_key_id)
        || created_at != committed_at
        || updated_at < committed_at
    {
        return Err("private Comment resource identity is invalid".to_string());
    }
    Ok((sender.clone(), signing_key_id.to_string(), committed_at))
}

fn decrypt_comment(
    session: &NativeSocialSession,
    store: &PrivateSocialStore,
    transport: &NativeSocialTransport,
    expected_post_id: &str,
    comment: &social::CommentResource,
    supplied_root: Option<ContentKey>,
    expected_recovery_epoch: Option<u64>,
) -> Result<DecryptedPrivateComment, String> {
    let metadata = comment
        .metadata
        .as_ref()
        .ok_or_else(|| "private Comment metadata is unavailable".to_string())?;
    let private = match comment.body.as_ref() {
        Some(social::comment_resource::Body::PrivateContent(value)) => value,
        _ => return Err("Comment resource is not private".to_string()),
    };
    let payload = private
        .payload
        .as_ref()
        .ok_or_else(|| "private Comment payload is unavailable".to_string())?;
    let resource = payload
        .resource
        .as_ref()
        .ok_or_else(|| "private Comment resource is unavailable".to_string())?;
    let verification = private
        .verification
        .as_ref()
        .ok_or_else(|| "private Comment verification is unavailable".to_string())?;
    let proof = verification
        .commit_proof
        .as_ref()
        .ok_or_else(|| "private Comment proof is unavailable".to_string())?;
    let (sender, signing_key_id, committed_at) =
        comment_sender_requirement(expected_post_id, comment)?;
    let sender_key = transport
        .sender_signing_key(&sender, &signing_key_id, committed_at)
        .map_err(|error| error.to_string())?;
    let domain_binding = comment_domain_binding(expected_post_id, &metadata.reply_to_comment_id);
    let domain_binding_sha256 = Sha256::digest(&domain_binding);
    let object_hash = object_descriptor_set_hash(&[])?;
    let mention_hash = validated_mention_routing_hash(
        verification,
        proof,
        resource,
        payload,
        &sender,
        Some(&signing_key_id),
        Some(&sender_key),
        "private Comment",
    )?;
    let attestation = verification
        .station_signing_key_attestation
        .as_ref()
        .ok_or_else(|| "private Comment Station attestation is unavailable".to_string())?;
    if resource.owner_domain != wire::SecureContentOwnerDomain::Social as i32
        || resource.content_id != metadata.comment_id
        || resource.generation == 0
        || payload.format_version != PAYLOAD_FORMAT_VERSION
        || payload.resource.as_ref() != Some(resource)
        || payload.suite != wire::PayloadEncryptionSuite::Aes256Gcm as i32
        || payload.nonce.len() != 12
        || payload.ciphertext.len() < 16
        || payload.ciphertext.len() > 1024 * 1024
        || payload.ciphertext_sha256.len() != 32
        || payload.aad_sha256 != domain_binding_sha256.as_slice()
        || Sha256::digest(&payload.ciphertext).as_slice() != payload.ciphertext_sha256
        || !private.objects.is_empty()
        || private.poll.is_some()
        || verification.subtype_authority.is_some()
        || proof.format_version != PAYLOAD_FORMAT_VERSION
        || proof.domain_commit_id != metadata.comment_id
        || proof.resource.as_ref() != Some(resource)
        || proof.domain_binding_sha256 != domain_binding_sha256.as_slice()
        || proof.encrypted_payload_sha256 != Sha256::digest(payload.encode_to_vec()).as_slice()
        || proof.object_descriptor_set_sha256 != object_hash
        || proof.mention_routing_sha256 != mention_hash.as_slice()
        || proof.subtype_authority_sha256 != Sha256::digest([]).as_slice()
        || proof.station_signing_key_id != attestation.proof_signing_key_id
        || proof.station_signature.len() != 64
        || committed_at
            > current_unix_seconds()
                .saturating_add(CLOCK_SKEW_SECONDS)
                .saturating_mul(1_000)
    {
        return Err("private Comment cryptographic binding is invalid".to_string());
    }
    let envelope = private
        .viewer_envelope
        .as_ref()
        .ok_or_else(|| "private Comment viewer envelope is unavailable".to_string())?;
    if let Some(recovery_epoch) = expected_recovery_epoch {
        if envelope.principal_epoch != recovery_epoch {
            return Err("private Comment recovery epoch is invalid".to_string());
        }
        verify_recovery_viewer_envelope(
            session,
            envelope,
            payload,
            proof,
            resource,
            &object_hash,
            &sender_key,
        )?;
    } else {
        verify_viewer_envelope(
            session,
            envelope,
            payload,
            proof,
            resource,
            &object_hash,
            &sender_key,
            &signing_key_id,
        )?;
    }
    let proof_key = verify_station_attestation(session, attestation, current_unix_seconds())?;
    let mut unsigned_proof = proof.clone();
    unsigned_proof.station_signature.clear();
    proof_key
        .verify(
            &unsigned_proof.encode_to_vec(),
            &Signature::from_slice(&proof.station_signature)
                .map_err(|_| "private Comment proof signature is invalid".to_string())?,
        )
        .map_err(|_| "private Comment proof signature is invalid".to_string())?;
    let (content_key, consumed_prekey_id) = if let Some(root) = supplied_root {
        (root, None)
    } else if let Some(root) = store.content_root(&resource.content_id, resource.generation)? {
        (ContentKey::from_bytes(root), None)
    } else {
        let binding = envelope
            .binding
            .as_ref()
            .ok_or_else(|| "private Comment envelope binding is unavailable".to_string())?;
        let prekey = store
            .endpoint_prekey(&binding.recipient_key_id)?
            .ok_or_else(|| "private Comment recovery is required".to_string())?;
        let content_key = open_content_key(
            &ContentPreKeyPrivate::from_bytes(prekey.private_key),
            &binding.encode_to_vec(),
            &SealedContentKey {
                encapsulated_key: envelope.hpke_encapsulated_key.clone(),
                ciphertext: envelope.hpke_ciphertext.clone(),
            },
        )?;
        (content_key, Some(prekey.key_id.clone()))
    };
    let authorization_snapshot: [u8; 32] = proof
        .authorization_snapshot_sha256
        .as_slice()
        .try_into()
        .map_err(|_| "private Comment authorization snapshot is invalid".to_string())?;
    let payload_key = derive_payload_key(
        content_key.as_bytes(),
        &authorization_snapshot,
        &PayloadKeyContext {
            protocol_version: PAYLOAD_FORMAT_VERSION,
            owner_domain: resource.owner_domain as u32,
            content_id: &resource.content_id,
            generation: resource.generation,
            payload_kind: COMMENT_PAYLOAD_KIND,
        },
    )?;
    let plaintext = decrypt_payload(
        &payload_key,
        &CoreEncryptedPayload {
            nonce: payload
                .nonce
                .as_slice()
                .try_into()
                .map_err(|_| "private Comment nonce is invalid".to_string())?,
            ciphertext: payload.ciphertext.clone(),
            ciphertext_sha256: payload
                .ciphertext_sha256
                .as_slice()
                .try_into()
                .map_err(|_| "private Comment payload hash is invalid".to_string())?,
            aad_sha256: payload
                .aad_sha256
                .as_slice()
                .try_into()
                .map_err(|_| "private Comment AAD is invalid".to_string())?,
        },
        &domain_binding,
    )?;
    let decoded = social::PrivateCommentContent::decode(plaintext.as_slice())
        .map_err(|_| "private Comment plaintext is malformed".to_string())?;
    if decoded.format_version != PAYLOAD_FORMAT_VERSION
        || decoded.content_id != resource.content_id
        || decoded.parent_content_id != expected_post_id
    {
        return Err("private Comment plaintext identity is invalid".to_string());
    }
    let mentions = verify_decrypted_mentions(
        &decoded.text,
        &decoded.mentions,
        &decoded.mention_commitment_salt,
        verification.mention_routing.as_ref(),
        "private Comment",
    )?
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
            author_ptid: metadata
                .author
                .as_ref()
                .map(|value| value.ptid.clone())
                .unwrap_or_default(),
            state: CommentState::Posted.as_str().to_string(),
            text: Some(decoded.text),
            mentions,
            reactions_count: metadata.reactions_count,
            replies_count: metadata.replies_count,
            created_at_millis: checked_timestamp_millis(
                metadata.created_at.as_ref(),
                "private Comment creation time",
            )
            .ok(),
            updated_at_millis: checked_timestamp_millis(
                metadata.updated_at.as_ref(),
                "private Comment update time",
            )
            .ok(),
        },
        content_key,
        consumed_prekey_id,
    })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn comment_intent_rejects_invalid_mentions() {
        let mut intent = PrivateCommentIntent {
            draft_id: "draft-1".to_string(),
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
        assert!(validate_intent(&intent).is_ok());
        intent.mentions[0].offset = 99;
        assert!(validate_intent(&intent).is_err());
    }

    #[test]
    fn comment_recovery_requires_exact_locator_and_attaches_envelope() {
        let recoverable = recoverable_comment("post-1", "comment-1");
        let recovery_targets = HashMap::from([(
            "comment-1".to_string(),
            CommentRecoveryTarget {
                resource: recoverable.resource.clone().unwrap(),
                payload_ciphertext_sha256: recoverable.payload_ciphertext_sha256.clone(),
            },
        )]);
        assert_eq!(
            validate_comment_recovery_record("post-1", &recovery_targets, &recoverable).unwrap(),
            Some("comment-1".to_string())
        );

        let mut comment = social::CommentResource {
            body: Some(social::comment_resource::Body::PrivateContent(
                social::PrivateContentAccess::default(),
            )),
            ..Default::default()
        };
        attach_comment_recovery_envelope(
            &mut comment,
            recoverable.recovery_envelope.as_ref().unwrap(),
        )
        .unwrap();
        let principal_epoch = match comment.body.as_ref().unwrap() {
            social::comment_resource::Body::PrivateContent(private) => private
                .viewer_envelope
                .as_ref()
                .map(|envelope| envelope.principal_epoch),
            _ => None,
        };
        assert_eq!(principal_epoch, Some(7));
    }

    #[test]
    fn comment_recovery_rejects_malformed_matching_records() {
        let expected = recoverable_comment("post-1", "comment-1");
        let recovery_targets = HashMap::from([(
            "comment-1".to_string(),
            CommentRecoveryTarget {
                resource: expected.resource.clone().unwrap(),
                payload_ciphertext_sha256: expected.payload_ciphertext_sha256.clone(),
            },
        )]);
        let mut recoverable = recoverable_comment("post-other", "comment-1");
        assert!(
            validate_comment_recovery_record("post-1", &recovery_targets, &recoverable).is_err()
        );

        recoverable = recoverable_comment("post-1", "comment-1");
        recoverable.payload_ciphertext_sha256.pop();
        assert!(
            validate_comment_recovery_record("post-1", &recovery_targets, &recoverable).is_err()
        );

        recoverable = recoverable_comment("post-1", "comment-1");
        recoverable.resource.as_mut().unwrap().generation += 1;
        assert!(
            validate_comment_recovery_record("post-1", &recovery_targets, &recoverable).is_err()
        );

        recoverable = recoverable_comment("post-1", "comment-1");
        recoverable.recovery_envelope = None;
        assert!(
            validate_comment_recovery_record("post-1", &recovery_targets, &recoverable).is_err()
        );
    }
}
