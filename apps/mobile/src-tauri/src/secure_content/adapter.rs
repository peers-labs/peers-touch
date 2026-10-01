use ed25519_dalek::{Signature, Verifier};
use prost::Message;
use rand::{rngs::OsRng, RngCore};
use secure_content_core::codec::CanonicalMessageEncoder;
use secure_content_core::envelope::{seal_content_key, ContentKey};
use secure_content_core::payload::{
    derive_payload_key, encrypt_payload, PayloadKeyContext, PAYLOAD_FORMAT_VERSION,
};
use secure_content_core::prekey::ContentPreKeyPublic;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use ulid::Ulid;

use crate::secure_content::private_mention::{
    build_signed_mention_routing, canonical_private_mentions, domain_hmac_sha256,
    PrivateMentionIntent,
};
use crate::secure_content::proto::{secure_content::v1 as wire, social::v1 as social};
use crate::secure_content::store::{DurableState, StoredDraft, StoredSubmission};
use crate::secure_content::NativeSocialSession;

const MAX_PRIVATE_TEXT_BYTES: usize = 64 * 1024;
const MAX_PRIVATE_OBJECTS: usize = 10;
const MAX_PRIVATE_RECIPIENT_ACTORS: usize = 256;
const MAX_PRIVATE_RECIPIENT_SLOTS: usize = 1000;
const PRIVATE_PLAN_LIFETIME_MS: i64 = 5 * 60 * 1_000;
const PRIVATE_PLAN_CLOCK_SKEW_MS: i64 = 30_000;
const CLOCK_SKEW_SECONDS: i64 = 60;
const STATION_ATTESTATION_DOMAIN: &[u8] =
    b"peers-touch:secure-content:station-content-signing-key-attestation:v1\0";
const REPOST_SNAPSHOT_DOMAIN: &[u8] = b"peers-touch:secure-content:repost-snapshot:v1";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivateAudienceIntent {
    pub kind: String,
    #[serde(default)]
    pub circle_id: Option<String>,
    #[serde(default)]
    pub group_conversation_id: Option<String>,
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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivateMomentFileIntent {
    pub handle: String,
    pub attachment_id: String,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub duration_ms: u32,
    #[serde(default)]
    pub alt_text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivateMomentLinkIntent {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub image_url: String,
    #[serde(default)]
    pub site_name: String,
    #[serde(default)]
    pub favicon_url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivateMomentLocationIntent {
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub place_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivateMomentPollIntent {
    pub question: String,
    pub options: Vec<String>,
    pub min_choices: u32,
    pub max_choices: u32,
    pub expires_at_seconds: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivateMomentRepostIntent {
    pub source_post_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrivateMomentIntent {
    pub draft_id: String,
    pub draft_revision: u64,
    pub text: String,
    pub audience: PrivateAudienceIntent,
    #[serde(default = "default_moment_kind")]
    pub moment_kind: String,
    #[serde(default)]
    pub mentions: Vec<PrivateMentionIntent>,
    #[serde(default)]
    pub files: Vec<PrivateMomentFileIntent>,
    #[serde(default)]
    pub link: Option<PrivateMomentLinkIntent>,
    #[serde(default)]
    pub location: Option<PrivateMomentLocationIntent>,
    #[serde(default)]
    pub poll: Option<PrivateMomentPollIntent>,
    #[serde(default)]
    pub repost: Option<PrivateMomentRepostIntent>,
}

#[derive(Clone, Debug)]
pub struct PrivateRepostSourceMaterial {
    pub authority: social::PrivateRepostAuthority,
    pub rendered_source: social::RenderedSourceSnapshot,
}

#[derive(Clone, Debug)]
pub struct PrivatePollMaterial {
    pub authority: social::PrivatePollAuthority,
    pub options: Vec<social::PrivatePollOption>,
}

#[derive(Clone, Debug)]
pub struct PreparedPrivateAttachment {
    pub metadata: social::PrivateAttachmentMetadata,
    pub descriptor: wire::EncryptedObjectDescriptor,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrivatePublishState {
    Preparing,
    ReadyPrivate,
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

pub struct PreparedMomentSubmission {
    pub command: StoredSubmission,
}

pub fn validate_text_intent(intent: &PrivateTextMomentIntent) -> Result<(), String> {
    if intent.draft_id.trim().is_empty()
        || intent.draft_id != intent.draft_id.trim()
        || intent.draft_revision == 0
        || intent.text.trim().is_empty()
        || intent.text.len() > MAX_PRIVATE_TEXT_BYTES
    {
        return Err("private Social text intent is invalid".to_string());
    }
    private_audience(&intent.audience, "")?;
    Ok(())
}

pub fn reserve_draft(intent: &PrivateTextMomentIntent) -> Result<StoredDraft, String> {
    validate_text_intent(intent)?;
    let intent_sha256 = intent_hash(intent)?;
    Ok(StoredDraft {
        draft_id: intent.draft_id.clone(),
        draft_revision: intent.draft_revision,
        intent_sha256,
        content_id: Ulid::new().to_string(),
        prepare_command_id: bounded_command_id(
            "mobile-private-prepare",
            &intent.draft_id,
            intent.draft_revision,
        ),
        mention_commitment_salt: None,
        repost_commitment_salt: None,
        object_material_seed: None,
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
        state: PrivatePublishState::ReadyPrivate,
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
            state: DurableState::Prepared,
            lease_generation: 0,
            session_generation: 0,
            post_id: None,
            last_error_code: None,
        },
    })
}

pub fn validate_moment_intent(intent: &PrivateMomentIntent) -> Result<(), String> {
    if intent.draft_id.trim().is_empty()
        || intent.draft_id != intent.draft_id.trim()
        || intent.draft_revision == 0
        || intent.text.trim().is_empty()
        || intent.text.len() > MAX_PRIVATE_TEXT_BYTES
        || intent.files.len() > MAX_PRIVATE_OBJECTS
    {
        return Err("private Social Moment intent is invalid".to_string());
    }
    private_audience(&intent.audience, "")?;
    canonical_private_mentions(&intent.text, &intent.mentions, "private Moment")?;
    let kind = private_moment_kind(&intent.moment_kind)?;
    match kind {
        social::PrivateMomentKind::Text
            if !intent.files.is_empty()
                || intent.link.is_some()
                || intent.location.is_some()
                || intent.poll.is_some()
                || intent.repost.is_some() =>
        {
            Err("private text Moment contains subtype fields".to_string())
        }
        social::PrivateMomentKind::Image
            if intent.files.is_empty()
                || intent.link.is_some()
                || intent.location.is_some()
                || intent.poll.is_some()
                || intent.repost.is_some() =>
        {
            Err("private image Moment requires media only".to_string())
        }
        social::PrivateMomentKind::Video
            if intent.files.is_empty()
                || intent.link.is_some()
                || intent.location.is_some()
                || intent.poll.is_some()
                || intent.repost.is_some() =>
        {
            Err("private video Moment requires media only".to_string())
        }
        social::PrivateMomentKind::Link
            if !intent.files.is_empty()
                || intent.location.is_some()
                || intent.poll.is_some()
                || intent.repost.is_some()
                || intent.link.as_ref().is_none_or(|link| {
                    link.url.trim() != link.url
                        || !(link.url.starts_with("https://") || link.url.starts_with("http://"))
                        || link.title.trim().is_empty()
                }) =>
        {
            Err("private link Moment metadata is invalid".to_string())
        }
        social::PrivateMomentKind::Location
            if intent.link.is_some()
                || intent.poll.is_some()
                || intent.repost.is_some()
                || intent.location.as_ref().is_none_or(|location| {
                    location.name.trim().is_empty()
                        || !location.latitude.is_finite()
                        || !location.longitude.is_finite()
                        || !(-90.0..=90.0).contains(&location.latitude)
                        || !(-180.0..=180.0).contains(&location.longitude)
                }) =>
        {
            Err("private location Moment metadata is invalid".to_string())
        }
        social::PrivateMomentKind::Poll
            if !intent.files.is_empty()
                || intent.link.is_some()
                || intent.location.is_some()
                || intent.repost.is_some()
                || intent.poll.as_ref().is_none_or(|poll| {
                    poll.question.trim().is_empty()
                        || poll.question.trim() != poll.question
                        || !(2..=20).contains(&poll.options.len())
                        || poll
                            .options
                            .iter()
                            .any(|option| option.trim().is_empty() || option.trim() != option)
                        || poll.min_choices == 0
                        || poll.min_choices > poll.max_choices
                        || poll.max_choices > poll.options.len() as u32
                        || poll.expires_at_seconds <= current_unix_seconds()
                }) =>
        {
            Err("private poll Moment metadata is invalid".to_string())
        }
        social::PrivateMomentKind::Repost
            if !intent.files.is_empty()
                || intent.link.is_some()
                || intent.location.is_some()
                || intent.poll.is_some()
                || intent.repost.as_ref().is_none_or(|repost| {
                    repost.source_post_id.trim().is_empty()
                        || repost.source_post_id.trim() != repost.source_post_id
                        || repost.source_post_id.len() > 128
                        || repost.source_post_id.as_bytes().contains(&0)
                }) =>
        {
            Err("private repost Moment source is invalid".to_string())
        }
        social::PrivateMomentKind::Text
        | social::PrivateMomentKind::Image
        | social::PrivateMomentKind::Video
        | social::PrivateMomentKind::Link
        | social::PrivateMomentKind::Poll
        | social::PrivateMomentKind::Repost
        | social::PrivateMomentKind::Location => {
            if intent.files.iter().any(|file| {
                file.handle.trim().is_empty()
                    || file.handle != file.handle.trim()
                    || file.attachment_id.trim().is_empty()
                    || file.attachment_id != file.attachment_id.trim()
                    || file.alt_text.len() > 2048
            }) {
                return Err("private Moment media intent is invalid".to_string());
            }
            Ok(())
        }
        social::PrivateMomentKind::Unspecified => {
            Err("private Moment subtype is invalid".to_string())
        }
    }
}

pub fn reserve_moment_draft(intent: &PrivateMomentIntent) -> Result<StoredDraft, String> {
    validate_moment_intent(intent)?;
    let intent_sha256 = moment_intent_hash(intent)?;
    let mut mention_commitment_salt = (!intent.mentions.is_empty()).then_some([0_u8; 32]);
    if let Some(salt) = mention_commitment_salt.as_mut() {
        OsRng.fill_bytes(salt);
    }
    let mut repost_commitment_salt = (private_moment_kind(&intent.moment_kind)?
        == social::PrivateMomentKind::Repost)
        .then_some([0_u8; 32]);
    if let Some(salt) = repost_commitment_salt.as_mut() {
        OsRng.fill_bytes(salt);
    }
    let mut object_material_seed = (!intent.files.is_empty()).then_some([0_u8; 32]);
    if let Some(seed) = object_material_seed.as_mut() {
        OsRng.fill_bytes(seed);
    }
    Ok(StoredDraft {
        draft_id: intent.draft_id.clone(),
        draft_revision: intent.draft_revision,
        intent_sha256,
        content_id: Ulid::new().to_string(),
        prepare_command_id: bounded_command_id(
            "mobile-private-prepare",
            &intent.draft_id,
            intent.draft_revision,
        ),
        mention_commitment_salt,
        repost_commitment_salt,
        object_material_seed,
    })
}

pub fn prepare_moment_request(
    actor_ptid: &str,
    draft: &StoredDraft,
    intent: &PrivateMomentIntent,
    repost: Option<&PrivateRepostSourceMaterial>,
) -> Result<
    (
        social::PreparePrivateMomentRequest,
        Option<PrivatePollMaterial>,
    ),
    String,
> {
    validate_moment_intent(intent)?;
    let kind = private_moment_kind(&intent.moment_kind)?;
    let poll = private_poll_material(intent, &draft.content_id, kind)?;
    if (kind == social::PrivateMomentKind::Repost) != repost.is_some() {
        return Err("private repost Moment source authority is unavailable".to_string());
    }
    Ok((
        social::PreparePrivateMomentRequest {
            content_id: draft.content_id.clone(),
            audience: Some(private_audience(&intent.audience, actor_ptid)?),
            object_count: intent.files.len() as u32,
            command_id: draft.prepare_command_id.clone(),
            kind: kind as i32,
            repost_authority: repost.map(|value| value.authority.clone()),
            poll_authority: poll.as_ref().map(|value| value.authority.clone()),
        },
        poll,
    ))
}

#[allow(clippy::too_many_arguments)]
pub fn build_moment_submission(
    session: &NativeSocialSession,
    draft: &StoredDraft,
    intent: &PrivateMomentIntent,
    plan: wire::ContentEncryptionPlan,
    attachments: Vec<PreparedPrivateAttachment>,
    poll: Option<PrivatePollMaterial>,
    repost: Option<PrivateRepostSourceMaterial>,
) -> Result<PreparedMomentSubmission, String> {
    validate_moment_intent(intent)?;
    let kind = private_moment_kind(&intent.moment_kind)?;
    if attachments.len() != intent.files.len()
        || (kind == social::PrivateMomentKind::Poll) != poll.is_some()
        || (kind == social::PrivateMomentKind::Repost) != repost.is_some()
    {
        return Err("private Moment prepared material is incomplete".to_string());
    }
    let subtype_authority_sha256 = poll
        .as_ref()
        .map(|value| value.authority.encode_to_vec())
        .or_else(|| repost.as_ref().map(|value| value.authority.encode_to_vec()))
        .map(|value| Sha256::digest(value).to_vec())
        .unwrap_or_default();
    validate_moment_plan(
        session,
        &plan,
        &draft.content_id,
        kind,
        attachments.len(),
        &subtype_authority_sha256,
    )?;
    let resource = plan
        .resource
        .as_ref()
        .ok_or_else(|| "private Moment plan resource is missing".to_string())?
        .clone();
    let mut metadata = Vec::with_capacity(attachments.len());
    let mut descriptors = Vec::with_capacity(attachments.len());
    for (prepared, object_id) in attachments.into_iter().zip(&plan.object_ids) {
        if prepared.descriptor.object_id != *object_id
            || prepared.descriptor.resource.as_ref() != Some(&resource)
            || prepared.metadata.object.as_ref() != Some(&prepared.descriptor)
            || prepared.metadata.object_key.len() != 32
            || prepared.metadata.base_nonce.len() != 12
            || prepared.metadata.plaintext_sha256.len() != 32
        {
            return Err("private Moment prepared attachment is invalid".to_string());
        }
        metadata.push(prepared.metadata);
        descriptors.push(prepared.descriptor);
    }
    let mentions = canonical_private_mentions(&intent.text, &intent.mentions, "private Moment")?;
    let plaintext = private_moment_payload(
        intent,
        kind,
        metadata,
        poll.as_ref(),
        repost.as_ref(),
        &mentions,
        draft.mention_commitment_salt.as_ref(),
        draft.repost_commitment_salt.as_ref(),
    )?
    .encode_to_vec();
    let domain_binding = social::PrivateMomentDomainBinding {
        format_version: PAYLOAD_FORMAT_VERSION,
        kind: kind as i32,
        subtype_prepare_authority_sha256: subtype_authority_sha256,
    }
    .encode_to_vec();
    let authorization_snapshot: [u8; 32] = plan
        .authorization_snapshot_sha256
        .as_slice()
        .try_into()
        .map_err(|_| "private Moment authorization snapshot is invalid".to_string())?;
    let root_key = ContentKey::generate();
    let payload_key = derive_payload_key(
        root_key.as_bytes(),
        &authorization_snapshot,
        &PayloadKeyContext {
            protocol_version: PAYLOAD_FORMAT_VERSION,
            owner_domain: resource.owner_domain as u32,
            content_id: &resource.content_id,
            generation: resource.generation,
            payload_kind: kind as u32,
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
        draft.mention_commitment_salt.as_ref(),
        &plan,
        &payload,
        session,
        "private Moment",
    )?;
    let object_set_hash = object_descriptor_set_hash(&descriptors)?;
    let envelopes = seal_envelopes(session, &plan, &payload, object_set_hash, &root_key)?;
    let command_id = bounded_command_id(
        "mobile-private-submit",
        &intent.draft_id,
        intent.draft_revision,
    );
    let request = social::SubmitPrivateMomentRequest {
        plan: Some(plan),
        payload: Some(payload),
        envelopes,
        objects: descriptors,
        mention_routing,
        poll_authority: poll.map(|value| value.authority),
        repost_authority: repost.map(|value| value.authority),
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
    Ok(PreparedMomentSubmission {
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
    let kind = private_moment_kind_from_post_type(metadata.r#type)?;
    let (subtype_prepare_authority_sha256, subtype_authority_sha256, subtype_matches) =
        match (&request.poll_authority, &request.repost_authority) {
            (Some(authority), None) if kind == social::PrivateMomentKind::Poll => {
                let encoded = authority.encode_to_vec();
                let hash = Sha256::digest(&encoded).to_vec();
                let matches = matches!(
                    verification.subtype_authority.as_ref(),
                    Some(social::private_content_verification::SubtypeAuthority::PollAuthority(
                        value
                    )) if value == authority
                );
                (hash.clone(), hash, matches)
            }
            (None, Some(authority)) if kind == social::PrivateMomentKind::Repost => {
                let encoded = authority.encode_to_vec();
                let hash = Sha256::digest(&encoded).to_vec();
                let matches = matches!(
                    verification.subtype_authority.as_ref(),
                    Some(social::private_content_verification::SubtypeAuthority::RepostAuthority(
                        value
                    )) if value == authority
                );
                (hash.clone(), hash, matches)
            }
            (None, None)
                if !matches!(
                    kind,
                    social::PrivateMomentKind::Poll | social::PrivateMomentKind::Repost
                ) =>
            {
                (
                    Vec::new(),
                    Sha256::digest([]).to_vec(),
                    verification.subtype_authority.is_none(),
                )
            }
            _ => return Err("private Social readback subtype authority mismatched".to_string()),
        };
    let domain_binding = social::PrivateMomentDomainBinding {
        format_version: PAYLOAD_FORMAT_VERSION,
        kind: kind as i32,
        subtype_prepare_authority_sha256,
    }
    .encode_to_vec();
    let domain_binding_sha256 = Sha256::digest(&domain_binding);
    let object_descriptor_set_sha256 = object_descriptor_set_hash(&request.objects)?;
    let mention_routing_sha256 = request
        .mention_routing
        .as_ref()
        .map(|routing| Sha256::digest(routing.encode_to_vec()).to_vec())
        .unwrap_or_else(|| Sha256::digest([]).to_vec());
    if submitted_metadata.post_id != command.content_id
        || metadata.post_id != submitted_metadata.post_id
        || metadata.content_id != command.content_id
        || submitted_author != metadata_author
        || metadata_author != proof_actor
        || proof_author != plan_author
        || proof_author.actor.as_ref().map(|actor| actor.ptid.as_str())
            != Some(session.scope.actor_ptid.as_str())
        || proof_author.device_id != session.scope.device_id
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
        || private.objects != request.objects
        || (kind != social::PrivateMomentKind::Poll && private.poll.is_some())
        || private.viewer_envelope.is_none()
        || verification.mention_routing != request.mention_routing
        || !subtype_matches
        || proof.format_version != PAYLOAD_FORMAT_VERSION
        || proof.domain_commit_id != command.content_id
        || proof.resource.as_ref() != Some(resource_ref)
        || proof.canonical_plan_sha256 != plan.canonical_plan_sha256
        || proof.authorization_snapshot_sha256 != plan.authorization_snapshot_sha256
        || proof.domain_binding_sha256 != domain_binding_sha256.as_slice()
        || proof.encrypted_payload_sha256
            != Sha256::digest(expected_payload.encode_to_vec()).as_slice()
        || proof.object_descriptor_set_sha256 != object_descriptor_set_sha256.as_slice()
        || proof.mention_routing_sha256 != mention_routing_sha256
        || proof.subtype_authority_sha256 != subtype_authority_sha256
        || proof.station_signature.len() != 64
    {
        return Err("private Social readback changed the submitted resource".to_string());
    }
    verify_viewer_envelope(
        session,
        private.viewer_envelope.as_ref().expect("checked above"),
        request,
        proof,
        &object_descriptor_set_sha256,
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
    object_descriptor_set_sha256: &[u8; 32],
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
        || binding.object_descriptor_set_sha256 != object_descriptor_set_sha256
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
    validate_moment_plan(
        session,
        plan,
        content_id,
        social::PrivateMomentKind::Text,
        0,
        &[],
    )
}

fn validate_moment_plan(
    session: &NativeSocialSession,
    plan: &wire::ContentEncryptionPlan,
    content_id: &str,
    kind: social::PrivateMomentKind,
    object_count: usize,
    subtype_prepare_authority_sha256: &[u8],
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
        || plan.object_ids.len() != object_count
        || plan.object_ids.iter().any(|object_id| {
            object_id.trim().is_empty()
                || object_id != object_id.trim()
                || object_id.len() > 128
                || object_id.as_bytes().contains(&0)
        })
        || plan.object_ids.windows(2).any(|pair| pair[0] >= pair[1])
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
    let domain_binding = social::PrivateMomentDomainBinding {
        format_version: PAYLOAD_FORMAT_VERSION,
        kind: kind as i32,
        subtype_prepare_authority_sha256: subtype_prepare_authority_sha256.to_vec(),
    }
    .encode_to_vec();
    if Sha256::digest(domain_binding).as_slice() != plan.domain_binding_sha256 {
        return Err("private Social plan subtype binding is invalid".to_string());
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

pub(crate) fn seal_envelopes(
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
    if actor_ptids.len() > MAX_PRIVATE_RECIPIENT_ACTORS {
        return Err("AUDIENCE_TOO_LARGE".to_string());
    }
    if actor_ptids
        .iter()
        .any(|ptid| ptid.trim().is_empty() || ptid != ptid.trim() || ptid == actor_ptid)
        || actor_ptids.windows(2).any(|pair| pair[0] == pair[1])
    {
        return Err("private Social audience actor list is invalid".to_string());
    }
    let kind = match intent.kind.as_str() {
        "FOLLOWERS" => social::audience::Kind::Followers,
        "FRIENDS" => social::audience::Kind::Friends,
        "CIRCLE" => social::audience::Kind::Circle,
        "GROUP" => social::audience::Kind::Group,
        "SELF" => social::audience::Kind::Self_,
        "CUSTOM_ALLOW" => social::audience::Kind::CustomAllow,
        "CUSTOM_DENY" => social::audience::Kind::CustomDeny,
        _ => return Err("private Social audience is invalid".to_string()),
    };
    let target = match kind {
        social::audience::Kind::Circle if intent.group_conversation_id.is_none() => {
            let raw = intent
                .circle_id
                .as_deref()
                .ok_or_else(|| "private Social circle audience is invalid".to_string())?;
            let circle_id = raw
                .parse::<u64>()
                .map_err(|_| "private Social circle audience is invalid".to_string())?;
            if circle_id == 0 || circle_id.to_string() != raw {
                return Err("private Social circle audience is invalid".to_string());
            }
            Some(social::audience::Target::CircleId(circle_id))
        }
        social::audience::Kind::Group if intent.circle_id.is_none() => {
            let conversation_id = intent
                .group_conversation_id
                .as_deref()
                .ok_or_else(|| "private Social Group audience is invalid".to_string())?;
            if conversation_id.is_empty()
                || conversation_id.trim() != conversation_id
                || conversation_id.as_bytes().contains(&0)
            {
                return Err("private Social Group audience is invalid".to_string());
            }
            Some(social::audience::Target::GroupConversationId(
                conversation_id.to_string(),
            ))
        }
        social::audience::Kind::Circle | social::audience::Kind::Group => {
            return Err("private Social audience fields are inconsistent".to_string())
        }
        _ if intent.circle_id.is_none() && intent.group_conversation_id.is_none() => None,
        _ => return Err("private Social audience fields are inconsistent".to_string()),
    };
    let has_actor_list = !actor_ptids.is_empty();
    let requires_actor_list = matches!(
        kind,
        social::audience::Kind::CustomAllow | social::audience::Kind::CustomDeny
    );
    if has_actor_list != requires_actor_list {
        return Err("private Social audience fields are inconsistent".to_string());
    }
    let base_kind = match kind {
        social::audience::Kind::CustomDeny if intent.base_kind.as_deref() == Some("FOLLOWERS") => {
            social::audience::Kind::Followers as i32
        }
        social::audience::Kind::CustomDeny if intent.base_kind.as_deref() == Some("PUBLIC") => {
            return Err("SOCIAL_PRIVATE_UNSUPPORTED".to_string())
        }
        social::audience::Kind::CustomDeny => {
            return Err("private Social custom deny base is invalid".to_string())
        }
        _ if intent.base_kind.is_none() => social::audience::Kind::Unspecified as i32,
        _ => return Err("private Social audience fields are inconsistent".to_string()),
    };
    Ok(social::Audience {
        kind: kind as i32,
        actor_ptids,
        base_kind,
        target,
    })
}

fn default_moment_kind() -> String {
    "TEXT".to_string()
}

fn private_moment_kind(value: &str) -> Result<social::PrivateMomentKind, String> {
    match value {
        "TEXT" => Ok(social::PrivateMomentKind::Text),
        "IMAGE" => Ok(social::PrivateMomentKind::Image),
        "VIDEO" => Ok(social::PrivateMomentKind::Video),
        "LINK" => Ok(social::PrivateMomentKind::Link),
        "POLL" => Ok(social::PrivateMomentKind::Poll),
        "REPOST" => Ok(social::PrivateMomentKind::Repost),
        "LOCATION" => Ok(social::PrivateMomentKind::Location),
        _ => Err("private Moment subtype is not source-complete".to_string()),
    }
}

fn private_moment_kind_from_post_type(value: i32) -> Result<social::PrivateMomentKind, String> {
    match social::PostType::try_from(value) {
        Ok(social::PostType::Text) => Ok(social::PrivateMomentKind::Text),
        Ok(social::PostType::Image) => Ok(social::PrivateMomentKind::Image),
        Ok(social::PostType::Video) => Ok(social::PrivateMomentKind::Video),
        Ok(social::PostType::Link) => Ok(social::PrivateMomentKind::Link),
        Ok(social::PostType::Poll) => Ok(social::PrivateMomentKind::Poll),
        Ok(social::PostType::Repost) => Ok(social::PrivateMomentKind::Repost),
        Ok(social::PostType::Location) => Ok(social::PrivateMomentKind::Location),
        Err(_) => Err("private Moment readback subtype is invalid".to_string()),
    }
}

#[allow(clippy::too_many_arguments)]
fn private_moment_payload(
    intent: &PrivateMomentIntent,
    kind: social::PrivateMomentKind,
    attachments: Vec<social::PrivateAttachmentMetadata>,
    poll: Option<&PrivatePollMaterial>,
    repost: Option<&PrivateRepostSourceMaterial>,
    mentions: &[social::Mention],
    mention_commitment_salt: Option<&[u8; 32]>,
    repost_commitment_salt: Option<&[u8; 32]>,
) -> Result<social::PrivateMomentContent, String> {
    let body = match kind {
        social::PrivateMomentKind::Text => {
            social::private_moment_content::Body::Text(social::PrivateTextContent {
                text: intent.text.clone(),
                hashtags: Vec::new(),
                mentions: mentions.to_vec(),
            })
        }
        social::PrivateMomentKind::Image => {
            social::private_moment_content::Body::Image(social::PrivateImageContent {
                text: intent.text.clone(),
                images: attachments,
                hashtags: Vec::new(),
                mentions: mentions.to_vec(),
            })
        }
        social::PrivateMomentKind::Video => {
            let source = attachments
                .first()
                .cloned()
                .ok_or_else(|| "private video Moment source is unavailable".to_string())?;
            let poster = attachments.get(1).cloned();
            let variants = attachments
                .iter()
                .skip(2)
                .enumerate()
                .map(|(index, media)| social::PrivateVideoVariant {
                    variant_id: format!("variant-{}", index + 1),
                    bitrate: 0,
                    codec: String::new(),
                    width: media.width,
                    height: media.height,
                    media: Some(media.clone()),
                })
                .collect();
            social::private_moment_content::Body::Video(social::PrivateVideoContent {
                text: intent.text.clone(),
                source: Some(source),
                poster,
                variants,
                hashtags: Vec::new(),
                mentions: mentions.to_vec(),
            })
        }
        social::PrivateMomentKind::Link => {
            let link = intent
                .link
                .as_ref()
                .ok_or_else(|| "private link Moment metadata is unavailable".to_string())?;
            social::private_moment_content::Body::Link(social::PrivateLinkContent {
                text: intent.text.clone(),
                link: Some(social::LinkPreview {
                    url: link.url.clone(),
                    title: link.title.clone(),
                    description: link.description.clone(),
                    image_url: link.image_url.clone(),
                    site_name: link.site_name.clone(),
                    favicon_url: link.favicon_url.clone(),
                }),
                hashtags: Vec::new(),
                mentions: mentions.to_vec(),
            })
        }
        social::PrivateMomentKind::Poll => {
            let poll_intent = intent
                .poll
                .as_ref()
                .ok_or_else(|| "private poll Moment metadata is unavailable".to_string())?;
            let poll =
                poll.ok_or_else(|| "private poll Moment authority is unavailable".to_string())?;
            social::private_moment_content::Body::Poll(social::PrivatePollContent {
                text: intent.text.clone(),
                question: poll_intent.question.clone(),
                options: poll.options.clone(),
                option_set_sha256: poll.authority.option_set_sha256.clone(),
                min_choices: poll.authority.min_choices,
                max_choices: poll.authority.max_choices,
                expires_at: poll.authority.expires_at,
                mentions: mentions.to_vec(),
            })
        }
        social::PrivateMomentKind::Repost => {
            let repost = repost
                .ok_or_else(|| "private repost source material is unavailable".to_string())?;
            let commitment_salt = repost_commitment_salt
                .ok_or_else(|| "private repost commitment salt is unavailable".to_string())?;
            let commitment = domain_hmac_sha256(
                commitment_salt,
                &[
                    REPOST_SNAPSHOT_DOMAIN,
                    &repost.rendered_source.encode_to_vec(),
                ],
            );
            if repost.authority.rendered_source_commitment != commitment {
                return Err("private repost source commitment is invalid".to_string());
            }
            social::private_moment_content::Body::Repost(social::PrivateRepostContent {
                comment: intent.text.clone(),
                original_source: repost.authority.source.clone(),
                rendered_source: Some(repost.rendered_source.clone()),
                mentions: mentions.to_vec(),
                rendered_source_commitment_salt: commitment_salt.to_vec(),
            })
        }
        social::PrivateMomentKind::Location => {
            let location = intent
                .location
                .as_ref()
                .ok_or_else(|| "private location Moment metadata is unavailable".to_string())?;
            social::private_moment_content::Body::Location(social::PrivateLocationContent {
                text: intent.text.clone(),
                location: Some(social::Location {
                    name: location.name.clone(),
                    latitude: location.latitude,
                    longitude: location.longitude,
                    address: location.address.clone(),
                    place_id: location.place_id.clone(),
                }),
                images: attachments,
                hashtags: Vec::new(),
                mentions: mentions.to_vec(),
            })
        }
        social::PrivateMomentKind::Unspecified => {
            return Err("private Moment subtype is invalid".to_string())
        }
    };
    if mentions.is_empty() != mention_commitment_salt.is_none() {
        return Err("private Moment mention salt does not match mentions".to_string());
    }
    Ok(social::PrivateMomentContent {
        format_version: PAYLOAD_FORMAT_VERSION,
        body: Some(body),
        mention_commitment_salt: mention_commitment_salt
            .map(|salt| salt.to_vec())
            .unwrap_or_default(),
    })
}

fn private_poll_material(
    intent: &PrivateMomentIntent,
    content_id: &str,
    kind: social::PrivateMomentKind,
) -> Result<Option<PrivatePollMaterial>, String> {
    if kind != social::PrivateMomentKind::Poll {
        return Ok(None);
    }
    let poll = intent
        .poll
        .as_ref()
        .ok_or_else(|| "private poll Moment metadata is unavailable".to_string())?;
    let options = poll
        .options
        .iter()
        .enumerate()
        .map(|(index, label)| {
            let mut encoder = CanonicalMessageEncoder::new();
            encoder
                .singular_bytes(1, b"peers-touch:secure-content:poll-option:v1")
                .map_err(|error| error.to_string())?;
            encoder
                .singular_bytes(2, content_id.as_bytes())
                .map_err(|error| error.to_string())?;
            encoder
                .singular_varint(3, (index + 1) as u64)
                .map_err(|error| error.to_string())?;
            Ok(social::PrivatePollOption {
                opaque_option_id: Sha256::digest(encoder.finish()).to_vec(),
                label: label.clone(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut opaque_option_ids = options
        .iter()
        .map(|option| option.opaque_option_id.clone())
        .collect::<Vec<_>>();
    opaque_option_ids.sort();
    let option_set_sha256 = private_poll_option_set_hash(&opaque_option_ids)?.to_vec();
    Ok(Some(PrivatePollMaterial {
        authority: social::PrivatePollAuthority {
            resource: Some(wire::SecureResourceRef {
                owner_domain: wire::SecureContentOwnerDomain::Social as i32,
                content_id: content_id.to_string(),
                generation: 1,
            }),
            opaque_option_ids,
            option_set_sha256,
            min_choices: poll.min_choices,
            max_choices: poll.max_choices,
            expires_at: Some(prost_types::Timestamp {
                seconds: poll.expires_at_seconds,
                nanos: 0,
            }),
        },
        options,
    }))
}

fn object_descriptor_set_hash(
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

fn private_poll_option_set_hash(opaque_option_ids: &[Vec<u8>]) -> Result<[u8; 32], String> {
    let mut encoder = CanonicalMessageEncoder::new();
    for option_id in opaque_option_ids {
        encoder
            .repeated_bytes(1, option_id)
            .map_err(|error| error.to_string())?;
    }
    Ok(Sha256::digest(encoder.finish()).into())
}

fn moment_intent_hash(intent: &PrivateMomentIntent) -> Result<[u8; 32], String> {
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
    encoder
        .singular_bytes(5, intent.moment_kind.as_bytes())
        .map_err(|error| error.to_string())?;
    for actor_ptid in &intent.audience.actor_ptids {
        encoder
            .repeated_bytes(6, actor_ptid.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    if let Some(circle_id) = intent.audience.circle_id.as_deref() {
        encoder
            .singular_bytes(7, circle_id.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    if let Some(group_id) = intent.audience.group_conversation_id.as_deref() {
        encoder
            .singular_bytes(8, group_id.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    if let Some(base_kind) = intent.audience.base_kind.as_deref() {
        encoder
            .singular_bytes(9, base_kind.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    for file in &intent.files {
        encoder
            .repeated_bytes(
                10,
                &serde_json::to_vec(file).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
    }
    for (field, value) in [
        (11, intent.link.as_ref().map(serde_json::to_vec)),
        (12, intent.location.as_ref().map(serde_json::to_vec)),
        (13, intent.poll.as_ref().map(serde_json::to_vec)),
        (14, intent.repost.as_ref().map(serde_json::to_vec)),
    ] {
        if let Some(value) = value {
            encoder
                .singular_bytes(field, &value.map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        }
    }
    for mention in canonical_private_mentions(&intent.text, &intent.mentions, "private Moment")? {
        encoder
            .repeated_bytes(15, &mention.encode_to_vec())
            .map_err(|error| error.to_string())?;
    }
    Ok(Sha256::digest(encoder.finish()).into())
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
    match private_audience(&intent.audience, "")?.target {
        Some(social::audience::Target::CircleId(circle_id)) => {
            encoder
                .singular_varint(5, circle_id)
                .map_err(|error| error.to_string())?;
        }
        Some(social::audience::Target::GroupConversationId(conversation_id)) => {
            encoder
                .singular_bytes(8, conversation_id.as_bytes())
                .map_err(|error| error.to_string())?;
        }
        None => {}
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

fn current_unix_seconds() -> i64 {
    now_unix_ms() / 1_000
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
            circle_id: None,
            group_conversation_id: None,
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
    fn audience_uses_typed_targets_and_followers_only_custom_deny() {
        let circle = private_audience(
            &PrivateAudienceIntent {
                kind: "CIRCLE".to_string(),
                circle_id: Some("42".to_string()),
                group_conversation_id: None,
                actor_ptids: Vec::new(),
                base_kind: None,
            },
            "ptid:alice",
        )
        .unwrap();
        assert_eq!(circle.target, Some(social::audience::Target::CircleId(42)));

        let group_conversation_id = "01J9Z7Y6M5N4P3Q2R1S0TUVWXY";
        let group = private_audience(
            &PrivateAudienceIntent {
                kind: "GROUP".to_string(),
                circle_id: None,
                group_conversation_id: Some(group_conversation_id.to_string()),
                actor_ptids: Vec::new(),
                base_kind: None,
            },
            "ptid:alice",
        )
        .unwrap();
        assert_eq!(
            group.target,
            Some(social::audience::Target::GroupConversationId(
                group_conversation_id.to_string()
            ))
        );
        let mixed_target = PrivateAudienceIntent {
            kind: "CIRCLE".to_string(),
            circle_id: Some("42".to_string()),
            group_conversation_id: Some(group_conversation_id.to_string()),
            actor_ptids: Vec::new(),
            base_kind: None,
        };
        assert!(private_audience(&mixed_target, "ptid:alice").is_err());

        let followers_deny = private_audience(
            &PrivateAudienceIntent {
                kind: "CUSTOM_DENY".to_string(),
                circle_id: None,
                group_conversation_id: None,
                actor_ptids: vec!["ptid:bob".to_string()],
                base_kind: Some("FOLLOWERS".to_string()),
            },
            "ptid:alice",
        )
        .unwrap();
        assert_eq!(
            followers_deny.base_kind,
            social::audience::Kind::Followers as i32
        );

        let public_deny = PrivateAudienceIntent {
            kind: "CUSTOM_DENY".to_string(),
            circle_id: None,
            group_conversation_id: None,
            actor_ptids: vec!["ptid:bob".to_string()],
            base_kind: Some("PUBLIC".to_string()),
        };
        assert_eq!(
            private_audience(&public_deny, "ptid:alice").unwrap_err(),
            "SOCIAL_PRIVATE_UNSUPPORTED"
        );
    }

    #[test]
    fn oversized_private_audience_is_typed_before_prepare() {
        let audience = PrivateAudienceIntent {
            kind: "CUSTOM_ALLOW".to_string(),
            circle_id: None,
            group_conversation_id: None,
            actor_ptids: (0..=MAX_PRIVATE_RECIPIENT_ACTORS)
                .map(|index| format!("ptid:recipient-{index}"))
                .collect(),
            base_kind: None,
        };

        assert_eq!(
            private_audience(&audience, "ptid:alice").unwrap_err(),
            "AUDIENCE_TOO_LARGE"
        );
    }

    #[test]
    fn audience_json_rejects_the_retired_target_alias() {
        let legacy = serde_json::from_value::<PrivateAudienceIntent>(serde_json::json!({
            "kind": "CIRCLE",
            "targetId": "42"
        }));
        assert!(legacy.is_err());
    }

    #[test]
    fn draft_content_identity_is_an_opaque_ulid_stabilized_by_the_store() {
        let intent = PrivateTextMomentIntent {
            draft_id: "draft-1".to_string(),
            draft_revision: 2,
            text: "private text".to_string(),
            audience: PrivateAudienceIntent {
                kind: "FRIENDS".to_string(),
                circle_id: None,
                group_conversation_id: None,
                actor_ptids: Vec::new(),
                base_kind: None,
            },
        };
        let store =
            crate::secure_content::store::PrivateSocialStore::in_memory("station-1", "ptid:alice")
                .unwrap();
        let first = store
            .reserve_draft(&reserve_draft(&intent).unwrap())
            .unwrap();
        let replay = store
            .reserve_draft(&reserve_draft(&intent).unwrap())
            .unwrap();
        assert!(Ulid::from_string(&first.content_id).is_ok());
        assert_eq!(replay.content_id, first.content_id);
    }

    fn moment_intent(kind: &str) -> PrivateMomentIntent {
        PrivateMomentIntent {
            draft_id: "draft-generic".to_string(),
            draft_revision: 1,
            text: "private content".to_string(),
            audience: PrivateAudienceIntent {
                kind: "FRIENDS".to_string(),
                circle_id: None,
                group_conversation_id: None,
                actor_ptids: Vec::new(),
                base_kind: None,
            },
            moment_kind: kind.to_string(),
            mentions: Vec::new(),
            files: Vec::new(),
            link: None,
            location: None,
            poll: None,
            repost: None,
        }
    }

    #[test]
    fn generic_intent_enforces_subtype_fields_and_bounds() {
        let mut image = moment_intent("IMAGE");
        assert!(validate_moment_intent(&image).is_err());
        image.files.push(PrivateMomentFileIntent {
            handle: "handle-1".to_string(),
            attachment_id: "attachment-1".to_string(),
            width: 10,
            height: 10,
            duration_ms: 0,
            alt_text: String::new(),
        });
        assert!(validate_moment_intent(&image).is_ok());
        let draft = reserve_moment_draft(&image).unwrap();
        assert!(draft.object_material_seed.is_some());

        let mut poll = moment_intent("POLL");
        poll.poll = Some(PrivateMomentPollIntent {
            question: "Choose".to_string(),
            options: vec!["A".to_string(), "B".to_string()],
            min_choices: 1,
            max_choices: 1,
            expires_at_seconds: current_unix_seconds() + 60,
        });
        assert!(validate_moment_intent(&poll).is_ok());
        let draft = reserve_moment_draft(&poll).unwrap();
        let material =
            private_poll_material(&poll, &draft.content_id, social::PrivateMomentKind::Poll)
                .unwrap()
                .unwrap();
        assert_eq!(material.options.len(), 2);
        assert!(material
            .authority
            .opaque_option_ids
            .windows(2)
            .all(|pair| pair[0] < pair[1]));
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
