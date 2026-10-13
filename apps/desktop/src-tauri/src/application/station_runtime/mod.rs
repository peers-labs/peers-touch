pub mod client;
pub mod resource;
pub mod route_lease;

use crate::application::station_binding::{
    StationBindingError, StationBindingHooks, StationBindingService, StationBindingState,
};
use crate::application::station_runtime::client::{
    ReplayPolicy, StationClient, StationRequest, StationRequestExecutor, StationRequestScope,
    StationResponse, StationTransportError, StationTransportErrorKind, TrafficClass,
};
use crate::application::station_runtime::resource::StationResourceHandle;
use crate::infrastructure::station::{
    StationTransportHandle, StationTransportOwner, TransportIdentityScope,
};
use crate::infrastructure::station_registry::{StationEntry, StationRegistry, StationRouteType};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

struct RuntimeRequestExecutor {
    registry: Arc<StationRegistry>,
    binding: Arc<StationBindingService>,
    transport: StationTransportHandle,
    stopped: Arc<AtomicBool>,
}

struct RuntimeAttemptFailure {
    lease: Option<route_lease::RouteLease>,
    error: StationTransportError,
}

struct RuntimeBindingHooks<'a> {
    transport: &'a StationTransportHandle,
}

impl StationBindingHooks for RuntimeBindingHooks<'_> {
    fn verify_route(&self, entry: &StationEntry) -> Result<(), StationBindingError> {
        prepare_entry_transport(self.transport, entry)
            .map_err(|error| StationBindingError::new("station_transport_unavailable", error, true))
    }

    fn teardown_transport(
        &self,
        _previous: Option<&StationEntry>,
        _target: &StationEntry,
    ) -> Result<(), StationBindingError> {
        crate::infrastructure::event_stream::stop_all();
        Ok(())
    }

    fn teardown_scope(
        &self,
        _previous: Option<&StationEntry>,
        _target: &StationEntry,
    ) -> Result<(), StationBindingError> {
        crate::infrastructure::event_stream::stop_all();
        Ok(())
    }
}

impl RuntimeRequestExecutor {
    fn active_scope(&self) -> Option<StationRequestScope> {
        let state = self.binding.state();
        if !matches!(
            state.phase,
            crate::application::station_binding::StationBindingPhase::AccessGate
                | crate::application::station_binding::StationBindingPhase::Bound
        ) {
            return None;
        }
        Some(StationRequestScope {
            station_peer_id: state.station_peer_id?,
            lifecycle_generation: state.lifecycle_generation,
        })
    }

    fn scope_matches(&self, expected: &StationRequestScope) -> bool {
        self.active_scope().as_ref() == Some(expected)
    }

    fn execute_once(
        &self,
        request: StationRequest,
    ) -> Result<(route_lease::RouteLease, StationResponse), RuntimeAttemptFailure> {
        let lease = match self
            .binding
            .route_lease(&self.registry, request.traffic_class)
        {
            Ok(lease) => lease,
            Err(error) => {
                return Err(RuntimeAttemptFailure {
                    lease: None,
                    error: binding_transport_error(error),
                })
            }
        };
        if request.expected_scope.as_ref().is_some_and(|expected| {
            lease.station_peer_id != expected.station_peer_id
                || lease.lifecycle_generation != expected.lifecycle_generation
        }) {
            return Err(RuntimeAttemptFailure {
                lease: Some(lease),
                error: StationTransportError::new(
                    StationTransportErrorKind::StaleRoute,
                    "Station request belongs to a stale lifecycle",
                    false,
                ),
            });
        }
        match self.transport.execute(&lease, request) {
            Ok(response) => Ok((lease, response)),
            Err(error) => Err(RuntimeAttemptFailure {
                lease: Some(lease),
                error,
            }),
        }
    }
}

impl StationRequestExecutor for RuntimeRequestExecutor {
    fn execute(&self, request: StationRequest) -> Result<StationResponse, StationTransportError> {
        if self.stopped.load(Ordering::Acquire) {
            return Err(StationTransportError::new(
                StationTransportErrorKind::Shutdown,
                "Station runtime is shutting down",
                false,
            ));
        }
        if request
            .expected_scope
            .as_ref()
            .is_some_and(|expected| !self.scope_matches(expected))
        {
            return Err(StationTransportError::new(
                StationTransportErrorKind::StaleRoute,
                "Station request belongs to a stale lifecycle",
                false,
            ));
        }
        let replay = request.replay_copy();
        let replay_policy = request.replay_policy.clone();
        match self.execute_once(request) {
            Ok((_, response)) => Ok(response),
            Err(failure)
                if matches!(
                    replay_policy,
                    ReplayPolicy::SafeRead | ReplayPolicy::Idempotent(_)
                ) && matches!(
                    failure.error.kind,
                    StationTransportErrorKind::Unavailable
                        | StationTransportErrorKind::Timeout
                        | StationTransportErrorKind::StaleRoute
                ) =>
            {
                let RuntimeAttemptFailure { lease, error } = failure;
                let Some(replay) = replay else {
                    return Err(error);
                };
                if replay
                    .expected_scope
                    .as_ref()
                    .is_some_and(|expected| !self.scope_matches(expected))
                {
                    return Err(error);
                }
                let Some(stale) = lease else {
                    return Err(error);
                };
                self.transport.close_route(&stale);
                let hooks = RuntimeBindingHooks {
                    transport: &self.transport,
                };
                self.binding
                    .failover(&self.registry, &stale, &hooks)
                    .map_err(binding_transport_error)?;
                self.execute_once(replay)
                    .map(|(_, response)| response)
                    .map_err(|failure| failure.error)
            }
            Err(failure) => Err(failure.error),
        }
    }

    fn active_scope(&self) -> Option<StationRequestScope> {
        RuntimeRequestExecutor::active_scope(self)
    }

    fn active_station_peer_id(&self) -> Option<String> {
        self.registry.active_station_peer_id()
    }

    fn active_endpoint_origin(&self) -> Option<String> {
        self.registry.active_endpoint_origin()
    }

    fn authority_endpoint_origin(&self, station_peer_id: &str) -> Result<String, String> {
        let matches = self
            .registry
            .list()
            .into_iter()
            .filter(|entry| entry.station_peer_id == station_peer_id)
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err("messaging authority Station route is unavailable".to_string());
        }
        let endpoint_origin = matches[0]
            .active_route()
            .map(|route| route.endpoint_origin.clone())
            .ok_or_else(|| "messaging authority Station route is unavailable".to_string())?;
        let pin = self
            .registry
            .federation_signing_key_pin(station_peer_id)
            .map_err(|error| format!("messaging authority Station pin is invalid: {error}"))?
            .ok_or_else(|| "messaging authority Station route is not pinned".to_string())?;
        if pin.station_peer_id != station_peer_id {
            return Err("messaging authority Station pin binding mismatch".to_string());
        }
        Ok(endpoint_origin)
    }
}

pub struct StationRuntime {
    registry: Arc<StationRegistry>,
    binding: Arc<StationBindingService>,
    transport_owner: StationTransportOwner,
    transport: StationTransportHandle,
    client: StationClient,
    resources: StationResourceHandle,
    stopped: Arc<AtomicBool>,
}

impl StationRuntime {
    pub fn start(config_dir: &Path) -> Result<Self, String> {
        let registry = Arc::new(StationRegistry::new(config_dir));
        let binding = Arc::new(StationBindingService::new(registry.active_entry()));
        let transport_owner = StationTransportOwner::start().map_err(|error| error.to_string())?;
        let transport = transport_owner.handle();
        let stopped = Arc::new(AtomicBool::new(false));
        if let Some(entry) = registry.active_entry() {
            prepare_entry_transport(&transport, &entry)?;
        }
        let executor = Arc::new(RuntimeRequestExecutor {
            registry: registry.clone(),
            binding: binding.clone(),
            transport: transport.clone(),
            stopped: stopped.clone(),
        });
        let client = StationClient::new(executor);
        let resources = StationResourceHandle::new(client.clone());
        Ok(Self {
            registry,
            binding,
            transport_owner,
            transport,
            client,
            resources,
            stopped,
        })
    }

    pub fn client(&self) -> &StationClient {
        &self.client
    }

    pub fn registry(&self) -> &StationRegistry {
        &self.registry
    }

    pub fn binding(&self) -> &StationBindingService {
        &self.binding
    }

    pub fn resources(&self) -> &StationResourceHandle {
        &self.resources
    }

    pub fn active_station_peer_id(&self) -> Option<String> {
        self.registry
            .active_station_peer_id()
            .filter(|peer_id| !peer_id.trim().is_empty())
    }

    pub fn active_endpoint_origin(&self) -> Option<String> {
        self.registry.active_endpoint_origin()
    }

    pub fn switch_station(
        &self,
        station_peer_id: &str,
        route_id: Option<&str>,
    ) -> Result<StationBindingState, StationBindingError> {
        let previous = self
            .binding
            .route_lease(&self.registry, TrafficClass::Interactive)
            .ok();
        let hooks = RuntimeBindingHooks {
            transport: &self.transport,
        };
        let state =
            self.binding
                .switch_with_hooks(&self.registry, station_peer_id, route_id, &hooks)?;
        if let Some(previous) = previous {
            self.transport.close_route(&previous);
            self.resources
                .revoke_scope(&previous.station_peer_id, previous.lifecycle_generation);
        }
        Ok(state)
    }

    pub fn resume_persisted(&self) -> Result<StationBindingState, StationBindingError> {
        let hooks = RuntimeBindingHooks {
            transport: &self.transport,
        };
        self.binding
            .resume_persisted_with_hooks(&self.registry, &hooks)
    }

    pub fn remove_station(
        &self,
        station_peer_id: &str,
    ) -> Result<(StationBindingState, bool), StationBindingError> {
        let previous = self
            .binding
            .route_lease(&self.registry, TrafficClass::Interactive)
            .ok();
        let result = self
            .binding
            .remove_station(&self.registry, station_peer_id)?;
        if let Some(previous) = previous {
            self.transport.close_route(&previous);
            self.resources
                .revoke_scope(&previous.station_peer_id, previous.lifecycle_generation);
        }
        Ok(result)
    }

    pub fn prepare_transport_identity(
        &self,
        scope: TransportIdentityScope,
    ) -> Result<String, String> {
        self.transport
            .prepare_identity(scope)
            .map_err(|error| error.to_string())
    }

    pub fn shutdown(&self) -> Result<(), String> {
        if self.stopped.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        self.resources.clear();
        self.transport_owner
            .shutdown(Duration::from_secs(5))
            .map_err(|error| error.to_string())
    }
}

impl Drop for StationRuntime {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

fn binding_transport_error(error: StationBindingError) -> StationTransportError {
    StationTransportError::new(
        if error.code == "station_route_stale" {
            StationTransportErrorKind::StaleRoute
        } else {
            StationTransportErrorKind::Unavailable
        },
        error.message,
        false,
    )
}

fn prepare_entry_transport(
    transport: &StationTransportHandle,
    entry: &StationEntry,
) -> Result<(), String> {
    let Some(route) = entry.active_route() else {
        return Err("The Station has no active route".to_string());
    };
    if route.route_type == StationRouteType::Relay {
        let relay_peer_id = route
            .relay_peer_id
            .clone()
            .ok_or_else(|| "Circuit route has no Relay identity".to_string())?;
        transport
            .prepare_identity(TransportIdentityScope::Relay(relay_peer_id))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
