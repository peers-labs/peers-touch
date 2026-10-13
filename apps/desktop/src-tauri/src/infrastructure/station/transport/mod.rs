use crate::application::station_runtime::client::{
    StationRequest, StationRequestBody, StationResponse, StationTransportError,
    StationTransportErrorKind, TrafficClass,
};
use crate::application::station_runtime::route_lease::RouteLease;
use crate::infrastructure::station::identity::{TransportIdentityScope, TransportIdentityStore};
use crate::infrastructure::station_registry::StationRouteType;
use reqwest::blocking::{Body, Client};
use reqwest::redirect::Policy;
use station_libp2p_http::{
    FailurePhase, Request as CircuitRequest, RequestBody as CircuitRequestBody,
    Route as CircuitRoute, TrafficClass as CircuitTrafficClass, TransportErrorKind,
    TransportHandle as CircuitHandle, TransportOwner as CircuitOwner,
};
use std::fmt;
use std::io::{self, Read};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[derive(Debug)]
pub struct StationTransportLifecycleError(String);

impl fmt::Display for StationTransportLifecycleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for StationTransportLifecycleError {}

struct ScopedCircuit {
    scope: TransportIdentityScope,
    owner: CircuitOwner,
    handle: CircuitHandle,
}

struct Shared {
    direct: Client,
    identity_store: TransportIdentityStore,
    circuit: Mutex<Option<ScopedCircuit>>,
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
                io::ErrorKind::Interrupted,
                "Station response belongs to a cancelled route lease",
            ));
        }
        let read = self.inner.read(output)?;
        if self.cancellation.is_cancelled() {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
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
                circuit: Mutex::new(None),
            }),
        })
    }

    pub fn handle(&self) -> StationTransportHandle {
        StationTransportHandle {
            shared: self.shared.clone(),
        }
    }

    pub fn shutdown(&self, timeout: Duration) -> Result<(), StationTransportLifecycleError> {
        let circuit = self
            .shared
            .circuit
            .lock()
            .map_err(|_| {
                StationTransportLifecycleError(
                    "Station transport lifecycle lock poisoned".to_string(),
                )
            })?
            .take();
        if let Some(circuit) = circuit {
            circuit.owner.shutdown(timeout).map_err(|error| {
                StationTransportLifecycleError(format!("shutdown Circuit transport: {error}"))
            })?;
        }
        Ok(())
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
        let mut circuit = self.shared.circuit.lock().map_err(|_| {
            StationTransportLifecycleError("Station transport lifecycle lock poisoned".to_string())
        })?;
        if let Some(active) = circuit.as_ref() {
            if active.scope == scope {
                return Ok(active.handle.client_peer_id().to_string());
            }
        }
        let previous = circuit.take();
        if let Some(previous) = previous {
            previous
                .owner
                .shutdown(Duration::from_secs(5))
                .map_err(|error| {
                    StationTransportLifecycleError(format!(
                        "replace scoped Circuit transport: {error}"
                    ))
                })?;
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
        let peer_id = handle.client_peer_id().to_string();
        *circuit = Some(ScopedCircuit {
            scope,
            owner,
            handle,
        });
        Ok(peer_id)
    }

    pub fn execute(
        &self,
        lease: &RouteLease,
        request: StationRequest,
    ) -> Result<StationResponse, StationTransportError> {
        if lease.is_cancelled() || request.cancellation.is_cancelled() {
            return Err(StationTransportError::new(
                StationTransportErrorKind::Cancelled,
                "Station route lease was revoked",
                false,
            ));
        }
        let cancellation = linked_cancellation(lease.cancellation(), request.cancellation.clone());
        match lease.route.route_type {
            StationRouteType::Direct => self.execute_direct(lease, request, cancellation),
            StationRouteType::Relay => self.execute_circuit(lease, request, cancellation),
        }
    }

    pub fn close_route(&self, lease: &RouteLease) {
        if lease.route.route_type != StationRouteType::Relay {
            return;
        }
        let Ok(circuit) = self.shared.circuit.lock() else {
            return;
        };
        let Some(circuit) = circuit.as_ref() else {
            return;
        };
        if let Ok(route) = circuit_route(lease) {
            let _ = circuit.handle.close_route(&route);
        }
    }

    pub fn shutdown(&self, timeout: Duration) -> Result<(), StationTransportLifecycleError> {
        let circuit = self
            .shared
            .circuit
            .lock()
            .map_err(|_| {
                StationTransportLifecycleError(
                    "Station transport lifecycle lock poisoned".to_string(),
                )
            })?
            .take();
        if let Some(circuit) = circuit {
            circuit.owner.shutdown(timeout).map_err(|error| {
                StationTransportLifecycleError(format!("shutdown Circuit transport: {error}"))
            })?;
        }
        Ok(())
    }

    fn execute_direct(
        &self,
        lease: &RouteLease,
        request: StationRequest,
        cancellation: LinkedCancellation,
    ) -> Result<StationResponse, StationTransportError> {
        let url = format!(
            "{}{}",
            lease.route.endpoint_origin.trim_end_matches('/'),
            request.path_and_query
        );
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
                .body(Body::new(reader)),
        };
        let response = outgoing.send().map_err(|error| {
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
        })?;
        if lease.is_cancelled() {
            return Err(StationTransportError::new(
                StationTransportErrorKind::StaleRoute,
                "Station route changed while the request was in flight",
                true,
            ));
        }
        Ok(StationResponse {
            status: response.status().as_u16(),
            headers: response.headers().clone(),
            body: Box::new(FencedResponseBody::new(Box::new(response), cancellation)),
        })
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
        let circuit = self.shared.circuit.lock().map_err(|_| {
            StationTransportError::new(
                StationTransportErrorKind::Shutdown,
                "Station transport lifecycle lock poisoned",
                false,
            )
        })?;
        let circuit = circuit.as_ref().ok_or_else(|| {
            StationTransportError::new(
                StationTransportErrorKind::Shutdown,
                "Circuit transport identity was not prepared",
                false,
            )
        })?;
        if circuit.scope != expected_scope {
            return Err(StationTransportError::new(
                StationTransportErrorKind::StaleRoute,
                "Circuit transport identity does not match the route lease",
                false,
            ));
        }
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

fn linked_cancellation(lease: CancellationToken, request: CancellationToken) -> LinkedCancellation {
    let linked = CancellationToken::new();
    let monitor_stop = CancellationToken::new();
    if lease.is_cancelled() || request.is_cancelled() {
        linked.cancel();
    }
    let linked_lease = linked.clone();
    let linked_request = linked.clone();
    let stop = monitor_stop.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = lease.cancelled() => linked_lease.cancel(),
            _ = request.cancelled() => linked_request.cancel(),
            _ = stop.cancelled() => {}
        }
    });
    LinkedCancellation {
        token: linked,
        monitor_stop,
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
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
    }
}
