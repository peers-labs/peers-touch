use crate::application::station_runtime::client::{
    StationRequest, StationRequestBody, StationResponse, StationTransportError,
    StationTransportErrorKind, TrafficClass,
};
use crate::application::station_runtime::route_lease::RouteLease;
use crate::infrastructure::station::identity::{TransportIdentityScope, TransportIdentityStore};
use crate::infrastructure::station_registry::StationRouteType;
use station_libp2p_http::{
    FailurePhase, Request as SecureRequest, RequestBody as SecureRequestBody, Route as SecureRoute,
    TrafficClass as SecureTrafficClass, TransportErrorKind,
    TransportHandle as SecureTransportHandle, TransportIdentityProof,
    TransportOwner as SecureTransportOwner,
};
use std::collections::HashMap;
use std::fmt;
use std::io::{self, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

const MAX_SCOPED_TRANSPORTS: usize = 16;

#[derive(Debug)]
pub struct StationTransportLifecycleError(String);

impl fmt::Display for StationTransportLifecycleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for StationTransportLifecycleError {}

struct ScopedTransport {
    owner: SecureTransportOwner,
    handle: SecureTransportHandle,
}

struct ScopedTransportEntry {
    transport: Arc<ScopedTransport>,
    last_used: u64,
    active_responses: usize,
}

#[derive(Default)]
struct TransportPool {
    entries: HashMap<TransportIdentityScope, ScopedTransportEntry>,
    sequence: u64,
}

struct Shared {
    identity_store: TransportIdentityStore,
    transports: Mutex<TransportPool>,
    #[cfg(feature = "acceptance-webdriver")]
    direct_route_overrides: Mutex<HashMap<(String, String), String>>,
    shutdown: CancellationToken,
    accepting: AtomicBool,
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
    _transport_usage: Option<TransportUsage>,
}

impl FencedResponseBody {
    fn new(
        inner: Box<dyn Read + Send>,
        cancellation: LinkedCancellation,
        transport_usage: Option<TransportUsage>,
    ) -> Self {
        Self {
            inner,
            cancellation,
            _transport_usage: transport_usage,
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

struct TransportUsage {
    shared: Arc<Shared>,
    scope: TransportIdentityScope,
    transport: Arc<ScopedTransport>,
}

impl Drop for TransportUsage {
    fn drop(&mut self) {
        let Ok(mut pool) = self.shared.transports.lock() else {
            return;
        };
        let Some(entry) = pool.entries.get_mut(&self.scope) else {
            return;
        };
        if Arc::ptr_eq(&entry.transport, &self.transport) {
            entry.active_responses = entry.active_responses.saturating_sub(1);
        }
    }
}

impl StationTransportOwner {
    pub fn start() -> Result<Self, StationTransportLifecycleError> {
        Ok(Self {
            shared: Arc::new(Shared {
                identity_store: TransportIdentityStore::new(),
                transports: Mutex::new(TransportPool::default()),
                #[cfg(feature = "acceptance-webdriver")]
                direct_route_overrides: Mutex::new(HashMap::new()),
                shutdown: CancellationToken::new(),
                accepting: AtomicBool::new(true),
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
    pub fn sign_identity_proof(
        &self,
        scope: TransportIdentityScope,
        message: &[u8],
    ) -> Result<TransportIdentityProof, StationTransportLifecycleError> {
        self.prepare_route(scope.clone())?;
        let mut pool = self.shared.transports.lock().map_err(|_| {
            StationTransportLifecycleError("Station transport lifecycle lock poisoned".to_string())
        })?;
        pool.sequence = pool.sequence.saturating_add(1);
        let sequence = pool.sequence;
        let transport = pool.entries.get_mut(&scope).ok_or_else(|| {
            StationTransportLifecycleError(
                "Station transport identity was not prepared".to_string(),
            )
        })?;
        transport.last_used = sequence;
        let transport = transport.transport.clone();
        drop(pool);
        transport
            .handle
            .sign_identity_proof(message)
            .map_err(|error| {
                StationTransportLifecycleError(format!(
                    "sign scoped Station transport identity proof: {error}"
                ))
            })
    }

    pub fn prepare_route(
        &self,
        scope: TransportIdentityScope,
    ) -> Result<(), StationTransportLifecycleError> {
        {
            let mut pool = self.shared.transports.lock().map_err(|_| {
                StationTransportLifecycleError(
                    "Station transport lifecycle lock poisoned".to_string(),
                )
            })?;
            pool.sequence = pool.sequence.saturating_add(1);
            let sequence = pool.sequence;
            if let Some(existing) = pool.entries.get_mut(&scope) {
                existing.last_used = sequence;
                return Ok(());
            }
        }
        let keypair = self
            .shared
            .identity_store
            .keypair(&scope)
            .map_err(|error| StationTransportLifecycleError(error.to_string()))?;
        let owner = SecureTransportOwner::start_with_identity(keypair).map_err(|error| {
            StationTransportLifecycleError(format!("start scoped Station transport: {error}"))
        })?;
        let handle = owner.handle();
        let transport = Arc::new(ScopedTransport { owner, handle });
        let mut pool = self.shared.transports.lock().map_err(|_| {
            StationTransportLifecycleError("Station transport lifecycle lock poisoned".to_string())
        })?;
        if pool.entries.contains_key(&scope) {
            drop(pool);
            transport
                .owner
                .shutdown(Duration::from_secs(5))
                .map_err(|error| {
                    StationTransportLifecycleError(format!(
                        "discard duplicate Station transport: {error}"
                    ))
                })?;
            return Ok(());
        }
        let retired = if pool.entries.len() >= MAX_SCOPED_TRANSPORTS {
            let oldest = pool
                .entries
                .iter()
                .filter(|(_, entry)| entry.active_responses == 0)
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(scope, _)| scope.clone());
            let Some(oldest) = oldest else {
                drop(pool);
                let _ = transport.owner.shutdown(Duration::from_secs(5));
                return Err(StationTransportLifecycleError(
                    "Station transport pool is fully occupied by active responses".to_string(),
                ));
            };
            pool.entries.remove(&oldest).map(|entry| entry.transport)
        } else {
            None
        };
        pool.sequence = pool.sequence.saturating_add(1);
        let sequence = pool.sequence;
        pool.entries.insert(
            scope,
            ScopedTransportEntry {
                transport,
                last_used: sequence,
                active_responses: 0,
            },
        );
        drop(pool);
        if let Some(retired) = retired {
            retired
                .owner
                .shutdown(Duration::from_secs(5))
                .map_err(|error| {
                    StationTransportLifecycleError(format!(
                        "retire least-recently-used Station transport: {error}"
                    ))
                })?;
        }
        Ok(())
    }

    pub fn retire_except(
        &self,
        retained: Option<&TransportIdentityScope>,
        timeout: Duration,
    ) -> Result<(), StationTransportLifecycleError> {
        let transports = {
            let mut pool = self.shared.transports.lock().map_err(|_| {
                StationTransportLifecycleError(
                    "Station transport lifecycle lock poisoned".to_string(),
                )
            })?;
            let scopes = pool
                .entries
                .keys()
                .filter(|scope| Some(*scope) != retained)
                .cloned()
                .collect::<Vec<_>>();
            scopes
                .into_iter()
                .filter_map(|scope| {
                    pool.entries
                        .remove(&scope)
                        .map(|entry| (scope, entry.transport))
                })
                .collect::<Vec<_>>()
        };
        let deadline = std::time::Instant::now() + timeout;
        for (_, transport) in transports {
            transport
                .owner
                .shutdown(deadline.saturating_duration_since(std::time::Instant::now()))
                .map_err(|error| {
                    StationTransportLifecycleError(format!("retire Station transport: {error}"))
                })?;
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
        self.execute_secure_stream(lease, request, cancellation)
    }

    #[cfg(feature = "acceptance-webdriver")]
    pub fn set_acceptance_direct_route_override(
        &self,
        station_peer_id: &str,
        route_id: &str,
        node_peer_id: &str,
        dial_multiaddr: &str,
    ) -> Result<(), StationTransportLifecycleError> {
        let expected_suffix = format!("/p2p/{node_peer_id}");
        if !(dial_multiaddr.starts_with("/ip4/127.0.0.1/")
            || dial_multiaddr.starts_with("/ip6/::1/"))
            || dial_multiaddr.contains("/p2p-circuit")
            || !dial_multiaddr.ends_with(&expected_suffix)
            || station_peer_id.trim().is_empty()
            || route_id.trim().is_empty()
            || node_peer_id.trim().is_empty()
        {
            return Err(StationTransportLifecycleError(
                "Acceptance Direct route override must be a loopback Direct multiaddr".to_string(),
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
                dial_multiaddr.to_string(),
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
        let Ok(scope) = route_transport_scope(lease) else {
            return;
        };
        let Ok(transports) = self.shared.transports.lock() else {
            return;
        };
        let Some(transport) = transports
            .entries
            .get(&scope)
            .map(|entry| entry.transport.clone())
        else {
            return;
        };
        drop(transports);
        if let Ok(route) =
            secure_stream_route(lease, self.direct_route_override(lease).ok().flatten())
        {
            let _ = transport.handle.close_route(&route);
        }
    }

    pub fn shutdown(&self, timeout: Duration) -> Result<(), StationTransportLifecycleError> {
        let deadline = std::time::Instant::now() + timeout;
        self.shared.accepting.store(false, Ordering::Release);
        self.shared.shutdown.cancel();
        self.retire_except(
            None,
            deadline.saturating_duration_since(std::time::Instant::now()),
        )
    }

    fn execute_secure_stream(
        &self,
        lease: &RouteLease,
        request: StationRequest,
        cancellation: LinkedCancellation,
    ) -> Result<StationResponse, StationTransportError> {
        let expected_scope = route_transport_scope(lease)?;
        let transport_usage = self.acquire_transport(expected_scope)?;
        let route = secure_stream_route(lease, self.direct_route_override(lease)?)?;
        let mut secure_request = SecureRequest::new(
            request.method,
            request.path_and_query.parse().map_err(|error| {
                StationTransportError::new(
                    StationTransportErrorKind::Protocol,
                    format!("invalid Station request target: {error}"),
                    false,
                )
            })?,
        );
        secure_request.headers = request.headers;
        secure_request.body = match request.body {
            StationRequestBody::Empty => SecureRequestBody::Empty,
            StationRequestBody::Bytes(bytes) => SecureRequestBody::Bytes(bytes),
            StationRequestBody::Reader {
                reader,
                content_length,
            } => SecureRequestBody::Reader {
                reader,
                content_length,
            },
        };
        secure_request.timeout = request.timeout;
        secure_request.admission_timeout = request.admission_timeout;
        secure_request.traffic_class = match request.traffic_class {
            TrafficClass::Interactive => SecureTrafficClass::Interactive,
            TrafficClass::Realtime => SecureTrafficClass::Realtime,
            TrafficClass::Bulk => SecureTrafficClass::Bulk,
        };
        secure_request.cancellation = cancellation.token();
        let response = transport_usage
            .transport
            .handle
            .round_trip(&route, secure_request)
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
                Some(transport_usage),
            )),
        })
    }

    fn acquire_transport(
        &self,
        scope: TransportIdentityScope,
    ) -> Result<TransportUsage, StationTransportError> {
        let mut pool = self.shared.transports.lock().map_err(|_| {
            StationTransportError::new(
                StationTransportErrorKind::Shutdown,
                "Station transport lifecycle lock poisoned",
                false,
            )
        })?;
        pool.sequence = pool.sequence.saturating_add(1);
        let sequence = pool.sequence;
        let entry = pool.entries.get_mut(&scope).ok_or_else(|| {
            StationTransportError::new(
                StationTransportErrorKind::Shutdown,
                "Station transport identity was not prepared",
                false,
            )
        })?;
        entry.last_used = sequence;
        entry.active_responses = entry.active_responses.saturating_add(1);
        Ok(TransportUsage {
            shared: self.shared.clone(),
            scope,
            transport: entry.transport.clone(),
        })
    }

    fn direct_route_override(
        &self,
        lease: &RouteLease,
    ) -> Result<Option<String>, StationTransportError> {
        #[cfg(not(feature = "acceptance-webdriver"))]
        let _ = lease;
        #[cfg(feature = "acceptance-webdriver")]
        {
            if lease.route.route_type == StationRouteType::Direct {
                return self
                    .shared
                    .direct_route_overrides
                    .lock()
                    .map_err(|_| {
                        StationTransportError::new(
                            StationTransportErrorKind::Shutdown,
                            "Acceptance Direct route override lock poisoned",
                            false,
                        )
                    })
                    .map(|overrides| {
                        overrides
                            .get(&(lease.station_peer_id.clone(), lease.route_id.clone()))
                            .cloned()
                    });
            }
        }
        Ok(None)
    }
}

fn route_transport_scope(
    lease: &RouteLease,
) -> Result<TransportIdentityScope, StationTransportError> {
    match lease.route.route_type {
        StationRouteType::Direct => Ok(TransportIdentityScope::DirectStation(
            lease.station_peer_id.clone(),
        )),
        StationRouteType::Relay => lease
            .route
            .relay_peer_id
            .clone()
            .map(TransportIdentityScope::Relay)
            .ok_or_else(|| {
                StationTransportError::new(
                    StationTransportErrorKind::InvalidRoute,
                    "Circuit route has no Relay identity",
                    false,
                )
            }),
    }
}

fn secure_stream_route(
    lease: &RouteLease,
    direct_override: Option<String>,
) -> Result<SecureRoute, StationTransportError> {
    let inner_tls_spki_sha256 = lease
        .route
        .inner_tls_spki_sha256
        .as_deref()
        .and_then(|value| value.try_into().ok())
        .ok_or_else(|| {
            StationTransportError::new(
                StationTransportErrorKind::InvalidRoute,
                "Station route has no valid TLS SPKI pin",
                false,
            )
        })?;
    let dial_multiaddr = direct_override
        .or_else(|| {
            lease
                .route
                .addresses
                .iter()
                .find(|address| {
                    address.contains("/p2p-circuit/")
                        == (lease.route.route_type == StationRouteType::Relay)
                })
                .cloned()
        })
        .ok_or_else(|| {
            StationTransportError::new(
                StationTransportErrorKind::InvalidRoute,
                "Station route has no matching Direct/Circuit multiaddr",
                false,
            )
        })?;
    Ok(SecureRoute {
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
            None,
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
    fn direct_and_circuit_share_the_secure_stream_transport() {
        let source = include_str!("mod.rs");
        let production = source
            .split("#[cfg(test)]")
            .next()
            .expect("production transport source");

        assert!(!production.contains("reqwest::"));
        assert!(!production.contains("execute_direct"));
        assert!(production.contains("execute_secure_stream"));
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
                "one",
                "/ip4/127.0.0.1/tcp/39000/p2p/one",
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
            Some("/ip4/127.0.0.1/tcp/39000/p2p/one"),
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
