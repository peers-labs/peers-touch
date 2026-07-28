// Federation gateway — Desktop ↔ Station.
//
// Wraps the four proto-first federation endpoints exposed by Station
// after Phase E.bridge:
//
//   GET  /actor/federation/me         → FederationSelfView
//   PUT  /actor/federation/visibility → FederationSelfView (echo)
//   GET  /actor/federation/resolve    → FederationResolveView
//   GET  /actor/federation/health     → FederationHealthView   (public)
//
// Layer responsibilities:
//
//   • application/federation: choose endpoint, validate inputs, classify
//     errors, return typed proto messages. No Tauri / serialization
//     concerns.
//   • interface/tauri_commands/federation: AppResult shaping, encode the
//     proto into Vec<u8> for the Tauri bridge, surface auth state.
//
// All four endpoints speak `application/protobuf` end-to-end; there is
// no JSON fallback on the Desktop path. JSON remains available on the
// Station side for curl / monitoring (Phase E.bridge content
// negotiation).

use prost::Message;
use reqwest::Method;

use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model::federation::v1::{
    CreateFederationRequest, CreateFederationResponse, FederationCatalogSearchRequest,
    FederationCatalogSearchResponse, FederationHealthView, FederationResolveView,
    FederationSelfView, FederationVisibilityRequest, JoinFederationRequest,
    JoinFederationResponse, LeaveFederationRequest, LeaveFederationResponse,
    ListFederationsResponse, ListMemberStationsResponse,
};

const ROUTE_ME: &str = "/actor/federation/me";
const ROUTE_VISIBILITY: &str = "/actor/federation/visibility";
const ROUTE_RESOLVE: &str = "/actor/federation/resolve";
const ROUTE_HEALTH: &str = "/actor/federation/health";
const ROUTE_CATALOG_SEARCH: &str = "/sub-federation/catalog/search";
const ROUTE_LIST_FEDERATIONS: &str = "/sub-federation/federations";
const ROUTE_CREATE_FEDERATION: &str = "/sub-federation/federations";
const ROUTE_JOIN_FEDERATION: &str = "/sub-federation/federations/join";

/// GET /actor/federation/me — authenticated.
pub fn get_self(token: &str) -> Result<FederationSelfView, station_client::StationClientError> {
    station_client::request_peers_proto_no_body::<FederationSelfView>(
        Method::GET,
        ROUTE_ME,
        token,
        None,
    )
}

/// PUT /actor/federation/visibility — authenticated.
///
/// `label` is the wire-vocabulary visibility label
/// ("hidden" | "by_handle" | "indexed"). The Desktop layer is
/// responsible for ensuring the label is non-empty before reaching
/// here; we still defensively short-circuit so a buggy caller does not
/// hit Station with garbage.
pub fn set_visibility(
    token: &str,
    label: &str,
) -> Result<FederationSelfView, FederationGatewayError> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return Err(FederationGatewayError::InvalidArgument(
            "visibility label is required",
        ));
    }
    let body = FederationVisibilityRequest {
        visibility: trimmed.to_string(),
    };
    station_client::request_peers_proto::<FederationVisibilityRequest, FederationSelfView>(
        Method::PUT,
        ROUTE_VISIBILITY,
        token,
        None,
        Some(&body),
    )
    .map_err(FederationGatewayError::Station)
}

/// GET /actor/federation/resolve?handle=… — authenticated.
pub fn resolve(token: &str, handle: &str) -> Result<FederationResolveView, FederationGatewayError> {
    let trimmed = handle.trim();
    if trimmed.is_empty() {
        return Err(FederationGatewayError::InvalidArgument(
            "handle is required",
        ));
    }
    let query = vec![("handle", trimmed.to_string())];
    station_client::request_peers_proto_no_body::<FederationResolveView>(
        Method::GET,
        ROUTE_RESOLVE,
        token,
        Some(&query),
    )
    .map_err(FederationGatewayError::Station)
}

/// GET /actor/federation/health — public (no JWT required by Station).
///
/// We still hit `request_peers_proto_no_body` with an empty bearer; the
/// Station side does not enforce auth on this route. Keeping the same
/// helper means we get content-type negotiation and `PeersResponse`
/// envelope decoding for free.
pub fn health() -> Result<FederationHealthView, station_client::StationClientError> {
    station_client::request_peers_proto_no_body::<FederationHealthView>(
        Method::GET,
        ROUTE_HEALTH,
        "",
        None,
    )
}

/// Errors that can arise on the federation gateway. Wraps station-side
/// transport errors and surfaces input-validation problems separately
/// so the Tauri command can map them to the right `ErrorCode` without
/// re-parsing strings.
#[derive(Debug)]
pub enum FederationGatewayError {
    /// Caller-side validation failure (empty handle, empty visibility).
    InvalidArgument(&'static str),
    /// Anything bubbling up from `station_client` — network, decode,
    /// HTTP status. Already carries the typed `ErrorResponse` payload
    /// from Station when the Station layer chose to emit one.
    Station(station_client::StationClientError),
}

impl FederationGatewayError {
    pub fn into_app_result_proto(self, context: &str) -> AppResult<Vec<u8>> {
        match self {
            FederationGatewayError::InvalidArgument(msg) => {
                AppResult::fail(ErrorCode::InvalidArgument, msg, None)
            }
            FederationGatewayError::Station(e) => e.into_app_result(context),
        }
    }
}

/// Convenience: encode a typed `FederationSelfView` to bytes (for the
/// Tauri bridge). Centralised so the Tauri shim stays trivial.
pub fn encode_self(view: &FederationSelfView) -> Vec<u8> {
    view.encode_to_vec()
}

pub fn encode_resolve(view: &FederationResolveView) -> Vec<u8> {
    view.encode_to_vec()
}

pub fn encode_health(view: &FederationHealthView) -> Vec<u8> {
    view.encode_to_vec()
}

/// POST /sub-federation/catalog/search — authenticated.
pub fn catalog_search(
    token: &str,
    federation_id: &str,
    prefix: &str,
    station_id: Option<&str>,
    page_size: Option<u32>,
) -> Result<FederationCatalogSearchResponse, FederationGatewayError> {
    if federation_id.trim().is_empty() {
        return Err(FederationGatewayError::InvalidArgument(
            "federation_id is required",
        ));
    }
    if prefix.trim().is_empty() {
        return Err(FederationGatewayError::InvalidArgument(
            "prefix is required",
        ));
    }
    let body = FederationCatalogSearchRequest {
        federation_id: federation_id.to_string(),
        prefix: prefix.to_string(),
        station_id: station_id.unwrap_or_default().to_string(),
        page_size: page_size.unwrap_or(20),
        ..Default::default()
    };
    station_client::request_peers_proto::<FederationCatalogSearchRequest, FederationCatalogSearchResponse>(
        Method::POST,
        ROUTE_CATALOG_SEARCH,
        token,
        None,
        Some(&body),
    )
    .map_err(FederationGatewayError::Station)
}

pub fn encode_catalog_search(view: &FederationCatalogSearchResponse) -> Vec<u8> {
    view.encode_to_vec()
}

// ─── Federation Lifecycle (Governance Subserver) ────────────────────────────

/// GET /sub-federation/federations — list all federations this station belongs to.
pub fn list_federations(
    token: &str,
) -> Result<ListFederationsResponse, station_client::StationClientError> {
    station_client::request_proto::<(), ListFederationsResponse>(
        Method::GET,
        ROUTE_LIST_FEDERATIONS,
        token,
        None,
        None::<&()>,
    )
}

/// POST /sub-federation/federations — create a new federation (this station becomes sequencer).
pub fn create_federation(
    token: &str,
    name: &str,
    description: &str,
    policy_type: &str,
) -> Result<CreateFederationResponse, FederationGatewayError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(FederationGatewayError::InvalidArgument("name is required"));
    }
    let body = CreateFederationRequest {
        name: name.to_string(),
        description: description.trim().to_string(),
        policy_type: if policy_type.is_empty() {
            "single_admin".to_string()
        } else {
            policy_type.to_string()
        },
    };
    station_client::request_proto::<CreateFederationRequest, CreateFederationResponse>(
        Method::POST,
        ROUTE_CREATE_FEDERATION,
        token,
        None,
        Some(&body),
    )
    .map_err(FederationGatewayError::Station)
}

/// POST /sub-federation/federations/join — request to join an existing federation.
pub fn join_federation(
    token: &str,
    federation_endpoint: &str,
    federation_id: &str,
    message: &str,
) -> Result<JoinFederationResponse, FederationGatewayError> {
    if federation_id.trim().is_empty() && federation_endpoint.trim().is_empty() {
        return Err(FederationGatewayError::InvalidArgument(
            "federation_id or federation_endpoint is required",
        ));
    }
    let body = JoinFederationRequest {
        federation_endpoint: federation_endpoint.trim().to_string(),
        federation_id: federation_id.trim().to_string(),
        message: message.to_string(),
    };
    station_client::request_proto::<JoinFederationRequest, JoinFederationResponse>(
        Method::POST,
        ROUTE_JOIN_FEDERATION,
        token,
        None,
        Some(&body),
    )
    .map_err(FederationGatewayError::Station)
}

/// POST /sub-federation/federations/:federation_id/leave — leave a federation.
pub fn leave_federation(
    token: &str,
    federation_id: &str,
    reason: &str,
) -> Result<LeaveFederationResponse, FederationGatewayError> {
    let fid = federation_id.trim();
    if fid.is_empty() {
        return Err(FederationGatewayError::InvalidArgument(
            "federation_id is required",
        ));
    }
    let route = format!("/sub-federation/federations/{}/leave", fid);
    let body = LeaveFederationRequest {
        federation_id: fid.to_string(),
        reason: reason.to_string(),
    };
    station_client::request_proto::<LeaveFederationRequest, LeaveFederationResponse>(
        Method::POST,
        &route,
        token,
        None,
        Some(&body),
    )
    .map_err(FederationGatewayError::Station)
}

/// GET /sub-federation/federations/:federation_id/stations — list member stations.
pub fn list_member_stations(
    token: &str,
    federation_id: &str,
) -> Result<ListMemberStationsResponse, FederationGatewayError> {
    let fid = federation_id.trim();
    if fid.is_empty() {
        return Err(FederationGatewayError::InvalidArgument(
            "federation_id is required",
        ));
    }
    let route = format!("/sub-federation/federations/{}/stations", fid);
    station_client::request_proto::<(), ListMemberStationsResponse>(
        Method::GET,
        &route,
        token,
        None,
        None::<&()>,
    )
    .map_err(FederationGatewayError::Station)
}

pub fn encode_list_federations(view: &ListFederationsResponse) -> Vec<u8> {
    view.encode_to_vec()
}

pub fn encode_create_federation(view: &CreateFederationResponse) -> Vec<u8> {
    view.encode_to_vec()
}

pub fn encode_join_federation(view: &JoinFederationResponse) -> Vec<u8> {
    view.encode_to_vec()
}

pub fn encode_leave_federation(view: &LeaveFederationResponse) -> Vec<u8> {
    view.encode_to_vec()
}

pub fn encode_list_member_stations(view: &ListMemberStationsResponse) -> Vec<u8> {
    view.encode_to_vec()
}
