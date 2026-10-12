use libp2p_identity::{KeyType, PublicKey};
use multiaddr::Multiaddr;
use prost::Message;
use sha2::{Digest, Sha256};
use std::fmt;
use std::str::FromStr;

pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/peers_touch.model.peer.v1.rs"));
}

use proto::{
    StationCapabilitySet, StationIdentityResponse, StationIdentityStatement,
    StationNodeAuthorization, StationNodeAuthorizationStatement, StationRouteAttestation,
    StationRouteKind, StationRouteStatement, StationRouteVisibility,
};

pub const MAX_SIGNED_CONTROL_BYTES: usize = 1 << 20;
pub const STATION_IDENTITY_CHALLENGE_SIZE: usize = 32;
pub const MAX_STATION_IDENTITY_LIFETIME_MS: i64 = 5 * 60 * 1_000;
pub const MAX_NODE_AUTHORIZATION_LIFETIME_MS: i64 = 24 * 60 * 60 * 1_000;
pub const MAX_ROUTE_LIFETIME_MS: i64 = 5 * 60 * 1_000;
pub const CLOCK_SKEW_MS: i64 = 60_000;

const STATION_NODE_AUTHORIZATION_DOMAIN: &[u8] = b"peers-touch/station-node-authorization/v1\0";
const STATION_IDENTITY_DOMAIN: &[u8] = b"peers-touch/station-identity/v1\0";
const STATION_ROUTE_DOMAIN: &[u8] = b"peers-touch/station-route/v1\0";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrustError {
    pub code: &'static str,
}

impl TrustError {
    fn new(code: &'static str) -> Self {
        Self { code }
    }
}

impl fmt::Display for TrustError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code)
    }
}

impl std::error::Error for TrustError {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedNodeAuthorization {
    pub station_peer_id: String,
    pub node_peer_id: String,
    pub station_root_public_key: Vec<u8>,
    pub node_public_key: Vec<u8>,
    pub authorization_digest: [u8; 32],
    pub authorization_epoch: u64,
    pub capabilities_digest: [u8; 32],
    pub expires_at_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedStationIdentity {
    pub station_peer_id: String,
    pub node_peer_id: String,
    pub station_root_public_key: Vec<u8>,
    pub authorization_digest: [u8; 32],
    pub capabilities: Vec<String>,
    pub verified_at_unix_ms: i64,
    pub authorization_epoch: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedStationRoute {
    pub station_peer_id: String,
    pub node_peer_id: String,
    pub station_root_public_key: Vec<u8>,
    pub route_id: String,
    pub route_generation: u64,
    pub relay_peer_id: Option<String>,
    pub inner_tls_spki_sha256: [u8; 32],
    pub authorization_digest: [u8; 32],
    pub authorization_epoch: u64,
    pub addresses: Vec<String>,
    pub expires_at_unix_ms: i64,
}

pub fn station_capabilities_digest(capabilities: &[String]) -> Result<[u8; 32], TrustError> {
    validate_capabilities(capabilities)?;
    let bytes = StationCapabilitySet {
        capabilities: capabilities.to_vec(),
    }
    .encode_to_vec();
    Ok(Sha256::digest(bytes).into())
}

pub fn verify_node_authorization_bytes(
    bytes: &[u8],
    now_unix_ms: i64,
) -> Result<VerifiedNodeAuthorization, TrustError> {
    validate_size(bytes, "authorization_size")?;
    let authorization = StationNodeAuthorization::decode(bytes)
        .map_err(|_| TrustError::new("authorization_decode"))?;
    if authorization.encode_to_vec() != bytes {
        return Err(TrustError::new("authorization_noncanonical"));
    }
    verify_node_authorization(&authorization, now_unix_ms)
}

pub fn verify_station_identity_response_bytes(
    bytes: &[u8],
    challenge: &[u8],
    expected_canonical_origin: &str,
    required_capabilities: &[&str],
    now_unix_ms: i64,
) -> Result<VerifiedStationIdentity, TrustError> {
    validate_size(bytes, "identity_size")?;
    if challenge.len() != STATION_IDENTITY_CHALLENGE_SIZE {
        return Err(TrustError::new("identity_challenge"));
    }
    let response =
        StationIdentityResponse::decode(bytes).map_err(|_| TrustError::new("identity_decode"))?;
    if response.encode_to_vec() != bytes {
        return Err(TrustError::new("identity_noncanonical"));
    }
    let authorization_message = response
        .node_authorization
        .as_ref()
        .ok_or_else(|| TrustError::new("identity_authorization_missing"))?;
    let authorization = verify_node_authorization(authorization_message, now_unix_ms)?;
    let statement = decode_canonical::<StationIdentityStatement>(
        &response.statement_bytes,
        "identity_statement",
    )?;
    if statement.challenge != challenge
        || statement.station_peer_id != authorization.station_peer_id
        || statement.canonical_origin != expected_canonical_origin
        || statement.issued_at_unix_ms > now_unix_ms + CLOCK_SKEW_MS
        || statement.expires_at_unix_ms <= now_unix_ms
        || statement.expires_at_unix_ms <= statement.issued_at_unix_ms
        || statement.expires_at_unix_ms - statement.issued_at_unix_ms
            > MAX_STATION_IDENTITY_LIFETIME_MS
        || statement.expires_at_unix_ms > authorization.expires_at_unix_ms
        || statement.node_authorization_digest != authorization.authorization_digest
    {
        return Err(TrustError::new("identity_fields"));
    }
    validate_capabilities(&statement.capabilities)?;
    if station_capabilities_digest(&statement.capabilities)? != authorization.capabilities_digest {
        return Err(TrustError::new("identity_capabilities_digest"));
    }
    if required_capabilities.iter().any(|required| {
        statement
            .capabilities
            .binary_search_by(|candidate| candidate.as_str().cmp(required))
            .is_err()
    }) {
        return Err(TrustError::new("identity_capability_missing"));
    }
    let node_public_key = decode_ed25519_public_key(&authorization.node_public_key)?;
    verify_signature(
        &node_public_key,
        STATION_IDENTITY_DOMAIN,
        &response.statement_bytes,
        &response.node_signature,
        "identity_signature",
    )?;
    Ok(VerifiedStationIdentity {
        station_peer_id: authorization.station_peer_id,
        node_peer_id: authorization.node_peer_id,
        station_root_public_key: authorization.station_root_public_key,
        authorization_digest: authorization.authorization_digest,
        capabilities: statement.capabilities,
        verified_at_unix_ms: now_unix_ms,
        authorization_epoch: authorization.authorization_epoch,
    })
}

pub fn verify_station_route_attestation_bytes(
    bytes: &[u8],
    expected_relay_peer_id: Option<&str>,
    now_unix_ms: i64,
) -> Result<VerifiedStationRoute, TrustError> {
    validate_size(bytes, "route_size")?;
    let attestation =
        StationRouteAttestation::decode(bytes).map_err(|_| TrustError::new("route_decode"))?;
    if attestation.encode_to_vec() != bytes {
        return Err(TrustError::new("route_noncanonical"));
    }
    let authorization_message = attestation
        .node_authorization
        .as_ref()
        .ok_or_else(|| TrustError::new("route_authorization_missing"))?;
    let authorization = verify_node_authorization(authorization_message, now_unix_ms)?;
    let statement =
        decode_canonical::<StationRouteStatement>(&attestation.statement_bytes, "route_statement")?;
    let visibility = StationRouteVisibility::try_from(statement.visibility).ok();
    let kind = StationRouteKind::try_from(statement.kind).ok();
    let relay_is_valid = match kind {
        Some(StationRouteKind::Direct) => {
            statement.relay_peer_id.is_empty() && expected_relay_peer_id.is_none()
        }
        Some(StationRouteKind::Circuit) => {
            expected_relay_peer_id == Some(statement.relay_peer_id.as_str())
        }
        _ => false,
    };
    if statement.station_peer_id != authorization.station_peer_id
        || statement.node_peer_id != authorization.node_peer_id
        || statement.route_id.trim().is_empty()
        || statement.route_id.trim() != statement.route_id
        || statement.route_generation == 0
        || statement.inner_tls_spki_sha256.len() != 32
        || statement.capabilities_digest != authorization.capabilities_digest
        || statement.node_authorization_digest != authorization.authorization_digest
        || !matches!(
            visibility,
            Some(StationRouteVisibility::Public | StationRouteVisibility::GrantOnly)
        )
        || !relay_is_valid
        || !canonical_addresses(&statement.addresses)
        || !route_addresses_match_kind(&statement, kind)
        || statement.issued_at_unix_ms > now_unix_ms + CLOCK_SKEW_MS
        || statement.expires_at_unix_ms <= now_unix_ms
        || statement.expires_at_unix_ms <= statement.issued_at_unix_ms
        || statement.expires_at_unix_ms - statement.issued_at_unix_ms > MAX_ROUTE_LIFETIME_MS
        || statement.expires_at_unix_ms > authorization.expires_at_unix_ms
    {
        return Err(TrustError::new("route_fields"));
    }
    let node_public_key = decode_ed25519_public_key(&authorization.node_public_key)?;
    verify_signature(
        &node_public_key,
        STATION_ROUTE_DOMAIN,
        &attestation.statement_bytes,
        &attestation.node_signature,
        "route_signature",
    )?;
    let spki: [u8; 32] = statement
        .inner_tls_spki_sha256
        .as_slice()
        .try_into()
        .map_err(|_| TrustError::new("route_spki"))?;
    Ok(VerifiedStationRoute {
        station_peer_id: authorization.station_peer_id,
        node_peer_id: authorization.node_peer_id,
        station_root_public_key: authorization.station_root_public_key,
        route_id: statement.route_id,
        route_generation: statement.route_generation,
        relay_peer_id: match kind {
            Some(StationRouteKind::Circuit) => Some(statement.relay_peer_id),
            _ => None,
        },
        inner_tls_spki_sha256: spki,
        authorization_digest: authorization.authorization_digest,
        authorization_epoch: authorization.authorization_epoch,
        addresses: statement.addresses,
        expires_at_unix_ms: statement.expires_at_unix_ms,
    })
}

fn verify_node_authorization(
    authorization: &StationNodeAuthorization,
    now_unix_ms: i64,
) -> Result<VerifiedNodeAuthorization, TrustError> {
    let authorization_bytes = authorization.encode_to_vec();
    validate_size(&authorization_bytes, "authorization_size")?;
    let statement = decode_canonical::<StationNodeAuthorizationStatement>(
        &authorization.statement_bytes,
        "authorization_statement",
    )?;
    if statement.authorization_epoch == 0
        || statement.capabilities_digest.len() != 32
        || statement.issued_at_unix_ms > now_unix_ms + CLOCK_SKEW_MS
        || statement.expires_at_unix_ms <= now_unix_ms
        || statement.expires_at_unix_ms <= statement.issued_at_unix_ms
        || statement.expires_at_unix_ms - statement.issued_at_unix_ms
            > MAX_NODE_AUTHORIZATION_LIFETIME_MS
    {
        return Err(TrustError::new("authorization_fields"));
    }
    let root_public_key = decode_ed25519_public_key(&authorization.station_root_public_key)?;
    let node_public_key = decode_ed25519_public_key(&statement.node_public_key)?;
    let station_peer_id = root_public_key.to_peer_id().to_string();
    let node_peer_id = node_public_key.to_peer_id().to_string();
    if statement.station_peer_id != station_peer_id
        || statement.node_peer_id != node_peer_id
        || station_peer_id == node_peer_id
    {
        return Err(TrustError::new("authorization_identity"));
    }
    verify_signature(
        &root_public_key,
        STATION_NODE_AUTHORIZATION_DOMAIN,
        &authorization.statement_bytes,
        &authorization.root_signature,
        "authorization_signature",
    )?;
    let capabilities_digest: [u8; 32] = statement
        .capabilities_digest
        .as_slice()
        .try_into()
        .map_err(|_| TrustError::new("authorization_capabilities"))?;
    Ok(VerifiedNodeAuthorization {
        station_peer_id,
        node_peer_id,
        station_root_public_key: authorization.station_root_public_key.clone(),
        node_public_key: statement.node_public_key,
        authorization_digest: Sha256::digest(authorization_bytes).into(),
        authorization_epoch: statement.authorization_epoch,
        capabilities_digest,
        expires_at_unix_ms: statement.expires_at_unix_ms,
    })
}

fn decode_canonical<M: Message + Default>(
    bytes: &[u8],
    code: &'static str,
) -> Result<M, TrustError> {
    validate_size(bytes, code)?;
    let message = M::decode(bytes).map_err(|_| TrustError::new(code))?;
    if message.encode_to_vec() != bytes {
        return Err(TrustError::new(code));
    }
    Ok(message)
}

fn decode_ed25519_public_key(bytes: &[u8]) -> Result<PublicKey, TrustError> {
    let key =
        PublicKey::try_decode_protobuf(bytes).map_err(|_| TrustError::new("public_key_decode"))?;
    if key.key_type() != KeyType::Ed25519 {
        return Err(TrustError::new("public_key_type"));
    }
    Ok(key)
}

fn verify_signature(
    public_key: &PublicKey,
    domain: &[u8],
    statement: &[u8],
    signature: &[u8],
    code: &'static str,
) -> Result<(), TrustError> {
    let mut input = Vec::with_capacity(domain.len() + statement.len());
    input.extend_from_slice(domain);
    input.extend_from_slice(statement);
    if !public_key.verify(&input, signature) {
        return Err(TrustError::new(code));
    }
    Ok(())
}

fn validate_capabilities(capabilities: &[String]) -> Result<(), TrustError> {
    if capabilities.is_empty()
        || capabilities.len() > 64
        || capabilities.iter().any(|capability| {
            capability.is_empty() || capability.trim() != capability || capability.len() > 128
        })
        || capabilities.windows(2).any(|pair| pair[0] >= pair[1])
    {
        return Err(TrustError::new("capabilities_canonical"));
    }
    Ok(())
}

fn canonical_addresses(addresses: &[String]) -> bool {
    !addresses.is_empty()
        && addresses.len() <= 16
        && !addresses
            .iter()
            .any(|address| address.is_empty() || address.trim() != address || address.len() > 2048)
        && !addresses.windows(2).any(|pair| pair[0] >= pair[1])
}

fn route_addresses_match_kind(
    statement: &StationRouteStatement,
    kind: Option<StationRouteKind>,
) -> bool {
    let suffix = match kind {
        Some(StationRouteKind::Direct) => {
            format!("/p2p/{}", statement.node_peer_id)
        }
        Some(StationRouteKind::Circuit) => format!(
            "/p2p/{}/p2p-circuit/p2p/{}",
            statement.relay_peer_id, statement.node_peer_id
        ),
        _ => return false,
    };
    statement.addresses.iter().all(|raw| {
        let Ok(address) = Multiaddr::from_str(raw) else {
            return false;
        };
        if address.to_string() != *raw || !raw.ends_with(&suffix) {
            return false;
        }
        let prefix = raw.trim_end_matches(&suffix);
        !prefix.is_empty()
            && !prefix.contains("/p2p/")
            && !prefix.contains("/p2p-circuit")
            && Multiaddr::from_str(prefix).is_ok_and(|parsed| parsed.to_string() == prefix)
    })
}

fn validate_size(bytes: &[u8], code: &'static str) -> Result<(), TrustError> {
    if bytes.is_empty() || bytes.len() > MAX_SIGNED_CONTROL_BYTES {
        return Err(TrustError::new(code));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use libp2p_identity::Keypair;

    const NOW: i64 = 1_800_000_000_000;

    fn capabilities() -> Vec<String> {
        vec![
            "access-gate".to_string(),
            "station-identity".to_string(),
            "station-route".to_string(),
        ]
    }

    fn authorization(root: &Keypair, node: &Keypair, epoch: u64) -> StationNodeAuthorization {
        let statement = StationNodeAuthorizationStatement {
            station_peer_id: root.public().to_peer_id().to_string(),
            node_peer_id: node.public().to_peer_id().to_string(),
            node_public_key: node.public().encode_protobuf(),
            authorization_epoch: epoch,
            capabilities_digest: station_capabilities_digest(&capabilities())
                .unwrap()
                .to_vec(),
            issued_at_unix_ms: NOW,
            expires_at_unix_ms: NOW + 60 * 60 * 1_000,
        };
        let statement_bytes = statement.encode_to_vec();
        StationNodeAuthorization {
            statement_bytes: statement_bytes.clone(),
            station_root_public_key: root.public().encode_protobuf(),
            root_signature: sign(root, STATION_NODE_AUTHORIZATION_DOMAIN, &statement_bytes),
        }
    }

    fn identity_response(
        root: &Keypair,
        node: &Keypair,
        challenge: &[u8],
    ) -> StationIdentityResponse {
        let authorization = authorization(root, node, 7);
        let authorization_digest: [u8; 32] = Sha256::digest(authorization.encode_to_vec()).into();
        let statement = StationIdentityStatement {
            challenge: challenge.to_vec(),
            station_peer_id: root.public().to_peer_id().to_string(),
            canonical_origin: "https://station.example:443".to_string(),
            capabilities: capabilities(),
            issued_at_unix_ms: NOW,
            expires_at_unix_ms: NOW + 60_000,
            node_authorization_digest: authorization_digest.to_vec(),
        };
        let statement_bytes = statement.encode_to_vec();
        StationIdentityResponse {
            statement_bytes: statement_bytes.clone(),
            node_signature: sign(node, STATION_IDENTITY_DOMAIN, &statement_bytes),
            node_authorization: Some(authorization),
        }
    }

    fn route_attestation(
        root: &Keypair,
        node: &Keypair,
        relay_peer_id: &str,
    ) -> StationRouteAttestation {
        let authorization = authorization(root, node, 7);
        let authorization_digest: [u8; 32] = Sha256::digest(authorization.encode_to_vec()).into();
        let statement = StationRouteStatement {
            station_peer_id: root.public().to_peer_id().to_string(),
            relay_peer_id: relay_peer_id.to_string(),
            route_id: "route-1".to_string(),
            route_generation: 3,
            inner_tls_spki_sha256: vec![9; 32],
            capabilities_digest: station_capabilities_digest(&capabilities())
                .unwrap()
                .to_vec(),
            visibility: StationRouteVisibility::Public as i32,
            issued_at_unix_ms: NOW,
            expires_at_unix_ms: NOW + 60_000,
            node_peer_id: node.public().to_peer_id().to_string(),
            node_authorization_digest: authorization_digest.to_vec(),
            kind: StationRouteKind::Circuit as i32,
            addresses: vec![format!(
                "/ip4/127.0.0.1/tcp/4001/p2p/{relay_peer_id}/p2p-circuit/p2p/{}",
                node.public().to_peer_id()
            )],
        };
        let statement_bytes = statement.encode_to_vec();
        StationRouteAttestation {
            statement_bytes: statement_bytes.clone(),
            node_signature: sign(node, STATION_ROUTE_DOMAIN, &statement_bytes),
            node_authorization: Some(authorization),
        }
    }

    fn sign(key: &Keypair, domain: &[u8], statement: &[u8]) -> Vec<u8> {
        let mut input = domain.to_vec();
        input.extend_from_slice(statement);
        key.sign(&input).unwrap()
    }

    #[test]
    fn two_nodes_retain_one_logical_station_identity() {
        let root = Keypair::generate_ed25519();
        let first_node = Keypair::generate_ed25519();
        let second_node = Keypair::generate_ed25519();
        let challenge = [7_u8; STATION_IDENTITY_CHALLENGE_SIZE];

        let first = verify_station_identity_response_bytes(
            &identity_response(&root, &first_node, &challenge).encode_to_vec(),
            &challenge,
            "https://station.example:443",
            &["station-identity", "station-route"],
            NOW,
        )
        .unwrap();
        let second = verify_station_identity_response_bytes(
            &identity_response(&root, &second_node, &challenge).encode_to_vec(),
            &challenge,
            "https://station.example:443",
            &["station-identity", "station-route"],
            NOW,
        )
        .unwrap();

        assert_eq!(first.station_peer_id, second.station_peer_id);
        assert_ne!(first.node_peer_id, second.node_peer_id);
    }

    #[test]
    fn rejects_root_node_epoch_expiry_capability_relay_and_spki_forgeries() {
        let root = Keypair::generate_ed25519();
        let node = Keypair::generate_ed25519();
        let challenge = [8_u8; STATION_IDENTITY_CHALLENGE_SIZE];
        let identity = identity_response(&root, &node, &challenge);

        let mut wrong_root = identity.clone();
        wrong_root
            .node_authorization
            .as_mut()
            .unwrap()
            .station_root_public_key = Keypair::generate_ed25519().public().encode_protobuf();
        assert!(verify_station_identity_response_bytes(
            &wrong_root.encode_to_vec(),
            &challenge,
            "https://station.example:443",
            &["station-identity"],
            NOW,
        )
        .is_err());

        let mut wrong_node = identity.clone();
        wrong_node.node_signature[0] ^= 0xff;
        assert!(verify_station_identity_response_bytes(
            &wrong_node.encode_to_vec(),
            &challenge,
            "https://station.example:443",
            &["station-identity"],
            NOW,
        )
        .is_err());

        assert!(verify_node_authorization_bytes(
            &authorization(&root, &node, 0).encode_to_vec(),
            NOW,
        )
        .is_err());
        assert!(verify_station_identity_response_bytes(
            &identity.encode_to_vec(),
            &challenge,
            "https://station.example:443",
            &["station-identity"],
            NOW + 60 * 60 * 1_000,
        )
        .is_err());
        assert!(verify_station_identity_response_bytes(
            &identity.encode_to_vec(),
            &challenge,
            "https://station.example:443",
            &["not-authorized"],
            NOW,
        )
        .is_err());

        let relay = Keypair::generate_ed25519()
            .public()
            .to_peer_id()
            .to_string();
        let other_relay = Keypair::generate_ed25519()
            .public()
            .to_peer_id()
            .to_string();
        let route = route_attestation(&root, &node, &relay);
        assert!(verify_station_route_attestation_bytes(
            &route.encode_to_vec(),
            Some(&other_relay),
            NOW,
        )
        .is_err());
        let mut wrong_address_identity = route.clone();
        let mut statement =
            StationRouteStatement::decode(wrong_address_identity.statement_bytes.as_slice())
                .unwrap();
        statement.addresses = vec![format!(
            "/ip4/127.0.0.1/tcp/4001/p2p/{}/p2p-circuit/p2p/{}",
            other_relay,
            node.public().to_peer_id()
        )];
        wrong_address_identity.statement_bytes = statement.encode_to_vec();
        assert!(verify_station_route_attestation_bytes(
            &wrong_address_identity.encode_to_vec(),
            Some(&relay),
            NOW,
        )
        .is_err());
        let mut wrong_spki = route.clone();
        let mut statement =
            StationRouteStatement::decode(wrong_spki.statement_bytes.as_slice()).unwrap();
        statement.inner_tls_spki_sha256[0] ^= 0xff;
        wrong_spki.statement_bytes = statement.encode_to_vec();
        assert!(verify_station_route_attestation_bytes(
            &wrong_spki.encode_to_vec(),
            Some(&relay),
            NOW,
        )
        .is_err());
    }
}
