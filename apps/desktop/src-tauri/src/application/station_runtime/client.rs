use crate::error::{AppResult, ErrorCode};
use crate::model::common::PeersResponse;
use prost::Message;
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Method;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fmt;
use std::io::{Cursor, Read};
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

const INTERACTIVE_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const TURN_EXECUTION_WALL_TIME: Duration = Duration::from_secs(300);
const TURN_EXECUTION_RESPONSE_MARGIN: Duration = Duration::from_secs(5);
const SAFE_ERROR_DETAIL_FIELDS: [&str; 20] = [
    "resource_kind",
    "resource_id",
    "terminal_status",
    "expected_revision",
    "actual_revision",
    "capability_id",
    "capability_version",
    "expected_version",
    "actual_version",
    "schema_field",
    "binding_id",
    "target_device_id",
    "policy_kind",
    "reason_code",
    "session_id",
    "lease_id",
    "expired_at",
    "operation",
    "field",
    "reason",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StationTransportPolicy {
    Interactive,
    TurnExecution,
}

impl StationTransportPolicy {
    pub fn timeout(self) -> Duration {
        match self {
            Self::Interactive => INTERACTIVE_REQUEST_TIMEOUT,
            Self::TurnExecution => TURN_EXECUTION_WALL_TIME + TURN_EXECUTION_RESPONSE_MARGIN,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Interactive => "interactive",
            Self::TurnExecution => "turn_execution",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum TrafficClass {
    Interactive,
    Realtime,
    Bulk,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReplayPolicy {
    SafeRead,
    Idempotent(String),
    Never,
}

pub enum StationRequestBody {
    Empty,
    Bytes(Vec<u8>),
    Reader {
        reader: Box<dyn Read + Send>,
        content_length: u64,
    },
}

impl fmt::Debug for StationRequestBody {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => formatter.write_str("Empty"),
            Self::Bytes(bytes) => formatter.debug_tuple("Bytes").field(&bytes.len()).finish(),
            Self::Reader { content_length, .. } => formatter
                .debug_struct("Reader")
                .field("content_length", content_length)
                .finish_non_exhaustive(),
        }
    }
}

impl StationRequestBody {
    pub fn content_length(&self) -> u64 {
        match self {
            Self::Empty => 0,
            Self::Bytes(bytes) => bytes.len() as u64,
            Self::Reader { content_length, .. } => *content_length,
        }
    }

    pub(crate) fn replay_copy(&self) -> Option<Self> {
        match self {
            Self::Empty => Some(Self::Empty),
            Self::Bytes(bytes) => Some(Self::Bytes(bytes.clone())),
            Self::Reader { .. } => None,
        }
    }
}

#[derive(Debug)]
pub struct StationRequest {
    pub method: Method,
    pub path_and_query: String,
    pub headers: HeaderMap,
    pub body: StationRequestBody,
    pub timeout: Duration,
    pub traffic_class: TrafficClass,
    pub replay_policy: ReplayPolicy,
    pub cancellation: CancellationToken,
    pub expected_scope: Option<StationRequestScope>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StationRequestScope {
    pub station_peer_id: String,
    pub lifecycle_generation: u64,
}

impl StationRequest {
    pub fn replay_copy(&self) -> Option<Self> {
        Some(Self {
            method: self.method.clone(),
            path_and_query: self.path_and_query.clone(),
            headers: self.headers.clone(),
            body: self.body.replay_copy()?,
            timeout: self.timeout,
            traffic_class: self.traffic_class,
            replay_policy: self.replay_policy.clone(),
            cancellation: CancellationToken::new(),
            expected_scope: self.expected_scope.clone(),
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StationTransportErrorKind {
    Overloaded,
    Cancelled,
    Timeout,
    Unavailable,
    StaleRoute,
    InvalidRoute,
    Protocol,
    Shutdown,
}

#[derive(Debug)]
pub struct StationTransportError {
    pub kind: StationTransportErrorKind,
    pub message: String,
    pub submitted: bool,
}

impl StationTransportError {
    pub fn new(
        kind: StationTransportErrorKind,
        message: impl Into<String>,
        submitted: bool,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            submitted,
        }
    }
}

impl fmt::Display for StationTransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for StationTransportError {}

pub struct StationResponse {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: Box<dyn Read + Send>,
}

pub trait StationRequestExecutor: Send + Sync {
    fn execute(&self, request: StationRequest) -> Result<StationResponse, StationTransportError>;
    fn active_scope(&self) -> Option<StationRequestScope>;
    fn active_station_peer_id(&self) -> Option<String>;
    fn active_endpoint_origin(&self) -> Option<String>;
    fn authority_endpoint_origin(&self, station_peer_id: &str) -> Result<String, String>;
}

#[derive(Debug, Clone)]
pub enum StationClientErrorKind {
    SessionRevoked,
    HttpStatus(u16),
    Network,
    Decode,
    InvalidResponse,
    Overloaded,
    AmbiguousOutcome,
    Cancelled,
    StaleRoute,
}

#[derive(Debug, Clone)]
pub struct StationClientError {
    pub kind: StationClientErrorKind,
    pub message: String,
    pub details: Option<Value>,
}

#[derive(Debug, Clone)]
pub struct JsonHttpResponse {
    pub status: u16,
    pub headers: Value,
    pub body: Value,
}

impl StationClientError {
    pub fn new(
        kind: StationClientErrorKind,
        message: impl Into<String>,
        details: Option<Value>,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            details,
        }
    }

    pub fn session_revoked(body: &str) -> Self {
        let details = session_revoked_details_from_text(body).unwrap_or_else(|| {
            serde_json::json!({
                "code": "session_revoked",
                "reason": "unknown",
                "raw": body,
            })
        });
        Self::new(
            StationClientErrorKind::SessionRevoked,
            "session revoked",
            Some(details),
        )
    }

    pub fn into_app_result<T: Serialize>(self, context: impl Into<String>) -> AppResult<T> {
        let code = match self.kind {
            StationClientErrorKind::SessionRevoked => ErrorCode::Unauthorized,
            StationClientErrorKind::HttpStatus(status) => {
                if self
                    .details
                    .as_ref()
                    .and_then(|details| details.get("error_code"))
                    .and_then(Value::as_str)
                    == Some("AGENT_CANVAS_SINGLE_AGENT_NOT_READY")
                {
                    ErrorCode::AgentCanvasSingleAgentNotReady
                } else {
                    match status {
                        400 => ErrorCode::InvalidArgument,
                        401 => ErrorCode::Unauthorized,
                        403 => ErrorCode::Forbidden,
                        404 => ErrorCode::NotFound,
                        409 => ErrorCode::Conflict,
                        _ => ErrorCode::InternalError,
                    }
                }
            }
            StationClientErrorKind::Overloaded
            | StationClientErrorKind::AmbiguousOutcome
            | StationClientErrorKind::StaleRoute => ErrorCode::Conflict,
            _ => ErrorCode::InternalError,
        };
        AppResult::fail(code, context.into(), self.details)
    }
}

impl fmt::Display for StationClientError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let error_code = self
            .details
            .as_ref()
            .and_then(|details| details.get("error_code"))
            .and_then(Value::as_str);
        match error_code {
            Some(code) => write!(formatter, "{} [code={}]", self.message, code),
            None => formatter.write_str(&self.message),
        }
    }
}

impl std::error::Error for StationClientError {}

pub fn session_revoked_details_from_text(text: &str) -> Option<Value> {
    let value: Value = serde_json::from_str(text).ok()?;
    if value.get("code").and_then(Value::as_str) != Some("session_revoked") {
        return None;
    }
    let mut details = serde_json::json!({
        "code": "session_revoked",
        "reason": value
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or("unknown"),
        "raw": text,
    });
    if let Some(device_type) = value.get("device_type").and_then(Value::as_str) {
        details["device_type"] = Value::String(device_type.to_string());
    }
    Some(details)
}

#[derive(Clone)]
pub struct StationClient {
    executor: Arc<dyn StationRequestExecutor>,
    device_id: Arc<RwLock<Option<String>>>,
}

impl StationClient {
    pub fn new(executor: Arc<dyn StationRequestExecutor>) -> Self {
        Self {
            executor,
            device_id: Arc::new(RwLock::new(None)),
        }
    }

    #[cfg(test)]
    pub(crate) fn testing_unavailable() -> Self {
        Self::new(Arc::new(UnavailableTestExecutor { scope: None }))
    }

    #[cfg(test)]
    pub(crate) fn testing_scoped(
        station_peer_id: impl Into<String>,
        lifecycle_generation: u64,
    ) -> Self {
        Self::new(Arc::new(UnavailableTestExecutor {
            scope: Some(StationRequestScope {
                station_peer_id: station_peer_id.into(),
                lifecycle_generation,
            }),
        }))
    }

    pub fn set_device_id(&self, id: String) {
        *self.device_id.write().expect("device ID lock poisoned") = Some(id);
    }

    pub fn device_id(&self) -> Option<String> {
        self.device_id.read().ok().and_then(|id| id.clone())
    }

    pub fn active_station_peer_id(&self) -> Option<String> {
        self.executor.active_station_peer_id()
    }

    pub fn active_scope(&self) -> Option<StationRequestScope> {
        self.executor.active_scope()
    }

    pub fn active_endpoint_origin(&self) -> Option<String> {
        self.executor.active_endpoint_origin()
    }

    pub fn authority_endpoint_origin(
        &self,
        station_peer_id: &str,
    ) -> Result<String, StationClientError> {
        self.executor
            .authority_endpoint_origin(station_peer_id)
            .map_err(|message| {
                StationClientError::new(
                    StationClientErrorKind::InvalidResponse,
                    message,
                    Some(serde_json::json!({
                        "station_peer_id": station_peer_id,
                    })),
                )
            })
    }

    pub fn execute_raw(
        &self,
        request: StationRequest,
    ) -> Result<StationResponse, StationClientError> {
        let replay_policy = request.replay_policy.clone();
        self.executor
            .execute(request)
            .map_err(|error| map_transport_error(error, replay_policy))
    }

    pub fn open_json_stream(
        &self,
        path: &str,
        token: &str,
        body: &Value,
        timeout: Duration,
        replay_policy: ReplayPolicy,
        cancellation: CancellationToken,
    ) -> Result<StationResponse, StationClientError> {
        let mut headers = HeaderMap::new();
        headers.insert(
            reqwest::header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).map_err(header_error)?,
        );
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        headers.insert(
            reqwest::header::ACCEPT,
            HeaderValue::from_static("text/event-stream"),
        );
        self.execute_raw(StationRequest {
            method: Method::POST,
            path_and_query: path.to_string(),
            headers,
            body: StationRequestBody::Bytes(serde_json::to_vec(body).map_err(|error| {
                StationClientError::new(
                    StationClientErrorKind::Decode,
                    format!("encode stream request: {error}"),
                    None,
                )
            })?),
            timeout,
            traffic_class: TrafficClass::Realtime,
            replay_policy,
            cancellation,
            expected_scope: None,
        })
    }

    pub fn post_json_with_auth(
        &self,
        path: &str,
        token: &str,
        body: Value,
    ) -> Result<Value, StationClientError> {
        self.request_json_auth(Method::POST, path, token, None, Some(&body))
    }

    pub fn post_json_no_auth(&self, path: &str, body: Value) -> Result<Value, StationClientError> {
        self.request_json_internal(
            Method::POST,
            path,
            None,
            None,
            Some(body),
            StationTransportPolicy::Interactive,
            None,
        )
    }

    pub fn request_peers_proto_no_body<Payload: Message + Default>(
        &self,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
    ) -> Result<Payload, StationClientError> {
        let response = self.execute_wire(
            method,
            path,
            query,
            Some(token),
            self.device_id().as_deref(),
            Some("application/protobuf"),
            "application/protobuf",
            StationRequestBody::Empty,
            StationTransportPolicy::Interactive,
            TrafficClass::Interactive,
            None,
        )?;
        decode_peers_envelope(&response.body)
    }

    pub fn request_peers_proto_no_payload<Req: Message>(
        &self,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<&Req>,
    ) -> Result<(), StationClientError> {
        let response = self.execute_wire(
            method,
            path,
            query,
            Some(token),
            self.device_id().as_deref(),
            Some("application/protobuf"),
            "application/protobuf",
            proto_body(body),
            StationTransportPolicy::Interactive,
            TrafficClass::Interactive,
            None,
        )?;
        PeersResponse::decode(response.body.as_slice()).map_err(|error| {
            StationClientError::new(
                StationClientErrorKind::Decode,
                format!("decode PeersResponse: {error}"),
                None,
            )
        })?;
        Ok(())
    }

    pub fn request_peers_proto<Req, Payload>(
        &self,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<&Req>,
    ) -> Result<Payload, StationClientError>
    where
        Req: Message,
        Payload: Message + Default,
    {
        let response = self.execute_wire(
            method,
            path,
            query,
            Some(token),
            self.device_id().as_deref(),
            Some("application/protobuf"),
            "application/protobuf",
            proto_body(body),
            StationTransportPolicy::Interactive,
            TrafficClass::Interactive,
            None,
        )?;
        decode_peers_envelope(&response.body)
    }

    pub fn request_proto_for_device<Req, Payload>(
        &self,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<&Req>,
        device_id: &str,
    ) -> Result<Payload, StationClientError>
    where
        Req: Message,
        Payload: Message + Default,
    {
        self.request_proto_internal(
            method,
            path,
            Some(token),
            query,
            body,
            Some(device_id),
            StationTransportPolicy::Interactive,
        )
    }

    pub fn request_proto_for_actor<Req, Payload>(
        &self,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<&Req>,
    ) -> Result<Payload, StationClientError>
    where
        Req: Message,
        Payload: Message + Default,
    {
        self.request_proto_internal(
            method,
            path,
            Some(token),
            query,
            body,
            None,
            StationTransportPolicy::Interactive,
        )
    }

    pub fn request_proto_for_actor_at<Req, Payload>(
        &self,
        station_url: &str,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<&Req>,
    ) -> Result<Payload, StationClientError>
    where
        Req: Message,
        Payload: Message + Default,
    {
        external_proto_request(station_url, method, path, Some(token), query, body, None)
    }

    pub fn request_peers_proto_no_body_for_device_at<Payload>(
        &self,
        station_url: &str,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        device_id: &str,
    ) -> Result<Payload, StationClientError>
    where
        Payload: Message + Default,
    {
        let envelope: PeersResponse = self.request_proto_for_device_at::<(), PeersResponse>(
            station_url,
            method,
            path,
            token,
            query,
            None,
            device_id,
        )?;
        decode_peers_payload(envelope)
    }

    pub fn request_peers_proto_no_body_for_device<Payload>(
        &self,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        device_id: &str,
    ) -> Result<Payload, StationClientError>
    where
        Payload: Message + Default,
    {
        let response = self.execute_wire(
            method,
            path,
            query,
            Some(token),
            Some(device_id),
            Some("application/protobuf"),
            "application/protobuf",
            StationRequestBody::Empty,
            StationTransportPolicy::Interactive,
            TrafficClass::Interactive,
            None,
        )?;
        decode_peers_envelope(&response.body)
    }

    pub fn request_proto_for_device_at<Req, Payload>(
        &self,
        station_url: &str,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<&Req>,
        device_id: &str,
    ) -> Result<Payload, StationClientError>
    where
        Req: Message,
        Payload: Message + Default,
    {
        if device_id.trim().is_empty() {
            return Err(StationClientError::new(
                StationClientErrorKind::InvalidResponse,
                "profile-scoped request requires device ID",
                None,
            ));
        }
        external_proto_request(
            station_url,
            method,
            path,
            Some(token),
            query,
            body,
            Some(device_id),
        )
    }

    pub fn request_proto_no_auth<Req, Payload>(
        &self,
        method: Method,
        path: &str,
        body: &Req,
    ) -> Result<Payload, StationClientError>
    where
        Req: Message,
        Payload: Message + Default,
    {
        self.request_proto_internal(
            method,
            path,
            None,
            None,
            Some(body),
            None,
            StationTransportPolicy::Interactive,
        )
    }

    pub fn request_proto_no_auth_at<Req, Payload>(
        &self,
        station_url: &str,
        method: Method,
        path: &str,
        body: &Req,
    ) -> Result<Payload, StationClientError>
    where
        Req: Message,
        Payload: Message + Default,
    {
        external_proto_request(station_url, method, path, None, None, Some(body), None)
    }

    pub fn post_peers_proto_no_auth<Req, Payload>(
        &self,
        path: &str,
        body: &Req,
    ) -> Result<Payload, StationClientError>
    where
        Req: Message,
        Payload: Message + Default,
    {
        let response = self.execute_wire(
            Method::POST,
            path,
            None,
            None,
            None,
            Some("application/protobuf"),
            "application/protobuf",
            StationRequestBody::Bytes(body.encode_to_vec()),
            StationTransportPolicy::Interactive,
            TrafficClass::Interactive,
            None,
        )?;
        decode_peers_envelope(&response.body)
    }

    pub fn request_json(
        &self,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<Value>,
    ) -> Result<Value, StationClientError> {
        self.request_json_with_policy(
            method,
            path,
            token,
            query,
            body,
            StationTransportPolicy::Interactive,
        )
    }

    pub fn request_json_with_policy(
        &self,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<Value>,
        policy: StationTransportPolicy,
    ) -> Result<Value, StationClientError> {
        self.request_json_internal(method, path, Some(token), query, body, policy, None)
    }

    pub fn request_json_response(
        &self,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<Value>,
    ) -> Result<JsonHttpResponse, StationClientError> {
        let response = self.execute_wire(
            method,
            path,
            query,
            Some(token),
            self.device_id().as_deref(),
            Some("application/json"),
            "application/json",
            json_body(body.as_ref())?,
            StationTransportPolicy::Interactive,
            TrafficClass::Interactive,
            None,
        )?;
        Ok(JsonHttpResponse {
            status: response.status,
            headers: headers_to_json(&response.headers),
            body: decode_json_or_text(&response.body),
        })
    }

    pub fn request_json_response_base_url(
        &self,
        base_url: &str,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<Value>,
    ) -> Result<JsonHttpResponse, StationClientError> {
        external_json_response(base_url, method, path, token, query, body)
    }

    pub fn request_proto<Req, Resp>(
        &self,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<&Req>,
    ) -> Result<Resp, StationClientError>
    where
        Req: Message,
        Resp: Message + Default,
    {
        self.request_proto_with_policy(
            method,
            path,
            token,
            query,
            body,
            StationTransportPolicy::Interactive,
        )
    }

    pub fn request_proto_optional_auth<Req, Resp>(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
        query: Option<&[(&str, String)]>,
        body: Option<&Req>,
    ) -> Result<Resp, StationClientError>
    where
        Req: Message,
        Resp: Message + Default,
    {
        self.request_proto_internal(
            method,
            path,
            token,
            query,
            body,
            token.and_then(|_| self.device_id()).as_deref(),
            StationTransportPolicy::Interactive,
        )
    }

    pub fn request_proto_with_policy<Req, Resp>(
        &self,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<&Req>,
        policy: StationTransportPolicy,
    ) -> Result<Resp, StationClientError>
    where
        Req: Message,
        Resp: Message + Default,
    {
        self.request_proto_internal(
            method,
            path,
            Some(token),
            query,
            body,
            self.device_id().as_deref(),
            policy,
        )
    }

    pub fn request_json_auth(
        &self,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<&Value>,
    ) -> Result<Value, StationClientError> {
        self.request_json_auth_with_optional_device_id(
            method,
            path,
            token,
            query,
            body,
            self.device_id().as_deref(),
        )
    }

    pub fn request_json_auth_with_device_id(
        &self,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<&Value>,
        device_id: &str,
    ) -> Result<Value, StationClientError> {
        self.request_json_auth_with_optional_device_id(
            method,
            path,
            token,
            query,
            body,
            Some(device_id),
        )
    }

    fn request_json_auth_with_optional_device_id(
        &self,
        method: Method,
        path: &str,
        token: &str,
        query: Option<&[(&str, String)]>,
        body: Option<&Value>,
        device_id: Option<&str>,
    ) -> Result<Value, StationClientError> {
        let response = self.execute_wire(
            method,
            path,
            query,
            Some(token),
            device_id,
            Some("application/json"),
            "application/json",
            json_body(body)?,
            StationTransportPolicy::Interactive,
            TrafficClass::Interactive,
            None,
        )?;
        if response.body.is_empty() {
            return Ok(Value::Null);
        }
        let result = serde_json::from_slice::<Value>(&response.body).map_err(|error| {
            StationClientError::new(
                StationClientErrorKind::Decode,
                format!("decode json response failed: {error}"),
                None,
            )
        })?;
        if let Some(status) = embedded_http_status(&result) {
            return Err(build_error_for_status(status, path, &result.to_string()));
        }
        Ok(result)
    }

    pub fn upload_multipart(
        &self,
        path: &str,
        token: &str,
        file_path: &str,
        bucket: &str,
        visibility: &str,
        chat_session_id: Option<&str>,
    ) -> Result<Value, StationClientError> {
        let multipart = MultipartBody::open(file_path, bucket, visibility, chat_session_id)?;
        let content_type = format!("multipart/form-data; boundary={}", multipart.boundary);
        let response = self.execute_wire(
            Method::POST,
            path,
            None,
            Some(token),
            self.device_id().as_deref(),
            Some(&content_type),
            "application/json",
            StationRequestBody::Reader {
                reader: multipart.reader,
                content_length: multipart.content_length,
            },
            StationTransportPolicy::TurnExecution,
            TrafficClass::Bulk,
            Some(ReplayPolicy::Never),
        )?;
        serde_json::from_slice(&response.body).map_err(|error| {
            StationClientError::new(
                StationClientErrorKind::Decode,
                format!("decode json response failed: {error}"),
                None,
            )
        })
    }

    pub fn put_presigned_url(
        &self,
        url: &str,
        headers: &HashMap<String, String>,
        file_path: &str,
    ) -> Result<(), StationClientError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(network_error)?;
        let file = std::fs::File::open(file_path).map_err(|error| {
            StationClientError::new(
                StationClientErrorKind::Network,
                format!("open {file_path}: {error}"),
                None,
            )
        })?;
        let mut request = client.put(url).body(file);
        for (name, value) in headers {
            request = request.header(name, value);
        }
        let response = request.send().map_err(network_error)?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            return Err(StationClientError::new(
                StationClientErrorKind::HttpStatus(status.as_u16()),
                format!("presigned put returned {}: {body}", status.as_u16()),
                Some(serde_json::json!({"status": status.as_u16(), "body": body})),
            ));
        }
        Ok(())
    }

    pub fn probe_station(&self, url: &str) -> (bool, Option<String>, Option<String>, Option<u32>) {
        probe_station(url)
    }

    fn request_proto_internal<Req, Resp>(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
        query: Option<&[(&str, String)]>,
        body: Option<&Req>,
        device_id: Option<&str>,
        policy: StationTransportPolicy,
    ) -> Result<Resp, StationClientError>
    where
        Req: Message,
        Resp: Message + Default,
    {
        let response = self.execute_wire(
            method,
            path,
            query,
            token,
            device_id,
            Some("application/protobuf"),
            "application/protobuf",
            proto_body(body),
            policy,
            TrafficClass::Interactive,
            None,
        )?;
        Resp::decode(response.body.as_slice()).map_err(|error| {
            StationClientError::new(
                StationClientErrorKind::Decode,
                format!("decode proto response failed: {error}"),
                None,
            )
        })
    }

    fn request_json_internal(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
        query: Option<&[(&str, String)]>,
        body: Option<Value>,
        policy: StationTransportPolicy,
        device_id: Option<&str>,
    ) -> Result<Value, StationClientError> {
        let response = self.execute_wire(
            method,
            path,
            query,
            token,
            device_id,
            Some("application/json"),
            "application/json",
            json_body(body.as_ref())?,
            policy,
            TrafficClass::Interactive,
            None,
        )?;
        if response.body.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&response.body).map_err(|error| {
            StationClientError::new(
                StationClientErrorKind::Decode,
                format!("decode json response failed: {error}"),
                None,
            )
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn execute_wire(
        &self,
        method: Method,
        path: &str,
        query: Option<&[(&str, String)]>,
        token: Option<&str>,
        device_id: Option<&str>,
        content_type: Option<&str>,
        accept: &str,
        body: StationRequestBody,
        policy: StationTransportPolicy,
        traffic_class: TrafficClass,
        replay_policy: Option<ReplayPolicy>,
    ) -> Result<BufferedResponse, StationClientError> {
        let path_and_query = encode_path_and_query(path, query)?;
        let mut headers = HeaderMap::new();
        if let Some(token) = token {
            headers.insert(
                reqwest::header::AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {token}")).map_err(header_error)?,
            );
        }
        if let Some(device_id) = device_id.filter(|value| !value.trim().is_empty()) {
            headers.insert(
                HeaderName::from_static("x-device-id"),
                HeaderValue::from_str(device_id).map_err(header_error)?,
            );
        }
        if let Some(content_type) = content_type {
            headers.insert(
                reqwest::header::CONTENT_TYPE,
                HeaderValue::from_str(content_type).map_err(header_error)?,
            );
        }
        headers.insert(
            reqwest::header::ACCEPT,
            HeaderValue::from_str(accept).map_err(header_error)?,
        );
        let replay_policy = replay_policy.unwrap_or_else(|| default_replay_policy(&method));
        let response = self.execute_raw(StationRequest {
            method,
            path_and_query,
            headers,
            body,
            timeout: policy.timeout(),
            traffic_class,
            replay_policy,
            cancellation: CancellationToken::new(),
            expected_scope: None,
        })?;
        buffer_response(path, response)
    }
}

#[cfg(test)]
struct UnavailableTestExecutor {
    scope: Option<StationRequestScope>,
}

#[cfg(test)]
impl StationRequestExecutor for UnavailableTestExecutor {
    fn execute(&self, _request: StationRequest) -> Result<StationResponse, StationTransportError> {
        Err(StationTransportError::new(
            StationTransportErrorKind::Unavailable,
            "test Station transport is unavailable",
            false,
        ))
    }

    fn active_scope(&self) -> Option<StationRequestScope> {
        self.scope.clone()
    }

    fn active_station_peer_id(&self) -> Option<String> {
        self.scope
            .as_ref()
            .map(|scope| scope.station_peer_id.clone())
    }

    fn active_endpoint_origin(&self) -> Option<String> {
        None
    }

    fn authority_endpoint_origin(&self, _station_peer_id: &str) -> Result<String, String> {
        Err("test Station authority route is unavailable".to_string())
    }
}

struct BufferedResponse {
    status: u16,
    headers: HeaderMap,
    body: Vec<u8>,
}

fn buffer_response(
    path: &str,
    mut response: StationResponse,
) -> Result<BufferedResponse, StationClientError> {
    let mut body = Vec::new();
    response.body.read_to_end(&mut body).map_err(|error| {
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("read body failed: {error}"),
            None,
        )
    })?;
    if !(200..300).contains(&response.status) {
        return Err(build_error_for_status_with_headers(
            response.status,
            path,
            &String::from_utf8_lossy(&body),
            Some(&headers_to_json(&response.headers)),
        ));
    }
    Ok(BufferedResponse {
        status: response.status,
        headers: response.headers,
        body,
    })
}

fn default_replay_policy(method: &Method) -> ReplayPolicy {
    if matches!(
        *method,
        Method::GET | Method::HEAD | Method::OPTIONS | Method::TRACE
    ) {
        ReplayPolicy::SafeRead
    } else {
        ReplayPolicy::Never
    }
}

fn map_transport_error(
    error: StationTransportError,
    replay_policy: ReplayPolicy,
) -> StationClientError {
    let (kind, code) = match error.kind {
        StationTransportErrorKind::Overloaded => {
            (StationClientErrorKind::Overloaded, "station_overloaded")
        }
        StationTransportErrorKind::Cancelled | StationTransportErrorKind::Shutdown => {
            (StationClientErrorKind::Cancelled, "station_cancelled")
        }
        StationTransportErrorKind::StaleRoute => {
            (StationClientErrorKind::StaleRoute, "station_stale_route")
        }
        _ if error.submitted && matches!(replay_policy, ReplayPolicy::Never) => (
            StationClientErrorKind::AmbiguousOutcome,
            "station_ambiguous_outcome",
        ),
        _ => (StationClientErrorKind::Network, "station_transport_failed"),
    };
    StationClientError::new(
        kind,
        error.message,
        Some(serde_json::json!({
            "code": code,
            "submitted": error.submitted,
        })),
    )
}

fn proto_body<Req: Message>(body: Option<&Req>) -> StationRequestBody {
    body.map_or(StationRequestBody::Empty, |body| {
        StationRequestBody::Bytes(body.encode_to_vec())
    })
}

fn json_body(body: Option<&Value>) -> Result<StationRequestBody, StationClientError> {
    body.map_or(Ok(StationRequestBody::Empty), |body| {
        serde_json::to_vec(body)
            .map(StationRequestBody::Bytes)
            .map_err(|error| {
                StationClientError::new(
                    StationClientErrorKind::Decode,
                    format!("encode json request failed: {error}"),
                    None,
                )
            })
    })
}

fn encode_path_and_query(
    path: &str,
    query: Option<&[(&str, String)]>,
) -> Result<String, StationClientError> {
    let mut url = reqwest::Url::parse("http://station.invalid")
        .and_then(|base| base.join(path))
        .map_err(|error| {
            StationClientError::new(
                StationClientErrorKind::InvalidResponse,
                format!("invalid Station request path: {error}"),
                None,
            )
        })?;
    if let Some(query) = query {
        url.query_pairs_mut()
            .extend_pairs(query.iter().map(|(name, value)| (*name, value.as_str())));
    }
    let mut value = url.path().to_string();
    if let Some(query) = url.query() {
        value.push('?');
        value.push_str(query);
    }
    Ok(value)
}

fn decode_peers_envelope<Payload: Message + Default>(
    raw: &[u8],
) -> Result<Payload, StationClientError> {
    let envelope = PeersResponse::decode(raw).map_err(|error| {
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode PeersResponse: {error}"),
            None,
        )
    })?;
    decode_peers_payload(envelope)
}

fn decode_peers_payload<Payload: Message + Default>(
    envelope: PeersResponse,
) -> Result<Payload, StationClientError> {
    if !envelope.code.is_empty() && envelope.code != "200" {
        return Err(StationClientError::new(
            StationClientErrorKind::InvalidResponse,
            format!("Station returned Peers error code {}", envelope.code),
            Some(serde_json::json!({
                "code": envelope.code,
                "message": envelope.msg,
            })),
        ));
    }
    let any = envelope.data.ok_or_else(|| {
        StationClientError::new(
            StationClientErrorKind::InvalidResponse,
            "station response missing data envelope",
            None,
        )
    })?;
    Payload::decode(any.value.as_slice()).map_err(|error| {
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode envelope payload: {error}"),
            None,
        )
    })
}

fn build_error_for_status(status: u16, path: &str, body: &str) -> StationClientError {
    build_error_for_status_with_headers(status, path, body, None)
}

fn build_error_for_status_with_headers(
    status: u16,
    path: &str,
    body: &str,
    headers: Option<&Value>,
) -> StationClientError {
    if status == 401 && body.contains("session_revoked") {
        tracing::warn!(path, "Session revoked by Station");
        return StationClientError::session_revoked(body);
    }
    let mut details = serde_json::json!({ "status": status, "body": body });
    if let (Some(details), Some(headers)) =
        (details.as_object_mut(), headers.and_then(Value::as_object))
    {
        for (header, field) in [
            ("x-peers-error-code", "error_code"),
            ("x-peers-error-locale-key", "locale_key"),
            ("x-peers-error-retryable", "retryable"),
            ("x-peers-error-terminal", "terminal"),
            ("x-peers-required-gate", "required_gate"),
        ] {
            if let Some(value) = headers.get(header).and_then(Value::as_str) {
                details.insert(field.to_string(), Value::String(value.to_string()));
            }
        }
        merge_safe_error_detail_header(details, headers);
    }
    StationClientError::new(
        StationClientErrorKind::HttpStatus(status),
        format!("station returned {status}: {body}"),
        Some(details),
    )
}

fn merge_safe_error_detail_header(
    details: &mut serde_json::Map<String, Value>,
    headers: &serde_json::Map<String, Value>,
) {
    let Some(raw_details) = headers.get("x-peers-error-details").and_then(Value::as_str) else {
        return;
    };
    let Ok(Value::Object(header_details)) = serde_json::from_str::<Value>(raw_details) else {
        return;
    };
    for field in SAFE_ERROR_DETAIL_FIELDS {
        if let Some(Value::String(value)) = header_details.get(field) {
            details.insert(field.to_string(), Value::String(value.clone()));
        }
    }
}

fn headers_to_json(headers: &HeaderMap) -> Value {
    Value::Object(
        headers
            .iter()
            .filter_map(|(name, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|value| (name.as_str().to_string(), Value::String(value.to_string())))
            })
            .collect(),
    )
}

fn embedded_http_status(value: &Value) -> Option<u16> {
    value
        .get("code")
        .and_then(|code| {
            code.as_u64()
                .or_else(|| code.as_str().and_then(|value| value.parse::<u64>().ok()))
        })
        .filter(|code| (400..=u16::MAX as u64).contains(code))
        .map(|code| code as u16)
}

fn decode_json_or_text(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(bytes).to_string()))
}

fn network_error(error: impl fmt::Display) -> StationClientError {
    StationClientError::new(
        StationClientErrorKind::Network,
        format!("request failed: {error}"),
        None,
    )
}

fn header_error(error: impl fmt::Display) -> StationClientError {
    StationClientError::new(
        StationClientErrorKind::InvalidResponse,
        format!("invalid Station request header: {error}"),
        None,
    )
}

fn external_proto_request<Req, Resp>(
    base_url: &str,
    method: Method,
    path: &str,
    token: Option<&str>,
    query: Option<&[(&str, String)]>,
    body: Option<&Req>,
    device_id: Option<&str>,
) -> Result<Resp, StationClientError>
where
    Req: Message,
    Resp: Message + Default,
{
    let url = format!("{}{}", base_url.trim_end_matches('/'), path);
    let client = Client::builder()
        .timeout(INTERACTIVE_REQUEST_TIMEOUT)
        .build()
        .map_err(network_error)?;
    let mut request = client.request(method, url);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    if let Some(device_id) = device_id.filter(|value| !value.trim().is_empty()) {
        request = request.header("X-Device-ID", device_id);
    }
    if let Some(query) = query {
        request = request.query(query);
    }
    request = request
        .header("Content-Type", "application/protobuf")
        .header("Accept", "application/protobuf");
    if let Some(body) = body {
        request = request.body(body.encode_to_vec());
    }
    let response = request.send().map_err(network_error)?;
    let status = response.status();
    let headers = headers_to_json(response.headers());
    let bytes = response.bytes().map_err(network_error)?;
    if !status.is_success() {
        return Err(build_error_for_status_with_headers(
            status.as_u16(),
            path,
            &String::from_utf8_lossy(&bytes),
            Some(&headers),
        ));
    }
    Resp::decode(bytes.as_ref()).map_err(|error| {
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode proto response failed: {error}"),
            None,
        )
    })
}

fn external_json_response(
    base_url: &str,
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<Value>,
) -> Result<JsonHttpResponse, StationClientError> {
    let url = format!("{}{}", base_url.trim_end_matches('/'), path);
    let client = Client::builder()
        .timeout(INTERACTIVE_REQUEST_TIMEOUT)
        .build()
        .map_err(network_error)?;
    let mut request = client
        .request(method, url)
        .bearer_auth(token)
        .header("Accept", "application/json");
    if let Some(query) = query {
        request = request.query(query);
    }
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().map_err(network_error)?;
    let status = response.status().as_u16();
    let headers = headers_to_json(response.headers());
    let bytes = response.bytes().map_err(network_error)?;
    Ok(JsonHttpResponse {
        status,
        headers,
        body: decode_json_or_text(&bytes),
    })
}

struct MultipartBody {
    boundary: String,
    reader: Box<dyn Read + Send>,
    content_length: u64,
}

impl MultipartBody {
    fn open(
        file_path: &str,
        bucket: &str,
        visibility: &str,
        chat_session_id: Option<&str>,
    ) -> Result<Self, StationClientError> {
        let path = Path::new(file_path);
        let file = std::fs::File::open(path).map_err(network_error)?;
        let file_length = file.metadata().map_err(network_error)?.len();
        let filename = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("upload.bin")
            .replace(['"', '\r', '\n'], "_");
        let boundary = format!("peers-touch-{}", ulid::Ulid::new());
        let mut prefix = Vec::new();
        for (name, value) in [
            ("bucket", Some(bucket)),
            ("visibility", Some(visibility)),
            ("chat_session_id", chat_session_id),
        ] {
            if let Some(value) = value {
                prefix.extend_from_slice(
                    format!(
                        "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{}\r\n",
                        value.replace(['\r', '\n'], " ")
                    )
                    .as_bytes(),
                );
            }
        }
        prefix.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        let suffix = format!("\r\n--{boundary}--\r\n").into_bytes();
        let content_length = prefix.len() as u64 + file_length + suffix.len() as u64;
        let reader = Cursor::new(prefix).chain(file).chain(Cursor::new(suffix));
        Ok(Self {
            boundary,
            reader: Box::new(reader),
            content_length,
        })
    }
}

#[derive(Clone, PartialEq, prost::Message)]
struct StationErrorBody {
    #[prost(int32, tag = "1")]
    code: i32,
    #[prost(string, tag = "2")]
    message: String,
}

pub fn peers_failure_error(status: u16, bytes: &[u8]) -> StationClientError {
    let mut details = serde_json::json!({ "status": status });
    if let Ok(body) = StationErrorBody::decode(bytes) {
        details["error_code"] = serde_json::json!(body.code);
        if !body.message.is_empty() {
            details["server_message"] = serde_json::json!(body.message);
        }
        return StationClientError::new(
            StationClientErrorKind::HttpStatus(status),
            format!("station returned {status}: {}", body.message),
            Some(details),
        );
    }
    let raw = String::from_utf8_lossy(bytes).to_string();
    details["body"] = Value::String(raw.clone());
    StationClientError::new(
        StationClientErrorKind::HttpStatus(status),
        format!("station returned {status}: {raw}"),
        Some(details),
    )
}

pub fn probe_station(url: &str) -> (bool, Option<String>, Option<String>, Option<u32>) {
    let Ok(client) = Client::builder().timeout(Duration::from_secs(5)).build() else {
        return (false, None, None, None);
    };
    let origin = url.trim().trim_end_matches('/');
    let base = if origin.contains("://") {
        origin.to_string()
    } else {
        format!("http://{origin}")
    };
    let online = client
        .get(format!("{base}/sub-oss/healthz"))
        .send()
        .is_ok_and(|response| response.status().is_success());
    if !online {
        return (false, None, None, None);
    }
    let metadata = client
        .get(format!("{base}/sub-bootstrap/info"))
        .send()
        .ok()
        .and_then(|response| response.json::<Value>().ok())
        .unwrap_or(Value::Null);
    let data = metadata.get("data").unwrap_or(&metadata);
    (
        true,
        data.get("label")
            .or_else(|| data.get("name"))
            .and_then(Value::as_str)
            .map(str::to_string),
        data.get("peer_id")
            .and_then(Value::as_str)
            .map(str::to_string),
        data.get("peers_count")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transport_policies_are_bounded_by_operation_semantics() {
        assert_eq!(
            StationTransportPolicy::Interactive.timeout(),
            Duration::from_secs(15)
        );
        assert_eq!(
            StationTransportPolicy::TurnExecution.timeout(),
            Duration::from_secs(305)
        );
    }

    #[test]
    fn only_safe_reads_receive_implicit_replay() {
        assert_eq!(default_replay_policy(&Method::GET), ReplayPolicy::SafeRead);
        assert_eq!(default_replay_policy(&Method::POST), ReplayPolicy::Never);
    }

    #[test]
    fn request_path_query_is_encoded_once() {
        assert_eq!(
            encode_path_and_query(
                "/actor/profile?view=compact",
                Some(&[("actor", "ptid:a/b".to_string())])
            )
            .unwrap(),
            "/actor/profile?view=compact&actor=ptid%3Aa%2Fb"
        );
    }
}
