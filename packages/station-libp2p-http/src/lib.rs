use bytes::Bytes;
use http::{HeaderMap, HeaderName, HeaderValue, Method, Request, StatusCode, Uri};
use libp2p::futures::StreamExt;
use libp2p::swarm::{NetworkBehaviour, SwarmEvent};
use libp2p::{
    identify, identity, noise, ping, relay, tcp, yamux, Multiaddr, PeerId, StreamProtocol, Swarm,
    SwarmBuilder,
};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::future::poll_fn;
use std::io::{self, Cursor, Read};
use std::str::FromStr;
use std::sync::{mpsc, Arc};
use std::time::Duration;
use tokio::sync::mpsc as tokio_mpsc;
use tokio_rustls::TlsConnector;
use tokio_util::compat::FuturesAsyncReadCompatExt;
use x509_parser::parse_x509_certificate;

const STATION_HTTP_PROTOCOL: &str = "/peers-touch/station-http/1.0.0";
const MAX_HEADER_BYTES: usize = 32 << 10;
const MAX_BODY_BYTES: usize = 64 << 20;
const CONTROL_TIMEOUT: Duration = Duration::from_secs(15);
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(305);

#[derive(Clone, Debug)]
pub struct Route {
    pub node_peer_id: String,
    pub dial_multiaddr: String,
    pub inner_tls_spki_sha256: [u8; 32],
}

#[derive(Debug)]
pub struct TransportError(String);

impl TransportError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for TransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for TransportError {}

pub struct Response {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: BodyReader,
}

pub struct BodyReader {
    receiver: tokio_mpsc::Receiver<Result<Vec<u8>, String>>,
    current: Cursor<Vec<u8>>,
    complete: bool,
}

impl Read for BodyReader {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if self.current.position() < self.current.get_ref().len() as u64 {
            return self.current.read(output);
        }
        if self.complete {
            return Ok(0);
        }
        match self.receiver.blocking_recv() {
            Some(Ok(bytes)) => {
                self.current = Cursor::new(bytes);
                self.current.read(output)
            }
            Some(Err(error)) => {
                self.complete = true;
                Err(io::Error::other(error))
            }
            None => {
                self.complete = true;
                Ok(0)
            }
        }
    }
}

#[derive(Clone)]
pub struct Transport {
    client_peer_id: PeerId,
    commands: tokio_mpsc::UnboundedSender<DriverCommand>,
}

impl Transport {
    pub fn start() -> Result<Self, TransportError> {
        Self::start_with_identity(identity::Keypair::generate_ed25519())
    }

    pub fn start_with_identity(keypair: identity::Keypair) -> Result<Self, TransportError> {
        let client_peer_id = keypair.public().to_peer_id();
        let (command_sender, command_receiver) = tokio_mpsc::unbounded_channel();
        let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("station-libp2p-http".to_string())
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_multi_thread()
                    .worker_threads(2)
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let _ = ready_sender.send(Err(error.to_string()));
                        return;
                    }
                };
                runtime.block_on(async move {
                    let swarm = match build_swarm(keypair) {
                        Ok(swarm) => swarm,
                        Err(error) => {
                            let _ = ready_sender.send(Err(error.to_string()));
                            return;
                        }
                    };
                    let stream_control = swarm.behaviour().streams.new_control();
                    let _ = ready_sender.send(Ok(()));
                    Driver {
                        swarm,
                        stream_control,
                        commands: command_receiver,
                        active: HashSet::new(),
                        pending_dials: HashMap::new(),
                    }
                    .run()
                    .await;
                });
            })
            .map_err(|error| {
                TransportError::new(format!("start Station transport thread: {error}"))
            })?;
        ready_receiver
            .recv_timeout(CONTROL_TIMEOUT)
            .map_err(|_| TransportError::new("Station transport did not start"))?
            .map_err(TransportError::new)?;
        Ok(Self {
            client_peer_id,
            commands: command_sender,
        })
    }

    pub fn client_peer_id(&self) -> PeerId {
        self.client_peer_id
    }

    pub fn round_trip(
        &self,
        route: &Route,
        raw_request: &[u8],
    ) -> Result<Response, TransportError> {
        let peer = PeerId::from_str(&route.node_peer_id)
            .map_err(|error| TransportError::new(format!("invalid Node PeerID: {error}")))?;
        let address = Multiaddr::from_str(&route.dial_multiaddr)
            .map_err(|error| TransportError::new(format!("invalid Station route: {error}")))?;
        let request = parse_request(raw_request)?;
        let (dial_sender, dial_receiver) = mpsc::channel();
        self.commands
            .send(DriverCommand::Dial {
                peer,
                address,
                reply: dial_sender,
            })
            .map_err(|_| TransportError::new("Station transport is unavailable"))?;
        dial_receiver
            .recv_timeout(CONTROL_TIMEOUT)
            .map_err(|_| TransportError::new("Station route dial timed out"))?
            .map_err(TransportError::new)?;

        let (reply_sender, reply_receiver) = mpsc::channel();
        self.commands
            .send(DriverCommand::Request {
                peer,
                expected_spki: route.inner_tls_spki_sha256,
                request,
                reply: reply_sender,
            })
            .map_err(|_| TransportError::new("Station transport is unavailable"))?;
        reply_receiver
            .recv_timeout(RESPONSE_TIMEOUT)
            .map_err(|_| TransportError::new("Station HTTP response timed out"))?
            .map_err(TransportError::new)
    }
}

struct ParsedRequest {
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Vec<u8>,
}

fn parse_request(raw: &[u8]) -> Result<ParsedRequest, TransportError> {
    let header_end = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| TransportError::new("HTTP request has no header terminator"))?;
    if header_end > MAX_HEADER_BYTES {
        return Err(TransportError::new("HTTP request headers exceed 32 KiB"));
    }
    let head = std::str::from_utf8(&raw[..header_end])
        .map_err(|_| TransportError::new("HTTP request headers are not UTF-8"))?;
    let mut lines = head.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| TransportError::new("HTTP request line is missing"))?;
    let mut parts = request_line.split_whitespace();
    let method = Method::from_bytes(
        parts
            .next()
            .ok_or_else(|| TransportError::new("HTTP request method is missing"))?
            .as_bytes(),
    )
    .map_err(|_| TransportError::new("HTTP request method is invalid"))?;
    let uri = Uri::from_str(
        parts
            .next()
            .filter(|value| value.starts_with('/') && !value.starts_with("//"))
            .ok_or_else(|| TransportError::new("HTTP request target is invalid"))?,
    )
    .map_err(|_| TransportError::new("HTTP request target is invalid"))?;
    if parts.next() != Some("HTTP/1.1") || parts.next().is_some() {
        return Err(TransportError::new("HTTP request version is invalid"));
    }
    let mut headers = HeaderMap::new();
    let mut content_length = None;
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| TransportError::new("HTTP request header is invalid"))?;
        if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err(TransportError::new(
                "chunked proxy requests are not supported",
            ));
        }
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err(TransportError::new(
                    "HTTP request has duplicate Content-Length",
                ));
            }
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| TransportError::new("Content-Length is invalid"))?,
            );
            continue;
        }
        if name.eq_ignore_ascii_case("host")
            || name.eq_ignore_ascii_case("connection")
            || name.eq_ignore_ascii_case("keep-alive")
            || name.eq_ignore_ascii_case("proxy-connection")
            || name.eq_ignore_ascii_case("upgrade")
        {
            continue;
        }
        headers.append(
            HeaderName::from_bytes(name.trim().as_bytes())
                .map_err(|_| TransportError::new("HTTP header name is invalid"))?,
            HeaderValue::from_str(value.trim())
                .map_err(|_| TransportError::new("HTTP header value is invalid"))?,
        );
    }
    let body = raw[header_end + 4..].to_vec();
    if body.len() > MAX_BODY_BYTES || content_length.unwrap_or(0) != body.len() {
        return Err(TransportError::new("HTTP request body length is invalid"));
    }
    Ok(ParsedRequest {
        method,
        uri,
        headers,
        body,
    })
}

#[derive(NetworkBehaviour)]
struct Behaviour {
    relay: relay::client::Behaviour,
    streams: libp2p_stream::Behaviour,
    identify: identify::Behaviour,
    ping: ping::Behaviour,
}

enum DriverCommand {
    Dial {
        peer: PeerId,
        address: Multiaddr,
        reply: mpsc::Sender<Result<(), String>>,
    },
    Request {
        peer: PeerId,
        expected_spki: [u8; 32],
        request: ParsedRequest,
        reply: mpsc::Sender<Result<Response, String>>,
    },
}

struct Driver {
    swarm: Swarm<Behaviour>,
    stream_control: libp2p_stream::Control,
    commands: tokio_mpsc::UnboundedReceiver<DriverCommand>,
    active: HashSet<PeerId>,
    pending_dials: HashMap<PeerId, Vec<mpsc::Sender<Result<(), String>>>>,
}

impl Driver {
    async fn run(mut self) {
        loop {
            tokio::select! {
                command = self.commands.recv() => {
                    let Some(command) = command else { return };
                    self.handle_command(command);
                }
                event = self.swarm.select_next_some() => {
                    self.handle_event(event);
                }
            }
        }
    }

    fn handle_command(&mut self, command: DriverCommand) {
        match command {
            DriverCommand::Dial {
                peer,
                address,
                reply,
            } => {
                if self.active.contains(&peer) {
                    let _ = reply.send(Ok(()));
                    return;
                }
                let pending = self.pending_dials.entry(peer).or_default();
                pending.push(reply);
                if pending.len() > 1 {
                    return;
                }
                if let Err(error) = self.swarm.dial(address) {
                    self.finish_dial(peer, Err(error.to_string()));
                }
            }
            DriverCommand::Request {
                peer,
                expected_spki,
                request,
                reply,
            } => {
                if !self.active.contains(&peer) {
                    let _ = reply.send(Err("Station peer is not connected".to_string()));
                    return;
                }
                let control = self.stream_control.clone();
                let error_reply = reply.clone();
                tokio::spawn(async move {
                    if let Err(error) =
                        execute_request(control, peer, expected_spki, request, reply).await
                    {
                        // Sending after a response has already been projected is harmless:
                        // the synchronous caller has dropped this side of the channel.
                        let _ = error_reply.send(Err(error));
                    }
                });
            }
        }
    }

    fn handle_event(&mut self, event: SwarmEvent<BehaviourEvent>) {
        match event {
            SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                self.active.insert(peer_id);
                self.finish_dial(peer_id, Ok(()));
            }
            SwarmEvent::ConnectionClosed { peer_id, .. } => {
                self.active.remove(&peer_id);
            }
            SwarmEvent::OutgoingConnectionError { peer_id, error, .. } => {
                if let Some(peer_id) = peer_id {
                    self.finish_dial(peer_id, Err(error.to_string()));
                }
            }
            _ => {}
        }
    }

    fn finish_dial(&mut self, peer: PeerId, result: Result<(), String>) {
        if let Some(waiters) = self.pending_dials.remove(&peer) {
            for waiter in waiters {
                let _ = waiter.send(result.clone());
            }
        }
    }
}

async fn execute_request(
    mut control: libp2p_stream::Control,
    peer: PeerId,
    expected_spki: [u8; 32],
    parsed: ParsedRequest,
    reply: mpsc::Sender<Result<Response, String>>,
) -> Result<(), String> {
    let stream = control
        .open_stream(peer, StreamProtocol::new(STATION_HTTP_PROTOCOL))
        .await
        .map_err(|error| error.to_string())?;
    let tls = tls_connector(expected_spki)
        .connect(
            ServerName::try_from("peers-touch-station")
                .map_err(|error| error.to_string())?
                .to_owned(),
            stream.compat(),
        )
        .await
        .map_err(|error| format!("authenticate Station Node TLS: {error}"))?;
    let (mut sender, connection) = h2::client::handshake(tls)
        .await
        .map_err(|error| format!("start Station HTTP/2: {error}"))?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    sender = sender
        .ready()
        .await
        .map_err(|error| format!("Station HTTP/2 is not ready: {error}"))?;
    let mut builder = Request::builder().method(parsed.method).uri(parsed.uri);
    for (name, value) in &parsed.headers {
        builder = builder.header(name, value);
    }
    let request = builder
        .body(())
        .map_err(|error| format!("build Station HTTP/2 request: {error}"))?;
    let end_stream = parsed.body.is_empty();
    let (response_future, mut body_sender) = sender
        .send_request(request, end_stream)
        .map_err(|error| format!("send Station HTTP/2 headers: {error}"))?;
    if !end_stream {
        send_body(&mut body_sender, parsed.body).await?;
    }
    let response = response_future
        .await
        .map_err(|error| format!("read Station HTTP/2 headers: {error}"))?;
    let status = response.status();
    let headers = response.headers().clone();
    let mut body = response.into_body();
    let (body_sender, body_receiver) = tokio_mpsc::channel(8);
    reply
        .send(Ok(Response {
            status,
            headers,
            body: BodyReader {
                receiver: body_receiver,
                current: Cursor::new(Vec::new()),
                complete: false,
            },
        }))
        .map_err(|_| "Station HTTP caller was cancelled".to_string())?;
    while let Some(next) = body.data().await {
        match next {
            Ok(bytes) => {
                let length = bytes.len();
                if body_sender.send(Ok(bytes.to_vec())).await.is_err() {
                    return Ok(());
                }
                let _ = body.flow_control().release_capacity(length);
            }
            Err(error) => {
                let _ = body_sender.send(Err(error.to_string())).await;
                return Ok(());
            }
        }
    }
    Ok(())
}

async fn send_body(stream: &mut h2::SendStream<Bytes>, body: Vec<u8>) -> Result<(), String> {
    let mut offset = 0;
    while offset < body.len() {
        let end = (offset + 16 * 1024).min(body.len());
        let length = end - offset;
        stream.reserve_capacity(length);
        while stream.capacity() < length {
            match poll_fn(|context| stream.poll_capacity(context)).await {
                Some(Ok(_)) => {}
                Some(Err(error)) => return Err(error.to_string()),
                None => return Err("Station HTTP/2 request body closed".to_string()),
            }
        }
        stream
            .send_data(
                Bytes::copy_from_slice(&body[offset..end]),
                end == body.len(),
            )
            .map_err(|error| error.to_string())?;
        offset = end;
    }
    Ok(())
}

fn tls_connector(expected_spki: [u8; 32]) -> TlsConnector {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Arc::new(PinnedSpkiVerifier {
        expected_spki,
        provider: provider.clone(),
    });
    let mut config = ClientConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .expect("TLS 1.3 provider")
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"h2".to_vec()];
    TlsConnector::from(Arc::new(config))
}

#[derive(Debug)]
struct PinnedSpkiVerifier {
    expected_spki: [u8; 32],
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
            .map_err(|_| rustls::Error::General("invalid Node TLS certificate".to_string()))?;
        let digest = Sha256::digest(certificate.public_key().raw);
        if digest.as_slice() != self.expected_spki {
            return Err(rustls::Error::General(
                "Node TLS SPKI does not match the signed route".to_string(),
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

fn build_swarm(keypair: identity::Keypair) -> Result<Swarm<Behaviour>, TransportError> {
    SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_tcp(
            tcp::Config::default().nodelay(true),
            noise::Config::new,
            yamux::Config::default,
        )
        .map_err(|error| TransportError::new(format!("build TCP transport: {error}")))?
        .with_dns()
        .map_err(|error| TransportError::new(format!("build DNS transport: {error}")))?
        .with_relay_client(noise::Config::new, yamux::Config::default)
        .map_err(|error| TransportError::new(format!("build Relay transport: {error}")))?
        .with_behaviour(|key, relay| Behaviour {
            relay,
            streams: libp2p_stream::Behaviour::new(),
            identify: identify::Behaviour::new(identify::Config::new(
                "/peers-touch/native-http/1.0.0".to_string(),
                key.public(),
            )),
            ping: ping::Behaviour::default(),
        })
        .map_err(|error| TransportError::new(format!("build P2P behaviour: {error}")))
        .map(|builder| builder.build())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_timeout_covers_long_running_standard_requests() {
        assert_eq!(CONTROL_TIMEOUT, Duration::from_secs(15));
        assert_eq!(RESPONSE_TIMEOUT, Duration::from_secs(305));
        assert!(RESPONSE_TIMEOUT > CONTROL_TIMEOUT);
    }
}
