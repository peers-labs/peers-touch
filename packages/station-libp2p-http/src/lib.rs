use bytes::Bytes;
use http::{HeaderMap, Method, Request as HttpRequest, StatusCode, Uri};
use libp2p::futures::StreamExt;
use libp2p::swarm::{dial_opts::DialOpts, ConnectionId, NetworkBehaviour, SwarmEvent};
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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tokio::sync::mpsc as tokio_mpsc;
use tokio::sync::{OnceCell, Semaphore};
use tokio::task::{JoinHandle as AsyncJoinHandle, JoinSet};
use tokio_rustls::TlsConnector;
use tokio_util::compat::FuturesAsyncReadCompatExt;
use tokio_util::sync::CancellationToken;
use x509_parser::parse_x509_certificate;

const STATION_HTTP_PROTOCOL: &str = "/peers-touch/station-http/1.0.0";
const CONTROL_TIMEOUT: Duration = Duration::from_secs(15);
const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(10);
const DEFAULT_RESPONSE_TIMEOUT: Duration = Duration::from_secs(305);
const COMMAND_CAPACITY: usize = 64;
pub const MAX_IN_FLIGHT_REQUESTS: usize = 16;
const MAX_ROUTE_SESSIONS: usize = 24;
const RESPONSE_BODY_CAPACITY: usize = 8;
const REQUEST_CHUNK_BYTES: usize = 16 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransportIdentityProof {
    pub peer_id: String,
    pub public_key: Vec<u8>,
    pub signature: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Route {
    pub node_peer_id: String,
    pub dial_multiaddr: String,
    pub inner_tls_spki_sha256: [u8; 32],
    pub route_generation: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TrafficClass {
    Interactive,
    Realtime,
    Bulk,
}

pub enum RequestBody {
    Empty,
    Bytes(Vec<u8>),
    Reader {
        reader: Box<dyn Read + Send>,
        content_length: u64,
    },
}

impl fmt::Debug for RequestBody {
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

impl RequestBody {
    fn content_length(&self) -> u64 {
        match self {
            Self::Empty => 0,
            Self::Bytes(bytes) => bytes.len() as u64,
            Self::Reader { content_length, .. } => *content_length,
        }
    }
}

#[derive(Debug)]
pub struct Request {
    pub method: Method,
    pub uri: Uri,
    pub headers: HeaderMap,
    pub body: RequestBody,
    pub timeout: Duration,
    pub admission_timeout: Duration,
    pub traffic_class: TrafficClass,
    pub cancellation: CancellationToken,
}

impl Request {
    pub fn new(method: Method, uri: Uri) -> Self {
        Self {
            method,
            uri,
            headers: HeaderMap::new(),
            body: RequestBody::Empty,
            timeout: DEFAULT_RESPONSE_TIMEOUT,
            admission_timeout: DEFAULT_RESPONSE_TIMEOUT,
            traffic_class: TrafficClass::Interactive,
            cancellation: CancellationToken::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransportErrorKind {
    Overloaded,
    Cancelled,
    Timeout,
    Unavailable,
    InvalidRoute,
    Protocol,
    Shutdown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FailurePhase {
    BeforeSubmission,
    AfterSubmission,
}

#[derive(Debug)]
pub struct TransportError {
    kind: TransportErrorKind,
    phase: FailurePhase,
    message: String,
}

impl TransportError {
    fn new(kind: TransportErrorKind, phase: FailurePhase, message: impl Into<String>) -> Self {
        Self {
            kind,
            phase,
            message: message.into(),
        }
    }

    pub fn kind(&self) -> TransportErrorKind {
        self.kind
    }

    pub fn phase(&self) -> FailurePhase {
        self.phase
    }
}

impl fmt::Display for TransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
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
    cancellation: CancellationToken,
}

impl Read for BodyReader {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        if self.cancellation.is_cancelled() {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "Station response cancelled",
            ));
        }
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
                if self.cancellation.is_cancelled() {
                    Err(io::Error::new(
                        io::ErrorKind::ConnectionAborted,
                        "Station response cancelled",
                    ))
                } else {
                    Ok(0)
                }
            }
        }
    }
}

impl Drop for BodyReader {
    fn drop(&mut self) {
        self.cancellation.cancel();
    }
}

struct DriverLifecycle {
    join: Option<JoinHandle<()>>,
    stopped: Option<mpsc::Receiver<()>>,
    complete: bool,
}

struct Shared {
    client_peer_id: PeerId,
    identity: identity::Keypair,
    commands: tokio_mpsc::Sender<DriverCommand>,
    accepting: AtomicBool,
    shutdown: CancellationToken,
    lifecycle: Mutex<DriverLifecycle>,
}

pub struct TransportOwner {
    shared: Arc<Shared>,
}

#[derive(Clone)]
pub struct TransportHandle {
    shared: Arc<Shared>,
}

impl TransportOwner {
    pub fn start() -> Result<Self, TransportError> {
        Self::start_with_identity(identity::Keypair::generate_ed25519())
    }

    pub fn start_with_identity(keypair: identity::Keypair) -> Result<Self, TransportError> {
        let client_peer_id = keypair.public().to_peer_id();
        let driver_keypair = keypair.clone();
        let (command_sender, command_receiver) = tokio_mpsc::channel(COMMAND_CAPACITY);
        let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
        let (stopped_sender, stopped_receiver) = mpsc::sync_channel(1);
        let shutdown = CancellationToken::new();
        let driver_shutdown = shutdown.clone();
        let join = std::thread::Builder::new()
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
                        let _ = stopped_sender.send(());
                        return;
                    }
                };
                runtime.block_on(async move {
                    let swarm = match build_swarm(driver_keypair) {
                        Ok(swarm) => swarm,
                        Err(error) => {
                            let _ = ready_sender.send(Err(error.to_string()));
                            let _ = stopped_sender.send(());
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
                        requests: JoinSet::new(),
                        admission: Arc::new(Semaphore::new(MAX_IN_FLIGHT_REQUESTS)),
                        sessions: Arc::new(SessionPool::default()),
                        shutdown: driver_shutdown,
                    }
                    .run()
                    .await;
                    let _ = stopped_sender.send(());
                });
            })
            .map_err(|error| {
                TransportError::new(
                    TransportErrorKind::Unavailable,
                    FailurePhase::BeforeSubmission,
                    format!("start Station transport thread: {error}"),
                )
            })?;
        ready_receiver
            .recv_timeout(CONTROL_TIMEOUT)
            .map_err(|_| {
                TransportError::new(
                    TransportErrorKind::Timeout,
                    FailurePhase::BeforeSubmission,
                    "Station transport did not start",
                )
            })?
            .map_err(|message| {
                TransportError::new(
                    TransportErrorKind::Unavailable,
                    FailurePhase::BeforeSubmission,
                    message,
                )
            })?;
        Ok(Self {
            shared: Arc::new(Shared {
                client_peer_id,
                identity: keypair,
                commands: command_sender,
                accepting: AtomicBool::new(true),
                shutdown,
                lifecycle: Mutex::new(DriverLifecycle {
                    join: Some(join),
                    stopped: Some(stopped_receiver),
                    complete: false,
                }),
            }),
        })
    }

    pub fn handle(&self) -> TransportHandle {
        TransportHandle {
            shared: self.shared.clone(),
        }
    }

    pub fn client_peer_id(&self) -> PeerId {
        self.shared.client_peer_id
    }

    pub fn shutdown(&self, timeout: Duration) -> Result<(), TransportError> {
        self.shared.accepting.store(false, Ordering::Release);
        self.shared.shutdown.cancel();

        let stopped = {
            let mut lifecycle = self.shared.lifecycle.lock().map_err(|_| {
                TransportError::new(
                    TransportErrorKind::Shutdown,
                    FailurePhase::BeforeSubmission,
                    "Station transport lifecycle lock poisoned",
                )
            })?;
            if lifecycle.complete {
                return Ok(());
            }
            lifecycle.stopped.take()
        };
        let Some(stopped) = stopped else {
            return Err(TransportError::new(
                TransportErrorKind::Shutdown,
                FailurePhase::BeforeSubmission,
                "Station transport shutdown is already in progress",
            ));
        };
        if stopped.recv_timeout(timeout).is_err() {
            if let Ok(mut lifecycle) = self.shared.lifecycle.lock() {
                lifecycle.stopped = Some(stopped);
            }
            return Err(TransportError::new(
                TransportErrorKind::Timeout,
                FailurePhase::BeforeSubmission,
                "Station transport did not stop before the shutdown deadline",
            ));
        }
        let join = self
            .shared
            .lifecycle
            .lock()
            .map_err(|_| {
                TransportError::new(
                    TransportErrorKind::Shutdown,
                    FailurePhase::BeforeSubmission,
                    "Station transport lifecycle lock poisoned",
                )
            })?
            .join
            .take();
        if let Some(join) = join {
            join.join().map_err(|_| {
                TransportError::new(
                    TransportErrorKind::Shutdown,
                    FailurePhase::BeforeSubmission,
                    "Station transport driver panicked",
                )
            })?;
        }
        if let Ok(mut lifecycle) = self.shared.lifecycle.lock() {
            lifecycle.complete = true;
        }
        Ok(())
    }
}

impl Drop for TransportOwner {
    fn drop(&mut self) {
        let _ = self.shutdown(Duration::from_secs(5));
    }
}

impl TransportHandle {
    pub fn client_peer_id(&self) -> PeerId {
        self.shared.client_peer_id
    }

    pub fn sign_identity_proof(
        &self,
        message: &[u8],
    ) -> Result<TransportIdentityProof, TransportError> {
        if !self.shared.accepting.load(Ordering::Acquire) {
            return Err(TransportError::new(
                TransportErrorKind::Shutdown,
                FailurePhase::BeforeSubmission,
                "Station transport is draining",
            ));
        }
        let signature = self.shared.identity.sign(message).map_err(|error| {
            TransportError::new(
                TransportErrorKind::Unavailable,
                FailurePhase::BeforeSubmission,
                format!("sign Station transport identity proof: {error}"),
            )
        })?;
        Ok(TransportIdentityProof {
            peer_id: self.shared.client_peer_id.to_string(),
            public_key: self.shared.identity.public().encode_protobuf(),
            signature,
        })
    }

    pub fn round_trip(
        &self,
        route: &Route,
        mut request: Request,
    ) -> Result<Response, TransportError> {
        if !self.shared.accepting.load(Ordering::Acquire) {
            return Err(TransportError::new(
                TransportErrorKind::Shutdown,
                FailurePhase::BeforeSubmission,
                "Station transport is draining",
            ));
        }
        let peer = PeerId::from_str(&route.node_peer_id).map_err(|error| {
            TransportError::new(
                TransportErrorKind::InvalidRoute,
                FailurePhase::BeforeSubmission,
                format!("invalid Node PeerID: {error}"),
            )
        })?;
        let address = Multiaddr::from_str(&route.dial_multiaddr).map_err(|error| {
            TransportError::new(
                TransportErrorKind::InvalidRoute,
                FailurePhase::BeforeSubmission,
                format!("invalid Station route: {error}"),
            )
        })?;
        let timeout = request.timeout;
        let response_timeout =
            timeout.saturating_add(request.admission_timeout.min(request.timeout));
        let caller_cancellation = request.cancellation.clone();
        // Attempt cleanup must not cancel the caller's replay/subscriber scope.
        request.cancellation = caller_cancellation.child_token();
        let cancellation = request.cancellation.clone();
        let started = Instant::now();
        let dial_deadline = started + CONTROL_TIMEOUT.min(timeout);
        let submitted = Arc::new(AtomicBool::new(false));
        let (dial_sender, dial_receiver) = mpsc::channel();
        self.shared
            .commands
            .try_send(DriverCommand::Dial {
                peer,
                address,
                reply: dial_sender,
                cancellation: cancellation.clone(),
                deadline: dial_deadline,
            })
            .map_err(command_send_error)?;
        receive_reply(
            &dial_receiver,
            &caller_cancellation,
            &self.shared.shutdown,
            dial_deadline,
            &submitted,
        )
        .inspect_err(|_| cancellation.cancel())?
        .map_err(|message| {
            TransportError::new(
                TransportErrorKind::Unavailable,
                FailurePhase::BeforeSubmission,
                message,
            )
        })?;

        let (reply_sender, reply_receiver) = mpsc::channel();
        self.shared
            .commands
            .try_send(DriverCommand::Request {
                route: route.clone(),
                peer,
                request,
                reply: reply_sender,
                submitted: submitted.clone(),
            })
            .map_err(command_send_error)?;
        receive_reply(
            &reply_receiver,
            &caller_cancellation,
            &self.shared.shutdown,
            Instant::now() + response_timeout,
            &submitted,
        )
        .inspect_err(|_| cancellation.cancel())?
    }

    pub fn close_route(&self, route: &Route) -> Result<(), TransportError> {
        self.shared
            .commands
            .try_send(DriverCommand::CloseRoute(route.clone()))
            .map_err(command_send_error)
    }
}

fn receive_reply<T>(
    receiver: &mpsc::Receiver<T>,
    cancellation: &CancellationToken,
    shutdown: &CancellationToken,
    deadline: Instant,
    submitted: &AtomicBool,
) -> Result<T, TransportError> {
    loop {
        let failure = if shutdown.is_cancelled() {
            Some((
                TransportErrorKind::Shutdown,
                "Station transport is shutting down",
            ))
        } else if cancellation.is_cancelled() {
            Some((
                TransportErrorKind::Cancelled,
                "Station HTTP caller was cancelled",
            ))
        } else if Instant::now() >= deadline {
            Some((
                TransportErrorKind::Timeout,
                "Station transport reply timed out",
            ))
        } else {
            None
        };
        if let Some((kind, message)) = failure {
            return Err(TransportError::new(
                kind,
                submission_phase(submitted),
                message,
            ));
        }
        match receiver.recv_timeout(
            deadline
                .saturating_duration_since(Instant::now())
                .min(CANCELLATION_POLL_INTERVAL),
        ) {
            Ok(reply) => return Ok(reply),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                if cancellation.is_cancelled()
                    || shutdown.is_cancelled()
                    || Instant::now() >= deadline
                {
                    continue;
                }
                return Err(TransportError::new(
                    TransportErrorKind::Unavailable,
                    submission_phase(submitted),
                    "Station transport reply channel closed",
                ));
            }
        }
    }
}

fn command_send_error(error: tokio_mpsc::error::TrySendError<DriverCommand>) -> TransportError {
    match error {
        tokio_mpsc::error::TrySendError::Full(_) => TransportError::new(
            TransportErrorKind::Overloaded,
            FailurePhase::BeforeSubmission,
            "Station transport admission queue is full",
        ),
        tokio_mpsc::error::TrySendError::Closed(_) => TransportError::new(
            TransportErrorKind::Shutdown,
            FailurePhase::BeforeSubmission,
            "Station transport is unavailable",
        ),
    }
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
        cancellation: CancellationToken,
        deadline: Instant,
    },
    Request {
        route: Route,
        peer: PeerId,
        request: Request,
        reply: mpsc::Sender<Result<Response, TransportError>>,
        submitted: Arc<AtomicBool>,
    },
    CloseRoute(Route),
}

struct DialWaiter {
    reply: mpsc::Sender<Result<(), String>>,
    cancellation: CancellationToken,
    deadline: Instant,
}

struct PendingDial {
    connection_id: ConnectionId,
    waiters: Vec<DialWaiter>,
}

struct Driver {
    swarm: Swarm<Behaviour>,
    stream_control: libp2p_stream::Control,
    commands: tokio_mpsc::Receiver<DriverCommand>,
    active: HashSet<PeerId>,
    pending_dials: HashMap<PeerId, PendingDial>,
    requests: JoinSet<()>,
    admission: Arc<Semaphore>,
    sessions: Arc<SessionPool>,
    shutdown: CancellationToken,
}

impl Driver {
    async fn run(mut self) {
        let mut cancellation_poll = tokio::time::interval(CANCELLATION_POLL_INTERVAL);
        loop {
            tokio::select! {
                _ = self.shutdown.cancelled() => break,
                command = self.commands.recv() => {
                    let Some(command) = command else { break };
                    self.handle_command(command);
                }
                event = self.swarm.select_next_some() => self.handle_event(event),
                _ = cancellation_poll.tick(), if !self.pending_dials.is_empty() => {
                    self.retire_cancelled_dials();
                }
                result = self.requests.join_next(), if !self.requests.is_empty() => {
                    if result.is_some_and(|result| result.is_err()) {
                        // The request result is delivered through its reply channel.
                    }
                }
            }
        }
        self.fail_pending();
        self.shutdown.cancel();
        let drain = async { while self.requests.join_next().await.is_some() {} };
        if tokio::time::timeout(Duration::from_secs(4), drain)
            .await
            .is_err()
        {
            self.requests.abort_all();
            while self.requests.join_next().await.is_some() {}
        }
        self.sessions.shutdown().await;
    }

    fn handle_command(&mut self, command: DriverCommand) {
        match command {
            DriverCommand::Dial {
                peer,
                address,
                reply,
                cancellation,
                deadline,
            } => {
                self.retire_cancelled_dials();
                if cancellation.is_cancelled() || Instant::now() >= deadline {
                    let _ = reply.send(Err("Station route dial was cancelled".to_string()));
                    return;
                }
                if self.active.contains(&peer) {
                    let _ = reply.send(Ok(()));
                    return;
                }
                let waiter = DialWaiter {
                    reply,
                    cancellation,
                    deadline,
                };
                if let Some(pending) = self.pending_dials.get_mut(&peer) {
                    pending.waiters.push(waiter);
                    return;
                }
                let options = DialOpts::peer_id(peer).addresses(vec![address]).build();
                self.pending_dials.insert(
                    peer,
                    PendingDial {
                        connection_id: options.connection_id(),
                        waiters: vec![waiter],
                    },
                );
                if let Err(error) = self.swarm.dial(options) {
                    self.finish_dial(peer, Err(error.to_string()));
                }
            }
            DriverCommand::Request {
                route,
                peer,
                request,
                reply,
                submitted,
            } => {
                if !self.active.contains(&peer) {
                    let _ = reply.send(Err(TransportError::new(
                        TransportErrorKind::Unavailable,
                        FailurePhase::BeforeSubmission,
                        "Station peer is not connected",
                    )));
                    return;
                }
                let control = self.stream_control.clone();
                let sessions = self.sessions.clone();
                let admission = self.admission.clone();
                let shutdown = self.shutdown.clone();
                self.requests.spawn(async move {
                    execute_request(
                        control, sessions, route, peer, request, reply, admission, shutdown,
                        submitted,
                    )
                    .await;
                });
            }
            DriverCommand::CloseRoute(route) => {
                let detached = if let Ok(peer) = PeerId::from_str(&route.node_peer_id) {
                    let detached = self.sessions.detach_peer(&route.node_peer_id);
                    self.active.remove(&peer);
                    let _ = self.swarm.disconnect_peer_id(peer);
                    detached
                } else {
                    self.sessions.detach_route(&route)
                };
                self.requests.spawn(async move {
                    SessionPool::close_detached(detached).await;
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
            SwarmEvent::ConnectionClosed {
                peer_id,
                num_established,
                ..
            } => {
                if num_established == 0 {
                    self.active.remove(&peer_id);
                    let detached = self.sessions.detach_peer(&peer_id.to_string());
                    self.requests.spawn(async move {
                        SessionPool::close_detached(detached).await;
                    });
                }
            }
            SwarmEvent::OutgoingConnectionError {
                peer_id,
                connection_id,
                error,
                ..
            } => {
                if let Some(peer_id) = peer_id {
                    if self
                        .pending_dials
                        .get(&peer_id)
                        .is_some_and(|pending| pending.connection_id == connection_id)
                    {
                        self.finish_dial(peer_id, Err(error.to_string()));
                    }
                }
            }
            _ => {}
        }
    }

    fn finish_dial(&mut self, peer: PeerId, result: Result<(), String>) {
        if let Some(pending) = self.pending_dials.remove(&peer) {
            for waiter in pending.waiters {
                let _ = waiter.reply.send(result.clone());
            }
        }
    }

    fn retire_cancelled_dials(&mut self) {
        let now = Instant::now();
        self.pending_dials.retain(|peer, pending| {
            pending
                .waiters
                .retain(|waiter| !waiter.cancellation.is_cancelled() && now < waiter.deadline);
            if pending.waiters.is_empty() {
                // The driver has not admitted any request for this unconnected
                // peer. Upstream aborts its pending connections as well.
                let _ = self.swarm.disconnect_peer_id(*peer);
                false
            } else {
                true
            }
        });
    }

    fn fail_pending(&mut self) {
        for (_, pending) in self.pending_dials.drain() {
            for waiter in pending.waiters {
                let _ = waiter
                    .reply
                    .send(Err("Station transport is shutting down".to_string()));
            }
        }
        while let Ok(command) = self.commands.try_recv() {
            match command {
                DriverCommand::Dial { reply, .. } => {
                    let _ = reply.send(Err("Station transport is shutting down".to_string()));
                }
                DriverCommand::Request { reply, .. } => {
                    let _ = reply.send(Err(TransportError::new(
                        TransportErrorKind::Shutdown,
                        FailurePhase::BeforeSubmission,
                        "Station transport is shutting down",
                    )));
                }
                DriverCommand::CloseRoute(_) => {}
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct SessionKey {
    node_peer_id: String,
    dial_multiaddr: String,
    inner_tls_spki_sha256: [u8; 32],
    route_generation: u64,
    traffic_class: TrafficClass,
}

impl SessionKey {
    fn new(route: &Route, traffic_class: TrafficClass) -> Self {
        Self {
            node_peer_id: route.node_peer_id.clone(),
            dial_multiaddr: route.dial_multiaddr.clone(),
            inner_tls_spki_sha256: route.inner_tls_spki_sha256,
            route_generation: route.route_generation,
            traffic_class,
        }
    }

    fn belongs_to(&self, route: &Route) -> bool {
        self.node_peer_id == route.node_peer_id
            && self.dial_multiaddr == route.dial_multiaddr
            && self.inner_tls_spki_sha256 == route.inner_tls_spki_sha256
            && self.route_generation == route.route_generation
    }
}

struct Session {
    sender: h2::client::SendRequest<Bytes>,
    cancellation: CancellationToken,
    connection: Mutex<Option<AsyncJoinHandle<()>>>,
}

impl Session {
    async fn close(&self) {
        self.cancellation.cancel();
        let connection = self
            .connection
            .lock()
            .ok()
            .and_then(|mut connection| connection.take());
        if let Some(connection) = connection {
            let _ = connection.await;
        }
    }
}

#[derive(Default)]
struct SessionPool {
    sessions: Mutex<HashMap<SessionKey, Arc<SessionSlot>>>,
}

#[derive(Default)]
struct SessionSlot {
    session: OnceCell<Arc<Session>>,
    cancellation: CancellationToken,
}

impl SessionSlot {
    async fn close(&self) {
        self.cancellation.cancel();
        if let Some(session) = self.session.get() {
            session.close().await;
        }
    }
}

impl SessionPool {
    async fn get_or_open(
        &self,
        control: libp2p_stream::Control,
        peer: PeerId,
        route: &Route,
        traffic_class: TrafficClass,
    ) -> Result<(SessionKey, Arc<Session>), TransportError> {
        let key = SessionKey::new(route, traffic_class);
        let slot = {
            let mut sessions = self.sessions.lock().map_err(|_| {
                TransportError::new(
                    TransportErrorKind::Unavailable,
                    FailurePhase::BeforeSubmission,
                    "Station route-session pool lock is unavailable",
                )
            })?;
            if !sessions.contains_key(&key) && sessions.len() >= MAX_ROUTE_SESSIONS {
                return Err(TransportError::new(
                    TransportErrorKind::Overloaded,
                    FailurePhase::BeforeSubmission,
                    "Station HTTP/2 route-session capacity is exhausted",
                ));
            }
            sessions.entry(key.clone()).or_default().clone()
        };
        let session = slot.session.get_or_try_init(|| async {
            tokio::select! {
                _ = slot.cancellation.cancelled() => Err(TransportError::new(
                    TransportErrorKind::Cancelled, FailurePhase::BeforeSubmission, "Station route session was closed"
                )),
                result = Self::open_session(control, peer, route) => result,
            }
        }).await?.clone();
        Ok((key, session))
    }

    async fn open_session(
        mut control: libp2p_stream::Control,
        peer: PeerId,
        route: &Route,
    ) -> Result<Arc<Session>, TransportError> {
        let stream = control
            .open_stream(peer, StreamProtocol::new(STATION_HTTP_PROTOCOL))
            .await
            .map_err(|error| {
                TransportError::new(
                    TransportErrorKind::Unavailable,
                    FailurePhase::BeforeSubmission,
                    error.to_string(),
                )
            })?;
        let tls = tls_connector(route.inner_tls_spki_sha256)
            .connect(
                ServerName::try_from("peers-touch-station")
                    .expect("static Station TLS name")
                    .to_owned(),
                stream.compat(),
            )
            .await
            .map_err(|error| {
                TransportError::new(
                    TransportErrorKind::Protocol,
                    FailurePhase::BeforeSubmission,
                    format!("authenticate Station Node TLS: {error}"),
                )
            })?;
        let (sender, connection) = h2::client::handshake(tls).await.map_err(|error| {
            TransportError::new(
                TransportErrorKind::Protocol,
                FailurePhase::BeforeSubmission,
                format!("start Station HTTP/2: {error}"),
            )
        })?;
        let cancellation = CancellationToken::new();
        let connection_cancellation = cancellation.clone();
        let connection = tokio::spawn(async move {
            tokio::select! {
                _ = connection_cancellation.cancelled() => {}
                _ = connection => {}
            }
        });
        let session = Arc::new(Session {
            sender,
            cancellation,
            connection: Mutex::new(Some(connection)),
        });
        Ok(session)
    }

    async fn invalidate(&self, key: &SessionKey) {
        let session = self
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(key));
        if let Some(session) = session {
            session.close().await;
        }
    }

    fn detach_route(&self, route: &Route) -> Vec<Arc<SessionSlot>> {
        self.detach_matching(|key| key.belongs_to(route))
    }

    fn detach_peer(&self, node_peer_id: &str) -> Vec<Arc<SessionSlot>> {
        self.detach_matching(|key| key.node_peer_id == node_peer_id)
    }

    fn detach_matching(&self, predicate: impl Fn(&SessionKey) -> bool) -> Vec<Arc<SessionSlot>> {
        let Ok(mut current) = self.sessions.lock() else {
            return Vec::new();
        };
        let keys = current
            .keys()
            .filter(|key| predicate(key))
            .cloned()
            .collect::<Vec<_>>();
        keys.into_iter()
            .filter_map(|key| current.remove(&key))
            .collect()
    }

    async fn close_detached(sessions: Vec<Arc<SessionSlot>>) {
        for session in sessions {
            session.close().await;
        }
    }

    async fn shutdown(&self) {
        let sessions = self.detach_matching(|_| true);
        Self::close_detached(sessions).await;
    }
}

async fn execute_request(
    control: libp2p_stream::Control,
    sessions: Arc<SessionPool>,
    route: Route,
    peer: PeerId,
    request: Request,
    reply: mpsc::Sender<Result<Response, TransportError>>,
    admission: Arc<Semaphore>,
    shutdown: CancellationToken,
    submitted: Arc<AtomicBool>,
) {
    let timeout = request.timeout;
    let admission_timeout = request.admission_timeout.min(timeout);
    let request_cancellation = request.cancellation.clone();
    let permit = tokio::select! {
        _ = shutdown.cancelled() => Err(TransportError::new(
            TransportErrorKind::Shutdown,
            FailurePhase::BeforeSubmission,
            "Station transport is shutting down",
        )),
        _ = request_cancellation.cancelled() => Err(TransportError::new(
            TransportErrorKind::Cancelled,
            FailurePhase::BeforeSubmission,
            "Station HTTP caller was cancelled before admission",
        )),
        result = tokio::time::timeout(admission_timeout, admission.acquire_owned()) => match result {
            Ok(Ok(permit)) => Ok(permit),
            Ok(Err(_)) => Err(TransportError::new(
                TransportErrorKind::Shutdown,
                FailurePhase::BeforeSubmission,
                "Station transport admission is closed",
            )),
            Err(_) => Err(TransportError::new(
                TransportErrorKind::Overloaded,
                FailurePhase::BeforeSubmission,
                "Station transport request admission timed out",
            )),
        },
    };
    let _permit = match permit {
        Ok(permit) => permit,
        Err(error) => {
            let _ = reply.send(Err(error));
            return;
        }
    };
    let deadline = tokio::time::Instant::now() + timeout;
    let result = tokio::select! {
        _ = shutdown.cancelled() => Err(TransportError::new(
            TransportErrorKind::Shutdown,
            submission_phase(&submitted),
            "Station transport is shutting down",
        )),
        _ = request_cancellation.cancelled() => Err(TransportError::new(
            TransportErrorKind::Cancelled,
            submission_phase(&submitted),
            "Station HTTP caller was cancelled",
        )),
        result = tokio::time::timeout(
            timeout,
            execute_request_inner(control, sessions.clone(), &route, peer, request, deadline, submitted.clone()),
        ) => match result {
            Ok(result) => result,
            Err(_) => {
                request_cancellation.cancel();
                Err(TransportError::new(
                    TransportErrorKind::Timeout,
                    submission_phase(&submitted),
                    "Station HTTP response timed out",
                ))
            },
        },
    };
    if result.is_err() && submitted.load(Ordering::Acquire) {
        let detached = sessions.detach_route(&route);
        SessionPool::close_detached(detached).await;
    }
    match result {
        Ok((response, body)) => {
            if reply.send(Ok(response)).is_ok() {
                body.forward(shutdown).await;
            }
        }
        Err(error) => {
            let _ = reply.send(Err(error));
        }
    }
}

fn submission_phase(submitted: &AtomicBool) -> FailurePhase {
    if submitted.load(Ordering::Acquire) {
        FailurePhase::AfterSubmission
    } else {
        FailurePhase::BeforeSubmission
    }
}

async fn execute_request_inner(
    control: libp2p_stream::Control,
    sessions: Arc<SessionPool>,
    route: &Route,
    peer: PeerId,
    request: Request,
    deadline: tokio::time::Instant,
    submitted: Arc<AtomicBool>,
) -> Result<(Response, ResponseBodyForwarder), TransportError> {
    let cancellation = request.cancellation.clone();
    let traffic_class = request.traffic_class;
    let (key, session) = sessions
        .get_or_open(control, peer, route, traffic_class)
        .await?;
    let result = send_over_session(session, request, cancellation, deadline, submitted).await;
    if result.is_err() {
        sessions.invalidate(&key).await;
    }
    result
}

async fn send_over_session(
    session: Arc<Session>,
    request: Request,
    cancellation: CancellationToken,
    deadline: tokio::time::Instant,
    submitted: Arc<AtomicBool>,
) -> Result<(Response, ResponseBodyForwarder), TransportError> {
    let content_length = request.body.content_length();
    let mut builder = HttpRequest::builder()
        .method(request.method)
        .uri(request.uri);
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }
    if !request.headers.contains_key(http::header::CONTENT_LENGTH) {
        builder = builder.header(http::header::CONTENT_LENGTH, content_length);
    }
    let request_head = builder.body(()).map_err(|error| {
        TransportError::new(
            TransportErrorKind::Protocol,
            FailurePhase::BeforeSubmission,
            format!("build Station HTTP/2 request: {error}"),
        )
    })?;
    let mut sender = session.sender.clone().ready().await.map_err(|error| {
        TransportError::new(
            TransportErrorKind::Unavailable,
            FailurePhase::BeforeSubmission,
            format!("Station HTTP/2 is not ready: {error}"),
        )
    })?;
    let end_stream = content_length == 0;
    let (response_future, mut body_sender) = sender
        .send_request(request_head, end_stream)
        .map_err(|error| {
            TransportError::new(
                TransportErrorKind::Unavailable,
                FailurePhase::BeforeSubmission,
                format!("send Station HTTP/2 headers: {error}"),
            )
        })?;
    submitted.store(true, Ordering::Release);
    if !end_stream {
        send_body(&mut body_sender, request.body, cancellation.clone()).await?;
    }
    let response = tokio::select! {
        _ = cancellation.cancelled() => {
            return Err(TransportError::new(
                TransportErrorKind::Cancelled,
                FailurePhase::AfterSubmission,
                "Station HTTP caller was cancelled",
            ));
        }
        response = response_future => response.map_err(|error| {
            TransportError::new(
                TransportErrorKind::Unavailable,
                FailurePhase::AfterSubmission,
                format!("read Station HTTP/2 headers: {error}"),
            )
        })?,
    };
    let status = response.status();
    let headers = response.headers().clone();
    let body = response.into_body();
    let (body_sender, body_receiver) = tokio_mpsc::channel(RESPONSE_BODY_CAPACITY);
    let forwarder = ResponseBodyForwarder {
        body,
        sender: body_sender,
        cancellation: cancellation.clone(),
        deadline,
    };
    Ok((
        Response {
            status,
            headers,
            body: BodyReader {
                receiver: body_receiver,
                current: Cursor::new(Vec::new()),
                complete: false,
                cancellation,
            },
        },
        forwarder,
    ))
}

struct ResponseBodyForwarder {
    body: h2::RecvStream,
    sender: tokio_mpsc::Sender<Result<Vec<u8>, String>>,
    cancellation: CancellationToken,
    deadline: tokio::time::Instant,
}

impl ResponseBodyForwarder {
    async fn forward(mut self, shutdown: CancellationToken) {
        loop {
            let next = tokio::select! {
                _ = shutdown.cancelled() => { self.cancellation.cancel(); return; },
                _ = self.cancellation.cancelled() => return,
                _ = self.sender.closed() => return,
                _ = tokio::time::sleep_until(self.deadline) => {
                    let _ = self.sender.try_send(Err("Station HTTP response body timed out".to_string()));
                    self.cancellation.cancel();
                    return;
                }
                next = self.body.data() => next,
            };
            match next {
                Some(Ok(bytes)) => {
                    let length = bytes.len();
                    tokio::select! {
                        _ = shutdown.cancelled() => { self.cancellation.cancel(); return; },
                        _ = self.cancellation.cancelled() => return,
                        _ = tokio::time::sleep_until(self.deadline) => { self.cancellation.cancel(); return; },
                        sent = self.sender.send(Ok(bytes.to_vec())) => { if sent.is_err() { return; } },
                    }
                    let _ = self.body.flow_control().release_capacity(length);
                }
                Some(Err(error)) => {
                    let _ = self.sender.try_send(Err(error.to_string()));
                    return;
                }
                None => return,
            }
        }
    }
}

async fn send_body(
    stream: &mut h2::SendStream<Bytes>,
    body: RequestBody,
    cancellation: CancellationToken,
) -> Result<(), TransportError> {
    match body {
        RequestBody::Empty => Ok(()),
        RequestBody::Bytes(bytes) => send_bytes(stream, bytes, cancellation).await,
        RequestBody::Reader {
            mut reader,
            content_length,
        } => {
            let mut sent = 0_u64;
            loop {
                let read = tokio::task::spawn_blocking(move || {
                    let mut buffer = vec![0_u8; REQUEST_CHUNK_BYTES];
                    let result = reader.read(&mut buffer);
                    (reader, buffer, result)
                })
                .await
                .map_err(|_| {
                    TransportError::new(
                        TransportErrorKind::Unavailable,
                        FailurePhase::AfterSubmission,
                        "Station request body reader panicked",
                    )
                })?;
                reader = read.0;
                let mut buffer = read.1;
                let count = read.2.map_err(|error| {
                    TransportError::new(
                        TransportErrorKind::Unavailable,
                        FailurePhase::AfterSubmission,
                        format!("read Station request body: {error}"),
                    )
                })?;
                if count == 0 {
                    if sent != content_length {
                        return Err(TransportError::new(
                            TransportErrorKind::Protocol,
                            FailurePhase::AfterSubmission,
                            "Station request body ended before Content-Length",
                        ));
                    }
                    return Ok(());
                }
                sent = sent.saturating_add(count as u64);
                if sent > content_length {
                    return Err(TransportError::new(
                        TransportErrorKind::Protocol,
                        FailurePhase::AfterSubmission,
                        "Station request body exceeds Content-Length",
                    ));
                }
                buffer.truncate(count);
                send_chunk(
                    stream,
                    Bytes::from(buffer),
                    sent == content_length,
                    &cancellation,
                )
                .await?;
                if sent == content_length {
                    return Ok(());
                }
            }
        }
    }
}

async fn send_bytes(
    stream: &mut h2::SendStream<Bytes>,
    body: Vec<u8>,
    cancellation: CancellationToken,
) -> Result<(), TransportError> {
    let mut offset = 0;
    while offset < body.len() {
        let end = (offset + REQUEST_CHUNK_BYTES).min(body.len());
        send_chunk(
            stream,
            Bytes::copy_from_slice(&body[offset..end]),
            end == body.len(),
            &cancellation,
        )
        .await?;
        offset = end;
    }
    Ok(())
}

async fn send_chunk(
    stream: &mut h2::SendStream<Bytes>,
    chunk: Bytes,
    end_stream: bool,
    cancellation: &CancellationToken,
) -> Result<(), TransportError> {
    let length = chunk.len();
    stream.reserve_capacity(length);
    while stream.capacity() < length {
        tokio::select! {
            _ = cancellation.cancelled() => {
                return Err(TransportError::new(
                    TransportErrorKind::Cancelled,
                    FailurePhase::AfterSubmission,
                    "Station HTTP caller was cancelled",
                ));
            }
            capacity = poll_fn(|context| stream.poll_capacity(context)) => {
                match capacity {
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        return Err(TransportError::new(
                            TransportErrorKind::Unavailable,
                            FailurePhase::AfterSubmission,
                            error.to_string(),
                        ));
                    }
                    None => {
                        return Err(TransportError::new(
                            TransportErrorKind::Unavailable,
                            FailurePhase::AfterSubmission,
                            "Station HTTP/2 request body closed",
                        ));
                    }
                }
            }
        }
    }
    stream.send_data(chunk, end_stream).map_err(|error| {
        TransportError::new(
            TransportErrorKind::Unavailable,
            FailurePhase::AfterSubmission,
            error.to_string(),
        )
    })
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
        .map_err(|error| {
            TransportError::new(
                TransportErrorKind::Unavailable,
                FailurePhase::BeforeSubmission,
                format!("build TCP transport: {error}"),
            )
        })?
        .with_dns()
        .map_err(|error| {
            TransportError::new(
                TransportErrorKind::Unavailable,
                FailurePhase::BeforeSubmission,
                format!("build DNS transport: {error}"),
            )
        })?
        .with_relay_client(noise::Config::new, yamux::Config::default)
        .map_err(|error| {
            TransportError::new(
                TransportErrorKind::Unavailable,
                FailurePhase::BeforeSubmission,
                format!("build Relay transport: {error}"),
            )
        })?
        .with_behaviour(|key, relay| Behaviour {
            relay,
            streams: libp2p_stream::Behaviour::new(),
            identify: identify::Behaviour::new(identify::Config::new(
                "/peers-touch/native-http/1.0.0".to_string(),
                key.public(),
            )),
            ping: ping::Behaviour::default(),
        })
        .map_err(|error| {
            TransportError::new(
                TransportErrorKind::Unavailable,
                FailurePhase::BeforeSubmission,
                format!("build P2P behaviour: {error}"),
            )
        })
        .map(|builder| builder.build())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transport_bounds_are_finite() {
        assert_eq!(CONTROL_TIMEOUT, Duration::from_secs(15));
        assert_eq!(DEFAULT_RESPONSE_TIMEOUT, Duration::from_secs(305));
        assert!(COMMAND_CAPACITY > 0);
        assert!(MAX_IN_FLIGHT_REQUESTS > 0);
        assert!(MAX_ROUTE_SESSIONS > 0);
    }

    #[test]
    fn owner_handle_split_is_explicit() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<TransportOwner>();
        assert_send_sync::<TransportHandle>();
    }

    #[test]
    fn identity_proof_uses_the_running_transport_key() {
        let owner = TransportOwner::start().expect("start transport owner");
        let handle = owner.handle();
        let message = b"source-bound-grant";
        let proof = handle
            .sign_identity_proof(message)
            .expect("sign identity proof");
        let public_key = identity::PublicKey::try_decode_protobuf(&proof.public_key)
            .expect("decode identity proof public key");

        assert_eq!(proof.peer_id, handle.client_peer_id().to_string());
        assert_eq!(public_key.to_peer_id().to_string(), proof.peer_id);
        assert!(public_key.verify(message, &proof.signature));
    }

    #[test]
    fn route_sessions_are_detached_before_peer_reconnect() {
        let pool = SessionPool::default();
        let first_route = Route {
            node_peer_id: "node-a".to_string(),
            dial_multiaddr: "/ip4/127.0.0.1/tcp/4001/p2p/node-a".to_string(),
            inner_tls_spki_sha256: [1; 32],
            route_generation: 1,
        };
        let mut renewed_route = first_route.clone();
        renewed_route.route_generation = 2;
        let other_route = Route {
            node_peer_id: "node-b".to_string(),
            dial_multiaddr: "/ip4/127.0.0.1/tcp/4002/p2p/node-b".to_string(),
            inner_tls_spki_sha256: [2; 32],
            route_generation: 1,
        };
        for route in [&first_route, &renewed_route, &other_route] {
            pool.sessions.lock().unwrap().insert(
                SessionKey::new(route, TrafficClass::Interactive),
                Arc::new(SessionSlot::default()),
            );
        }

        let retired_route = pool.detach_route(&first_route);
        assert_eq!(retired_route.len(), 1);
        assert_eq!(pool.sessions.lock().unwrap().len(), 2);

        let disconnected_peer = pool.detach_peer(&first_route.node_peer_id);
        assert_eq!(disconnected_peer.len(), 1);
        let remaining = pool.sessions.lock().unwrap();
        assert_eq!(remaining.len(), 1);
        assert!(remaining
            .keys()
            .all(|key| key.node_peer_id == other_route.node_peer_id));
    }

    #[test]
    fn accepted_circuit_request_uses_the_operation_timeout() {
        let source = include_str!("lib.rs");
        let production = source
            .split("#[cfg(test)]")
            .next()
            .expect("production transport source");

        assert!(!production.contains(
            "result = tokio::time::timeout(\n            admission_timeout,\n            execute_request_inner"
        ));
    }

    #[test]
    fn waiting_transport_reply_observes_cancellation_and_submission_phase() {
        for was_submitted in [false, true] {
            let (_sender, receiver) = mpsc::channel::<()>();
            let cancellation = CancellationToken::new();
            let submitted = AtomicBool::new(was_submitted);
            let started = Instant::now();
            std::thread::scope(|threads| {
                let cancellation = &cancellation;
                threads.spawn(move || {
                    std::thread::sleep(Duration::from_millis(30));
                    cancellation.cancel();
                });
                let error = receive_reply(
                    &receiver,
                    cancellation,
                    &CancellationToken::new(),
                    started + CONTROL_TIMEOUT,
                    &submitted,
                )
                .unwrap_err();
                assert_eq!(error.kind(), TransportErrorKind::Cancelled);
                assert_eq!(
                    error.phase(),
                    if was_submitted {
                        FailurePhase::AfterSubmission
                    } else {
                        FailurePhase::BeforeSubmission
                    }
                );
                assert!(started.elapsed() < Duration::from_millis(300));
            });
        }
    }

    #[test]
    fn waiting_transport_reply_expires_and_releases_caller() {
        let (_sender, receiver) = mpsc::channel::<()>();
        let cancellation = CancellationToken::new();
        let started = Instant::now();
        let error = receive_reply(
            &receiver,
            &cancellation,
            &CancellationToken::new(),
            started + Duration::from_millis(30),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(error.kind(), TransportErrorKind::Timeout);
        assert_eq!(error.phase(), FailurePhase::BeforeSubmission);
        assert!(!cancellation.is_cancelled());
        assert!(started.elapsed() < Duration::from_millis(300));
    }

    #[test]
    fn shared_dial_cancellation_preserves_subscribers_and_fences_old_errors() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let swarm = build_swarm(identity::Keypair::generate_ed25519()).unwrap();
            let stream_control = swarm.behaviour().streams.new_control();
            let (_sender, commands) = tokio_mpsc::channel(COMMAND_CAPACITY);
            let mut driver = Driver {
                swarm,
                stream_control,
                commands,
                active: HashSet::new(),
                pending_dials: HashMap::new(),
                requests: JoinSet::new(),
                admission: Arc::new(Semaphore::new(MAX_IN_FLIGHT_REQUESTS)),
                sessions: Arc::new(SessionPool::default()),
                shutdown: CancellationToken::new(),
            };
            let peer = PeerId::random();
            let address = Multiaddr::from_str("/ip4/127.0.0.1/tcp/9").unwrap();
            let add = |driver: &mut Driver| {
                let (reply, receiver) = mpsc::channel();
                let cancellation = CancellationToken::new();
                driver.handle_command(DriverCommand::Dial {
                    peer,
                    address: address.clone(),
                    reply,
                    cancellation: cancellation.clone(),
                    deadline: Instant::now() + CONTROL_TIMEOUT,
                });
                (cancellation, receiver)
            };
            let (first, first_reply) = add(&mut driver);
            let (second, second_reply) = add(&mut driver);
            let old_connection = driver.pending_dials[&peer].connection_id;
            first.cancel();
            driver.retire_cancelled_dials();
            assert_eq!(driver.pending_dials[&peer].waiters.len(), 1);
            assert_eq!(driver.pending_dials[&peer].connection_id, old_connection);
            assert!(matches!(
                first_reply.try_recv(),
                Err(mpsc::TryRecvError::Disconnected)
            ));
            assert!(matches!(
                second_reply.try_recv(),
                Err(mpsc::TryRecvError::Empty)
            ));
            second.cancel();
            driver.retire_cancelled_dials();
            assert!(driver.pending_dials.is_empty());
            // Consume the upstream abort before admitting another dial.
            tokio::time::timeout(Duration::from_secs(1), async {
                while driver
                    .swarm
                    .network_info()
                    .connection_counters()
                    .num_pending_outgoing()
                    != 0
                {
                    let event = driver.swarm.select_next_some().await;
                    driver.handle_event(event);
                }
            })
            .await
            .unwrap();
            let (_third, third_reply) = add(&mut driver);
            let new_connection = driver.pending_dials[&peer].connection_id;
            assert_ne!(new_connection, old_connection);
            driver.handle_event(SwarmEvent::OutgoingConnectionError {
                connection_id: old_connection,
                peer_id: Some(peer),
                error: libp2p::swarm::DialError::Aborted,
            });
            assert_eq!(driver.pending_dials[&peer].connection_id, new_connection);
            assert!(matches!(
                third_reply.try_recv(),
                Err(mpsc::TryRecvError::Empty)
            ));
            driver.finish_dial(peer, Ok(()));
            assert_eq!(third_reply.recv().unwrap(), Ok(()));
        });
    }
}
