use crate::application::station_runtime::client::{
    StationRequest, StationRequestBody, StationResponse, StationTransportError,
    StationTransportErrorKind, TrafficClass,
};
use crate::application::station_runtime::route_lease::RouteLease;
use crate::infrastructure::station::identity::{TransportIdentityScope, TransportIdentityStore};
use crate::infrastructure::station_registry::StationRouteType;
use reqwest::redirect::Policy;
use reqwest::{Body, Client};
use station_libp2p_http::{
    FailurePhase, Request as CircuitRequest, RequestBody as CircuitRequestBody,
    Route as CircuitRoute, TrafficClass as CircuitTrafficClass, TransportErrorKind,
    TransportHandle as CircuitHandle, TransportOwner as CircuitOwner, MAX_IN_FLIGHT_REQUESTS,
};
use std::collections::HashMap;
use std::fmt;
use std::io::{self, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, Semaphore};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

#[derive(Debug)]
pub struct StationTransportLifecycleError(String);

impl fmt::Display for StationTransportLifecycleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for StationTransportLifecycleError {}

struct ScopedCircuit {
    owner: CircuitOwner,
    handle: CircuitHandle,
}

struct Shared {
    direct: Client,
    identity_store: TransportIdentityStore,
    circuits: Mutex<HashMap<TransportIdentityScope, Arc<ScopedCircuit>>>,
    #[cfg(feature = "acceptance-webdriver")]
    direct_route_overrides: Mutex<HashMap<(String, String), String>>,
    shutdown: CancellationToken,
    requests: TaskTracker,
    admission: Arc<Semaphore>,
    accepting: AtomicBool,
    task_gate: Mutex<()>,
}

pub struct StationTransportOwner {
    shared: Arc<Shared>,
}

#[derive(Clone)]
pub struct StationTransportHandle {
    shared: Arc<Shared>,
}

struct LinkedCancellation {
    token: CancellationToken,
    monitor_stop: CancellationToken,
}

impl LinkedCancellation {
    fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }

    fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

impl Drop for LinkedCancellation {
    fn drop(&mut self) {
        self.token.cancel();
        self.monitor_stop.cancel();
    }
}

struct FencedResponseBody {
    inner: Box<dyn Read + Send>,
    cancellation: LinkedCancellation,
}

impl FencedResponseBody {
    fn new(inner: Box<dyn Read + Send>, cancellation: LinkedCancellation) -> Self {
        Self {
            inner,
            cancellation,
        }
    }
}

impl Read for FencedResponseBody {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if self.cancellation.is_cancelled() {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "Station response belongs to a cancelled route lease",
            ));
        }
        let read = self.inner.read(output)?;
        if self.cancellation.is_cancelled() {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "Station response belongs to a cancelled route lease",
            ));
        }
        Ok(read)
    }
}

impl StationTransportOwner {
    pub fn start() -> Result<Self, StationTransportLifecycleError> {
        let direct = Client::builder()
            .use_rustls_tls()
            .redirect(Policy::none())
            .build()
            .map_err(|error| {
                StationTransportLifecycleError(format!("create direct Station transport: {error}"))
            })?;
        Ok(Self {
            shared: Arc::new(Shared {
                direct,
                identity_store: TransportIdentityStore::new(),
                circuits: Mutex::new(HashMap::new()),
                #[cfg(feature = "acceptance-webdriver")]
                direct_route_overrides: Mutex::new(HashMap::new()),
                shutdown: CancellationToken::new(),
                requests: TaskTracker::new(),
                admission: Arc::new(Semaphore::new(MAX_IN_FLIGHT_REQUESTS)),
                accepting: AtomicBool::new(true),
                task_gate: Mutex::new(()),
            }),
        })
    }

    pub fn handle(&self) -> StationTransportHandle {
        StationTransportHandle {
            shared: self.shared.clone(),
        }
    }

    pub fn shutdown(&self, timeout: Duration) -> Result<(), StationTransportLifecycleError> {
        self.handle().shutdown(timeout)
    }
}

impl Drop for StationTransportOwner {
    fn drop(&mut self) {
        let _ = self.shutdown(Duration::from_secs(5));
    }
}

impl StationTransportHandle {
    pub fn prepare_identity(
        &self,
        scope: TransportIdentityScope,
    ) -> Result<String, StationTransportLifecycleError> {
        let keypair = self
            .shared
            .identity_store
            .keypair(&scope)
            .map_err(|error| StationTransportLifecycleError(error.to_string()))?;
        Ok(keypair.public().to_peer_id().to_string())
    }

    pub fn prepare_route(
        &self,
        scope: TransportIdentityScope,
    ) -> Result<(), StationTransportLifecycleError> {
        {
            let circuits = self.shared.circuits.lock().map_err(|_| {
                StationTransportLifecycleError(
                    "Station transport lifecycle lock poisoned".to_string(),
                )
            })?;
            if circuits.contains_key(&scope) {
                return Ok(());
            }
            if circuits.len() >= 2 {
                return Err(StationTransportLifecycleError(
                    "Circuit candidate capacity is exhausted".to_string(),
                ));
            }
        }
        let keypair = self
            .shared
            .identity_store
            .keypair(&scope)
            .map_err(|error| StationTransportLifecycleError(error.to_string()))?;
        let owner = CircuitOwner::start_with_identity(keypair).map_err(|error| {
            StationTransportLifecycleError(format!("start scoped Circuit transport: {error}"))
        })?;
        let handle = owner.handle();
        let mut circuits = self.shared.circuits.lock().map_err(|_| {
            StationTransportLifecycleError("Station transport lifecycle lock poisoned".to_string())
        })?;
        if circuits.contains_key(&scope) {
            drop(circuits);
            owner.shutdown(Duration::from_secs(5)).map_err(|error| {
                StationTransportLifecycleError(format!(
                    "discard duplicate Circuit transport: {error}"
                ))
            })?;
            return Ok(());
        }
        if circuits.len() >= 2 {
            drop(circuits);
            let _ = owner.shutdown(Duration::from_secs(5));
            return Err(StationTransportLifecycleError(
                "Circuit candidate capacity is exhausted".to_string(),
            ));
        }
        circuits.insert(scope, Arc::new(ScopedCircuit { owner, handle }));
        Ok(())
    }

    pub fn retire_except(
        &self,
        retained: Option<&TransportIdentityScope>,
        timeout: Duration,
    ) -> Result<(), StationTransportLifecycleError> {
        let circuits = self
            .shared
            .circuits
            .lock()
            .map_err(|_| {
                StationTransportLifecycleError(
                    "Station transport lifecycle lock poisoned".to_string(),
                )
            })?
            .iter()
            .filter(|(scope, _)| Some(*scope) != retained)
            .map(|(scope, circuit)| (scope.clone(), circuit.clone()))
            .collect::<Vec<_>>();
        let deadline = std::time::Instant::now() + timeout;
        for (scope, circuit) in circuits {
            circuit
                .owner
                .shutdown(deadline.saturating_duration_since(std::time::Instant::now()))
                .map_err(|error| {
                    StationTransportLifecycleError(format!("retire Circuit transport: {error}"))
                })?;
            self.shared
                .circuits
                .lock()
                .map_err(|_| {
                    StationTransportLifecycleError(
                        "Station transport lifecycle lock poisoned".to_string(),
                    )
                })?
                .remove(&scope);
        }
        Ok(())
    }

    pub fn execute(
        &self,
        lease: &RouteLease,
        request: StationRequest,
    ) -> Result<StationResponse, StationTransportError> {
        if self.shared.shutdown.is_cancelled()
            || !self.shared.accepting.load(Ordering::Acquire)
            || lease.is_cancelled()
            || request.cancellation.is_cancelled()
        {
            return Err(StationTransportError::new(
                StationTransportErrorKind::Cancelled,
                "Station route lease was revoked",
                false,
            ));
        }
        let cancellation = linked_cancellation(
            lease.cancellation(),
            request.cancellation.clone(),
            self.shared.shutdown.clone(),
        );
        match lease.route.route_type {
            StationRouteType::Direct => self.execute_direct(lease, request, cancellation),
            StationRouteType::Relay => self.execute_circuit(lease, request, cancellation),
        }
    }

    #[cfg(feature = "acceptance-webdriver")]
    pub fn set_acceptance_direct_route_override(
        &self,
        station_peer_id: &str,
        route_id: &str,
        endpoint_origin: &str,
    ) -> Result<(), StationTransportLifecycleError> {
        let endpoint = reqwest::Url::parse(endpoint_origin).map_err(|error| {
            StationTransportLifecycleError(format!(
                "Acceptance Direct route override is invalid: {error}"
            ))
        })?;
        let loopback = endpoint.host_str().is_some_and(|host| {
            host == "localhost"
                || host
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        });
        if endpoint.scheme() != "http"
            || !loopback
            || station_peer_id.trim().is_empty()
            || route_id.trim().is_empty()
        {
            return Err(StationTransportLifecycleError(
                "Acceptance Direct route override must be a loopback HTTP endpoint".to_string(),
            ));
        }
        self.shared
            .direct_route_overrides
            .lock()
            .map_err(|_| {
                StationTransportLifecycleError(
                    "Acceptance Direct route override lock poisoned".to_string(),
                )
            })?
            .insert(
                (station_peer_id.to_string(), route_id.to_string()),
                endpoint_origin.trim_end_matches('/').to_string(),
            );
        Ok(())
    }

    #[cfg(feature = "acceptance-webdriver")]
    pub fn clear_acceptance_direct_route_overrides(
        &self,
    ) -> Result<(), StationTransportLifecycleError> {
        self.shared
            .direct_route_overrides
            .lock()
            .map_err(|_| {
                StationTransportLifecycleError(
                    "Acceptance Direct route override lock poisoned".to_string(),
                )
            })?
            .clear();
        Ok(())
    }

    pub fn close_route(&self, lease: &RouteLease) {
        if lease.route.route_type != StationRouteType::Relay {
            return;
        }
        let Ok(circuits) = self.shared.circuits.lock() else {
            return;
        };
        let Some(circuit) = lease
            .route
            .relay_peer_id
            .as_ref()
            .and_then(|relay| circuits.get(&TransportIdentityScope::Relay(relay.clone())))
            .cloned()
        else {
            return;
        };
        drop(circuits);
        if let Ok(route) = circuit_route(lease) {
            let _ = circuit.handle.close_route(&route);
        }
    }

    pub fn shutdown(&self, timeout: Duration) -> Result<(), StationTransportLifecycleError> {
        let deadline = std::time::Instant::now() + timeout;
        {
            let _task_gate = self.shared.task_gate.lock().map_err(|_| {
                StationTransportLifecycleError("Direct Station task gate lock poisoned".to_string())
            })?;
            self.shared.accepting.store(false, Ordering::Release);
            self.shared.shutdown.cancel();
            self.shared.admission.close();
            self.shared.requests.close();
        }
        self.retire_except(
            None,
            deadline.saturating_duration_since(std::time::Instant::now()),
        )?;
        tauri::async_runtime::block_on(async {
            tokio::time::timeout(
                deadline.saturating_duration_since(std::time::Instant::now()),
                self.shared.requests.wait(),
            )
            .await
        })
        .map_err(|_| {
            StationTransportLifecycleError("Direct Station requests did not drain".to_string())
        })
    }

    fn execute_direct(
        &self,
        lease: &RouteLease,
        request: StationRequest,
        cancellation: LinkedCancellation,
    ) -> Result<StationResponse, StationTransportError> {
        let endpoint_origin = self.direct_endpoint_origin(lease)?;
        let url = format!(
            "{}{}",
            endpoint_origin.trim_end_matches('/'),
            request.path_and_query
        );
        let admission_cancellation = cancellation.token();
        let permit = tauri::async_runtime::block_on(async {
            tokio::select! {
                _ = admission_cancellation.cancelled() => Err(StationTransportError::new(
                    StationTransportErrorKind::Cancelled,
                    "Direct Station request cancelled before admission",
                    false,
                )),
                result = tokio::time::timeout(
                    request.admission_timeout.min(request.timeout),
                    self.shared.admission.clone().acquire_owned(),
                ) => match result {
                    Ok(Ok(permit)) => Ok(permit),
                    Ok(Err(_)) => Err(StationTransportError::new(
                        StationTransportErrorKind::Shutdown,
                        "Direct Station admission is closed",
                        false,
                    )),
                    Err(_) => Err(StationTransportError::new(
                        StationTransportErrorKind::Overloaded,
                        "Direct Station request admission timed out",
                        false,
                    )),
                },
            }
        })?;
        let mut outgoing = self
            .shared
            .direct
            .request(request.method, url)
            .timeout(request.timeout);
        for (name, value) in &request.headers {
            if !matches!(
                name.as_str().to_ascii_lowercase().as_str(),
                "host" | "connection" | "transfer-encoding" | "proxy-connection" | "upgrade"
            ) {
                outgoing = outgoing.header(name, value);
            }
        }
        outgoing = match request.body {
            StationRequestBody::Empty => outgoing,
            StationRequestBody::Bytes(bytes) => outgoing.body(bytes),
            StationRequestBody::Reader {
                reader,
                content_length,
            } => outgoing
                .header(reqwest::header::CONTENT_LENGTH, content_length)
                .body(Body::wrap_stream(futures_lite::stream::unfold(
                    Some(reader),
                    |reader| async {
                        let mut reader = reader?;
                        let read = tokio::task::spawn_blocking(move || {
                            let mut bytes = vec![0_u8; 16384];
                            let count = reader.read(&mut bytes);
                            (reader, bytes, count)
                        })
                        .await;
                        match read {
                            Ok((reader, mut bytes, Ok(count))) if count > 0 => {
                                bytes.truncate(count);
                                Some((Ok::<_, io::Error>(bytes), Some(reader)))
                            }
                            Ok((_, _, Err(error))) => Some((Err(error), None)),
                            _ => None,
                        }
                    },
                ))),
        };
        let (reply, receive) = tokio::sync::oneshot::channel();
        let token = cancellation.token();
        let deadline = tokio::time::Instant::now() + request.timeout;
        let operation_timeout = request.timeout;
        {
            let _task_gate = self.shared.task_gate.lock().map_err(|_| {
                StationTransportError::new(
                    StationTransportErrorKind::Shutdown,
                    "Direct Station task gate lock poisoned",
                    false,
                )
            })?;
            if !self.shared.accepting.load(Ordering::Acquire) {
                return Err(StationTransportError::new(
                    StationTransportErrorKind::Shutdown,
                    "Direct Station transport is draining",
                    false,
                ));
            }
            self.shared.requests.spawn_on(async move {
                let response = tokio::select! {
                    _ = token.cancelled() => Err(StationTransportError::new(
                        StationTransportErrorKind::Cancelled,
                        "Direct Station request cancelled",
                        true,
                    )),
                    result = tokio::time::timeout(operation_timeout, outgoing.send()) => match result {
                        Err(_) => Err(StationTransportError::new(
                            StationTransportErrorKind::Timeout,
                            "Direct Station response timed out",
                            true,
                        )),
                        Ok(result) => result.map_err(|error| {
                            let submitted = !error.is_connect() && !error.is_builder();
                            StationTransportError::new(
                                if error.is_timeout() {
                                    StationTransportErrorKind::Timeout
                                } else {
                                    StationTransportErrorKind::Unavailable
                                },
                                format!("direct Station request failed: {error}"),
                                submitted,
                            )
                        }),
                    },
                };
                let mut response = match response {
                    Ok(response) => response,
                    Err(error) => {
                        let _ = reply.send(Err(error));
                        return;
                    }
                };
                let (sender, receiver) = mpsc::channel(8);
                let status = response.status().as_u16();
                let headers = response.headers().clone();
                if reply.send(Ok((status, headers, receiver))).is_err() {
                    return;
                }
                let _permit = permit;
                loop {
                    let next = tokio::select! {
                        _ = token.cancelled() => return,
                        _ = sender.closed() => return,
                        _ = tokio::time::sleep_until(deadline) => { token.cancel(); return; },
                        next = response.chunk() => next,
                    };
                    let next = match next {
                        Ok(Some(bytes)) => Ok(bytes.to_vec()),
                        Ok(None) => return,
                        Err(error) => Err(io::Error::other(error)),
                    };
                    let terminal = next.is_err();
                    tokio::select! {
                        _ = token.cancelled() => return,
                        _ = tokio::time::sleep_until(deadline) => { token.cancel(); return; },
                        sent = sender.send(next) => { if sent.is_err() { return; } },
                    }
                    if terminal {
                        return;
                    }
                }
            }, tauri::async_runtime::handle().inner());
        }
        let (status, headers, receiver) =
            futures_lite::future::block_on(receive).map_err(|_| {
                StationTransportError::new(
                    StationTransportErrorKind::Shutdown,
                    "Direct Station worker closed",
                    true,
                )
            })??;
        Ok(StationResponse {
            status,
            headers,
            body: Box::new(FencedResponseBody::new(
                Box::new(DirectResponseReader {
                    receiver,
                    current: std::io::Cursor::new(Vec::new()),
                    cancellation: cancellation.token(),
                }),
                cancellation,
            )),
        })
    }

    fn direct_endpoint_origin(&self, lease: &RouteLease) -> Result<String, StationTransportError> {
        #[cfg(feature = "acceptance-webdriver")]
        {
            if let Some(endpoint) = self
                .shared
                .direct_route_overrides
                .lock()
                .map_err(|_| {
                    StationTransportError::new(
                        StationTransportErrorKind::Shutdown,
                        "Acceptance Direct route override lock poisoned",
                        false,
                    )
                })?
                .get(&(lease.station_peer_id.clone(), lease.route_id.clone()))
                .cloned()
            {
                return Ok(endpoint);
            }
        }
        Ok(lease.route.endpoint_origin.clone())
    }

    fn execute_circuit(
        &self,
        lease: &RouteLease,
        request: StationRequest,
        cancellation: LinkedCancellation,
    ) -> Result<StationResponse, StationTransportError> {
        let expected_scope =
            TransportIdentityScope::Relay(lease.route.relay_peer_id.clone().ok_or_else(|| {
                StationTransportError::new(
                    StationTransportErrorKind::InvalidRoute,
                    "Circuit route has no Relay identity",
                    false,
                )
            })?);
        let circuits = self.shared.circuits.lock().map_err(|_| {
            StationTransportError::new(
                StationTransportErrorKind::Shutdown,
                "Station transport lifecycle lock poisoned",
                false,
            )
        })?;
        let circuit = circuits.get(&expected_scope).cloned().ok_or_else(|| {
            StationTransportError::new(
                StationTransportErrorKind::Shutdown,
                "Circuit transport identity was not prepared",
                false,
            )
        })?;
        drop(circuits);
        let route = circuit_route(lease)?;
        let mut circuit_request = CircuitRequest::new(
            request.method,
            request.path_and_query.parse().map_err(|error| {
                StationTransportError::new(
                    StationTransportErrorKind::Protocol,
                    format!("invalid Station request target: {error}"),
                    false,
                )
            })?,
        );
        circuit_request.headers = request.headers;
        circuit_request.body = match request.body {
            StationRequestBody::Empty => CircuitRequestBody::Empty,
            StationRequestBody::Bytes(bytes) => CircuitRequestBody::Bytes(bytes),
            StationRequestBody::Reader {
                reader,
                content_length,
            } => CircuitRequestBody::Reader {
                reader,
                content_length,
            },
        };
        circuit_request.timeout = request.timeout;
        circuit_request.admission_timeout = request.admission_timeout;
        circuit_request.traffic_class = match request.traffic_class {
            TrafficClass::Interactive => CircuitTrafficClass::Interactive,
            TrafficClass::Realtime => CircuitTrafficClass::Realtime,
            TrafficClass::Bulk => CircuitTrafficClass::Bulk,
        };
        circuit_request.cancellation = cancellation.token();
        let response = circuit
            .handle
            .round_trip(&route, circuit_request)
            .map_err(|error| {
                StationTransportError::new(
                    match error.kind() {
                        TransportErrorKind::Overloaded => StationTransportErrorKind::Overloaded,
                        TransportErrorKind::Cancelled => StationTransportErrorKind::Cancelled,
                        TransportErrorKind::Timeout => StationTransportErrorKind::Timeout,
                        TransportErrorKind::InvalidRoute => StationTransportErrorKind::InvalidRoute,
                        TransportErrorKind::Protocol => StationTransportErrorKind::Protocol,
                        TransportErrorKind::Shutdown => StationTransportErrorKind::Shutdown,
                        TransportErrorKind::Unavailable => StationTransportErrorKind::Unavailable,
                    },
                    error.to_string(),
                    error.phase() == FailurePhase::AfterSubmission,
                )
            })?;
        if lease.is_cancelled() {
            return Err(StationTransportError::new(
                StationTransportErrorKind::StaleRoute,
                "Station route changed while the request was in flight",
                true,
            ));
        }
        Ok(StationResponse {
            status: response.status.as_u16(),
            headers: response.headers,
            body: Box::new(FencedResponseBody::new(
                Box::new(response.body),
                cancellation,
            )),
        })
    }
}

fn circuit_route(lease: &RouteLease) -> Result<CircuitRoute, StationTransportError> {
    let inner_tls_spki_sha256 = lease
        .route
        .inner_tls_spki_sha256
        .as_deref()
        .and_then(|value| value.try_into().ok())
        .ok_or_else(|| {
            StationTransportError::new(
                StationTransportErrorKind::InvalidRoute,
                "Circuit route has no valid TLS SPKI pin",
                false,
            )
        })?;
    let dial_multiaddr = lease
        .route
        .addresses
        .iter()
        .find(|address| address.contains("/p2p-circuit/"))
        .cloned()
        .ok_or_else(|| {
            StationTransportError::new(
                StationTransportErrorKind::InvalidRoute,
                "Circuit route has no dial multiaddr",
                false,
            )
        })?;
    Ok(CircuitRoute {
        node_peer_id: lease.route.node_peer_id.clone(),
        dial_multiaddr,
        inner_tls_spki_sha256,
        route_generation: lease.route_generation,
    })
}

fn linked_cancellation(
    lease: CancellationToken,
    request: CancellationToken,
    shutdown: CancellationToken,
) -> LinkedCancellation {
    let linked = CancellationToken::new();
    let monitor_stop = CancellationToken::new();
    if lease.is_cancelled() || request.is_cancelled() || shutdown.is_cancelled() {
        linked.cancel();
    }
    let linked_lease = linked.clone();
    let linked_request = linked.clone();
    let stop = monitor_stop.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = lease.cancelled() => linked_lease.cancel(),
            _ = request.cancelled() => linked_request.cancel(),
            _ = shutdown.cancelled() => linked_request.cancel(),
            _ = stop.cancelled() => {}
        }
    });
    LinkedCancellation {
        token: linked,
        monitor_stop,
    }
}

struct DirectResponseReader {
    receiver: mpsc::Receiver<io::Result<Vec<u8>>>,
    current: std::io::Cursor<Vec<u8>>,
    cancellation: CancellationToken,
}

impl Read for DirectResponseReader {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        if self.cancellation.is_cancelled() {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "Direct Station response cancelled",
            ));
        }
        if self.current.position() < self.current.get_ref().len() as u64 {
            return self.current.read(output);
        }
        match self.receiver.blocking_recv() {
            Some(Ok(bytes)) => {
                self.current = std::io::Cursor::new(bytes);
                self.current.read(output)
            }
            Some(Err(error)) => Err(error),
            None if self.cancellation.is_cancelled() => Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "Direct Station response cancelled",
            )),
            None => Ok(0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn response_body_rejects_reads_after_route_cancellation() {
        let cancellation = CancellationToken::new();
        let mut body = FencedResponseBody::new(
            Box::new(Cursor::new(b"station-body".to_vec())),
            LinkedCancellation {
                token: cancellation.clone(),
                monitor_stop: CancellationToken::new(),
            },
        );
        let mut prefix = [0_u8; 7];
        body.read_exact(&mut prefix).unwrap();
        assert_eq!(&prefix, b"station");

        cancellation.cancel();

        let error = body
            .read(&mut [0_u8; 1])
            .expect_err("cancelled response body must be fenced");
        assert_eq!(error.kind(), io::ErrorKind::ConnectionAborted);
    }

    #[test]
    fn accepted_direct_request_uses_the_operation_timeout() {
        let source = include_str!("mod.rs");
        let production = source
            .split("#[cfg(test)]")
            .next()
            .expect("production transport source");

        assert!(!production.contains("tokio::time::timeout(admission_timeout, outgoing.send())"));
    }

    #[cfg(feature = "acceptance-webdriver")]
    #[test]
    fn acceptance_direct_override_changes_only_the_physical_endpoint() {
        let owner = StationTransportOwner::start().unwrap();
        let transport = owner.handle();

        transport
            .set_acceptance_direct_route_override(
                "station-one",
                "direct-one",
                "http://127.0.0.1:39000",
            )
            .unwrap();
        assert_eq!(
            transport
                .shared
                .direct_route_overrides
                .lock()
                .unwrap()
                .get(&("station-one".to_string(), "direct-one".to_string()))
                .map(String::as_str),
            Some("http://127.0.0.1:39000"),
        );

        transport.clear_acceptance_direct_route_overrides().unwrap();
        assert!(transport
            .shared
            .direct_route_overrides
            .lock()
            .unwrap()
            .is_empty());
    }
}
