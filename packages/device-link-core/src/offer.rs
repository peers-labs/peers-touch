use crate::{actor::ActorDeviceCertificate, canonical, digest, proto::*, Error, OFFER_DOMAIN};
use prost::Message;

/// A verified offer carries no local keys or credentials. Do not send the scan
/// capability to a renderer; only a redacted Host projection is UI-visible.
pub struct VerifiedOffer {
    pub statement: DeviceLinkOfferStatement,
    pub digest: [u8; 32],
    pub signed: SignedDeviceLinkOffer,
}

impl Drop for VerifiedOffer {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.statement.scan_capability.zeroize();
        self.signed.statement_bytes.zeroize();
    }
}

pub fn verify(
    offer: &SignedDeviceLinkOffer,
    expected_station: &str,
    expected_root: &[u8],
    now: i64,
) -> Result<VerifiedOffer, Error> {
    let authorization = offer
        .node_authorization
        .as_ref()
        .ok_or(Error("missingNodeAuthorization"))?;
    let node = station_trust::verify_node_authorization_bytes(&authorization.encode_to_vec(), now)
        .map_err(|_| Error("invalidNodeAuthorization"))?;
    if node.station_peer_id != expected_station || node.station_root_public_key != expected_root {
        return Err(Error("stationRootMismatch"));
    }
    let statement: DeviceLinkOfferStatement = canonical(&offer.statement_bytes)?;
    let actor = statement.actor.as_ref().ok_or(Error("invalidActor"))?;
    let duration = statement
        .expires_at_unix_ms
        .checked_sub(statement.issued_at_unix_ms);
    if statement.protocol_version != crate::PROTOCOL_VERSION
        || statement.station_peer_id != expected_station
        || statement.station_root_public_key != expected_root
        || actor.ptid.is_empty()
        || statement.offer_id.is_empty()
        || statement.offer_id.len() > 128
        || statement.desktop_device_id.is_empty()
        || statement.desktop_device_id.len() > 128
        || statement.offer_nonce.len() != 32
        || statement.scan_capability.len() != 32
        || statement.desktop_hpke_public_key.len() != 32
        || statement.desktop_hpke_public_key.iter().all(|b| *b == 0)
        || statement.crypto_revision == 0
        || statement.actor_identity_public_key.len() != 32
        || statement.actor_identity_key_fingerprint != digest(&statement.actor_identity_public_key)
        || statement.connections.is_empty()
        || statement.connections.len() > 4
        || statement.issued_at_unix_ms > now.saturating_add(station_trust::CLOCK_SKEW_MS)
        || statement.expires_at_unix_ms <= now
        || statement.expires_at_unix_ms > node.expires_at_unix_ms
        || !duration.is_some_and(|d| d > 0 && d <= crate::MAX_OFFER_MS)
    {
        return Err(Error("invalidOffer"));
    }
    let public = libp2p_identity::PublicKey::try_decode_protobuf(&node.node_public_key)
        .map_err(|_| Error("invalidNodeAuthorization"))?;
    if !public.verify(
        &[OFFER_DOMAIN, &offer.statement_bytes].concat(),
        &offer.node_signature,
    ) {
        return Err(Error("invalidOfferSignature"));
    }
    let certificate = statement
        .desktop_certificate
        .as_ref()
        .ok_or(Error("missingDeviceCertificate"))?;
    verify_certificate(certificate, &statement.desktop_actor_cross_signature)?;
    let device = certificate
        .device
        .as_ref()
        .ok_or(Error("invalidDeviceCertificate"))?;
    if device.actor.as_ref() != Some(actor)
        || device.device_id != statement.desktop_device_id
        || certificate.actor_identity_public_key != statement.actor_identity_public_key
        || certificate.actor_identity_key_fingerprint != statement.actor_identity_key_fingerprint
    {
        return Err(Error("deviceCertificateMismatch"));
    }
    Ok(VerifiedOffer {
        digest: digest(&offer.encode_to_vec()),
        statement,
        signed: offer.clone(),
    })
}

pub fn verify_certificate(
    certificate: &ActorDeviceCertificate,
    cross_signature: &[u8],
) -> Result<(), Error> {
    let device = certificate
        .device
        .as_ref()
        .ok_or(Error("invalidDeviceCertificate"))?;
    if certificate.format_version != 1
        || device.actor.as_ref().is_none_or(|a| a.ptid.is_empty())
        || device.device_id.is_empty()
        || certificate.signing_key_id != hex::encode(digest(&certificate.device_signing_public_key))
        || certificate.observed_profile_version == 0
        || certificate.device_signing_public_key.len() != 32
        || certificate.actor_identity_key_fingerprint
            != digest(&certificate.actor_identity_public_key)
    {
        return Err(Error("invalidDeviceCertificate"));
    }
    // Existing Actor Identity contract signs deterministic certificate bytes.
    crate::verify_device_signature(
        &certificate.actor_identity_public_key,
        b"",
        &certificate.encode_to_vec(),
        cross_signature,
    )
}
