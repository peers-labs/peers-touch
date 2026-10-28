use crate::{canonical, crypto, digest, offer::VerifiedOffer, proto::*, Error};
use prost::Message;
use zeroize::{Zeroize, Zeroizing};

pub fn open_identity(
    receiver: &crypto::ReceiverKey,
    offer: &VerifiedOffer,
    transcript: &DeviceLinkApprovalTranscript,
    envelope: &DeviceLinkHpkeEnvelope,
    desktop_signature: &[u8],
    existing_identity_public_key: Option<&[u8]>,
    now: i64,
) -> Result<Zeroizing<[u8; 32]>, Error> {
    let certificate = offer
        .statement
        .desktop_certificate
        .as_ref()
        .ok_or(Error("missingDeviceCertificate"))?;
    let bytes = transcript.encode_to_vec();
    if transcript.expires_at_unix_ms <= now
        || transcript.offer_id != offer.statement.offer_id
        || transcript.offer_digest != offer.digest
        || transcript.actor != offer.statement.actor
        || transcript.station_peer_id != offer.statement.station_peer_id
        || transcript.desktop_device_id != offer.statement.desktop_device_id
        || transcript.desktop_hpke_public_key != offer.statement.desktop_hpke_public_key
        || transcript.mobile_hpke_public_key != receiver.public()
    {
        return Err(Error("transcriptMismatch"));
    }
    crate::verify_device_signature(
        &certificate.device_signing_public_key,
        crate::APPROVAL_DOMAIN,
        &bytes,
        desktop_signature,
    )?;
    let plaintext = crypto::open(receiver, envelope, &bytes)?;
    if plaintext.len() > crate::MAX_IDENTITY_BYTES {
        return Err(Error("invalidSize"));
    }
    let mut material: DeviceLinkIdentityMaterial = canonical(&plaintext)?;
    let result = (|| {
        let seed = Zeroizing::new(
            material
                .actor_identity_seed
                .as_slice()
                .try_into()
                .map_err(|_| Error("invalidIdentitySeed"))?,
        );
        let public = ed25519_dalek::SigningKey::from_bytes(&seed)
            .verifying_key()
            .to_bytes();
        if public.as_slice() != offer.statement.actor_identity_public_key
            || digest(&public).as_slice() != material.actor_identity_key_fingerprint
            || material.actor_identity_key_fingerprint
                != offer.statement.actor_identity_key_fingerprint
            || material.approval_transcript_digest != digest(&bytes)
        {
            return Err(Error("identityMismatch"));
        }
        if existing_identity_public_key.is_some_and(|existing| existing != public) {
            return Err(Error("identityConflict"));
        }
        Ok(seed)
    })();
    material.actor_identity_seed.zeroize();
    result
}

/// Node-authenticated delivery. Plaintext stays native and must be durably
/// encrypted by the Host before ack. This does not itself activate a Session.
pub fn open_credentials(
    receiver: &crypto::ReceiverKey,
    approval: &DeviceLinkApprovalTranscript,
    expected: &DeviceLinkCredentialTranscript,
    envelope: &DeviceLinkHpkeEnvelope,
    node_signature: &[u8],
    authorization: &station_trust::proto::StationNodeAuthorization,
    expected_root: &[u8],
    now: i64,
) -> Result<Zeroizing<Vec<u8>>, Error> {
    let node = station_trust::verify_node_authorization_bytes(&authorization.encode_to_vec(), now)
        .map_err(|_| Error("invalidNodeAuthorization"))?;
    let bytes = expected.encode_to_vec();
    if expected.protocol_version != 1
        || expected.expires_at_unix_ms <= now
        || expected.expires_at_unix_ms > approval.expires_at_unix_ms
        || expected.approval_transcript_digest != digest(&approval.encode_to_vec())
        || expected.mobile_device_id != approval.mobile_device_id
        || expected.access_attempt_id != approval.access_attempt_id
        || expected.access_decision_revision == 0
        || expected.delivery_id.is_empty()
        || expected.session_id.is_empty()
        || approval.mobile_hpke_public_key != receiver.public()
        || node.station_peer_id != approval.station_peer_id
        || node.station_root_public_key != expected_root
    {
        return Err(Error("credentialScopeMismatch"));
    }
    let public = libp2p_identity::PublicKey::try_decode_protobuf(&node.node_public_key)
        .map_err(|_| Error("invalidNodeAuthorization"))?;
    if !public.verify(
        &[crate::CREDENTIAL_DOMAIN, &envelope.encode_to_vec()].concat(),
        node_signature,
    ) {
        return Err(Error("invalidSignature"));
    }
    let plaintext = crypto::open(receiver, envelope, &bytes)?;
    let mut material: DeviceLinkCredentialMaterial = canonical(&plaintext)?;
    let valid = material.transcript.as_ref() == Some(expected)
        && material.login.as_ref().is_some_and(|login| {
            login.session_id == expected.session_id
                && login.actor_ref.as_ref() == approval.actor.as_ref()
                && login.tokens.as_ref().is_some_and(|tokens| {
                    !tokens.access_token.is_empty()
                        && (tokens.token.is_empty() || tokens.token == tokens.access_token)
                })
        })
        && !material.connections.is_empty()
        && material.connections.len() <= 4;
    if let Some(tokens) = material
        .login
        .as_mut()
        .and_then(|login| login.tokens.as_mut())
    {
        tokens.token.zeroize();
        tokens.access_token.zeroize();
        tokens.refresh_token.zeroize();
    }
    if !valid {
        return Err(Error("credentialScopeMismatch"));
    }
    Ok(plaintext)
}
