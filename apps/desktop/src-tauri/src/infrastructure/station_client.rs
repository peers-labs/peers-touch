use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_registry::StationRegistry;
use crate::model::common::PeersResponse;
use prost::Message;
use reqwest::blocking::Client;
use reqwest::Method;
use serde::Serialize;
use serde_json::Value;
use std::fmt;
use std::sync::OnceLock;

// ---------------------------------------------------------------------------
// Global station registry (initialized once during bootstrap)
// ---------------------------------------------------------------------------

static STATION_REGISTRY: OnceLock<StationRegistry> = OnceLock::new();

/// Initialize the global station registry. Must be called once during bootstrap
/// after the config directory is resolved.
pub(crate) fn init_station_registry(config_dir: &std::path::Path) {
    if STATION_REGISTRY.set(StationRegistry::new(config_dir)).is_err() {
        tracing::warn!("station_registry: already initialized, ignoring duplicate init");
    }
}

/// Access the global station registry. Panics if not yet initialized.
pub(crate) fn station_registry() -> &'static StationRegistry {
    STATION_REGISTRY
        .get()
        .expect("StationRegistry not initialized — init_station_registry must be called during bootstrap")
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
                let code = match status {
                    400 => ErrorCode::InvalidArgument,
                    401 => ErrorCode::Unauthorized,
                    403 => ErrorCode::Forbidden,
                    404 => ErrorCode::NotFound,
                    409 => ErrorCode::Conflict,
                    _ => ErrorCode::InternalError,
                };
                AppResult::fail(code, context.into(), self.details)
            }
            _ => AppResult::fail(ErrorCode::InternalError, context.into(), self.details),
        }
    }
}

impl fmt::Display for StationClientError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
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
    Some(serde_json::json!({
        "code": "session_revoked",
        "reason": reason,
        "raw": text,
    }))
}

fn build_error_for_status(status: u16, path: &str, body: &str) -> StationClientError {
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
    StationClientError::new(
        StationClientErrorKind::HttpStatus(status),
        format!("station returned {} : {}", status, body),
        Some(serde_json::json!({ "status": status, "body": body })),
    )
}

pub(crate) fn station_base_url() -> String {
    // Prefer the registry if already initialized (normal runtime path).
    // Falls back to env var before bootstrap completes or if registry
    // was never set up (e.g. unit tests running without full bootstrap).
    match STATION_REGISTRY.get() {
        Some(reg) => reg.active_url(),
        None => std::env::var("PEERS_STATION_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:18080".to_string())
            .trim_end_matches('/')
            .to_string(),
    }
}

fn build_client() -> Result<Client, StationClientError> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(15))
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
        .json(&body)
        .send()
        .map_err(|e| {
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

    let result: Value = resp.json().map_err(|e| {
        tracing::error!(path = %path, error = %e, "← station JSON_ERROR");
        StationClientError::new(
            StationClientErrorKind::Decode,
            format!("decode json response failed: {}", e),
            None,
        )
    })?;

    if !status.is_success() {
        let msg = result
            .get("message")
            .or_else(|| result.get("msg"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        tracing::warn!(path = %path, status = status.as_u16(), elapsed_ms = elapsed, "← station FAIL");
        return Err(StationClientError::new(
            StationClientErrorKind::HttpStatus(status.as_u16()),
            format!("station returned {}: {}", status.as_u16(), msg),
            Some(serde_json::json!({ "status": status.as_u16(), "body": result })),
        ));
    }

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

    let mut req = client.request(method.clone(), &url).bearer_auth(token);

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

    let mut req = client.request(method.clone(), &url).bearer_auth(token);

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

    let mut req = client.request(method.clone(), &url).bearer_auth(token);

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

// JSON-based request for chat APIs (friend_chat, group_chat).
// Sends/receives JSON with Content-Type: application/json.
pub(crate) fn request_json(
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<Value>,
) -> Result<Value, StationClientError> {
    let url = format!("{}{}", station_base_url(), path);
    tracing::debug!(method = %method, path = %path, "→ station (json)");

    let start = std::time::Instant::now();
    let client = build_client()?;

    let mut req = client.request(method.clone(), &url).bearer_auth(token);

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

    let mut req = client.request(method.clone(), &url).bearer_auth(token);

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
    let url = format!("{}{}", station_base_url(), path);
    tracing::debug!(method = %method, path = %path, "→ station (json, auth)");

    let start = std::time::Instant::now();
    let client = build_client()?;

    let mut req = client
        .request(method.clone(), &url)
        .bearer_auth(token)
        .header("Accept", "application/json");

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
        return Err(build_error_for_status(status.as_u16(), path, &text));
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

    let resp = client
        .post(&url)
        .bearer_auth(token)
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
pub(crate) fn probe_station(
    url: &str,
) -> (bool, Option<String>, Option<String>, Option<u32>) {
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
