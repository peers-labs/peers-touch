use crate::{canonical, digest, offer::VerifiedOffer, proto::*, Error};
use prost::Message;

pub const CLAIM_DOMAIN: &[u8] = b"peers-touch/device-link/claim/v1\0";

pub fn verify_claim(
    claim: &DeviceLinkClaim,
    offer: &VerifiedOffer,
) -> Result<DeviceLinkClaimStatement, Error> {
    let statement: DeviceLinkClaimStatement = canonical(&claim.statement_bytes)?;
    if statement.protocol_version != 1
        || statement.offer_id != offer.statement.offer_id
        || statement.station_peer_id != offer.statement.station_peer_id
        || statement.request_id.is_empty()
        || statement.request_id.len() > 128
        || statement.mobile_device_id.is_empty()
        || statement.mobile_device_id.len() > 128
        || statement.device_label.len() > 128
        || statement.app_version.len() > 64
        || !matches!(statement.platform.as_str(), "android" | "ios")
        || statement.claim_nonce.len() != 32
        || statement.mobile_hpke_public_key.len() != 32
        || statement.mobile_hpke_public_key.iter().all(|b| *b == 0)
        || statement.mobile_device_signing_public_key.len() != 32
        || statement.transport_source_public_key.is_empty()
        || statement.transport_source_public_key.len() > 128
        || statement.lifecycle_generation == 0
        || claim.claim_id.is_empty()
        || claim.access_attempt_id.is_empty()
        || claim.profile_revision == 0
    {
        return Err(Error("invalidClaim"));
    }
    crate::verify_device_signature(
        &statement.mobile_device_signing_public_key,
        CLAIM_DOMAIN,
        &claim.statement_bytes,
        &claim.mobile_device_signature,
    )?;
    Ok(statement)
}

pub fn approval(
    offer: &VerifiedOffer,
    claim: &DeviceLinkClaim,
    revision: u64,
) -> Result<DeviceLinkApprovalTranscript, Error> {
    let mobile = verify_claim(claim, offer)?;
    if revision == 0 {
        return Err(Error("invalidRevision"));
    }
    Ok(DeviceLinkApprovalTranscript {
        protocol_version: 1,
        offer_id: offer.statement.offer_id.clone(),
        offer_digest: offer.digest.to_vec(),
        claim_id: claim.claim_id.clone(),
        claim_digest: digest(&claim.statement_bytes).to_vec(),
        station_peer_id: offer.statement.station_peer_id.clone(),
        actor: offer.statement.actor.clone(),
        desktop_device_id: offer.statement.desktop_device_id.clone(),
        mobile_device_id: mobile.mobile_device_id,
        desktop_hpke_public_key: offer.statement.desktop_hpke_public_key.clone(),
        mobile_hpke_public_key: mobile.mobile_hpke_public_key,
        mobile_device_signing_public_key: mobile.mobile_device_signing_public_key,
        access_attempt_id: claim.access_attempt_id.clone(),
        approval_revision: revision,
        profile_revision: claim.profile_revision,
        expires_at_unix_ms: offer.statement.expires_at_unix_ms,
    })
}

/// Six decimal digits from the entire immutable approval transcript. It is an
/// in-person comparison aid, never a bearer capability or password.
pub fn comparison_code(transcript: &DeviceLinkApprovalTranscript) -> String {
    let hash = digest(&[crate::APPROVAL_DOMAIN, &transcript.encode_to_vec()].concat());
    format!(
        "{:06}",
        u32::from_be_bytes(hash[..4].try_into().unwrap()) % 1_000_000
    )
}
