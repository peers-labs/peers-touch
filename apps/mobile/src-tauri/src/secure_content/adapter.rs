use ed25519_dalek::{Signature, Verifier};
use prost::Message;
use secure_content_core::codec::CanonicalMessageEncoder;
use secure_content_core::envelope::{seal_content_key, ContentKey};
use secure_content_core::payload::{
    derive_payload_key, encrypt_payload, PayloadKeyContext, PAYLOAD_FORMAT_VERSION,
};
use secure_content_core::prekey::ContentPreKeyPublic;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::secure_content::proto::{secure_content::v1 as wire, social::v1 as social};
use crate::secure_content::store::{DurableState, StoredDraft, StoredSubmission};
use crate::secure_content::NativeSocialSession;

const MAX_PRIVATE_TEXT_BYTES: usize = 64 * 1024;
const MAX_PRIVATE_RECIPIENT_ACTORS: usize = 256;
const MAX_PRIVATE_RECIPIENT_SLOTS: usize = 1000;
const PRIVATE_PLAN_LIFETIME_MS: i64 = 5 * 60 * 1_000;
const PRIVATE_PLAN_CLOCK_SKEW_MS: i64 = 30_000;
const CLOCK_SKEW_SECONDS: i64 = 60;
const STATION_ATTESTATION_DOMAIN: &[u8] =
    b"peers-touch:secure-content:station-content-signing-key-attestation:v1\0";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateAudienceIntent {
    pub kind: String,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub actor_ptids: Vec<String>,
    #[serde(default)]
    pub base_kind: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateTextMomentIntent {
    pub draft_id: String,
    pub draft_revision: u64,
    pub text: String,
    pub audience: PrivateAudienceIntent,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrivatePublishState {
    Preparing,
    Publishing,
    UnknownOutcome,
    Published,
    PublishFailed,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateMomentProjection {
    pub draft_id: String,
    pub draft_revision: u64,
    pub content_id: String,
    pub generation: u64,
    pub audience_kind: String,
    pub state: PrivatePublishState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<i32>,
}

impl PrivateMomentProjection {
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(self).map_err(|error| error.to_string())
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        serde_json::from_slice(bytes).map_err(|error| error.to_string())
    }
}

pub struct PreparedTextSubmission {
    pub command: StoredSubmission,
}

pub fn validate_text_intent(intent: &PrivateTextMomentIntent) -> Result<(), String> {
    if intent.draft_id.trim().is_empty()
        || intent.draft_id != intent.draft_id.trim()
        || intent.draft_revision == 0
        || intent.text.trim().is_empty()
        || intent.text.as_bytes().len() > MAX_PRIVATE_TEXT_BYTES
    {
        return Err("private Social text intent is invalid".to_string());
    }
    private_audience(&intent.audience, "")?;
    Ok(())
}

pub fn reserve_draft(intent: &PrivateTextMomentIntent) -> Result<StoredDraft, String> {
    validate_text_intent(intent)?;
    let intent_sha256 = intent_hash(intent)?;
    let identity = hex(&intent_sha256);
    Ok(StoredDraft {
        draft_id: intent.draft_id.clone(),
        draft_revision: intent.draft_revision,
        intent_sha256,
        content_id: format!("mobile-private-{identity}"),
        prepare_command_id: format!("mobile-private-prepare-{identity}"),
    })
}

pub fn prepare_request(
    actor_ptid: &str,
    draft: &StoredDraft,
    intent: &PrivateTextMomentIntent,
) -> Result<social::PreparePrivateMomentRequest, String> {
    Ok(social::PreparePrivateMomentRequest {
        content_id: draft.content_id.clone(),
        audience: Some(private_audience(&intent.audience, actor_ptid)?),
        object_count: 0,
        command_id: draft.prepare_command_id.clone(),
        kind: social::PrivateMomentKind::Text as i32,
        repost_authority: None,
        poll_authority: None,
    })
}

pub fn build_text_submission(
    session: &NativeSocialSession,
    draft: &StoredDraft,
    intent: &PrivateTextMomentIntent,
    plan: wire::ContentEncryptionPlan,
) -> Result<PreparedTextSubmission, String> {
    validate_plan(session, &plan, &draft.content_id)?;
    let resource = plan
        .resource
        .as_ref()
        .ok_or_else(|| "private Social plan resource is missing".to_string())?
        .clone();
    let domain_binding = social::PrivateMomentDomainBinding {
        format_version: PAYLOAD_FORMAT_VERSION,
        kind: social::PrivateMomentKind::Text as i32,
        subtype_prepare_authority_sha256: Vec::new(),
    }
    .encode_to_vec();
    if Sha256::digest(&domain_binding).as_slice() != plan.domain_binding_sha256 {
        return Err("private Social plan subtype binding is invalid".to_string());
    }
    let authorization_snapshot: [u8; 32] = plan
        .authorization_snapshot_sha256
        .as_slice()
        .try_into()
        .map_err(|_| "private Social authorization snapshot is invalid".to_string())?;
    let root_key = ContentKey::generate();
    let payload_key = derive_payload_key(
        root_key.as_bytes(),
        &authorization_snapshot,
        &PayloadKeyContext {
            protocol_version: PAYLOAD_FORMAT_VERSION,
            owner_domain: resource.owner_domain as u32,
            content_id: &resource.content_id,
            generation: resource.generation,
            payload_kind: social::PrivateMomentKind::Text as u32,
        },
    )?;
    let plaintext = social::PrivateMomentContent {
        format_version: PAYLOAD_FORMAT_VERSION,
        body: Some(social::private_moment_content::Body::Text(
            social::PrivateTextContent {
                text: intent.text.clone(),
                hashtags: Vec::new(),
                mentions: Vec::new(),
            },
        )),
        mention_commitment_salt: Vec::new(),
    }
    .encode_to_vec();
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
    let object_descriptor_set_sha256 = empty_object_descriptor_set_hash()?;
    let envelopes = seal_envelopes(
        session,
        &plan,
        &payload,
        object_descriptor_set_sha256,
        &root_key,
    )?;
    let command_id = bounded_command_id(
        "mobile-private-submit",
        &intent.draft_id,
        intent.draft_revision,
    );
    let request = social::SubmitPrivateMomentRequest {
        plan: Some(plan),
        payload: Some(payload),
        envelopes,
        objects: Vec::new(),
        mention_routing: None,
        poll_authority: None,
        repost_authority: None,
        command_id: command_id.clone(),
    };
    let request_bytes = request.encode_to_vec();
    let projection = PrivateMomentProjection {
        draft_id: intent.draft_id.clone(),
        draft_revision: intent.draft_revision,
        content_id: draft.content_id.clone(),
        generation: resource.generation,
        audience_kind: intent.audience.kind.clone(),
        state: PrivatePublishState::Publishing,
        post_id: None,
        text: Some(intent.text.clone()),
        error_code: None,
    };
    Ok(PreparedTextSubmission {
        command: StoredSubmission {
            command_id,
            draft_id: intent.draft_id.clone(),
            draft_revision: intent.draft_revision,
            content_id: draft.content_id.clone(),
            generation: resource.generation,
            request_sha256: Sha256::digest(&request_bytes).into(),
            request_bytes,
            root_key: root_key.to_bytes(),
            projection_json: projection.encode()?,
            state: DurableState::Pending,
            lease_generation: 0,
            session_generation: 0,
            post_id: None,
            last_error_code: None,
        },
    })
}

pub fn projection_for_state(
    command: &StoredSubmission,
    state: PrivatePublishState,
    post_id: Option<String>,
    error_code: Option<i32>,
) -> Result<PrivateMomentProjection, String> {
    let mut projection = PrivateMomentProjection::decode(&command.projection_json)?;
    projection.state = state;
    projection.post_id = post_id;
    projection.error_code = error_code;
    Ok(projection)
}

pub fn verify_submit_readback(
    session: &NativeSocialSession,
    command: &StoredSubmission,
    request: &social::SubmitPrivateMomentRequest,
    submitted: &social::SubmitPrivateMomentResponse,
    readback: &social::GetMomentResourceResponse,
) -> Result<String, String> {
    let submitted_metadata = submitted
        .post
        .as_ref()
        .and_then(|post| post.metadata.as_ref())
        .ok_or_else(|| "private Social submit response omitted metadata".to_string())?;
    let resource = readback
        .resource
        .as_ref()
        .ok_or_else(|| "private Social readback omitted resource".to_string())?;
    let metadata = resource
        .metadata
        .as_ref()
        .ok_or_else(|| "private Social readback omitted metadata".to_string())?;
    let private = match resource.body.as_ref() {
        Some(social::post_resource::Body::PrivateContent(private)) => private,
        _ => return Err("private Social readback is not private content".to_string()),
    };
    let expected_payload = request
        .payload
        .as_ref()
        .ok_or_else(|| "private Social durable request omitted payload".to_string())?;
    let plan = request
        .plan
        .as_ref()
        .ok_or_else(|| "private Social durable request omitted plan".to_string())?;
    let verification = private
        .verification
        .as_ref()
        .ok_or_else(|| "private Social readback omitted verification".to_string())?;
    let proof = verification
        .commit_proof
        .as_ref()
        .ok_or_else(|| "private Social readback omitted commit proof".to_string())?;
    let resource_ref = expected_payload
        .resource
        .as_ref()
        .ok_or_else(|| "private Social durable payload omitted resource".to_string())?;
    let submitted_author = submitted_metadata
        .author
        .as_ref()
        .ok_or_else(|| "private Social submit response omitted author".to_string())?;
    let metadata_author = metadata
        .author
        .as_ref()
        .ok_or_else(|| "private Social readback omitted author".to_string())?;
    let proof_author = proof
        .author
        .as_ref()
        .ok_or_else(|| "private Social proof omitted author".to_string())?;
    let proof_actor = proof_author
        .actor
        .as_ref()
        .ok_or_else(|| "private Social proof omitted actor".to_string())?;
    let plan_author = plan
        .author
        .as_ref()
        .ok_or_else(|| "private Social durable plan omitted author".to_string())?;
    let committed_at =
        checked_timestamp_millis(proof.committed_at.as_ref(), "private Social commit time")?;
    let created_at =
        checked_timestamp_millis(metadata.created_at.as_ref(), "private Social creation time")?;
    let updated_at =
        checked_timestamp_millis(metadata.updated_at.as_ref(), "private Social update time")?;
    let domain_binding = social::PrivateMomentDomainBinding {
        format_version: PAYLOAD_FORMAT_VERSION,
        kind: social::PrivateMomentKind::Text as i32,
        subtype_prepare_authority_sha256: Vec::new(),
    }
    .encode_to_vec();
    let domain_binding_sha256 = Sha256::digest(&domain_binding);
    let empty_sha256 = Sha256::digest([]);
    if submitted_metadata.post_id != command.content_id
        || metadata.post_id != submitted_metadata.post_id
        || metadata.content_id != command.content_id
        || submitted_author != metadata_author
        || metadata_author != proof_actor
        || proof_author != plan_author
        || proof_author.actor.as_ref().map(|actor| actor.ptid.as_str())
            != Some(session.scope.actor_ptid.as_str())
        || proof_author.device_id != session.scope.device_id
        || metadata.r#type != social::PostType::Text as i32
        || !is_private_audience_kind(metadata.audience_kind)
        || metadata.is_deleted
        || created_at != committed_at
        || updated_at < committed_at
        || committed_at > now_unix_ms().saturating_add(CLOCK_SKEW_SECONDS.saturating_mul(1_000))
        || expected_payload.format_version != PAYLOAD_FORMAT_VERSION
        || expected_payload.suite != wire::PayloadEncryptionSuite::Aes256Gcm as i32
        || expected_payload.nonce.len() != 12
        || expected_payload.ciphertext.len() < 16
        || expected_payload.ciphertext.len() > 1024 * 1024
        || expected_payload.ciphertext_sha256.len() != 32
        || expected_payload.aad_sha256 != domain_binding_sha256.as_slice()
        || Sha256::digest(&expected_payload.ciphertext).as_slice()
            != expected_payload.ciphertext_sha256
        || private.payload.as_ref() != Some(expected_payload)
        || !private.objects.is_empty()
        || private.poll.is_some()
        || private.viewer_envelope.is_none()
        || verification.mention_routing.is_some()
        || verification.subtype_authority.is_some()
        || proof.format_version != PAYLOAD_FORMAT_VERSION
        || proof.domain_commit_id != command.content_id
        || proof.resource.as_ref() != Some(resource_ref)
        || proof.canonical_plan_sha256 != plan.canonical_plan_sha256
        || proof.authorization_snapshot_sha256 != plan.authorization_snapshot_sha256
        || proof.domain_binding_sha256 != domain_binding_sha256.as_slice()
        || proof.encrypted_payload_sha256
            != Sha256::digest(expected_payload.encode_to_vec()).as_slice()
        || proof.object_descriptor_set_sha256 != empty_object_descriptor_set_hash()?.as_slice()
        || proof.mention_routing_sha256 != empty_sha256.as_slice()
        || proof.subtype_authority_sha256 != empty_sha256.as_slice()
        || proof.station_signature.len() != 64
    {
        return Err("private Social readback changed the submitted resource".to_string());
    }
    verify_viewer_envelope(
        session,
        private.viewer_envelope.as_ref().expect("checked above"),
        request,
        proof,
    )?;
    let proof_key = verify_station_attestation(
        session,
        verification
            .station_signing_key_attestation
            .as_ref()
            .ok_or_else(|| "private Social Station attestation is missing".to_string())?,
    )?;
    if proof.station_signing_key_id
        != verification
            .station_signing_key_attestation
            .as_ref()
            .expect("checked above")
            .proof_signing_key_id
    {
        return Err("private Social proof key identity mismatched".to_string());
    }
    let signature = Signature::from_slice(&proof.station_signature)
        .map_err(|_| "private Social commit proof signature is invalid".to_string())?;
    let mut unsigned = proof.clone();
    unsigned.station_signature.clear();
    proof_key
        .verify(&unsigned.encode_to_vec(), &signature)
        .map_err(|_| "private Social commit proof signature is invalid".to_string())?;
    Ok(metadata.post_id.clone())
}

fn verify_viewer_envelope(
    session: &NativeSocialSession,
    envelope: &wire::ViewerContentKeyEnvelope,
    request: &social::SubmitPrivateMomentRequest,
    proof: &wire::ViewerContentCommitProof,
) -> Result<(), String> {
    let binding = envelope
        .binding
        .as_ref()
        .ok_or_else(|| "private Social viewer envelope omitted binding".to_string())?;
    let prepared = request
        .envelopes
        .iter()
        .find(|prepared| prepared.binding_sha256 == envelope.binding_sha256)
        .ok_or_else(|| "private Social viewer envelope was not submitted".to_string())?;
    let endpoint = match envelope.recipient.as_ref() {
        Some(wire::viewer_content_key_envelope::Recipient::Endpoint(endpoint)) => endpoint,
        _ => {
            return Err(
                "private Social publish readback is not for the active endpoint".to_string(),
            )
        }
    };
    let committed_at =
        checked_timestamp_millis(proof.committed_at.as_ref(), "private Social commit time")?;
    let expires_at = checked_timestamp_millis(
        binding.plan_expires_at.as_ref(),
        "private Social plan expiry",
    )?;
    if binding.format_version != PAYLOAD_FORMAT_VERSION
        || binding.canonical_plan_sha256 != proof.canonical_plan_sha256
        || binding.resource != proof.resource
        || binding.authorization_snapshot_sha256 != proof.authorization_snapshot_sha256
        || binding.sender != proof.author
        || binding.sender_signing_key_id != session.signing_key_id
        || binding.payload_ciphertext_sha256
            != request
                .payload
                .as_ref()
                .map(|payload| payload.ciphertext_sha256.as_slice())
                .unwrap_or_default()
        || binding.object_descriptor_set_sha256 != empty_object_descriptor_set_hash()?.as_slice()
        || endpoint.actor.as_ref().map(|actor| actor.ptid.as_str())
            != Some(session.scope.actor_ptid.as_str())
        || endpoint.device_id != session.scope.device_id
        || binding.recipient_key_kind != wire::ContentPreKeyKind::ContentPrekeyKindEndpoint as i32
        || envelope.principal_epoch == 0
        || envelope.binding_sha256 != Sha256::digest(binding.encode_to_vec()).as_slice()
        || envelope.hpke_encapsulated_key.len() != 32
        || envelope.hpke_ciphertext.len() != 48
        || envelope.sender_signature.len() != 64
        || prepared.binding.as_ref() != Some(binding)
        || prepared.hpke_encapsulated_key != envelope.hpke_encapsulated_key
        || prepared.hpke_ciphertext != envelope.hpke_ciphertext
        || prepared.sender_signature != envelope.sender_signature
        || committed_at > expires_at
    {
        return Err("private Social viewer envelope binding is invalid".to_string());
    }
    let signature = Signature::from_slice(&envelope.sender_signature)
        .map_err(|_| "private Social sender signature is invalid".to_string())?;
    session
        .device_signing_key
        .verifying_key()
        .verify(&binding.encode_to_vec(), &signature)
        .map_err(|_| "private Social sender signature is invalid".to_string())
}

fn verify_station_attestation(
    session: &NativeSocialSession,
    attestation: &wire::StationContentSigningKeyAttestation,
) -> Result<ed25519_dalek::VerifyingKey, String> {
    let issued = attestation
        .issued_at
        .as_ref()
        .ok_or_else(|| "private Social Station attestation issue time is missing".to_string())?;
    let expires = attestation
        .expires_at
        .as_ref()
        .ok_or_else(|| "private Social Station attestation expiry is missing".to_string())?;
    let now = now_unix_ms() / 1_000;
    if attestation.format_version != 1
        || attestation.station_peer_id != session.scope.station_peer_id
        || attestation.attesting_signing_key_id != session.trusted_station_signing_key.key_id
        || attestation.proof_signing_key_id.trim().is_empty()
        || attestation.proof_ed25519_public_key.len() != 32
        || attestation.station_signature.len() != 64
        || !(0..1_000_000_000).contains(&issued.nanos)
        || !(0..1_000_000_000).contains(&expires.nanos)
        || issued.seconds > now.saturating_add(CLOCK_SKEW_SECONDS)
        || expires.seconds < now
        || expires.seconds.saturating_sub(issued.seconds) != 300
    {
        return Err("private Social Station attestation is invalid".to_string());
    }
    let signature = Signature::from_slice(&attestation.station_signature)
        .map_err(|_| "private Social Station attestation signature is invalid".to_string())?;
    let mut unsigned = attestation.clone();
    unsigned.station_signature.clear();
    let mut bytes = Vec::with_capacity(STATION_ATTESTATION_DOMAIN.len() + unsigned.encoded_len());
    bytes.extend_from_slice(STATION_ATTESTATION_DOMAIN);
    bytes.extend_from_slice(&unsigned.encode_to_vec());
    session
        .trusted_station_signing_key
        .verifying_key
        .verify(&bytes, &signature)
        .map_err(|_| "private Social Station attestation signature is invalid".to_string())?;
    ed25519_dalek::VerifyingKey::from_bytes(
        attestation
            .proof_ed25519_public_key
            .as_slice()
            .try_into()
            .map_err(|_| "private Social proof key is invalid".to_string())?,
    )
    .map_err(|_| "private Social proof key is invalid".to_string())
}

fn checked_timestamp_millis(
    timestamp: Option<&prost_types::Timestamp>,
    field: &str,
) -> Result<i64, String> {
    let timestamp = timestamp.ok_or_else(|| format!("{field} is missing"))?;
    if !(0..1_000_000_000).contains(&timestamp.nanos) {
        return Err(format!("{field} is invalid"));
    }
    timestamp
        .seconds
        .checked_mul(1_000)
        .and_then(|value| value.checked_add(i64::from(timestamp.nanos) / 1_000_000))
        .ok_or_else(|| format!("{field} is invalid"))
}

fn is_private_audience_kind(kind: i32) -> bool {
    matches!(
        social::audience::Kind::try_from(kind).ok(),
        Some(
            social::audience::Kind::Followers
                | social::audience::Kind::Friends
                | social::audience::Kind::Circle
                | social::audience::Kind::Group
                | social::audience::Kind::Self_
                | social::audience::Kind::CustomAllow
                | social::audience::Kind::CustomDeny
        )
    )
}

fn validate_plan(
    session: &NativeSocialSession,
    plan: &wire::ContentEncryptionPlan,
    content_id: &str,
) -> Result<(), String> {
    let resource = plan
        .resource
        .as_ref()
        .ok_or_else(|| "private Social plan resource is missing".to_string())?;
    let author = plan
        .author
        .as_ref()
        .ok_or_else(|| "private Social plan author is missing".to_string())?;
    if plan.format_version != 1
        || plan.plan_id.trim().is_empty()
        || resource.owner_domain != wire::SecureContentOwnerDomain::Social as i32
        || resource.content_id != content_id
        || resource.generation == 0
        || author.actor.as_ref().map(|actor| actor.ptid.as_str())
            != Some(session.scope.actor_ptid.as_str())
        || author.device_id != session.scope.device_id
        || plan.authorization_snapshot_sha256.len() != 32
        || plan.canonical_plan_sha256.len() != 32
        || plan.domain_binding_sha256.len() != 32
        || plan.station_signing_key_id != session.trusted_station_signing_key.key_id
        || plan.station_signature.len() != 64
        || plan.required_slots.is_empty()
        || plan.required_slots.len() > MAX_PRIVATE_RECIPIENT_SLOTS
        || !plan.object_ids.is_empty()
    {
        return Err("private Social plan binding is invalid".to_string());
    }
    if plan.required_slots.iter().any(|slot| {
        slot.recipient_slot_id.trim().is_empty()
            || slot.recipient_slot_id != slot.recipient_slot_id.trim()
            || slot.one_time_key_id.trim().is_empty()
            || slot.one_time_key_id != slot.one_time_key_id.trim()
            || slot.one_time_public_key.len() != 32
            || slot.principal_binding_sha256.len() != 32
            || !matches!(
                wire::ContentPreKeyKind::try_from(slot.key_kind).ok(),
                Some(wire::ContentPreKeyKind::ContentPrekeyKindEndpoint)
                    | Some(wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery)
            )
    }) || plan
        .required_slots
        .windows(2)
        .any(|pair| pair[0].recipient_slot_id >= pair[1].recipient_slot_id)
    {
        return Err("private Social plan slot collection is not canonical".to_string());
    }
    let mut hash_input = plan.clone();
    hash_input.canonical_plan_sha256.clear();
    hash_input.station_signature.clear();
    if Sha256::digest(hash_input.encode_to_vec()).as_slice() != plan.canonical_plan_sha256 {
        return Err("private Social plan hash is invalid".to_string());
    }
    let expiry = plan
        .expires_at
        .as_ref()
        .ok_or_else(|| "private Social plan expiry is missing".to_string())?;
    let expiry_ms = expiry
        .seconds
        .checked_mul(1_000)
        .and_then(|value| value.checked_add(i64::from(expiry.nanos) / 1_000_000))
        .ok_or_else(|| "private Social plan expiry is invalid".to_string())?;
    let now = now_unix_ms();
    if !(0..1_000_000_000).contains(&expiry.nanos)
        || expiry_ms < now.saturating_sub(PRIVATE_PLAN_CLOCK_SKEW_MS)
        || expiry_ms
            > now
                .saturating_add(PRIVATE_PLAN_LIFETIME_MS)
                .saturating_add(PRIVATE_PLAN_CLOCK_SKEW_MS)
    {
        return Err("private Social plan is expired or overlong".to_string());
    }
    let signature = Signature::from_slice(&plan.station_signature)
        .map_err(|_| "private Social plan signature is invalid".to_string())?;
    let mut signed = plan.clone();
    signed.station_signature.clear();
    session
        .trusted_station_signing_key
        .verifying_key
        .verify(&signed.encode_to_vec(), &signature)
        .map_err(|_| "private Social plan signature is invalid".to_string())
}

fn seal_envelopes(
    session: &NativeSocialSession,
    plan: &wire::ContentEncryptionPlan,
    payload: &wire::EncryptedPayload,
    object_descriptor_set_sha256: [u8; 32],
    root_key: &ContentKey,
) -> Result<Vec<wire::PreparedContentKeyEnvelope>, String> {
    plan.required_slots
        .iter()
        .map(|slot| {
            let public_key: [u8; 32] = slot
                .one_time_public_key
                .as_slice()
                .try_into()
                .map_err(|_| "private Social recipient PreKey is invalid".to_string())?;
            let binding = wire::ContentKeyEnvelopeBinding {
                format_version: 1,
                plan_id: plan.plan_id.clone(),
                canonical_plan_sha256: plan.canonical_plan_sha256.clone(),
                resource: plan.resource.clone(),
                recipient_slot_id: slot.recipient_slot_id.clone(),
                recipient_key_kind: slot.key_kind,
                recipient_key_id: slot.one_time_key_id.clone(),
                principal_binding_sha256: slot.principal_binding_sha256.clone(),
                authorization_snapshot_sha256: plan.authorization_snapshot_sha256.clone(),
                payload_ciphertext_sha256: payload.ciphertext_sha256.clone(),
                object_descriptor_set_sha256: object_descriptor_set_sha256.to_vec(),
                plan_expires_at: plan.expires_at,
                sender: plan.author.clone(),
                sender_signing_key_id: session.signing_key_id.clone(),
            };
            let binding_bytes = binding.encode_to_vec();
            let sealed = seal_content_key(
                ContentPreKeyPublic::from_bytes(public_key),
                &binding_bytes,
                root_key,
            )?;
            Ok(wire::PreparedContentKeyEnvelope {
                binding: Some(binding),
                binding_sha256: Sha256::digest(&binding_bytes).to_vec(),
                hpke_encapsulated_key: sealed.encapsulated_key,
                hpke_ciphertext: sealed.ciphertext,
                sender_signature: session.sign(&binding_bytes),
            })
        })
        .collect()
}

fn empty_object_descriptor_set_hash() -> Result<[u8; 32], String> {
    let encoder = CanonicalMessageEncoder::new();
    Ok(Sha256::digest(encoder.finish()).into())
}

fn private_audience(
    intent: &PrivateAudienceIntent,
    actor_ptid: &str,
) -> Result<social::Audience, String> {
    let mut actor_ptids = intent.actor_ptids.clone();
    actor_ptids.sort();
    if actor_ptids.len() > MAX_PRIVATE_RECIPIENT_ACTORS
        || actor_ptids
            .iter()
            .any(|ptid| ptid.trim().is_empty() || ptid != ptid.trim() || ptid == actor_ptid)
        || actor_ptids.windows(2).any(|pair| pair[0] == pair[1])
    {
        return Err("private Social audience actor list is invalid".to_string());
    }
    let target_id = intent
        .target_id
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(|value| {
            value
                .parse::<u64>()
                .map_err(|_| "private Social audience target is invalid".to_string())
        })
        .transpose()?
        .unwrap_or_default();
    let (kind, base_kind) = match intent.kind.as_str() {
        "FOLLOWERS" => (social::audience::Kind::Followers, None),
        "FRIENDS" => (social::audience::Kind::Friends, None),
        "CIRCLE" if target_id > 0 => (social::audience::Kind::Circle, None),
        "GROUP" if target_id > 0 => (social::audience::Kind::Group, None),
        "SELF" => (social::audience::Kind::Self_, None),
        "CUSTOM_ALLOW" if !actor_ptids.is_empty() => (social::audience::Kind::CustomAllow, None),
        "CUSTOM_DENY" if !actor_ptids.is_empty() => {
            let base = match intent.base_kind.as_deref() {
                Some("PUBLIC") => social::audience::Kind::Public,
                Some("FOLLOWERS") => social::audience::Kind::Followers,
                _ => return Err("private Social custom deny base is invalid".to_string()),
            };
            (social::audience::Kind::CustomDeny, Some(base))
        }
        _ => return Err("private Social audience is invalid".to_string()),
    };
    if !matches!(
        kind,
        social::audience::Kind::Circle | social::audience::Kind::Group
    ) && target_id != 0
        || !matches!(
            kind,
            social::audience::Kind::CustomAllow | social::audience::Kind::CustomDeny
        ) && !actor_ptids.is_empty()
        || kind != social::audience::Kind::CustomDeny && intent.base_kind.is_some()
    {
        return Err("private Social audience fields are inconsistent".to_string());
    }
    Ok(social::Audience {
        kind: kind as i32,
        target_id,
        actor_ptids,
        base_kind: base_kind.map_or(0, |value| value as i32),
    })
}

fn intent_hash(intent: &PrivateTextMomentIntent) -> Result<[u8; 32], String> {
    let mut encoder = CanonicalMessageEncoder::new();
    encoder
        .singular_bytes(1, intent.draft_id.as_bytes())
        .map_err(|error| error.to_string())?;
    encoder
        .singular_varint(2, intent.draft_revision)
        .map_err(|error| error.to_string())?;
    encoder
        .singular_bytes(3, intent.text.as_bytes())
        .map_err(|error| error.to_string())?;
    encoder
        .singular_bytes(4, intent.audience.kind.as_bytes())
        .map_err(|error| error.to_string())?;
    if let Some(target_id) = intent.audience.target_id.as_deref() {
        encoder
            .singular_bytes(5, target_id.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    for actor in &intent.audience.actor_ptids {
        encoder
            .repeated_bytes(6, actor.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    if let Some(base_kind) = intent.audience.base_kind.as_deref() {
        encoder
            .singular_bytes(7, base_kind.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    Ok(Sha256::digest(encoder.finish()).into())
}

fn bounded_command_id(prefix: &str, draft_id: &str, revision: u64) -> String {
    format!(
        "{prefix}-{}",
        hex(&Sha256::digest(
            format!("{prefix}:{draft_id}:{revision}").as_bytes()
        ))
    )
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use messaging_core::identity::DeviceSigningKey;
    use zeroize::Zeroizing;

    #[test]
    fn audience_rejects_ambiguous_or_duplicate_members() {
        let mut audience = PrivateAudienceIntent {
            kind: "CUSTOM_ALLOW".to_string(),
            target_id: None,
            actor_ptids: vec!["ptid:bob".to_string(), "ptid:bob".to_string()],
            base_kind: None,
        };
        assert!(private_audience(&audience, "ptid:alice").is_err());
        audience.actor_ptids = vec!["ptid:bob".to_string()];
        assert_eq!(
            private_audience(&audience, "ptid:alice").unwrap().kind,
            social::audience::Kind::CustomAllow as i32
        );
    }

    #[test]
    fn draft_identity_is_stable_for_exact_retry() {
        let intent = PrivateTextMomentIntent {
            draft_id: "draft-1".to_string(),
            draft_revision: 2,
            text: "private text".to_string(),
            audience: PrivateAudienceIntent {
                kind: "FRIENDS".to_string(),
                target_id: None,
                actor_ptids: Vec::new(),
                base_kind: None,
            },
        };
        assert_eq!(
            reserve_draft(&intent).unwrap().content_id,
            reserve_draft(&intent).unwrap().content_id
        );
    }

    #[test]
    fn station_attestation_requires_the_pinned_station_signature() {
        let station_key = SigningKey::from_bytes(&[7; 32]);
        let device_key = DeviceSigningKey::from_parts(
            &[8; 32],
            Signature::from_bytes(&[0; 64]),
            "device-1".to_string(),
        );
        let session = NativeSocialSession::new(
            crate::secure_content::PrivateSocialScope {
                profile_id: "profile-1".to_string(),
                station_peer_id: "station-1".to_string(),
                station_origin: "https://station.test:443".to_string(),
                actor_ptid: "ptid:alice".to_string(),
                device_id: "device-1".to_string(),
            },
            Zeroizing::new("header.payload.signature".to_string()),
            "session-1".to_string(),
            "device-key-1".to_string(),
            1,
            device_key,
            crate::secure_content::TrustedStationSigningKey {
                key_id: "station-key-1".to_string(),
                verifying_key: station_key.verifying_key(),
            },
        )
        .unwrap();
        let now = now_unix_ms() / 1_000;
        let mut attestation = wire::StationContentSigningKeyAttestation {
            format_version: 1,
            station_peer_id: "station-1".to_string(),
            proof_signing_key_id: "proof-key-1".to_string(),
            proof_ed25519_public_key: SigningKey::from_bytes(&[9; 32])
                .verifying_key()
                .to_bytes()
                .to_vec(),
            attesting_signing_key_id: "station-key-1".to_string(),
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
        let mut signing_bytes =
            Vec::with_capacity(STATION_ATTESTATION_DOMAIN.len() + attestation.encoded_len());
        signing_bytes.extend_from_slice(STATION_ATTESTATION_DOMAIN);
        signing_bytes.extend_from_slice(&attestation.encode_to_vec());
        attestation.station_signature = station_key.sign(&signing_bytes).to_bytes().to_vec();

        assert!(verify_station_attestation(&session, &attestation).is_ok());
        attestation.proof_ed25519_public_key[0] ^= 1;
        assert!(verify_station_attestation(&session, &attestation).is_err());
    }
}
