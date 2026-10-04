use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use hmac::{Hmac, Mac};
use prost::Message;
use secure_content_core::codec::CanonicalMessageEncoder;
use secure_content_core::envelope::{open_content_key, ContentKey, SealedContentKey};
use secure_content_core::object::validate_object_descriptor;
use secure_content_core::payload::{
    decrypt_payload, derive_payload_key, EncryptedPayload as CoreEncryptedPayload,
    PayloadKeyContext, PAYLOAD_FORMAT_VERSION,
};
use secure_content_core::prekey::ContentPreKeyPrivate;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::model::{actor, secure_content as wire, social};
use crate::secure_content::adapter::SocialObjectCodec;
use crate::secure_content::store::SecureContentStore;
use crate::secure_content::SecureContentSession;

use super::private_media::PrivateMediaAccessPath;
use super::private_mention::{validated_mention_routing_hash, verify_decrypted_mentions};

pub(super) const STATION_ATTESTATION_DOMAIN: &[u8] =
    b"peers-touch:secure-content:station-content-signing-key-attestation:v1\0";
const CLOCK_SKEW_SECONDS: i64 = 60;
const MAX_IDENTIFIER_BYTES: usize = 128;
const REPOST_SNAPSHOT_DOMAIN: &[u8] = b"peers-touch:secure-content:repost-snapshot:v1";

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrivateReadState {
    LoadingAuthorizedResource,
    WaitingForPrivateKey,
    RecoveryRequired,
    RecoveryKeyUnavailable,
    Decrypting,
    ContentReady,
    AuthenticationRequired,
    NotFoundOrNotAuthorized,
    IntegrityFailure,
    PrivateUnsupportedOnDevice,
    DeletedOrRevoked,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrivateMediaState {
    MediaPlaceholder,
    MediaGrantPending,
    MediaDownloading,
    MediaDecrypting,
    MediaReady,
    MediaAccessDenied,
    MediaIntegrityFailure,
    MediaOfflineRetryable,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PrivateMomentMediaProjection {
    pub object_id: String,
    pub state: PrivateMediaState,
    #[serde(default)]
    pub access_path: PrivateMediaAccessPath,
    #[serde(default)]
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub render_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plaintext_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plaintext_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrivateMomentContentProjection {
    Text {
        text: String,
    },
    Image {
        text: String,
        media: Vec<PrivateMomentMediaProjection>,
    },
    Video {
        text: String,
        media: Vec<PrivateMomentMediaProjection>,
    },
    Link {
        text: String,
        url: String,
        title: String,
    },
    Poll {
        text: String,
        question: String,
        options: Vec<String>,
        min_choices: u32,
        max_choices: u32,
        expires_at_seconds: i64,
    },
    Repost {
        comment: String,
        source_post_id: String,
        source_author_ptid: String,
        source_kind: String,
        source_text: String,
    },
    Location {
        text: String,
        name: String,
        latitude: String,
        longitude: String,
        address: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PrivateMentionProjection {
    pub actor_ptid: String,
    pub offset: i32,
    pub length: i32,
    pub display: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PrivateReactionSummaryProjection {
    pub kind: i32,
    pub count: String,
    pub reacted_by_viewer: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrivateReactionOperation {
    React,
    Unreact,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PrivateMomentProjection {
    pub post_id: String,
    pub content_id: String,
    pub generation: String,
    pub author_ptid: String,
    pub audience_kind: String,
    pub state: PrivateReadState,
    #[serde(default)]
    pub mentions: Vec<PrivateMentionProjection>,
    #[serde(default)]
    pub reactions: Vec<PrivateReactionSummaryProjection>,
    #[serde(default = "zero_revision")]
    pub reaction_revision: String,
    #[serde(default)]
    pub reactions_hydrated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<PrivateMomentContentProjection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at_millis: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at_millis: Option<i64>,
}

impl PrivateMomentProjection {
    pub fn encode_local(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(self).map_err(|error| error.to_string())
    }

    pub fn decode_local(bytes: &[u8]) -> Result<Self, String> {
        serde_json::from_slice(bytes).map_err(|error| error.to_string())
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct PrivateMomentsSnapshot {
    pub actor_ptid: String,
    pub device_id: String,
    pub session_generation: String,
    pub projections: Vec<PrivateMomentProjection>,
    pub reaction_commands: Vec<PrivateReactionCommandProjection>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct PrivateMomentPublishResult {
    pub state: String,
    pub draft_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projection: Option<PrivateMomentProjection>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrivateProjectionFailureKind {
    RecoveryRequired,
    IntegrityFailure,
}

#[derive(Debug)]
pub struct PrivateProjectionError {
    pub kind: PrivateProjectionFailureKind,
    pub message: String,
}

impl PrivateProjectionError {
    fn recovery_required(message: impl Into<String>) -> Self {
        Self {
            kind: PrivateProjectionFailureKind::RecoveryRequired,
            message: message.into(),
        }
    }
}

impl From<String> for PrivateProjectionError {
    fn from(message: String) -> Self {
        Self {
            kind: PrivateProjectionFailureKind::IntegrityFailure,
            message,
        }
    }
}

pub struct DecryptedPrivateMoment {
    pub projection: PrivateMomentProjection,
    pub plaintext: social::PrivateMomentContent,
    pub content_key: ContentKey,
    pub consumed_prekey: Option<String>,
}

#[derive(Clone, Debug)]
pub(super) struct PrivateRepostSourceMaterial {
    pub authority: social::PrivateRepostAuthority,
    pub rendered_source: social::RenderedSourceSnapshot,
}

#[derive(Clone)]
pub(super) struct SenderKeyRequirement {
    pub sender: actor::ActorDeviceRef,
    pub signing_key_id: Option<String>,
    pub committed_at_unix_ms: i64,
}

pub fn decrypt_projection_from_response(
    session: &SecureContentSession,
    store: &SecureContentStore,
    expected_post_id: &str,
    response: &social::GetMomentResourceResponse,
    sender_signing_key: Option<&VerifyingKey>,
    supplied_root: Option<ContentKey>,
    expected_recovery_epoch: Option<u64>,
) -> Result<DecryptedPrivateMoment, PrivateProjectionError> {
    decrypt_projection_from_response_at(
        session,
        store,
        expected_post_id,
        response,
        sender_signing_key,
        supplied_root,
        expected_recovery_epoch,
        current_unix_seconds(),
    )
}

#[allow(clippy::too_many_arguments)]
fn decrypt_projection_from_response_at(
    session: &SecureContentSession,
    store: &SecureContentStore,
    expected_post_id: &str,
    response: &social::GetMomentResourceResponse,
    sender_signing_key: Option<&VerifyingKey>,
    supplied_root: Option<ContentKey>,
    expected_recovery_epoch: Option<u64>,
    now: i64,
) -> Result<DecryptedPrivateMoment, PrivateProjectionError> {
    verify_response_integrity_at(
        session,
        expected_post_id,
        response,
        sender_signing_key,
        expected_recovery_epoch,
        now,
    )?;
    let parts = private_response_parts(response)?;
    let metadata = parts.metadata;
    let private = parts.private;
    let payload = parts.payload;
    let resource_ref = parts.resource;

    let (content_key, consumed_prekey) = if let Some(root) = supplied_root {
        (root, None)
    } else if let Some(root) =
        store.content_root(&resource_ref.content_id, resource_ref.generation)?
    {
        (ContentKey::from_bytes(root), None)
    } else {
        let envelope = private.viewer_envelope.as_ref().ok_or_else(|| {
            PrivateProjectionError::recovery_required("private Moment requires recovery")
        })?;
        let binding = envelope
            .binding
            .as_ref()
            .ok_or_else(|| "private Moment envelope binding is unavailable".to_string())?;
        let endpoint = match envelope.recipient.as_ref() {
            Some(wire::viewer_content_key_envelope::Recipient::Endpoint(endpoint)) => endpoint,
            _ => {
                return Err(PrivateProjectionError::recovery_required(
                    "private Moment requires recovery",
                ))
            }
        };
        if endpoint.actor.as_ref().map(|actor| actor.ptid.as_str())
            != Some(session.key.actor_ptid.as_str())
            || endpoint.device_id != session.key.device_id
        {
            return Err("private Moment endpoint envelope is not for this device"
                .to_string()
                .into());
        }
        let stored = store
            .endpoint_prekey(&binding.recipient_key_id)?
            .ok_or_else(|| {
                PrivateProjectionError::recovery_required(
                    "private Moment endpoint key is unavailable",
                )
            })?;
        if binding.recipient_key_kind != wire::ContentPreKeyKind::ContentPrekeyKindEndpoint as i32
            || envelope.principal_epoch != stored.pool_epoch
        {
            return Err("private Moment endpoint key kind or epoch mismatch"
                .to_string()
                .into());
        }
        let binding_bytes = binding.encode_to_vec();
        let key = open_content_key(
            &ContentPreKeyPrivate::from_bytes(stored.private_key),
            &binding_bytes,
            &SealedContentKey {
                encapsulated_key: envelope.hpke_encapsulated_key.clone(),
                ciphertext: envelope.hpke_ciphertext.clone(),
            },
        )?;
        (key, Some(stored.key_id))
    };

    let kind = private_moment_kind(metadata.r#type)?;
    let (subtype_prepare_authority_sha256, _) =
        validated_subtype_authority(parts.private, parts.verification, parts.resource, kind)?;
    let domain_binding = social::PrivateMomentDomainBinding {
        format_version: PAYLOAD_FORMAT_VERSION,
        kind: kind as i32,
        subtype_prepare_authority_sha256,
    }
    .encode_to_vec();
    let authorization_snapshot: [u8; 32] = private
        .verification
        .as_ref()
        .and_then(|verification| verification.commit_proof.as_ref())
        .map(|proof| proof.authorization_snapshot_sha256.as_slice())
        .ok_or_else(|| "private Moment authorization snapshot is unavailable".to_string())?
        .try_into()
        .map_err(|_| "private Moment authorization snapshot is invalid".to_string())?;
    let payload_key = derive_payload_key(
        content_key.as_bytes(),
        &authorization_snapshot,
        &PayloadKeyContext {
            protocol_version: payload.format_version,
            owner_domain: resource_ref.owner_domain as u32,
            content_id: &resource_ref.content_id,
            generation: resource_ref.generation,
            payload_kind: kind as u32,
        },
    )?;
    let plaintext = decrypt_payload(
        &payload_key,
        &CoreEncryptedPayload {
            nonce: payload
                .nonce
                .as_slice()
                .try_into()
                .map_err(|_| "private Moment payload nonce is invalid".to_string())?,
            ciphertext: payload.ciphertext.clone(),
            ciphertext_sha256: payload
                .ciphertext_sha256
                .as_slice()
                .try_into()
                .map_err(|_| "private Moment payload hash is invalid".to_string())?,
            aad_sha256: payload
                .aad_sha256
                .as_slice()
                .try_into()
                .map_err(|_| "private Moment AAD hash is invalid".to_string())?,
        },
        &domain_binding,
    )?;
    let decoded = social::PrivateMomentContent::decode(plaintext.as_slice())
        .map_err(|_| "private Moment plaintext payload is malformed".to_string())?;
    if decoded.format_version != PAYLOAD_FORMAT_VERSION {
        return Err("private Moment plaintext format is unsupported"
            .to_string()
            .into());
    }
    let mentions = verified_private_mentions(&decoded, private)?;
    let access_path = if matches!(
        kind,
        social::PrivateMomentKind::Image | social::PrivateMomentKind::Video
    ) {
        PrivateMediaAccessPath::from_response(response, &session.key.station_peer_id)?
    } else {
        PrivateMediaAccessPath::HomeStationLocalObject
    };
    let content = project_plaintext(&decoded, private, kind, access_path)?;
    let (reactions, reaction_revision, reactions_hydrated) =
        source_reaction_summaries(response, expected_post_id)?;
    let projection = PrivateMomentProjection {
        post_id: metadata.post_id.clone(),
        content_id: metadata.content_id.clone(),
        generation: resource_ref.generation.to_string(),
        author_ptid: metadata
            .author
            .as_ref()
            .map(|actor| actor.ptid.clone())
            .unwrap_or_default(),
        audience_kind: private_audience_kind(metadata.audience_kind)?.to_string(),
        state: PrivateReadState::ContentReady,
        mentions,
        reactions,
        reaction_revision,
        reactions_hydrated,
        content: Some(content),
        error_code: None,
        retry_after_seconds: None,
        created_at_millis: timestamp_ms(metadata.created_at.as_ref()),
        updated_at_millis: timestamp_ms(metadata.updated_at.as_ref()),
    };
    Ok(DecryptedPrivateMoment {
        projection,
        plaintext: decoded,
        content_key,
        consumed_prekey,
    })
}

pub(super) fn canonical_reaction_summaries(
    reactions: &[social::ReactionSummary],
) -> Result<Vec<PrivateReactionSummaryProjection>, String> {
    if reactions.len() > 5 {
        return Err("private Reaction summary exceeds the supported kind count".to_string());
    }
    let mut seen = [false; 6];
    let mut projected = Vec::with_capacity(reactions.len());
    for reaction in reactions {
        let kind = social::ReactionKind::try_from(reaction.kind)
            .map_err(|_| "private Reaction summary kind is invalid".to_string())?;
        let index = kind as usize;
        if kind == social::ReactionKind::ReactionUnspecified
            || reaction.count < 0
            || index >= seen.len()
            || seen[index]
        {
            return Err("private Reaction summary is invalid".to_string());
        }
        seen[index] = true;
        projected.push(PrivateReactionSummaryProjection {
            kind: reaction.kind,
            count: reaction.count.to_string(),
            reacted_by_viewer: reaction.reacted_by_viewer,
        });
    }
    projected.sort_by_key(|reaction| reaction.kind);
    Ok(projected)
}

fn source_reaction_summaries(
    response: &social::GetMomentResourceResponse,
    expected_post_id: &str,
) -> Result<(Vec<PrivateReactionSummaryProjection>, String, bool), String> {
    let Some(post) = response.post.as_ref() else {
        if response.reaction_projection_revision != 0 {
            return Err("private Reaction readback revision has no post projection".to_string());
        }
        return Ok((Vec::new(), zero_revision(), false));
    };
    if post.id != expected_post_id || response.reaction_projection_revision == 0 {
        return Err("private Reaction readback identity or revision is invalid".to_string());
    }
    canonical_reaction_summaries(&post.reactions).map(|reactions| {
        (
            reactions,
            response.reaction_projection_revision.to_string(),
            true,
        )
    })
}

fn zero_revision() -> String {
    "0".to_string()
}

pub(super) fn sender_key_requirement(
    expected_post_id: &str,
    response: &social::GetMomentResourceResponse,
) -> Result<SenderKeyRequirement, String> {
    let parts = private_response_parts(response)?;
    validate_resource_identity(expected_post_id, &parts)
}

pub(super) fn verify_recovery_envelope_for_response(
    session: &SecureContentSession,
    expected_post_id: &str,
    response: &social::GetMomentResourceResponse,
    recovery_envelope: &wire::ViewerContentKeyEnvelope,
    recovery_epoch: u64,
    sender_signing_key: &VerifyingKey,
) -> Result<(), String> {
    verify_response_integrity(
        session,
        expected_post_id,
        response,
        Some(sender_signing_key),
        Some(recovery_epoch),
    )?;
    let parts = private_response_parts(response)?;
    let sender = validate_resource_identity(expected_post_id, &parts)?;
    let object_set_hash = validated_object_descriptor_set_hash(parts.private, parts.resource)?;
    verify_viewer_envelope(
        session,
        recovery_envelope,
        parts.payload,
        parts.proof,
        parts.resource,
        &object_set_hash,
        sender_signing_key,
        sender
            .signing_key_id
            .as_deref()
            .ok_or_else(|| "private Moment sender signing key ID is unavailable".to_string())?,
        Some(recovery_epoch),
    )
}

struct PrivateResponseParts<'a> {
    metadata: &'a social::PostMetadata,
    private: &'a social::PrivateContentAccess,
    payload: &'a wire::EncryptedPayload,
    resource: &'a wire::SecureResourceRef,
    verification: &'a social::PrivateContentVerification,
    proof: &'a wire::ViewerContentCommitProof,
    envelope: Option<&'a wire::ViewerContentKeyEnvelope>,
}

fn private_response_parts(
    response: &social::GetMomentResourceResponse,
) -> Result<PrivateResponseParts<'_>, String> {
    let resource = response
        .resource
        .as_ref()
        .ok_or_else(|| "private Moment response has no resource".to_string())?;
    let metadata = resource
        .metadata
        .as_ref()
        .ok_or_else(|| "private Moment response has no metadata".to_string())?;
    let private = match resource.body.as_ref() {
        Some(social::post_resource::Body::PrivateContent(private)) => private,
        _ => return Err("Moment response is not a private resource".to_string()),
    };
    let payload = private
        .payload
        .as_ref()
        .ok_or_else(|| "private Moment response has no encrypted payload".to_string())?;
    let resource = payload
        .resource
        .as_ref()
        .ok_or_else(|| "private Moment payload has no resource reference".to_string())?;
    let verification = private
        .verification
        .as_ref()
        .ok_or_else(|| "private Moment verification is unavailable".to_string())?;
    let proof = verification
        .commit_proof
        .as_ref()
        .ok_or_else(|| "private Moment commit proof is unavailable".to_string())?;
    let envelope = private.viewer_envelope.as_ref();
    Ok(PrivateResponseParts {
        metadata,
        private,
        payload,
        resource,
        verification,
        proof,
        envelope,
    })
}

fn validate_resource_identity(
    expected_post_id: &str,
    parts: &PrivateResponseParts<'_>,
) -> Result<SenderKeyRequirement, String> {
    let metadata_author = parts
        .metadata
        .author
        .as_ref()
        .ok_or_else(|| "private Moment metadata author is unavailable".to_string())?;
    let proof_author = parts
        .proof
        .author
        .as_ref()
        .ok_or_else(|| "private Moment proof author is unavailable".to_string())?;
    let proof_actor = proof_author
        .actor
        .as_ref()
        .ok_or_else(|| "private Moment proof actor is unavailable".to_string())?;
    let envelope_binding = parts
        .envelope
        .and_then(|envelope| envelope.binding.as_ref());
    let routing_signing_key_id = parts
        .verification
        .mention_routing
        .as_ref()
        .map(|routing| routing.sender_signing_key_id.as_str());
    let committed_at = checked_timestamp_millis(
        parts.proof.committed_at.as_ref(),
        "private Moment commit time",
    )?;
    let created_at = checked_timestamp_millis(
        parts.metadata.created_at.as_ref(),
        "private Moment creation time",
    )?;
    let updated_at = checked_timestamp_millis(
        parts.metadata.updated_at.as_ref(),
        "private Moment update time",
    )?;
    if !canonical_identifier(expected_post_id)
        || parts.metadata.post_id != expected_post_id
        || parts.metadata.content_id != expected_post_id
        || parts.proof.domain_commit_id != expected_post_id
        || parts.resource.owner_domain != wire::SecureContentOwnerDomain::Social as i32
        || parts.resource.content_id != expected_post_id
        || parts.resource.generation == 0
        || parts.metadata.is_deleted
        || !is_valid_private_audience_kind(parts.metadata.audience_kind)
        || metadata_author != proof_actor
        || envelope_binding
            .and_then(|binding| binding.sender.as_ref())
            .is_some_and(|binding_sender| binding_sender != proof_author)
        || envelope_binding
            .map(|binding| binding.sender_signing_key_id.as_str())
            .zip(routing_signing_key_id)
            .is_some_and(|(envelope_key, routing_key)| envelope_key != routing_key)
        || proof_actor.ptid.trim().is_empty()
        || proof_author.device_id.trim().is_empty()
        || envelope_binding
            .is_some_and(|binding| !canonical_identifier(&binding.sender_signing_key_id))
        || created_at != committed_at
        || updated_at < committed_at
    {
        return Err("private Moment resource identity is invalid".to_string());
    }
    Ok(SenderKeyRequirement {
        sender: proof_author.clone(),
        signing_key_id: envelope_binding
            .map(|binding| binding.sender_signing_key_id.clone())
            .or_else(|| routing_signing_key_id.map(str::to_string)),
        committed_at_unix_ms: committed_at,
    })
}

pub(super) fn repost_source_material_from_response(
    expected_post_id: &str,
    response: &social::GetMomentResourceResponse,
    decrypted: Option<&DecryptedPrivateMoment>,
    commitment_salt: &[u8; 32],
) -> Result<PrivateRepostSourceMaterial, String> {
    let resource = response
        .resource
        .as_ref()
        .ok_or_else(|| "repost source resource is unavailable".to_string())?;
    let metadata = resource
        .metadata
        .as_ref()
        .ok_or_else(|| "repost source metadata is unavailable".to_string())?;
    let source_author = metadata
        .author
        .as_ref()
        .ok_or_else(|| "repost source author is unavailable".to_string())?
        .clone();
    if metadata.post_id != expected_post_id
        || metadata.content_id != expected_post_id
        || metadata.is_deleted
        || !canonical_identifier(&source_author.ptid)
        || source_author.acct.trim().is_empty()
        || actor::ActorKind::try_from(source_author.kind)
            .ok()
            .is_none_or(|kind| kind == actor::ActorKind::Unspecified)
    {
        return Err("repost source identity is invalid".to_string());
    }

    let (source, rendered_source, source_proof) = match resource.body.as_ref() {
        Some(social::post_resource::Body::PublicContent(public)) => {
            if decrypted.is_some() {
                return Err("public repost source unexpectedly supplied plaintext".to_string());
            }
            let post = public
                .post
                .as_ref()
                .ok_or_else(|| "public repost source Post is unavailable".to_string())?;
            if response.post.as_ref() != Some(post)
                || post.id != expected_post_id
                || post.author_ptid != source_author.ptid
                || post.r#type != metadata.r#type
                || post.created_at != metadata.created_at
                || post.is_deleted
                || post.audience.as_ref().map(|audience| audience.kind)
                    != Some(social::audience::Kind::Public as i32)
                || metadata.audience_kind != social::audience::Kind::Public as i32
            {
                return Err("public repost source metadata is inconsistent".to_string());
            }
            let snapshot = public_rendered_source_snapshot(
                post,
                &source_author,
                metadata.created_at.as_ref(),
            )?;
            let canonical_public_post_sha256 = Sha256::digest(snapshot.encode_to_vec()).to_vec();
            (
                social::SocialPostSourceRef {
                    post_id: expected_post_id.to_string(),
                    private_content_id: String::new(),
                    private_generation: 0,
                },
                social::RenderedSourceSnapshot {
                    source_class: Some(
                        social::rendered_source_snapshot::SourceClass::PublicSource(snapshot),
                    ),
                },
                social::private_repost_authority::SourceProof::PublicSource(
                    social::PublicRepostSourceProof {
                        canonical_public_post_sha256,
                    },
                ),
            )
        }
        Some(social::post_resource::Body::PrivateContent(_)) => {
            let decrypted = decrypted
                .ok_or_else(|| "private repost source plaintext is unavailable".to_string())?;
            let parts = private_response_parts(response)?;
            validate_resource_identity(expected_post_id, &parts)?;
            let kind = private_moment_kind(metadata.r#type)?;
            let source = social::SocialPostSourceRef {
                post_id: expected_post_id.to_string(),
                private_content_id: parts.resource.content_id.clone(),
                private_generation: parts.resource.generation,
            };
            let snapshot = private_rendered_source_snapshot(
                &source,
                &source_author,
                metadata.created_at.as_ref(),
                kind,
                &decrypted.plaintext,
            )?;
            (
                source,
                social::RenderedSourceSnapshot {
                    source_class: Some(
                        social::rendered_source_snapshot::SourceClass::PrivateSource(snapshot),
                    ),
                },
                social::private_repost_authority::SourceProof::PrivateSource(
                    social::PrivateRepostSourceProof {
                        source_resource: Some(parts.resource.clone()),
                        source_authorization_snapshot_sha256: parts
                            .proof
                            .authorization_snapshot_sha256
                            .clone(),
                        source_encrypted_payload_sha256: Sha256::digest(
                            parts.payload.encode_to_vec(),
                        )
                        .to_vec(),
                        source_commit_proof_sha256: Sha256::digest(parts.proof.encode_to_vec())
                            .to_vec(),
                    },
                ),
            )
        }
        None => return Err("repost source body is unavailable".to_string()),
    };
    let rendered_source_commitment =
        private_repost_snapshot_commitment(commitment_salt, &rendered_source)?;
    Ok(PrivateRepostSourceMaterial {
        authority: social::PrivateRepostAuthority {
            source: Some(source),
            source_author: Some(source_author),
            rendered_source_commitment: rendered_source_commitment.to_vec(),
            source_proof: Some(source_proof),
        },
        rendered_source,
    })
}

pub(super) fn private_repost_snapshot_commitment(
    commitment_salt: &[u8],
    rendered_source: &social::RenderedSourceSnapshot,
) -> Result<[u8; 32], String> {
    if commitment_salt.len() != 32 {
        return Err("private repost commitment salt is invalid".to_string());
    }
    let mut mac = HmacSha256::new_from_slice(commitment_salt)
        .map_err(|_| "private repost commitment key is invalid".to_string())?;
    mac.update(REPOST_SNAPSHOT_DOMAIN);
    mac.update(&rendered_source.encode_to_vec());
    Ok(mac.finalize().into_bytes().into())
}

fn public_rendered_source_snapshot(
    post: &social::Post,
    author: &actor::ActorRef,
    created_at: Option<&prost_types::Timestamp>,
) -> Result<social::PublicRenderedSourceSnapshot, String> {
    let created_at = created_at
        .filter(|timestamp| checked_timestamp_millis(Some(timestamp), "repost source time").is_ok())
        .cloned()
        .ok_or_else(|| "public repost source creation time is invalid".to_string())?;
    let source = social::SocialPostSourceRef {
        post_id: post.id.clone(),
        private_content_id: String::new(),
        private_generation: 0,
    };
    let (kind, body) = match post.content.as_ref() {
        Some(social::post::Content::TextPost(body))
            if post.r#type == social::PostType::Text as i32 && body.mentions.is_empty() =>
        {
            (
                social::PrivateRenderedSourceKind::Text,
                social::public_rendered_source_snapshot::Body::Text(body.clone()),
            )
        }
        Some(social::post::Content::ImagePost(body))
            if post.r#type == social::PostType::Image as i32
                && body.mentions.is_empty()
                && body
                    .images
                    .iter()
                    .all(|image| image.media_encryption.is_none()) =>
        {
            (
                social::PrivateRenderedSourceKind::Image,
                social::public_rendered_source_snapshot::Body::Image(body.clone()),
            )
        }
        Some(social::post::Content::VideoPost(body))
            if post.r#type == social::PostType::Video as i32
                && body.mentions.is_empty()
                && body
                    .video
                    .as_ref()
                    .is_some_and(|video| video.media_encryption.is_none()) =>
        {
            (
                social::PrivateRenderedSourceKind::Video,
                social::public_rendered_source_snapshot::Body::Video(body.clone()),
            )
        }
        Some(social::post::Content::LinkPost(body))
            if post.r#type == social::PostType::Link as i32 && body.mentions.is_empty() =>
        {
            (
                social::PrivateRenderedSourceKind::Link,
                social::public_rendered_source_snapshot::Body::Link(body.clone()),
            )
        }
        Some(social::post::Content::PollPost(body))
            if post.r#type == social::PostType::Poll as i32 && body.mentions.is_empty() =>
        {
            (
                social::PrivateRenderedSourceKind::Poll,
                social::public_rendered_source_snapshot::Body::Poll(body.clone()),
            )
        }
        Some(social::post::Content::LocationPost(body))
            if post.r#type == social::PostType::Location as i32
                && body.mentions.is_empty()
                && body
                    .images
                    .iter()
                    .all(|image| image.media_encryption.is_none()) =>
        {
            (
                social::PrivateRenderedSourceKind::Location,
                social::public_rendered_source_snapshot::Body::Location(body.clone()),
            )
        }
        _ => {
            return Err(
                "public repost source kind/body is unsupported or non-canonical".to_string(),
            )
        }
    };
    Ok(social::PublicRenderedSourceSnapshot {
        source: Some(source),
        author: Some(author.clone()),
        created_at: Some(created_at),
        kind: kind as i32,
        typed_mentions: post.typed_mentions.clone(),
        body: Some(body),
    })
}

fn private_rendered_source_snapshot(
    source: &social::SocialPostSourceRef,
    author: &actor::ActorRef,
    created_at: Option<&prost_types::Timestamp>,
    kind: social::PrivateMomentKind,
    plaintext: &social::PrivateMomentContent,
) -> Result<social::PrivateRenderedSourceSnapshot, String> {
    let created_at = created_at
        .filter(|timestamp| checked_timestamp_millis(Some(timestamp), "repost source time").is_ok())
        .cloned()
        .ok_or_else(|| "private repost source creation time is invalid".to_string())?;
    let (rendered_kind, body) = match (kind, plaintext.body.as_ref()) {
        (
            social::PrivateMomentKind::Text,
            Some(social::private_moment_content::Body::Text(body)),
        ) => (
            social::PrivateRenderedSourceKind::Text,
            social::private_rendered_source_snapshot::Body::Text(body.clone()),
        ),
        (
            social::PrivateMomentKind::Image,
            Some(social::private_moment_content::Body::Image(body)),
        ) => (
            social::PrivateRenderedSourceKind::Image,
            social::private_rendered_source_snapshot::Body::Image(body.clone()),
        ),
        (
            social::PrivateMomentKind::Video,
            Some(social::private_moment_content::Body::Video(body)),
        ) => (
            social::PrivateRenderedSourceKind::Video,
            social::private_rendered_source_snapshot::Body::Video(body.clone()),
        ),
        (
            social::PrivateMomentKind::Link,
            Some(social::private_moment_content::Body::Link(body)),
        ) => (
            social::PrivateRenderedSourceKind::Link,
            social::private_rendered_source_snapshot::Body::Link(body.clone()),
        ),
        (
            social::PrivateMomentKind::Poll,
            Some(social::private_moment_content::Body::Poll(body)),
        ) => (
            social::PrivateRenderedSourceKind::Poll,
            social::private_rendered_source_snapshot::Body::Poll(body.clone()),
        ),
        (
            social::PrivateMomentKind::Location,
            Some(social::private_moment_content::Body::Location(body)),
        ) => (
            social::PrivateRenderedSourceKind::Location,
            social::private_rendered_source_snapshot::Body::Location(body.clone()),
        ),
        _ => return Err("private repost source kind/body is unsupported or recursive".to_string()),
    };
    Ok(social::PrivateRenderedSourceSnapshot {
        source: Some(source.clone()),
        author: Some(author.clone()),
        created_at: Some(created_at),
        kind: rendered_kind as i32,
        body: Some(body),
    })
}

fn verified_private_mentions(
    content: &social::PrivateMomentContent,
    private: &social::PrivateContentAccess,
) -> Result<Vec<PrivateMentionProjection>, String> {
    let (text, mentions) = match content.body.as_ref() {
        Some(social::private_moment_content::Body::Text(body)) => {
            (body.text.as_str(), body.mentions.as_slice())
        }
        Some(social::private_moment_content::Body::Image(body)) => {
            (body.text.as_str(), body.mentions.as_slice())
        }
        Some(social::private_moment_content::Body::Video(body)) => {
            (body.text.as_str(), body.mentions.as_slice())
        }
        Some(social::private_moment_content::Body::Link(body)) => {
            (body.text.as_str(), body.mentions.as_slice())
        }
        Some(social::private_moment_content::Body::Poll(body)) => {
            (body.text.as_str(), body.mentions.as_slice())
        }
        Some(social::private_moment_content::Body::Repost(body)) => {
            (body.comment.as_str(), body.mentions.as_slice())
        }
        Some(social::private_moment_content::Body::Location(body)) => {
            (body.text.as_str(), body.mentions.as_slice())
        }
        None => return Err("private Moment plaintext body is unavailable".to_string()),
    };
    let routing = private
        .verification
        .as_ref()
        .and_then(|verification| verification.mention_routing.as_ref());
    verify_decrypted_mentions(
        text,
        mentions,
        &content.mention_commitment_salt,
        routing,
        "private Moment",
    )
    .map(|mentions| {
        mentions
            .into_iter()
            .map(|mention| PrivateMentionProjection {
                actor_ptid: mention.actor_ptid,
                offset: mention.offset,
                length: mention.length,
                display: mention.display,
            })
            .collect()
    })
}

fn project_plaintext(
    content: &social::PrivateMomentContent,
    private: &social::PrivateContentAccess,
    kind: social::PrivateMomentKind,
    access_path: PrivateMediaAccessPath,
) -> Result<PrivateMomentContentProjection, String> {
    fn project_media(
        metadata: &[social::PrivateAttachmentMetadata],
        objects: &[wire::EncryptedObjectDescriptor],
        label: &str,
        access_path: PrivateMediaAccessPath,
    ) -> Result<Vec<PrivateMomentMediaProjection>, String> {
        if metadata.len() != objects.len() {
            return Err(format!("private {label} Moment object coverage mismatch"));
        }
        metadata
            .iter()
            .zip(objects)
            .map(|(metadata, descriptor)| {
                if metadata.object.as_ref() != Some(descriptor)
                    || metadata.object_key.len() != 32
                    || metadata.base_nonce.len() != 12
                    || metadata.plaintext_sha256.len() != 32
                {
                    return Err(format!("private {label} metadata is invalid"));
                }
                Ok(PrivateMomentMediaProjection {
                    object_id: descriptor.object_id.clone(),
                    state: PrivateMediaState::MediaPlaceholder,
                    access_path,
                    retryable: false,
                    render_url: None,
                    local_path: None,
                    plaintext_sha256: None,
                    plaintext_size: None,
                    mime_type: Some(metadata.mime_type.clone()),
                    width: (metadata.width > 0).then_some(metadata.width),
                    height: (metadata.height > 0).then_some(metadata.height),
                    alt_text: (!metadata.alt_text.is_empty()).then(|| metadata.alt_text.clone()),
                    error_code: None,
                })
            })
            .collect()
    }
    match content.body.as_ref() {
        Some(social::private_moment_content::Body::Text(text)) => {
            if kind != social::PrivateMomentKind::Text || !private.objects.is_empty() {
                return Err("private text Moment contains unexpected objects".to_string());
            }
            Ok(PrivateMomentContentProjection::Text {
                text: text.text.clone(),
            })
        }
        Some(social::private_moment_content::Body::Image(image)) => {
            if kind != social::PrivateMomentKind::Image {
                return Err("private image Moment object coverage mismatch".to_string());
            }
            let media = project_media(&image.images, &private.objects, "image", access_path)?;
            Ok(PrivateMomentContentProjection::Image {
                text: image.text.clone(),
                media,
            })
        }
        Some(social::private_moment_content::Body::Video(video)) => {
            if kind != social::PrivateMomentKind::Video
                || video.source.is_none()
                || video.variants.len() > 8
            {
                return Err("private video Moment metadata is invalid".to_string());
            }
            let mut attachments =
                Vec::with_capacity(1 + usize::from(video.poster.is_some()) + video.variants.len());
            attachments.push(video.source.clone().expect("checked source"));
            if let Some(poster) = video.poster.as_ref() {
                attachments.push(poster.clone());
            }
            for variant in &video.variants {
                let media = variant
                    .media
                    .as_ref()
                    .ok_or_else(|| "private video variant media is missing".to_string())?;
                if variant.variant_id.trim().is_empty() {
                    return Err("private video variant identity is invalid".to_string());
                }
                attachments.push(media.clone());
            }
            let media = project_media(&attachments, &private.objects, "video", access_path)?;
            Ok(PrivateMomentContentProjection::Video {
                text: video.text.clone(),
                media,
            })
        }
        Some(social::private_moment_content::Body::Link(link)) => {
            let preview = link
                .link
                .as_ref()
                .ok_or_else(|| "private link Moment preview is missing".to_string())?;
            if kind != social::PrivateMomentKind::Link
                || !private.objects.is_empty()
                || preview.url.trim() != preview.url
                || !(preview.url.starts_with("https://") || preview.url.starts_with("http://"))
                || preview.title.trim().is_empty()
            {
                return Err("private link Moment metadata is invalid".to_string());
            }
            Ok(PrivateMomentContentProjection::Link {
                text: link.text.clone(),
                url: preview.url.clone(),
                title: preview.title.clone(),
            })
        }
        Some(social::private_moment_content::Body::Poll(poll)) => {
            let authority = match private
                .verification
                .as_ref()
                .and_then(|verification| verification.subtype_authority.as_ref())
            {
                Some(social::private_content_verification::SubtypeAuthority::PollAuthority(
                    authority,
                )) => authority,
                _ => return Err("private poll Moment authority is unavailable".to_string()),
            };
            let mut option_ids = poll
                .options
                .iter()
                .map(|option| option.opaque_option_id.clone())
                .collect::<Vec<_>>();
            option_ids.sort();
            if kind != social::PrivateMomentKind::Poll
                || !private.objects.is_empty()
                || poll.question.trim().is_empty()
                || poll.question.trim() != poll.question
                || poll.options.iter().any(|option| {
                    option.opaque_option_id.len() != 32
                        || option.label.trim().is_empty()
                        || option.label.trim() != option.label
                })
                || option_ids.windows(2).any(|pair| pair[0] == pair[1])
                || option_ids != authority.opaque_option_ids
                || poll.option_set_sha256 != authority.option_set_sha256
                || poll.min_choices != authority.min_choices
                || poll.max_choices != authority.max_choices
                || poll.expires_at != authority.expires_at
            {
                return Err("private poll Moment authority mismatch".to_string());
            }
            Ok(PrivateMomentContentProjection::Poll {
                text: poll.text.clone(),
                question: poll.question.clone(),
                options: poll
                    .options
                    .iter()
                    .map(|option| option.label.clone())
                    .collect(),
                min_choices: poll.min_choices,
                max_choices: poll.max_choices,
                expires_at_seconds: poll
                    .expires_at
                    .as_ref()
                    .map(|timestamp| timestamp.seconds)
                    .ok_or_else(|| "private poll Moment expiry is unavailable".to_string())?,
            })
        }
        Some(social::private_moment_content::Body::Repost(repost)) => {
            let authority = match private
                .verification
                .as_ref()
                .and_then(|verification| verification.subtype_authority.as_ref())
            {
                Some(social::private_content_verification::SubtypeAuthority::RepostAuthority(
                    authority,
                )) => authority,
                _ => return Err("private repost Moment authority is unavailable".to_string()),
            };
            let original_source = repost
                .original_source
                .as_ref()
                .ok_or_else(|| "private repost original source is unavailable".to_string())?;
            let rendered_source = repost
                .rendered_source
                .as_ref()
                .ok_or_else(|| "private repost rendered source is unavailable".to_string())?;
            let (rendered_ref, rendered_author, public_snapshot, source_kind, source_text) =
                rendered_repost_source_identity(rendered_source)?;
            let commitment = private_repost_snapshot_commitment(
                &repost.rendered_source_commitment_salt,
                rendered_source,
            )?;
            if kind != social::PrivateMomentKind::Repost
                || !private.objects.is_empty()
                || original_source
                    != authority.source.as_ref().ok_or_else(|| {
                        "private repost authority source is unavailable".to_string()
                    })?
                || rendered_ref != original_source
                || rendered_author
                    != authority.source_author.as_ref().ok_or_else(|| {
                        "private repost authority author is unavailable".to_string()
                    })?
                || commitment.as_slice() != authority.rendered_source_commitment
            {
                return Err("private repost Moment authority mismatch".to_string());
            }
            match (&authority.source_proof, public_snapshot) {
                (
                    Some(social::private_repost_authority::SourceProof::PublicSource(proof)),
                    Some(snapshot),
                ) if proof.canonical_public_post_sha256
                    == Sha256::digest(snapshot.encode_to_vec()).as_slice() => {}
                (
                    Some(social::private_repost_authority::SourceProof::PrivateSource(proof)),
                    None,
                ) if proof.source_resource.as_ref().is_some_and(|resource| {
                    resource.owner_domain == wire::SecureContentOwnerDomain::Social as i32
                        && resource.content_id == original_source.private_content_id
                        && resource.generation == original_source.private_generation
                }) => {}
                _ => return Err("private repost source proof class is invalid".to_string()),
            }
            Ok(PrivateMomentContentProjection::Repost {
                comment: repost.comment.clone(),
                source_post_id: original_source.post_id.clone(),
                source_author_ptid: rendered_author.ptid.clone(),
                source_kind,
                source_text,
            })
        }
        Some(social::private_moment_content::Body::Location(location)) => {
            let place = location
                .location
                .as_ref()
                .ok_or_else(|| "private location Moment place is missing".to_string())?;
            if kind != social::PrivateMomentKind::Location
                || !private.objects.is_empty()
                || !location.images.is_empty()
                || place.name.trim().is_empty()
                || !place.latitude.is_finite()
                || !place.longitude.is_finite()
                || !(-90.0..=90.0).contains(&place.latitude)
                || !(-180.0..=180.0).contains(&place.longitude)
            {
                return Err("private location Moment metadata is invalid".to_string());
            }
            Ok(PrivateMomentContentProjection::Location {
                text: location.text.clone(),
                name: place.name.clone(),
                latitude: place.latitude.to_string(),
                longitude: place.longitude.to_string(),
                address: place.address.clone(),
            })
        }
        _ => Err("private Moment subtype is unsupported by the W7 pilot".to_string()),
    }
}

fn rendered_repost_source_identity(
    rendered: &social::RenderedSourceSnapshot,
) -> Result<
    (
        &social::SocialPostSourceRef,
        &actor::ActorRef,
        Option<&social::PublicRenderedSourceSnapshot>,
        String,
        String,
    ),
    String,
> {
    match rendered.source_class.as_ref() {
        Some(social::rendered_source_snapshot::SourceClass::PublicSource(snapshot)) => {
            validate_public_rendered_source(snapshot)?;
            let source_text = match snapshot.body.as_ref() {
                Some(social::public_rendered_source_snapshot::Body::Text(body)) => {
                    body.text.clone()
                }
                Some(social::public_rendered_source_snapshot::Body::Image(body)) => {
                    body.text.clone()
                }
                Some(social::public_rendered_source_snapshot::Body::Video(body)) => {
                    body.text.clone()
                }
                Some(social::public_rendered_source_snapshot::Body::Link(body)) => {
                    body.text.clone()
                }
                Some(social::public_rendered_source_snapshot::Body::Poll(body)) => {
                    body.text.clone()
                }
                Some(social::public_rendered_source_snapshot::Body::Location(body)) => {
                    body.text.clone()
                }
                None => String::new(),
            };
            Ok((
                snapshot
                    .source
                    .as_ref()
                    .ok_or_else(|| "public rendered source identity is unavailable".to_string())?,
                snapshot
                    .author
                    .as_ref()
                    .ok_or_else(|| "public rendered source author is unavailable".to_string())?,
                Some(snapshot),
                social::PrivateRenderedSourceKind::try_from(snapshot.kind)
                    .map_err(|_| "public rendered source kind is invalid".to_string())?
                    .as_str_name()
                    .trim_start_matches("PRIVATE_RENDERED_SOURCE_KIND_")
                    .to_string(),
                source_text,
            ))
        }
        Some(social::rendered_source_snapshot::SourceClass::PrivateSource(snapshot)) => {
            validate_private_rendered_source(snapshot)?;
            let source_text = match snapshot.body.as_ref() {
                Some(social::private_rendered_source_snapshot::Body::Text(body)) => {
                    body.text.clone()
                }
                Some(social::private_rendered_source_snapshot::Body::Image(body)) => {
                    body.text.clone()
                }
                Some(social::private_rendered_source_snapshot::Body::Video(body)) => {
                    body.text.clone()
                }
                Some(social::private_rendered_source_snapshot::Body::Link(body)) => {
                    body.text.clone()
                }
                Some(social::private_rendered_source_snapshot::Body::Poll(body)) => {
                    body.text.clone()
                }
                Some(social::private_rendered_source_snapshot::Body::Location(body)) => {
                    body.text.clone()
                }
                None => String::new(),
            };
            Ok((
                snapshot
                    .source
                    .as_ref()
                    .ok_or_else(|| "private rendered source identity is unavailable".to_string())?,
                snapshot
                    .author
                    .as_ref()
                    .ok_or_else(|| "private rendered source author is unavailable".to_string())?,
                None,
                social::PrivateRenderedSourceKind::try_from(snapshot.kind)
                    .map_err(|_| "private rendered source kind is invalid".to_string())?
                    .as_str_name()
                    .trim_start_matches("PRIVATE_RENDERED_SOURCE_KIND_")
                    .to_string(),
                source_text,
            ))
        }
        None => Err("private repost rendered source class is unavailable".to_string()),
    }
}

fn validate_public_rendered_source(
    snapshot: &social::PublicRenderedSourceSnapshot,
) -> Result<(), String> {
    let source = snapshot
        .source
        .as_ref()
        .ok_or_else(|| "public rendered source identity is unavailable".to_string())?;
    let author = snapshot
        .author
        .as_ref()
        .ok_or_else(|| "public rendered source author is unavailable".to_string())?;
    if !canonical_identifier(&source.post_id)
        || !source.private_content_id.is_empty()
        || source.private_generation != 0
        || !canonical_identifier(&author.ptid)
        || author.acct.trim().is_empty()
        || checked_timestamp_millis(snapshot.created_at.as_ref(), "public rendered source time")
            .is_err()
    {
        return Err("public rendered source identity is invalid".to_string());
    }
    let valid_body = matches!(
        (
            social::PrivateRenderedSourceKind::try_from(snapshot.kind),
            snapshot.body.as_ref(),
        ),
        (
            Ok(social::PrivateRenderedSourceKind::Text),
            Some(social::public_rendered_source_snapshot::Body::Text(_))
        ) | (
            Ok(social::PrivateRenderedSourceKind::Image),
            Some(social::public_rendered_source_snapshot::Body::Image(_))
        ) | (
            Ok(social::PrivateRenderedSourceKind::Video),
            Some(social::public_rendered_source_snapshot::Body::Video(_))
        ) | (
            Ok(social::PrivateRenderedSourceKind::Link),
            Some(social::public_rendered_source_snapshot::Body::Link(_))
        ) | (
            Ok(social::PrivateRenderedSourceKind::Poll),
            Some(social::public_rendered_source_snapshot::Body::Poll(_))
        ) | (
            Ok(social::PrivateRenderedSourceKind::Location),
            Some(social::public_rendered_source_snapshot::Body::Location(_))
        )
    );
    if !valid_body {
        return Err("public rendered source kind/body is invalid".to_string());
    }
    Ok(())
}

fn validate_private_rendered_source(
    snapshot: &social::PrivateRenderedSourceSnapshot,
) -> Result<(), String> {
    let source = snapshot
        .source
        .as_ref()
        .ok_or_else(|| "private rendered source identity is unavailable".to_string())?;
    let author = snapshot
        .author
        .as_ref()
        .ok_or_else(|| "private rendered source author is unavailable".to_string())?;
    if !canonical_identifier(&source.post_id)
        || !canonical_identifier(&source.private_content_id)
        || source.private_generation == 0
        || !canonical_identifier(&author.ptid)
        || author.acct.trim().is_empty()
        || checked_timestamp_millis(snapshot.created_at.as_ref(), "private rendered source time")
            .is_err()
    {
        return Err("private rendered source identity is invalid".to_string());
    }
    let valid_body = matches!(
        (
            social::PrivateRenderedSourceKind::try_from(snapshot.kind),
            snapshot.body.as_ref(),
        ),
        (
            Ok(social::PrivateRenderedSourceKind::Text),
            Some(social::private_rendered_source_snapshot::Body::Text(_))
        ) | (
            Ok(social::PrivateRenderedSourceKind::Image),
            Some(social::private_rendered_source_snapshot::Body::Image(_))
        ) | (
            Ok(social::PrivateRenderedSourceKind::Video),
            Some(social::private_rendered_source_snapshot::Body::Video(_))
        ) | (
            Ok(social::PrivateRenderedSourceKind::Link),
            Some(social::private_rendered_source_snapshot::Body::Link(_))
        ) | (
            Ok(social::PrivateRenderedSourceKind::Poll),
            Some(social::private_rendered_source_snapshot::Body::Poll(_))
        ) | (
            Ok(social::PrivateRenderedSourceKind::Location),
            Some(social::private_rendered_source_snapshot::Body::Location(_))
        )
    );
    if !valid_body {
        return Err("private rendered source kind/body is invalid".to_string());
    }
    Ok(())
}

fn verify_response_integrity(
    session: &SecureContentSession,
    expected_post_id: &str,
    response: &social::GetMomentResourceResponse,
    sender_signing_key: Option<&VerifyingKey>,
    expected_recovery_epoch: Option<u64>,
) -> Result<(), String> {
    verify_response_integrity_at(
        session,
        expected_post_id,
        response,
        sender_signing_key,
        expected_recovery_epoch,
        current_unix_seconds(),
    )
}

fn verify_response_integrity_at(
    session: &SecureContentSession,
    expected_post_id: &str,
    response: &social::GetMomentResourceResponse,
    sender_signing_key: Option<&VerifyingKey>,
    expected_recovery_epoch: Option<u64>,
    now: i64,
) -> Result<(), String> {
    let parts = private_response_parts(response)?;
    let sender = validate_resource_identity(expected_post_id, &parts)?;
    if sender.committed_at_unix_ms > now.saturating_add(CLOCK_SKEW_SECONDS).saturating_mul(1_000) {
        return Err("private Moment commit time is in the future".to_string());
    }
    if parts.payload.format_version != PAYLOAD_FORMAT_VERSION
        || parts.payload.resource.as_ref() != Some(parts.resource)
        || parts.payload.suite != wire::PayloadEncryptionSuite::Aes256Gcm as i32
        || parts.payload.nonce.len() != 12
        || parts.payload.ciphertext.len() < 16
        || parts.payload.ciphertext.len() > 1024 * 1024
        || parts.payload.ciphertext_sha256.len() != 32
        || parts.payload.aad_sha256.len() != 32
        || Sha256::digest(&parts.payload.ciphertext).as_slice() != parts.payload.ciphertext_sha256
    {
        return Err("private Moment encrypted payload is invalid".to_string());
    }

    let kind = private_moment_kind(parts.metadata.r#type)?;
    let (subtype_prepare_authority_sha256, subtype_authority_hash) =
        validated_subtype_authority(parts.private, parts.verification, parts.resource, kind)?;
    let domain_binding = social::PrivateMomentDomainBinding {
        format_version: PAYLOAD_FORMAT_VERSION,
        kind: kind as i32,
        subtype_prepare_authority_sha256,
    }
    .encode_to_vec();
    let domain_binding_hash = Sha256::digest(domain_binding);
    let object_set_hash = validated_object_descriptor_set_hash(parts.private, parts.resource)?;
    let mention_routing_hash = validated_mention_routing_hash(
        parts.verification,
        parts.proof,
        parts.resource,
        parts.payload,
        &sender.sender,
        sender.signing_key_id.as_deref(),
        sender_signing_key,
        "private Moment",
    )?;
    let attestation = parts
        .verification
        .station_signing_key_attestation
        .as_ref()
        .ok_or_else(|| "private Moment Station attestation is unavailable".to_string())?;
    if parts.proof.format_version != PAYLOAD_FORMAT_VERSION
        || parts.proof.resource.as_ref() != Some(parts.resource)
        || parts.proof.canonical_plan_sha256.len() != 32
        || parts.proof.authorization_snapshot_sha256.len() != 32
        || parts.proof.domain_binding_sha256 != domain_binding_hash.as_slice()
        || parts.payload.aad_sha256 != domain_binding_hash.as_slice()
        || parts.proof.encrypted_payload_sha256
            != Sha256::digest(parts.payload.encode_to_vec()).as_slice()
        || parts.proof.object_descriptor_set_sha256 != object_set_hash
        || parts.proof.mention_routing_sha256 != mention_routing_hash.as_slice()
        || parts.proof.subtype_authority_sha256 != subtype_authority_hash.as_slice()
        || parts.proof.station_signing_key_id != attestation.proof_signing_key_id
        || !canonical_identifier(&parts.proof.station_signing_key_id)
        || parts.proof.station_signature.len() != 64
    {
        return Err("private Moment commit proof binding is invalid".to_string());
    }
    if let Some(envelope) = parts.envelope {
        let sender_signing_key = sender_signing_key
            .ok_or_else(|| "private Moment sender signing key is unavailable".to_string())?;
        verify_viewer_envelope(
            session,
            envelope,
            parts.payload,
            parts.proof,
            parts.resource,
            &object_set_hash,
            sender_signing_key,
            sender
                .signing_key_id
                .as_deref()
                .ok_or_else(|| "private Moment sender signing key ID is unavailable".to_string())?,
            expected_recovery_epoch,
        )?;
    } else if expected_recovery_epoch.is_some() {
        return Err("private Moment recovery envelope is unavailable".to_string());
    }

    let proof_key = verify_station_attestation(session, attestation, now)?;
    let mut proof_unsigned = parts.proof.clone();
    let signature = Signature::from_slice(&proof_unsigned.station_signature)
        .map_err(|_| "private Moment proof signature is invalid".to_string())?;
    proof_unsigned.station_signature.clear();
    proof_key
        .verify(&proof_unsigned.encode_to_vec(), &signature)
        .map_err(|_| "private Moment commit proof signature is invalid".to_string())?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn verify_viewer_envelope(
    session: &SecureContentSession,
    envelope: &wire::ViewerContentKeyEnvelope,
    payload: &wire::EncryptedPayload,
    proof: &wire::ViewerContentCommitProof,
    resource: &wire::SecureResourceRef,
    object_set_hash: &[u8; 32],
    sender_signing_key: &VerifyingKey,
    expected_sender_signing_key_id: &str,
    expected_recovery_epoch: Option<u64>,
) -> Result<(), String> {
    let binding = envelope
        .binding
        .as_ref()
        .ok_or_else(|| "private Moment envelope binding is unavailable".to_string())?;
    let plan_expires_at = checked_timestamp_millis(
        binding.plan_expires_at.as_ref(),
        "private Moment plan expiry",
    )?;
    let committed_at =
        checked_timestamp_millis(proof.committed_at.as_ref(), "private Moment commit time")?;
    if binding.format_version != PAYLOAD_FORMAT_VERSION
        || !canonical_identifier(&binding.plan_id)
        || binding.canonical_plan_sha256.len() != 32
        || binding.resource.as_ref() != Some(resource)
        || !canonical_identifier(&binding.recipient_slot_id)
        || !canonical_identifier(&binding.recipient_key_id)
        || binding.principal_binding_sha256.len() != 32
        || binding.authorization_snapshot_sha256 != proof.authorization_snapshot_sha256
        || binding.canonical_plan_sha256 != proof.canonical_plan_sha256
        || binding.payload_ciphertext_sha256 != payload.ciphertext_sha256
        || binding.object_descriptor_set_sha256 != object_set_hash
        || binding.sender.as_ref() != proof.author.as_ref()
        || !canonical_identifier(&binding.sender_signing_key_id)
        || binding.sender_signing_key_id != expected_sender_signing_key_id
        || envelope.binding_sha256 != Sha256::digest(binding.encode_to_vec()).as_slice()
        || envelope.hpke_encapsulated_key.len() != 32
        || envelope.hpke_ciphertext.len() != 48
        || envelope.sender_signature.len() != 64
        || envelope.principal_epoch == 0
        || committed_at > plan_expires_at
    {
        return Err("private Moment envelope binding is invalid".to_string());
    }
    match envelope.recipient.as_ref() {
        Some(wire::viewer_content_key_envelope::Recipient::Endpoint(endpoint))
            if binding.recipient_key_kind
                == wire::ContentPreKeyKind::ContentPrekeyKindEndpoint as i32
                && endpoint.actor.as_ref().map(|actor| actor.ptid.as_str())
                    == Some(session.key.actor_ptid.as_str())
                && endpoint.device_id == session.key.device_id
                && expected_recovery_epoch.is_none() => {}
        Some(wire::viewer_content_key_envelope::Recipient::RecoveryActor(actor))
            if binding.recipient_key_kind
                == wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery as i32
                && actor.ptid == session.key.actor_ptid
                && expected_recovery_epoch
                    .map(|epoch| epoch == envelope.principal_epoch)
                    .unwrap_or(false) => {}
        _ => {
            // #region debug-point C:recovery-recipient-identity
            let (recovery_actor, actor_matches) = match envelope.recipient.as_ref() {
                Some(wire::viewer_content_key_envelope::Recipient::RecoveryActor(actor)) => {
                    (true, actor.ptid == session.key.actor_ptid)
                }
                _ => (false, false),
            };
            let key_kind_matches = binding.recipient_key_kind
                == wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery as i32;
            let epoch_matches = expected_recovery_epoch
                .map(|epoch| epoch == envelope.principal_epoch)
                .unwrap_or(false);
            return Err(format!(
                "private Moment envelope recipient kind or epoch is invalid \
                 [debug: recovery_actor={recovery_actor}, key_kind={key_kind_matches}, \
                 actor={actor_matches}, epoch={epoch_matches}]"
            ));
            // #endregion
        }
    }
    let signature = Signature::from_slice(&envelope.sender_signature)
        .map_err(|_| "private Moment sender signature is invalid".to_string())?;
    sender_signing_key
        .verify(&binding.encode_to_vec(), &signature)
        .map_err(|_| "private Moment sender signature is invalid".to_string())
}

pub(super) fn validated_object_descriptor_set_hash(
    private: &social::PrivateContentAccess,
    resource: &wire::SecureResourceRef,
) -> Result<[u8; 32], String> {
    if private.objects.len() > 10
        || !private
            .objects
            .windows(2)
            .all(|objects| objects[0].object_id < objects[1].object_id)
    {
        return Err("private Moment object descriptor order is invalid".to_string());
    }
    for descriptor in &private.objects {
        if !canonical_identifier(&descriptor.object_id)
            || descriptor.resource.as_ref() != Some(resource)
            || descriptor
                .commitment
                .as_ref()
                .and_then(|commitment| commitment.resource.as_ref())
                != Some(resource)
        {
            return Err("private Moment object descriptor binding is invalid".to_string());
        }
        let core =
            SocialObjectCodec::descriptor_to_core(descriptor).map_err(|error| error.to_string())?;
        validate_object_descriptor(&core)?;
    }
    object_descriptor_set_hash(&private.objects)
}

pub(super) fn object_descriptor_set_hash(
    descriptors: &[wire::EncryptedObjectDescriptor],
) -> Result<[u8; 32], String> {
    let mut encoder = CanonicalMessageEncoder::new();
    for descriptor in descriptors {
        encoder
            .repeated_bytes(1, &descriptor.encode_to_vec())
            .map_err(|error| error.to_string())?;
    }
    Ok(Sha256::digest(encoder.finish()).into())
}

pub(super) fn private_poll_option_set_hash(
    opaque_option_ids: &[Vec<u8>],
) -> Result<[u8; 32], String> {
    let mut encoder = CanonicalMessageEncoder::new();
    for option_id in opaque_option_ids {
        encoder
            .repeated_bytes(1, option_id)
            .map_err(|error| error.to_string())?;
    }
    Ok(Sha256::digest(encoder.finish()).into())
}

fn validated_subtype_authority(
    private: &social::PrivateContentAccess,
    verification: &social::PrivateContentVerification,
    resource: &wire::SecureResourceRef,
    kind: social::PrivateMomentKind,
) -> Result<(Vec<u8>, [u8; 32]), String> {
    let empty_hash: [u8; 32] = Sha256::digest([]).into();
    match kind {
        social::PrivateMomentKind::Poll => {
            let authority = match verification.subtype_authority.as_ref() {
                Some(social::private_content_verification::SubtypeAuthority::PollAuthority(
                    authority,
                )) => authority,
                _ => return Err("private poll Moment authority is unavailable".to_string()),
            };
            let expires_at = authority
                .expires_at
                .as_ref()
                .ok_or_else(|| "private poll Moment expiry is unavailable".to_string())?;
            if authority.resource.as_ref() != Some(resource)
                || authority.opaque_option_ids.len() < 2
                || authority.opaque_option_ids.len() > 20
                || authority.min_choices < 1
                || authority.min_choices > authority.max_choices
                || authority.max_choices > authority.opaque_option_ids.len() as u32
                || checked_timestamp_millis(Some(expires_at), "private poll Moment expiry").is_err()
                || authority
                    .opaque_option_ids
                    .iter()
                    .any(|option_id| option_id.len() != 32)
                || !authority
                    .opaque_option_ids
                    .windows(2)
                    .all(|pair| pair[0] < pair[1])
            {
                return Err("private poll Moment authority is invalid".to_string());
            }
            let option_set_hash = private_poll_option_set_hash(&authority.opaque_option_ids)?;
            if authority.option_set_sha256.as_slice() != option_set_hash.as_slice() {
                return Err("private poll Moment option-set commitment is invalid".to_string());
            }
            if let Some(poll) = private.poll.as_ref() {
                let projected_ids = poll
                    .options
                    .iter()
                    .map(|option| option.opaque_option_id.as_slice())
                    .collect::<Vec<_>>();
                let authority_ids = authority
                    .opaque_option_ids
                    .iter()
                    .map(Vec::as_slice)
                    .collect::<Vec<_>>();
                if projected_ids != authority_ids {
                    return Err("private poll Moment vote projection is invalid".to_string());
                }
            }
            let canonical = authority.encode_to_vec();
            let hash: [u8; 32] = Sha256::digest(&canonical).into();
            Ok((hash.to_vec(), hash))
        }
        social::PrivateMomentKind::Repost => {
            let authority = match verification.subtype_authority.as_ref() {
                Some(social::private_content_verification::SubtypeAuthority::RepostAuthority(
                    authority,
                )) => authority,
                _ => return Err("private repost Moment authority is unavailable".to_string()),
            };
            let source = authority
                .source
                .as_ref()
                .ok_or_else(|| "private repost source identity is unavailable".to_string())?;
            let source_author = authority
                .source_author
                .as_ref()
                .ok_or_else(|| "private repost source author is unavailable".to_string())?;
            if !canonical_identifier(&source.post_id)
                || !canonical_identifier(&source_author.ptid)
                || source_author.acct.trim().is_empty()
                || authority.rendered_source_commitment.len() != 32
            {
                return Err("private repost Moment authority is invalid".to_string());
            }
            match authority.source_proof.as_ref() {
                Some(social::private_repost_authority::SourceProof::PublicSource(proof))
                    if source.private_content_id.is_empty()
                        && source.private_generation == 0
                        && proof.canonical_public_post_sha256.len() == 32 => {}
                Some(social::private_repost_authority::SourceProof::PrivateSource(proof))
                    if canonical_identifier(&source.private_content_id)
                        && source.private_generation > 0
                        && proof
                            .source_resource
                            .as_ref()
                            .is_some_and(|source_resource| {
                                source_resource.owner_domain
                                    == wire::SecureContentOwnerDomain::Social as i32
                                    && source_resource.content_id == source.private_content_id
                                    && source_resource.generation == source.private_generation
                            })
                        && proof.source_authorization_snapshot_sha256.len() == 32
                        && proof.source_encrypted_payload_sha256.len() == 32
                        && proof.source_commit_proof_sha256.len() == 32 => {}
                _ => return Err("private repost Moment source proof is invalid".to_string()),
            }
            let canonical = authority.encode_to_vec();
            let hash: [u8; 32] = Sha256::digest(&canonical).into();
            Ok((hash.to_vec(), hash))
        }
        _ => {
            if verification.subtype_authority.is_some() || private.poll.is_some() {
                return Err("private Moment has unexpected subtype authority".to_string());
            }
            Ok((Vec::new(), empty_hash))
        }
    }
}

pub(super) fn verify_station_attestation(
    session: &SecureContentSession,
    attestation: &wire::StationContentSigningKeyAttestation,
    now: i64,
) -> Result<VerifyingKey, String> {
    let issued = attestation
        .issued_at
        .as_ref()
        .ok_or_else(|| "private Moment Station attestation issue time is missing".to_string())?;
    let expires = attestation
        .expires_at
        .as_ref()
        .ok_or_else(|| "private Moment Station attestation expiry is missing".to_string())?;
    if attestation.format_version != 1
        || attestation.station_peer_id != session.key.station_peer_id
        || attestation.attesting_signing_key_id != session.trusted_station_signing_key.key_id
        || attestation.proof_ed25519_public_key.len() != 32
        || attestation.station_signature.len() != 64
        || !(0..1_000_000_000).contains(&issued.nanos)
        || !(0..1_000_000_000).contains(&expires.nanos)
        || issued.seconds > now.saturating_add(CLOCK_SKEW_SECONDS)
        || expires.seconds < now
        || expires.seconds.saturating_sub(issued.seconds) != 300
    {
        return Err("private Moment Station attestation is invalid".to_string());
    }
    let mut unsigned = attestation.clone();
    let signature = Signature::from_slice(&unsigned.station_signature)
        .map_err(|_| "private Moment Station attestation signature is invalid".to_string())?;
    unsigned.station_signature.clear();
    let mut bytes = Vec::with_capacity(STATION_ATTESTATION_DOMAIN.len() + unsigned.encoded_len());
    bytes.extend_from_slice(STATION_ATTESTATION_DOMAIN);
    bytes.extend_from_slice(&unsigned.encode_to_vec());
    session
        .trusted_station_signing_key
        .verifying_key
        .verify(&bytes, &signature)
        .map_err(|_| "private Moment Station attestation signature is invalid".to_string())?;
    VerifyingKey::from_bytes(
        attestation
            .proof_ed25519_public_key
            .as_slice()
            .try_into()
            .map_err(|_| "private Moment proof key is invalid".to_string())?,
    )
    .map_err(|_| "private Moment proof key is invalid".to_string())
}

pub(super) fn current_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().min(i64::MAX as u64) as i64)
        .unwrap_or_default()
}

fn private_moment_kind(post_type: i32) -> Result<social::PrivateMomentKind, String> {
    match social::PostType::try_from(post_type).ok() {
        Some(social::PostType::Text) => Ok(social::PrivateMomentKind::Text),
        Some(social::PostType::Image) => Ok(social::PrivateMomentKind::Image),
        Some(social::PostType::Video) => Ok(social::PrivateMomentKind::Video),
        Some(social::PostType::Link) => Ok(social::PrivateMomentKind::Link),
        Some(social::PostType::Poll) => Ok(social::PrivateMomentKind::Poll),
        Some(social::PostType::Repost) => Ok(social::PrivateMomentKind::Repost),
        Some(social::PostType::Location) => Ok(social::PrivateMomentKind::Location),
        _ => Err("private Moment subtype is unsupported".to_string()),
    }
}

pub(super) fn canonical_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.len() <= MAX_IDENTIFIER_BYTES
        && !value.as_bytes().contains(&0)
}

fn is_valid_private_audience_kind(kind: i32) -> bool {
    matches!(
        social::audience::Kind::try_from(kind),
        Ok(social::audience::Kind::Friends
            | social::audience::Kind::Followers
            | social::audience::Kind::Circle
            | social::audience::Kind::Group
            | social::audience::Kind::Self_
            | social::audience::Kind::CustomAllow
            | social::audience::Kind::CustomDeny)
    )
}

fn private_audience_kind(kind: i32) -> Result<&'static str, String> {
    match social::audience::Kind::try_from(kind) {
        Ok(social::audience::Kind::Friends) => Ok("FRIENDS"),
        Ok(social::audience::Kind::Followers) => Ok("FOLLOWERS"),
        Ok(social::audience::Kind::Circle) => Ok("CIRCLE"),
        Ok(social::audience::Kind::Group) => Ok("GROUP"),
        Ok(social::audience::Kind::Self_) => Ok("SELF"),
        Ok(social::audience::Kind::CustomAllow) => Ok("CUSTOM_ALLOW"),
        Ok(social::audience::Kind::CustomDeny) => Ok("CUSTOM_DENY"),
        _ => Err("private Moment audience kind is unsupported".to_string()),
    }
}

pub(super) fn checked_timestamp_millis(
    value: Option<&prost_types::Timestamp>,
    field: &str,
) -> Result<i64, String> {
    let timestamp = value.ok_or_else(|| format!("{field} is unavailable"))?;
    if timestamp.seconds <= 0 || !(0..1_000_000_000).contains(&timestamp.nanos) {
        return Err(format!("{field} is invalid"));
    }
    timestamp
        .seconds
        .checked_mul(1_000)
        .and_then(|seconds| seconds.checked_add(i64::from(timestamp.nanos) / 1_000_000))
        .ok_or_else(|| format!("{field} is invalid"))
}

fn timestamp_ms(value: Option<&prost_types::Timestamp>) -> Option<i64> {
    checked_timestamp_millis(value, "private Moment timestamp").ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secure_content::station_trust::TrustedStationSigningKey;
    use ed25519_dalek::{Signer, SigningKey};

    fn session(trusted_signing_key: &SigningKey) -> SecureContentSession {
        SecureContentSession::new(
            crate::secure_content::SecureContentSessionKey {
                station_peer_id: "station-1".to_string(),
                actor_ptid: "ptid:alice".to_string(),
                device_id: "device-1".to_string(),
                jwt_session_id: "session-1".to_string(),
                window_label: "main".to_string(),
                session_generation: 1,
            },
            "account-1".to_string(),
            "https://station.test".to_string(),
            "token".to_string(),
            "device-key-1".to_string(),
            1,
            SigningKey::from_bytes(&[9; 32]),
            TrustedStationSigningKey {
                key_id: "station-key-current".to_string(),
                verifying_key: trusted_signing_key.verifying_key(),
            },
        )
    }

    fn attestation(
        attesting_key: &SigningKey,
        proof_key: &SigningKey,
        now: i64,
    ) -> wire::StationContentSigningKeyAttestation {
        let mut attestation = wire::StationContentSigningKeyAttestation {
            format_version: 1,
            station_peer_id: "station-1".to_string(),
            proof_signing_key_id: "station-key-historical".to_string(),
            proof_ed25519_public_key: proof_key.verifying_key().to_bytes().to_vec(),
            attesting_signing_key_id: "station-key-current".to_string(),
            issued_at: Some(prost_types::Timestamp {
                seconds: now,
                nanos: 0,
            }),
            expires_at: Some(prost_types::Timestamp {
                seconds: now + 300,
                nanos: 0,
            }),
            station_signature: Vec::new(),
        };
        let mut bytes =
            Vec::with_capacity(STATION_ATTESTATION_DOMAIN.len() + attestation.encoded_len());
        bytes.extend_from_slice(STATION_ATTESTATION_DOMAIN);
        bytes.extend_from_slice(&attestation.encode_to_vec());
        attestation.station_signature = attesting_key.sign(&bytes).to_bytes().to_vec();
        attestation
    }

    fn signed_response(
        station_key: &SigningKey,
        proof_key: &SigningKey,
        sender_key: &SigningKey,
        now: i64,
    ) -> social::GetMomentResourceResponse {
        let resource = wire::SecureResourceRef {
            owner_domain: wire::SecureContentOwnerDomain::Social as i32,
            content_id: "post-1".to_string(),
            generation: 1,
        };
        let author = actor::ActorDeviceRef {
            actor: Some(actor::ActorRef {
                ptid: "ptid:bob".to_string(),
                acct: "@bob@station.test".to_string(),
                kind: actor::ActorKind::Person as i32,
            }),
            device_id: "device-bob".to_string(),
        };
        let domain_binding = social::PrivateMomentDomainBinding {
            format_version: PAYLOAD_FORMAT_VERSION,
            kind: social::PrivateMomentKind::Text as i32,
            subtype_prepare_authority_sha256: Vec::new(),
        }
        .encode_to_vec();
        let ciphertext = vec![3; 16];
        let payload = wire::EncryptedPayload {
            format_version: PAYLOAD_FORMAT_VERSION,
            resource: Some(resource.clone()),
            suite: wire::PayloadEncryptionSuite::Aes256Gcm as i32,
            nonce: vec![4; 12],
            ciphertext_sha256: Sha256::digest(&ciphertext).to_vec(),
            aad_sha256: Sha256::digest(domain_binding).to_vec(),
            ciphertext,
        };
        let empty_hash = Sha256::digest([]).to_vec();
        let mut proof = wire::ViewerContentCommitProof {
            format_version: PAYLOAD_FORMAT_VERSION,
            domain_commit_id: "post-1".to_string(),
            canonical_plan_sha256: vec![5; 32],
            resource: Some(resource.clone()),
            author: Some(author.clone()),
            authorization_snapshot_sha256: vec![6; 32],
            domain_binding_sha256: payload.aad_sha256.clone(),
            encrypted_payload_sha256: Sha256::digest(payload.encode_to_vec()).to_vec(),
            object_descriptor_set_sha256: empty_hash.clone(),
            mention_routing_sha256: empty_hash.clone(),
            subtype_authority_sha256: empty_hash,
            committed_at: Some(prost_types::Timestamp {
                seconds: now - 30,
                nanos: 0,
            }),
            station_signing_key_id: "station-key-historical".to_string(),
            station_signature: Vec::new(),
        };
        resign_proof(&mut proof, proof_key);
        let mut envelope = wire::ViewerContentKeyEnvelope {
            binding: Some(wire::ContentKeyEnvelopeBinding {
                format_version: PAYLOAD_FORMAT_VERSION,
                plan_id: "plan-1".to_string(),
                canonical_plan_sha256: proof.canonical_plan_sha256.clone(),
                resource: Some(resource),
                recipient_slot_id: "slot-1".to_string(),
                recipient_key_kind: wire::ContentPreKeyKind::ContentPrekeyKindEndpoint as i32,
                recipient_key_id: "prekey-1".to_string(),
                principal_binding_sha256: vec![7; 32],
                authorization_snapshot_sha256: proof.authorization_snapshot_sha256.clone(),
                payload_ciphertext_sha256: payload.ciphertext_sha256.clone(),
                object_descriptor_set_sha256: proof.object_descriptor_set_sha256.clone(),
                plan_expires_at: Some(prost_types::Timestamp {
                    seconds: now + 120,
                    nanos: 0,
                }),
                sender: Some(author),
                sender_signing_key_id: "sender-key-1".to_string(),
            }),
            recipient: Some(wire::viewer_content_key_envelope::Recipient::Endpoint(
                actor::ActorDeviceRef {
                    actor: Some(actor::ActorRef {
                        ptid: "ptid:alice".to_string(),
                        kind: actor::ActorKind::Person as i32,
                        ..Default::default()
                    }),
                    device_id: "device-1".to_string(),
                },
            )),
            binding_sha256: Vec::new(),
            hpke_encapsulated_key: vec![8; 32],
            hpke_ciphertext: vec![9; 48],
            sender_signature: Vec::new(),
            principal_epoch: 7,
        };
        resign_envelope(&mut envelope, sender_key);
        social::GetMomentResourceResponse {
            post: None,
            explanation: None,
            reaction_projection_revision: 0,
            resource: Some(social::PostResource {
                metadata: Some(social::PostMetadata {
                    post_id: "post-1".to_string(),
                    content_id: "post-1".to_string(),
                    author: proof
                        .author
                        .as_ref()
                        .and_then(|author| author.actor.clone()),
                    r#type: social::PostType::Text as i32,
                    audience_kind: social::audience::Kind::Friends as i32,
                    created_at: proof.committed_at,
                    updated_at: proof.committed_at,
                    is_deleted: false,
                    stats: Some(Default::default()),
                }),
                body: Some(social::post_resource::Body::PrivateContent(
                    social::PrivateContentAccess {
                        payload: Some(payload),
                        viewer_envelope: Some(envelope),
                        objects: Vec::new(),
                        poll: None,
                        verification: Some(social::PrivateContentVerification {
                            commit_proof: Some(proof),
                            mention_routing: None,
                            subtype_authority: None,
                            station_signing_key_attestation: Some(attestation(
                                station_key,
                                proof_key,
                                now,
                            )),
                            receiver_verified_sender_signing_key: None,
                        }),
                    },
                )),
            }),
        }
    }

    fn resign_proof(proof: &mut wire::ViewerContentCommitProof, proof_key: &SigningKey) {
        proof.station_signature.clear();
        proof.station_signature = proof_key.sign(&proof.encode_to_vec()).to_bytes().to_vec();
    }

    fn resign_envelope(envelope: &mut wire::ViewerContentKeyEnvelope, sender_key: &SigningKey) {
        let binding = envelope.binding.as_ref().unwrap().encode_to_vec();
        envelope.binding_sha256 = Sha256::digest(&binding).to_vec();
        envelope.sender_signature = sender_key.sign(&binding).to_bytes().to_vec();
    }

    fn private_access_mut(
        response: &mut social::GetMomentResourceResponse,
    ) -> &mut social::PrivateContentAccess {
        match response
            .resource
            .as_mut()
            .and_then(|resource| resource.body.as_mut())
        {
            Some(social::post_resource::Body::PrivateContent(private)) => private,
            _ => panic!("test response must contain private content"),
        }
    }

    fn proof_mut(
        response: &mut social::GetMomentResourceResponse,
    ) -> &mut wire::ViewerContentCommitProof {
        private_access_mut(response)
            .verification
            .as_mut()
            .and_then(|verification| verification.commit_proof.as_mut())
            .unwrap()
    }

    fn envelope_mut(
        response: &mut social::GetMomentResourceResponse,
    ) -> &mut wire::ViewerContentKeyEnvelope {
        private_access_mut(response)
            .viewer_envelope
            .as_mut()
            .unwrap()
    }

    #[test]
    fn secure_content_non_ready_projection_never_serializes_plaintext() {
        let projection = PrivateMomentProjection {
            post_id: "post-1".to_string(),
            content_id: "content-1".to_string(),
            generation: "1".to_string(),
            author_ptid: "ptid:alice".to_string(),
            audience_kind: "FRIENDS".to_string(),
            state: PrivateReadState::RecoveryRequired,
            mentions: Vec::new(),
            reactions: Vec::new(),
            reaction_revision: "0".to_string(),
            reactions_hydrated: false,
            content: None,
            error_code: Some("RECOVERY_REQUIRED".to_string()),
            retry_after_seconds: None,
            created_at_millis: None,
            updated_at_millis: None,
        };
        let encoded = projection.encode_local().unwrap();
        assert!(!String::from_utf8_lossy(&encoded).contains("\"content\""));
        assert_eq!(
            PrivateMomentProjection::decode_local(&encoded).unwrap(),
            projection
        );
    }

    #[test]
    fn private_reaction_readback_rejects_duplicates_and_preserves_large_counts() {
        let response = social::GetMomentResourceResponse {
            post: Some(social::Post {
                id: "post-1".to_string(),
                reactions: vec![
                    social::ReactionSummary {
                        kind: social::ReactionKind::ReactionLove as i32,
                        count: i64::MAX,
                        reacted_by_viewer: true,
                    },
                    social::ReactionSummary {
                        kind: social::ReactionKind::ReactionLike as i32,
                        count: 2,
                        reacted_by_viewer: false,
                    },
                ],
                ..Default::default()
            }),
            reaction_projection_revision: 7,
            ..Default::default()
        };
        let (summaries, revision, hydrated) =
            source_reaction_summaries(&response, "post-1").unwrap();
        assert_eq!(summaries[0].kind, social::ReactionKind::ReactionLike as i32);
        assert_eq!(summaries[1].count, i64::MAX.to_string());
        assert_eq!(revision, "7");
        assert!(hydrated);

        assert!(canonical_reaction_summaries(&[
            social::ReactionSummary {
                kind: social::ReactionKind::ReactionLike as i32,
                count: 1,
                reacted_by_viewer: true,
            },
            social::ReactionSummary {
                kind: social::ReactionKind::ReactionLike as i32,
                count: 1,
                reacted_by_viewer: true,
            },
        ])
        .is_err());
    }

    #[test]
    fn secure_content_poll_projection_requires_exact_authority_equality() {
        let resource = wire::SecureResourceRef {
            owner_domain: wire::SecureContentOwnerDomain::Social as i32,
            content_id: "content-poll".to_string(),
            generation: 1,
        };
        let option_ids = vec![vec![0x11; 32], vec![0x22; 32]];
        let option_set_sha256 = private_poll_option_set_hash(&option_ids).unwrap();
        let authority = social::PrivatePollAuthority {
            resource: Some(resource.clone()),
            opaque_option_ids: option_ids.clone(),
            option_set_sha256: option_set_sha256.to_vec(),
            min_choices: 1,
            max_choices: 1,
            expires_at: Some(prost_types::Timestamp {
                seconds: 4_000_000_000,
                nanos: 0,
            }),
        };
        let private = social::PrivateContentAccess {
            poll: Some(social::PrivatePollProjection {
                options: option_ids
                    .iter()
                    .map(|option_id| social::PrivatePollOptionResult {
                        opaque_option_id: option_id.clone(),
                        vote_count: 0,
                        selected_by_viewer: false,
                    })
                    .collect(),
                voter_count: 0,
            }),
            verification: Some(social::PrivateContentVerification {
                subtype_authority: Some(
                    social::private_content_verification::SubtypeAuthority::PollAuthority(
                        authority.clone(),
                    ),
                ),
                ..Default::default()
            }),
            ..Default::default()
        };
        let verification = private.verification.as_ref().unwrap();
        let (domain_field, proof_hash) = validated_subtype_authority(
            &private,
            verification,
            &resource,
            social::PrivateMomentKind::Poll,
        )
        .unwrap();
        assert_eq!(domain_field, proof_hash);
        let expected_proof_hash: [u8; 32] = Sha256::digest(authority.encode_to_vec()).into();
        assert_eq!(proof_hash, expected_proof_hash);

        let content = social::PrivateMomentContent {
            format_version: PAYLOAD_FORMAT_VERSION,
            body: Some(social::private_moment_content::Body::Poll(
                social::PrivatePollContent {
                    text: "private".to_string(),
                    question: "Choose one".to_string(),
                    options: vec![
                        social::PrivatePollOption {
                            opaque_option_id: option_ids[1].clone(),
                            label: "Second".to_string(),
                        },
                        social::PrivatePollOption {
                            opaque_option_id: option_ids[0].clone(),
                            label: "First".to_string(),
                        },
                    ],
                    option_set_sha256: option_set_sha256.to_vec(),
                    min_choices: 1,
                    max_choices: 1,
                    expires_at: authority.expires_at.clone(),
                    mentions: Vec::new(),
                },
            )),
            mention_commitment_salt: Vec::new(),
        };
        assert!(matches!(
            project_plaintext(
                &content,
                &private,
                social::PrivateMomentKind::Poll,
                PrivateMediaAccessPath::HomeStationLocalObject,
            )
            .unwrap(),
            PrivateMomentContentProjection::Poll { .. }
        ));

        let mut tampered = content;
        let Some(social::private_moment_content::Body::Poll(poll)) = tampered.body.as_mut() else {
            unreachable!();
        };
        poll.options[0].opaque_option_id[0] ^= 1;
        assert!(project_plaintext(
            &tampered,
            &private,
            social::PrivateMomentKind::Poll,
            PrivateMediaAccessPath::HomeStationLocalObject,
        )
        .is_err());
    }

    #[test]
    fn secure_content_decrypted_mentions_require_exact_hmac_coverage() {
        let salt = [0x31; 32];
        let mention = social::Mention {
            actor_ptid: "ptid:bob".to_string(),
            offset: 6,
            length: 4,
            display: "bob".to_string(),
        };
        let mut mac = HmacSha256::new_from_slice(&salt).unwrap();
        mac.update(crate::social::private_mention::MENTION_COMMITMENT_DOMAIN);
        mac.update(&mention.encode_to_vec());
        let routing = social::SignedMentionRouting {
            facts: vec![social::MentionRoutingFact {
                mentioned_actor: Some(actor::ActorRef {
                    ptid: mention.actor_ptid.clone(),
                    kind: actor::ActorKind::Person as i32,
                    ..Default::default()
                }),
                mention_commitment: mac.finalize().into_bytes().to_vec(),
            }],
            ..Default::default()
        };
        let private = social::PrivateContentAccess {
            verification: Some(social::PrivateContentVerification {
                mention_routing: Some(routing),
                ..Default::default()
            }),
            ..Default::default()
        };
        let content = social::PrivateMomentContent {
            format_version: PAYLOAD_FORMAT_VERSION,
            body: Some(social::private_moment_content::Body::Text(
                social::PrivateTextContent {
                    text: "hello @bob".to_string(),
                    mentions: vec![mention],
                    ..Default::default()
                },
            )),
            mention_commitment_salt: salt.to_vec(),
        };

        assert_eq!(
            verified_private_mentions(&content, &private).unwrap(),
            vec![PrivateMentionProjection {
                actor_ptid: "ptid:bob".to_string(),
                offset: 6,
                length: 4,
                display: "bob".to_string(),
            }]
        );

        let mut tampered = content;
        let Some(social::private_moment_content::Body::Text(body)) = tampered.body.as_mut() else {
            unreachable!();
        };
        body.mentions[0].display = "eve".to_string();
        assert!(verified_private_mentions(&tampered, &private).is_err());
    }

    #[test]
    fn secure_content_repost_projection_binds_current_public_source_snapshot() {
        let source_author = actor::ActorRef {
            ptid: "ptid:source".to_string(),
            acct: "source@station.test".to_string(),
            kind: actor::ActorKind::Person as i32,
        };
        let created_at = prost_types::Timestamp {
            seconds: 1_900_000_000,
            nanos: 0,
        };
        let source_post = social::Post {
            id: "701".to_string(),
            author_ptid: source_author.ptid.clone(),
            r#type: social::PostType::Text as i32,
            created_at: Some(created_at),
            audience: Some(social::Audience {
                kind: social::audience::Kind::Public as i32,
                ..Default::default()
            }),
            content: Some(social::post::Content::TextPost(social::TextPost {
                text: "public source".to_string(),
                ..Default::default()
            })),
            ..Default::default()
        };
        let source_response = social::GetMomentResourceResponse {
            post: Some(source_post.clone()),
            resource: Some(social::PostResource {
                metadata: Some(social::PostMetadata {
                    post_id: source_post.id.clone(),
                    content_id: source_post.id.clone(),
                    author: Some(source_author),
                    r#type: source_post.r#type,
                    audience_kind: social::audience::Kind::Public as i32,
                    created_at: source_post.created_at,
                    updated_at: source_post.created_at,
                    ..Default::default()
                }),
                body: Some(social::post_resource::Body::PublicContent(
                    social::PublicPostContent {
                        post: Some(source_post),
                    },
                )),
            }),
            ..Default::default()
        };
        let salt = [0x31; 32];
        let material =
            repost_source_material_from_response("701", &source_response, None, &salt).unwrap();
        let content = social::PrivateMomentContent {
            format_version: PAYLOAD_FORMAT_VERSION,
            body: Some(social::private_moment_content::Body::Repost(
                social::PrivateRepostContent {
                    comment: "quoted".to_string(),
                    original_source: material.authority.source.clone(),
                    rendered_source: Some(material.rendered_source.clone()),
                    rendered_source_commitment_salt: salt.to_vec(),
                    ..Default::default()
                },
            )),
            mention_commitment_salt: Vec::new(),
        };
        let private = social::PrivateContentAccess {
            verification: Some(social::PrivateContentVerification {
                subtype_authority: Some(
                    social::private_content_verification::SubtypeAuthority::RepostAuthority(
                        material.authority.clone(),
                    ),
                ),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(matches!(
            project_plaintext(
                &content,
                &private,
                social::PrivateMomentKind::Repost,
                PrivateMediaAccessPath::HomeStationLocalObject,
            )
            .unwrap(),
            PrivateMomentContentProjection::Repost { .. }
        ));

        let mut tampered = content;
        let Some(social::private_moment_content::Body::Repost(repost)) = tampered.body.as_mut()
        else {
            unreachable!();
        };
        let Some(social::rendered_source_snapshot::SourceClass::PublicSource(source)) = repost
            .rendered_source
            .as_mut()
            .and_then(|rendered| rendered.source_class.as_mut())
        else {
            unreachable!();
        };
        let Some(social::public_rendered_source_snapshot::Body::Text(text)) = source.body.as_mut()
        else {
            unreachable!();
        };
        text.text = "tampered".to_string();
        assert!(project_plaintext(
            &tampered,
            &private,
            social::PrivateMomentKind::Repost,
            PrivateMediaAccessPath::HomeStationLocalObject,
        )
        .is_err());
    }

    #[test]
    fn secure_content_historical_proof_key_requires_current_station_pin() {
        let now = current_unix_seconds();
        let trusted = SigningKey::from_bytes(&[7; 32]);
        let historical = SigningKey::from_bytes(&[8; 32]);
        let session = session(&trusted);
        let attestation = attestation(&trusted, &historical, now);

        let resolved = verify_station_attestation(&session, &attestation, now).unwrap();

        assert_eq!(resolved, historical.verifying_key());
    }

    #[test]
    fn secure_content_rejects_attacker_supplied_attestation_root() {
        let now = 1_900_000_000;
        let trusted = SigningKey::from_bytes(&[7; 32]);
        let attacker = SigningKey::from_bytes(&[6; 32]);
        let historical = SigningKey::from_bytes(&[8; 32]);
        let session = session(&trusted);
        let forged = attestation(&attacker, &historical, now);

        assert!(verify_station_attestation(&session, &forged, now).is_err());
    }

    #[test]
    fn secure_content_rejects_unpinned_attesting_key_identity() {
        let now = 1_900_000_000;
        let trusted = SigningKey::from_bytes(&[7; 32]);
        let historical = SigningKey::from_bytes(&[8; 32]);
        let session = session(&trusted);
        let mut forged = attestation(&trusted, &historical, now);
        forged.attesting_signing_key_id = "station-key-attacker".to_string();

        assert!(verify_station_attestation(&session, &forged, now).is_err());
    }

    #[test]
    fn secure_content_recipient_accepts_exact_signed_binding_chain() {
        let now = 1_900_000_000;
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let proof_key = SigningKey::from_bytes(&[8; 32]);
        let sender_key = SigningKey::from_bytes(&[6; 32]);
        let response = signed_response(&station_key, &proof_key, &sender_key, now);

        verify_response_integrity_at(
            &session(&station_key),
            "post-1",
            &response,
            Some(&sender_key.verifying_key()),
            None,
            now,
        )
        .unwrap();

        let mut recovery_point = response.clone();
        private_access_mut(&mut recovery_point).viewer_envelope = None;
        verify_response_integrity_at(
            &session(&station_key),
            "post-1",
            &recovery_point,
            None,
            None,
            now,
        )
        .unwrap();
    }

    #[test]
    fn federated_private_text_decrypts_exact_receiver_projection() {
        use crate::secure_content::store::{PublicationState, StoredPublication};

        let response_bytes = hex::decode(
            include_str!(
                "../../../../../model/domain/social/testdata/federated_private_text_receiver_response.hex"
            )
            .trim(),
        )
        .unwrap();
        let response =
            social::GetMomentResourceResponse::decode(response_bytes.as_slice()).unwrap();
        let private = match response
            .resource
            .as_ref()
            .and_then(|resource| resource.body.as_ref())
        {
            Some(social::post_resource::Body::PrivateContent(private)) => private,
            _ => panic!("fixture must contain receiver private content"),
        };
        let verification = private.verification.as_ref().unwrap();
        let attestation = verification
            .station_signing_key_attestation
            .as_ref()
            .unwrap();
        let endpoint = match private
            .viewer_envelope
            .as_ref()
            .and_then(|envelope| envelope.recipient.as_ref())
        {
            Some(wire::viewer_content_key_envelope::Recipient::Endpoint(endpoint)) => endpoint,
            _ => panic!("fixture must contain Bob's endpoint envelope"),
        };
        let envelope = private.viewer_envelope.as_ref().unwrap();
        let binding = envelope.binding.as_ref().unwrap();
        let receiver_station_key = SigningKey::from_bytes(&[0x62; 32]);
        let receiver_session = SecureContentSession::new(
            crate::secure_content::SecureContentSessionKey {
                station_peer_id: attestation.station_peer_id.clone(),
                actor_ptid: endpoint.actor.as_ref().unwrap().ptid.clone(),
                device_id: endpoint.device_id.clone(),
                jwt_session_id: "fixture-session".to_string(),
                window_label: "main".to_string(),
                session_generation: 1,
            },
            "fixture-account".to_string(),
            "https://station-remote.test".to_string(),
            "fixture-token".to_string(),
            "fixture-device-key".to_string(),
            1,
            SigningKey::from_bytes(&[9; 32]),
            TrustedStationSigningKey {
                key_id: attestation.attesting_signing_key_id.clone(),
                verifying_key: receiver_station_key.verifying_key(),
            },
        );
        let post_id = response
            .resource
            .as_ref()
            .and_then(|resource| resource.metadata.as_ref())
            .map(|metadata| metadata.post_id.as_str())
            .unwrap();
        let now = attestation.issued_at.as_ref().unwrap().seconds;
        let sender = sender_key_requirement(post_id, &response).unwrap();
        let sender_key = super::super::private_moment::receiver_verified_sender_signing_key(
            &response,
            &sender.sender,
            sender.signing_key_id.as_deref().unwrap(),
            sender.committed_at_unix_ms,
        )
        .unwrap()
        .unwrap();
        let endpoint_prekey = ContentPreKeyPrivate::from_bytes([0x0b; 32]);
        let endpoint_public = *endpoint_prekey.public_key().as_bytes();
        let store = SecureContentStore::in_memory().unwrap();
        let publication_bytes = b"federated-private-text-fixture".to_vec();
        store
            .persist_prekey_publication(
                &StoredPublication {
                    command_id: "federated-private-text-fixture".to_string(),
                    key_kind: wire::ContentPreKeyKind::ContentPrekeyKindEndpoint as i32,
                    pool_epoch: envelope.principal_epoch,
                    request_sha256: Sha256::digest(&publication_bytes).into(),
                    request_bytes: publication_bytes,
                    state: PublicationState::PendingPublication,
                    lease_generation: 0,
                    session_generation: 0,
                },
                &[(
                    binding.recipient_key_id.clone(),
                    Some(endpoint_prekey.to_bytes()),
                    endpoint_public,
                )],
            )
            .unwrap();

        let decrypted = decrypt_projection_from_response_at(
            &receiver_session,
            &store,
            post_id,
            &response,
            Some(&sender_key),
            None,
            None,
            now,
        )
        .unwrap();
        assert_eq!(
            response
                .explanation
                .as_ref()
                .and_then(|explanation| explanation.source.as_ref())
                .map(|source| source.station_peer_id.as_str()),
            Some("station-local"),
        );
        assert_eq!(attestation.station_peer_id, "station-remote");
        assert_eq!(
            decrypted.projection.content,
            Some(PrivateMomentContentProjection::Text {
                text: "cross-station exact text".to_string(),
            }),
        );
        assert_eq!(
            decrypted.consumed_prekey.as_deref(),
            Some(binding.recipient_key_id.as_str()),
        );
    }

    #[test]
    fn secure_content_recipient_verifies_signed_mention_routing() {
        let now = 1_900_000_000;
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let proof_key = SigningKey::from_bytes(&[8; 32]);
        let sender_key = SigningKey::from_bytes(&[6; 32]);
        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        let private = private_access_mut(&mut response);
        let proof = private
            .verification
            .as_ref()
            .and_then(|verification| verification.commit_proof.as_ref())
            .unwrap()
            .clone();
        let mut routing = social::SignedMentionRouting {
            format_version: PAYLOAD_FORMAT_VERSION,
            resource: proof.resource.clone(),
            authorization_snapshot_sha256: proof.authorization_snapshot_sha256.clone(),
            encrypted_payload_sha256: proof.encrypted_payload_sha256.clone(),
            facts: vec![social::MentionRoutingFact {
                mentioned_actor: Some(actor::ActorRef {
                    ptid: "ptid:alice".to_string(),
                    kind: actor::ActorKind::Person as i32,
                    ..Default::default()
                }),
                mention_commitment: vec![0x42; 32],
            }],
            sender: proof.author.clone(),
            sender_signing_key_id: "sender-key-1".to_string(),
            canonical_facts_sha256: Vec::new(),
            sender_signature: Vec::new(),
        };
        routing.canonical_facts_sha256 = Sha256::digest(routing.encode_to_vec()).to_vec();
        routing.sender_signature = sender_key
            .sign(&routing.canonical_facts_sha256)
            .to_bytes()
            .to_vec();
        let routing_hash = Sha256::digest(routing.encode_to_vec()).to_vec();
        let verification = private.verification.as_mut().unwrap();
        verification.mention_routing = Some(routing);
        verification
            .commit_proof
            .as_mut()
            .unwrap()
            .mention_routing_sha256 = routing_hash;
        resign_proof(verification.commit_proof.as_mut().unwrap(), &proof_key);

        verify_response_integrity_at(
            &session(&station_key),
            "post-1",
            &response,
            Some(&sender_key.verifying_key()),
            None,
            now,
        )
        .unwrap();

        private_access_mut(&mut response)
            .verification
            .as_mut()
            .unwrap()
            .mention_routing
            .as_mut()
            .unwrap()
            .facts[0]
            .mention_commitment[0] ^= 1;
        assert!(verify_response_integrity_at(
            &session(&station_key),
            "post-1",
            &response,
            Some(&sender_key.verifying_key()),
            None,
            now,
        )
        .is_err());
    }

    #[test]
    fn secure_content_recovery_verifies_the_attached_historical_epoch() {
        let now = current_unix_seconds();
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let proof_key = SigningKey::from_bytes(&[8; 32]);
        let sender_key = SigningKey::from_bytes(&[6; 32]);
        let session = session(&station_key);
        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        let envelope = envelope_mut(&mut response);
        envelope.binding.as_mut().unwrap().recipient_key_kind =
            wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery as i32;
        envelope.recipient = Some(wire::viewer_content_key_envelope::Recipient::RecoveryActor(
            actor::ActorRef {
                ptid: session.key.actor_ptid.clone(),
                kind: actor::ActorKind::Person as i32,
                ..Default::default()
            },
        ));
        resign_envelope(envelope, &sender_key);
        let recovery_envelope = envelope.clone();

        verify_recovery_envelope_for_response(
            &session,
            "post-1",
            &response,
            &recovery_envelope,
            recovery_envelope.principal_epoch,
            &sender_key.verifying_key(),
        )
        .unwrap();
    }

    #[test]
    fn secure_content_recipient_rejects_identity_and_timestamp_substitution() {
        let now = 1_900_000_000;
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let proof_key = SigningKey::from_bytes(&[8; 32]);
        let sender_key = SigningKey::from_bytes(&[6; 32]);
        let session = session(&station_key);
        let rejects = |response: &social::GetMomentResourceResponse, requested: &str| {
            assert!(verify_response_integrity_at(
                &session,
                requested,
                response,
                Some(&sender_key.verifying_key()),
                None,
                now,
            )
            .is_err());
        };

        rejects(
            &signed_response(&station_key, &proof_key, &sender_key, now),
            "post-substituted",
        );

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        response
            .resource
            .as_mut()
            .unwrap()
            .metadata
            .as_mut()
            .unwrap()
            .post_id = "post-substituted".to_string();
        rejects(&response, "post-1");

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        proof_mut(&mut response).domain_commit_id = "commit-substituted".to_string();
        resign_proof(proof_mut(&mut response), &proof_key);
        rejects(&response, "post-1");

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        response
            .resource
            .as_mut()
            .unwrap()
            .metadata
            .as_mut()
            .unwrap()
            .author = Some(actor::ActorRef {
            ptid: "ptid:mallory".to_string(),
            ..Default::default()
        });
        rejects(&response, "post-1");

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        response
            .resource
            .as_mut()
            .unwrap()
            .metadata
            .as_mut()
            .unwrap()
            .is_deleted = true;
        rejects(&response, "post-1");

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        proof_mut(&mut response).committed_at = Some(prost_types::Timestamp {
            seconds: now - 20,
            nanos: 0,
        });
        resign_proof(proof_mut(&mut response), &proof_key);
        rejects(&response, "post-1");

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        let future = prost_types::Timestamp {
            seconds: now + CLOCK_SKEW_SECONDS + 1,
            nanos: 0,
        };
        let metadata = response
            .resource
            .as_mut()
            .unwrap()
            .metadata
            .as_mut()
            .unwrap();
        metadata.created_at = Some(future);
        metadata.updated_at = Some(future);
        proof_mut(&mut response).committed_at = Some(future);
        resign_proof(proof_mut(&mut response), &proof_key);
        rejects(&response, "post-1");
    }

    #[test]
    fn secure_content_recipient_rejects_commitment_substitution() {
        let now = 1_900_000_000;
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let proof_key = SigningKey::from_bytes(&[8; 32]);
        let sender_key = SigningKey::from_bytes(&[6; 32]);
        let session = session(&station_key);
        let rejects = |response: &social::GetMomentResourceResponse| {
            assert!(verify_response_integrity_at(
                &session,
                "post-1",
                response,
                Some(&sender_key.verifying_key()),
                None,
                now,
            )
            .is_err());
        };

        for mutate in [
            |proof: &mut wire::ViewerContentCommitProof| proof.format_version += 1,
            |proof: &mut wire::ViewerContentCommitProof| proof.canonical_plan_sha256[0] ^= 1,
            |proof: &mut wire::ViewerContentCommitProof| {
                proof.authorization_snapshot_sha256[0] ^= 1
            },
            |proof: &mut wire::ViewerContentCommitProof| proof.domain_binding_sha256[0] ^= 1,
            |proof: &mut wire::ViewerContentCommitProof| proof.encrypted_payload_sha256[0] ^= 1,
            |proof: &mut wire::ViewerContentCommitProof| proof.object_descriptor_set_sha256[0] ^= 1,
            |proof: &mut wire::ViewerContentCommitProof| proof.mention_routing_sha256[0] ^= 1,
            |proof: &mut wire::ViewerContentCommitProof| proof.subtype_authority_sha256[0] ^= 1,
        ] {
            let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
            mutate(proof_mut(&mut response));
            resign_proof(proof_mut(&mut response), &proof_key);
            rejects(&response);
        }

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        private_access_mut(&mut response)
            .payload
            .as_mut()
            .unwrap()
            .aad_sha256[0] ^= 1;
        rejects(&response);
    }

    #[test]
    fn secure_content_recipient_rejects_envelope_substitution() {
        let now = 1_900_000_000;
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let proof_key = SigningKey::from_bytes(&[8; 32]);
        let sender_key = SigningKey::from_bytes(&[6; 32]);
        let session = session(&station_key);
        let rejects = |response: &social::GetMomentResourceResponse| {
            assert!(verify_response_integrity_at(
                &session,
                "post-1",
                response,
                Some(&sender_key.verifying_key()),
                None,
                now,
            )
            .is_err());
        };

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        envelope_mut(&mut response)
            .binding
            .as_mut()
            .unwrap()
            .format_version += 1;
        resign_envelope(envelope_mut(&mut response), &sender_key);
        rejects(&response);

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        envelope_mut(&mut response)
            .binding
            .as_mut()
            .unwrap()
            .canonical_plan_sha256[0] ^= 1;
        resign_envelope(envelope_mut(&mut response), &sender_key);
        rejects(&response);

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        envelope_mut(&mut response)
            .binding
            .as_mut()
            .unwrap()
            .authorization_snapshot_sha256[0] ^= 1;
        resign_envelope(envelope_mut(&mut response), &sender_key);
        rejects(&response);

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        envelope_mut(&mut response)
            .binding
            .as_mut()
            .unwrap()
            .payload_ciphertext_sha256[0] ^= 1;
        resign_envelope(envelope_mut(&mut response), &sender_key);
        rejects(&response);

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        envelope_mut(&mut response)
            .binding
            .as_mut()
            .unwrap()
            .object_descriptor_set_sha256[0] ^= 1;
        resign_envelope(envelope_mut(&mut response), &sender_key);
        rejects(&response);

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        envelope_mut(&mut response)
            .binding
            .as_mut()
            .unwrap()
            .resource = Some(wire::SecureResourceRef {
            owner_domain: wire::SecureContentOwnerDomain::Social as i32,
            content_id: "post-substituted".to_string(),
            generation: 1,
        });
        resign_envelope(envelope_mut(&mut response), &sender_key);
        rejects(&response);

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        envelope_mut(&mut response)
            .binding
            .as_mut()
            .unwrap()
            .sender
            .as_mut()
            .unwrap()
            .device_id = "device-substituted".to_string();
        resign_envelope(envelope_mut(&mut response), &sender_key);
        rejects(&response);

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        envelope_mut(&mut response)
            .binding
            .as_mut()
            .unwrap()
            .recipient_key_kind = wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery as i32;
        resign_envelope(envelope_mut(&mut response), &sender_key);
        rejects(&response);

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        envelope_mut(&mut response).principal_epoch = 0;
        rejects(&response);

        let mut response = signed_response(&station_key, &proof_key, &sender_key, now);
        envelope_mut(&mut response).sender_signature[0] ^= 1;
        rejects(&response);
    }
}
