// Federation gateway — Desktop ↔ Station.
//
// Wraps the read-only Federation context and discovery endpoints exposed by Station.
// Actor identity and discoverability are owned by /actor/profile.
//
// Layer responsibilities:
//
//   • application/federation: choose endpoint, validate inputs, classify
//     errors, return typed proto messages. No Tauri / serialization
//     concerns.
//   • interface/tauri_commands/federation: AppResult shaping, encode the
//     proto into Vec<u8> for the Tauri bridge, surface auth state.
//
// All endpoints speak `application/protobuf` end-to-end; there is
// no JSON fallback on the Desktop path. JSON remains available on the
// Station side for curl / monitoring (Phase E.bridge content
// negotiation).

use prost::Message;
use reqwest::Method;

use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model::federation::v1::{
    FederationCatalogSearchRequest, FederationCatalogSearchResponse, FederationResolveView,
    ListFederationContextsResponse,
};

const ROUTE_RESOLVE: &str = "/actor/federation/resolve";
const ROUTE_CATALOG_SEARCH: &str = "/sub-federation/catalog/search";
const ROUTE_LIST_CONTEXTS: &str = "/sub-federation/contexts";

/// GET /actor/federation/resolve?federation_id=…&handle=… — authenticated.
pub fn resolve(
    token: &str,
    federation_id: &str,
    handle: &str,
) -> Result<FederationResolveView, FederationGatewayError> {
    let federation_id = federation_id.trim();
    if federation_id.is_empty() {
        return Err(FederationGatewayError::InvalidArgument(
            "federation_id is required",
        ));
    }
    let trimmed = handle.trim();
    if trimmed.is_empty() {
        return Err(FederationGatewayError::InvalidArgument(
            "handle is required",
        ));
    }
    let query = vec![
        ("federation_id", federation_id.to_string()),
        ("handle", trimmed.to_string()),
    ];
    station_client::request_proto::<(), FederationResolveView>(
        Method::GET,
        ROUTE_RESOLVE,
        token,
        Some(&query),
        None,
    )
    .map_err(FederationGatewayError::Station)
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

pub fn encode_resolve(view: &FederationResolveView) -> Vec<u8> {
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
    station_client::request_proto::<
        FederationCatalogSearchRequest,
        FederationCatalogSearchResponse,
    >(Method::POST, ROUTE_CATALOG_SEARCH, token, None, Some(&body))
    .map_err(FederationGatewayError::Station)
}

pub fn encode_catalog_search(view: &FederationCatalogSearchResponse) -> Vec<u8> {
    view.encode_to_vec()
}

/// GET /sub-federation/contexts — list actor-visible Federation contexts.
pub fn list_contexts(
    token: &str,
) -> Result<ListFederationContextsResponse, station_client::StationClientError> {
    station_client::request_proto::<(), ListFederationContextsResponse>(
        Method::GET,
        ROUTE_LIST_CONTEXTS,
        token,
        None,
        None::<&()>,
    )
}

pub fn encode_list_contexts(view: &ListFederationContextsResponse) -> Vec<u8> {
    view.encode_to_vec()
}
