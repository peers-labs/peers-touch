use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_registry::StationRegistry;
use crate::model::common::PeersResponse;
use prost::Message;
use reqwest::blocking::Client;
use reqwest::blocking::RequestBuilder;
use reqwest::header::HeaderMap;
use reqwest::Method;
use serde::Serialize;
use serde_json::Value;
use std::fmt;
use std::sync::{LazyLock, OnceLock, RwLock};
use std::time::Duration;

const INTERACTIVE_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const TURN_EXECUTION_WALL_TIME: Duration = Duration::from_secs(300);
const TURN_EXECUTION_RESPONSE_MARGIN: Duration = Duration::from_secs(5);
const SAFE_ERROR_DETAIL_FIELDS: [&str; 10] = [
    "resource_kind",
    "resource_id",
    "expected_revision",
    "actual_revision",
    "session_id",
    "lease_id",
    "expired_at",
    "operation",
    "field",
    "reason",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StationTransportPolicy {
    Interactive,
    TurnExecution,
}

impl StationTransportPolicy {
    fn timeout(self) -> Duration {
        match self {
            Self::Interactive => INTERACTIVE_REQUEST_TIMEOUT,
            // Station owns the Turn deadline. The transport stays open long
            // enough to receive the synchronous terminal response it settles.
            Self::TurnExecution => TURN_EXECUTION_WALL_TIME + TURN_EXECUTION_RESPONSE_MARGIN,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Interactive => "interactive",
            Self::TurnExecution => "turn_execution",
        }
    }
}

// ---------------------------------------------------------------------------
// Global station registry (initialized once during bootstrap)
// ---------------------------------------------------------------------------

static STATION_REGISTRY: OnceLock<StationRegistry> = OnceLock::new();

// ---------------------------------------------------------------------------
// Device ID — canonical per-actor identifier injected as X-Device-ID
// ---------------------------------------------------------------------------

static DEVICE_ID: LazyLock<RwLock<Option<String>>> = LazyLock::new(|| RwLock::new(None));

pub(crate) fn set_device_id(id: String) {
    *DEVICE_ID.write().expect("device id lock poisoned") = Some(id);
}

pub(crate) fn device_id() -> Option<String> {
    DEVICE_ID.read().ok().and_then(|id| id.clone())
}

fn with_device_id(req: RequestBuilder) -> RequestBuilder {
    match device_id() {
        Some(id) => req.header("X-Device-ID", id),
        None => req,
    }
}

/// Initialize the global station registry. Must be called once during bootstrap
/// after the config directory is resolved.
pub(crate) fn init_station_registry(config_dir: &std::path::Path) {
    if STATION_REGISTRY
        .set(StationRegistry::new(config_dir))
        .is_err()
    {
        tracing::warn!("station_registry: already initialized, ignoring duplicate init");
    }
}

/// Access the global station registry. Panics if not yet initialized.
pub(crate) fn station_registry() -> &'static StationRegistry {
    STATION_REGISTRY.get().expect(
        "StationRegistry not initialized — init_station_registry must be called during bootstrap",
    )
}

#[derive(Debug, Clone)]
pub enum StationClientErrorKind {
    SessionRevoked,
    HttpStatus(u16),
    Network,
    Decode,
    InvalidResponse,
}

#[derive(Debug, Clone)]
pub struct StationClientError {
    pub kind: StationClientErrorKind,
    pub message: String,
    pub details: Option<Value>,
}

#[derive(Debug, Clone)]
pub(crate) struct JsonHttpResponse {
    pub status: u16,
    pub headers: Value,
    pub body: Value,
}

impl StationClientError {
    pub(crate) fn new(
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
        match self.kind {
            StationClientErrorKind::SessionRevoked => {
                AppResult::fail(ErrorCode::Unauthorized, "session revoked", self.details)
            }
            StationClientErrorKind::HttpStatus(status) => {
                let code = if self
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
                };
                AppResult::fail(code, context.into(), self.details)
            }
            _ => AppResult::fail(ErrorCode::InternalError, context.into(), self.details),
        }
    }
}

impl fmt::Display for StationClientError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let error_code = self
            .details
            .as_ref()
            .and_then(|details| details.get("error_code"))
            .and_then(Value::as_str);
        match error_code {
            Some(code) => write!(f, "{} [code={}]", self.message, code),
            None => write!(f, "{}", self.message),
        }
    }
}

impl std::error::Error for StationClientError {}

/// Best-effort extractor for Station session-revoked responses.
///
/// Station returns `401 {"code":"session_revoked","reason":"expired|kicked|..."}`.
/// We normalize this into a compact JSON object for `details` so upper layers
/// never need to parse raw strings.
pub fn session_revoked_details_from_text(text: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(text).ok()?;
    let code = v.get("code").and_then(|x| x.as_str())?;
    if code != "session_revoked" {
        return None;
    }
    let reason = v
        .get("reason")
        .and_then(|x| x.as_str())
        .unwrap_or("unknown");
    let mut details = serde_json::json!({
        "code": "session_revoked",
        "reason": reason,
        "raw": text,
    });
    // Forward device_type so the frontend can filter revocations targeting
    // a different device type in multi-device mode (MCA-D19).
    if let Some(device_type) = v.get("device_type").and_then(|x| x.as_str()) {
        details["device_type"] = serde_json::json!(device_type);
    }
    Some(details)
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
        let reason = serde_json::from_str::<Value>(body)
            .ok()
            .and_then(|v| {
                v.get("reason")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "unknown".to_string());
        tracing::warn!(path = %path, reason = %reason, "Session revoked by server");
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
        format!("station returned {} : {}", status, body),
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

pub(crate) fn station_base_url() -> String {
    // Prefer the registry's active URL if initialized and set.
    // Falls back to PEERS_STATION_URL env var when registry has no active
    // station (fresh install, or user hasn't selected one yet).
    let from_registry = STATION_REGISTRY.get().and_then(|reg| reg.active_url());
    from_registry.unwrap_or_else(|| {
        std::env::var("PEERS_STATION_URL")
            .unwrap_or_default()
            .trim_end_matches('/')
            .to_string()
    })
}

pub(crate) fn active_station_peer_id() -> Option<String> {
    let reg = STATION_REGISTRY.get()?;
    let active = reg.active_url()?;
    reg.list()
        .into_iter()
        .find(|entry| entry.url.trim_end_matches('/') == active.trim_end_matches('/'))
        .and_then(|entry| entry.peer_id)
        .filter(|peer_id| !peer_id.trim().is_empty())
}

fn build_client() -> Result<Client, StationClientError> {
    build_client_with_policy(StationTransportPolicy::Interactive)
}

fn build_client_with_policy(policy: StationTransportPolicy) -> Result<Client, StationClientError> {
    Client::builder()
        .timeout(policy.timeout())
        .build()
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to create HTTP client");
            StationClientError::new(
                StationClientErrorKind::Network,
                format!("create http client failed: {}", e),
                None,
            )
        })
}

/// Authenticated JSON POST — used by callers that need the v3 OSS
/// federation mint endpoint (and any future plain-JSON API on
/// Station). Returns the decoded response body unchanged so callers
/// can pull whichever fields they care about; on non-2xx the error
/// already carries the status / parsed body in `details`.
///
/// This is *not* a `PeersResponse` envelope — Station's
/// `/sub-oss/federation/token` returns a flat
/// `{token, expires_at, kid, peer_station_id}` object, mirroring
/// the rest of the OSS subserver's plain-JSON wire shape.
pub(crate) fn post_json_with_auth(
    path: &str,
    token: &str,
    body: Value,
) -> Result<Value, StationClientError> {
    let url = format!("{}{}", station_base_url(), path);
    tracing::debug!(path = %path, "→ station (json, auth)");

    let start = std::time::Instant::now();
    let client = build_client()?;

    let resp = client
        .post(&url)
        .bearer_auth(token)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&body);
    let resp = with_device_id(resp).send().map_err(|e| {
        let elapsed = start.elapsed().as_millis();
        tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR");
        StationClientError::new(
            StationClientErrorKind::Network,
            format!("request failed: {}", e),
            None,
        )
    })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();

    let body_text = resp.text().unwrap_or_default();
    if !status.is_success() {
        tracing::warn!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, body = %body_text, "← station FAIL");
        return Err(build_error_for_status(status.as_u16(), path, &body_text));
    }

    let result: Value = serde_json::from_str(&body_text).map_err(|e| {
        tracing::error!(path = %path, error = %e, body = %body_text, "← station JSON_ERROR");
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode json response failed: {}", e),
            None,
        )
    })?;

    tracing::debug!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station OK (json, auth)");
    Ok(result)
}

// JSON POST without auth — used for login where no token exists yet.
pub(crate) fn post_json_no_auth(path: &str, body: Value) -> Result<Value, StationClientError> {
    let url = format!("{}{}", station_base_url(), path);
    tracing::debug!(path = %path, "→ station (json, no-auth)");

    let start = std::time::Instant::now();
    let client = build_client()?;

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .map_err(|e| {
            let elapsed = start.elapsed().as_millis();
            tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR");
            StationClientError::new(StationClientErrorKind::Network, format!("request failed: {}", e), None)
        })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();

    let body_text = resp.text().unwrap_or_default();

    if !status.is_success() {
        tracing::warn!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, body = %body_text, "← station FAIL");
        let parsed: Value = serde_json::from_str(&body_text).unwrap_or(Value::Null);
        let msg = parsed
            .get("message")
            .or_else(|| parsed.get("msg"))
            .and_then(|v| v.as_str())
            .unwrap_or(&body_text);
        return Err(StationClientError::new(
            StationClientErrorKind::HttpStatus(status.as_u16()),
            format!("station returned {}: {}", status.as_u16(), msg),
            Some(serde_json::json!({ "status": status.as_u16(), "body": parsed })),
        ));
    }

    let result: Value = serde_json::from_str(&body_text).map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station JSON_ERROR");
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode json response failed: {}", e),
            None,
        )
    })?;

    tracing::debug!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station OK (json, no-auth)");
    Ok(result)
}

/// Decode Touch `SuccessResponse` protobuf (`PeersResponse` with `google.protobuf.Any` data).
fn decode_peers_envelope<Payload: Message + Default>(
    raw: &[u8],
) -> Result<Payload, StationClientError> {
    let peers = PeersResponse::decode(raw).map_err(|e| {
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode PeersResponse: {}", e),
            None,
        )
    })?;
    let any = peers.data.ok_or_else(|| {
        StationClientError::new(
            StationClientErrorKind::InvalidResponse,
            "station response missing data envelope",
            None,
        )
    })?;
    Payload::decode(any.value.as_slice()).map_err(|e| {
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode envelope payload: {}", e),
            None,
        )
    })
}

/// Authenticated Touch frame call that returns a typed proto inside `PeersResponse`.
pub(crate) fn request_peers_proto_no_body<Payload: Message + Default>(
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
) -> Result<Payload, StationClientError> {
    let url = format!("{}{}", station_base_url(), path);
    tracing::debug!(method = %method, path = %path, "→ station (peers proto)");

    let start = std::time::Instant::now();
    let client = build_client()?;

    let mut req = with_device_id(client.request(method.clone(), &url).bearer_auth(token));

    if let Some(q) = query {
        req = req.query(q);
    }

    req = req
        .header("Content-Type", "application/protobuf")
        .header("Accept", "application/protobuf");

    let resp = req.send().map_err(|e| {
        let elapsed = start.elapsed().as_millis();
        tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR");
        StationClientError::new(
            StationClientErrorKind::Network,
            format!("request failed: {}", e),
            None,
        )
    })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();

    if !status.is_success() {
        let code = status.as_u16();
        let headers = headers_to_json(resp.headers());
        let text = resp.text().unwrap_or_default();
        tracing::warn!(path = %path, status = code, elapsed_ms = elapsed, body = %text, "← station FAIL");
        return Err(build_error_for_status_with_headers(
            code,
            path,
            &text,
            Some(&headers),
        ));
    }

    let bytes = resp.bytes().map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station DECODE_ERROR");
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("read body failed: {}", e),
            None,
        )
    })?;

    let resp_len = bytes.len();
    let result = decode_peers_envelope(bytes.as_ref())?;

    tracing::debug!(
        path = %path,
        status = status.as_u16(),
        elapsed_ms = elapsed,
        resp_bytes = resp_len,
        "← station OK (peers proto)"
    );

    Ok(result)
}

/// Touch `SuccessResponse` with no `data` payload (e.g. profile update success).
pub(crate) fn request_peers_proto_no_payload<Req: Message>(
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<&Req>,
) -> Result<(), StationClientError> {
    let url = format!("{}{}", station_base_url(), path);
    let body_len = body.map(|b| b.encoded_len()).unwrap_or(0);
    tracing::debug!(
        method = %method,
        path = %path,
        body_bytes = body_len,
        "→ station (peers proto, no payload)"
    );

    let start = std::time::Instant::now();
    let client = build_client()?;

    let mut req = with_device_id(client.request(method.clone(), &url).bearer_auth(token));

    if let Some(q) = query {
        req = req.query(q);
    }

    if let Some(b) = body {
        let buf = b.encode_to_vec();
        req = req.header("Content-Type", "application/protobuf").body(buf);
    } else {
        req = req.header("Content-Type", "application/protobuf");
    }

    req = req.header("Accept", "application/protobuf");

    let resp = req.send().map_err(|e| {
        let elapsed = start.elapsed().as_millis();
        tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR");
        StationClientError::new(
            StationClientErrorKind::Network,
            format!("request failed: {}", e),
            None,
        )
    })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();

    if !status.is_success() {
        let code = status.as_u16();
        let text = resp.text().unwrap_or_default();
        tracing::warn!(path = %path, status = code, elapsed_ms = elapsed, body = %text, "← station FAIL");
        return Err(build_error_for_status(code, path, &text));
    }

    let bytes = resp.bytes().map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station DECODE_ERROR");
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("read body failed: {}", e),
            None,
        )
    })?;

    let resp_len = bytes.len();
    PeersResponse::decode(bytes.as_ref()).map_err(|e| {
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode PeersResponse: {}", e),
            None,
        )
    })?;

    tracing::debug!(
        path = %path,
        status = status.as_u16(),
        elapsed_ms = elapsed,
        resp_bytes = resp_len,
        "← station OK (peers proto, no payload)"
    );

    Ok(())
}

/// Authenticated Touch frame POST with a protobuf body; response is `PeersResponse` → inner message.
pub(crate) fn request_peers_proto<Req, Payload>(
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
    let url = format!("{}{}", station_base_url(), path);
    let body_len = body.map(|b| b.encoded_len()).unwrap_or(0);
    tracing::debug!(
        method = %method,
        path = %path,
        body_bytes = body_len,
        "→ station (peers proto, body)"
    );

    let start = std::time::Instant::now();
    let client = build_client()?;

    let mut req = with_device_id(client.request(method.clone(), &url).bearer_auth(token));

    if let Some(q) = query {
        req = req.query(q);
    }

    if let Some(b) = body {
        let buf = b.encode_to_vec();
        req = req.header("Content-Type", "application/protobuf").body(buf);
    } else {
        req = req.header("Content-Type", "application/protobuf");
    }

    req = req.header("Accept", "application/protobuf");

    let resp = req.send().map_err(|e| {
        let elapsed = start.elapsed().as_millis();
        tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR");
        StationClientError::new(
            StationClientErrorKind::Network,
            format!("request failed: {}", e),
            None,
        )
    })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();

    if !status.is_success() {
        let code = status.as_u16();
        let text = resp.text().unwrap_or_default();
        tracing::warn!(path = %path, status = code, elapsed_ms = elapsed, body = %text, "← station FAIL");
        return Err(build_error_for_status(code, path, &text));
    }

    let bytes = resp.bytes().map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station DECODE_ERROR");
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("read body failed: {}", e),
            None,
        )
    })?;

    let resp_len = bytes.len();
    let result = decode_peers_envelope(bytes.as_ref())?;

    tracing::debug!(
        path = %path,
        status = status.as_u16(),
        elapsed_ms = elapsed,
        resp_bytes = resp_len,
        "← station OK (peers proto, body)"
    );

    Ok(result)
}

/// Profile-scoped authenticated protobuf call for typed handlers that return
/// the response message directly. Long-lived runtimes provide their endpoint
/// explicitly instead of reading the legacy global device header.
pub(crate) fn request_proto_for_device<Req, Payload>(
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
    request_proto_for_device_at(
        &station_base_url(),
        method,
        path,
        token,
        query,
        body,
        device_id,
    )
}

pub(crate) fn request_proto_for_device_at<Req, Payload>(
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
            StationClientErrorKind::Decode,
            "profile-scoped request requires device ID",
            None,
        ));
    }
    let url = format!("{}{}", station_url.trim_end_matches('/'), path);
    let start = std::time::Instant::now();
    let client = build_client()?;
    let mut req = client
        .request(method.clone(), &url)
        .bearer_auth(token)
        .header("X-Device-ID", device_id);
    if let Some(q) = query {
        req = req.query(q);
    }
    if let Some(body) = body {
        req = req
            .header("Content-Type", "application/protobuf")
            .body(body.encode_to_vec());
    } else {
        req = req.header("Content-Type", "application/protobuf");
    }
    let response = req
        .header("Accept", "application/protobuf")
        .send()
        .map_err(|error| {
            StationClientError::new(
                StationClientErrorKind::Network,
                format!("request failed: {error}"),
                None,
            )
        })?;
    let status = response.status();
    let headers = headers_to_json(response.headers());
    let bytes = response.bytes().map_err(|error| {
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("read body failed: {error}"),
            None,
        )
    })?;
    if !status.is_success() {
        let body = String::from_utf8_lossy(&bytes).to_string();
        tracing::warn!(
            path = %path,
            status = status.as_u16(),
            elapsed_ms = start.elapsed().as_millis(),
            body = %body,
            "← station FAIL (profile-scoped proto)",
        );
        return Err(build_error_for_status_with_headers(
            status.as_u16(),
            path,
            &body,
            Some(&headers),
        ));
    }
    tracing::debug!(
        path = %path,
        status = status.as_u16(),
        elapsed_ms = start.elapsed().as_millis(),
        "← station OK (profile-scoped proto)"
    );
    Payload::decode(bytes.as_ref()).map_err(|error| {
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode proto response failed: {error}"),
            None,
        )
    })
}

/// Unauthenticated protobuf call returning a direct typed response.
///
/// This is intentionally limited to endpoints whose authority is carried by
/// their signed protobuf body, such as terminal capability-receipt recovery.
pub(crate) fn request_proto_no_auth<Req, Payload>(
    method: Method,
    path: &str,
    body: &Req,
) -> Result<Payload, StationClientError>
where
    Req: Message,
    Payload: Message + Default,
{
    request_proto_no_auth_at(&station_base_url(), method, path, body)
}

pub(crate) fn request_proto_no_auth_at<Req, Payload>(
    station_url: &str,
    method: Method,
    path: &str,
    body: &Req,
) -> Result<Payload, StationClientError>
where
    Req: Message,
    Payload: Message + Default,
{
    let url = format!("{}{}", station_url.trim_end_matches('/'), path);
    let start = std::time::Instant::now();
    let response = build_client()?
        .request(method, &url)
        .header("Content-Type", "application/protobuf")
        .header("Accept", "application/protobuf")
        .body(body.encode_to_vec())
        .send()
        .map_err(|error| {
            StationClientError::new(
                StationClientErrorKind::Network,
                format!("request failed: {error}"),
                None,
            )
        })?;
    let status = response.status();
    let bytes = response.bytes().map_err(|error| {
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("read body failed: {error}"),
            None,
        )
    })?;
    if !status.is_success() {
        let body = String::from_utf8_lossy(&bytes).to_string();
        return Err(build_error_for_status(status.as_u16(), path, &body));
    }
    tracing::debug!(
        path = %path,
        status = status.as_u16(),
        elapsed_ms = start.elapsed().as_millis(),
        "← station OK (signed no-auth proto)"
    );
    Payload::decode(bytes.as_ref()).map_err(|error| {
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode proto response failed: {error}"),
            None,
        )
    })
}

/// POST protobuf without auth (e.g. oauth-bridge). Expects `PeersResponse` wire format.
pub(crate) fn post_peers_proto_no_auth<Req, Payload>(
    path: &str,
    body: &Req,
) -> Result<Payload, StationClientError>
where
    Req: Message,
    Payload: Message + Default,
{
    let url = format!("{}{}", station_base_url(), path);
    tracing::debug!(path = %path, body_bytes = body.encoded_len(), "→ station (peers proto, no-auth)");

    let start = std::time::Instant::now();
    let client = build_client()?;

    let buf = body.encode_to_vec();
    let resp = client
        .post(&url)
        .header("Content-Type", "application/protobuf")
        .header("Accept", "application/protobuf")
        .body(buf)
        .send()
        .map_err(|e| {
            let elapsed = start.elapsed().as_millis();
            tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR");
            StationClientError::new(StationClientErrorKind::Network, format!("request failed: {}", e), None)
        })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();

    let bytes = resp.bytes().map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station DECODE_ERROR");
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("read body failed: {}", e),
            None,
        )
    })?;

    if !status.is_success() {
        let msg = String::from_utf8_lossy(&bytes).to_string();
        tracing::warn!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station FAIL");
        return Err(StationClientError::new(
            StationClientErrorKind::HttpStatus(status.as_u16()),
            format!("station returned {}: {}", status.as_u16(), msg),
            Some(serde_json::json!({ "status": status.as_u16(), "body": msg })),
        ));
    }

    tracing::debug!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station OK (peers proto, no-auth)");
    decode_peers_envelope(bytes.as_ref())
}

// JSON-based request for chat APIs (group_chat, social, etc.).
// Sends/receives JSON with Content-Type: application/json.
pub(crate) fn request_json(
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<Value>,
) -> Result<Value, StationClientError> {
    request_json_with_policy(
        method,
        path,
        token,
        query,
        body,
        StationTransportPolicy::Interactive,
    )
}

pub(crate) fn request_json_with_policy(
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<Value>,
    policy: StationTransportPolicy,
) -> Result<Value, StationClientError> {
    let url = format!("{}{}", station_base_url(), path);
    tracing::debug!(method = %method, path = %path, policy = ?policy, "→ station (json)");

    let start = std::time::Instant::now();
    let client = build_client_with_policy(policy)?;

    let mut req = with_device_id(client.request(method.clone(), &url).bearer_auth(token));

    if let Some(q) = query {
        req = req.query(q);
    }

    if let Some(b) = body {
        req = req.header("Content-Type", "application/json").json(&b);
    } else {
        req = req.header("Content-Type", "application/json");
    }

    req = req.header("Accept", "application/json");

    let resp = req.send().map_err(|e| {
        let elapsed = start.elapsed().as_millis();
        tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR");
        let details = e.is_timeout().then(|| {
            serde_json::json!({
                "reason": "request_timeout",
                "transportPolicy": policy.label(),
                "timeoutMs": policy.timeout().as_millis(),
            })
        });
        StationClientError::new(
            StationClientErrorKind::Network,
            format!("request failed: {}", e),
            details,
        )
    })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();

    if !status.is_success() {
        let code = status.as_u16();
        let text = resp.text().unwrap_or_default();
        tracing::warn!(path = %path, status = code, elapsed_ms = elapsed, body = %text, "← station FAIL");
        return Err(build_error_for_status(code, path, &text));
    }

    let result: Value = resp.json().map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station JSON_ERROR");
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode json response failed: {}", e),
            None,
        )
    })?;

    tracing::debug!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station OK (json)");
    Ok(result)
}

pub(crate) fn request_json_response(
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<Value>,
) -> Result<JsonHttpResponse, StationClientError> {
    let url = format!("{}{}", station_base_url(), path);
    request_json_response_url(method, path, &url, token, query, body)
}

pub(crate) fn request_json_response_base_url(
    base_url: &str,
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<Value>,
) -> Result<JsonHttpResponse, StationClientError> {
    let url = format!("{}{}", base_url.trim_end_matches('/'), path);
    request_json_response_url(method, path, &url, token, query, body)
}

fn request_json_response_url(
    method: Method,
    path: &str,
    url: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<Value>,
) -> Result<JsonHttpResponse, StationClientError> {
    tracing::debug!(method = %method, path = %path, "→ station (json response)");

    let start = std::time::Instant::now();
    let client = build_client()?;
    let mut req = with_device_id(client.request(method.clone(), url).bearer_auth(token));

    if let Some(q) = query {
        req = req.query(q);
    }

    if let Some(b) = body {
        req = req.header("Content-Type", "application/json").json(&b);
    } else {
        req = req.header("Content-Type", "application/json");
    }
    req = req.header("Accept", "application/json");

    let resp = req.send().map_err(|e| {
        let elapsed = start.elapsed().as_millis();
        tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR");
        StationClientError::new(
            StationClientErrorKind::Network,
            format!("request failed: {}", e),
            None,
        )
    })?;

    let status = resp.status().as_u16();
    let headers = headers_to_json(resp.headers());
    let text = resp.text().map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station DECODE_ERROR");
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("read body failed: {}", e),
            None,
        )
    })?;
    let body = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| Value::String(text));

    tracing::debug!(path = %path, status = status, elapsed_ms = start.elapsed().as_millis(), "← station RESPONSE (json)");
    Ok(JsonHttpResponse {
        status,
        headers,
        body,
    })
}

fn headers_to_json(headers: &HeaderMap) -> Value {
    let mut map = serde_json::Map::new();
    for (name, value) in headers.iter() {
        if let Ok(text) = value.to_str() {
            map.insert(name.as_str().to_string(), Value::String(text.to_string()));
        }
    }
    Value::Object(map)
}

pub(crate) fn request_proto<Req, Resp>(
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
    let url = format!("{}{}", station_base_url(), path);
    let body_len = body.map(|b| b.encoded_len()).unwrap_or(0);
    tracing::debug!(
        method = %method,
        path = %path,
        body_bytes = body_len,
        "→ station"
    );

    let start = std::time::Instant::now();
    let client = build_client()?;

    let mut req = with_device_id(client.request(method.clone(), &url).bearer_auth(token));

    if let Some(q) = query {
        req = req.query(q);
    }

    if let Some(b) = body {
        let buf = b.encode_to_vec();
        req = req.header("Content-Type", "application/protobuf").body(buf);
    } else {
        req = req.header("Content-Type", "application/protobuf");
    }

    req = req.header("Accept", "application/protobuf");

    let resp = req.send().map_err(|e| {
        let elapsed = start.elapsed().as_millis();
        tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR");
        StationClientError::new(
            StationClientErrorKind::Network,
            format!("request failed: {}", e),
            None,
        )
    })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();

    if !status.is_success() {
        let code = status.as_u16();
        let text = resp.text().unwrap_or_default();
        tracing::warn!(path = %path, status = code, elapsed_ms = elapsed, body = %text, "← station FAIL");
        return Err(build_error_for_status(code, path, &text));
    }

    let bytes = resp.bytes().map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station DECODE_ERROR");
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("read body failed: {}", e),
            None,
        )
    })?;

    let resp_len = bytes.len();
    let result = Resp::decode(bytes.as_ref()).map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station PROTO_ERROR");
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode proto response failed: {}", e),
            None,
        )
    })?;

    tracing::debug!(
        path = %path,
        status = status.as_u16(),
        elapsed_ms = elapsed,
        resp_bytes = resp_len,
        "← station OK"
    );

    Ok(result)
}

/// Authenticated JSON request — minimal helper for OSS subserver
/// endpoints that speak plain JSON (not the `PeersResponse`
/// protobuf envelope). Returns the parsed JSON body verbatim on
/// 2xx; on non-success we round-trip the same `build_error_for_status`
/// path the protobuf helpers use so callers see consistent error
/// kinds (HttpStatus / SessionRevoked / etc.).
///
/// `query` is appended verbatim — use `&[("foo", "bar".into())]`.
/// `body` is sent as JSON when `Some`. Pass `None` for GET / DELETE.
pub(crate) fn request_json_auth(
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<&Value>,
) -> Result<Value, StationClientError> {
    let current_device_id = device_id();
    request_json_auth_with_optional_device_id(
        method,
        path,
        token,
        query,
        body,
        current_device_id.as_deref(),
    )
}

pub(crate) fn request_json_auth_with_device_id(
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<&Value>,
    device_id: &str,
) -> Result<Value, StationClientError> {
    request_json_auth_with_optional_device_id(method, path, token, query, body, Some(device_id))
}

fn request_json_auth_with_optional_device_id(
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<&Value>,
    device_id: Option<&str>,
) -> Result<Value, StationClientError> {
    let url = format!("{}{}", station_base_url(), path);
    tracing::debug!(method = %method, path = %path, "→ station (json, auth)");

    let start = std::time::Instant::now();
    let client = build_client()?;

    let mut req = client
        .request(method.clone(), &url)
        .bearer_auth(token)
        .header("Accept", "application/json");
    if let Some(device_id) = device_id.filter(|id| !id.is_empty()) {
        req = req.header("X-Device-ID", device_id);
    }

    if let Some(q) = query {
        req = req.query(q);
    }
    if let Some(b) = body {
        req = req.json(b);
    } else if matches!(method, Method::POST | Method::PATCH | Method::PUT) {
        // POST / PATCH without a body still needs a content-type or
        // some servers (Hertz binders included) reject the request
        // with a confusing "missing body" error.
        req = req.header("Content-Type", "application/json");
    }

    let resp = req.send().map_err(|e| {
        let elapsed = start.elapsed().as_millis();
        tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR (json-auth)");
        StationClientError::new(StationClientErrorKind::Network, format!("request failed: {}", e), None)
    })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();
    let headers = headers_to_json(resp.headers());

    let bytes = resp.bytes().map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station READ_ERROR (json-auth)");
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("read body failed: {}", e),
            None,
        )
    })?;

    if !status.is_success() {
        let text = String::from_utf8_lossy(&bytes).to_string();
        tracing::warn!(
            path = %path,
            status = status.as_u16(),
            elapsed_ms = elapsed,
            body = %text,
            "← station FAIL (json-auth)",
        );
        return Err(build_error_for_status_with_headers(
            status.as_u16(),
            path,
            &text,
            Some(&headers),
        ));
    }

    // The OSS handlers return 204 No Content for some mutations;
    // surface that as `Value::Null` rather than failing on empty
    // body decode.
    if bytes.is_empty() {
        tracing::debug!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station OK (json-auth, empty)");
        return Ok(Value::Null);
    }

    let result: Value = serde_json::from_slice(&bytes).map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station JSON_ERROR (json-auth)");
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode json response failed: {}", e),
            None,
        )
    })?;
    let embedded_status = result
        .get("code")
        .and_then(|code| {
            code.as_u64()
                .or_else(|| code.as_str().and_then(|value| value.parse::<u64>().ok()))
        })
        .filter(|code| *code >= 400 && *code <= u16::MAX as u64);
    if let Some(status) = embedded_status {
        let text = result.to_string();
        tracing::warn!(
            path = %path,
            status,
            elapsed_ms = elapsed,
            body = %text,
            "← station FAIL (json-auth, embedded status)",
        );
        return Err(build_error_for_status(status as u16, path, &text));
    }
    tracing::debug!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station OK (json-auth)");
    Ok(result)
}

/// Upload a local file to Station OSS via multipart/form-data POST.
pub(crate) fn upload_multipart(
    path: &str,
    token: &str,
    file_path: &str,
    bucket: &str,
    visibility: &str,
    chat_session_id: Option<&str>,
) -> Result<serde_json::Value, StationClientError> {
    let url = format!("{}{}", station_base_url(), path);
    tracing::debug!(path = %path, file = %file_path, "→ station (multipart upload)");

    let start = std::time::Instant::now();
    let client = build_client()?;

    let mut form = reqwest::blocking::multipart::Form::new()
        .file("file", file_path)
        .map_err(|e| {
            StationClientError::new(
                StationClientErrorKind::Network,
                format!("failed to open file for upload: {}", e),
                None,
            )
        })?;
    form = form.text("bucket", bucket.to_string());
    form = form.text("visibility", visibility.to_string());
    if let Some(sid) = chat_session_id {
        form = form.text("chat_session_id", sid.to_string());
    }

    let resp = with_device_id(
        client
            .post(&url)
            .bearer_auth(token),
    )
        .multipart(form)
        .send()
        .map_err(|e| {
            let elapsed = start.elapsed().as_millis();
            tracing::error!(path = %path, elapsed_ms = elapsed, error = %e, "← station NETWORK_ERROR (multipart)");
            StationClientError::new(StationClientErrorKind::Network, format!("upload request failed: {}", e), None)
        })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();

    let result: serde_json::Value = resp.json().map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station JSON_ERROR (multipart)");
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode json response failed: {}", e),
            None,
        )
    })?;

    if !status.is_success() {
        let code_str = result.get("code").and_then(|v| v.as_str()).unwrap_or("");
        let msg = result
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        tracing::warn!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station FAIL (multipart)");
        return Err(build_error_for_status(
            status.as_u16(),
            path,
            &format!("{{\"code\":\"{}\",\"error\":\"{}\"}}", code_str, msg),
        ));
    }

    tracing::debug!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station OK (multipart)");
    Ok(result)
}

/// PUT a file's bytes to an absolute, pre-signed URL — used by the
/// presigned upload data path. The `url` is *not* prefixed with
/// `station_base_url`: it is the full URL the OSS subserver returned
/// from `/sub-oss/presign-upload`, which on S3-protocol backends is
/// the bucket endpoint, not the Station.
///
/// Headers from the presign response (notably `x-amz-checksum-sha256`
/// and `Content-Type`) must be echoed verbatim — the underlying store
/// rejects the upload otherwise. We do not bearer-auth here: the URL
/// signature *is* the auth.
pub(crate) fn put_presigned_url(
    url: &str,
    headers: &std::collections::HashMap<String, String>,
    file_path: &str,
) -> Result<(), StationClientError> {
    tracing::debug!(file = %file_path, "→ presigned PUT");
    let start = std::time::Instant::now();
    let client = Client::builder()
        // Presigned uploads can be much larger than typical Touch
        // requests; the per-file cap is enforced upstream by the
        // capabilities check, so timeout here just reflects "the
        // network is broken" and not "the file is too big".
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| {
            StationClientError::new(
                StationClientErrorKind::Network,
                format!("create http client failed: {}", e),
                None,
            )
        })?;

    let file = std::fs::File::open(file_path).map_err(|e| {
        StationClientError::new(
            StationClientErrorKind::Network,
            format!("open {}: {}", file_path, e),
            None,
        )
    })?;

    let mut req = client.put(url).body(file);
    for (k, v) in headers {
        req = req.header(k, v);
    }

    let resp = req.send().map_err(|e| {
        let elapsed = start.elapsed().as_millis();
        tracing::error!(elapsed_ms = elapsed, error = %e, "← presigned PUT NETWORK_ERROR");
        StationClientError::new(
            StationClientErrorKind::Network,
            format!("presigned put failed: {}", e),
            None,
        )
    })?;

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();
    if !status.is_success() {
        let body = resp.text().unwrap_or_default();
        tracing::warn!(status = status.as_u16(), elapsed_ms = elapsed, body = %body, "← presigned PUT FAIL");
        return Err(StationClientError::new(
            StationClientErrorKind::HttpStatus(status.as_u16()),
            format!("presigned put returned {}: {}", status.as_u16(), body),
            Some(serde_json::json!({"status": status.as_u16(), "body": body})),
        ));
    }
    tracing::debug!(
        status = status.as_u16(),
        elapsed_ms = elapsed,
        "← presigned PUT OK"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Station probe — lightweight health check + metadata fetch
// ---------------------------------------------------------------------------

/// Probe a station URL to check if it is reachable and fetch basic metadata.
///
/// Returns `(online, label, peer_id, peers_count)`. On any network or parse
/// error the station is reported as offline with `None` metadata fields.
pub(crate) fn probe_station(url: &str) -> (bool, Option<String>, Option<String>, Option<u32>) {
    let client = match Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::debug!(error = %e, url = %url, "probe_station: failed to build client");
            return (false, None, None, None);
        }
    };

    let base = url.trim_end_matches('/');

    // Primary reachability check via healthz endpoint.
    let health_ok = client
        .get(format!("{}/sub-oss/healthz", base))
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    if !health_ok {
        tracing::debug!(url = %base, "probe_station: healthz unreachable");
        return (false, None, None, None);
    }

    // Attempt to fetch bootstrap info for peer_id.
    let mut peer_id: Option<String> = None;
    let mut label: Option<String> = None;
    let mut peers_count: Option<u32> = None;

    if let Ok(resp) = client.get(format!("{}/sub-bootstrap/info", base)).send() {
        if let Ok(json) = resp.json::<Value>() {
            // Station may wrap in a `data` envelope or return flat.
            let data = json.get("data").unwrap_or(&json);
            peer_id = data
                .get("peer_id")
                .and_then(|v| v.as_str())
                .map(String::from);
            label = data
                .get("label")
                .or_else(|| data.get("name"))
                .and_then(|v| v.as_str())
                .map(String::from);
            peers_count = data
                .get("peers_count")
                .and_then(|v| v.as_u64())
                .map(|n| n as u32);
        }
    }

    tracing::debug!(
        url = %base,
        online = true,
        peer_id = ?peer_id,
        "probe_station: OK"
    );

    (true, label, peer_id, peers_count)
}

#[cfg(test)]
mod tests {
    use super::{build_error_for_status_with_headers, StationTransportPolicy};
    use crate::error::ErrorCode;
    use serde_json::json;
    use std::time::Duration;

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
        assert_eq!(StationTransportPolicy::Interactive.label(), "interactive");
        assert_eq!(
            StationTransportPolicy::TurnExecution.label(),
            "turn_execution"
        );
    }

    #[test]
    fn specialized_station_error_code_survives_json_transport() {
        let headers = json!({
            "x-peers-error-code": "AGENT_CANVAS_SINGLE_AGENT_NOT_READY",
            "x-peers-error-locale-key": "agent.errors.canvasSingleAgentNotReady",
            "x-peers-error-retryable": "false",
            "x-peers-error-terminal": "true",
            "x-peers-required-gate": "agent-v2-kernel-foundation-e2e",
        });
        let error = build_error_for_status_with_headers(
            409,
            "/sub-agent/agent/collaboration/create",
            "{\"error\":\"blocked\"}",
            Some(&headers),
        );
        let result = error.into_app_result::<serde_json::Value>("collaboration blocked");
        let app_error = result.error.expect("AppResult error");
        assert_eq!(app_error.code, ErrorCode::AgentCanvasSingleAgentNotReady);
        let details = app_error.details.expect("typed error details");
        assert_eq!(details["error_code"], "AGENT_CANVAS_SINGLE_AGENT_NOT_READY");
        assert_eq!(
            details["locale_key"],
            "agent.errors.canvasSingleAgentNotReady"
        );
        assert_eq!(details["retryable"], "false");
        assert_eq!(details["terminal"], "true");
        assert_eq!(details["required_gate"], "agent-v2-kernel-foundation-e2e");
    }

    #[test]
    fn station_error_display_includes_typed_error_code() {
        let error = build_error_for_status_with_headers(
            400,
            "/conversation/direct",
            "",
            Some(&json!({
                "x-peers-error-code": "CONVERSATION_INVALID_ARGUMENT",
            })),
        );

        assert_eq!(
            error.to_string(),
            "station returned 400 :  [code=CONVERSATION_INVALID_ARGUMENT]"
        );
    }

    #[test]
    fn typed_station_error_details_survive_json_transport() {
        let headers = json!({
            "x-peers-error-code": "ADMISSION_ACTIVE_MUTATION_CONFLICT",
            "x-peers-error-locale-key": "agent.errors.activeMutationConflict",
            "x-peers-error-retryable": "true",
            "x-peers-error-terminal": "true",
            "x-peers-error-details": r#"{
                "resource_kind":"agent",
                "resource_id":"agent-1",
                "expected_revision":"7",
                "actual_revision":"8",
                "operation":"application.prepare_group",
                "field":"home_station",
                "reason":"is not an active Federation Station",
                "ignored_string":"not-safe",
                "ignored_number":9
            }"#,
        });
        let error = build_error_for_status_with_headers(
            409,
            "/sub-agent/agent/update",
            "{\"error\":\"conflict\"}",
            Some(&headers),
        );
        let result = error.into_app_result::<serde_json::Value>("Agent update failed");
        let app_error = result.error.expect("AppResult error");
        assert_eq!(app_error.code, ErrorCode::Conflict);
        let details = app_error.details.expect("typed error details");
        assert_eq!(details["error_code"], "ADMISSION_ACTIVE_MUTATION_CONFLICT");
        assert_eq!(details["locale_key"], "agent.errors.activeMutationConflict");
        assert_eq!(details["retryable"], "true");
        assert_eq!(details["terminal"], "true");
        assert_eq!(details["resource_kind"], "agent");
        assert_eq!(details["resource_id"], "agent-1");
        assert_eq!(details["expected_revision"], "7");
        assert_eq!(details["actual_revision"], "8");
        assert_eq!(details["operation"], "application.prepare_group");
        assert_eq!(details["field"], "home_station");
        assert_eq!(details["reason"], "is not an active Federation Station");
        assert!(details.get("ignored_string").is_none());
        assert!(details.get("ignored_number").is_none());
    }

    #[test]
    fn lease_expiry_details_survive_json_transport() {
        let headers = json!({
            "x-peers-error-code": "CLIENT_LEASE_EXPIRED",
            "x-peers-error-locale-key": "agent.errors.clientLeaseExpired",
            "x-peers-error-retryable": "true",
            "x-peers-error-terminal": "false",
            "x-peers-error-details": r#"{
                "session_id":"capability-session-expired",
                "lease_id":"lease-expired",
                "expired_at":"2026-09-15T03:00:00Z",
                "device_signing_key_id":"must-not-cross"
            }"#,
        });
        let error = build_error_for_status_with_headers(
            409,
            "/sub-agent/agent/capability/requests/pull",
            "{\"error\":\"lease expired\"}",
            Some(&headers),
        );
        let result = error.into_app_result::<serde_json::Value>("Capability pull failed");
        let app_error = result.error.expect("AppResult error");
        assert_eq!(app_error.code, ErrorCode::Conflict);
        let details = app_error.details.expect("typed error details");
        assert_eq!(details["error_code"], "CLIENT_LEASE_EXPIRED");
        assert_eq!(details["locale_key"], "agent.errors.clientLeaseExpired");
        assert_eq!(details["retryable"], "true");
        assert_eq!(details["terminal"], "false");
        assert_eq!(details["session_id"], "capability-session-expired");
        assert_eq!(details["lease_id"], "lease-expired");
        assert_eq!(details["expired_at"], "2026-09-15T03:00:00Z");
        assert!(details.get("device_signing_key_id").is_none());
    }

    #[test]
    fn forbidden_actor_station_error_preserves_exact_resource_identity() {
        let headers = json!({
            "x-peers-error-code": "OWNERSHIP_FORBIDDEN_ACTOR",
            "x-peers-error-locale-key": "agent.errors.forbiddenActor",
            "x-peers-error-retryable": "false",
            "x-peers-error-terminal": "true",
            "x-peers-error-details": r#"{
                "resource_kind":"conversation",
                "resource_id":"conversation-owned-by-bob",
                "owner_ptid":"must-not-cross"
            }"#,
        });
        let error = build_error_for_status_with_headers(
            403,
            "/sub-agent/agent/turn/execute",
            "{\"error\":\"forbidden\"}",
            Some(&headers),
        );
        let result = error.into_app_result::<serde_json::Value>("Agent turn rejected");
        let app_error = result.error.expect("AppResult error");
        assert_eq!(app_error.code, ErrorCode::Forbidden);
        let details = app_error.details.expect("typed error details");
        assert_eq!(details["error_code"], "OWNERSHIP_FORBIDDEN_ACTOR");
        assert_eq!(details["locale_key"], "agent.errors.forbiddenActor");
        assert_eq!(details["retryable"], "false");
        assert_eq!(details["terminal"], "true");
        assert_eq!(details["resource_kind"], "conversation");
        assert_eq!(details["resource_id"], "conversation-owned-by-bob");
        assert!(details.get("owner_ptid").is_none());
    }

    #[test]
    fn malformed_error_details_fail_closed_without_losing_typed_headers() {
        for raw_details in ["not-json", "[\"agent-1\"]", r#"{"resource_id":7}"#] {
            let headers = json!({
                "x-peers-error-code": "ADMISSION_ACTIVE_MUTATION_CONFLICT",
                "x-peers-error-locale-key": "agent.errors.activeMutationConflict",
                "x-peers-error-retryable": "true",
                "x-peers-error-terminal": "true",
                "x-peers-error-details": raw_details,
            });
            let error = build_error_for_status_with_headers(
                409,
                "/sub-agent/agent/update",
                "{\"error\":\"conflict\"}",
                Some(&headers),
            );
            let result = error.into_app_result::<serde_json::Value>("Agent update failed");
            let details = result
                .error
                .expect("AppResult error")
                .details
                .expect("typed error details");
            assert_eq!(details["error_code"], "ADMISSION_ACTIVE_MUTATION_CONFLICT");
            assert_eq!(details["locale_key"], "agent.errors.activeMutationConflict");
            assert_eq!(details["retryable"], "true");
            assert_eq!(details["terminal"], "true");
            assert!(details.get("resource_id").is_none());
        }
    }
}
