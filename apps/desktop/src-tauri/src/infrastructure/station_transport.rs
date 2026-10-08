use crate::infrastructure::relay_tls::acceptance_relay_ca_der;
use crate::infrastructure::station_registry::{
    StationEntry, StationRegistry, StationRouteCandidate, StationRouteType,
};
use crate::model::federation::{
    relay_tunnel_frame, RelayTunnelCancel, RelayTunnelCloseReason, RelayTunnelData,
    RelayTunnelFrame, RelayTunnelOpen, RelayTunnelPurpose,
};
use prost::Message as _;
use rand::RngCore;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{
    ClientConfig, ClientConnection, DigitallySignedStruct, RootCertStore, SignatureScheme,
    StreamOwned,
};
use sha2::{Digest, Sha256};
use std::fmt;
use std::io::{self, Cursor, Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tungstenite::client::IntoClientRequest;
use tungstenite::http::header::SEC_WEBSOCKET_PROTOCOL;
use tungstenite::http::HeaderValue;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{client_tls_with_config, connect, Connector, Message, WebSocket};
use x509_parser::parse_x509_certificate;

const TUNNEL_PATH: &str = "/.well-known/peers-touch/tunnel";
const TUNNEL_SUBPROTOCOL: &str = "peers-touch.tunnel.v1";
const TUNNEL_PROTOCOL_VERSION: u32 = 1;
const MAX_OUTER_FRAME_BYTES: usize = 65 * 1024;
const DEFAULT_MAX_FRAME_BYTES: usize = 64 * 1024;
const MAX_PROXY_REQUEST_BYTES: usize = 32 * 1024 * 1024;

static RELAY_PROXY: LazyLock<Mutex<Option<RelayProxy>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Clone)]
struct RelayProxy {
    origin: String,
    snapshot: RouteSnapshot,
}

#[derive(Clone, Debug)]
pub(crate) struct RouteSnapshot {
    pub station_peer_id: String,
    pub route_revision: u64,
    pub route: StationRouteCandidate,
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
    if !is_relay(&snapshot) {
        return Ok(snapshot.route.endpoint_origin);
    }
    let mut proxy = RELAY_PROXY
        .lock()
        .map_err(|_| TransportError::new("Relay proxy lock poisoned"))?;
    if let Some(existing) = proxy.as_ref() {
        if existing.snapshot.station_peer_id == snapshot.station_peer_id
            && existing.snapshot.route.route_id == snapshot.route.route_id
            && existing.snapshot.route_revision == snapshot.route_revision
        {
            return Ok(existing.origin.clone());
        }
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| TransportError::new(format!("bind Relay proxy: {error}")))?;
    let address = listener
        .local_addr()
        .map_err(|error| TransportError::new(format!("read Relay proxy address: {error}")))?;
    let state = RelayProxy {
        origin: format!("http://{address}"),
        snapshot,
    };
    let worker_state = state.clone();
    std::thread::Builder::new()
        .name("station-relay-proxy".to_string())
        .spawn(move || serve_relay_proxy(listener, registry, worker_state))
        .map_err(|error| TransportError::new(format!("start Relay proxy: {error}")))?;
    let origin = state.origin.clone();
    *proxy = Some(state);
    Ok(origin)
}

fn serve_relay_proxy(listener: TcpListener, registry: &'static StationRegistry, state: RelayProxy) {
    for connection in listener.incoming() {
        let Ok(connection) = connection else {
            break;
        };
        let snapshot = state.snapshot.clone();
        std::thread::spawn(move || {
            if let Err(error) = serve_proxy_connection(connection, registry, &snapshot) {
                tracing::warn!(error = %error, "station Relay proxy request failed");
            }
        });
    }
}

fn serve_proxy_connection(
    mut connection: TcpStream,
    registry: &StationRegistry,
    snapshot: &RouteSnapshot,
) -> Result<(), TransportError> {
    let timeout = Duration::from_secs(305);
    connection
        .set_read_timeout(Some(timeout))
        .and_then(|_| connection.set_write_timeout(Some(timeout)))
        .map_err(|error| TransportError::new(format!("configure Relay proxy socket: {error}")))?;
    let request = read_http_request(&mut connection)?;
    let request = force_connection_close(request)?;
    if request_headers_accept_event_stream(&request) {
        return relay_stream_response(connection, registry, snapshot, &request, timeout);
    }
    let response = relay_round_trip(snapshot, &request, timeout)?;
    assert_route_current(registry, snapshot)?;
    connection
        .write_all(&response)
        .map_err(|error| TransportError::new(format!("write Relay proxy response: {error}")))?;
    Ok(())
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
    registry: &StationRegistry,
    snapshot: &RouteSnapshot,
    request: &[u8],
    timeout: Duration,
) -> Result<(), TransportError> {
    let mut stream = open_inner_tls(snapshot, timeout)?;
    stream
        .write_all(request)
        .and_then(|_| stream.flush())
        .map_err(|error| TransportError::new(format!("write inner stream request: {error}")))?;
    let mut buffer = [0_u8; 8192];
    loop {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| TransportError::new(format!("read inner stream response: {error}")))?;
        if count == 0 {
            return Ok(());
        }
        assert_route_current(registry, snapshot)?;
        connection.write_all(&buffer[..count]).map_err(|error| {
            TransportError::new(format!("write Relay proxy stream response: {error}"))
        })?;
        connection
            .flush()
            .map_err(|error| TransportError::new(format!("flush Relay proxy stream: {error}")))?;
    }
}

fn read_http_request(stream: &mut TcpStream) -> Result<Vec<u8>, TransportError> {
    let mut request = Vec::with_capacity(4096);
    let mut buffer = [0_u8; 8192];
    let header_end = loop {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| TransportError::new(format!("read Relay proxy request: {error}")))?;
        if count == 0 {
            return Err(TransportError::new(
                "Relay proxy request ended before headers",
            ));
        }
        request.extend_from_slice(&buffer[..count]);
        if request.len() > MAX_PROXY_REQUEST_BYTES {
            return Err(TransportError::new(
                "Relay proxy request exceeds size limit",
            ));
        }
        if let Some(index) = find_header_end(&request) {
            break index;
        }
    };
    let headers = std::str::from_utf8(&request[..header_end])
        .map_err(|_| TransportError::new("Relay proxy request headers are not UTF-8"))?;
    let content_length = request_content_length(headers)?;
    let total = header_end + 4 + content_length;
    if total > MAX_PROXY_REQUEST_BYTES {
        return Err(TransportError::new(
            "Relay proxy request exceeds size limit",
        ));
    }
    while request.len() < total {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| TransportError::new(format!("read Relay proxy body: {error}")))?;
        if count == 0 {
            return Err(TransportError::new(
                "Relay proxy request body was truncated",
            ));
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
                "Relay proxy does not accept Transfer-Encoding",
            ));
        }
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err(TransportError::new(
                    "Relay proxy request has duplicate Content-Length",
                ));
            }
            content_length = Some(value.trim().parse::<usize>().map_err(|_| {
                TransportError::new("Relay proxy request has invalid Content-Length")
            })?);
        }
    }
    Ok(content_length.unwrap_or(0))
}

fn response_content_length(headers: &str) -> Result<usize, TransportError> {
    let mut content_length = None;
    for line in headers.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err(TransportError::new(
                "Relay proxy does not accept chunked responses",
            ));
        }
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err(TransportError::new(
                    "Relay proxy response has duplicate Content-Length",
                ));
            }
            content_length = Some(value.trim().parse::<usize>().map_err(|_| {
                TransportError::new("Relay proxy response has invalid Content-Length")
            })?);
        }
    }
    content_length.ok_or_else(|| TransportError::new("Relay proxy response has no Content-Length"))
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

fn force_connection_close(request: Vec<u8>) -> Result<Vec<u8>, TransportError> {
    let header_end = find_header_end(&request)
        .ok_or_else(|| TransportError::new("Relay proxy request has no header terminator"))?;
    let headers = std::str::from_utf8(&request[..header_end])
        .map_err(|_| TransportError::new("Relay proxy request headers are not UTF-8"))?;
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

pub(crate) fn relay_round_trip(
    snapshot: &RouteSnapshot,
    request: &[u8],
    timeout: Duration,
) -> Result<Vec<u8>, TransportError> {
    if !is_relay(snapshot) {
        return Err(TransportError::new("active Station route is not Relay"));
    }
    let mut stream = open_inner_tls(snapshot, timeout)?;
    stream
        .write_all(request)
        .map_err(|error| TransportError::new(format!("write inner HTTP request: {error}")))?;
    stream
        .flush()
        .map_err(|error| TransportError::new(format!("flush inner HTTP request: {error}")))?;
    read_http_response(&mut stream)
}

fn read_http_response<R: Read>(stream: &mut R) -> Result<Vec<u8>, TransportError> {
    let mut response = Vec::with_capacity(4096);
    let mut buffer = [0_u8; 8192];
    let header_end = loop {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| TransportError::new(format!("read inner HTTP response: {error}")))?;
        if count == 0 {
            return Err(TransportError::new("Relay proxy response was truncated"));
        }
        response.extend_from_slice(&buffer[..count]);
        if response.len() > MAX_PROXY_REQUEST_BYTES {
            return Err(TransportError::new(
                "Relay proxy response exceeds size limit",
            ));
        }
        if let Some(index) = find_header_end(&response) {
            break index;
        }
    };
    let headers = std::str::from_utf8(&response[..header_end])
        .map_err(|_| TransportError::new("Relay proxy response headers are not UTF-8"))?;
    let content_length = response_content_length(headers)?;
    let total = header_end + 4 + content_length;
    if total > MAX_PROXY_REQUEST_BYTES {
        return Err(TransportError::new(
            "Relay proxy response exceeds size limit",
        ));
    }
    while response.len() < total {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| TransportError::new(format!("read inner HTTP response: {error}")))?;
        if count == 0 {
            return Err(TransportError::new("Relay proxy response was truncated"));
        }
        response.extend_from_slice(&buffer[..count]);
        if response.len() > MAX_PROXY_REQUEST_BYTES {
            return Err(TransportError::new(
                "Relay proxy response exceeds size limit",
            ));
        }
    }
    response.truncate(total);
    Ok(response)
}

fn open_inner_tls(
    snapshot: &RouteSnapshot,
    timeout: Duration,
) -> Result<StreamOwned<ClientConnection, TunnelStream>, TransportError> {
    let tunnel = open_relay_tunnel(snapshot, timeout)?;
    let expected_spki = snapshot
        .route
        .inner_tls_spki_sha256
        .clone()
        .filter(|value| value.len() == 32)
        .ok_or_else(|| TransportError::new("Relay route has no valid inner TLS SPKI pin"))?;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Arc::new(PinnedSpkiVerifier {
        expected_spki,
        provider: provider.clone(),
    });
    let mut config = ClientConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|error| TransportError::new(format!("configure inner TLS: {error}")))?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    let server_name = ServerName::try_from("peers-touch-station")
        .map_err(|_| TransportError::new("invalid inner TLS server name"))?
        .to_owned();
    let connection = ClientConnection::new(Arc::new(config), server_name)
        .map_err(|error| TransportError::new(format!("create inner TLS client: {error}")))?;
    Ok(StreamOwned::new(connection, tunnel))
}

fn open_relay_tunnel(
    snapshot: &RouteSnapshot,
    timeout: Duration,
) -> Result<TunnelStream, TransportError> {
    let mut endpoint = reqwest::Url::parse(&snapshot.route.endpoint_origin)
        .map_err(|error| TransportError::new(format!("invalid Relay endpoint: {error}")))?;
    match endpoint.scheme() {
        "https" => endpoint
            .set_scheme("wss")
            .map_err(|_| TransportError::new("could not select WSS transport"))?,
        "http" if endpoint.host_str().is_some_and(is_loopback_host) => endpoint
            .set_scheme("ws")
            .map_err(|_| TransportError::new("could not select WS transport"))?,
        _ => return Err(TransportError::new("Relay endpoint must use HTTPS")),
    }
    endpoint.set_path(TUNNEL_PATH);
    endpoint.set_query(None);
    endpoint.set_fragment(None);
    let relay_host = endpoint
        .host_str()
        .ok_or_else(|| TransportError::new("Relay endpoint has no host"))?
        .to_string();
    let relay_port = endpoint
        .port_or_known_default()
        .ok_or_else(|| TransportError::new("Relay endpoint has no port"))?;
    let mut request = endpoint
        .as_str()
        .into_client_request()
        .map_err(|error| TransportError::new(format!("build Relay WebSocket request: {error}")))?;
    request.headers_mut().insert(
        SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_static(TUNNEL_SUBPROTOCOL),
    );
    let connector = acceptance_relay_tls_connector()?;
    let (mut socket, response) = match connector {
        Some(connector) => {
            let address = (relay_host.as_str(), relay_port)
                .to_socket_addrs()
                .map_err(|error| TransportError::new(format!("resolve Relay endpoint: {error}")))?
                .next()
                .ok_or_else(|| TransportError::new("Relay endpoint did not resolve"))?;
            let stream = TcpStream::connect_timeout(&address, timeout)
                .map_err(|error| TransportError::new(format!("connect Relay: {error}")))?;
            stream
                .set_read_timeout(Some(timeout))
                .and_then(|_| stream.set_write_timeout(Some(timeout)))
                .map_err(|error| TransportError::new(format!("configure Relay socket: {error}")))?;
            client_tls_with_config(request, stream, None, Some(connector))
                .map_err(|error| TransportError::new(format!("open Relay WebSocket: {error}")))?
        }
        None => connect(request)
            .map_err(|error| TransportError::new(format!("open Relay WebSocket: {error}")))?,
    };
    if response
        .headers()
        .get(SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        != Some(TUNNEL_SUBPROTOCOL)
    {
        return Err(TransportError::new(
            "Relay WebSocket subprotocol was not confirmed",
        ));
    }
    set_socket_timeout(socket.get_mut(), timeout)?;

    let mut nonce = vec![0_u8; 32];
    rand::thread_rng().fill_bytes(&mut nonce);
    let open = RelayTunnelFrame {
        protocol_version: TUNNEL_PROTOCOL_VERSION,
        payload: Some(relay_tunnel_frame::Payload::Open(RelayTunnelOpen {
            route_id: snapshot.route.route_id.clone(),
            route_generation: snapshot.route.route_generation,
            client_nonce: nonce,
            connection_grant: snapshot.route.connection_grant.clone().unwrap_or_default(),
            target_station_peer_id: String::new(),
            purpose: RelayTunnelPurpose::ClientAccess as i32,
        })),
    };
    socket
        .send(Message::Binary(open.encode_to_vec().into()))
        .map_err(|error| TransportError::new(format!("send Relay TunnelOpen: {error}")))?;
    let opened = loop {
        let message = socket
            .read()
            .map_err(|error| TransportError::new(format!("read Relay TunnelOpened: {error}")))?;
        match message {
            Message::Binary(bytes) => {
                if bytes.len() > MAX_OUTER_FRAME_BYTES {
                    return Err(TransportError::new("Relay frame exceeds size limit"));
                }
                let frame = RelayTunnelFrame::decode(bytes.as_ref()).map_err(|error| {
                    TransportError::new(format!("decode Relay TunnelOpened: {error}"))
                })?;
                if frame.protocol_version != TUNNEL_PROTOCOL_VERSION {
                    return Err(TransportError::new("Relay protocol version mismatch"));
                }
                match frame.payload {
                    Some(relay_tunnel_frame::Payload::Opened(opened)) => break opened,
                    Some(relay_tunnel_frame::Payload::Close(close)) => {
                        return Err(TransportError::new(format!(
                            "Relay rejected tunnel with reason {}",
                            close.reason
                        )))
                    }
                    _ => return Err(TransportError::new("Relay did not return TunnelOpened")),
                }
            }
            Message::Ping(payload) => socket
                .send(Message::Pong(payload))
                .map_err(|error| TransportError::new(format!("reply Relay ping: {error}")))?,
            _ => {
                return Err(TransportError::new(
                    "Relay returned a non-binary tunnel frame",
                ))
            }
        }
    };
    if opened.tunnel_id == 0
        || opened.relay_nonce.len() != 32
        || opened.route_attestation.as_slice()
            != snapshot
                .route
                .attestation_bytes
                .as_deref()
                .unwrap_or_default()
    {
        return Err(TransportError::new(
            "Relay returned invalid or stale tunnel metadata",
        ));
    }
    let max_frame_bytes = opened
        .limits
        .as_ref()
        .map(|limits| limits.max_frame_bytes as usize)
        .filter(|value| *value > 0 && *value <= DEFAULT_MAX_FRAME_BYTES)
        .ok_or_else(|| TransportError::new("Relay returned invalid tunnel limits"))?;
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

fn acceptance_relay_tls_connector() -> Result<Option<Connector>, TransportError> {
    let Some(certificate) = acceptance_relay_ca_der()
        .map_err(|error| TransportError::new(format!("configure Relay trust: {error}")))?
    else {
        return Ok(None);
    };
    let mut roots = RootCertStore::empty();
    roots
        .add(CertificateDer::from(certificate))
        .map_err(|error| TransportError::new(format!("configure Relay trust: {error}")))?;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|error| TransportError::new(format!("configure Relay TLS: {error}")))?
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
    stream: &mut MaybeTlsStream<std::net::TcpStream>,
    timeout: Duration,
) -> Result<(), TransportError> {
    let tcp = match stream {
        MaybeTlsStream::Plain(stream) => stream,
        MaybeTlsStream::Rustls(stream) => stream.get_mut(),
        _ => return Err(TransportError::new("unsupported Relay TLS backend")),
    };
    tcp.set_read_timeout(Some(timeout))
        .and_then(|_| tcp.set_write_timeout(Some(timeout)))
        .map_err(|error| TransportError::new(format!("configure Relay timeout: {error}")))
}

struct TunnelStream {
    socket: WebSocket<MaybeTlsStream<std::net::TcpStream>>,
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
                Message::Binary(bytes) => {
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
                Message::Ping(payload) => self
                    .socket
                    .send(Message::Pong(payload))
                    .map_err(io::Error::other)?,
                Message::Close(_) => {
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
            .send(Message::Binary(frame.encode_to_vec().into()))
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
            .send(Message::Binary(frame.encode_to_vec().into()));
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::station_registry::{StationRouteHealth, StationRouteType};

    #[test]
    fn station_transport_rejects_non_relay_route() {
        let snapshot = RouteSnapshot {
            station_peer_id: "station-a".to_string(),
            route_revision: 1,
            route: StationRouteCandidate {
                route_id: "direct-a".to_string(),
                route_type: StationRouteType::Direct,
                transport: "direct_https".to_string(),
                endpoint_origin: "https://station.example".to_string(),
                relay_peer_id: None,
                route_generation: 1,
                inner_tls_spki_sha256: None,
                attestation_bytes: None,
                connection_grant: None,
                attestation_expires_at_unix_ms: None,
                last_verified_at: "2026-10-07T00:00:00Z".to_string(),
                last_success_at: None,
                health: StationRouteHealth::Available,
            },
        };
        assert!(relay_round_trip(&snapshot, b"", Duration::from_secs(1)).is_err());
    }

    #[test]
    fn station_transport_allows_only_loopback_plaintext_relay() {
        assert!(is_loopback_host("127.0.0.1"));
        assert!(is_loopback_host("::1"));
        assert!(is_loopback_host("localhost"));
        assert!(!is_loopback_host("relay.example"));
    }

    #[test]
    fn station_transport_adds_connection_close_once() {
        let request = b"GET /health HTTP/1.1\r\nHost: station\r\n\r\n".to_vec();
        let rewritten = force_connection_close(request).unwrap();
        let text = String::from_utf8(rewritten).unwrap();
        assert!(text.contains("\r\nConnection: close\r\n\r\n"));

        let request =
            b"GET /health HTTP/1.1\r\nHost: station\r\nConnection: close\r\n\r\n".to_vec();
        let rewritten = force_connection_close(request).unwrap();
        assert_eq!(
            String::from_utf8(rewritten)
                .unwrap()
                .matches("Connection: close")
                .count(),
            1
        );
    }

    #[test]
    fn station_transport_detects_event_stream_accept_header() {
        assert!(request_headers_accept_event_stream(
            b"GET /events/stream HTTP/1.1\r\nAccept: text/event-stream\r\n\r\n"
        ));
        assert!(!request_headers_accept_event_stream(
            b"GET /health HTTP/1.1\r\nAccept: application/json\r\n\r\n"
        ));
    }

    #[test]
    fn station_transport_rejects_chunked_proxy_requests() {
        let error = request_content_length("POST /upload HTTP/1.1\r\nTransfer-Encoding: chunked")
            .unwrap_err();

        assert_eq!(
            error.to_string(),
            "Relay proxy does not accept Transfer-Encoding"
        );
    }

    #[test]
    fn station_transport_rejects_ambiguous_content_length() {
        assert!(request_content_length(
            "POST /upload HTTP/1.1\r\nContent-Length: 4\r\nContent-Length: 4",
        )
        .is_err());
        assert!(
            request_content_length("POST /upload HTTP/1.1\r\nContent-Length: not-a-number",)
                .is_err()
        );
    }

    #[test]
    fn relay_response_stops_at_declared_content_length() {
        let mut response =
            Cursor::new(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabcignored".to_vec());
        assert_eq!(
            read_http_response(&mut response).unwrap(),
            b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabc"
        );
    }

    #[test]
    fn relay_response_rejects_missing_or_chunked_length() {
        assert!(
            read_http_response(&mut Cursor::new(b"HTTP/1.1 200 OK\r\n\r\nbody".to_vec())).is_err()
        );
        assert!(read_http_response(&mut Cursor::new(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n".to_vec()
        ))
        .is_err());
    }
}
