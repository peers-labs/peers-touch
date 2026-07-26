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
    FederationCatalogSearchRequest, FederationCatalogSearchResponse, FederationHealthView,
    FederationResolveView, FederationSelfView, FederationVisibilityRequest,
};

const ROUTE_ME: &str = "/actor/federation/me";
const ROUTE_VISIBILITY: &str = "/actor/federation/visibility";
const ROUTE_RESOLVE: &str = "/actor/federation/resolve";
const ROUTE_HEALTH: &str = "/actor/federation/health";
const ROUTE_CATALOG_SEARCH: &str = "/sub-federation/catalog/search";

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
