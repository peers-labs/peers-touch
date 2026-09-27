use ed25519_dalek::{Signature, Verifier};
use prost::Message;
use secure_content_core::envelope::{seal_content_key, ContentKey};
use secure_content_core::prekey::ContentPreKeyPublic;
use sha2::{Digest, Sha256};

use crate::model::secure_content as wire;
use crate::secure_content::{SecureContentLease, SecureContentSession};

const PRIVATE_PLAN_LIFETIME_MS: i64 = 5 * 60 * 1_000;
const PRIVATE_PLAN_CLOCK_SKEW_MS: i64 = 30_000;

pub(super) fn validate_content_plan(
    plan: &wire::ContentEncryptionPlan,
    lease: &SecureContentLease,
    content_id: &str,
    object_count: usize,
    domain_binding: &[u8],
    resource_label: &str,
) -> Result<(), String> {
    let resource = plan
        .resource
        .as_ref()
        .ok_or_else(|| format!("{resource_label} plan resource is unavailable"))?;
    let author = plan
        .author
        .as_ref()
        .ok_or_else(|| format!("{resource_label} plan author is unavailable"))?;
    if plan.format_version != 1
        || plan.plan_id.trim().is_empty()
        || resource.owner_domain != wire::SecureContentOwnerDomain::Social as i32
        || resource.content_id != content_id
        || resource.generation == 0
        || author.actor.as_ref().map(|actor| actor.ptid.as_str())
            != Some(lease.session.key.actor_ptid.as_str())
        || author.device_id != lease.session.key.device_id
        || plan.authorization_snapshot_sha256.len() != 32
        || plan.canonical_plan_sha256.len() != 32
        || plan.domain_binding_sha256.len() != 32
        || plan.station_signing_key_id != lease.session.trusted_station_signing_key.key_id
        || plan.station_signature.len() != 64
        || plan.required_slots.is_empty()
        || plan.required_slots.len() > 1000
        || plan.object_ids.len() != object_count
    {
        return Err(format!("{resource_label} plan binding is invalid"));
    }
    let mut unsigned = plan.clone();
    unsigned.canonical_plan_sha256.clear();
    unsigned.station_signature.clear();
    if Sha256::digest(unsigned.encode_to_vec()).as_slice() != plan.canonical_plan_sha256 {
        return Err(format!("{resource_label} plan hash is invalid"));
    }
    let expires_at = plan
        .expires_at
        .as_ref()
        .ok_or_else(|| format!("{resource_label} plan expiry is unavailable"))?;
    let expires_at_ms = expires_at
        .seconds
        .checked_mul(1_000)
        .and_then(|value| value.checked_add(i64::from(expires_at.nanos) / 1_000_000))
        .ok_or_else(|| format!("{resource_label} plan expiry is invalid"))?;
    let now_ms = now_unix_ms();
    if expires_at.nanos < 0
        || expires_at.nanos >= 1_000_000_000
        || expires_at_ms < now_ms.saturating_sub(PRIVATE_PLAN_CLOCK_SKEW_MS)
        || expires_at_ms
            > now_ms
                .saturating_add(PRIVATE_PLAN_LIFETIME_MS)
                .saturating_add(PRIVATE_PLAN_CLOCK_SKEW_MS)
    {
        return Err(format!(
            "{resource_label} plan is expired or has an invalid lifetime"
        ));
    }
    let signature = Signature::from_slice(&plan.station_signature)
        .map_err(|_| format!("{resource_label} plan Station signature is invalid"))?;
    let mut signing_input = plan.clone();
    signing_input.station_signature.clear();
    lease
        .session
        .trusted_station_signing_key
        .verifying_key
        .verify(&signing_input.encode_to_vec(), &signature)
        .map_err(|_| format!("{resource_label} plan Station signature is invalid"))?;
    if !plan
        .required_slots
        .windows(2)
        .all(|slots| slots[0].recipient_slot_id < slots[1].recipient_slot_id)
        || !plan.object_ids.windows(2).all(|ids| ids[0] < ids[1])
        || Sha256::digest(domain_binding).as_slice() != plan.domain_binding_sha256
    {
        return Err(format!("{resource_label} plan commitments are invalid"));
    }
    Ok(())
}

pub(super) fn seal_content_envelopes(
    session: &SecureContentSession,
    plan: &wire::ContentEncryptionPlan,
    payload: &wire::EncryptedPayload,
    object_set_hash: [u8; 32],
    root: &ContentKey,
    resource_label: &str,
) -> Result<Vec<wire::PreparedContentKeyEnvelope>, String> {
    let mut envelopes = Vec::with_capacity(plan.required_slots.len());
    for slot in &plan.required_slots {
        let public: [u8; 32] = slot
            .one_time_public_key
            .as_slice()
            .try_into()
            .map_err(|_| format!("{resource_label} recipient PreKey is invalid"))?;
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
            object_descriptor_set_sha256: object_set_hash.to_vec(),
            plan_expires_at: plan.expires_at,
            sender: plan.author.clone(),
            sender_signing_key_id: session.signing_key_id.clone(),
        };
        let binding_bytes = binding.encode_to_vec();
        let sealed = seal_content_key(
            ContentPreKeyPublic::from_bytes(public),
            &binding_bytes,
            root,
        )?;
        envelopes.push(wire::PreparedContentKeyEnvelope {
            binding: Some(binding),
            binding_sha256: Sha256::digest(&binding_bytes).to_vec(),
            hpke_encapsulated_key: sealed.encapsulated_key,
            hpke_ciphertext: sealed.ciphertext,
            sender_signature: session.sign(&binding_bytes)?,
        });
    }
    Ok(envelopes)
}

pub(super) fn bounded_command_id(prefix: &str, draft_id: &str, revision: u64) -> String {
    let digest = Sha256::digest(format!("{prefix}:{draft_id}:{revision}").as_bytes());
    format!("{prefix}-{}", hex::encode(digest))
}

pub(super) fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}
