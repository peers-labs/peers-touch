use crate::error::XConfigError;
use crate::evaluation::{
    directive_value_kind_pub, registered_directive_key, DirectiveValueKind, MAX_DIRECTIVES,
    MAX_DIRECTIVE_RULES, MAX_ROLLOUT_PERMILLE, MAX_TARGET_VALUES,
};
use crate::proto::{XConfigSnapshotStatement, EndpointSeedKind, SignedXConfigSnapshot};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use prost::Message;
use prost_types::Timestamp;
use semver::Version;
use sha2::{Digest, Sha256};
use station_trust::{
    proto::{AccessEndpointRole, PublicStationAdvertisementStatement},
    verify_public_connection_material, verify_public_station_advertisement,
};
use std::collections::{BTreeMap, BTreeSet};
use url::Url;
use serde::Deserialize;

pub const SNAPSHOT_SCHEMA_VERSION: u32 = 1;
pub const SNAPSHOT_SIGNATURE_DOMAIN: &[u8] = b"peers-touch/x-config/v1\0";
pub const MAX_ENVELOPE_BYTES: usize = 256 * 1024;
pub const MAX_SNAPSHOT_LIFETIME_MS: i64 = 7 * 24 * 60 * 60 * 1_000;
pub const CLOCK_SKEW_MS: i64 = 5 * 60 * 1_000;
pub const MAX_ENDPOINT_SEEDS: usize = 128;
pub const MAX_RELEASES: usize = 64;

#[derive(Clone)]
pub struct PublisherKeyring {
    keys: BTreeMap<String, VerifyingKey>,
}

impl PublisherKeyring {
    pub fn new(
        keys: impl IntoIterator<Item = (String, VerifyingKey)>,
    ) -> Result<Self, XConfigError> {
        let keys: BTreeMap<_, _> = keys.into_iter().collect();
        if keys.is_empty() || keys.keys().any(|key_id| !bounded_text(key_id, 128)) {
            return Err(XConfigError::new("publisher_keyring"));
        }
        Ok(Self { keys })
    }

    pub fn from_json(bytes: &[u8]) -> Result<Self, XConfigError> {
        #[derive(Deserialize)]
        struct KeyringDocument {
            schema_version: u32,
            keys: Vec<KeyDocument>,
        }
        #[derive(Deserialize)]
        struct KeyDocument {
            key_id: String,
            ed25519_public_key_base64: String,
        }
        let document: KeyringDocument = serde_json::from_slice(bytes)
            .map_err(|_| XConfigError::new("publisher_keyring"))?;
        if document.schema_version != 1 {
            return Err(XConfigError::new("publisher_keyring"));
        }
        let mut keys = Vec::with_capacity(document.keys.len());
        for key in document.keys {
            let raw = STANDARD
                .decode(key.ed25519_public_key_base64)
                .map_err(|_| XConfigError::new("publisher_keyring"))?;
            let raw: [u8; 32] = raw
                .try_into()
                .map_err(|_| XConfigError::new("publisher_keyring"))?;
            let verifying_key = VerifyingKey::from_bytes(&raw)
                .map_err(|_| XConfigError::new("publisher_keyring"))?;
            keys.push((key.key_id, verifying_key));
        }
        Self::new(keys)
    }

    fn get(&self, key_id: &str) -> Option<&VerifyingKey> {
        self.keys.get(key_id)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct VerifiedSnapshot {
    pub envelope_bytes: Vec<u8>,
    pub statement_bytes: Vec<u8>,
    pub statement_sha256: [u8; 32],
    pub signing_key_id: String,
    pub statement: XConfigSnapshotStatement,
    pub expires_at_unix_ms: i64,
}

pub fn verify_snapshot(
    envelope_bytes: &[u8],
    expected_channel: &str,
    keyring: &PublisherKeyring,
    now_unix_ms: i64,
) -> Result<VerifiedSnapshot, XConfigError> {
    verify_snapshot_with_expiry_policy(
        envelope_bytes,
        expected_channel,
        keyring,
        now_unix_ms,
        false,
    )
}

pub(crate) fn verify_cached_snapshot(
    envelope_bytes: &[u8],
    expected_channel: &str,
    keyring: &PublisherKeyring,
    now_unix_ms: i64,
) -> Result<VerifiedSnapshot, XConfigError> {
    verify_snapshot_with_expiry_policy(
        envelope_bytes,
        expected_channel,
        keyring,
        now_unix_ms,
        true,
    )
}

fn verify_snapshot_with_expiry_policy(
    envelope_bytes: &[u8],
    expected_channel: &str,
    keyring: &PublisherKeyring,
    now_unix_ms: i64,
    allow_expired: bool,
) -> Result<VerifiedSnapshot, XConfigError> {
    if envelope_bytes.is_empty() || envelope_bytes.len() > MAX_ENVELOPE_BYTES {
        return Err(XConfigError::new("snapshot_envelope_size"));
    }
    let envelope =
        decode_canonical::<SignedXConfigSnapshot>(envelope_bytes, "snapshot_envelope")?;
    if !bounded_text(&envelope.signing_key_id, 128)
        || envelope.statement_bytes.is_empty()
        || envelope.statement_bytes.len() > MAX_ENVELOPE_BYTES
        || envelope.ed25519_signature.len() != 64
    {
        return Err(XConfigError::new("snapshot_envelope_fields"));
    }
    let key = keyring
        .get(&envelope.signing_key_id)
        .ok_or_else(|| XConfigError::new("snapshot_signing_key"))?;
    let signature = Signature::from_slice(&envelope.ed25519_signature)
        .map_err(|_| XConfigError::new("snapshot_signature"))?;
    let mut signed =
        Vec::with_capacity(SNAPSHOT_SIGNATURE_DOMAIN.len() + envelope.statement_bytes.len());
    signed.extend_from_slice(SNAPSHOT_SIGNATURE_DOMAIN);
    signed.extend_from_slice(&envelope.statement_bytes);
    key.verify(&signed, &signature)
        .map_err(|_| XConfigError::new("snapshot_signature"))?;

    let statement = decode_canonical::<XConfigSnapshotStatement>(
        &envelope.statement_bytes,
        "snapshot_statement",
    )?;
    let issued_at = timestamp_millis(statement.issued_at.as_ref())?;
    let expires_at = timestamp_millis(statement.expires_at.as_ref())?;
    if statement.schema_version != SNAPSHOT_SCHEMA_VERSION
        || statement.channel != expected_channel
        || !valid_channel(&statement.channel)
        || statement.sequence == 0
        || issued_at > now_unix_ms + CLOCK_SKEW_MS
        || (!allow_expired && expires_at <= now_unix_ms)
        || expires_at <= issued_at
        || expires_at - issued_at > MAX_SNAPSHOT_LIFETIME_MS
        || statement.endpoint_seeds.len() > MAX_ENDPOINT_SEEDS
        || statement.releases.len() > MAX_RELEASES
        || statement.directives.len() > MAX_DIRECTIVES
    {
        return Err(XConfigError::new("snapshot_statement_fields"));
    }
    validate_endpoint_seeds(&statement, now_unix_ms, expires_at)?;
    validate_releases(&statement, now_unix_ms, expires_at)?;
    validate_directives(&statement)?;
    Ok(VerifiedSnapshot {
        envelope_bytes: envelope_bytes.to_vec(),
        statement_bytes: envelope.statement_bytes.clone(),
        statement_sha256: Sha256::digest(&envelope.statement_bytes).into(),
        signing_key_id: envelope.signing_key_id,
        statement,
        expires_at_unix_ms: expires_at,
    })
}

fn validate_endpoint_seeds(
    statement: &XConfigSnapshotStatement,
    now_unix_ms: i64,
    snapshot_expires_at: i64,
) -> Result<(), XConfigError> {
    let mut ids = BTreeSet::new();
    for seed in &statement.endpoint_seeds {
        if !bounded_identifier(&seed.seed_id, 128)
            || !ids.insert(seed.seed_id.as_str())
            || !bounded_text(&seed.display_name, 128)
            || seed.regions.len() > 8
            || seed
                .regions
                .iter()
                .any(|value| !bounded_identifier(value, 64))
            || seed.regions.windows(2).any(|pair| pair[0] >= pair[1])
        {
            return Err(XConfigError::new("snapshot_endpoint_metadata"));
        }
        let material = seed
            .connection_material
            .as_ref()
            .ok_or_else(|| XConfigError::new("snapshot_endpoint_material"))?;
        if material.issued_at_unix_ms > now_unix_ms + CLOCK_SKEW_MS {
            return Err(XConfigError::new("snapshot_endpoint_material"));
        }
        let verified_material = verify_public_connection_material(
            material,
            true,
            material.issued_at_unix_ms,
        )
            .map_err(|_| XConfigError::new("snapshot_endpoint_material"))?;
        let kind = EndpointSeedKind::try_from(seed.kind).ok();
        let expected_role = match kind {
            Some(EndpointSeedKind::Relay) => AccessEndpointRole::Relay,
            Some(EndpointSeedKind::DirectStation) => AccessEndpointRole::DirectStation,
            _ => return Err(XConfigError::new("snapshot_endpoint_kind")),
        };
        if verified_material.expected_endpoint_role != expected_role {
            return Err(XConfigError::new("snapshot_endpoint_role"));
        }
        let available_from =
            optional_timestamp_millis(seed.available_from.as_ref(), material.issued_at_unix_ms)?;
        let available_until =
            optional_timestamp_millis(seed.available_until.as_ref(), material.expires_at_unix_ms)?;
        if available_until <= available_from
            || available_until > material.expires_at_unix_ms
            || available_until > snapshot_expires_at
        {
            return Err(XConfigError::new("snapshot_endpoint_availability"));
        }
        match kind {
            Some(EndpointSeedKind::Relay) => {
                if seed.station_advertisement.is_some() {
                    return Err(XConfigError::new("snapshot_relay_advertisement"));
                }
            }
            Some(EndpointSeedKind::DirectStation) => {
                let advertisement = seed
                    .station_advertisement
                    .as_ref()
                    .ok_or_else(|| XConfigError::new("snapshot_station_advertisement"))?;
                let advertisement_statement = PublicStationAdvertisementStatement::decode(
                    advertisement.statement_bytes.as_slice(),
                )
                .map_err(|_| XConfigError::new("snapshot_station_advertisement"))?;
                if advertisement_statement.issued_at_unix_ms > now_unix_ms + CLOCK_SKEW_MS {
                    return Err(XConfigError::new("snapshot_station_advertisement"));
                }
                let verified = verify_public_station_advertisement(
                    advertisement,
                    material,
                    advertisement_statement.issued_at_unix_ms,
                )
                .map_err(|_| XConfigError::new("snapshot_station_advertisement"))?;
                if verified.statement.display_name != seed.display_name
                    || verified.statement.expires_at_unix_ms < available_until
                {
                    return Err(XConfigError::new("snapshot_station_advertisement"));
                }
            }
            _ => unreachable!(),
        }
    }
    Ok(())
}

fn validate_releases(
    statement: &XConfigSnapshotStatement,
    now_unix_ms: i64,
    snapshot_expires_at: i64,
) -> Result<(), XConfigError> {
    let mut ids = BTreeSet::new();
    for release in &statement.releases {
        let published_at = timestamp_millis(release.published_at.as_ref())?;
        if !bounded_identifier(&release.release_id, 128)
            || !ids.insert(release.release_id.as_str())
            || Version::parse(&release.version).is_err()
            || Version::parse(&release.minimum_supported_version).is_err()
            || !valid_https_url(&release.manifest_url)
            || release.manifest_sha256.len() != 32
            || !bounded_identifier(&release.release_signing_key_id, 128)
            || !valid_https_url(&release.release_notes_url)
            || published_at > now_unix_ms + CLOCK_SKEW_MS
            || published_at > snapshot_expires_at
        {
            return Err(XConfigError::new("snapshot_release"));
        }
    }
    Ok(())
}

fn validate_directives(statement: &XConfigSnapshotStatement) -> Result<(), XConfigError> {
    use crate::proto::{ClientArchitecture, ClientPlatform};

    let mut seed_kinds = BTreeMap::new();
    for seed in &statement.endpoint_seeds {
        if let Ok(kind) = EndpointSeedKind::try_from(seed.kind) {
            seed_kinds.insert(seed.seed_id.as_str(), kind);
        }
    }
    let mut keys = BTreeSet::new();
    for directive in &statement.directives {
        let spec = registered_directive_key(&directive.key)
            .filter(|_| keys.insert(directive.key.as_str()))
            .ok_or_else(|| XConfigError::new("snapshot_directive_key"))?;
        if directive.rules.len() > MAX_DIRECTIVE_RULES {
            return Err(XConfigError::new("snapshot_directive_rules"));
        }
        let fallback = directive
            .fallback
            .as_ref()
            .ok_or_else(|| XConfigError::new("snapshot_directive_fallback"))?;
        validate_directive_value(fallback, spec, &seed_kinds)?;
        let mut rule_ids = BTreeSet::new();
        for rule in &directive.rules {
            if !bounded_identifier(&rule.id, 48) || !rule_ids.insert(rule.id.as_str())
                || rule.rollout_permille > MAX_ROLLOUT_PERMILLE
            {
                return Err(XConfigError::new("snapshot_directive_rule"));
            }
            let rule_value = rule
                .value
                .as_ref()
                .ok_or_else(|| XConfigError::new("snapshot_directive_value"))?;
            validate_directive_value(rule_value, spec, &seed_kinds)?;
            let clause = rule
                .r#match
                .as_ref()
                .ok_or_else(|| XConfigError::new("snapshot_directive_clause"))?;
            if clause.products.len() > MAX_TARGET_VALUES
                || clause.platforms.len() > MAX_TARGET_VALUES
                || clause.architectures.len() > MAX_TARGET_VALUES
                || clause.flavors.len() > MAX_TARGET_VALUES
                || clause.channels.len() > MAX_TARGET_VALUES
                || clause.environments.len() > MAX_TARGET_VALUES
                || clause.regions.len() > MAX_TARGET_VALUES
                || clause.versions.len() > MAX_TARGET_VALUES
                || clause.labels.len() > MAX_TARGET_VALUES
            {
                return Err(XConfigError::new("snapshot_directive_clause"));
            }
            for product in &clause.products {
                if !matches!(product.as_str(), "desktop" | "mobile" | "station")
                    || !bounded_identifier(product, 24)
                {
                    return Err(XConfigError::new("snapshot_directive_clause"));
                }
            }
            for platform in &clause.platforms {
                match ClientPlatform::try_from(*platform) {
                    Ok(ClientPlatform::Macos)
                    | Ok(ClientPlatform::Windows)
                    | Ok(ClientPlatform::Linux)
                    | Ok(ClientPlatform::Ios)
                    | Ok(ClientPlatform::Android) => {}
                    _ => return Err(XConfigError::new("snapshot_directive_clause")),
                }
            }
            for architecture in &clause.architectures {
                match ClientArchitecture::try_from(*architecture) {
                    Ok(ClientArchitecture::Arm64)
                    | Ok(ClientArchitecture::X8664)
                    | Ok(ClientArchitecture::Universal) => {}
                    _ => return Err(XConfigError::new("snapshot_directive_clause")),
                }
            }
            for values in [
                clause.flavors.as_slice(),
                clause.channels.as_slice(),
                clause.environments.as_slice(),
                clause.regions.as_slice(),
            ] {
                for value in values {
                    if !bounded_identifier(value, 32) {
                        return Err(XConfigError::new("snapshot_directive_clause"));
                    }
                }
            }
            for constraint in &clause.versions {
                if !matches!(constraint.comparator.as_str(), ">=" | "<" | "^")
                    || Version::parse(&constraint.version).is_err()
                {
                    return Err(XConfigError::new("snapshot_directive_version"));
                }
            }
            for matcher in &clause.labels {
                if !bounded_identifier(&matcher.key, 64) || !bounded_text(&matcher.value, 32) {
                    return Err(XConfigError::new("snapshot_directive_label"));
                }
            }
        }
    }
    Ok(())
}

fn validate_directive_value(
    value: &crate::proto::DirectiveValue,
    spec: crate::evaluation::DirectiveKeySpec,
    seed_kinds: &BTreeMap<&str, EndpointSeedKind>,
) -> Result<(), XConfigError> {
    let kind = directive_value_kind_pub(value)
        .ok_or_else(|| XConfigError::new("snapshot_directive_value"))?;
    if kind != spec.value_kind {
        return Err(XConfigError::new("snapshot_directive_value_kind"));
    }
    if kind == DirectiveValueKind::EndpointSeed {
        if let Some(crate::proto::directive_value::Value::EndpointSeedId(seed_id)) =
            &value.value
        {
            let actual = seed_kinds
                .get(seed_id.as_str())
                .ok_or_else(|| XConfigError::new("snapshot_directive_seed_ref"))?;
            let expected = spec
                .endpoint_kind
                .ok_or_else(|| XConfigError::new("snapshot_directive_value_kind"))?;
            if *actual != expected {
                return Err(XConfigError::new("snapshot_directive_seed_kind"));
            }
        }
    }
    Ok(())
}

fn decode_canonical<M: Message + Default>(
    bytes: &[u8],
    code: &'static str,
) -> Result<M, XConfigError> {
    if bytes.is_empty() || bytes.len() > MAX_ENVELOPE_BYTES {
        return Err(XConfigError::new(code));
    }
    let message = M::decode(bytes).map_err(|_| XConfigError::new(code))?;
    if message.encode_to_vec() != bytes {
        return Err(XConfigError::new(code));
    }
    Ok(message)
}

pub(crate) fn timestamp_millis(timestamp: Option<&Timestamp>) -> Result<i64, XConfigError> {
    let value = timestamp.ok_or_else(|| XConfigError::new("timestamp"))?;
    if value.nanos < 0 || value.nanos >= 1_000_000_000 || value.nanos % 1_000_000 != 0 {
        return Err(XConfigError::new("timestamp"));
    }
    value
        .seconds
        .checked_mul(1_000)
        .and_then(|seconds| seconds.checked_add(i64::from(value.nanos / 1_000_000)))
        .ok_or_else(|| XConfigError::new("timestamp"))
}

fn optional_timestamp_millis(
    timestamp: Option<&Timestamp>,
    fallback: i64,
) -> Result<i64, XConfigError> {
    timestamp.map_or(Ok(fallback), |value| timestamp_millis(Some(value)))
}

fn valid_channel(value: &str) -> bool {
    bounded_identifier(value, 32)
        && value.bytes().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == b'-'
        })
}

fn bounded_identifier(value: &str, maximum: usize) -> bool {
    bounded_text(value, maximum) && !value.chars().any(char::is_whitespace)
}

fn bounded_text(value: &str, maximum: usize) -> bool {
    !value.is_empty() && value.trim() == value && value.len() <= maximum
}

fn valid_https_url(value: &str) -> bool {
    if value.len() > 512 {
        return false;
    }
    Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none()
    })
}
