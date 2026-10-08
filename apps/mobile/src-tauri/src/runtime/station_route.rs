use std::collections::HashMap;
use std::fmt;
use std::io::{self, Cursor, Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::sync::{Arc, LazyLock, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use libp2p_identity::PublicKey;
use prost::Message as _;
use rand::RngCore;
use reqwest::blocking::{Client, Response};
use reqwest::header::{
    HeaderName, HeaderValue, CONNECTION, CONTENT_LENGTH, HOST, TRANSFER_ENCODING,
};
use reqwest::{Method, Url};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{
    ClientConfig, ClientConnection, DigitallySignedStruct, RootCertStore, SignatureScheme,
    StreamOwned,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use tungstenite::client::IntoClientRequest;
use tungstenite::http::header::SEC_WEBSOCKET_PROTOCOL;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{client_tls_with_config, connect, Connector, Message as WsMessage, WebSocket};
use x509_parser::parse_x509_certificate;

use crate::commands::station::{
    verify_station_identity_proof, VerifiedStationIdentity as BaseVerifiedStationIdentity,
    VerifyStationIdentityProofInput,
};
use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;
use crate::station_origin::{normalize_station_origin, StationOriginPolicy};

mod peer_proto {
    include!(concat!(env!("OUT_DIR"), "/peers_touch.model.peer.v1.rs"));
}

use crate::secure_content::proto::federation::v1::{
    relay_tunnel_frame, RelayTunnelCancel, RelayTunnelCloseReason, RelayTunnelData,
    RelayTunnelFrame, RelayTunnelOpen, RelayTunnelPurpose,
};
use peer_proto::{
    AccessEndpointOutcome, AccessEndpointRequest, AccessEndpointResponse, AccessEndpointRole,
    StationConnectionEnvelope, StationIdentityRequest, StationIdentityResponse,
    StationIdentityStatement, StationRouteAttestation, StationRouteStatement,
    StationRouteVisibility,
};

const ACCESS_PATH: &str = "/.well-known/peers-touch/access";
const IDENTITY_PATH: &str = "/sub-bootstrap/station-identity";
const TUNNEL_PATH: &str = "/.well-known/peers-touch/tunnel";
const TUNNEL_SUBPROTOCOL: &str = "peers-touch.tunnel.v1";
const PROTOBUF_CONTENT_TYPE: &str = "application/protobuf";
const ACCESS_ENDPOINT_DOMAIN: &[u8] = b"peers-touch/access-endpoint/v1\0";
const STATION_ROUTE_DOMAIN: &[u8] = b"peers-touch/station-route/v1\0";
const ACCESS_PROTOCOL_VERSION: u32 = 1;
const TUNNEL_PROTOCOL_VERSION: u32 = 1;
const CHALLENGE_SIZE: usize = 32;
const CLOCK_SKEW_MS: i64 = 60_000;
const MAX_ROUTE_LIFETIME_MS: i64 = 24 * 60 * 60 * 1_000;
const MAX_DISCOVERY_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_OUTER_FRAME_BYTES: usize = 65 * 1024;
const DEFAULT_MAX_FRAME_BYTES: usize = 64 * 1024;
const MAX_PROXY_REQUEST_BYTES: usize = 32 * 1024 * 1024;
const ROUTE_SOURCE_KEY_PREFIX: &str = "peers-touch.mobile.station-route-source.v1.";

static ROUTES: LazyLock<RouteRuntime> = LazyLock::new(RouteRuntime::default);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StationRouteType {
    Direct,
    Relay,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StationRouteCandidate {
    pub station_peer_id: String,
    pub station_host_public_key: Vec<u8>,
    pub route_id: String,
    pub route_type: StationRouteType,
    pub transport: String,
    pub endpoint_origin: String,
    pub relay_peer_id: Option<String>,
    pub route_generation: u64,
    pub inner_tls_spki_sha256: Option<Vec<u8>>,
    pub attestation_bytes: Option<Vec<u8>>,
    pub attestation_expires_at_unix_ms: Option<i64>,
    pub source_ref: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VerifiedEndpointRole {
    DirectStation,
    Relay,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StationEndpointDiscovery {
    pub role: VerifiedEndpointRole,
    pub endpoint_peer_id: String,
    pub canonical_origin: String,
    pub routes: Vec<StationRouteCandidate>,
}

#[derive(Clone, Debug)]
struct VerifiedDiscovery {
    projection: StationEndpointDiscovery,
    source_input: String,
}

#[derive(Clone, Debug)]
struct CachedRoute {
    candidate: StationRouteCandidate,
    source_input: String,
}

#[derive(Clone, Debug)]
struct ActiveRoute {
    candidate: StationRouteCandidate,
    route_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StationRouteSelectionInput {
    station_peer_id: String,
    route_id: String,
    route_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StationRouteRestoreInput {
    station_peer_id: String,
    route_id: String,
    route_generation: u64,
    route_revision: u64,
    source_ref: String,
    endpoint_origin: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StationRouteRemoveInput {
    station_peer_id: String,
    route_id: String,
    source_ref: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StationRouteBindingProjection {
    pub station_peer_id: String,
    pub route_id: String,
    pub route_type: StationRouteType,
    pub endpoint_origin: String,
    pub relay_peer_id: Option<String>,
    pub route_generation: u64,
    pub route_revision: u64,
    pub transport_origin: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedStationIdentity {
    pub station_peer_id: String,
    pub canonical_origin: String,
    pub capabilities: Vec<String>,
    pub verified_at: u64,
    pub route_id: String,
    pub route_type: StationRouteType,
}

#[derive(Default)]
struct RouteRuntime {
    discovered: RwLock<HashMap<(String, String), CachedRoute>>,
    active: RwLock<Option<ActiveRoute>>,
    proxy_origin: Mutex<Option<String>>,
}

impl RouteRuntime {
    fn register(&self, discovery: &VerifiedDiscovery) -> MobileResult<()> {
        let mut routes = self
            .discovered
            .write()
            .map_err(|_| route_error("runtimeLock"))?;
        for candidate in &discovery.projection.routes {
            routes.insert(
                (
                    candidate.station_peer_id.clone(),
                    candidate.route_id.clone(),
                ),
                CachedRoute {
                    candidate: candidate.clone(),
                    source_input: discovery.source_input.clone(),
                },
            );
        }
        Ok(())
    }

    fn cached(&self, station_peer_id: &str, route_id: &str) -> MobileResult<CachedRoute> {
        self.discovered
            .read()
            .map_err(|_| route_error("runtimeLock"))?
            .get(&(station_peer_id.to_string(), route_id.to_string()))
            .cloned()
            .ok_or_else(|| route_error("routeNotVerified"))
    }

    fn activate(
        &self,
        station_peer_id: &str,
        route_id: &str,
        route_revision: u64,
    ) -> MobileResult<StationRouteBindingProjection> {
        if route_revision == 0 {
            return Err(route_error("routeRevisionInvalid"));
        }
        let cached = self.cached(station_peer_id, route_id)?;
        ensure_route_current(&cached.candidate)?;
        let transport_origin = self.ensure_proxy()?;
        let active = ActiveRoute {
            candidate: cached.candidate.clone(),
            route_revision,
        };
        *self
            .active
            .write()
            .map_err(|_| route_error("runtimeLock"))? = Some(active.clone());
        Ok(binding_projection(&active, transport_origin))
    }

    fn active_snapshot(&self) -> MobileResult<ActiveRoute> {
        self.active
            .read()
            .map_err(|_| route_error("runtimeLock"))?
            .clone()
            .ok_or_else(|| route_error("routeNotActive"))
    }

    fn assert_current(&self, snapshot: &ActiveRoute) -> MobileResult<()> {
        let current = self.active_snapshot()?;
        if current.candidate.station_peer_id != snapshot.candidate.station_peer_id
            || current.candidate.route_id != snapshot.candidate.route_id
            || current.candidate.route_generation != snapshot.candidate.route_generation
            || current.route_revision != snapshot.route_revision
        {
            return Err(route_error("routeChanged"));
        }
        ensure_route_current(&current.candidate)
    }

    fn ensure_proxy(&self) -> MobileResult<String> {
        let mut origin = self
            .proxy_origin
            .lock()
            .map_err(|_| route_error("runtimeLock"))?;
        if let Some(origin) = origin.as_ref() {
            return Ok(origin.clone());
        }
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| route_error("proxyBind"))?;
        let address = listener
            .local_addr()
            .map_err(|_| route_error("proxyAddress"))?;
        std::thread::Builder::new()
            .name("mobile-station-route-proxy".to_string())
            .spawn(move || serve_proxy(listener))
            .map_err(|_| route_error("proxyStart"))?;
        let value = format!("http://{address}");
        *origin = Some(value.clone());
        Ok(value)
    }

    fn remove(&self, station_peer_id: &str, route_id: &str) -> MobileResult<()> {
        self.discovered
            .write()
            .map_err(|_| route_error("runtimeLock"))?
            .remove(&(station_peer_id.to_string(), route_id.to_string()));
        let mut active = self
            .active
            .write()
            .map_err(|_| route_error("runtimeLock"))?;
        if active.as_ref().is_some_and(|route| {
            route.candidate.station_peer_id == station_peer_id
                && route.candidate.route_id == route_id
        }) {
            *active = None;
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn station_endpoint_discover(input: String) -> MobileResult<StationEndpointDiscovery> {
    let discovery = tauri::async_runtime::spawn_blocking(move || discover_station_input(&input))
        .await
        .map_err(|_| discovery_error("runtimeUnavailable"))??;
    ROUTES.register(&discovery)?;
    Ok(discovery.projection)
}

#[tauri::command]
pub fn station_route_activate(
    storage: State<'_, SecureStorage>,
    input: StationRouteSelectionInput,
) -> MobileResult<StationRouteBindingProjection> {
    let station_peer_id = clean_identifier(&input.station_peer_id, "stationPeerId")?;
    let route_id = clean_identifier(&input.route_id, "routeId")?;
    let cached = ROUTES.cached(&station_peer_id, &route_id)?;
    ensure_route_current(&cached.candidate)?;
    storage.set(
        &route_source_key(&cached.candidate.source_ref),
        &cached.source_input,
    )?;
    ROUTES.activate(&station_peer_id, &route_id, input.route_revision)
}

#[tauri::command]
pub async fn station_route_restore(
    storage: State<'_, SecureStorage>,
    input: StationRouteRestoreInput,
) -> MobileResult<StationRouteBindingProjection> {
    let station_peer_id = clean_identifier(&input.station_peer_id, "stationPeerId")?;
    let route_id = clean_identifier(&input.route_id, "routeId")?;
    let source = if input.source_ref.trim().is_empty() {
        normalize_origin(&input.endpoint_origin)?
    } else {
        let source_ref = clean_source_ref(&input.source_ref)?;
        storage
            .get(&route_source_key(&source_ref))?
            .ok_or_else(|| route_error("routeSourceMissing"))?
    };
    let discovery = tauri::async_runtime::spawn_blocking(move || discover_station_input(&source))
        .await
        .map_err(|_| discovery_error("runtimeUnavailable"))??;
    let exact = discovery.projection.routes.iter().any(|route| {
        route.station_peer_id == station_peer_id
            && route.route_id == route_id
            && route.route_generation == input.route_generation
    });
    if !exact {
        return Err(route_error("routeGenerationRevoked"));
    }
    ROUTES.register(&discovery)?;
    ROUTES.activate(&station_peer_id, &route_id, input.route_revision)
}

#[tauri::command]
pub fn station_route_remove(
    storage: State<'_, SecureStorage>,
    input: StationRouteRemoveInput,
) -> MobileResult<()> {
    let station_peer_id = clean_identifier(&input.station_peer_id, "stationPeerId")?;
    let route_id = clean_identifier(&input.route_id, "routeId")?;
    if !input.source_ref.trim().is_empty() {
        storage.remove(&route_source_key(&clean_source_ref(&input.source_ref)?))?;
    }
    ROUTES.remove(&station_peer_id, &route_id)
}

#[tauri::command]
pub fn station_route_snapshot() -> MobileResult<Option<StationRouteBindingProjection>> {
    let active = match ROUTES
        .active
        .read()
        .map_err(|_| route_error("runtimeLock"))?
        .clone()
    {
        Some(active) => active,
        None => return Ok(None),
    };
    let origin = ROUTES.ensure_proxy()?;
    Ok(Some(binding_projection(&active, origin)))
}

#[tauri::command]
pub async fn station_identity_fetch() -> MobileResult<VerifiedStationIdentity> {
    tauri::async_runtime::spawn_blocking(fetch_station_identity)
        .await
        .map_err(|_| identity_error("runtimeUnavailable"))?
}

pub(crate) fn active_transport_origin(
    station_peer_id: &str,
    canonical_origin: &str,
) -> MobileResult<String> {
    let active = match ROUTES.active_snapshot() {
        Ok(active) => active,
        Err(_) => return Ok(canonical_origin.to_string()),
    };
    if active.candidate.station_peer_id != station_peer_id {
        return Ok(canonical_origin.to_string());
    }
    ROUTES.ensure_proxy()
}

fn discover_station_input(input: &str) -> MobileResult<VerifiedDiscovery> {
    let parsed = parse_input(input)?;
    let mut challenge = [0_u8; CHALLENGE_SIZE];
    rand::thread_rng().fill_bytes(&mut challenge);
    let request = AccessEndpointRequest {
        challenge: challenge.to_vec(),
        connection_grant: parsed.connection_grant.clone().unwrap_or_default(),
        client_protocol_version: ACCESS_PROTOCOL_VERSION,
    };
    let endpoint = format!("{}{}", parsed.origin, ACCESS_PATH);
    let response = Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| discovery_error("clientUnavailable"))?
        .post(endpoint)
        .header("Accept", PROTOBUF_CONTENT_TYPE)
        .header("Content-Type", PROTOBUF_CONTENT_TYPE)
        .body(request.encode_to_vec())
        .send()
        .map_err(|_| discovery_error("endpointUnavailable"))?;
    if !response.status().is_success() {
        return Err(discovery_error("endpointRejected"));
    }
    let bytes = response
        .bytes()
        .map_err(|_| discovery_error("responseUnreadable"))?;
    if bytes.len() > MAX_DISCOVERY_RESPONSE_BYTES {
        return Err(discovery_error("responseTooLarge"));
    }
    let response = AccessEndpointResponse::decode(bytes.as_ref())
        .map_err(|_| discovery_error("responseInvalid"))?;
    let projection = verify_discovery_response(
        &parsed.origin,
        parsed.connection_grant,
        &challenge,
        response,
        unix_ms() as i64,
    )?;
    Ok(VerifiedDiscovery {
        projection,
        source_input: input.trim().to_string(),
    })
}

fn verify_discovery_response(
    requested_origin: &str,
    connection_grant: Option<Vec<u8>>,
    challenge: &[u8],
    response: AccessEndpointResponse,
    now_unix_ms: i64,
) -> MobileResult<StationEndpointDiscovery> {
    let statement =
        peer_proto::AccessEndpointStatement::decode(response.endpoint_statement_bytes.as_slice())
            .map_err(|_| discovery_error("statementInvalid"))?;
    let role = AccessEndpointRole::try_from(statement.endpoint_role)
        .map_err(|_| discovery_error("roleInvalid"))?;
    let canonical_origin = normalize_origin(&statement.canonical_origin)?;
    if statement.encode_to_vec() != response.endpoint_statement_bytes
        || statement.challenge != challenge
        || !endpoint_origin_is_valid(role, requested_origin, &canonical_origin)
        || !statement
            .protocol_versions
            .contains(&ACCESS_PROTOCOL_VERSION)
        || statement.issued_at_unix_ms > now_unix_ms + CLOCK_SKEW_MS
        || statement.expires_at_unix_ms < now_unix_ms - CLOCK_SKEW_MS
        || statement.expires_at_unix_ms <= statement.issued_at_unix_ms
    {
        return Err(discovery_error("statementInvalid"));
    }
    let endpoint_public_key = verify_signed_statement(
        &response.endpoint_public_key,
        &response.endpoint_signature,
        ACCESS_ENDPOINT_DOMAIN,
        &response.endpoint_statement_bytes,
        &statement.endpoint_peer_id,
    )?;

    let (role, routes) = match role {
        AccessEndpointRole::DirectStation => {
            if response.outcome != AccessEndpointOutcome::Ready as i32
                || !response.station_routes.is_empty()
                || connection_grant.is_some()
            {
                return Err(discovery_error("directOutcomeInvalid"));
            }
            let route_id = direct_route_id(&statement.endpoint_peer_id, &canonical_origin);
            let source_ref = route_source_ref(&statement.endpoint_peer_id, &route_id);
            (
                VerifiedEndpointRole::DirectStation,
                vec![StationRouteCandidate {
                    station_peer_id: statement.endpoint_peer_id.clone(),
                    station_host_public_key: endpoint_public_key,
                    route_id,
                    route_type: StationRouteType::Direct,
                    transport: "direct_https".to_string(),
                    endpoint_origin: canonical_origin.clone(),
                    relay_peer_id: None,
                    route_generation: 1,
                    inner_tls_spki_sha256: None,
                    attestation_bytes: None,
                    attestation_expires_at_unix_ms: None,
                    source_ref,
                }],
            )
        }
        AccessEndpointRole::Relay => {
            verify_relay_outcome(&response)?;
            let mut routes = Vec::with_capacity(response.station_routes.len());
            for attestation in &response.station_routes {
                routes.push(verify_route_attestation(
                    attestation,
                    &statement.endpoint_peer_id,
                    &canonical_origin,
                    now_unix_ms,
                )?);
            }
            (VerifiedEndpointRole::Relay, routes)
        }
        _ => return Err(discovery_error("roleUnsupported")),
    };

    Ok(StationEndpointDiscovery {
        role,
        endpoint_peer_id: statement.endpoint_peer_id,
        canonical_origin,
        routes,
    })
}

fn endpoint_origin_is_valid(
    role: AccessEndpointRole,
    requested_origin: &str,
    canonical_origin: &str,
) -> bool {
    match role {
        AccessEndpointRole::DirectStation => canonical_origin == requested_origin,
        AccessEndpointRole::Relay => canonical_origin.starts_with("https://"),
        _ => false,
    }
}

fn verify_relay_outcome(response: &AccessEndpointResponse) -> MobileResult<()> {
    match AccessEndpointOutcome::try_from(response.outcome).ok() {
        Some(AccessEndpointOutcome::Ready) if response.station_routes.len() == 1 => Ok(()),
        Some(AccessEndpointOutcome::MultipleCandidates) if response.station_routes.len() > 1 => {
            Ok(())
        }
        Some(AccessEndpointOutcome::NoCandidates) => Err(route_error("noCandidates")),
        Some(AccessEndpointOutcome::GrantExpired) => Err(route_error("grantExpired")),
        Some(AccessEndpointOutcome::GrantReplayed) => Err(route_error("grantReplayed")),
        Some(AccessEndpointOutcome::GrantWrongRelay) => Err(route_error("grantWrongRelay")),
        Some(AccessEndpointOutcome::InvalidStationAttestation) => {
            Err(route_error("attestationInvalid"))
        }
        _ => Err(discovery_error("relayOutcomeInvalid")),
    }
}

fn verify_route_attestation(
    attestation: &StationRouteAttestation,
    relay_peer_id: &str,
    relay_origin: &str,
    now_unix_ms: i64,
) -> MobileResult<StationRouteCandidate> {
    let statement = StationRouteStatement::decode(attestation.statement_bytes.as_slice())
        .map_err(|_| route_error("attestationInvalid"))?;
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
        return Err(route_error("attestationInvalid"));
    }
    let station_host_public_key = verify_signed_statement(
        &attestation.host_public_key,
        &attestation.signature,
        STATION_ROUTE_DOMAIN,
        &attestation.statement_bytes,
        &statement.station_peer_id,
    )?;
    let source_ref = route_source_ref(&statement.station_peer_id, &statement.route_id);
    Ok(StationRouteCandidate {
        station_peer_id: statement.station_peer_id,
        station_host_public_key,
        route_id: statement.route_id,
        route_type: StationRouteType::Relay,
        transport: "relay_wss_v1".to_string(),
        endpoint_origin: relay_origin.to_string(),
        relay_peer_id: Some(relay_peer_id.to_string()),
        route_generation: statement.route_generation,
        inner_tls_spki_sha256: Some(statement.inner_tls_spki_sha256),
        attestation_bytes: Some(attestation.encode_to_vec()),
        attestation_expires_at_unix_ms: Some(statement.expires_at_unix_ms),
        source_ref,
    })
}

fn verify_signed_statement(
    public_key_bytes: &[u8],
    signature: &[u8],
    domain: &[u8],
    statement_bytes: &[u8],
    expected_peer_id: &str,
) -> MobileResult<Vec<u8>> {
    let public_key = PublicKey::try_decode_protobuf(public_key_bytes)
        .map_err(|_| discovery_error("publicKeyInvalid"))?;
    if public_key.to_peer_id().to_string() != expected_peer_id {
        return Err(discovery_error("peerIdMismatch"));
    }
    let mut signed = Vec::with_capacity(domain.len() + statement_bytes.len());
    signed.extend_from_slice(domain);
    signed.extend_from_slice(statement_bytes);
    if !public_key.verify(&signed, signature) {
        return Err(discovery_error("signatureInvalid"));
    }
    Ok(public_key_bytes.to_vec())
}

struct ParsedInput {
    origin: String,
    connection_grant: Option<Vec<u8>>,
}

fn parse_input(input: &str) -> MobileResult<ParsedInput> {
    let value = input.trim();
    let encoded = value
        .strip_prefix("ptc1:")
        .or_else(|| value.strip_prefix("peers-touch://connect#"));
    if let Some(encoded) = encoded {
        let raw = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| discovery_error("connectionMaterialInvalid"))?;
        let envelope = StationConnectionEnvelope::decode(raw.as_slice())
            .map_err(|_| discovery_error("connectionMaterialInvalid"))?;
        if envelope.protocol_version != ACCESS_PROTOCOL_VERSION
            || envelope.relay_origin.trim().is_empty()
            || envelope.connection_grant.is_none()
            || envelope.route_attestation.is_none()
        {
            return Err(discovery_error("connectionMaterialIncomplete"));
        }
        return Ok(ParsedInput {
            origin: normalize_origin(&envelope.relay_origin)?,
            connection_grant: envelope
                .connection_grant
                .as_ref()
                .map(prost::Message::encode_to_vec),
        });
    }
    Ok(ParsedInput {
        origin: normalize_origin(value)?,
        connection_grant: None,
    })
}

fn normalize_origin(value: &str) -> MobileResult<String> {
    normalize_station_origin(value, StationOriginPolicy::current_build())
        .map_err(|_| discovery_error("originInvalid"))
}

fn direct_route_id(station_peer_id: &str, origin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"peers-touch/direct-route/v1\0");
    hasher.update(station_peer_id.as_bytes());
    hasher.update([0]);
    hasher.update(origin.as_bytes());
    format!("direct-{}", hex::encode(hasher.finalize()))
}

fn route_source_ref(station_peer_id: &str, route_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"peers-touch/mobile-route-source/v1\0");
    hasher.update(station_peer_id.as_bytes());
    hasher.update([0]);
    hasher.update(route_id.as_bytes());
    hex::encode(hasher.finalize())
}

fn route_source_key(source_ref: &str) -> String {
    format!("{ROUTE_SOURCE_KEY_PREFIX}{source_ref}")
}

fn clean_identifier(value: &str, field: &str) -> MobileResult<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 512 || value.contains(['\r', '\n', '\0']) {
        return Err(MobileError::invalid_input(format!("{field} is invalid")));
    }
    Ok(value.to_string())
}

fn clean_source_ref(value: &str) -> MobileResult<String> {
    let value = value.trim();
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(route_error("routeSourceInvalid"));
    }
    Ok(value.to_string())
}

fn ensure_route_current(route: &StationRouteCandidate) -> MobileResult<()> {
    if route
        .attestation_expires_at_unix_ms
        .is_some_and(|expiry| expiry < unix_ms() as i64 - CLOCK_SKEW_MS)
    {
        return Err(route_error("attestationExpired"));
    }
    Ok(())
}

fn binding_projection(
    active: &ActiveRoute,
    transport_origin: String,
) -> StationRouteBindingProjection {
    StationRouteBindingProjection {
        station_peer_id: active.candidate.station_peer_id.clone(),
        route_id: active.candidate.route_id.clone(),
        route_type: active.candidate.route_type,
        endpoint_origin: active.candidate.endpoint_origin.clone(),
        relay_peer_id: active.candidate.relay_peer_id.clone(),
        route_generation: active.candidate.route_generation,
        route_revision: active.route_revision,
        transport_origin,
    }
}

fn fetch_station_identity() -> MobileResult<VerifiedStationIdentity> {
    let route = ROUTES.active_snapshot()?;
    ensure_route_current(&route.candidate)?;
    let mut challenge = [0_u8; CHALLENGE_SIZE];
    rand::thread_rng().fill_bytes(&mut challenge);
    let request = StationIdentityRequest {
        challenge: challenge.to_vec(),
    };
    let origin = ROUTES.ensure_proxy()?;
    let response = Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| identity_error("clientUnavailable"))?
        .post(format!("{origin}{IDENTITY_PATH}"))
        .header("Accept", PROTOBUF_CONTENT_TYPE)
        .header("Content-Type", PROTOBUF_CONTENT_TYPE)
        .body(request.encode_to_vec())
        .send()
        .map_err(|_| identity_error("endpointUnavailable"))?;
    if !response.status().is_success() {
        return Err(identity_error("endpointRejected"));
    }
    let proof = StationIdentityResponse::decode(
        response
            .bytes()
            .map_err(|_| identity_error("responseUnreadable"))?
            .as_ref(),
    )
    .map_err(|_| identity_error("responseInvalid"))?;
    verify_station_identity_response(&route, &challenge, proof, unix_ms() as i64)
}

fn verify_station_identity_response(
    route: &ActiveRoute,
    challenge: &[u8],
    proof: StationIdentityResponse,
    now_unix_ms: i64,
) -> MobileResult<VerifiedStationIdentity> {
    let statement = StationIdentityStatement::decode(proof.statement_bytes.as_slice())
        .map_err(|_| identity_error("invalidStatement"))?;
    let BaseVerifiedStationIdentity {
        station_peer_id,
        canonical_origin,
        capabilities,
        verified_at,
    } = verify_station_identity_proof(
        VerifyStationIdentityProofInput {
            requested_origin: statement.canonical_origin,
            challenge: challenge.to_vec(),
            statement_bytes: proof.statement_bytes,
            host_public_key: proof.host_public_key.clone(),
            signature: proof.signature,
            required_capabilities: vec![
                "access-gate".to_string(),
                "actor-ptid".to_string(),
                "station-identity".to_string(),
            ],
        },
        now_unix_ms,
    )?;
    if station_peer_id != route.candidate.station_peer_id
        || proof.host_public_key != route.candidate.station_host_public_key
    {
        return Err(identity_error("routeIdentityMismatch"));
    }
    if route.candidate.route_type == StationRouteType::Direct
        && canonical_origin != route.candidate.endpoint_origin
    {
        return Err(identity_error("canonicalOriginMismatch"));
    }
    ROUTES.assert_current(route)?;
    Ok(VerifiedStationIdentity {
        station_peer_id,
        canonical_origin,
        capabilities,
        verified_at,
        route_id: route.candidate.route_id.clone(),
        route_type: route.candidate.route_type,
    })
}

fn serve_proxy(listener: TcpListener) {
    for connection in listener.incoming() {
        let Ok(connection) = connection else {
            break;
        };
        std::thread::spawn(move || {
            if let Err(error) = serve_proxy_connection(connection) {
                log::warn!("mobile Station route proxy request failed: {error}");
            }
        });
    }
}

fn serve_proxy_connection(mut connection: TcpStream) -> MobileResult<()> {
    let route = ROUTES.active_snapshot()?;
    ensure_route_current(&route.candidate)?;
    let timeout = Duration::from_secs(305);
    connection
        .set_read_timeout(Some(timeout))
        .and_then(|_| connection.set_write_timeout(Some(timeout)))
        .map_err(|_| route_error("proxyTimeout"))?;
    let request = read_http_request(&mut connection)?;
    match route.candidate.route_type {
        StationRouteType::Direct => forward_direct(connection, &route, request, timeout),
        StationRouteType::Relay => {
            let request = force_connection_close(request)?;
            if request_headers_accept_event_stream(&request) {
                return relay_stream_response(connection, &route, &request, timeout);
            }
            let response = relay_round_trip(&route, &request, timeout)?;
            ROUTES.assert_current(&route)?;
            connection
                .write_all(&response)
                .map_err(|_| route_error("proxyWrite"))
        }
    }
}

fn request_headers_accept_event_stream(request: &[u8]) -> bool {
    let Some(header_end) = find_header_end(request) else {
        return false;
    };
    std::str::from_utf8(&request[..header_end])
        .ok()
        .is_some_and(|headers| {
            headers.lines().any(|line| {
                line.split_once(':').is_some_and(|(name, value)| {
                    name.eq_ignore_ascii_case("accept")
                        && value
                            .split(',')
                            .any(|item| item.trim().eq_ignore_ascii_case("text/event-stream"))
                })
            })
        })
}

fn relay_stream_response(
    mut connection: TcpStream,
    route: &ActiveRoute,
    request: &[u8],
    timeout: Duration,
) -> MobileResult<()> {
    let mut stream = open_inner_tls(route, timeout)?;
    stream
        .write_all(request)
        .and_then(|_| stream.flush())
        .map_err(|_| route_error("innerTlsWrite"))?;
    let mut buffer = [0_u8; 8192];
    loop {
        let count = stream
            .read(&mut buffer)
            .map_err(|_| route_error("innerTlsRead"))?;
        if count == 0 {
            return Ok(());
        }
        ROUTES.assert_current(route)?;
        connection
            .write_all(&buffer[..count])
            .and_then(|_| connection.flush())
            .map_err(|_| route_error("proxyWrite"))?;
    }
}

fn forward_direct(
    mut connection: TcpStream,
    route: &ActiveRoute,
    request: Vec<u8>,
    timeout: Duration,
) -> MobileResult<()> {
    let parsed = parse_proxy_request(&request)?;
    let target = Url::parse(&route.candidate.endpoint_origin)
        .and_then(|base| base.join(&parsed.target))
        .map_err(|_| route_error("directOriginInvalid"))?;
    let client = Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| route_error("directClient"))?;
    let mut outgoing = client.request(parsed.method, target);
    for (name, value) in parsed.headers {
        outgoing = outgoing.header(name, value);
    }
    let mut response = outgoing
        .body(parsed.body)
        .send()
        .map_err(|_| route_error("directUnavailable"))?;
    write_proxy_response(&mut connection, route, &mut response)
}

struct ParsedProxyRequest {
    method: Method,
    target: String,
    headers: Vec<(HeaderName, HeaderValue)>,
    body: Vec<u8>,
}

fn parse_proxy_request(request: &[u8]) -> MobileResult<ParsedProxyRequest> {
    let header_end = find_header_end(request).ok_or_else(|| route_error("requestInvalid"))?;
    let headers =
        std::str::from_utf8(&request[..header_end]).map_err(|_| route_error("requestInvalid"))?;
    let mut lines = headers.split("\r\n");
    let request_line = lines.next().ok_or_else(|| route_error("requestInvalid"))?;
    let mut parts = request_line.split_whitespace();
    let method = Method::from_bytes(
        parts
            .next()
            .ok_or_else(|| route_error("requestInvalid"))?
            .as_bytes(),
    )
    .map_err(|_| route_error("requestInvalid"))?;
    let target = parts
        .next()
        .filter(|target| target.starts_with('/') && !target.starts_with("//"))
        .ok_or_else(|| route_error("requestInvalid"))?
        .to_string();
    if parts.next() != Some("HTTP/1.1") || parts.next().is_some() {
        return Err(route_error("requestInvalid"));
    }
    let mut forwarded = Vec::new();
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| route_error("requestInvalid"))?;
        let name = HeaderName::from_bytes(name.trim().as_bytes())
            .map_err(|_| route_error("requestInvalid"))?;
        if matches!(name, HOST | CONNECTION | CONTENT_LENGTH | TRANSFER_ENCODING) {
            continue;
        }
        let value =
            HeaderValue::from_str(value.trim()).map_err(|_| route_error("requestInvalid"))?;
        forwarded.push((name, value));
    }
    Ok(ParsedProxyRequest {
        method,
        target,
        headers: forwarded,
        body: request[header_end + 4..].to_vec(),
    })
}

fn write_proxy_response(
    connection: &mut TcpStream,
    route: &ActiveRoute,
    response: &mut Response,
) -> MobileResult<()> {
    write!(
        connection,
        "HTTP/1.1 {} {}\r\n",
        response.status().as_u16(),
        response.status().canonical_reason().unwrap_or("")
    )
    .map_err(|_| route_error("proxyWrite"))?;
    for (name, value) in response.headers() {
        if matches!(name, &CONNECTION | &CONTENT_LENGTH | &TRANSFER_ENCODING) {
            continue;
        }
        let value = value.to_str().map_err(|_| route_error("responseInvalid"))?;
        write!(connection, "{}: {}\r\n", name.as_str(), value)
            .map_err(|_| route_error("proxyWrite"))?;
    }
    write!(connection, "Connection: close\r\n\r\n").map_err(|_| route_error("proxyWrite"))?;
    let mut buffer = [0_u8; 8192];
    loop {
        let count = response
            .read(&mut buffer)
            .map_err(|_| route_error("directRead"))?;
        if count == 0 {
            return Ok(());
        }
        ROUTES.assert_current(route)?;
        connection
            .write_all(&buffer[..count])
            .and_then(|_| connection.flush())
            .map_err(|_| route_error("proxyWrite"))?;
    }
}

fn read_http_request(stream: &mut TcpStream) -> MobileResult<Vec<u8>> {
    let mut request = Vec::with_capacity(4096);
    let mut buffer = [0_u8; 8192];
    let header_end = loop {
        let count = stream
            .read(&mut buffer)
            .map_err(|_| route_error("proxyRead"))?;
        if count == 0 {
            return Err(route_error("requestTruncated"));
        }
        request.extend_from_slice(&buffer[..count]);
        if request.len() > MAX_PROXY_REQUEST_BYTES {
            return Err(route_error("requestTooLarge"));
        }
        if let Some(index) = find_header_end(&request) {
            break index;
        }
    };
    let headers =
        std::str::from_utf8(&request[..header_end]).map_err(|_| route_error("requestInvalid"))?;
    let content_length = request_content_length(headers)?;
    let total = header_end + 4 + content_length;
    if total > MAX_PROXY_REQUEST_BYTES {
        return Err(route_error("requestTooLarge"));
    }
    while request.len() < total {
        let count = stream
            .read(&mut buffer)
            .map_err(|_| route_error("proxyRead"))?;
        if count == 0 {
            return Err(route_error("requestTruncated"));
        }
        request.extend_from_slice(&buffer[..count]);
    }
    request.truncate(total);
    Ok(request)
}

fn request_content_length(headers: &str) -> MobileResult<usize> {
    let mut content_length = None;
    for line in headers.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err(route_error("chunkedRequestUnsupported"));
        }
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err(route_error("contentLengthAmbiguous"));
            }
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| route_error("contentLengthInvalid"))?,
            );
        }
    }
    Ok(content_length.unwrap_or(0))
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

fn force_connection_close(request: Vec<u8>) -> MobileResult<Vec<u8>> {
    let header_end = find_header_end(&request).ok_or_else(|| route_error("requestInvalid"))?;
    let headers =
        std::str::from_utf8(&request[..header_end]).map_err(|_| route_error("requestInvalid"))?;
    let mut rewritten = String::new();
    for line in headers.split("\r\n") {
        if !line
            .split_once(':')
            .is_some_and(|(name, _)| name.eq_ignore_ascii_case("connection"))
        {
            rewritten.push_str(line);
            rewritten.push_str("\r\n");
        }
    }
    rewritten.push_str("Connection: close\r\n\r\n");
    let mut output = rewritten.into_bytes();
    output.extend_from_slice(&request[header_end + 4..]);
    Ok(output)
}

fn relay_round_trip(
    route: &ActiveRoute,
    request: &[u8],
    timeout: Duration,
) -> MobileResult<Vec<u8>> {
    let mut stream = open_inner_tls(route, timeout)?;
    stream
        .write_all(request)
        .and_then(|_| stream.flush())
        .map_err(|_| route_error("innerTlsWrite"))?;
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|_| route_error("innerTlsRead"))?;
    Ok(response)
}

fn open_inner_tls(
    route: &ActiveRoute,
    timeout: Duration,
) -> MobileResult<StreamOwned<ClientConnection, TunnelStream>> {
    let tunnel = open_relay_tunnel(route, timeout)?;
    let expected_spki = route
        .candidate
        .inner_tls_spki_sha256
        .clone()
        .filter(|value| value.len() == 32)
        .ok_or_else(|| route_error("innerTlsPinMissing"))?;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Arc::new(PinnedSpkiVerifier {
        expected_spki,
        provider: provider.clone(),
    });
    let mut config = ClientConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|_| route_error("innerTlsConfig"))?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    let server_name = ServerName::try_from("peers-touch-station")
        .map_err(|_| route_error("innerTlsServerName"))?
        .to_owned();
    let connection = ClientConnection::new(Arc::new(config), server_name)
        .map_err(|_| route_error("innerTlsClient"))?;
    Ok(StreamOwned::new(connection, tunnel))
}

fn open_relay_tunnel(route: &ActiveRoute, timeout: Duration) -> MobileResult<TunnelStream> {
    if route.candidate.route_type != StationRouteType::Relay {
        return Err(route_error("routeTypeInvalid"));
    }
    ensure_route_current(&route.candidate)?;
    let mut endpoint = Url::parse(&route.candidate.endpoint_origin)
        .map_err(|_| route_error("relayOriginInvalid"))?;
    match endpoint.scheme() {
        "https" => endpoint
            .set_scheme("wss")
            .map_err(|_| route_error("relaySchemeInvalid"))?,
        "http" if endpoint.host_str().is_some_and(is_loopback_host) => endpoint
            .set_scheme("ws")
            .map_err(|_| route_error("relaySchemeInvalid"))?,
        _ => return Err(route_error("relayRequiresTls")),
    }
    endpoint.set_path(TUNNEL_PATH);
    endpoint.set_query(None);
    endpoint.set_fragment(None);
    let relay_host = endpoint
        .host_str()
        .ok_or_else(|| route_error("relayOriginInvalid"))?
        .to_string();
    let relay_port = endpoint
        .port_or_known_default()
        .ok_or_else(|| route_error("relayOriginInvalid"))?;
    let mut request = endpoint
        .as_str()
        .into_client_request()
        .map_err(|_| route_error("relayRequestInvalid"))?;
    request.headers_mut().insert(
        SEC_WEBSOCKET_PROTOCOL,
        tungstenite::http::HeaderValue::from_static(TUNNEL_SUBPROTOCOL),
    );
    let connector = acceptance_relay_tls_connector()?;
    let (mut socket, response) = match connector {
        Some(connector) => {
            let address = (relay_host.as_str(), relay_port)
                .to_socket_addrs()
                .map_err(|_| route_error("relayUnavailable"))?
                .next()
                .ok_or_else(|| route_error("relayUnavailable"))?;
            let stream = TcpStream::connect_timeout(&address, timeout)
                .map_err(|_| route_error("relayUnavailable"))?;
            stream
                .set_read_timeout(Some(timeout))
                .map_err(|_| route_error("relayUnavailable"))?;
            stream
                .set_write_timeout(Some(timeout))
                .map_err(|_| route_error("relayUnavailable"))?;
            client_tls_with_config(request, stream, None, Some(connector))
                .map_err(|_| route_error("relayUnavailable"))?
        }
        None => connect(request).map_err(|_| route_error("relayUnavailable"))?,
    };
    if response
        .headers()
        .get(SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        != Some(TUNNEL_SUBPROTOCOL)
    {
        return Err(route_error("relaySubprotocolMismatch"));
    }
    set_socket_timeout(socket.get_mut(), timeout)?;
    let mut nonce = vec![0_u8; 32];
    rand::thread_rng().fill_bytes(&mut nonce);
    let cached = ROUTES.cached(&route.candidate.station_peer_id, &route.candidate.route_id)?;
    let parsed = parse_input(&cached.source_input)?;
    let open = RelayTunnelFrame {
        protocol_version: TUNNEL_PROTOCOL_VERSION,
        payload: Some(relay_tunnel_frame::Payload::Open(RelayTunnelOpen {
            route_id: route.candidate.route_id.clone(),
            route_generation: route.candidate.route_generation,
            client_nonce: nonce,
            connection_grant: parsed.connection_grant.unwrap_or_default(),
            target_station_peer_id: String::new(),
            purpose: RelayTunnelPurpose::ClientAccess as i32,
        })),
    };
    socket
        .send(WsMessage::Binary(open.encode_to_vec().into()))
        .map_err(|_| route_error("relayOpenWrite"))?;
    let opened = loop {
        let message = socket.read().map_err(|_| route_error("relayOpenRead"))?;
        match message {
            WsMessage::Binary(bytes) => {
                if bytes.len() > MAX_OUTER_FRAME_BYTES {
                    return Err(route_error("relayFrameTooLarge"));
                }
                let frame = RelayTunnelFrame::decode(bytes.as_ref())
                    .map_err(|_| route_error("relayFrameInvalid"))?;
                if frame.protocol_version != TUNNEL_PROTOCOL_VERSION {
                    return Err(route_error("relayVersionMismatch"));
                }
                match frame.payload {
                    Some(relay_tunnel_frame::Payload::Opened(opened)) => break opened,
                    Some(relay_tunnel_frame::Payload::Close(_)) => {
                        return Err(route_error("relayRejected"))
                    }
                    _ => return Err(route_error("relayOpenInvalid")),
                }
            }
            WsMessage::Ping(payload) => socket
                .send(WsMessage::Pong(payload))
                .map_err(|_| route_error("relayPongFailed"))?,
            _ => return Err(route_error("relayFrameInvalid")),
        }
    };
    if opened.tunnel_id == 0
        || opened.relay_nonce.len() != 32
        || opened.route_attestation.as_slice()
            != route
                .candidate
                .attestation_bytes
                .as_deref()
                .unwrap_or_default()
    {
        return Err(route_error("relayMetadataInvalid"));
    }
    let max_frame_bytes = opened
        .limits
        .as_ref()
        .map(|limits| limits.max_frame_bytes as usize)
        .filter(|value| *value > 0 && *value <= DEFAULT_MAX_FRAME_BYTES)
        .ok_or_else(|| route_error("relayLimitsInvalid"))?;
    Ok(TunnelStream {
        socket,
        tunnel_id: opened.tunnel_id,
        max_frame_bytes,
        next_write_sequence: 1,
        next_read_sequence: 1,
        read_buffer: Cursor::new(Vec::new()),
        closed: false,
    })
}

fn acceptance_relay_tls_connector() -> MobileResult<Option<Connector>> {
    let Some(encoded) = option_env!("PT_ACCEPTANCE_RELAY_CA_DER_B64") else {
        return Ok(None);
    };
    let certificate = STANDARD
        .decode(encoded)
        .map_err(|_| route_error("relayTrustAnchorInvalid"))?;
    let mut roots = RootCertStore::empty();
    roots
        .add(CertificateDer::from(certificate))
        .map_err(|_| route_error("relayTrustAnchorInvalid"))?;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|_| route_error("relayTrustAnchorInvalid"))?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(Some(Connector::Rustls(Arc::new(config))))
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}

fn set_socket_timeout(
    stream: &mut MaybeTlsStream<TcpStream>,
    timeout: Duration,
) -> MobileResult<()> {
    let tcp = match stream {
        MaybeTlsStream::Plain(stream) => stream,
        MaybeTlsStream::Rustls(stream) => stream.get_mut(),
        _ => return Err(route_error("relayTlsBackendUnsupported")),
    };
    tcp.set_read_timeout(Some(timeout))
        .and_then(|_| tcp.set_write_timeout(Some(timeout)))
        .map_err(|_| route_error("relayTimeout"))
}

struct TunnelStream {
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
    tunnel_id: u64,
    max_frame_bytes: usize,
    next_write_sequence: u64,
    next_read_sequence: u64,
    read_buffer: Cursor<Vec<u8>>,
    closed: bool,
}

impl Read for TunnelStream {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if self.read_buffer.position() < self.read_buffer.get_ref().len() as u64 {
            return self.read_buffer.read(output);
        }
        self.read_buffer = Cursor::new(Vec::new());
        loop {
            let message = self.socket.read().map_err(io::Error::other)?;
            match message {
                WsMessage::Binary(bytes) => {
                    let frame = RelayTunnelFrame::decode(bytes.as_ref())
                        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
                    if frame.protocol_version != TUNNEL_PROTOCOL_VERSION {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            "Relay protocol version mismatch",
                        ));
                    }
                    match frame.payload {
                        Some(relay_tunnel_frame::Payload::Data(data))
                            if data.tunnel_id == self.tunnel_id
                                && data.sequence == self.next_read_sequence
                                && !data.ciphertext.is_empty()
                                && data.ciphertext.len() <= self.max_frame_bytes =>
                        {
                            self.next_read_sequence += 1;
                            self.read_buffer = Cursor::new(data.ciphertext);
                            return self.read_buffer.read(output);
                        }
                        Some(relay_tunnel_frame::Payload::Close(close))
                            if close.tunnel_id == self.tunnel_id =>
                        {
                            self.closed = true;
                            return Ok(0);
                        }
                        _ => {
                            return Err(io::Error::new(
                                io::ErrorKind::InvalidData,
                                "invalid Relay tunnel frame",
                            ))
                        }
                    }
                }
                WsMessage::Ping(payload) => self
                    .socket
                    .send(WsMessage::Pong(payload))
                    .map_err(io::Error::other)?,
                WsMessage::Close(_) => {
                    self.closed = true;
                    return Ok(0);
                }
                _ => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "non-binary Relay tunnel frame",
                    ))
                }
            }
        }
    }
}

impl Write for TunnelStream {
    fn write(&mut self, input: &[u8]) -> io::Result<usize> {
        if self.closed {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "Relay tunnel closed",
            ));
        }
        if input.is_empty() {
            return Ok(0);
        }
        let size = input.len().min(self.max_frame_bytes);
        let frame = RelayTunnelFrame {
            protocol_version: TUNNEL_PROTOCOL_VERSION,
            payload: Some(relay_tunnel_frame::Payload::Data(RelayTunnelData {
                tunnel_id: self.tunnel_id,
                sequence: self.next_write_sequence,
                ciphertext: input[..size].to_vec(),
            })),
        };
        self.socket
            .send(WsMessage::Binary(frame.encode_to_vec().into()))
            .map_err(io::Error::other)?;
        self.next_write_sequence += 1;
        Ok(size)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.socket.flush().map_err(io::Error::other)
    }
}

impl Drop for TunnelStream {
    fn drop(&mut self) {
        if self.closed {
            return;
        }
        let frame = RelayTunnelFrame {
            protocol_version: TUNNEL_PROTOCOL_VERSION,
            payload: Some(relay_tunnel_frame::Payload::Cancel(RelayTunnelCancel {
                tunnel_id: self.tunnel_id,
                reason: RelayTunnelCloseReason::Cancelled as i32,
            })),
        };
        let _ = self
            .socket
            .send(WsMessage::Binary(frame.encode_to_vec().into()));
        let _ = self.socket.close(None);
    }
}

#[derive(Debug)]
struct PinnedSpkiVerifier {
    expected_spki: Vec<u8>,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for PinnedSpkiVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let (_, certificate) = parse_x509_certificate(end_entity.as_ref())
            .map_err(|_| rustls::Error::General("invalid inner TLS certificate".to_string()))?;
        let digest = Sha256::digest(certificate.public_key().raw);
        if digest.as_slice() != self.expected_spki {
            return Err(rustls::Error::General(
                "inner TLS SPKI mismatch".to_string(),
            ));
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            certificate,
            signature,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            certificate,
            signature,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

fn discovery_error(reason: &str) -> MobileError {
    MobileError::station_identity(format!("mobile.launch.stationDiscoveryInvalid:{reason}"))
}

fn identity_error(reason: &str) -> MobileError {
    MobileError::station_identity(format!("mobile.launch.stationIdentityInvalid:{reason}"))
}

fn route_error(reason: &str) -> MobileError {
    MobileError::station_transport(format!("mobile.launch.stationRouteInvalid:{reason}"))
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

impl fmt::Display for ActiveRoute {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{}:{}@{}",
            self.candidate.station_peer_id, self.candidate.route_id, self.route_revision
        )
    }
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::{Signer, SigningKey};
    use rand::rngs::OsRng;

    use super::*;

    #[test]
    fn discovery_uses_station_protobuf_media_type() {
        assert_eq!(PROTOBUF_CONTENT_TYPE, "application/protobuf");
    }

    #[test]
    fn endpoint_origin_validation_distinguishes_direct_and_relay_roles() {
        assert!(endpoint_origin_is_valid(
            AccessEndpointRole::DirectStation,
            "https://station.example",
            "https://station.example",
        ));
        assert!(!endpoint_origin_is_valid(
            AccessEndpointRole::DirectStation,
            "https://station.example",
            "https://other.example",
        ));
        assert!(endpoint_origin_is_valid(
            AccessEndpointRole::Relay,
            "http://relay.example:18081",
            "https://relay.example:4501",
        ));
        assert!(!endpoint_origin_is_valid(
            AccessEndpointRole::Relay,
            "http://relay.example:18081",
            "http://relay.example:4501",
        ));
    }

    #[test]
    fn private_connection_material_is_parsed_without_exposing_the_grant() {
        let envelope = StationConnectionEnvelope {
            protocol_version: ACCESS_PROTOCOL_VERSION,
            relay_origin: "https://relay.example:443".to_string(),
            route_attestation: Some(StationRouteAttestation {
                statement_bytes: vec![1],
                host_public_key: vec![2],
                signature: vec![3],
            }),
            connection_grant: Some(peer_proto::StationConnectionGrant {
                statement_bytes: vec![4],
                host_public_key: vec![5],
                signature: vec![6],
            }),
        };
        let encoded = format!("ptc1:{}", URL_SAFE_NO_PAD.encode(envelope.encode_to_vec()));
        let parsed = parse_input(&encoded).expect("connection material");
        assert_eq!(parsed.origin, "https://relay.example:443");
        assert!(parsed.connection_grant.is_some());
    }

    #[test]
    fn relay_route_verification_binds_station_and_relay_identities() {
        let now = 1_800_000_000_000_i64;
        let station_key = SigningKey::generate(&mut OsRng);
        let station_public = PublicKey::from(
            libp2p_identity::ed25519::PublicKey::try_from_bytes(
                station_key.verifying_key().as_bytes(),
            )
            .unwrap(),
        );
        let station_peer_id = station_public.to_peer_id().to_string();
        let statement = StationRouteStatement {
            station_peer_id: station_peer_id.clone(),
            relay_peer_id: "relay-a".to_string(),
            route_id: "route-a".to_string(),
            route_generation: 7,
            inner_tls_spki_sha256: vec![7; 32],
            capabilities_digest: vec![8; 32],
            visibility: StationRouteVisibility::Public as i32,
            issued_at_unix_ms: now,
            expires_at_unix_ms: now + 60_000,
        };
        let bytes = statement.encode_to_vec();
        let mut signed = STATION_ROUTE_DOMAIN.to_vec();
        signed.extend_from_slice(&bytes);
        let route = verify_route_attestation(
            &StationRouteAttestation {
                statement_bytes: bytes,
                host_public_key: station_public.encode_protobuf(),
                signature: station_key.sign(&signed).to_bytes().to_vec(),
            },
            "relay-a",
            "https://relay.example:443",
            now,
        )
        .expect("valid route");
        assert_eq!(route.station_peer_id, station_peer_id);
        assert_eq!(route.route_generation, 7);
        assert_eq!(route.route_type, StationRouteType::Relay);
    }

    #[test]
    fn relay_route_verification_rejects_expired_generation() {
        let now = 1_800_000_000_000_i64;
        let station_key = SigningKey::generate(&mut OsRng);
        let station_public = PublicKey::from(
            libp2p_identity::ed25519::PublicKey::try_from_bytes(
                station_key.verifying_key().as_bytes(),
            )
            .unwrap(),
        );
        let statement = StationRouteStatement {
            station_peer_id: station_public.to_peer_id().to_string(),
            relay_peer_id: "relay-a".to_string(),
            route_id: "route-a".to_string(),
            route_generation: 1,
            inner_tls_spki_sha256: vec![7; 32],
            capabilities_digest: vec![8; 32],
            visibility: StationRouteVisibility::Public as i32,
            issued_at_unix_ms: now - 120_000,
            expires_at_unix_ms: now - 1,
        };
        let bytes = statement.encode_to_vec();
        let mut signed = STATION_ROUTE_DOMAIN.to_vec();
        signed.extend_from_slice(&bytes);
        assert!(verify_route_attestation(
            &StationRouteAttestation {
                statement_bytes: bytes,
                host_public_key: station_public.encode_protobuf(),
                signature: station_key.sign(&signed).to_bytes().to_vec(),
            },
            "relay-a",
            "https://relay.example:443",
            now,
        )
        .is_err());
    }

    #[test]
    fn proxy_parser_rejects_chunked_requests() {
        assert!(read_http_request_from_bytes(
            b"POST /actor/access/start HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n"
        )
        .is_err());
    }

    fn read_http_request_from_bytes(bytes: &[u8]) -> MobileResult<Vec<u8>> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| route_error("testBind"))?;
        let address = listener
            .local_addr()
            .map_err(|_| route_error("testAddress"))?;
        let request = bytes.to_vec();
        let sender = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(address).unwrap();
            stream.write_all(&request).unwrap();
        });
        let (mut stream, _) = listener.accept().map_err(|_| route_error("testAccept"))?;
        let result = read_http_request(&mut stream);
        sender.join().unwrap();
        result
    }
}
