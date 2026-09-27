use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use prost::Message;
use secure_content_core::codec::CanonicalMessageEncoder;
use secure_content_core::envelope::{open_content_key, ContentKey, SealedContentKey};
use secure_content_core::payload::{
    decrypt_payload, derive_payload_key, EncryptedPayload as CoreEncryptedPayload,
    PayloadKeyContext, PAYLOAD_FORMAT_VERSION,
};
use secure_content_core::prekey::ContentPreKeyPrivate;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::secure_content::proto::{
    actor::v1 as actor, error::v1 as error_model, secure_content::v1 as wire, social::v1 as social,
};
use crate::secure_content::store::PrivateSocialStore;
use crate::secure_content::transport::{TransportDisposition, TransportError};
use crate::secure_content::NativeSocialSession;

const STATION_ATTESTATION_DOMAIN: &[u8] =
    b"peers-touch:secure-content:station-content-signing-key-attestation:v1\0";
const CLOCK_SKEW_SECONDS: i64 = 60;
const MAX_IDENTIFIER_BYTES: usize = 128;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrivateReadState {
    RecoveryRequired,
    ContentReady,
    AuthenticationRequired,
    NotFoundOrNotAuthorized,
    IntegrityFailure,
    DeletedOrRevoked,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrivateReadContent {
    Text { text: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateMomentReadProjection {
    pub post_id: String,
    pub content_id: String,
    pub generation: String,
    pub author_ptid: String,
    pub audience_kind: String,
    pub state: PrivateReadState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<PrivateReadContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at_millis: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at_millis: Option<i64>,
}

impl PrivateMomentReadProjection {
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(self).map_err(|error| error.to_string())
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        serde_json::from_slice(bytes).map_err(|error| error.to_string())
    }
}

pub struct DecryptedPrivateTextMoment {
    pub projection: PrivateMomentReadProjection,
    pub content_key: ContentKey,
    pub consumed_prekey_id: Option<String>,
}

pub struct SenderKeyRequirement {
    pub sender: actor::ActorDeviceRef,
    pub signing_key_id: Option<String>,
    pub committed_at_unix_ms: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrivateReadFailureKind {
    RecoveryRequired,
    IntegrityFailure,
    Retryable,
}

#[derive(Debug)]
pub struct PrivateReadError {
    pub kind: PrivateReadFailureKind,
    message: Option<String>,
}

impl PrivateReadError {
    fn recovery_required() -> Self {
        Self {
            kind: PrivateReadFailureKind::RecoveryRequired,
            message: None,
        }
    }

    fn integrity() -> Self {
        Self {
            kind: PrivateReadFailureKind::IntegrityFailure,
            message: None,
        }
    }

    fn retryable(message: impl Into<String>) -> Self {
        Self {
            kind: PrivateReadFailureKind::Retryable,
            message: Some(message.into()),
        }
    }
}

impl std::fmt::Display for PrivateReadError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(
            self.message
                .as_deref()
                .unwrap_or("private Social content verification failed"),
        )
    }
}

impl std::error::Error for PrivateReadError {}

impl From<String> for PrivateReadError {
    fn from(_: String) -> Self {
        Self::integrity()
    }
}

pub fn sender_key_requirement(
    expected_post_id: &str,
    response: &social::GetMomentResourceResponse,
) -> Result<SenderKeyRequirement, String> {
    let parts = private_response_parts(response)?;
    validate_resource_identity(expected_post_id, &parts)
}

pub fn decrypt_text_projection(
    session: &NativeSocialSession,
    store: &PrivateSocialStore,
    expected_post_id: &str,
    response: &social::GetMomentResourceResponse,
    sender_signing_key: Option<&VerifyingKey>,
) -> Result<DecryptedPrivateTextMoment, PrivateReadError> {
    verify_response_integrity(
        session,
        expected_post_id,
        response,
        sender_signing_key,
        current_unix_seconds(),
    )?;
    let parts = private_response_parts(response)?;
    let metadata = parts.metadata;
    let private = parts.private;
    let payload = parts.payload;
    let resource = parts.resource;

    let (content_key, consumed_prekey_id) = if let Some(root) = store
        .content_root(&resource.content_id, resource.generation)
        .map_err(PrivateReadError::retryable)?
    {
        (ContentKey::from_bytes(root), None)
    } else {
        let envelope = private
            .viewer_envelope
            .as_ref()
            .ok_or_else(PrivateReadError::recovery_required)?;
        let binding = envelope
            .binding
            .as_ref()
            .ok_or_else(PrivateReadError::integrity)?;
        let endpoint = match envelope.recipient.as_ref() {
            Some(wire::viewer_content_key_envelope::Recipient::Endpoint(endpoint)) => endpoint,
            _ => return Err(PrivateReadError::recovery_required()),
        };
        if endpoint.actor.as_ref().map(|actor| actor.ptid.as_str())
            != Some(session.scope.actor_ptid.as_str())
            || endpoint.device_id != session.scope.device_id
        {
            return Err(PrivateReadError::integrity());
        }
        let stored = store
            .endpoint_prekey(&binding.recipient_key_id)
            .map_err(PrivateReadError::retryable)?
            .ok_or_else(PrivateReadError::recovery_required)?;
        if binding.recipient_key_kind != wire::ContentPreKeyKind::ContentPrekeyKindEndpoint as i32
            || envelope.principal_epoch != stored.pool_epoch
        {
            return Err(PrivateReadError::integrity());
        }
        let content_key = open_content_key(
            &ContentPreKeyPrivate::from_bytes(stored.private_key),
            &binding.encode_to_vec(),
            &SealedContentKey {
                encapsulated_key: envelope.hpke_encapsulated_key.clone(),
                ciphertext: envelope.hpke_ciphertext.clone(),
            },
        )?;
        (content_key, Some(stored.key_id.clone()))
    };

    let domain_binding = text_domain_binding();
    let authorization_snapshot: [u8; 32] = parts
        .proof
        .authorization_snapshot_sha256
        .as_slice()
        .try_into()
        .map_err(|_| PrivateReadError::integrity())?;
    let payload_key = derive_payload_key(
        content_key.as_bytes(),
        &authorization_snapshot,
        &PayloadKeyContext {
            protocol_version: payload.format_version,
            owner_domain: resource.owner_domain as u32,
            content_id: &resource.content_id,
            generation: resource.generation,
            payload_kind: social::PrivateMomentKind::Text as u32,
        },
    )?;
    let plaintext = decrypt_payload(
        &payload_key,
        &CoreEncryptedPayload {
            nonce: payload
                .nonce
                .as_slice()
                .try_into()
                .map_err(|_| PrivateReadError::integrity())?,
            ciphertext: payload.ciphertext.clone(),
            ciphertext_sha256: payload
                .ciphertext_sha256
                .as_slice()
                .try_into()
                .map_err(|_| PrivateReadError::integrity())?,
            aad_sha256: payload
                .aad_sha256
                .as_slice()
                .try_into()
                .map_err(|_| PrivateReadError::integrity())?,
        },
        &domain_binding,
    )?;
    let decoded = social::PrivateMomentContent::decode(plaintext.as_slice())
        .map_err(|_| PrivateReadError::integrity())?;
    let text = match decoded.body {
        Some(social::private_moment_content::Body::Text(text))
            if decoded.format_version == PAYLOAD_FORMAT_VERSION
                && text.mentions.is_empty()
                && decoded.mention_commitment_salt.is_empty() =>
        {
            text.text
        }
        _ => return Err(PrivateReadError::integrity()),
    };

    Ok(DecryptedPrivateTextMoment {
        projection: PrivateMomentReadProjection {
            post_id: metadata.post_id.clone(),
            content_id: metadata.content_id.clone(),
            generation: resource.generation.to_string(),
            author_ptid: metadata
                .author
                .as_ref()
                .map(|author| author.ptid.clone())
                .unwrap_or_default(),
            audience_kind: private_audience_kind(metadata.audience_kind)?.to_string(),
            state: PrivateReadState::ContentReady,
            content: Some(PrivateReadContent::Text { text }),
            error_code: None,
            retry_after_seconds: None,
            created_at_millis: timestamp_millis(metadata.created_at.as_ref()),
            updated_at_millis: timestamp_millis(metadata.updated_at.as_ref()),
        },
        content_key,
        consumed_prekey_id,
    })
}

pub fn terminal_projection_for_transport_error(
    post_id: &str,
    error: &TransportError,
) -> Option<PrivateMomentReadProjection> {
    let (state, error_code) = match (error.typed_error, error.http_status, error.stable_code) {
        (true, Some(401), code) if code == error_model::ErrorCode::Unauthorized as i32 => (
            PrivateReadState::AuthenticationRequired,
            "AUTHENTICATION_REQUIRED",
        ),
        (true, Some(404), code) if code == error_model::ErrorCode::PostNotFound as i32 => (
            PrivateReadState::NotFoundOrNotAuthorized,
            "NOT_FOUND_OR_NOT_AUTHORIZED",
        ),
        _ => return None,
    };
    Some(terminal_projection(post_id, state, error_code, None))
}

pub fn transport_error_is_retryable(error: &TransportError) -> bool {
    error.http_status.is_none()
        || error.http_status.is_some_and(|status| status >= 500)
        || matches!(
            error.disposition,
            TransportDisposition::Retryable
                | TransportDisposition::UnknownOutcome
                | TransportDisposition::PoolNotFound
        )
}

pub fn projection_for_read_failure(
    post_id: &str,
    failure: PrivateReadFailureKind,
) -> Option<PrivateMomentReadProjection> {
    let (state, code) = match failure {
        PrivateReadFailureKind::RecoveryRequired => {
            (PrivateReadState::RecoveryRequired, "RECOVERY_REQUIRED")
        }
        PrivateReadFailureKind::IntegrityFailure => (
            PrivateReadState::IntegrityFailure,
            "PRIVATE_CONTENT_VERIFICATION_FAILED",
        ),
        PrivateReadFailureKind::Retryable => return None,
    };
    Some(terminal_projection(post_id, state, code, None))
}

pub fn purges_private_material(state: &PrivateReadState) -> bool {
    matches!(state, PrivateReadState::NotFoundOrNotAuthorized)
}

fn terminal_projection(
    post_id: &str,
    state: PrivateReadState,
    error_code: &str,
    retry_after_seconds: Option<u64>,
) -> PrivateMomentReadProjection {
    PrivateMomentReadProjection {
        post_id: post_id.to_string(),
        content_id: format!("unavailable:{post_id}"),
        generation: "0".to_string(),
        author_ptid: String::new(),
        audience_kind: "UNKNOWN".to_string(),
        state,
        content: None,
        error_code: Some(error_code.to_string()),
        retry_after_seconds,
        created_at_millis: None,
        updated_at_millis: None,
    }
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
        || parts.metadata.r#type != social::PostType::Text as i32
        || !is_private_audience_kind(parts.metadata.audience_kind)
        || metadata_author != proof_actor
        || envelope_binding
            .and_then(|binding| binding.sender.as_ref())
            .is_some_and(|sender| sender != proof_author)
        || !canonical_ptid(&proof_actor.ptid)
        || !canonical_identifier(&proof_author.device_id)
        || envelope_binding
            .is_some_and(|binding| !canonical_identifier(&binding.sender_signing_key_id))
        || created_at != committed_at
        || updated_at < committed_at
    {
        return Err("private Moment resource identity is invalid".to_string());
    }
    Ok(SenderKeyRequirement {
        sender: proof_author.clone(),
        signing_key_id: envelope_binding.map(|binding| binding.sender_signing_key_id.clone()),
        committed_at_unix_ms: committed_at,
    })
}

fn verify_response_integrity(
    session: &NativeSocialSession,
    expected_post_id: &str,
    response: &social::GetMomentResourceResponse,
    sender_signing_key: Option<&VerifyingKey>,
    now: i64,
) -> Result<(), String> {
    let parts = private_response_parts(response)?;
    let sender = validate_resource_identity(expected_post_id, &parts)?;
    if sender.committed_at_unix_ms > now.saturating_add(CLOCK_SKEW_SECONDS).saturating_mul(1_000) {
        return Err("private Moment commit time is in the future".to_string());
    }
    let domain_binding = text_domain_binding();
    let domain_binding_hash = Sha256::digest(&domain_binding);
    let empty_hash = empty_object_descriptor_set_hash()?;
    if parts.payload.format_version != PAYLOAD_FORMAT_VERSION
        || parts.payload.resource.as_ref() != Some(parts.resource)
        || parts.payload.suite != wire::PayloadEncryptionSuite::Aes256Gcm as i32
        || parts.payload.nonce.len() != 12
        || parts.payload.ciphertext.len() < 16
        || parts.payload.ciphertext.len() > 1024 * 1024
        || parts.payload.ciphertext_sha256.len() != 32
        || parts.payload.aad_sha256 != domain_binding_hash.as_slice()
        || Sha256::digest(&parts.payload.ciphertext).as_slice() != parts.payload.ciphertext_sha256
        || !parts.private.objects.is_empty()
        || parts.private.poll.is_some()
        || parts.verification.mention_routing.is_some()
        || parts.verification.subtype_authority.is_some()
        || parts.proof.format_version != PAYLOAD_FORMAT_VERSION
        || parts.proof.resource.as_ref() != Some(parts.resource)
        || parts.proof.canonical_plan_sha256.len() != 32
        || parts.proof.authorization_snapshot_sha256.len() != 32
        || parts.proof.domain_binding_sha256 != domain_binding_hash.as_slice()
        || parts.proof.encrypted_payload_sha256
            != Sha256::digest(parts.payload.encode_to_vec()).as_slice()
        || parts.proof.object_descriptor_set_sha256 != empty_hash
        || parts.proof.mention_routing_sha256 != Sha256::digest([]).as_slice()
        || parts.proof.subtype_authority_sha256 != Sha256::digest([]).as_slice()
        || parts.proof.station_signature.len() != 64
    {
        return Err("private Moment encrypted proof binding is invalid".to_string());
    }
    if let Some(envelope) = parts.envelope {
        verify_viewer_envelope(
            session,
            envelope,
            parts.payload,
            parts.proof,
            parts.resource,
            &empty_hash,
            sender_signing_key
                .ok_or_else(|| "private Moment sender signing key is unavailable".to_string())?,
            sender
                .signing_key_id
                .as_deref()
                .ok_or_else(|| "private Moment sender signing key ID is unavailable".to_string())?,
        )?;
    }
    let attestation = parts
        .verification
        .station_signing_key_attestation
        .as_ref()
        .ok_or_else(|| "private Moment Station attestation is unavailable".to_string())?;
    if parts.proof.station_signing_key_id != attestation.proof_signing_key_id
        || !canonical_identifier(&parts.proof.station_signing_key_id)
    {
        return Err("private Moment proof key identity is invalid".to_string());
    }
    let proof_key = verify_station_attestation(session, attestation, now)?;
    let mut proof = parts.proof.clone();
    let signature = Signature::from_slice(&proof.station_signature)
        .map_err(|_| "private Moment proof signature is invalid".to_string())?;
    proof.station_signature.clear();
    proof_key
        .verify(&proof.encode_to_vec(), &signature)
        .map_err(|_| "private Moment commit proof signature is invalid".to_string())
}

#[allow(clippy::too_many_arguments)]
fn verify_viewer_envelope(
    session: &NativeSocialSession,
    envelope: &wire::ViewerContentKeyEnvelope,
    payload: &wire::EncryptedPayload,
    proof: &wire::ViewerContentCommitProof,
    resource: &wire::SecureResourceRef,
    object_set_hash: &[u8; 32],
    sender_signing_key: &VerifyingKey,
    expected_sender_signing_key_id: &str,
) -> Result<(), String> {
    let binding = envelope
        .binding
        .as_ref()
        .ok_or_else(|| "private Moment envelope binding is unavailable".to_string())?;
    let endpoint = match envelope.recipient.as_ref() {
        Some(wire::viewer_content_key_envelope::Recipient::Endpoint(endpoint)) => endpoint,
        _ => return Err("private Moment endpoint envelope is unavailable".to_string()),
    };
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
        || binding.recipient_key_kind != wire::ContentPreKeyKind::ContentPrekeyKindEndpoint as i32
        || binding.principal_binding_sha256.len() != 32
        || binding.authorization_snapshot_sha256 != proof.authorization_snapshot_sha256
        || binding.canonical_plan_sha256 != proof.canonical_plan_sha256
        || binding.payload_ciphertext_sha256 != payload.ciphertext_sha256
        || binding.object_descriptor_set_sha256 != object_set_hash
        || binding.sender.as_ref() != proof.author.as_ref()
        || binding.sender_signing_key_id != expected_sender_signing_key_id
        || endpoint.actor.as_ref().map(|actor| actor.ptid.as_str())
            != Some(session.scope.actor_ptid.as_str())
        || endpoint.device_id != session.scope.device_id
        || envelope.binding_sha256 != Sha256::digest(binding.encode_to_vec()).as_slice()
        || envelope.hpke_encapsulated_key.len() != 32
        || envelope.hpke_ciphertext.len() != 48
        || envelope.sender_signature.len() != 64
        || envelope.principal_epoch == 0
        || committed_at > plan_expires_at
    {
        return Err("private Moment envelope binding is invalid".to_string());
    }
    let signature = Signature::from_slice(&envelope.sender_signature)
        .map_err(|_| "private Moment sender signature is invalid".to_string())?;
    sender_signing_key
        .verify(&binding.encode_to_vec(), &signature)
        .map_err(|_| "private Moment sender signature is invalid".to_string())
}

fn verify_station_attestation(
    session: &NativeSocialSession,
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
    if attestation.format_version != PAYLOAD_FORMAT_VERSION
        || attestation.station_peer_id != session.scope.station_peer_id
        || attestation.attesting_signing_key_id != session.trusted_station_signing_key.key_id
        || !canonical_identifier(&attestation.proof_signing_key_id)
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

fn text_domain_binding() -> Vec<u8> {
    social::PrivateMomentDomainBinding {
        format_version: PAYLOAD_FORMAT_VERSION,
        kind: social::PrivateMomentKind::Text as i32,
        subtype_prepare_authority_sha256: Vec::new(),
    }
    .encode_to_vec()
}

fn empty_object_descriptor_set_hash() -> Result<[u8; 32], String> {
    Ok(Sha256::digest(CanonicalMessageEncoder::new().finish()).into())
}

fn is_private_audience_kind(kind: i32) -> bool {
    matches!(
        social::audience::Kind::try_from(kind),
        Ok(social::audience::Kind::Friends
            | social::audience::Kind::Followers
            | social::audience::Kind::Circle
            | social::audience::Kind::Self_
            | social::audience::Kind::CustomAllow)
    )
}

fn private_audience_kind(kind: i32) -> Result<&'static str, String> {
    match social::audience::Kind::try_from(kind) {
        Ok(social::audience::Kind::Friends) => Ok("FRIENDS"),
        Ok(social::audience::Kind::Followers) => Ok("FOLLOWERS"),
        Ok(social::audience::Kind::Circle) => Ok("CIRCLE"),
        Ok(social::audience::Kind::Self_) => Ok("SELF"),
        Ok(social::audience::Kind::CustomAllow) => Ok("CUSTOM_ALLOW"),
        _ => Err("private Moment audience kind is unsupported".to_string()),
    }
}

fn canonical_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.len() <= MAX_IDENTIFIER_BYTES
        && !value.as_bytes().contains(&0)
}

fn canonical_ptid(value: &str) -> bool {
    canonical_identifier(value) && value.starts_with("ptid:")
}

fn checked_timestamp_millis(
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

fn timestamp_millis(value: Option<&prost_types::Timestamp>) -> Option<i64> {
    checked_timestamp_millis(value, "private Moment timestamp").ok()
}

fn current_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().min(i64::MAX as u64) as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use messaging_core::identity::DeviceSigningKey;
    use secure_content_core::envelope::seal_content_key;
    use secure_content_core::payload::{encrypt_payload_with_nonce, PayloadKeyContext};
    use secure_content_core::prekey::ContentPreKeyPrivate;
    use zeroize::Zeroizing;

    use crate::secure_content::store::{DurableState, StoredPreKeyPublication};
    use crate::secure_content::{PrivateSocialScope, TrustedStationSigningKey};

    fn session(station_key: &SigningKey) -> NativeSocialSession {
        NativeSocialSession::new(
            PrivateSocialScope {
                profile_id: "profile-1".to_string(),
                station_peer_id: "station-1".to_string(),
                station_origin: "https://station.test".to_string(),
                actor_ptid: "ptid:alice".to_string(),
                device_id: "device-alice".to_string(),
            },
            Zeroizing::new("header.payload.signature".to_string()),
            "session-1".to_string(),
            "alice-signing-key".to_string(),
            7,
            DeviceSigningKey::from_parts(
                &[9; 32],
                Signature::from_bytes(&[0; 64]),
                "device-alice".to_string(),
            ),
            TrustedStationSigningKey {
                key_id: "station-key-current".to_string(),
                verifying_key: station_key.verifying_key(),
            },
        )
        .unwrap()
    }

    fn published_store(private_key: [u8; 32]) -> PrivateSocialStore {
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(1).unwrap();
        let request_bytes = vec![1, 2, 3];
        let command = StoredPreKeyPublication {
            command_id: "prekey-command".to_string(),
            key_kind: wire::ContentPreKeyKind::ContentPrekeyKindEndpoint as i32,
            pool_epoch: 7,
            request_sha256: Sha256::digest(&request_bytes).into(),
            request_bytes,
            state: DurableState::Pending,
            lease_generation: 0,
            session_generation: 0,
        };
        let public_key = ContentPreKeyPrivate::from_bytes(private_key)
            .public_key()
            .as_bytes()
            .to_owned();
        let other_public_key = ContentPreKeyPrivate::from_bytes([12; 32])
            .public_key()
            .as_bytes()
            .to_owned();
        store
            .persist_prekey_publication(
                &command,
                &[
                    ("prekey-1".to_string(), private_key, public_key),
                    ("prekey-2".to_string(), [12; 32], other_public_key),
                ],
            )
            .unwrap();
        let (leased, _) = store
            .acquire_prekey_publication(&command.command_id)
            .unwrap();
        assert!(store
            .finish_prekey_publication(&leased, DurableState::Committed)
            .unwrap());
        store
    }

    fn signed_response(
        session: &NativeSocialSession,
        station_key: &SigningKey,
        proof_key: &SigningKey,
        sender_key: &SigningKey,
        recipient_private_key: [u8; 32],
        text: &str,
    ) -> social::GetMomentResourceResponse {
        let now = current_unix_seconds();
        let resource = wire::SecureResourceRef {
            owner_domain: wire::SecureContentOwnerDomain::Social as i32,
            content_id: "post-1".to_string(),
            generation: 1,
        };
        let author = actor::ActorDeviceRef {
            actor: Some(actor::ActorRef {
                ptid: "ptid:bob".to_string(),
                acct: "bob@station.test".to_string(),
                kind: actor::ActorKind::Person as i32,
            }),
            device_id: "device-bob".to_string(),
        };
        let authorization_snapshot = [6; 32];
        let root = ContentKey::from_bytes([29; 32]);
        let domain_binding = text_domain_binding();
        let payload_key = derive_payload_key(
            root.as_bytes(),
            &authorization_snapshot,
            &PayloadKeyContext {
                protocol_version: PAYLOAD_FORMAT_VERSION,
                owner_domain: resource.owner_domain as u32,
                content_id: &resource.content_id,
                generation: resource.generation,
                payload_kind: social::PrivateMomentKind::Text as u32,
            },
        )
        .unwrap();
        let plaintext = social::PrivateMomentContent {
            format_version: PAYLOAD_FORMAT_VERSION,
            body: Some(social::private_moment_content::Body::Text(
                social::PrivateTextContent {
                    text: text.to_string(),
                    hashtags: Vec::new(),
                    mentions: Vec::new(),
                },
            )),
            mention_commitment_salt: Vec::new(),
        }
        .encode_to_vec();
        let encrypted =
            encrypt_payload_with_nonce(&payload_key, [4; 12], &plaintext, &domain_binding).unwrap();
        let payload = wire::EncryptedPayload {
            format_version: PAYLOAD_FORMAT_VERSION,
            resource: Some(resource.clone()),
            suite: wire::PayloadEncryptionSuite::Aes256Gcm as i32,
            nonce: encrypted.nonce.to_vec(),
            ciphertext: encrypted.ciphertext,
            ciphertext_sha256: encrypted.ciphertext_sha256.to_vec(),
            aad_sha256: encrypted.aad_sha256.to_vec(),
        };
        let empty_hash = empty_object_descriptor_set_hash().unwrap();
        let mut proof = wire::ViewerContentCommitProof {
            format_version: PAYLOAD_FORMAT_VERSION,
            domain_commit_id: "post-1".to_string(),
            canonical_plan_sha256: vec![5; 32],
            resource: Some(resource.clone()),
            author: Some(author.clone()),
            authorization_snapshot_sha256: authorization_snapshot.to_vec(),
            domain_binding_sha256: Sha256::digest(&domain_binding).to_vec(),
            encrypted_payload_sha256: Sha256::digest(payload.encode_to_vec()).to_vec(),
            object_descriptor_set_sha256: empty_hash.to_vec(),
            mention_routing_sha256: Sha256::digest([]).to_vec(),
            subtype_authority_sha256: Sha256::digest([]).to_vec(),
            committed_at: Some(prost_types::Timestamp {
                seconds: now - 1,
                nanos: 0,
            }),
            station_signing_key_id: "station-key-proof".to_string(),
            station_signature: Vec::new(),
        };
        proof.station_signature = proof_key.sign(&proof.encode_to_vec()).to_bytes().to_vec();
        let binding = wire::ContentKeyEnvelopeBinding {
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
            object_descriptor_set_sha256: empty_hash.to_vec(),
            plan_expires_at: Some(prost_types::Timestamp {
                seconds: now + 120,
                nanos: 0,
            }),
            sender: Some(author.clone()),
            sender_signing_key_id: "sender-key-1".to_string(),
        };
        let binding_bytes = binding.encode_to_vec();
        let sealed = seal_content_key(
            ContentPreKeyPrivate::from_bytes(recipient_private_key).public_key(),
            &binding_bytes,
            &root,
        )
        .unwrap();
        let envelope = wire::ViewerContentKeyEnvelope {
            binding: Some(binding),
            recipient: Some(wire::viewer_content_key_envelope::Recipient::Endpoint(
                actor::ActorDeviceRef {
                    actor: Some(actor::ActorRef {
                        ptid: session.scope.actor_ptid.clone(),
                        kind: actor::ActorKind::Person as i32,
                        ..Default::default()
                    }),
                    device_id: session.scope.device_id.clone(),
                },
            )),
            binding_sha256: Sha256::digest(&binding_bytes).to_vec(),
            hpke_encapsulated_key: sealed.encapsulated_key,
            hpke_ciphertext: sealed.ciphertext,
            sender_signature: sender_key.sign(&binding_bytes).to_bytes().to_vec(),
            principal_epoch: 7,
        };
        let mut attestation = wire::StationContentSigningKeyAttestation {
            format_version: PAYLOAD_FORMAT_VERSION,
            station_peer_id: session.scope.station_peer_id.clone(),
            proof_signing_key_id: "station-key-proof".to_string(),
            proof_ed25519_public_key: proof_key.verifying_key().to_bytes().to_vec(),
            attesting_signing_key_id: session.trusted_station_signing_key.key_id.clone(),
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
        let mut attestation_bytes =
            Vec::with_capacity(STATION_ATTESTATION_DOMAIN.len() + attestation.encoded_len());
        attestation_bytes.extend_from_slice(STATION_ATTESTATION_DOMAIN);
        attestation_bytes.extend_from_slice(&attestation.encode_to_vec());
        attestation.station_signature = station_key.sign(&attestation_bytes).to_bytes().to_vec();

        social::GetMomentResourceResponse {
            post: None,
            explanation: None,
            resource: Some(social::PostResource {
                metadata: Some(social::PostMetadata {
                    post_id: "post-1".to_string(),
                    content_id: "post-1".to_string(),
                    author: author.actor,
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
                            station_signing_key_attestation: Some(attestation),
                        }),
                    },
                )),
            }),
        }
    }

    #[test]
    fn decrypts_text_and_consumes_only_the_selected_endpoint_prekey_on_commit() {
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let proof_key = SigningKey::from_bytes(&[8; 32]);
        let sender_key = SigningKey::from_bytes(&[6; 32]);
        let recipient_private_key = [11; 32];
        let session = session(&station_key);
        let store = published_store(recipient_private_key);
        let response = signed_response(
            &session,
            &station_key,
            &proof_key,
            &sender_key,
            recipient_private_key,
            "receiver text",
        );

        let decrypted = decrypt_text_projection(
            &session,
            &store,
            "post-1",
            &response,
            Some(&sender_key.verifying_key()),
        )
        .unwrap();
        assert_eq!(
            decrypted.projection.content,
            Some(PrivateReadContent::Text {
                text: "receiver text".to_string(),
            })
        );
        store
            .commit_receiver_projection(
                1,
                &decrypted.projection.content_id,
                1,
                &decrypted.projection.post_id,
                decrypted.content_key.as_bytes(),
                decrypted.consumed_prekey_id.as_deref(),
                &decrypted.projection.encode().unwrap(),
            )
            .unwrap();

        assert!(store.endpoint_prekey("prekey-1").unwrap().is_none());
        assert!(store.endpoint_prekey("prekey-2").unwrap().is_some());
        assert_eq!(store.content_root("post-1", 1).unwrap(), Some([29; 32]));
        assert_eq!(
            store.read_projection("post-1").unwrap().unwrap(),
            decrypted.projection.encode().unwrap()
        );
    }

    #[test]
    fn integrity_failure_does_not_consume_the_endpoint_prekey() {
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let proof_key = SigningKey::from_bytes(&[8; 32]);
        let sender_key = SigningKey::from_bytes(&[6; 32]);
        let recipient_private_key = [11; 32];
        let session = session(&station_key);
        let store = published_store(recipient_private_key);
        let mut response = signed_response(
            &session,
            &station_key,
            &proof_key,
            &sender_key,
            recipient_private_key,
            "receiver text",
        );
        let private = match response
            .resource
            .as_mut()
            .and_then(|resource| resource.body.as_mut())
        {
            Some(social::post_resource::Body::PrivateContent(private)) => private,
            _ => panic!("test response must contain private content"),
        };
        private.payload.as_mut().unwrap().ciphertext[0] ^= 1;

        let result = decrypt_text_projection(
            &session,
            &store,
            "post-1",
            &response,
            Some(&sender_key.verifying_key()),
        );
        assert!(matches!(
            result,
            Err(PrivateReadError {
                kind: PrivateReadFailureKind::IntegrityFailure,
                ..
            })
        ));
        assert!(store.endpoint_prekey("prekey-1").unwrap().is_some());
        assert!(store.content_root("post-1", 1).unwrap().is_none());
    }

    #[test]
    fn missing_endpoint_prekey_requires_recovery_without_creating_content_state() {
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let proof_key = SigningKey::from_bytes(&[8; 32]);
        let sender_key = SigningKey::from_bytes(&[6; 32]);
        let recipient_private_key = [11; 32];
        let session = session(&station_key);
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(1).unwrap();
        let response = signed_response(
            &session,
            &station_key,
            &proof_key,
            &sender_key,
            recipient_private_key,
            "receiver text",
        );

        let result = decrypt_text_projection(
            &session,
            &store,
            "post-1",
            &response,
            Some(&sender_key.verifying_key()),
        );

        assert!(matches!(
            result,
            Err(PrivateReadError {
                kind: PrivateReadFailureKind::RecoveryRequired,
                ..
            })
        ));
        assert!(store.content_root("post-1", 1).unwrap().is_none());
        assert!(store.read_projection("post-1").unwrap().is_none());
    }

    #[test]
    fn missing_endpoint_envelope_requires_recovery_without_purging_state() {
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let proof_key = SigningKey::from_bytes(&[8; 32]);
        let sender_key = SigningKey::from_bytes(&[6; 32]);
        let session = session(&station_key);
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(1).unwrap();
        let mut response = signed_response(
            &session,
            &station_key,
            &proof_key,
            &sender_key,
            [11; 32],
            "receiver text",
        );
        match response
            .resource
            .as_mut()
            .and_then(|resource| resource.body.as_mut())
        {
            Some(social::post_resource::Body::PrivateContent(private)) => {
                private.viewer_envelope = None;
            }
            _ => panic!("test response must contain private content"),
        }

        let requirement = sender_key_requirement("post-1", &response).unwrap();
        assert!(requirement.signing_key_id.is_none());
        let result = decrypt_text_projection(&session, &store, "post-1", &response, None);

        assert!(matches!(
            result,
            Err(PrivateReadError {
                kind: PrivateReadFailureKind::RecoveryRequired,
                ..
            })
        ));
        assert!(store.content_root("post-1", 1).unwrap().is_none());
        assert!(store.read_projection("post-1").unwrap().is_none());
    }

    #[test]
    fn verified_cached_root_decrypts_without_a_fresh_endpoint_envelope() {
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let proof_key = SigningKey::from_bytes(&[8; 32]);
        let sender_key = SigningKey::from_bytes(&[6; 32]);
        let session = session(&station_key);
        let store = PrivateSocialStore::in_memory("station-1", "ptid:alice").unwrap();
        store.bind_session_generation(1).unwrap();
        store
            .commit_receiver_projection(
                1,
                "post-1",
                1,
                "post-1",
                &[29; 32],
                None,
                br#"{"state":"CONTENT_READY"}"#,
            )
            .unwrap();
        let mut response = signed_response(
            &session,
            &station_key,
            &proof_key,
            &sender_key,
            [11; 32],
            "cached receiver text",
        );
        match response
            .resource
            .as_mut()
            .and_then(|resource| resource.body.as_mut())
        {
            Some(social::post_resource::Body::PrivateContent(private)) => {
                private.viewer_envelope = None;
            }
            _ => panic!("test response must contain private content"),
        }

        let requirement = sender_key_requirement("post-1", &response).unwrap();
        assert!(requirement.signing_key_id.is_none());
        let decrypted =
            decrypt_text_projection(&session, &store, "post-1", &response, None).unwrap();

        assert_eq!(
            decrypted.projection.content,
            Some(PrivateReadContent::Text {
                text: "cached receiver text".to_string(),
            })
        );
        assert!(decrypted.consumed_prekey_id.is_none());
        assert_eq!(store.content_root("post-1", 1).unwrap(), Some([29; 32]));
    }

    #[test]
    fn trusted_unauthorized_has_an_authentication_projection() {
        let projection = terminal_projection_for_transport_error(
            "post-1",
            &TransportError {
                http_status: Some(401),
                stable_code: error_model::ErrorCode::Unauthorized as i32,
                typed_error: true,
                retry_after_seconds: None,
                disposition: TransportDisposition::Terminal,
            },
        )
        .unwrap();

        assert_eq!(projection.state, PrivateReadState::AuthenticationRequired);
        assert!(!purges_private_material(&projection.state));
    }

    #[test]
    fn integrity_failure_does_not_destroy_recoverable_private_material() {
        let projection =
            projection_for_read_failure("post-1", PrivateReadFailureKind::IntegrityFailure)
                .unwrap();

        assert_eq!(projection.state, PrivateReadState::IntegrityFailure);
        assert!(!purges_private_material(&projection.state));
    }

    #[test]
    fn trusted_social_post_not_found_has_a_fail_closed_projection() {
        let missing = terminal_projection_for_transport_error(
            "post-1",
            &TransportError {
                http_status: Some(404),
                stable_code: error_model::ErrorCode::PostNotFound as i32,
                typed_error: true,
                retry_after_seconds: Some(9),
                disposition: crate::secure_content::transport::TransportDisposition::Terminal,
            },
        )
        .unwrap();

        assert_eq!(missing.state, PrivateReadState::NotFoundOrNotAuthorized);
        assert!(missing.content.is_none());
    }

    #[test]
    fn untyped_or_mismatched_proxy_status_has_no_terminal_projection() {
        for (typed_error, status, code) in [
            (false, 401, error_model::ErrorCode::Unauthorized as i32),
            (false, 403, error_model::ErrorCode::Undefined as i32),
            (false, 404, error_model::ErrorCode::PostNotFound as i32),
            (false, 410, error_model::ErrorCode::Undefined as i32),
            (true, 403, error_model::ErrorCode::Unauthorized as i32),
            (true, 404, error_model::ErrorCode::Unauthorized as i32),
            (true, 410, error_model::ErrorCode::PostNotFound as i32),
        ] {
            let error = TransportError {
                http_status: Some(status),
                stable_code: code,
                typed_error,
                retry_after_seconds: None,
                disposition: TransportDisposition::Terminal,
            };
            assert!(terminal_projection_for_transport_error("post-1", &error).is_none());
        }
    }

    #[test]
    fn retryable_transport_failure_has_no_terminal_projection() {
        let error = TransportError {
            http_status: Some(503),
            stable_code: 1,
            typed_error: false,
            retry_after_seconds: Some(2),
            disposition: TransportDisposition::UnknownOutcome,
        };

        assert!(transport_error_is_retryable(&error));
        assert!(terminal_projection_for_transport_error("post-1", &error).is_none());
    }

    #[test]
    fn blocked_audience_contracts_are_not_accepted_by_the_text_receiver() {
        assert!(!is_private_audience_kind(
            social::audience::Kind::Group as i32
        ));
        assert!(!is_private_audience_kind(
            social::audience::Kind::CustomDeny as i32
        ));
    }
}
