use device_link_core::{
    actor::*, crypto::*, digest, material::*, offer::*, proto::*, transcript::*, *,
};
use ed25519_dalek::{Signer, SigningKey};
use libp2p_identity::Keypair;
use prost::Message;
use station_trust::proto::*;

const NOW: i64 = 1_800_000_000_000;

struct Fixture {
    root: Keypair,
    node: Keypair,
    actor: SigningKey,
    desktop: SigningKey,
    mobile: SigningKey,
    receiver: ReceiverKey,
    signed: SignedDeviceLinkOffer,
}

fn fixture() -> Fixture {
    let root = Keypair::generate_ed25519();
    let node = Keypair::generate_ed25519();
    let actor = SigningKey::from_bytes(&[19; 32]);
    let desktop = SigningKey::from_bytes(&[20; 32]);
    let mobile = SigningKey::from_bytes(&[21; 32]);
    let receiver = ReceiverKey::generate();
    let actor_ref = ActorRef {
        ptid: "ptid:p:test-actor".into(),
        acct: "person@example.test".into(),
        kind: 1,
    };
    let certificate = ActorDeviceCertificate {
        format_version: 1,
        device: Some(ActorDeviceRef {
            actor: Some(actor_ref.clone()),
            device_id: "desktop".into(),
        }),
        actor_identity_public_key: actor.verifying_key().to_bytes().to_vec(),
        actor_identity_key_fingerprint: digest(actor.verifying_key().as_bytes()).to_vec(),
        device_signing_public_key: desktop.verifying_key().to_bytes().to_vec(),
        signing_key_id: hex::encode(digest(desktop.verifying_key().as_bytes())),
        observed_profile_version: 1,
    };
    let statement = DeviceLinkOfferStatement {
        protocol_version: 1,
        offer_id: "offer-1".into(),
        offer_nonce: vec![9; 32],
        station_peer_id: root.public().to_peer_id().to_string(),
        station_root_public_key: root.public().encode_protobuf(),
        actor: Some(actor_ref),
        desktop_device_id: "desktop".into(),
        actor_identity_public_key: certificate.actor_identity_public_key.clone(),
        actor_identity_key_fingerprint: certificate.actor_identity_key_fingerprint.clone(),
        desktop_hpke_public_key: ReceiverKey::generate().public().to_vec(),
        issued_at_unix_ms: NOW,
        expires_at_unix_ms: NOW + 60_000,
        scan_capability: vec![8; 32],
        crypto_revision: 1,
        desktop_actor_cross_signature: actor.sign(&certificate.encode_to_vec()).to_bytes().to_vec(),
        desktop_certificate: Some(certificate),
        connections: vec![DeviceLinkConnectionCandidate {
            material: Some(device_link_connection_candidate::Material::Direct(
                PublicEndpointConnectionMaterial {
                    canonical_discovery_origin: "https://example.test:443".into(),
                    ..Default::default()
                },
            )),
        }],
    };
    let delegation = StationNodeAuthorizationStatement {
        station_peer_id: statement.station_peer_id.clone(),
        node_peer_id: node.public().to_peer_id().to_string(),
        node_public_key: node.public().encode_protobuf(),
        authorization_epoch: 1,
        capabilities_digest: digest(b"capabilities").to_vec(),
        issued_at_unix_ms: NOW,
        expires_at_unix_ms: NOW + 3600_000,
    }
    .encode_to_vec();
    let authorization = StationNodeAuthorization {
        root_signature: root
            .sign(
                &[
                    b"peers-touch/station-node-authorization/v1\0",
                    delegation.as_slice(),
                ]
                .concat(),
            )
            .unwrap(),
        statement_bytes: delegation,
        station_root_public_key: statement.station_root_public_key.clone(),
    };
    let statement_bytes = statement.encode_to_vec();
    let signed = SignedDeviceLinkOffer {
        node_signature: node
            .sign(&[OFFER_DOMAIN, &statement_bytes].concat())
            .unwrap(),
        statement_bytes,
        node_authorization: Some(authorization),
    };
    Fixture {
        root,
        node,
        actor,
        desktop,
        mobile,
        receiver,
        signed,
    }
}

fn verified(f: &Fixture) -> VerifiedOffer {
    verify(
        &f.signed,
        &f.root.public().to_peer_id().to_string(),
        &f.root.public().encode_protobuf(),
        NOW,
    )
    .unwrap()
}

fn claim(f: &Fixture, offer: &VerifiedOffer) -> DeviceLinkClaim {
    let statement_bytes = DeviceLinkClaimStatement {
        protocol_version: 1,
        offer_id: offer.statement.offer_id.clone(),
        request_id: "request".into(),
        station_peer_id: offer.statement.station_peer_id.clone(),
        mobile_device_id: "phone".into(),
        platform: "ios".into(),
        app_version: "1.0".into(),
        device_label: "phone".into(),
        mobile_hpke_public_key: f.receiver.public().to_vec(),
        mobile_device_signing_public_key: f.mobile.verifying_key().to_bytes().to_vec(),
        claim_nonce: vec![11; 32],
        lifecycle_generation: 1,
        transport_source_public_key: Keypair::generate_ed25519().public().encode_protobuf(),
    }
    .encode_to_vec();
    DeviceLinkClaim {
        mobile_device_signature: f
            .mobile
            .sign(&[CLAIM_DOMAIN, &statement_bytes].concat())
            .to_bytes()
            .to_vec(),
        statement_bytes,
        claim_id: "claim".into(),
        access_attempt_id: "access".into(),
        profile_revision: 1,
        ..Default::default()
    }
}

#[test]
fn validates_exact_offer_signature_certificate_root_and_expiry() {
    let f = fixture();
    verified(&f);
    let verify_offer = |offer: &SignedDeviceLinkOffer, now| {
        verify(
            offer,
            &f.root.public().to_peer_id().to_string(),
            &f.root.public().encode_protobuf(),
            now,
        )
    };
    assert!(verify_offer(&f.signed, NOW + 60_000).is_err());
    let mut tampered = f.signed.clone();
    tampered.statement_bytes[5] ^= 1;
    assert!(verify_offer(&tampered, NOW).is_err());
    let mut statement: DeviceLinkOfferStatement = canonical(&f.signed.statement_bytes).unwrap();
    statement
        .desktop_certificate
        .as_mut()
        .unwrap()
        .device_signing_public_key = vec![4; 32];
    tampered.statement_bytes = statement.encode_to_vec();
    tampered.node_signature = f
        .node
        .sign(&[OFFER_DOMAIN, &tampered.statement_bytes].concat())
        .unwrap();
    assert!(verify_offer(&tampered, NOW).is_err());
    assert!(verify(
        &f.signed,
        "other-station",
        &f.root.public().encode_protobuf(),
        NOW
    )
    .is_err());
    let mut noncanonical = f.signed.statement_bytes.clone();
    noncanonical.extend_from_slice(&[0xf8, 0x07, 0x01]); // unknown protobuf field
    assert!(canonical::<DeviceLinkOfferStatement>(&noncanonical).is_err());
}

#[test]
fn approval_authenticates_identity_and_refuses_existing_identity_replacement() {
    let f = fixture();
    let offer = verified(&f);
    let claim = claim(&f, &offer);
    let transcript = approval(&offer, &claim, 4).unwrap();
    let bytes = transcript.encode_to_vec();
    let material = DeviceLinkIdentityMaterial {
        actor_identity_seed: f.actor.to_bytes().to_vec(),
        actor_identity_key_fingerprint: offer.statement.actor_identity_key_fingerprint.clone(),
        approval_transcript_digest: digest(&bytes).to_vec(),
    };
    let envelope = seal(f.receiver.public(), &bytes, &material.encode_to_vec()).unwrap();
    let signature = f
        .desktop
        .sign(&[APPROVAL_DOMAIN, &bytes].concat())
        .to_bytes();
    let read = |existing, now| {
        open_identity(
            &f.receiver,
            &offer,
            &transcript,
            &envelope,
            &signature,
            existing,
            now,
        )
    };
    assert_eq!(read(None, NOW).unwrap().as_slice(), f.actor.to_bytes());
    let existing_key = f.actor.verifying_key();
    assert!(read(Some(existing_key.as_bytes()), NOW).is_ok());
    assert_eq!(
        read(Some(&[72; 32]), NOW).err(),
        Some(Error("identityConflict"))
    );
    assert!(read(None, NOW + 60_000).is_err());
    let attacker_signature = f
        .mobile
        .sign(&[APPROVAL_DOMAIN, &bytes].concat())
        .to_bytes();
    assert!(open_identity(
        &f.receiver,
        &offer,
        &transcript,
        &envelope,
        &attacker_signature,
        None,
        NOW
    )
    .is_err());
    let wrong_seed = DeviceLinkIdentityMaterial {
        actor_identity_seed: vec![25; 32],
        ..material
    };
    let wrong_envelope = seal(f.receiver.public(), &bytes, &wrong_seed.encode_to_vec()).unwrap();
    assert_eq!(
        open_identity(
            &f.receiver,
            &offer,
            &transcript,
            &wrong_envelope,
            &signature,
            None,
            NOW
        )
        .err(),
        Some(Error("identityMismatch"))
    );
}

#[test]
fn claims_require_device_pop_and_codes_bind_the_entire_transcript() {
    let f = fixture();
    let offer = verified(&f);
    let mut claim = claim(&f, &offer);
    let transcript = approval(&offer, &claim, 4).unwrap();
    let code = comparison_code(&transcript);
    assert_eq!(code.len(), 6);
    let mut changed = transcript.clone();
    changed.access_attempt_id = "other-attempt".into();
    assert_ne!(comparison_code(&changed), code);
    changed = transcript.clone();
    changed.mobile_hpke_public_key[0] ^= 1;
    assert_ne!(comparison_code(&changed), code);
    changed = transcript;
    changed.approval_revision += 1;
    assert_ne!(comparison_code(&changed), code);
    claim.mobile_device_signature[0] ^= 1;
    assert!(approval(&offer, &claim, 4).is_err());
}

#[test]
fn credentials_require_node_signed_ciphertext_and_exact_session_scope() {
    use schema_core::proto::peers_touch::model::auth::v1::{AuthTokens, LoginResponse};
    let f = fixture();
    let offer = verified(&f);
    let approval = approval(&offer, &claim(&f, &offer), 4).unwrap();
    let transcript = DeviceLinkCredentialTranscript {
        protocol_version: 1,
        approval_transcript_digest: digest(&approval.encode_to_vec()).to_vec(),
        delivery_id: "delivery".into(),
        session_id: "session".into(),
        mobile_device_id: approval.mobile_device_id.clone(),
        access_attempt_id: approval.access_attempt_id.clone(),
        access_decision_revision: 2,
        expires_at_unix_ms: NOW + 60_000,
    };
    let mut material = DeviceLinkCredentialMaterial {
        login: Some(LoginResponse {
            session_id: transcript.session_id.clone(),
            actor_ref: approval.actor.clone(),
            tokens: Some(AuthTokens {
                access_token: "public-test-token".into(),
                refresh_token: "public-test-refresh".into(),
                ..Default::default()
            }),
        }),
        transcript: Some(transcript.clone()),
        connections: offer.statement.connections.clone(),
    };
    let envelope = seal(
        f.receiver.public(),
        &transcript.encode_to_vec(),
        &material.encode_to_vec(),
    )
    .unwrap();
    let signature = f
        .node
        .sign(&[CREDENTIAL_DOMAIN, &envelope.encode_to_vec()].concat())
        .unwrap();
    let read = |envelope: &DeviceLinkHpkeEnvelope, signature: &[u8]| {
        open_credentials(
            &f.receiver,
            &approval,
            &transcript,
            envelope,
            signature,
            f.signed.node_authorization.as_ref().unwrap(),
            &f.root.public().encode_protobuf(),
            NOW,
        )
    };
    assert!(read(&envelope, &signature).is_ok());
    let wrong_signature = f
        .node
        .sign(&[CREDENTIAL_DOMAIN, &transcript.encode_to_vec()].concat())
        .unwrap();
    assert_eq!(
        read(&envelope, &wrong_signature).err(),
        Some(Error("invalidSignature"))
    );
    let substituted = seal(
        f.receiver.public(),
        &transcript.encode_to_vec(),
        &material.encode_to_vec(),
    )
    .unwrap();
    assert_eq!(
        read(&substituted, &signature).err(),
        Some(Error("invalidSignature"))
    );
    material.login.as_mut().unwrap().session_id = "other-session".into();
    let wrong_session = seal(
        f.receiver.public(),
        &transcript.encode_to_vec(),
        &material.encode_to_vec(),
    )
    .unwrap();
    let signature = f
        .node
        .sign(&[CREDENTIAL_DOMAIN, &wrong_session.encode_to_vec()].concat())
        .unwrap();
    assert_eq!(
        read(&wrong_session, &signature).err(),
        Some(Error("credentialScopeMismatch"))
    );
}
