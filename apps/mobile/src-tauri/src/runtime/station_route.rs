use std::collections::HashMap;
use std::fmt;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{LazyLock, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use libp2p_identity::PublicKey;
use prost::Message as _;
use rand::RngCore;
use reqwest::blocking::Client;
use reqwest::header::{
    HeaderName, HeaderValue, CONNECTION, CONTENT_LENGTH, HOST, TRANSFER_ENCODING,
};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use station_libp2p_http::{
    Request as StandardRequest, RequestBody as StandardRequestBody, Response as StandardResponse,
    Route as StandardRoute, TrafficClass, TransportHandle as StandardTransportHandle,
    TransportOwner as StandardTransportOwner,
};
use station_trust::{
    endpoint_tls_client_config, proto::PublicEndpointConnectionMaterial,
    verify_node_authorization_bytes, verify_public_connection_material,
    verify_station_route_attestation_bytes, VerifiedPublicEndpointConnectionMaterial,
};
use tauri::State;

use crate::commands::station::{
    verify_station_identity_proof, VerifiedStationIdentity as BaseVerifiedStationIdentity,
    VerifyStationIdentityProofInput,
};
use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;
use crate::station_origin::normalize_station_origin;

mod peer_proto {
    include!(concat!(env!("OUT_DIR"), "/peers_touch.model.peer.v1.rs"));
}

use peer_proto::{
    AccessEndpointOutcome, AccessEndpointRequest, AccessEndpointResponse, AccessEndpointRole,
    AccessEndpointSourceProof, AccessEndpointSourceProofStatement, StationConnectionEnvelope,
    StationConnectionGrantStatement, StationIdentityRequest, StationIdentityResponse,
    StationIdentityStatement, StationRouteAttestation, StationRouteKind, StationRouteStatement,
};

const ACCESS_PATH: &str = "/.well-known/peers-touch/access";
const IDENTITY_PATH: &str = "/sub-bootstrap/station-identity";
const PROTOBUF_CONTENT_TYPE: &str = "application/protobuf";
const ACCESS_ENDPOINT_DOMAIN: &[u8] = b"peers-touch/access-endpoint/v1\0";
const ACCESS_ENDPOINT_SOURCE_PROOF_DOMAIN: &[u8] = b"peers-touch/access-endpoint-source-proof/v1\0";
const ACCESS_PROTOCOL_VERSION: u32 = 1;
const CHALLENGE_SIZE: usize = 32;
const CLOCK_SKEW_MS: i64 = 60_000;
const ROUTE_RENEWAL_WINDOW_MS: i64 = 60_000;
const MAX_DISCOVERY_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_PROXY_REQUEST_BYTES: usize = 64 * 1024 * 1024;
const ROUTE_SOURCE_KEY_PREFIX: &str = "peers-touch.mobile.station-route-source.v1.";
const PUBLIC_CONNECTION_MATERIAL_PREFIX: &str = "ptm1:";

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
    pub node_peer_id: String,
    pub station_root_public_key: Vec<u8>,
    pub node_authorization_digest: Vec<u8>,
    pub authorization_epoch: u64,
    pub route_id: String,
    pub route_type: StationRouteType,
    pub transport: String,
    pub endpoint_origin: String,
    pub relay_peer_id: Option<String>,
    pub route_generation: u64,
    pub inner_tls_spki_sha256: Option<Vec<u8>>,
    pub addresses: Vec<String>,
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

#[derive(Clone, Debug, PartialEq, Eq)]
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StationRouteRefreshProjection {
    pub binding: StationRouteBindingProjection,
    pub route: StationRouteCandidate,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedStationIdentity {
    pub station_peer_id: String,
    pub node_peer_id: String,
    pub authorization_epoch: u64,
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
    renewal: Mutex<()>,
    proxy_origin: Mutex<Option<String>>,
    standard_transport: Mutex<Option<StandardTransportRuntime>>,
}

struct StandardTransportRuntime {
    _owner: StandardTransportOwner,
    handle: StandardTransportHandle,
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

    fn renew_route_with(
        &self,
        expected: Option<&StationRouteSelectionInput>,
        discover: impl FnOnce(&str) -> MobileResult<VerifiedDiscovery>,
    ) -> MobileResult<ActiveRoute> {
        // A waiter reads the committed proof after the preceding renewal.
        // Discovery is bounded by its client timeout; selection/removal remain
        // free to invalidate this snapshot while discovery is in flight.
        let _renewal = self
            .renewal
            .lock()
            .map_err(|_| route_error("runtimeLock"))?;
        let snapshot = self.active_snapshot()?;
        if expected.is_some_and(|expected| {
            snapshot.candidate.station_peer_id != expected.station_peer_id
                || snapshot.candidate.route_id != expected.route_id
                || snapshot.route_revision != expected.route_revision
        }) {
            return Err(route_error("routeChanged"));
        }
        if !snapshot
            .candidate
            .attestation_expires_at_unix_ms
            .is_some_and(|expiry| {
                expiry <= (unix_ms() as i64).saturating_add(ROUTE_RENEWAL_WINDOW_MS)
            })
        {
            return Ok(snapshot);
        }
        let cached = self.cached(
            &snapshot.candidate.station_peer_id,
            &snapshot.candidate.route_id,
        )?;
        if cached.candidate != snapshot.candidate {
            return Err(route_error("routeChanged"));
        }
        let discovery = discover(&cached.source_input)?;
        let renewed = discovery
            .projection
            .routes
            .iter()
            .find(|candidate| {
                candidate.station_peer_id == snapshot.candidate.station_peer_id
                    && candidate.station_root_public_key
                        == snapshot.candidate.station_root_public_key
                    && candidate.node_peer_id == snapshot.candidate.node_peer_id
                    && candidate.route_id == snapshot.candidate.route_id
                    && candidate.route_type == snapshot.candidate.route_type
                    && candidate.transport == snapshot.candidate.transport
                    && candidate.route_generation >= snapshot.candidate.route_generation
                    && candidate.endpoint_origin == snapshot.candidate.endpoint_origin
                    && candidate.relay_peer_id == snapshot.candidate.relay_peer_id
                    && candidate.source_ref == snapshot.candidate.source_ref
                    && candidate.authorization_epoch >= snapshot.candidate.authorization_epoch
            })
            .ok_or_else(|| route_error("routeGenerationRevoked"))?;
        ensure_route_current(renewed)?;
        // Discovery performs trust verification outside locks. Commit only to
        // the exact route snapshot that requested renewal.
        let mut routes = self
            .discovered
            .write()
            .map_err(|_| route_error("runtimeLock"))?;
        let mut active = self
            .active
            .write()
            .map_err(|_| route_error("runtimeLock"))?;
        if active.as_ref() != Some(&snapshot)
            || routes
                .get(&(
                    snapshot.candidate.station_peer_id.clone(),
                    snapshot.candidate.route_id.clone(),
                ))
                .is_none_or(|current| current.candidate != cached.candidate)
        {
            return Err(route_error("routeChanged"));
        }
        self.retire_standard_route(&snapshot)?;
        let refreshed = ActiveRoute {
            candidate: renewed.clone(),
            route_revision: snapshot.route_revision,
        };
        routes.insert(
            (renewed.station_peer_id.clone(), renewed.route_id.clone()),
            CachedRoute {
                candidate: renewed.clone(),
                source_input: cached.source_input,
            },
        );
        *active = Some(refreshed.clone());
        Ok(refreshed)
    }

    fn retire_standard_route(&self, route: &ActiveRoute) -> MobileResult<()> {
        let route = standard_route(route)?;
        let transport = self
            .standard_transport
            .lock()
            .map_err(|_| route_error("runtimeLock"))?;
        if let Some(transport) = transport.as_ref() {
            transport
                .handle
                .close_route(&route)
                .map_err(|_| route_error("standardRouteClose"))?;
        }
        Ok(())
    }

    fn assert_current(&self, snapshot: &ActiveRoute) -> MobileResult<()> {
        let current = self.active_snapshot()?;
        if current != *snapshot {
            return Err(route_error("routeChanged"));
        }
        ensure_route_current(&current.candidate)
    }

    fn activate_alternate(&self, failed: &ActiveRoute) -> MobileResult<ActiveRoute> {
        let discovered = self
            .discovered
            .read()
            .map_err(|_| route_error("runtimeLock"))?;
        let mut candidates = discovered
            .values()
            .filter(|cached| {
                cached.candidate.station_peer_id == failed.candidate.station_peer_id
                    && cached.candidate.route_id != failed.candidate.route_id
                    && ensure_route_current(&cached.candidate).is_ok()
                    && !discovered.values().any(|other| {
                        other.candidate.station_peer_id == cached.candidate.station_peer_id
                            && other.candidate.node_peer_id == cached.candidate.node_peer_id
                            && other.candidate.authorization_epoch
                                > cached.candidate.authorization_epoch
                    })
            })
            .cloned()
            .collect::<Vec<_>>();
        candidates.sort_by_key(|cached| {
            (
                u8::from(cached.candidate.route_type != StationRouteType::Direct),
                cached.candidate.route_id.clone(),
            )
        });
        let candidate = candidates
            .into_iter()
            .next()
            .ok_or_else(|| route_error("alternateRouteUnavailable"))?;
        drop(discovered);

        let mut active = self
            .active
            .write()
            .map_err(|_| route_error("runtimeLock"))?;
        if active.as_ref().is_none_or(|current| {
            current.candidate.station_peer_id != failed.candidate.station_peer_id
                || current.candidate.route_id != failed.candidate.route_id
                || current.route_revision != failed.route_revision
        }) {
            return Err(route_error("routeChanged"));
        }
        let alternate = ActiveRoute {
            candidate: candidate.candidate,
            route_revision: failed.route_revision.saturating_add(1),
        };
        *active = Some(alternate.clone());
        Ok(alternate)
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

    fn standard_transport(&self) -> MobileResult<StandardTransportHandle> {
        let mut transport = self
            .standard_transport
            .lock()
            .map_err(|_| route_error("runtimeLock"))?;
        if let Some(transport) = transport.as_ref() {
            return Ok(transport.handle.clone());
        }
        let owner =
            StandardTransportOwner::start().map_err(|_| route_error("standardTransportStart"))?;
        let handle = owner.handle();
        *transport = Some(StandardTransportRuntime {
            _owner: owner,
            handle: handle.clone(),
        });
        Ok(handle)
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
    let discovery =
        tauri::async_runtime::spawn_blocking(move || discover_station_input(&input, false))
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
) -> MobileResult<StationRouteRefreshProjection> {
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
    let discovery =
        tauri::async_runtime::spawn_blocking(move || discover_station_input(&source, true))
            .await
            .map_err(|_| discovery_error("runtimeUnavailable"))??;
    let route = discovery
        .projection
        .routes
        .iter()
        .find(|route| {
            route.station_peer_id == station_peer_id
                && route.route_id == route_id
                && route.route_generation == input.route_generation
        })
        .cloned()
        .ok_or_else(|| route_error("routeGenerationRevoked"))?;
    ROUTES.register(&discovery)?;
    let binding = ROUTES.activate(&station_peer_id, &route_id, input.route_revision)?;
    Ok(StationRouteRefreshProjection { binding, route })
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
pub async fn station_route_refresh(
    input: StationRouteSelectionInput,
) -> MobileResult<StationRouteRefreshProjection> {
    tauri::async_runtime::spawn_blocking(move || {
        // Validate the requested selection after acquiring renewal ownership.
        let refreshed =
            ROUTES.renew_route_with(Some(&input), |source| discover_station_input(source, true))?;
        Ok(StationRouteRefreshProjection {
            binding: binding_projection(&refreshed, ROUTES.ensure_proxy()?),
            route: refreshed.candidate,
        })
    })
    .await
    .map_err(|_| route_error("runtimeUnavailable"))?
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

pub(crate) fn discover_public_material(
    material: &PublicEndpointConnectionMaterial,
) -> MobileResult<StationEndpointDiscovery> {
    let expected = verify_public_connection_material(material, true, unix_ms() as i64)
        .map_err(|_| discovery_error("publicMaterialInvalid"))?;
    let source_input = encode_public_connection_material(material);
    let parsed = ParsedInput {
        origin: expected.canonical_discovery_origin.clone(),
        connection_grant: None,
        relay_peer_id: None,
        expected: Some(expected),
    };
    let discovery = discover_parsed(parsed, source_input)?;
    ROUTES.register(&discovery)?;
    Ok(discovery.projection)
}

fn discover_station_input(
    input: &str,
    allow_public_material: bool,
) -> MobileResult<VerifiedDiscovery> {
    let parsed = parse_input(input, allow_public_material)?;
    discover_parsed(parsed, input.trim().to_string())
}

fn discover_parsed(parsed: ParsedInput, source_input: String) -> MobileResult<VerifiedDiscovery> {
    let mut challenge = [0_u8; CHALLENGE_SIZE];
    rand::thread_rng().fill_bytes(&mut challenge);
    let source_proof = match (
        parsed.connection_grant.as_deref(),
        parsed.relay_peer_id.as_deref(),
    ) {
        (Some(grant), Some(relay_peer_id)) => {
            let statement = AccessEndpointSourceProofStatement {
                challenge: challenge.to_vec(),
                connection_grant_digest: Sha256::digest(grant).to_vec(),
                relay_peer_id: relay_peer_id.to_string(),
                client_protocol_version: ACCESS_PROTOCOL_VERSION,
            };
            let statement_bytes = statement.encode_to_vec();
            let mut signed = Vec::with_capacity(
                ACCESS_ENDPOINT_SOURCE_PROOF_DOMAIN.len() + statement_bytes.len(),
            );
            signed.extend_from_slice(ACCESS_ENDPOINT_SOURCE_PROOF_DOMAIN);
            signed.extend_from_slice(&statement_bytes);
            let proof = ROUTES
                .standard_transport()?
                .sign_identity_proof(&signed)
                .map_err(|_| discovery_error("sourceProofUnavailable"))?;
            Some(AccessEndpointSourceProof {
                statement_bytes,
                source_public_key: proof.public_key,
                source_signature: proof.signature,
            })
        }
        (None, None) => None,
        _ => return Err(discovery_error("connectionMaterialInvalid")),
    };
    let request = AccessEndpointRequest {
        challenge: challenge.to_vec(),
        connection_grant: parsed.connection_grant.clone().unwrap_or_default(),
        client_protocol_version: ACCESS_PROTOCOL_VERSION,
        source_proof,
    };
    let endpoint = format!("{}{}", parsed.origin, ACCESS_PATH);
    let mut client = Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none());
    if let Some(expected) = parsed.expected.as_ref() {
        if let Some(config) = endpoint_tls_client_config(&expected.tls_trust)
            .map_err(|_| discovery_error("publicTlsInvalid"))?
        {
            client = client.use_preconfigured_tls(config);
        }
    } else if let Some(certificate) = acceptance_relay_discovery_certificate()? {
        client = client.add_root_certificate(certificate);
    }
    let response = client
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
        parsed.expected.as_ref(),
    )?;
    Ok(VerifiedDiscovery {
        projection,
        source_input,
    })
}

fn verify_discovery_response(
    requested_origin: &str,
    connection_grant: Option<Vec<u8>>,
    challenge: &[u8],
    response: AccessEndpointResponse,
    now_unix_ms: i64,
    expected: Option<&VerifiedPublicEndpointConnectionMaterial>,
) -> MobileResult<StationEndpointDiscovery> {
    let statement =
        peer_proto::AccessEndpointStatement::decode(response.endpoint_statement_bytes.as_slice())
            .map_err(|_| discovery_error("statementInvalid"))?;
    let role = AccessEndpointRole::try_from(statement.endpoint_role)
        .map_err(|_| discovery_error("roleInvalid"))?;
    let canonical_origin = normalize_origin(&statement.canonical_origin)?;
    if statement.encode_to_vec() != response.endpoint_statement_bytes
        || statement.challenge != challenge
        || !endpoint_origin_is_valid(role, requested_origin, &canonical_origin, expected)
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
            if response.outcome != AccessEndpointOutcome::Ready as i32 || connection_grant.is_some()
            {
                return Err(discovery_error("directOutcomeInvalid"));
            }
            let node_authorization = response
                .node_authorization
                .as_ref()
                .ok_or_else(|| discovery_error("nodeAuthorizationMissing"))?;
            let verified_authorization =
                verify_node_authorization_bytes(&node_authorization.encode_to_vec(), now_unix_ms)
                    .map_err(|_| discovery_error("nodeAuthorizationInvalid"))?;
            if verified_authorization.node_peer_id != statement.endpoint_peer_id
                || verified_authorization.node_public_key != endpoint_public_key
                || statement.node_authorization_digest
                    != verified_authorization.authorization_digest
            {
                return Err(discovery_error("nodeAuthorizationMismatch"));
            }
            let mut direct_routes = 0;
            let mut routes = Vec::with_capacity(response.station_routes.len());
            for attestation in &response.station_routes {
                let statement =
                    StationRouteStatement::decode(attestation.statement_bytes.as_slice())
                        .map_err(|_| discovery_error("routeStatementInvalid"))?;
                let expected_relay_peer_id = match StationRouteKind::try_from(statement.kind).ok() {
                    Some(StationRouteKind::Direct) => {
                        direct_routes += 1;
                        None
                    }
                    Some(StationRouteKind::Circuit)
                        if !statement.relay_peer_id.trim().is_empty() =>
                    {
                        Some(statement.relay_peer_id.as_str())
                    }
                    _ => return Err(discovery_error("routeKindInvalid")),
                };
                let route = verify_route_attestation(
                    attestation,
                    expected_relay_peer_id,
                    &canonical_origin,
                    now_unix_ms,
                )?;
                if route.station_peer_id != verified_authorization.station_peer_id
                    || route.node_peer_id != verified_authorization.node_peer_id
                    || route.station_root_public_key
                        != verified_authorization.station_root_public_key
                    || route.node_authorization_digest
                        != verified_authorization.authorization_digest
                    || route.authorization_epoch != verified_authorization.authorization_epoch
                {
                    return Err(discovery_error("routeAuthorizationMismatch"));
                }
                routes.push(route);
            }
            if direct_routes != 1 {
                return Err(discovery_error("directRouteMissing"));
            }
            routes.sort_by_key(|route| route.route_type != StationRouteType::Direct);
            (VerifiedEndpointRole::DirectStation, routes)
        }
        AccessEndpointRole::Relay => {
            if response.node_authorization.is_some()
                || !statement.node_authorization_digest.is_empty()
            {
                return Err(discovery_error("relayNodeAuthorizationInvalid"));
            }
            verify_relay_outcome(&response)?;
            let mut routes = Vec::with_capacity(response.station_routes.len());
            for attestation in &response.station_routes {
                routes.push(verify_route_attestation(
                    attestation,
                    Some(&statement.endpoint_peer_id),
                    &canonical_origin,
                    now_unix_ms,
                )?);
            }
            (VerifiedEndpointRole::Relay, routes)
        }
        _ => return Err(discovery_error("roleUnsupported")),
    };

    let projection = StationEndpointDiscovery {
        role,
        endpoint_peer_id: statement.endpoint_peer_id,
        canonical_origin,
        routes,
    };
    if let Some(expected) = expected {
        validate_public_discovery_identity(&projection, expected)?;
    }
    Ok(projection)
}

fn endpoint_origin_is_valid(
    role: AccessEndpointRole,
    requested_origin: &str,
    canonical_origin: &str,
    expected: Option<&VerifiedPublicEndpointConnectionMaterial>,
) -> bool {
    if let Some(expected) = expected {
        return role as i32 == expected.expected_endpoint_role as i32
            && canonical_origin == expected.canonical_discovery_origin;
    }
    match role {
        AccessEndpointRole::DirectStation => canonical_origin == requested_origin,
        AccessEndpointRole::Relay => canonical_origin.starts_with("https://"),
        _ => false,
    }
}

fn validate_public_discovery_identity(
    discovery: &StationEndpointDiscovery,
    expected: &VerifiedPublicEndpointConnectionMaterial,
) -> MobileResult<()> {
    if discovery.canonical_origin != expected.canonical_discovery_origin {
        return Err(discovery_error("publicIdentityMismatch"));
    }
    match expected.expected_endpoint_role {
        station_trust::proto::AccessEndpointRole::Relay => {
            if discovery.role != VerifiedEndpointRole::Relay
                || discovery.endpoint_peer_id != expected.expected_endpoint_identity
            {
                return Err(discovery_error("publicIdentityMismatch"));
            }
        }
        station_trust::proto::AccessEndpointRole::DirectStation => {
            let expected_root = expected
                .station_root_public_key
                .as_deref()
                .ok_or_else(|| discovery_error("publicStationRootMissing"))?;
            if discovery.role != VerifiedEndpointRole::DirectStation
                || discovery.routes.is_empty()
                || discovery.routes.iter().any(|route| {
                    route.station_peer_id != expected.expected_endpoint_identity
                        || route.station_root_public_key != expected_root
                })
            {
                return Err(discovery_error("publicStationRootMismatch"));
            }
        }
        station_trust::proto::AccessEndpointRole::Unspecified => {
            return Err(discovery_error("publicRoleInvalid"));
        }
    }
    Ok(())
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
        Some(AccessEndpointOutcome::SourceProofInvalid) => Err(route_error("sourceProofInvalid")),
        _ => Err(discovery_error("relayOutcomeInvalid")),
    }
}

fn verify_route_attestation(
    attestation: &StationRouteAttestation,
    expected_relay_peer_id: Option<&str>,
    endpoint_origin: &str,
    now_unix_ms: i64,
) -> MobileResult<StationRouteCandidate> {
    let attestation_bytes = attestation.encode_to_vec();
    let verified = verify_station_route_attestation_bytes(
        &attestation_bytes,
        expected_relay_peer_id,
        now_unix_ms,
    )
    .map_err(|_| route_error("attestationInvalid"))?;
    let route_type = if verified.relay_peer_id.is_some() {
        StationRouteType::Relay
    } else {
        StationRouteType::Direct
    };
    let source_ref = route_source_ref(&verified.station_peer_id, &verified.route_id);
    Ok(StationRouteCandidate {
        station_peer_id: verified.station_peer_id,
        node_peer_id: verified.node_peer_id,
        station_root_public_key: verified.station_root_public_key,
        node_authorization_digest: verified.authorization_digest.to_vec(),
        authorization_epoch: verified.authorization_epoch,
        route_id: verified.route_id,
        route_type,
        transport: "libp2p_http_v1".to_string(),
        endpoint_origin: endpoint_origin.to_string(),
        relay_peer_id: verified.relay_peer_id,
        route_generation: verified.route_generation,
        inner_tls_spki_sha256: Some(verified.inner_tls_spki_sha256.to_vec()),
        addresses: verified.addresses,
        attestation_bytes: Some(attestation_bytes),
        attestation_expires_at_unix_ms: Some(verified.expires_at_unix_ms),
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
    relay_peer_id: Option<String>,
    expected: Option<VerifiedPublicEndpointConnectionMaterial>,
}

fn parse_input(input: &str, allow_public_material: bool) -> MobileResult<ParsedInput> {
    let value = input.trim();
    if let Some(encoded) = value.strip_prefix(PUBLIC_CONNECTION_MATERIAL_PREFIX) {
        if !allow_public_material {
            return Err(discovery_error("publicMaterialSourceForbidden"));
        }
        let raw = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| discovery_error("publicMaterialInvalid"))?;
        let material = PublicEndpointConnectionMaterial::decode(raw.as_slice())
            .map_err(|_| discovery_error("publicMaterialInvalid"))?;
        if material.encode_to_vec() != raw {
            return Err(discovery_error("publicMaterialInvalid"));
        }
        let expected = verify_public_connection_material(&material, true, unix_ms() as i64)
            .map_err(|_| discovery_error("publicMaterialInvalid"))?;
        return Ok(ParsedInput {
            origin: expected.canonical_discovery_origin.clone(),
            connection_grant: None,
            relay_peer_id: None,
            expected: Some(expected),
        });
    }
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
        let grant = envelope
            .connection_grant
            .as_ref()
            .ok_or_else(|| discovery_error("connectionMaterialIncomplete"))?;
        let grant_statement =
            StationConnectionGrantStatement::decode(grant.statement_bytes.as_slice())
                .map_err(|_| discovery_error("connectionMaterialInvalid"))?;
        if grant_statement.relay_peer_id.trim().is_empty() {
            return Err(discovery_error("connectionMaterialInvalid"));
        }
        return Ok(ParsedInput {
            origin: normalize_origin(&envelope.relay_origin)?,
            connection_grant: Some(grant.encode_to_vec()),
            relay_peer_id: Some(grant_statement.relay_peer_id),
            expected: None,
        });
    }
    Ok(ParsedInput {
        origin: normalize_origin(value)?,
        connection_grant: None,
        relay_peer_id: None,
        expected: None,
    })
}

fn encode_public_connection_material(material: &PublicEndpointConnectionMaterial) -> String {
    format!(
        "{PUBLIC_CONNECTION_MATERIAL_PREFIX}{}",
        URL_SAFE_NO_PAD.encode(material.encode_to_vec())
    )
}

fn normalize_origin(value: &str) -> MobileResult<String> {
    normalize_station_origin(value).map_err(|_| discovery_error("originInvalid"))
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
        .is_some_and(|expiry| expiry <= unix_ms() as i64)
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
    let route = ROUTES.renew_route_with(None, |source| discover_station_input(source, true))?;
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
    let proof_bytes = proof.encode_to_vec();
    let BaseVerifiedStationIdentity {
        station_peer_id,
        node_peer_id,
        station_root_public_key,
        node_authorization_digest,
        authorization_epoch,
        canonical_origin,
        capabilities,
        verified_at,
    } = verify_station_identity_proof(
        VerifyStationIdentityProofInput {
            requested_origin: statement.canonical_origin,
            challenge: challenge.to_vec(),
            response_bytes: proof_bytes,
            required_capabilities: vec![
                "access-gate".to_string(),
                "actor-ptid".to_string(),
                "station-identity".to_string(),
            ],
        },
        now_unix_ms,
    )?;
    if station_peer_id != route.candidate.station_peer_id
        || node_peer_id != route.candidate.node_peer_id
        || station_root_public_key != route.candidate.station_root_public_key
        || node_authorization_digest.as_slice() != route.candidate.node_authorization_digest
        || authorization_epoch != route.candidate.authorization_epoch
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
        node_peer_id,
        authorization_epoch,
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
            let _ = serve_proxy_connection(connection);
        });
    }
}

fn proxy_stage<T>(stage: &'static str, result: MobileResult<T>) -> MobileResult<T> {
    result.map_err(|error| {
        log::warn!(target: "station-route", "proxy failed stage={stage}");
        error
    })
}

fn serve_proxy_connection(mut connection: TcpStream) -> MobileResult<()> {
    let route = proxy_stage(
        "renewal",
        ROUTES.renew_route_with(None, |source| discover_station_input(source, true)),
    )?;
    let timeout = Duration::from_secs(305);
    proxy_stage(
        "connection_timeout",
        connection
            .set_read_timeout(Some(timeout))
            .and_then(|_| connection.set_write_timeout(Some(timeout)))
            .map_err(|_| route_error("proxyTimeout")),
    )?;
    let request = proxy_stage("request_read", read_http_request(&mut connection))?;
    match proxy_stage("round_trip", open_standard_response(&route, &request)) {
        Ok(response) => write_standard_response(&mut connection, &route, response),
        Err(_) => {
            if !request_allows_automatic_failover(&request) {
                return Err(route_error("standardRoundTrip"));
            }
            let alternate = proxy_stage("alternate_selection", ROUTES.activate_alternate(&route))?;
            let response = proxy_stage(
                "alternate_round_trip",
                open_standard_response(&alternate, &request),
            )?;
            write_standard_response(&mut connection, &alternate, response)
        }
    }
}

fn request_allows_automatic_failover(request: &[u8]) -> bool {
    parse_proxy_request(request).is_ok_and(|parsed| {
        matches!(
            parsed.method,
            Method::GET | Method::HEAD | Method::OPTIONS | Method::TRACE
        )
    })
}

fn standard_route(route: &ActiveRoute) -> MobileResult<StandardRoute> {
    if route.candidate.transport != "libp2p_http_v1" {
        return Err(route_error("standardRouteInvalid"));
    }
    let inner_tls_spki_sha256 = route
        .candidate
        .inner_tls_spki_sha256
        .as_deref()
        .and_then(|value| value.try_into().ok())
        .ok_or_else(|| route_error("innerTlsPinMissing"))?;
    let dial_multiaddr = route
        .candidate
        .addresses
        .iter()
        .find(|address| {
            address.contains("/p2p-circuit/")
                == (route.candidate.route_type == StationRouteType::Relay)
        })
        .cloned()
        .ok_or_else(|| route_error("standardAddressMissing"))?;
    Ok(StandardRoute {
        node_peer_id: route.candidate.node_peer_id.clone(),
        dial_multiaddr,
        inner_tls_spki_sha256,
        route_generation: route.candidate.route_generation,
    })
}

fn open_standard_response(route: &ActiveRoute, request: &[u8]) -> MobileResult<StandardResponse> {
    let route_spec = standard_route(route)?;
    let transport = ROUTES.standard_transport()?;
    let parsed = parse_proxy_request(request)?;
    let mut standard_request = StandardRequest::new(
        parsed.method,
        parsed
            .target
            .parse()
            .map_err(|_| route_error("requestInvalid"))?,
    );
    for (name, value) in parsed.headers {
        standard_request.headers.append(name, value);
    }
    standard_request.body = StandardRequestBody::Bytes(parsed.body);
    if standard_request
        .headers
        .get(reqwest::header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        == Some("text/event-stream")
    {
        standard_request.traffic_class = TrafficClass::Realtime;
    }
    transport
        .round_trip(&route_spec, standard_request)
        .map_err(|error| {
            log::warn!(
                target: "station-route",
                "transport failed kind={:?} phase={:?}", error.kind(), error.phase()
            );
            route_error("standardRoundTrip")
        })
}

fn write_standard_response(
    connection: &mut TcpStream,
    route: &ActiveRoute,
    mut response: StandardResponse,
) -> MobileResult<()> {
    proxy_stage("response_binding", ROUTES.assert_current(route))?;
    proxy_stage(
        "response_write",
        write!(
            connection,
            "HTTP/1.1 {} {}\r\n",
            response.status.as_u16(),
            response.status.canonical_reason().unwrap_or("")
        )
        .map_err(|_| route_error("proxyWrite")),
    )?;
    for (name, value) in &response.headers {
        if name.as_str().eq_ignore_ascii_case("connection")
            || name.as_str().eq_ignore_ascii_case("transfer-encoding")
        {
            continue;
        }
        let value = proxy_stage(
            "response_headers",
            value.to_str().map_err(|_| route_error("responseInvalid")),
        )?;
        proxy_stage(
            "response_write",
            write!(connection, "{}: {}\r\n", name.as_str(), value)
                .map_err(|_| route_error("proxyWrite")),
        )?;
    }
    proxy_stage(
        "response_write",
        write!(connection, "Connection: close\r\n\r\n").map_err(|_| route_error("proxyWrite")),
    )?;
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let count = proxy_stage(
            "response_read",
            response
                .body
                .read(&mut buffer)
                .map_err(|_| route_error("standardResponseRead")),
        )?;
        if count == 0 {
            return Ok(());
        }
        proxy_stage("response_binding", ROUTES.assert_current(route))?;
        proxy_stage(
            "response_write",
            connection
                .write_all(&buffer[..count])
                .and_then(|_| connection.flush())
                .map_err(|_| route_error("proxyWrite")),
        )?;
    }
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

fn acceptance_relay_discovery_certificate() -> MobileResult<Option<reqwest::Certificate>> {
    let Some(encoded) = option_env!("PT_ACCEPTANCE_RELAY_CA_DER_B64") else {
        return Ok(None);
    };
    let certificate = STANDARD
        .decode(encoded)
        .map_err(|_| discovery_error("relayTrustAnchorInvalid"))?;
    reqwest::Certificate::from_der(&certificate)
        .map(Some)
        .map_err(|_| discovery_error("relayTrustAnchorInvalid"))
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
            None,
        ));
        assert!(!endpoint_origin_is_valid(
            AccessEndpointRole::DirectStation,
            "https://station.example",
            "https://other.example",
            None,
        ));
        assert!(endpoint_origin_is_valid(
            AccessEndpointRole::Relay,
            "http://relay.example:18081",
            "https://relay.example:18443",
            None,
        ));
        assert!(!endpoint_origin_is_valid(
            AccessEndpointRole::Relay,
            "http://relay.example:18081",
            "http://relay.example:18443",
            None,
        ));
    }

    #[test]
    fn private_connection_material_is_parsed_without_exposing_the_grant() {
        let envelope = StationConnectionEnvelope {
            protocol_version: ACCESS_PROTOCOL_VERSION,
            relay_origin: "https://relay.example:443".to_string(),
            route_attestation: Some(StationRouteAttestation {
                statement_bytes: vec![1],
                node_signature: vec![2],
                node_authorization: None,
            }),
            connection_grant: Some(peer_proto::StationConnectionGrant {
                statement_bytes: StationConnectionGrantStatement {
                    relay_peer_id: "relay-peer".to_string(),
                    ..Default::default()
                }
                .encode_to_vec(),
                node_signature: vec![5],
                node_authorization: None,
            }),
        };
        let encoded = format!("ptc1:{}", URL_SAFE_NO_PAD.encode(envelope.encode_to_vec()));
        let parsed = parse_input(&encoded, false).expect("connection material");
        assert_eq!(parsed.origin, "https://relay.example:443");
        assert!(parsed.connection_grant.is_some());
        assert_eq!(parsed.relay_peer_id.as_deref(), Some("relay-peer"));
    }

    #[test]
    fn proxy_parser_rejects_chunked_requests() {
        assert!(read_http_request_from_bytes(
            b"POST /actor/access/start HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n"
        )
        .is_err());
    }

    #[test]
    fn standard_route_requires_transport_matching_address_and_tls_pin() {
        let mut route = ActiveRoute {
            candidate: StationRouteCandidate {
                station_peer_id: "station-a".to_string(),
                node_peer_id: "node-a".to_string(),
                station_root_public_key: vec![1],
                node_authorization_digest: vec![2; 32],
                authorization_epoch: 1,
                route_id: "route-a".to_string(),
                route_type: StationRouteType::Relay,
                transport: "libp2p_http_v1".to_string(),
                endpoint_origin: "https://relay.example:443".to_string(),
                relay_peer_id: Some("relay-a".to_string()),
                route_generation: 1,
                inner_tls_spki_sha256: Some(vec![3; 32]),
                addresses: vec![
                    "/dns4/relay.example/tcp/4001/p2p/relay-a/p2p-circuit/p2p/node-a".to_string(),
                ],
                attestation_bytes: Some(vec![4]),
                attestation_expires_at_unix_ms: None,
                source_ref: "source-a".to_string(),
            },
            route_revision: 1,
        };
        assert!(standard_route(&route).is_ok());
        route.candidate.transport = "unsupported_transport".to_string();
        assert!(standard_route(&route).is_err());
        route.candidate.transport = "libp2p_http_v1".to_string();
        route.candidate.addresses.clear();
        assert!(standard_route(&route).is_err());
        route
            .candidate
            .addresses
            .push("/dns4/relay.example/tcp/4001/p2p/relay-a/p2p-circuit/p2p/node-a".to_string());
        route.candidate.inner_tls_spki_sha256 = None;
        assert!(standard_route(&route).is_err());

        route.candidate.route_type = StationRouteType::Direct;
        route.candidate.relay_peer_id = None;
        route.candidate.inner_tls_spki_sha256 = Some(vec![3; 32]);
        route.candidate.addresses = vec!["/dns4/station.example/tcp/4001/p2p/node-a".to_string()];
        assert!(standard_route(&route).is_ok());
        route.candidate.addresses =
            vec!["/dns4/relay.example/tcp/4001/p2p/relay-a/p2p-circuit/p2p/node-a".to_string()];
        assert!(standard_route(&route).is_err());
    }

    #[test]
    fn expired_route_renews_exact_binding_without_changing_revision() {
        let (runtime, original) = expired_route_runtime();
        let refreshed = runtime
            .renew_route_with(None, |source| {
                assert_eq!(source, "https://station.example");
                let mut candidate = original.candidate.clone();
                candidate.attestation_expires_at_unix_ms = Some(i64::MAX);
                candidate.attestation_bytes = Some(vec![8]);
                Ok(route_discovery(candidate))
            })
            .unwrap();
        assert_eq!(refreshed.route_revision, original.route_revision);
        assert_eq!(refreshed.candidate.route_id, original.candidate.route_id);
        assert_eq!(refreshed.candidate.attestation_bytes, Some(vec![8]));
        assert_eq!(runtime.active_snapshot().unwrap(), refreshed);
        assert!(runtime
            .renew_route_with(None, |_| panic!("fresh route rediscovered"))
            .is_ok());
    }

    #[test]
    fn route_renews_inside_the_frontend_preexpiry_window() {
        let (runtime, original) = expired_route_runtime();
        let mut near = original.candidate.clone();
        near.attestation_expires_at_unix_ms = Some(unix_ms() as i64 + 30_000);
        runtime.register(&route_discovery(near.clone())).unwrap();
        runtime.active.write().unwrap().as_mut().unwrap().candidate = near;
        let refreshed = runtime
            .renew_route_with(None, |_| {
                let mut candidate = original.candidate.clone();
                candidate.attestation_expires_at_unix_ms = Some(i64::MAX);
                candidate.attestation_bytes = Some(vec![8]);
                Ok(route_discovery(candidate))
            })
            .unwrap();
        assert_eq!(refreshed.candidate.attestation_bytes, Some(vec![8]));
        assert_eq!(refreshed.route_revision, original.route_revision);
    }

    #[test]
    fn concurrent_route_renewal_reuses_one_verified_result() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::{mpsc, Arc, Barrier};

        let (runtime, original) = expired_route_runtime();
        let runtime = Arc::new(runtime);
        let calls = Arc::new(AtomicUsize::new(0));
        let start = Arc::new(Barrier::new(3));
        let (sender, receiver) = mpsc::channel();
        let mut workers = Vec::new();
        for _ in 0..2 {
            let runtime = runtime.clone();
            let calls = calls.clone();
            let start = start.clone();
            let sender = sender.clone();
            let mut candidate = original.candidate.clone();
            candidate.attestation_expires_at_unix_ms = Some(i64::MAX);
            candidate.attestation_bytes = Some(vec![8]);
            workers.push(std::thread::spawn(move || {
                start.wait();
                let result = runtime.renew_route_with(None, |_| {
                    calls.fetch_add(1, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(30));
                    Ok(route_discovery(candidate))
                });
                sender.send(result).unwrap();
            }));
        }
        start.wait();
        let first = receiver
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        let second = receiver
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(first, second);
        assert_eq!(first.route_revision, original.route_revision);
        for worker in workers {
            worker.join().unwrap();
        }
    }

    #[test]
    fn route_refresh_validates_expected_selection_before_discovery() {
        let (runtime, original) = expired_route_runtime();
        for mutation in 0..3 {
            let mut expected = StationRouteSelectionInput {
                station_peer_id: original.candidate.station_peer_id.clone(),
                route_id: original.candidate.route_id.clone(),
                route_revision: original.route_revision,
            };
            match mutation {
                0 => expected.station_peer_id = "other-station".to_string(),
                1 => expected.route_id = "other-route".to_string(),
                _ => expected.route_revision += 1,
            }
            assert!(runtime
                .renew_route_with(Some(&expected), |_| panic!("stale selection rediscovered"))
                .is_err());
        }
        assert_eq!(runtime.active_snapshot().unwrap(), original);
    }

    #[test]
    fn route_renewal_does_not_revive_a_removed_route_or_extend_failed_proof() {
        let (runtime, original) = expired_route_runtime();
        assert!(runtime
            .renew_route_with(None, |_| Err(discovery_error("endpointUnavailable")))
            .is_err());
        assert_eq!(runtime.active_snapshot().unwrap(), original);
        assert!(runtime
            .renew_route_with(None, |_| {
                runtime.remove(
                    &original.candidate.station_peer_id,
                    &original.candidate.route_id,
                )?;
                let mut candidate = original.candidate.clone();
                candidate.attestation_expires_at_unix_ms = Some(i64::MAX);
                Ok(route_discovery(candidate))
            })
            .is_err());
        assert!(runtime.active_snapshot().is_err());
        assert!(runtime
            .cached(
                &original.candidate.station_peer_id,
                &original.candidate.route_id
            )
            .is_err());
    }

    #[test]
    fn expired_route_accepts_monotonic_authorization_rotation() {
        let (runtime, original) = expired_route_runtime();
        let refreshed = runtime
            .renew_route_with(None, |_| {
                let mut candidate = original.candidate.clone();
                candidate.authorization_epoch += 1;
                candidate.route_generation += 1;
                candidate.node_authorization_digest = vec![9; 32];
                candidate.attestation_expires_at_unix_ms = Some(i64::MAX);
                candidate.attestation_bytes = Some(vec![8]);
                Ok(route_discovery(candidate))
            })
            .unwrap();
        assert_eq!(
            refreshed.candidate.authorization_epoch,
            original.candidate.authorization_epoch + 1
        );
        assert_eq!(
            refreshed.candidate.route_generation,
            original.candidate.route_generation + 1
        );
        assert_eq!(refreshed.route_revision, original.route_revision);
    }

    #[test]
    fn route_renewal_rejects_revocation_and_concurrent_selection() {
        for mutation in 0..12 {
            let (runtime, original) = expired_route_runtime();
            let result = runtime.renew_route_with(None, |_| {
                let mut candidate = original.candidate.clone();
                candidate.attestation_expires_at_unix_ms = Some(i64::MAX);
                match mutation {
                    0 => candidate.route_generation -= 1,
                    1 => candidate.station_peer_id = "other-station".to_string(),
                    2 => candidate.node_peer_id = "other-node".to_string(),
                    3 => candidate.endpoint_origin = "https://other.example".to_string(),
                    4 => candidate.authorization_epoch -= 1,
                    5 => candidate.station_root_public_key = vec![9],
                    6 => {
                        runtime
                            .active
                            .write()
                            .unwrap()
                            .as_mut()
                            .unwrap()
                            .route_revision += 1
                    }
                    7 => candidate.route_id = "other-route".to_string(),
                    8 => candidate.transport = "unsupported".to_string(),
                    9 => candidate.relay_peer_id = Some("other-relay".to_string()),
                    10 => candidate.source_ref = "other-source".to_string(),
                    _ => {
                        let mut other = candidate.clone();
                        other.authorization_epoch += 1;
                        runtime.register(&route_discovery(other)).unwrap();
                    }
                }
                Ok(route_discovery(candidate))
            });
            assert!(result.is_err(), "renewal accepted mutation {mutation}");
            assert_eq!(
                runtime
                    .active_snapshot()
                    .unwrap()
                    .candidate
                    .attestation_expires_at_unix_ms,
                Some(1)
            );
        }
    }

    fn route_discovery(candidate: StationRouteCandidate) -> VerifiedDiscovery {
        VerifiedDiscovery {
            projection: StationEndpointDiscovery {
                role: VerifiedEndpointRole::DirectStation,
                endpoint_peer_id: candidate.station_peer_id.clone(),
                canonical_origin: candidate.endpoint_origin.clone(),
                routes: vec![candidate],
            },
            source_input: "https://station.example".to_string(),
        }
    }

    fn expired_route_runtime() -> (RouteRuntime, ActiveRoute) {
        let candidate = StationRouteCandidate {
            station_peer_id: "station-a".to_string(),
            node_peer_id: "node-a".to_string(),
            station_root_public_key: vec![1],
            node_authorization_digest: vec![2; 32],
            authorization_epoch: 2,
            route_id: "direct-a".to_string(),
            route_type: StationRouteType::Direct,
            transport: "libp2p_http_v1".to_string(),
            endpoint_origin: "https://station.example".to_string(),
            relay_peer_id: None,
            route_generation: 2,
            inner_tls_spki_sha256: Some(vec![3; 32]),
            addresses: vec!["/dns4/station.example/tcp/4001/p2p/node-a".to_string()],
            attestation_bytes: Some(vec![4]),
            attestation_expires_at_unix_ms: Some(1),
            source_ref: "source-a".to_string(),
        };
        let runtime = RouteRuntime::default();
        runtime
            .register(&route_discovery(candidate.clone()))
            .unwrap();
        let active = ActiveRoute {
            candidate,
            route_revision: 7,
        };
        *runtime.active.write().unwrap() = Some(active.clone());
        (runtime, active)
    }

    #[test]
    fn failed_standard_route_activates_verified_alternate() {
        let runtime = RouteRuntime::default();
        let direct = StationRouteCandidate {
            station_peer_id: "station-a".to_string(),
            node_peer_id: "node-b".to_string(),
            station_root_public_key: vec![1],
            node_authorization_digest: vec![3; 32],
            authorization_epoch: 1,
            route_id: "direct-b".to_string(),
            route_type: StationRouteType::Direct,
            transport: "libp2p_http_v1".to_string(),
            endpoint_origin: "https://station.example".to_string(),
            relay_peer_id: None,
            route_generation: 1,
            inner_tls_spki_sha256: Some(vec![4; 32]),
            addresses: vec!["/dns4/station.example/tcp/4001/p2p/node-b".to_string()],
            attestation_bytes: Some(vec![4]),
            attestation_expires_at_unix_ms: Some(i64::MAX),
            source_ref: "source-b".to_string(),
        };
        let mut relay = direct.clone();
        relay.node_peer_id = "node-a".to_string();
        relay.node_authorization_digest = vec![2; 32];
        relay.route_id = "relay-a".to_string();
        relay.route_type = StationRouteType::Relay;
        relay.transport = "libp2p_http_v1".to_string();
        relay.endpoint_origin = "https://relay.example".to_string();
        relay.relay_peer_id = Some("relay-a".to_string());
        relay.inner_tls_spki_sha256 = Some(vec![4; 32]);
        relay.addresses = vec!["/p2p/relay-a/p2p-circuit/p2p/node-a".to_string()];
        let failed = ActiveRoute {
            candidate: relay.clone(),
            route_revision: 7,
        };
        {
            let mut discovered = runtime.discovered.write().unwrap();
            for candidate in [relay, direct.clone()] {
                discovered.insert(
                    (
                        candidate.station_peer_id.clone(),
                        candidate.route_id.clone(),
                    ),
                    CachedRoute {
                        candidate,
                        source_input: "source".to_string(),
                    },
                );
            }
        }
        *runtime.active.write().unwrap() = Some(failed.clone());

        let alternate = runtime.activate_alternate(&failed).unwrap();
        assert_eq!(alternate.candidate.route_id, direct.route_id);
        assert_eq!(alternate.route_revision, 8);
        assert_eq!(
            runtime.active_snapshot().unwrap().candidate.route_type,
            StationRouteType::Direct
        );
    }

    #[test]
    fn automatic_failover_never_replays_mutating_requests() {
        assert!(request_allows_automatic_failover(
            b"GET /conversation HTTP/1.1\r\nHost: station\r\n\r\n"
        ));
        assert!(!request_allows_automatic_failover(
            b"POST /conversation HTTP/1.1\r\nHost: station\r\nContent-Length: 2\r\n\r\n{}"
        ));
    }

    #[test]
    fn direct_and_circuit_share_one_standard_data_plane() {
        let production = include_str!("station_route.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("production route source");

        assert!(!production.contains("direct_https"));
        assert!(!production.contains("forward_direct"));
        assert!(production.contains("open_standard_response(&route, &request)"));
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
