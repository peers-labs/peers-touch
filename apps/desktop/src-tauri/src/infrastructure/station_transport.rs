use crate::infrastructure::station_registry::{
    route_attestation_is_current, StationEntry, StationRegistry, StationRouteCandidate,
    StationRouteHealth, StationRouteType,
};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::redirect::Policy;
use reqwest::{Method, StatusCode};
use station_libp2p_http::{Route, Transport};
use std::fmt;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

const MAX_PROXY_REQUEST_BYTES: usize = 64 * 1024 * 1024;

static STATION_PROXY: LazyLock<Mutex<Option<StationProxy>>> = LazyLock::new(|| Mutex::new(None));
static P2P_TRANSPORT: LazyLock<Mutex<Option<Transport>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Clone)]
struct StationProxy {
    origin: String,
    station_peer_id: String,
}

#[derive(Clone, Debug)]
pub(crate) struct RouteSnapshot {
    pub station_peer_id: String,
    pub route_revision: u64,
    pub route: StationRouteCandidate,
}

struct ProxyResponse {
    status: StatusCode,
    headers: HeaderMap,
    body: Box<dyn Read>,
}

#[derive(Debug)]
pub(crate) struct TransportError {
    message: String,
}

impl TransportError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for TransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for TransportError {}

pub(crate) fn active_route_snapshot(
    registry: &StationRegistry,
) -> Result<RouteSnapshot, TransportError> {
    let entry = registry
        .active_entry()
        .ok_or_else(|| TransportError::new("no active Station binding"))?;
    snapshot_from_entry(entry)
}

fn snapshot_from_entry(entry: StationEntry) -> Result<RouteSnapshot, TransportError> {
    let route = entry
        .active_route()
        .cloned()
        .ok_or_else(|| TransportError::new("active Station route is unavailable"))?;
    if matches!(
        route.health,
        StationRouteHealth::Unavailable | StationRouteHealth::Revoked
    ) || !route_attestation_is_current(&route, unix_ms())
    {
        return Err(TransportError::new(
            "active Station route is unavailable or expired",
        ));
    }
    Ok(RouteSnapshot {
        station_peer_id: entry.station_peer_id,
        route_revision: entry.route_revision,
        route,
    })
}

pub(crate) fn assert_route_current(
    registry: &StationRegistry,
    snapshot: &RouteSnapshot,
) -> Result<(), TransportError> {
    let current = active_route_snapshot(registry)?;
    if current.station_peer_id != snapshot.station_peer_id
        || current.route.route_id != snapshot.route.route_id
        || current.route_revision != snapshot.route_revision
    {
        return Err(TransportError::new(
            "Station route changed while the request was in flight",
        ));
    }
    Ok(())
}

pub(crate) fn is_relay(snapshot: &RouteSnapshot) -> bool {
    snapshot.route.route_type == StationRouteType::Relay
}

pub(crate) fn active_transport_origin(
    registry: &'static StationRegistry,
) -> Result<String, TransportError> {
    let snapshot = active_route_snapshot(registry)?;
    if is_relay(&snapshot) {
        standard_route(&snapshot)?;
    }
    let mut proxy = STATION_PROXY
        .lock()
        .map_err(|_| TransportError::new("Station proxy lock poisoned"))?;
    if let Some(existing) = proxy.as_ref() {
        if existing.station_peer_id == snapshot.station_peer_id {
            return Ok(existing.origin.clone());
        }
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| TransportError::new(format!("bind Station proxy: {error}")))?;
    let address = listener
        .local_addr()
        .map_err(|error| TransportError::new(format!("read Station proxy address: {error}")))?;
    let state = StationProxy {
        origin: format!("http://{address}"),
        station_peer_id: snapshot.station_peer_id,
    };
    let worker_state = state.clone();
    std::thread::Builder::new()
        .name("station-standard-proxy".to_string())
        .spawn(move || serve_proxy(listener, registry, worker_state))
        .map_err(|error| TransportError::new(format!("start Station proxy: {error}")))?;
    let origin = state.origin.clone();
    *proxy = Some(state);
    Ok(origin)
}

fn shared_transport() -> Result<Transport, TransportError> {
    let mut value = P2P_TRANSPORT
        .lock()
        .map_err(|_| TransportError::new("Station transport lock poisoned"))?;
    if let Some(existing) = value.as_ref() {
        return Ok(existing.clone());
    }
    let transport = Transport::start()
        .map_err(|error| TransportError::new(format!("start Station transport: {error}")))?;
    *value = Some(transport.clone());
    Ok(transport)
}

fn route_round_trip(
    snapshot: &RouteSnapshot,
    raw_request: &[u8],
) -> Result<ProxyResponse, TransportError> {
    if !is_relay(snapshot) {
        return direct_round_trip(&snapshot.route, raw_request);
    }
    let route = standard_route(snapshot)?;
    let response = shared_transport()?
        .round_trip(&route, raw_request)
        .map_err(|error| TransportError::new(error.to_string()))?;
    Ok(ProxyResponse {
        status: response.status,
        headers: response.headers,
        body: Box::new(response.body),
    })
}

fn direct_round_trip(
    route: &StationRouteCandidate,
    raw_request: &[u8],
) -> Result<ProxyResponse, TransportError> {
    let method = request_method(raw_request)
        .ok_or_else(|| TransportError::new("Station request method is missing"))?
        .parse::<Method>()
        .map_err(|_| TransportError::new("Station request method is invalid"))?;
    let target = request_target(raw_request)
        .ok_or_else(|| TransportError::new("Station request target is missing"))?;
    let header_end = find_header_end(raw_request)
        .ok_or_else(|| TransportError::new("Station request headers are incomplete"))?;
    let header_text = std::str::from_utf8(&raw_request[..header_end])
        .map_err(|_| TransportError::new("Station request headers are not UTF-8"))?;
    let endpoint = route.endpoint_origin.trim_end_matches('/');
    let url = format!("{endpoint}{target}");
    let client = Client::builder()
        .timeout(Duration::from_secs(305))
        .redirect(Policy::none())
        .build()
        .map_err(|error| TransportError::new(format!("create direct Station client: {error}")))?;
    let mut request = client.request(method, url);
    for line in header_text.lines().skip(1) {
        let Some((name, value)) = line.split_once(':') else {
            return Err(TransportError::new("Station request header is malformed"));
        };
        if name.eq_ignore_ascii_case("host")
            || name.eq_ignore_ascii_case("connection")
            || name.eq_ignore_ascii_case("content-length")
            || name.eq_ignore_ascii_case("transfer-encoding")
        {
            continue;
        }
        let name = HeaderName::from_bytes(name.trim().as_bytes())
            .map_err(|_| TransportError::new("Station request header name is invalid"))?;
        let value = HeaderValue::from_str(value.trim())
            .map_err(|_| TransportError::new("Station request header value is invalid"))?;
        request = request.header(name, value);
    }
    let body_offset = header_end + 4;
    if body_offset < raw_request.len() {
        request = request.body(raw_request[body_offset..].to_vec());
    }
    let response = request
        .send()
        .map_err(|error| TransportError::new(format!("direct Station request failed: {error}")))?;
    Ok(ProxyResponse {
        status: response.status(),
        headers: response.headers().clone(),
        body: Box::new(response),
    })
}

pub(crate) fn client_peer_id() -> Result<String, TransportError> {
    Ok(shared_transport()?.client_peer_id().to_string())
}

fn standard_route(snapshot: &RouteSnapshot) -> Result<Route, TransportError> {
    if !is_relay(snapshot) {
        return Err(TransportError::new(
            "active Station route is not a Circuit route",
        ));
    }
    let expected_spki = snapshot
        .route
        .inner_tls_spki_sha256
        .as_deref()
        .and_then(|value| value.try_into().ok())
        .ok_or_else(|| TransportError::new("Circuit route has no valid TLS SPKI pin"))?;
    let dial_multiaddr = snapshot
        .route
        .addresses
        .iter()
        .find(|address| address.contains("/p2p-circuit/"))
        .cloned()
        .ok_or_else(|| TransportError::new("Circuit route has no dial multiaddr"))?;
    Ok(Route {
        node_peer_id: snapshot.route.node_peer_id.clone(),
        dial_multiaddr,
        inner_tls_spki_sha256: expected_spki,
    })
}

fn serve_proxy(listener: TcpListener, registry: &'static StationRegistry, state: StationProxy) {
    for connection in listener.incoming() {
        let Ok(connection) = connection else {
            break;
        };
        let state = state.clone();
        std::thread::spawn(move || {
            if let Err(error) = serve_proxy_connection(connection, registry, &state) {
                tracing::warn!(error = %error, "Station standard proxy request failed");
            }
        });
    }
}

fn serve_proxy_connection(
    mut connection: TcpStream,
    registry: &StationRegistry,
    state: &StationProxy,
) -> Result<(), TransportError> {
    let timeout = Duration::from_secs(305);
    connection
        .set_read_timeout(Some(timeout))
        .and_then(|_| connection.set_write_timeout(Some(timeout)))
        .map_err(|error| TransportError::new(format!("configure Station proxy: {error}")))?;
    let request = read_http_request(&mut connection)?;
    let request_target = request_target(&request).unwrap_or("");
    let trace_attachment = request_target.starts_with("/conversation/attachments/objects/");
    let request_range = request_header(&request, "range").unwrap_or("");
    let started = Instant::now();
    let mut snapshot = active_route_snapshot(registry)?;
    if snapshot.station_peer_id != state.station_peer_id {
        return Err(TransportError::new(
            "Station proxy belongs to an inactive Station",
        ));
    }
    let mut response = match route_round_trip(&snapshot, &request) {
        Ok(response) => response,
        Err(first_error) => {
            let failed_route_id = snapshot.route.route_id.clone();
            snapshot = activate_failover(registry, &snapshot).map_err(|failover_error| {
                TransportError::new(format!(
                    "Station HTTP/2 request failed on {failed_route_id}: {first_error}; \
                     failover failed: {failover_error}"
                ))
            })?;
            if !request_is_replay_safe(&request) {
                return Err(TransportError::new(format!(
                    "Station HTTP/2 request outcome is unknown after route \
                     {failed_route_id} failed; active route changed to {}",
                    snapshot.route.route_id
                )));
            }
            route_round_trip(&snapshot, &request).map_err(|error| {
                TransportError::new(format!(
                    "Station HTTP request failed after failover to {}: {error}",
                    snapshot.route.route_id
                ))
            })?
        }
    };
    if trace_attachment {
        tracing::info!(
            request_target,
            request_range,
            status = response.status.as_u16(),
            response_headers_ms = started.elapsed().as_millis(),
            content_length = response
                .headers
                .get("content-length")
                .and_then(|value| value.to_str().ok())
                .unwrap_or(""),
            content_range = response
                .headers
                .get("content-range")
                .and_then(|value| value.to_str().ok())
                .unwrap_or(""),
            "Station attachment proxy response started"
        );
    }
    assert_route_current(registry, &snapshot)?;
    write!(
        connection,
        "HTTP/1.1 {} {}\r\n",
        response.status.as_u16(),
        response.status.canonical_reason().unwrap_or("")
    )
    .map_err(|error| TransportError::new(format!("write Station response: {error}")))?;
    for (name, value) in &response.headers {
        if name.as_str().eq_ignore_ascii_case("connection")
            || name.as_str().eq_ignore_ascii_case("transfer-encoding")
        {
            continue;
        }
        let value = value
            .to_str()
            .map_err(|_| TransportError::new("Station response header is invalid"))?;
        write!(connection, "{}: {}\r\n", name.as_str(), value)
            .map_err(|error| TransportError::new(format!("write Station response: {error}")))?;
    }
    write!(connection, "Connection: close\r\n\r\n")
        .map_err(|error| TransportError::new(format!("write Station response: {error}")))?;
    let mut buffer = [0_u8; 16 * 1024];
    let mut body_bytes = 0_u64;
    loop {
        let count = match response.body.read(&mut buffer) {
            Ok(count) => count,
            Err(error) => {
                let _ = activate_failover(registry, &snapshot);
                return Err(TransportError::new(format!(
                    "read Station response through {}: {error}",
                    snapshot.route.route_id
                )));
            }
        };
        if count == 0 {
            if trace_attachment {
                tracing::info!(
                    request_target,
                    body_bytes,
                    response_complete_ms = started.elapsed().as_millis(),
                    "Station attachment proxy response completed"
                );
            }
            return Ok(());
        }
        if trace_attachment && body_bytes == 0 {
            tracing::info!(
                request_target,
                count,
                first_body_chunk_ms = started.elapsed().as_millis(),
                "Station attachment proxy first response chunk"
            );
        }
        body_bytes = body_bytes.saturating_add(count as u64);
        assert_route_current(registry, &snapshot)?;
        connection
            .write_all(&buffer[..count])
            .and_then(|_| connection.flush())
            .map_err(|error| TransportError::new(format!("write Station response: {error}")))?;
    }
}

fn activate_failover(
    registry: &StationRegistry,
    failed: &RouteSnapshot,
) -> Result<RouteSnapshot, TransportError> {
    let entry = registry
        .failover_route(
            &failed.station_peer_id,
            &failed.route.route_id,
            failed.route_revision,
        )
        .map_err(|error| TransportError::new(format!("select Station failover route: {error}")))?;
    snapshot_from_entry(entry)
}

fn request_is_replay_safe(request: &[u8]) -> bool {
    matches!(request_method(request), Some("GET" | "HEAD" | "OPTIONS"))
}

fn request_method(request: &[u8]) -> Option<&str> {
    let line_end = request.windows(2).position(|window| window == b"\r\n")?;
    let request_line = std::str::from_utf8(&request[..line_end]).ok()?;
    request_line.split_whitespace().next()
}

fn request_target(request: &[u8]) -> Option<&str> {
    let line_end = request.windows(2).position(|window| window == b"\r\n")?;
    let request_line = std::str::from_utf8(&request[..line_end]).ok()?;
    request_line.split_whitespace().nth(1)
}

fn unix_ms() -> i64 {
    i64::try_from(time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000)
        .unwrap_or(i64::MAX)
}

fn request_header<'a>(request: &'a [u8], expected_name: &str) -> Option<&'a str> {
    let header_end = find_header_end(request)?;
    let headers = std::str::from_utf8(&request[..header_end]).ok()?;
    headers.lines().skip(1).find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case(expected_name)
            .then(|| value.trim())
    })
}

fn read_http_request(stream: &mut TcpStream) -> Result<Vec<u8>, TransportError> {
    let mut request = Vec::with_capacity(4096);
    let mut buffer = [0_u8; 16 * 1024];
    let header_end = loop {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| TransportError::new(format!("read Station request: {error}")))?;
        if count == 0 {
            return Err(TransportError::new("Station request ended before headers"));
        }
        request.extend_from_slice(&buffer[..count]);
        if request.len() > MAX_PROXY_REQUEST_BYTES {
            return Err(TransportError::new("Station request exceeds size limit"));
        }
        if let Some(index) = find_header_end(&request) {
            break index;
        }
    };
    let headers = std::str::from_utf8(&request[..header_end])
        .map_err(|_| TransportError::new("Station request headers are not UTF-8"))?;
    let content_length = request_content_length(headers)?;
    let total = header_end + 4 + content_length;
    if total > MAX_PROXY_REQUEST_BYTES {
        return Err(TransportError::new("Station request exceeds size limit"));
    }
    while request.len() < total {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| TransportError::new(format!("read Station request: {error}")))?;
        if count == 0 {
            return Err(TransportError::new("Station request body was truncated"));
        }
        request.extend_from_slice(&buffer[..count]);
    }
    request.truncate(total);
    Ok(request)
}

fn request_content_length(headers: &str) -> Result<usize, TransportError> {
    let mut content_length = None;
    for line in headers.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err(TransportError::new(
                "Station proxy does not accept Transfer-Encoding",
            ));
        }
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err(TransportError::new(
                    "Station request has duplicate Content-Length",
                ));
            }
            content_length =
                Some(value.trim().parse::<usize>().map_err(|_| {
                    TransportError::new("Station request has invalid Content-Length")
                })?);
        }
    }
    Ok(content_length.unwrap_or(0))
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_route_rejects_missing_circuit_and_pin() {
        let snapshot = RouteSnapshot {
            station_peer_id: "station-a".to_string(),
            route_revision: 1,
            route: StationRouteCandidate {
                node_peer_id: "node-a".to_string(),
                node_authorization_digest: vec![1; 32],
                authorization_epoch: 1,
                route_id: "route-a".to_string(),
                route_type: StationRouteType::Relay,
                transport: "libp2p_http_v1".to_string(),
                endpoint_origin: "https://station.example".to_string(),
                relay_peer_id: None,
                route_generation: 1,
                inner_tls_spki_sha256: None,
                addresses: Vec::new(),
                attestation_bytes: None,
                connection_grant: None,
                attestation_expires_at_unix_ms: None,
                last_verified_at: "2026-10-11T00:00:00Z".to_string(),
                last_success_at: None,
                health: crate::infrastructure::station_registry::StationRouteHealth::Available,
            },
        };
        assert!(standard_route(&snapshot).is_err());
    }

    #[test]
    fn proxy_rejects_chunked_and_ambiguous_lengths() {
        assert!(
            request_content_length("POST /upload HTTP/1.1\r\nTransfer-Encoding: chunked").is_err()
        );
        assert!(request_content_length(
            "POST /upload HTTP/1.1\r\nContent-Length: 4\r\nContent-Length: 4"
        )
        .is_err());
    }

    #[test]
    fn proxy_reads_range_header_case_insensitively() {
        let request = b"GET /object HTTP/1.1\r\nHost: station\r\nRange: bytes=0-31\r\n\r\n";
        assert_eq!(request_header(request, "range"), Some("bytes=0-31"));
    }

    #[test]
    fn failover_replays_reads_but_not_mutations_with_unknown_outcomes() {
        assert!(request_is_replay_safe(
            b"GET /events/stream HTTP/1.1\r\nHost: station\r\n\r\n"
        ));
        assert!(request_is_replay_safe(
            b"HEAD /object HTTP/1.1\r\nHost: station\r\n\r\n"
        ));
        assert!(!request_is_replay_safe(
            b"POST /conversation/messages HTTP/1.1\r\nHost: station\r\nContent-Length: 0\r\n\r\n"
        ));
    }

    #[test]
    fn direct_round_trip_streams_the_verified_route_response() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let count = stream.read(&mut request).unwrap();
            let request = std::str::from_utf8(&request[..count]).unwrap();
            assert!(request.starts_with("GET /conversation/messages?limit=1 HTTP/1.1\r\n"));
            assert!(request.contains("\r\nx-device-id: device-a\r\n"));
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                      Content-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}",
                )
                .unwrap();
        });
        let route = StationRouteCandidate {
            node_peer_id: "node-a".to_string(),
            node_authorization_digest: vec![1; 32],
            authorization_epoch: 1,
            route_id: "direct-a".to_string(),
            route_type: StationRouteType::Direct,
            transport: "http".to_string(),
            endpoint_origin: format!("http://{address}"),
            relay_peer_id: None,
            route_generation: 1,
            inner_tls_spki_sha256: None,
            addresses: vec![format!("http://{address}")],
            attestation_bytes: None,
            connection_grant: None,
            attestation_expires_at_unix_ms: None,
            last_verified_at: "2026-10-11T00:00:00Z".to_string(),
            last_success_at: None,
            health: StationRouteHealth::Available,
        };
        let mut response = direct_round_trip(
            &route,
            b"GET /conversation/messages?limit=1 HTTP/1.1\r\n\
              Host: station\r\nX-Device-ID: device-a\r\n\r\n",
        )
        .unwrap();
        let mut body = String::new();
        response.body.read_to_string(&mut body).unwrap();
        assert_eq!(response.status, StatusCode::OK);
        assert_eq!(body, "{\"ok\":true}");
        server.join().unwrap();
    }
}
