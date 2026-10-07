use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use libp2p_identity::PublicKey;
use prost::Message;
use rand::RngCore;
use reqwest::blocking::Client;
use reqwest::redirect::Policy;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::model::peer::{
    AccessEndpointOutcome, AccessEndpointRequest, AccessEndpointResponse, AccessEndpointRole,
    StationConnectionEnvelope, StationRouteAttestation, StationRouteStatement,
    StationRouteVisibility,
};

const ACCESS_PATH: &str = "/.well-known/peers-touch/access";
const ACCESS_ENDPOINT_DOMAIN: &[u8] = b"peers-touch/access-endpoint/v1\0";
const STATION_ROUTE_DOMAIN: &[u8] = b"peers-touch/station-route/v1\0";
const ACCESS_PROTOCOL_VERSION: u32 = 1;
const DISCOVERY_CHALLENGE_SIZE: usize = 32;
const CLOCK_SKEW_MS: i64 = 60_000;
const MAX_ROUTE_LIFETIME_MS: i64 = 24 * 60 * 60 * 1_000;
const MAX_DISCOVERY_RESPONSE_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VerifiedEndpointRole {
    DirectStation,
    Relay,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedEndpoint {
    pub role: VerifiedEndpointRole,
    pub endpoint_peer_id: String,
    pub canonical_origin: String,
    pub endpoint_public_key: Vec<u8>,
    pub routes: Vec<VerifiedStationRoute>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedStationRoute {
    pub station_peer_id: String,
    pub station_host_public_key: Vec<u8>,
    pub route_id: String,
    pub route_generation: u64,
    pub endpoint_origin: String,
    pub relay_peer_id: Option<String>,
    pub inner_tls_spki_sha256: Option<[u8; 32]>,
    pub attestation_bytes: Option<Vec<u8>>,
    pub connection_grant: Option<Vec<u8>>,
    pub expires_at_unix_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StationDiscoveryError {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

impl StationDiscoveryError {
    fn new(code: &'static str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
        }
    }
}

pub fn discover_station_input(input: &str) -> Result<VerifiedEndpoint, StationDiscoveryError> {
    let parsed = parse_input(input)?;
    let mut challenge = [0_u8; DISCOVERY_CHALLENGE_SIZE];
    rand::thread_rng().fill_bytes(&mut challenge);
    let request = AccessEndpointRequest {
        challenge: challenge.to_vec(),
        connection_grant: parsed.connection_grant.clone().unwrap_or_default(),
        client_protocol_version: ACCESS_PROTOCOL_VERSION,
    };
    let endpoint = format!("{}{}", parsed.origin, ACCESS_PATH);
    let response = Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(Policy::none())
        .build()
        .map_err(|error| {
            StationDiscoveryError::new(
                "station_discovery_unavailable",
                format!("Could not initialize endpoint discovery: {error}"),
                true,
            )
        })?
        .post(endpoint)
        .header("Accept", "application/protobuf")
        .header("Content-Type", "application/protobuf")
        .body(request.encode_to_vec())
        .send()
        .map_err(|error| {
            StationDiscoveryError::new(
                "station_unreachable",
                format!("The Station access endpoint is unavailable: {error}"),
                true,
            )
        })?;
    if !response.status().is_success() {
        return Err(StationDiscoveryError::new(
            "station_discovery_rejected",
            format!("Endpoint discovery returned {}", response.status()),
            response.status().is_server_error(),
        ));
    }
    let bytes = response.bytes().map_err(|error| {
        StationDiscoveryError::new(
            "station_discovery_invalid",
            format!("Could not read endpoint discovery response: {error}"),
            true,
        )
    })?;
    if bytes.len() > MAX_DISCOVERY_RESPONSE_BYTES {
        return Err(StationDiscoveryError::new(
            "station_discovery_invalid",
            "Endpoint discovery response exceeds the size limit",
            false,
        ));
    }
    let response = AccessEndpointResponse::decode(bytes.as_ref()).map_err(|error| {
        StationDiscoveryError::new(
            "station_discovery_invalid",
            format!("Endpoint discovery response is not canonical protobuf: {error}"),
            false,
        )
    })?;
    verify_discovery_response(
        &parsed.origin,
        parsed.connection_grant,
        &challenge,
        response,
        unix_ms(),
    )
}

fn verify_discovery_response(
    requested_origin: &str,
    connection_grant: Option<Vec<u8>>,
    challenge: &[u8],
    response: AccessEndpointResponse,
    now_unix_ms: i64,
) -> Result<VerifiedEndpoint, StationDiscoveryError> {
    let statement = crate::model::peer::AccessEndpointStatement::decode(
        response.endpoint_statement_bytes.as_slice(),
    )
    .map_err(|_| invalid_discovery("Endpoint statement cannot be decoded"))?;
    if statement.encode_to_vec() != response.endpoint_statement_bytes
        || statement.challenge != challenge
        || statement.canonical_origin.trim_end_matches('/')
            != requested_origin.trim_end_matches('/')
        || !statement
            .protocol_versions
            .contains(&ACCESS_PROTOCOL_VERSION)
        || statement.issued_at_unix_ms > now_unix_ms + CLOCK_SKEW_MS
        || statement.expires_at_unix_ms < now_unix_ms - CLOCK_SKEW_MS
        || statement.expires_at_unix_ms <= statement.issued_at_unix_ms
    {
        return Err(invalid_discovery("Endpoint statement fields are invalid"));
    }
    let endpoint_public_key = verify_signed_statement(
        &response.endpoint_public_key,
        &response.endpoint_signature,
        ACCESS_ENDPOINT_DOMAIN,
        &response.endpoint_statement_bytes,
        &statement.endpoint_peer_id,
    )?;

    match AccessEndpointRole::try_from(statement.endpoint_role).ok() {
        Some(AccessEndpointRole::DirectStation) => {
            if response.outcome != AccessEndpointOutcome::Ready as i32
                || !response.station_routes.is_empty()
                || connection_grant.is_some()
            {
                return Err(invalid_discovery(
                    "Direct Station discovery outcome is invalid",
                ));
            }
            let route_id = direct_route_id(&statement.endpoint_peer_id, requested_origin);
            Ok(VerifiedEndpoint {
                role: VerifiedEndpointRole::DirectStation,
                endpoint_peer_id: statement.endpoint_peer_id.clone(),
                canonical_origin: statement.canonical_origin.clone(),
                endpoint_public_key: endpoint_public_key.clone(),
                routes: vec![VerifiedStationRoute {
                    station_peer_id: statement.endpoint_peer_id,
                    station_host_public_key: endpoint_public_key,
                    route_id,
                    route_generation: 1,
                    endpoint_origin: statement.canonical_origin,
                    relay_peer_id: None,
                    inner_tls_spki_sha256: None,
                    attestation_bytes: None,
                    connection_grant: None,
                    expires_at_unix_ms: None,
                }],
            })
        }
        Some(AccessEndpointRole::Relay) => {
            verify_relay_outcome(&response)?;
            let mut routes = Vec::with_capacity(response.station_routes.len());
            for attestation in &response.station_routes {
                routes.push(verify_route_attestation(
                    attestation,
                    &statement.endpoint_peer_id,
                    &statement.canonical_origin,
                    connection_grant.clone(),
                    now_unix_ms,
                )?);
            }
            Ok(VerifiedEndpoint {
                role: VerifiedEndpointRole::Relay,
                endpoint_peer_id: statement.endpoint_peer_id,
                canonical_origin: statement.canonical_origin,
                endpoint_public_key,
                routes,
            })
        }
        _ => Err(invalid_discovery("Endpoint role is unsupported")),
    }
}

fn verify_relay_outcome(response: &AccessEndpointResponse) -> Result<(), StationDiscoveryError> {
    let outcome = AccessEndpointOutcome::try_from(response.outcome).ok();
    match outcome {
        Some(AccessEndpointOutcome::Ready) if response.station_routes.len() == 1 => Ok(()),
        Some(AccessEndpointOutcome::MultipleCandidates) if response.station_routes.len() > 1 => {
            Ok(())
        }
        Some(AccessEndpointOutcome::NoCandidates) => Err(StationDiscoveryError::new(
            "station_no_candidates",
            "The Relay has no available Station routes",
            true,
        )),
        Some(AccessEndpointOutcome::GrantExpired) => Err(StationDiscoveryError::new(
            "station_connection_grant_expired",
            "The private Station connection material has expired",
            false,
        )),
        Some(AccessEndpointOutcome::GrantReplayed) => Err(StationDiscoveryError::new(
            "station_connection_grant_replayed",
            "The private Station connection material was already used",
            false,
        )),
        Some(AccessEndpointOutcome::GrantWrongRelay) => Err(StationDiscoveryError::new(
            "station_connection_grant_wrong_relay",
            "The private Station connection material belongs to another Relay",
            false,
        )),
        Some(AccessEndpointOutcome::InvalidStationAttestation) => Err(StationDiscoveryError::new(
            "station_route_invalid",
            "The Relay returned an invalid Station route",
            false,
        )),
        _ => Err(invalid_discovery(
            "Relay discovery outcome does not match its route candidates",
        )),
    }
}

fn verify_route_attestation(
    attestation: &StationRouteAttestation,
    relay_peer_id: &str,
    relay_origin: &str,
    connection_grant: Option<Vec<u8>>,
    now_unix_ms: i64,
) -> Result<VerifiedStationRoute, StationDiscoveryError> {
    let statement = StationRouteStatement::decode(attestation.statement_bytes.as_slice())
        .map_err(|_| invalid_discovery("Station route statement cannot be decoded"))?;
    if statement.encode_to_vec() != attestation.statement_bytes
        || statement.station_peer_id.trim().is_empty()
        || statement.relay_peer_id != relay_peer_id
        || statement.route_id.trim().is_empty()
        || statement.route_generation == 0
        || statement.inner_tls_spki_sha256.len() != 32
        || statement.capabilities_digest.len() != 32
        || !matches!(
            StationRouteVisibility::try_from(statement.visibility).ok(),
            Some(StationRouteVisibility::Public | StationRouteVisibility::GrantOnly)
        )
        || statement.issued_at_unix_ms > now_unix_ms + CLOCK_SKEW_MS
        || statement.expires_at_unix_ms <= now_unix_ms
        || statement.expires_at_unix_ms <= statement.issued_at_unix_ms
        || statement.expires_at_unix_ms - statement.issued_at_unix_ms > MAX_ROUTE_LIFETIME_MS
    {
        return Err(invalid_discovery(
            "Station route statement fields are invalid",
        ));
    }
    let station_host_public_key = verify_signed_statement(
        &attestation.host_public_key,
        &attestation.signature,
        STATION_ROUTE_DOMAIN,
        &attestation.statement_bytes,
        &statement.station_peer_id,
    )?;
    let spki: [u8; 32] = statement
        .inner_tls_spki_sha256
        .as_slice()
        .try_into()
        .map_err(|_| invalid_discovery("Station route SPKI pin is malformed"))?;
    Ok(VerifiedStationRoute {
        station_peer_id: statement.station_peer_id,
        station_host_public_key,
        route_id: statement.route_id,
        route_generation: statement.route_generation,
        endpoint_origin: relay_origin.to_string(),
        relay_peer_id: Some(relay_peer_id.to_string()),
        inner_tls_spki_sha256: Some(spki),
        attestation_bytes: Some(attestation.encode_to_vec()),
        connection_grant,
        expires_at_unix_ms: Some(statement.expires_at_unix_ms),
    })
}

fn verify_signed_statement(
    public_key_bytes: &[u8],
    signature: &[u8],
    domain: &[u8],
    statement_bytes: &[u8],
    expected_peer_id: &str,
) -> Result<Vec<u8>, StationDiscoveryError> {
    let public_key = PublicKey::try_decode_protobuf(public_key_bytes)
        .map_err(|_| invalid_discovery("Endpoint public key is invalid"))?;
    if public_key.to_peer_id().to_string() != expected_peer_id {
        return Err(invalid_discovery(
            "Endpoint peer ID does not match its public key",
        ));
    }
    let mut signed = Vec::with_capacity(domain.len() + statement_bytes.len());
    signed.extend_from_slice(domain);
    signed.extend_from_slice(statement_bytes);
    if !public_key.verify(&signed, signature) {
        return Err(invalid_discovery("Endpoint signature is invalid"));
    }
    Ok(public_key_bytes.to_vec())
}

struct ParsedInput {
    origin: String,
    connection_grant: Option<Vec<u8>>,
}

fn parse_input(input: &str) -> Result<ParsedInput, StationDiscoveryError> {
    let value = input.trim();
    let encoded = value
        .strip_prefix("ptc1:")
        .or_else(|| value.strip_prefix("peers-touch://connect#"));
    if let Some(encoded) = encoded {
        let raw = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| invalid_discovery("Private Station connection material is malformed"))?;
        let envelope = StationConnectionEnvelope::decode(raw.as_slice())
            .map_err(|_| invalid_discovery("Private Station connection material is malformed"))?;
        if envelope.protocol_version != ACCESS_PROTOCOL_VERSION
            || envelope.relay_origin.trim().is_empty()
            || envelope.connection_grant.is_none()
            || envelope.route_attestation.is_none()
        {
            return Err(invalid_discovery(
                "Private Station connection material is incomplete",
            ));
        }
        let grant = envelope
            .connection_grant
            .as_ref()
            .map(Message::encode_to_vec);
        return Ok(ParsedInput {
            origin: normalize_origin(&envelope.relay_origin)?,
            connection_grant: grant,
        });
    }
    Ok(ParsedInput {
        origin: normalize_origin(value)?,
        connection_grant: None,
    })
}

fn normalize_origin(value: &str) -> Result<String, StationDiscoveryError> {
    let url = reqwest::Url::parse(value)
        .map_err(|_| invalid_discovery("A valid Station or Relay origin is required"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || url.query().is_some()
        || url.fragment().is_some()
        || (url.path() != "/" && !url.path().is_empty())
    {
        return Err(invalid_discovery(
            "Station or Relay input must be an HTTP(S) origin",
        ));
    }
    Ok(value.trim().trim_end_matches('/').to_string())
}

fn direct_route_id(station_peer_id: &str, origin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"peers-touch/direct-route/v1\0");
    hasher.update(station_peer_id.as_bytes());
    hasher.update([0]);
    hasher.update(origin.as_bytes());
    format!("direct-{}", hex::encode(hasher.finalize()))
}

fn unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn invalid_discovery(message: impl Into<String>) -> StationDiscoveryError {
    StationDiscoveryError::new("station_discovery_invalid", message, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::peer::{AccessEndpointStatement, StationRouteStatement};
    use libp2p_identity::Keypair;

    fn sign(key: &Keypair, domain: &[u8], payload: &[u8]) -> Vec<u8> {
        let mut message = domain.to_vec();
        message.extend_from_slice(payload);
        key.sign(&message).unwrap()
    }

    fn direct_response(
        key: &Keypair,
        challenge: &[u8],
        origin: &str,
        now: i64,
    ) -> AccessEndpointResponse {
        let statement = AccessEndpointStatement {
            challenge: challenge.to_vec(),
            endpoint_role: AccessEndpointRole::DirectStation as i32,
            endpoint_peer_id: key.public().to_peer_id().to_string(),
            canonical_origin: origin.to_string(),
            protocol_versions: vec![ACCESS_PROTOCOL_VERSION],
            capabilities: vec!["endpoint-discovery".to_string()],
            issued_at_unix_ms: now,
            expires_at_unix_ms: now + 60_000,
        };
        let bytes = statement.encode_to_vec();
        AccessEndpointResponse {
            outcome: AccessEndpointOutcome::Ready as i32,
            endpoint_statement_bytes: bytes.clone(),
            endpoint_public_key: key.public().encode_protobuf(),
            endpoint_signature: sign(key, ACCESS_ENDPOINT_DOMAIN, &bytes),
            station_routes: Vec::new(),
        }
    }

    #[test]
    fn verifies_direct_station_identity_before_building_route() {
        let key = Keypair::generate_ed25519();
        let challenge = [7_u8; DISCOVERY_CHALLENGE_SIZE];
        let now = unix_ms();
        let verified = verify_discovery_response(
            "https://station.example",
            None,
            &challenge,
            direct_response(&key, &challenge, "https://station.example", now),
            now,
        )
        .unwrap();

        assert_eq!(verified.role, VerifiedEndpointRole::DirectStation);
        assert_eq!(verified.routes.len(), 1);
        assert_eq!(
            verified.routes[0].station_peer_id,
            key.public().to_peer_id().to_string()
        );
        assert!(verified.routes[0].route_id.starts_with("direct-"));
    }

    #[test]
    fn rejects_endpoint_signature_from_another_identity() {
        let key = Keypair::generate_ed25519();
        let attacker = Keypair::generate_ed25519();
        let challenge = [9_u8; DISCOVERY_CHALLENGE_SIZE];
        let now = unix_ms();
        let mut response = direct_response(&key, &challenge, "https://station.example", now);
        response.endpoint_signature = sign(
            &attacker,
            ACCESS_ENDPOINT_DOMAIN,
            &response.endpoint_statement_bytes,
        );

        let error =
            verify_discovery_response("https://station.example", None, &challenge, response, now)
                .unwrap_err();
        assert_eq!(error.code, "station_discovery_invalid");
    }

    #[test]
    fn verifies_relay_and_station_route_as_distinct_identities() {
        let relay = Keypair::generate_ed25519();
        let station = Keypair::generate_ed25519();
        let challenge = [3_u8; DISCOVERY_CHALLENGE_SIZE];
        let now = unix_ms();
        let route_statement = StationRouteStatement {
            station_peer_id: station.public().to_peer_id().to_string(),
            relay_peer_id: relay.public().to_peer_id().to_string(),
            route_id: "route-1".to_string(),
            route_generation: 4,
            inner_tls_spki_sha256: vec![5; 32],
            capabilities_digest: vec![6; 32],
            visibility: StationRouteVisibility::Public as i32,
            issued_at_unix_ms: now,
            expires_at_unix_ms: now + 600_000,
        };
        let route_bytes = route_statement.encode_to_vec();
        let route = StationRouteAttestation {
            statement_bytes: route_bytes.clone(),
            host_public_key: station.public().encode_protobuf(),
            signature: sign(&station, STATION_ROUTE_DOMAIN, &route_bytes),
        };
        let endpoint_statement = AccessEndpointStatement {
            challenge: challenge.to_vec(),
            endpoint_role: AccessEndpointRole::Relay as i32,
            endpoint_peer_id: relay.public().to_peer_id().to_string(),
            canonical_origin: "https://relay.example".to_string(),
            protocol_versions: vec![ACCESS_PROTOCOL_VERSION],
            capabilities: vec!["opaque-tunnel-v1".to_string()],
            issued_at_unix_ms: now,
            expires_at_unix_ms: now + 60_000,
        };
        let endpoint_bytes = endpoint_statement.encode_to_vec();
        let response = AccessEndpointResponse {
            outcome: AccessEndpointOutcome::Ready as i32,
            endpoint_statement_bytes: endpoint_bytes.clone(),
            endpoint_public_key: relay.public().encode_protobuf(),
            endpoint_signature: sign(&relay, ACCESS_ENDPOINT_DOMAIN, &endpoint_bytes),
            station_routes: vec![route],
        };

        let verified =
            verify_discovery_response("https://relay.example", None, &challenge, response, now)
                .unwrap();
        assert_eq!(verified.role, VerifiedEndpointRole::Relay);
        assert_eq!(
            verified.routes[0].station_peer_id,
            station.public().to_peer_id().to_string()
        );
        assert_eq!(
            verified.routes[0].relay_peer_id.as_deref(),
            Some(relay.public().to_peer_id().to_string().as_str())
        );
    }

    #[test]
    fn parses_both_private_connection_material_forms() {
        let envelope = StationConnectionEnvelope {
            protocol_version: ACCESS_PROTOCOL_VERSION,
            relay_origin: "https://relay.example".to_string(),
            route_attestation: Some(StationRouteAttestation {
                statement_bytes: vec![1],
                host_public_key: vec![2],
                signature: vec![3],
            }),
            connection_grant: Some(crate::model::peer::StationConnectionGrant {
                statement_bytes: vec![4],
                host_public_key: vec![5],
                signature: vec![6],
            }),
        };
        let encoded = URL_SAFE_NO_PAD.encode(envelope.encode_to_vec());
        for input in [
            format!("ptc1:{encoded}"),
            format!("peers-touch://connect#{encoded}"),
        ] {
            let parsed = parse_input(&input).unwrap();
            assert_eq!(parsed.origin, "https://relay.example");
            assert!(parsed.connection_grant.is_some());
        }
    }
}
