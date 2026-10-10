use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use libp2p_identity::{KeyType, PublicKey};
use prost::Message;
use serde::{Deserialize, Serialize};

use crate::error::{MobileError, MobileResult};
use crate::station_origin::{normalize_station_origin, StationOriginPolicy};

mod station_identity_proto {
    include!(concat!(env!("OUT_DIR"), "/peers_touch.model.peer.v1.rs"));
}

use station_identity_proto::StationIdentityStatement;

const STATION_IDENTITY_CHALLENGE_SIZE: usize = 32;
const STATION_IDENTITY_MAX_LIFETIME_MS: i64 = 60_000;
const STATION_IDENTITY_CLOCK_SKEW_MS: i64 = 60_000;
const STATION_IDENTITY_DOMAIN: &[u8] = b"peers-touch/station-identity/v1\0";

#[derive(Debug, Serialize)]
pub struct StationProbeResult {
    url: String,
    online: bool,
    label: Option<String>,
    checked_at: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyStationIdentityProofInput {
    pub(crate) requested_origin: String,
    pub(crate) challenge: Vec<u8>,
    pub(crate) statement_bytes: Vec<u8>,
    pub(crate) host_public_key: Vec<u8>,
    pub(crate) signature: Vec<u8>,
    pub(crate) required_capabilities: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedStationIdentity {
    pub(crate) station_peer_id: String,
    pub(crate) canonical_origin: String,
    pub(crate) capabilities: Vec<String>,
    pub(crate) verified_at: u64,
}

#[tauri::command]
pub async fn station_probe(url: String) -> MobileResult<StationProbeResult> {
    let checked_at = current_unix_millis();
    let target = parse_station_target(&url);
    let label = target.as_ref().map(|target| target.label.clone());

    let online = match target {
        Some(target) => {
            tauri::async_runtime::spawn_blocking(move || probe_tcp(&target.host, target.port))
                .await
                .unwrap_or(false)
        }
        None => false,
    };

    Ok(StationProbeResult {
        url: url.trim_end_matches('/').to_string(),
        online,
        label,
        checked_at,
    })
}

#[tauri::command]
pub fn station_identity_verify(
    input: VerifyStationIdentityProofInput,
) -> MobileResult<VerifiedStationIdentity> {
    verify_station_identity_proof(input, current_unix_millis() as i64)
}

pub(crate) fn verify_station_identity_proof(
    input: VerifyStationIdentityProofInput,
    now_unix_ms: i64,
) -> MobileResult<VerifiedStationIdentity> {
    if input.challenge.len() != STATION_IDENTITY_CHALLENGE_SIZE {
        return Err(identity_error("invalidChallenge"));
    }
    let statement = StationIdentityStatement::decode(input.statement_bytes.as_slice())
        .map_err(|_| identity_error("invalidStatement"))?;
    if statement.challenge != input.challenge {
        return Err(identity_error("challengeMismatch"));
    }

    let public_key = PublicKey::try_decode_protobuf(&input.host_public_key)
        .map_err(|_| identity_error("invalidPublicKey"))?;
    if public_key.key_type() != KeyType::Ed25519 {
        return Err(identity_error("unsupportedKeyType"));
    }
    let derived_peer_id = public_key.to_peer_id().to_string();
    if statement.station_peer_id != derived_peer_id {
        return Err(identity_error("peerIdMismatch"));
    }

    let mut signature_input =
        Vec::with_capacity(STATION_IDENTITY_DOMAIN.len() + input.statement_bytes.len());
    signature_input.extend_from_slice(STATION_IDENTITY_DOMAIN);
    signature_input.extend_from_slice(&input.statement_bytes);
    if !public_key.verify(&signature_input, &input.signature) {
        return Err(identity_error("signatureInvalid"));
    }

    if statement.expires_at_unix_ms <= statement.issued_at_unix_ms
        || statement.expires_at_unix_ms - statement.issued_at_unix_ms
            > STATION_IDENTITY_MAX_LIFETIME_MS
        || statement.issued_at_unix_ms > now_unix_ms + STATION_IDENTITY_CLOCK_SKEW_MS
        || statement.expires_at_unix_ms < now_unix_ms - STATION_IDENTITY_CLOCK_SKEW_MS
    {
        return Err(identity_error("expired"));
    }

    let origin_policy = StationOriginPolicy::current_build();
    let canonical_origin = normalize_station_origin(&statement.canonical_origin, origin_policy)
        .map_err(|_| identity_error("invalidCanonicalOrigin"))?;
    if canonical_origin != statement.canonical_origin {
        return Err(identity_error("nonCanonicalOrigin"));
    }
    let requested_origin = normalize_station_origin(&input.requested_origin, origin_policy)
        .map_err(|_| identity_error("invalidRequestedOrigin"))?;
    if canonical_origin != requested_origin {
        return Err(identity_error("canonicalOriginMismatch"));
    }

    if statement
        .capabilities
        .windows(2)
        .any(|pair| pair[0] >= pair[1])
    {
        return Err(identity_error("capabilitiesNotCanonical"));
    }
    if input
        .required_capabilities
        .iter()
        .any(|required| statement.capabilities.binary_search(required).is_err())
    {
        return Err(identity_error("capabilityMismatch"));
    }

    Ok(VerifiedStationIdentity {
        station_peer_id: statement.station_peer_id,
        canonical_origin,
        capabilities: statement.capabilities,
        verified_at: now_unix_ms as u64,
    })
}

fn identity_error(reason: &str) -> MobileError {
    MobileError::station_identity(format!("mobile.launch.stationIdentityInvalid:{reason}"))
}

struct StationTarget {
    host: String,
    port: u16,
    label: String,
}

fn parse_station_target(url: &str) -> Option<StationTarget> {
    let raw = url.trim().trim_end_matches('/');
    let (scheme, rest) = raw.split_once("://")?;
    let authority = rest.split('/').next()?.split('@').next_back()?;
    let host_port = authority.split('?').next()?.split('#').next()?;

    let (host, port) = parse_host_port(host_port, scheme)?;
    let label = format!("{host}:{port}");

    Some(StationTarget { host, port, label })
}

fn parse_host_port(value: &str, scheme: &str) -> Option<(String, u16)> {
    if value.starts_with('[') {
        let end = value.find(']')?;
        let host = value[1..end].to_string();
        let port = value
            .get(end + 2..)
            .and_then(|port| port.parse::<u16>().ok())
            .unwrap_or_else(|| default_port(scheme));
        return Some((host, port));
    }

    let mut parts = value.rsplitn(2, ':');
    let last = parts.next()?;
    let before_last = parts.next();

    match before_last {
        Some(host) => Some((host.to_string(), last.parse::<u16>().ok()?)),
        None => Some((last.to_string(), default_port(scheme))),
    }
}

fn default_port(scheme: &str) -> u16 {
    if scheme.eq_ignore_ascii_case("http") {
        80
    } else {
        443
    }
}

fn probe_tcp(host: &str, port: u16) -> bool {
    let Ok(mut addrs) = (host, port).to_socket_addrs() else {
        return false;
    };

    addrs.any(|addr| TcpStream::connect_timeout(&addr, Duration::from_secs(3)).is_ok())
}

fn current_unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::{Signer, SigningKey};
    use rand::rngs::OsRng;

    use super::*;

    fn signed_input(now_unix_ms: i64) -> (VerifyStationIdentityProofInput, String) {
        let signing_key = SigningKey::generate(&mut OsRng);
        let libp2p_key = libp2p_identity::ed25519::PublicKey::try_from_bytes(
            signing_key.verifying_key().as_bytes(),
        )
        .expect("valid Ed25519 public key");
        let public_key = PublicKey::from(libp2p_key);
        let station_peer_id = public_key.to_peer_id().to_string();
        let challenge = vec![0x2a; STATION_IDENTITY_CHALLENGE_SIZE];
        let statement = StationIdentityStatement {
            challenge: challenge.clone(),
            station_peer_id: station_peer_id.clone(),
            canonical_origin: "https://station.example:443".to_string(),
            capabilities: vec![
                "access-gate".to_string(),
                "actor-ptid".to_string(),
                "station-identity".to_string(),
            ],
            issued_at_unix_ms: now_unix_ms,
            expires_at_unix_ms: now_unix_ms + STATION_IDENTITY_MAX_LIFETIME_MS,
        };
        let statement_bytes = statement.encode_to_vec();
        let mut signature_input =
            Vec::with_capacity(STATION_IDENTITY_DOMAIN.len() + statement_bytes.len());
        signature_input.extend_from_slice(STATION_IDENTITY_DOMAIN);
        signature_input.extend_from_slice(&statement_bytes);
        let signature = signing_key.sign(&signature_input).to_bytes().to_vec();

        (
            VerifyStationIdentityProofInput {
                requested_origin: "https://station.example".to_string(),
                challenge,
                statement_bytes,
                host_public_key: public_key.encode_protobuf(),
                signature,
                required_capabilities: vec![
                    "actor-ptid".to_string(),
                    "station-identity".to_string(),
                ],
            },
            station_peer_id,
        )
    }

    #[test]
    fn verifies_host_key_bound_station_identity() {
        let now = 1_800_000_000_000;
        let (input, expected_peer_id) = signed_input(now);
        let verified = verify_station_identity_proof(input, now).expect("proof must verify");
        assert_eq!(verified.station_peer_id, expected_peer_id);
        assert_eq!(verified.canonical_origin, "https://station.example:443");
    }

    #[test]
    fn rejects_tampered_statement() {
        let now = 1_800_000_000_000;
        let (mut input, _) = signed_input(now);
        input.statement_bytes.push(0);
        assert!(verify_station_identity_proof(input, now).is_err());
    }

    #[test]
    fn rejects_expired_statement() {
        let now = 1_800_000_000_000;
        let (input, _) = signed_input(now);
        assert!(verify_station_identity_proof(
            input,
            now + STATION_IDENTITY_MAX_LIFETIME_MS + STATION_IDENTITY_CLOCK_SKEW_MS + 1,
        )
        .is_err());
    }

    #[test]
    fn rejects_missing_required_capability() {
        let now = 1_800_000_000_000;
        let (mut input, _) = signed_input(now);
        input.required_capabilities = vec!["unsupported-capability".to_string()];
        assert!(verify_station_identity_proof(input, now).is_err());
    }

    #[test]
    fn rejects_a_valid_proof_for_another_origin() {
        let now = 1_800_000_000_000;
        let (mut input, _) = signed_input(now);
        input.requested_origin = "https://other.example".to_string();
        assert!(verify_station_identity_proof(input, now).is_err());
    }
}
