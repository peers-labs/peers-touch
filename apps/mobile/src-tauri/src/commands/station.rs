use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use station_trust::verify_station_identity_response_bytes;

use crate::error::{MobileError, MobileResult};
use crate::station_origin::{normalize_station_origin, StationOriginPolicy};

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
    pub(crate) response_bytes: Vec<u8>,
    pub(crate) required_capabilities: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedStationIdentity {
    pub(crate) station_peer_id: String,
    pub(crate) node_peer_id: String,
    pub(crate) station_root_public_key: Vec<u8>,
    pub(crate) node_authorization_digest: [u8; 32],
    pub(crate) authorization_epoch: u64,
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
    let origin_policy = StationOriginPolicy::current_build();
    let requested_origin = normalize_station_origin(&input.requested_origin, origin_policy)
        .map_err(|_| identity_error("invalidRequestedOrigin"))?;
    let required: Vec<&str> = input
        .required_capabilities
        .iter()
        .map(String::as_str)
        .collect();
    let verified = verify_station_identity_response_bytes(
        &input.response_bytes,
        &input.challenge,
        &requested_origin,
        &required,
        now_unix_ms,
    )
    .map_err(|error| identity_error(error.code))?;

    Ok(VerifiedStationIdentity {
        station_peer_id: verified.station_peer_id,
        node_peer_id: verified.node_peer_id,
        station_root_public_key: verified.station_root_public_key,
        node_authorization_digest: verified.authorization_digest,
        authorization_epoch: verified.authorization_epoch,
        canonical_origin: requested_origin,
        capabilities: verified.capabilities,
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
    use super::*;

    #[test]
    fn parses_station_target_with_default_https_port() {
        let target = parse_station_target("https://station.example").expect("Station target");
        assert_eq!(target.host, "station.example");
        assert_eq!(target.port, 443);
    }
}
