use x_config_core::proto::{
    ClientArchitecture, XConfigSnapshotStatement, ClientPlatform, EndpointSeed,
    EndpointSeedKind, ReleaseDescriptor, SignedXConfigSnapshot,
};
use x_config_core::{
    project_suggestions, select_release, AcceptOutcome, XConfigError, Freshness,
    PublisherKeyring, SecureWatermark, SecureWatermarkStore, SnapshotCacheKey, SnapshotCacheStore,
    SnapshotCoordinator, SNAPSHOT_SCHEMA_VERSION, SNAPSHOT_SIGNATURE_DOMAIN,
};
use ed25519_dalek::{Signer, SigningKey};
use libp2p_identity::Keypair;
use prost::Message;
use prost_types::Timestamp;
use sha2::{Digest, Sha256};
use station_trust::proto::{
    AccessEndpointRole, PublicEndpointConnectionMaterial, PublicStationAdvertisementStatement,
    SignedPublicStationAdvertisement, StationRouteVisibility,
};

const NOW: i64 = 1_800_000_000_000;
const PUBLIC_ADVERTISEMENT_DOMAIN: &[u8] = b"peers-touch/public-station-advertisement/v1\0";

#[test]
fn snapshot_exact_bytes_signature_bounds_and_projection() {
    let signer = SigningKey::from_bytes(&[0x11; 32]);
    let keyring =
        PublisherKeyring::new([("publisher-1".to_string(), signer.verifying_key())]).unwrap();
    let bytes = signed_snapshot(&signer, 1, "stable", true);
    let verified = x_config_core::verify_snapshot(&bytes, "stable", &keyring, NOW).unwrap();
    assert_eq!(verified.statement.sequence, 1);
    let suggestions = project_suggestions(&verified, NOW, Freshness::Current);
    assert_eq!(suggestions.len(), 2);
    assert!(suggestions.iter().all(|suggestion| suggestion.actionable));
    assert!(select_release(
        &verified,
        ClientPlatform::Macos,
        ClientArchitecture::Arm64,
        "1.5.0",
        NOW,
    )
    .is_some());
    assert!(select_release(
        &verified,
        ClientPlatform::Android,
        ClientArchitecture::Arm64,
        "1.5.0",
        NOW,
    )
    .is_none());

    let mut tampered = SignedXConfigSnapshot::decode(bytes.as_slice()).unwrap();
    tampered.statement_bytes[0] ^= 0xff;
    assert!(x_config_core::verify_snapshot(
        &tampered.encode_to_vec(),
        "stable",
        &keyring,
        NOW,
    )
    .is_err());
    assert!(x_config_core::verify_snapshot(&bytes, "beta", &keyring, NOW,).is_err());
}

#[test]
fn expired_seed_is_non_actionable_without_invalidating_current_snapshot() {
    let signer = SigningKey::from_bytes(&[0x12; 32]);
    let keyring =
        PublisherKeyring::new([("publisher-1".to_string(), signer.verifying_key())]).unwrap();
    let bytes = expire_relay_material(signed_snapshot(&signer, 1, "stable", false), &signer);

    let verified = x_config_core::verify_snapshot(&bytes, "stable", &keyring, NOW).unwrap();
    let suggestions = project_suggestions(&verified, NOW, Freshness::Current);

    assert_eq!(suggestions.len(), 2);
    assert!(!suggestions[0].actionable);
    assert!(suggestions[1].actionable);
}

#[test]
fn coordinator_can_restore_an_expired_signed_snapshot_as_stale_local_state() {
    let signer = SigningKey::from_bytes(&[0x13; 32]);
    let keyring =
        PublisherKeyring::new([("publisher-1".to_string(), signer.verifying_key())]).unwrap();
    let expired = signed_empty_snapshot(&signer, 1, "stable", NOW - 60_000, NOW - 1);
    assert!(x_config_core::verify_snapshot(&expired, "stable", &keyring, NOW).is_err());

    let mut coordinator = SnapshotCoordinator::new(
        "stable",
        keyring,
        MemoryWatermark {
            value: Some(watermark_for(&expired)),
            ..Default::default()
        },
        MemoryCache {
            values: vec![expired],
            ..Default::default()
        },
    );
    let restored = coordinator.initialize(None, NOW).unwrap().unwrap();

    assert_eq!(restored.statement.sequence, 1);
    assert!(restored.expires_at_unix_ms < NOW);
}

#[test]
fn snapshot_coordinator_rejects_rollback_and_preserves_state_on_persistence_failure() {
    let signer = SigningKey::from_bytes(&[0x22; 32]);
    let keyring =
        PublisherKeyring::new([("publisher-1".to_string(), signer.verifying_key())]).unwrap();
    let first = signed_snapshot(&signer, 1, "stable", false);
    let second = signed_snapshot(&signer, 2, "stable", false);
    let conflicting_second = signed_snapshot_with_label(&signer, 2, "stable", "Changed Relay");
    let mut coordinator = SnapshotCoordinator::new(
        "stable",
        keyring.clone(),
        MemoryWatermark::default(),
        MemoryCache::default(),
    );
    coordinator.initialize(Some(&first), NOW).unwrap();
    assert_eq!(
        coordinator.accept_remote(&second, NOW).unwrap(),
        AcceptOutcome::Advanced
    );
    assert_eq!(coordinator.current().unwrap().statement.sequence, 2);
    assert!(coordinator.accept_remote(&first, NOW).is_err());
    assert!(coordinator.accept_remote(&conflicting_second, NOW).is_err());
    assert_eq!(coordinator.current().unwrap().statement.sequence, 2);

    let mut failing = SnapshotCoordinator::new(
        "stable",
        keyring.clone(),
        MemoryWatermark {
            value: Some(watermark_for(&first)),
            ..Default::default()
        },
        MemoryCache {
            values: vec![first.clone()],
            fail_save: true,
            ..Default::default()
        },
    );
    failing.initialize(None, NOW).unwrap();
    assert!(failing.accept_remote(&second, NOW).is_err());
    assert_eq!(failing.current().unwrap().statement.sequence, 1);

    let mut watermark_failing = SnapshotCoordinator::new(
        "stable",
        keyring.clone(),
        MemoryWatermark {
            value: Some(watermark_for(&first)),
            fail_save: true,
        },
        MemoryCache {
            values: vec![first.clone()],
            ..Default::default()
        },
    );
    watermark_failing.initialize(None, NOW).unwrap();
    assert!(watermark_failing.accept_remote(&second, NOW).is_err());
    assert_eq!(watermark_failing.current().unwrap().statement.sequence, 1);
    let (mut watermark, cache) = watermark_failing.into_stores();
    assert_eq!(cache.values.len(), 2);

    watermark.fail_save = false;
    let mut recovered = SnapshotCoordinator::new("stable", keyring, watermark, cache);
    assert_eq!(
        recovered
            .initialize(None, NOW)
            .unwrap()
            .unwrap()
            .statement
            .sequence,
        1
    );
}

#[derive(Default)]
struct MemoryWatermark {
    value: Option<SecureWatermark>,
    fail_save: bool,
}

impl SecureWatermarkStore for MemoryWatermark {
    fn load(&self, _channel: &str) -> Result<Option<SecureWatermark>, XConfigError> {
        Ok(self.value.clone())
    }

    fn save(&mut self, watermark: &SecureWatermark) -> Result<(), XConfigError> {
        if self.fail_save {
            return Err(test_error("watermark_save"));
        }
        self.value = Some(watermark.clone());
        Ok(())
    }
}

#[derive(Default)]
struct MemoryCache {
    values: Vec<Vec<u8>>,
    fail_save: bool,
}

impl SnapshotCacheStore for MemoryCache {
    fn load_candidates(
        &self,
        _channel: &str,
        _committed: Option<&SnapshotCacheKey>,
    ) -> Result<Vec<Vec<u8>>, XConfigError> {
        Ok(self.values.clone())
    }

    fn save(
        &mut self,
        _channel: &str,
        _key: &SnapshotCacheKey,
        envelope_bytes: &[u8],
    ) -> Result<(), XConfigError> {
        if self.fail_save {
            return Err(test_error("cache_save"));
        }
        if !self.values.iter().any(|value| value == envelope_bytes) {
            self.values.push(envelope_bytes.to_vec());
        }
        Ok(())
    }
}

fn test_error(code: &'static str) -> XConfigError {
    XConfigError::new(code)
}

fn watermark_for(envelope_bytes: &[u8]) -> SecureWatermark {
    let envelope = SignedXConfigSnapshot::decode(envelope_bytes).unwrap();
    let statement =
        XConfigSnapshotStatement::decode(envelope.statement_bytes.as_slice()).unwrap();
    SecureWatermark {
        channel: statement.channel,
        signing_key_id: envelope.signing_key_id,
        sequence: statement.sequence,
        statement_sha256: Sha256::digest(envelope.statement_bytes).into(),
    }
}

fn signed_snapshot(
    signer: &SigningKey,
    sequence: u64,
    channel: &str,
    include_release: bool,
) -> Vec<u8> {
    signed_snapshot_with(signer, sequence, channel, "Public Relay", include_release)
}

fn signed_snapshot_with_label(
    signer: &SigningKey,
    sequence: u64,
    channel: &str,
    label: &str,
) -> Vec<u8> {
    signed_snapshot_with(signer, sequence, channel, label, false)
}

fn signed_snapshot_with(
    signer: &SigningKey,
    sequence: u64,
    channel: &str,
    relay_label: &str,
    include_release: bool,
) -> Vec<u8> {
    let relay_peer_id = "12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW";
    let relay_material = PublicEndpointConnectionMaterial {
        schema_version: 1,
        canonical_discovery_origin: "https://relay.example:443".to_string(),
        expected_endpoint_role: AccessEndpointRole::Relay as i32,
        expected_endpoint_identity: relay_peer_id.to_string(),
        issued_at_unix_ms: NOW - 60_000,
        expires_at_unix_ms: NOW + 24 * 60 * 60 * 1_000,
        ..Default::default()
    };
    let root = Keypair::generate_ed25519();
    let station_material = PublicEndpointConnectionMaterial {
        schema_version: 1,
        canonical_discovery_origin: "https://station.example:443".to_string(),
        expected_endpoint_role: AccessEndpointRole::DirectStation as i32,
        expected_endpoint_identity: root.public().to_peer_id().to_string(),
        expected_station_root_public_key: root.public().encode_protobuf(),
        issued_at_unix_ms: NOW - 60_000,
        expires_at_unix_ms: NOW + 24 * 60 * 60 * 1_000,
        ..Default::default()
    };
    let material_digest: [u8; 32] = Sha256::digest(station_material.encode_to_vec()).into();
    let advertisement_statement = PublicStationAdvertisementStatement {
        schema_version: 1,
        station_peer_id: root.public().to_peer_id().to_string(),
        station_root_public_key: root.public().encode_protobuf(),
        connection_material_digest: material_digest.to_vec(),
        public_discovery_consent: true,
        advertisement_sequence: 1,
        canonical_discovery_origin: station_material.canonical_discovery_origin.clone(),
        display_name: "Public Station".to_string(),
        visibility: StationRouteVisibility::Public as i32,
        issued_at_unix_ms: NOW - 60_000,
        expires_at_unix_ms: NOW + 12 * 60 * 60 * 1_000,
    };
    let advertisement_bytes = advertisement_statement.encode_to_vec();
    let mut signed_advertisement = PUBLIC_ADVERTISEMENT_DOMAIN.to_vec();
    signed_advertisement.extend_from_slice(&advertisement_bytes);
    let station_advertisement = SignedPublicStationAdvertisement {
        statement_bytes: advertisement_bytes,
        station_root_signature: root.sign(&signed_advertisement).unwrap(),
    };
    let statement = XConfigSnapshotStatement {
        schema_version: SNAPSHOT_SCHEMA_VERSION,
        channel: channel.to_string(),
        sequence,
        issued_at: Some(timestamp(NOW - 30_000)),
        expires_at: Some(timestamp(NOW + 6 * 60 * 60 * 1_000)),
        endpoint_seeds: vec![
            EndpointSeed {
                seed_id: "relay-public".to_string(),
                kind: EndpointSeedKind::Relay as i32,
                display_name: relay_label.to_string(),
                connection_material: Some(relay_material),
                regions: vec!["global".to_string()],
                available_from: None,
                available_until: Some(timestamp(NOW + 6 * 60 * 60 * 1_000)),
                ..Default::default()
            },
            EndpointSeed {
                seed_id: "station-public".to_string(),
                kind: EndpointSeedKind::DirectStation as i32,
                display_name: "Public Station".to_string(),
                connection_material: Some(station_material),
                regions: vec!["global".to_string()],
                station_advertisement: Some(station_advertisement),
                available_from: None,
                available_until: Some(timestamp(NOW + 6 * 60 * 60 * 1_000)),
            },
        ],
        releases: if include_release {
            vec![ReleaseDescriptor {
                release_id: "desktop-macos-arm64-2.0.0".to_string(),
                platform: ClientPlatform::Macos as i32,
                architecture: ClientArchitecture::Arm64 as i32,
                version: "2.0.0".to_string(),
                minimum_supported_version: "1.0.0".to_string(),
                manifest_url: "https://releases.example/2.0.0.json".to_string(),
                manifest_sha256: vec![0x88; 32],
                release_signing_key_id: "release-1".to_string(),
                release_notes_url: "https://releases.example/2.0.0".to_string(),
                published_at: Some(timestamp(NOW - 30_000)),
            }]
        } else {
            Vec::new()
        },
        directives: Vec::new(),
        distribution: None,
    };
    let statement_bytes = statement.encode_to_vec();
    let mut signed = SNAPSHOT_SIGNATURE_DOMAIN.to_vec();
    signed.extend_from_slice(&statement_bytes);
    SignedXConfigSnapshot {
        signing_key_id: "publisher-1".to_string(),
        statement_bytes,
        ed25519_signature: signer.sign(&signed).to_bytes().to_vec(),
    }
    .encode_to_vec()
}

fn expire_relay_material(bytes: Vec<u8>, signer: &SigningKey) -> Vec<u8> {
    let mut envelope = SignedXConfigSnapshot::decode(bytes.as_slice()).unwrap();
    let mut statement =
        XConfigSnapshotStatement::decode(envelope.statement_bytes.as_slice()).unwrap();
    let relay = statement.endpoint_seeds.first_mut().unwrap();
    let material = relay.connection_material.as_mut().unwrap();
    material.issued_at_unix_ms = NOW - 60 * 60 * 1_000;
    material.expires_at_unix_ms = NOW - 1;
    relay.available_until = Some(timestamp(NOW - 1));
    envelope.statement_bytes = statement.encode_to_vec();
    let mut signed = SNAPSHOT_SIGNATURE_DOMAIN.to_vec();
    signed.extend_from_slice(&envelope.statement_bytes);
    envelope.ed25519_signature = signer.sign(&signed).to_bytes().to_vec();
    envelope.encode_to_vec()
}

fn signed_empty_snapshot(
    signer: &SigningKey,
    sequence: u64,
    channel: &str,
    issued_at: i64,
    expires_at: i64,
) -> Vec<u8> {
    let statement = XConfigSnapshotStatement {
        schema_version: SNAPSHOT_SCHEMA_VERSION,
        channel: channel.to_string(),
        sequence,
        issued_at: Some(timestamp(issued_at)),
        expires_at: Some(timestamp(expires_at)),
        endpoint_seeds: Vec::new(),
        releases: Vec::new(),
        directives: Vec::new(),
        distribution: None,
    };
    let statement_bytes = statement.encode_to_vec();
    let mut signed = SNAPSHOT_SIGNATURE_DOMAIN.to_vec();
    signed.extend_from_slice(&statement_bytes);
    SignedXConfigSnapshot {
        signing_key_id: "publisher-1".to_string(),
        statement_bytes,
        ed25519_signature: signer.sign(&signed).to_bytes().to_vec(),
    }
    .encode_to_vec()
}

fn timestamp(unix_ms: i64) -> Timestamp {
    Timestamp {
        seconds: unix_ms / 1_000,
        nanos: ((unix_ms % 1_000) * 1_000_000) as i32,
    }
}
