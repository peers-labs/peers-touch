use super::client::{
    ReplayPolicy, StationClient, StationClientError, StationClientErrorKind, StationRequest,
    StationRequestBody, StationRequestScope, StationResponse, TrafficClass,
};
use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::Method;
use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use ulid::Ulid;

const MAX_PROJECTED_RESOURCES: usize = 4096;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct StationResourceRef {
    station_peer_id: String,
    lifecycle_generation: u64,
    path_and_query: String,
    content_identity: Option<String>,
}

impl StationResourceRef {
    pub fn new(
        station_peer_id: impl Into<String>,
        lifecycle_generation: u64,
        path_and_query: impl Into<String>,
        content_identity: Option<String>,
    ) -> Result<Self, ResourceProjectionError> {
        let station_peer_id = station_peer_id.into();
        let path_and_query = path_and_query.into();
        if station_peer_id.trim().is_empty() || lifecycle_generation == 0 {
            return Err(ResourceProjectionError::InvalidScope);
        }
        if !path_and_query.starts_with('/')
            || path_and_query.starts_with("//")
            || reqwest::Url::parse(&path_and_query).is_ok()
        {
            return Err(ResourceProjectionError::InvalidReference);
        }
        Ok(Self {
            station_peer_id,
            lifecycle_generation,
            path_and_query,
            content_identity,
        })
    }

    pub fn station_peer_id(&self) -> &str {
        &self.station_peer_id
    }

    pub fn lifecycle_generation(&self) -> u64 {
        self.lifecycle_generation
    }

    pub fn path_and_query(&self) -> &str {
        &self.path_and_query
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExternalResourceUrl(String);

impl ExternalResourceUrl {
    pub fn parse(value: impl Into<String>) -> Result<Self, ResourceProjectionError> {
        let value = value.into();
        let url =
            reqwest::Url::parse(&value).map_err(|_| ResourceProjectionError::InvalidExternalUrl)?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err(ResourceProjectionError::InvalidExternalUrl);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppLocalResourceUri(String);

impl AppLocalResourceUri {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ResourceReference {
    Station(StationResourceRef),
    External(ExternalResourceUrl),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ResourceProjectionError {
    InvalidScope,
    InvalidReference,
    InvalidExternalUrl,
    StaleScope,
    UnknownProjection,
    ProjectionLock,
}

impl fmt::Display for ResourceProjectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidScope => "Station resource scope is invalid",
            Self::InvalidReference => "Station resource reference is invalid",
            Self::InvalidExternalUrl => "external resource URL is invalid",
            Self::StaleScope => "Station resource belongs to a stale lifecycle",
            Self::UnknownProjection => "Station resource projection is unavailable",
            Self::ProjectionLock => "Station resource projection lock is unavailable",
        })
    }
}

impl std::error::Error for ResourceProjectionError {}

#[derive(Default)]
struct ResourceProjectionState {
    entries: HashMap<String, StationResourceRef>,
    order: VecDeque<String>,
}

#[derive(Default)]
struct ResourceProjector {
    state: Mutex<ResourceProjectionState>,
}

impl ResourceProjector {
    pub fn project(
        &self,
        resource: StationResourceRef,
        current_station_peer_id: &str,
        current_lifecycle_generation: u64,
    ) -> Result<AppLocalResourceUri, ResourceProjectionError> {
        assert_current_scope(
            &resource,
            current_station_peer_id,
            current_lifecycle_generation,
        )?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| ResourceProjectionError::ProjectionLock)?;
        if let Some((token, _)) = state
            .entries
            .iter()
            .find(|(_, projected)| **projected == resource)
        {
            return Ok(AppLocalResourceUri(format!(
                "station-resource://local/{token}"
            )));
        }
        while state.entries.len() >= MAX_PROJECTED_RESOURCES {
            let Some(expired) = state.order.pop_front() else {
                break;
            };
            state.entries.remove(&expired);
        }
        let token = Ulid::new().to_string();
        state.entries.insert(token.clone(), resource);
        state.order.push_back(token.clone());
        Ok(AppLocalResourceUri(format!(
            "station-resource://local/{token}"
        )))
    }

    pub fn resolve(
        &self,
        uri: &str,
        current_station_peer_id: &str,
        current_lifecycle_generation: u64,
    ) -> Result<StationResourceRef, ResourceProjectionError> {
        let token = uri
            .strip_prefix("station-resource://local/")
            .filter(|token| {
                token
                    .parse::<Ulid>()
                    .is_ok_and(|value| value.to_string() == *token)
            })
            .ok_or(ResourceProjectionError::UnknownProjection)?;
        let resource = self
            .state
            .lock()
            .map_err(|_| ResourceProjectionError::ProjectionLock)?
            .entries
            .get(token)
            .cloned()
            .ok_or(ResourceProjectionError::UnknownProjection)?;
        assert_current_scope(
            &resource,
            current_station_peer_id,
            current_lifecycle_generation,
        )?;
        Ok(resource)
    }

    pub fn revoke_scope(&self, station_peer_id: &str, lifecycle_generation: u64) {
        if let Ok(mut state) = self.state.lock() {
            state.entries.retain(|_, resource| {
                resource.station_peer_id != station_peer_id
                    || resource.lifecycle_generation != lifecycle_generation
            });
            let retained = state
                .entries
                .keys()
                .cloned()
                .collect::<std::collections::HashSet<_>>();
            state.order.retain(|token| retained.contains(token));
        }
    }

    pub fn clear(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.entries.clear();
            state.order.clear();
        }
    }
}

#[derive(Clone)]
pub struct StationResourceHandle {
    client: StationClient,
    projector: Arc<ResourceProjector>,
}

impl StationResourceHandle {
    pub(crate) fn new(client: StationClient) -> Self {
        Self {
            client,
            projector: Arc::new(ResourceProjector::default()),
        }
    }

    pub fn client(&self) -> &StationClient {
        &self.client
    }

    pub fn reference(
        &self,
        value: impl Into<String>,
        content_identity: Option<String>,
    ) -> Result<ResourceReference, ResourceProjectionError> {
        let value = value.into();
        if value.starts_with("station-resource://local/") {
            return self.resolve(&value).map(ResourceReference::Station);
        }
        if value.starts_with('/') {
            let scope = self.active_scope()?;
            return StationResourceRef::new(
                scope.station_peer_id,
                scope.lifecycle_generation,
                value,
                content_identity,
            )
            .map(ResourceReference::Station);
        }
        ExternalResourceUrl::parse(value).map(ResourceReference::External)
    }

    pub fn project_reference(
        &self,
        value: impl Into<String>,
        content_identity: Option<String>,
    ) -> Result<String, ResourceProjectionError> {
        match self.reference(value, content_identity)? {
            ResourceReference::Station(resource) => {
                self.project(resource).map(|uri| uri.as_str().to_string())
            }
            ResourceReference::External(url) => Ok(url.as_str().to_string()),
        }
    }

    pub fn project(
        &self,
        resource: StationResourceRef,
    ) -> Result<AppLocalResourceUri, ResourceProjectionError> {
        let scope = self.active_scope()?;
        self.projector
            .project(resource, &scope.station_peer_id, scope.lifecycle_generation)
    }

    pub fn resolve(&self, uri: &str) -> Result<StationResourceRef, ResourceProjectionError> {
        let scope = self.active_scope()?;
        self.projector
            .resolve(uri, &scope.station_peer_id, scope.lifecycle_generation)
    }

    pub fn open(
        &self,
        resource: &StationResourceRef,
        token: Option<&str>,
    ) -> Result<StationResponse, StationClientError> {
        let scope = self.active_scope().map_err(resource_scope_error)?;
        if resource.station_peer_id() != scope.station_peer_id
            || resource.lifecycle_generation() != scope.lifecycle_generation
        {
            return Err(StationClientError::new(
                StationClientErrorKind::StaleRoute,
                "Station resource belongs to a stale lifecycle",
                None,
            ));
        }
        let mut headers = HeaderMap::new();
        if let Some(token) = token.filter(|value| !value.trim().is_empty()) {
            headers.insert(
                reqwest::header::AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {token}")).map_err(|error| {
                    StationClientError::new(
                        StationClientErrorKind::InvalidResponse,
                        format!("invalid resource authorization: {error}"),
                        None,
                    )
                })?,
            );
        }
        self.client.execute_raw(StationRequest {
            method: Method::GET,
            path_and_query: resource.path_and_query().to_string(),
            headers,
            body: StationRequestBody::Empty,
            timeout: Duration::from_secs(305),
            traffic_class: TrafficClass::Bulk,
            replay_policy: ReplayPolicy::SafeRead,
            cancellation: CancellationToken::new(),
            expected_scope: Some(scope),
        })
    }

    pub fn fetch_bytes(
        &self,
        resource: &StationResourceRef,
        token: Option<&str>,
    ) -> Result<(Vec<u8>, HeaderMap), StationClientError> {
        let mut response = self.open(resource, token)?;
        let status = response.status;
        let response_headers = response.headers.clone();
        let mut body = Vec::new();
        response.body.read_to_end(&mut body).map_err(|error| {
            StationClientError::new(
                StationClientErrorKind::Decode,
                format!("read Station resource: {error}"),
                None,
            )
        })?;
        if !(200..300).contains(&status) {
            return Err(StationClientError::new(
                StationClientErrorKind::HttpStatus(status),
                format!("Station resource returned {status}"),
                Some(serde_json::json!({
                    "status": status,
                    "body": String::from_utf8_lossy(&body),
                })),
            ));
        }
        Ok((body, response_headers))
    }

    pub(crate) fn revoke_scope(&self, station_peer_id: &str, lifecycle_generation: u64) {
        self.projector
            .revoke_scope(station_peer_id, lifecycle_generation);
    }

    pub(crate) fn clear(&self) {
        self.projector.clear();
    }

    fn active_scope(&self) -> Result<StationRequestScope, ResourceProjectionError> {
        self.client
            .active_scope()
            .filter(|scope| {
                !scope.station_peer_id.trim().is_empty() && scope.lifecycle_generation > 0
            })
            .ok_or(ResourceProjectionError::InvalidScope)
    }
}

fn resource_scope_error(error: ResourceProjectionError) -> StationClientError {
    StationClientError::new(StationClientErrorKind::StaleRoute, error.to_string(), None)
}

fn assert_current_scope(
    resource: &StationResourceRef,
    current_station_peer_id: &str,
    current_lifecycle_generation: u64,
) -> Result<(), ResourceProjectionError> {
    if resource.station_peer_id != current_station_peer_id
        || resource.lifecycle_generation != current_lifecycle_generation
    {
        return Err(ResourceProjectionError::StaleScope);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::station_runtime::client::{
        StationRequestExecutor, StationTransportError,
    };
    use std::io::Cursor;

    struct RecordingExecutor {
        scope: Mutex<StationRequestScope>,
        requests: Mutex<Vec<(String, Option<StationRequestScope>)>>,
    }

    impl RecordingExecutor {
        fn new(scope: StationRequestScope) -> Self {
            Self {
                scope: Mutex::new(scope),
                requests: Mutex::new(Vec::new()),
            }
        }

        fn set_scope(&self, scope: StationRequestScope) {
            *self.scope.lock().unwrap() = scope;
        }
    }

    impl StationRequestExecutor for RecordingExecutor {
        fn execute(
            &self,
            request: StationRequest,
        ) -> Result<StationResponse, StationTransportError> {
            self.requests
                .lock()
                .unwrap()
                .push((request.path_and_query, request.expected_scope));
            Ok(StationResponse {
                status: 200,
                headers: HeaderMap::new(),
                body: Box::new(Cursor::new(Vec::<u8>::new())),
            })
        }

        fn active_scope(&self) -> Option<StationRequestScope> {
            Some(self.scope.lock().unwrap().clone())
        }

        fn active_station_peer_id(&self) -> Option<String> {
            Some(self.scope.lock().unwrap().station_peer_id.clone())
        }

        fn active_endpoint_origin(&self) -> Option<String> {
            None
        }

        fn authority_endpoint_origin(&self, _station_peer_id: &str) -> Result<String, String> {
            Err("resource tests do not expose route origins".to_string())
        }
    }

    fn scope(station_peer_id: &str, lifecycle_generation: u64) -> StationRequestScope {
        StationRequestScope {
            station_peer_id: station_peer_id.to_string(),
            lifecycle_generation,
        }
    }

    #[test]
    fn relative_resource_never_contains_route_origin() {
        assert!(StationResourceRef::new("station", 1, "/oss/object/1", None).is_ok());
        assert!(StationResourceRef::new("station", 1, "https://relay/object/1", None).is_err());
    }

    #[test]
    fn app_local_projection_is_lifecycle_fenced() {
        let projector = ResourceProjector::default();
        let resource = StationResourceRef::new("station", 7, "/avatar/alice", None).unwrap();
        let uri = projector.project(resource, "station", 7).unwrap();
        assert!(projector.resolve(uri.as_str(), "station", 8).is_err());
    }

    #[test]
    fn repeated_projection_reuses_one_opaque_uri() {
        let projector = ResourceProjector::default();
        let resource = StationResourceRef::new("station", 7, "/avatar/alice", None).unwrap();
        let first = projector.project(resource.clone(), "station", 7).unwrap();
        let second = projector.project(resource, "station", 7).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn projection_cache_is_bounded_and_evicts_oldest_entry() {
        let projector = ResourceProjector::default();
        let first = projector
            .project(
                StationResourceRef::new("station", 7, "/avatar/0", None).unwrap(),
                "station",
                7,
            )
            .unwrap();
        for index in 1..=MAX_PROJECTED_RESOURCES {
            projector
                .project(
                    StationResourceRef::new("station", 7, format!("/avatar/{index}"), None)
                        .unwrap(),
                    "station",
                    7,
                )
                .unwrap();
        }

        assert_eq!(
            projector.state.lock().unwrap().entries.len(),
            MAX_PROJECTED_RESOURCES
        );
        assert_eq!(
            projector.resolve(first.as_str(), "station", 7),
            Err(ResourceProjectionError::UnknownProjection)
        );
    }

    #[test]
    fn references_keep_external_urls_distinct_from_station_resources() {
        let resources = StationResourceHandle::new(StationClient::testing_scoped("station", 7));

        let relative = resources
            .reference("/avatar/alice", Some("sha256:avatar".to_string()))
            .unwrap();
        let external = resources
            .reference("https://cdn.example.test/avatar/alice", None)
            .unwrap();

        assert!(matches!(
            relative,
            ResourceReference::Station(ref resource)
                if resource.station_peer_id() == "station"
                    && resource.lifecycle_generation() == 7
                    && resource.path_and_query() == "/avatar/alice"
        ));
        assert!(matches!(
            external,
            ResourceReference::External(ref url)
                if url.as_str() == "https://cdn.example.test/avatar/alice"
        ));
    }

    #[test]
    fn resource_request_carries_exact_lifecycle_scope() {
        let executor = Arc::new(RecordingExecutor::new(scope("station", 7)));
        let resources = StationResourceHandle::new(StationClient::new(executor.clone()));
        let resource = match resources.reference("/avatar/alice", None).unwrap() {
            ResourceReference::Station(resource) => resource,
            ResourceReference::External(_) => panic!("relative resource must remain Station-bound"),
        };

        resources.open(&resource, None).unwrap();

        assert_eq!(
            executor.requests.lock().unwrap().as_slice(),
            &[("/avatar/alice".to_string(), Some(scope("station", 7)))]
        );
    }

    #[test]
    fn stale_resource_scope_is_rejected_before_transport() {
        let executor = Arc::new(RecordingExecutor::new(scope("station-a", 7)));
        let resources = StationResourceHandle::new(StationClient::new(executor.clone()));
        let resource = match resources.reference("/avatar/alice", None).unwrap() {
            ResourceReference::Station(resource) => resource,
            ResourceReference::External(_) => panic!("relative resource must remain Station-bound"),
        };
        executor.set_scope(scope("station-b", 8));

        let error = resources
            .open(&resource, None)
            .err()
            .expect("stale resource must be rejected");

        assert!(matches!(error.kind, StationClientErrorKind::StaleRoute));
        assert!(executor.requests.lock().unwrap().is_empty());
    }
}
