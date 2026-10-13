pub mod client;
pub mod resource;
pub mod route_lease;

use crate::application::station_binding::{
    StationBindingError, StationBindingHooks, StationBindingService, StationBindingState,
};
use crate::application::station_runtime::client::{
    ReplayPolicy, StationClient, StationRequest, StationRequestExecutor, StationRequestScope,
    StationResponse, StationRoutePolicy, StationTransportError, StationTransportErrorKind,
    TrafficClass,
};
use crate::application::station_runtime::resource::StationResourceHandle;
use crate::infrastructure::station::{
    StationTransportHandle, StationTransportOwner, TransportIdentityScope,
};
use crate::infrastructure::station_registry::{StationEntry, StationRegistry, StationRouteType};
use serde::Serialize;
use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const MAX_ROUTE_ATTEMPT_DIAGNOSTICS: usize = 128;
const MAX_ROUTE_TRANSITION_DIAGNOSTICS: usize = 64;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StationRouteAttemptDiagnostic {
    pub sequence: u64,
    pub policy: StationRoutePolicy,
    pub station_peer_id: String,
    pub route_id: String,
    pub route_type: StationRouteType,
    pub request_path: String,
    pub route_revision: u64,
    pub lifecycle_generation: u64,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StationRouteTransitionDiagnostic {
    pub sequence: u64,
    pub reason: String,
    pub station_peer_id: String,
    pub previous_route_id: String,
    pub next_route_id: String,
    pub previous_route_revision: u64,
    pub next_route_revision: u64,
    pub lifecycle_generation: u64,
    pub previous_lease_cancelled: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StationTransportDiagnostics {
    pub attempts: Vec<StationRouteAttemptDiagnostic>,
    pub transitions: Vec<StationRouteTransitionDiagnostic>,
}

#[derive(Default)]
struct RuntimeDiagnostics {
    next_sequence: u64,
    attempts: VecDeque<StationRouteAttemptDiagnostic>,
    transitions: VecDeque<StationRouteTransitionDiagnostic>,
}

impl RuntimeDiagnostics {
    fn next_sequence(&mut self) -> u64 {
        self.next_sequence = self.next_sequence.saturating_add(1);
        self.next_sequence
    }

    fn push_attempt(&mut self, mut attempt: StationRouteAttemptDiagnostic) {
        attempt.sequence = self.next_sequence();
        self.attempts.push_back(attempt);
        while self.attempts.len() > MAX_ROUTE_ATTEMPT_DIAGNOSTICS {
            self.attempts.pop_front();
        }
    }

    fn push_transition(&mut self, mut transition: StationRouteTransitionDiagnostic) {
        transition.sequence = self.next_sequence();
        self.transitions.push_back(transition);
        while self.transitions.len() > MAX_ROUTE_TRANSITION_DIAGNOSTICS {
            self.transitions.pop_front();
        }
    }

    fn snapshot(&self) -> StationTransportDiagnostics {
        StationTransportDiagnostics {
            attempts: self.attempts.iter().cloned().collect(),
            transitions: self.transitions.iter().cloned().collect(),
        }
    }
}

struct RuntimeRequestExecutor {
    registry: Arc<StationRegistry>,
    binding: Arc<StationBindingService>,
    transport: StationTransportHandle,
    stopped: Arc<AtomicBool>,
    transition: Arc<Mutex<()>>,
    diagnostics: Arc<Mutex<RuntimeDiagnostics>>,
}

struct RuntimeAttemptFailure {
    lease: Option<route_lease::RouteLease>,
    error: StationTransportError,
}

struct RuntimeBindingHooks<'a> {
    transport: &'a StationTransportHandle,
    before_commit: Option<&'a (dyn Fn(bool) -> Result<(), StationBindingError> + Send + Sync)>,
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
        if let Some(before_commit) = self.before_commit {
            before_commit(false)?;
        }
        Ok(())
    }

    fn teardown_scope(
        &self,
        _previous: Option<&StationEntry>,
        _target: &StationEntry,
    ) -> Result<(), StationBindingError> {
        crate::infrastructure::event_stream::stop_all();
        if let Some(before_commit) = self.before_commit {
            before_commit(true)?;
        }
        Ok(())
    }
}

impl RuntimeRequestExecutor {
    fn record_attempt(
        &self,
        lease: &route_lease::RouteLease,
        policy: StationRoutePolicy,
        request_path: &str,
        outcome: &str,
        error_kind: Option<StationTransportErrorKind>,
    ) {
        if let Ok(mut diagnostics) = self.diagnostics.lock() {
            diagnostics.push_attempt(StationRouteAttemptDiagnostic {
                sequence: 0,
                policy,
                station_peer_id: lease.station_peer_id.clone(),
                route_id: lease.route_id.clone(),
                route_type: lease.route.route_type,
                request_path: request_path.to_string(),
                route_revision: lease.route_revision,
                lifecycle_generation: lease.lifecycle_generation,
                outcome: outcome.to_string(),
                error_code: error_kind.map(station_transport_error_code),
            });
        }
    }

    fn record_transition(&self, stale: &route_lease::RouteLease, next: &StationBindingState) {
        if let Ok(mut diagnostics) = self.diagnostics.lock() {
            diagnostics.push_transition(StationRouteTransitionDiagnostic {
                sequence: 0,
                reason: "automatic_failover".to_string(),
                station_peer_id: stale.station_peer_id.clone(),
                previous_route_id: stale.route_id.clone(),
                next_route_id: next.active_route_id.clone().unwrap_or_default(),
                previous_route_revision: stale.route_revision,
                next_route_revision: next.route_revision,
                lifecycle_generation: next.lifecycle_generation,
                previous_lease_cancelled: stale.is_cancelled(),
            });
        }
    }

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
        let route_policy = request.route_policy;
        let request_path = request
            .path_and_query
            .split_once('?')
            .map_or(request.path_and_query.as_str(), |(path, _)| path)
            .to_string();
        let lease = match self.binding.route_lease(request.traffic_class) {
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
        if !route_policy_permits(route_policy, lease.route.route_type) {
            let error = StationTransportError::new(
                StationTransportErrorKind::RoutePolicyConflict,
                "The active Station route conflicts with the request route policy",
                false,
            );
            self.record_attempt(
                &lease,
                route_policy,
                &request_path,
                "failed",
                Some(error.kind),
            );
            return Err(RuntimeAttemptFailure {
                lease: Some(lease),
                error,
            });
        }
        if !request.route_security.permits(&lease.route.endpoint_origin) {
            let error = StationTransportError::new(
                StationTransportErrorKind::InvalidRoute,
                "Station route does not satisfy the request transport security policy",
                false,
            );
            self.record_attempt(
                &lease,
                route_policy,
                &request_path,
                "failed",
                Some(error.kind),
            );
            return Err(RuntimeAttemptFailure {
                lease: Some(lease),
                error,
            });
        }
        match self.transport.execute(&lease, request) {
            Ok(response) => {
                self.record_attempt(&lease, route_policy, &request_path, "connected", None);
                Ok((lease, response))
            }
            Err(error) => {
                let error = closed_policy_transport_error(route_policy, error);
                self.record_attempt(
                    &lease,
                    route_policy,
                    &request_path,
                    "failed",
                    Some(error.kind),
                );
                Err(RuntimeAttemptFailure {
                    lease: Some(lease),
                    error,
                })
            }
        }
    }
}

impl StationRequestExecutor for RuntimeRequestExecutor {
    fn execute(
        &self,
        mut request: StationRequest,
    ) -> Result<StationResponse, StationTransportError> {
        if self.stopped.load(Ordering::Acquire) {
            return Err(StationTransportError::new(
                StationTransportErrorKind::Shutdown,
                "Station runtime is shutting down",
                false,
            ));
        }
        if request.expected_scope.is_none() {
            request.expected_scope = self.active_scope();
        }
        if request.expected_scope.is_none() {
            return Err(StationTransportError::new(
                StationTransportErrorKind::Unavailable,
                "Station binding is not ready",
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
        let route_policy = request.route_policy;
        match self.execute_once(request) {
            Ok((_, response)) => Ok(response),
            Err(failure)
                if matches!(
                    replay_policy,
                    ReplayPolicy::SafeRead | ReplayPolicy::Idempotent(_)
                ) && route_policy == StationRoutePolicy::Auto
                    && matches!(
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
                let _transition = self.transition.lock().map_err(|_| {
                    StationTransportError::new(
                        StationTransportErrorKind::Shutdown,
                        "Station transition lock unavailable",
                        false,
                    )
                })?;
                self.transport.close_route(&stale);
                let hooks = RuntimeBindingHooks {
                    transport: &self.transport,
                    before_commit: None,
                };
                let next = self
                    .binding
                    .failover(&self.registry, &stale, &hooks)
                    .map_err(binding_transport_error)?;
                self.record_transition(&stale, &next);
                retire_inactive_transport(&self.binding, &self.transport);
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
        self.binding
            .committed_entry()
            .map(|entry| entry.station_peer_id)
    }

    fn active_endpoint_origin(&self) -> Option<String> {
        self.binding.committed_entry().and_then(|entry| {
            entry
                .active_route()
                .map(|route| route.endpoint_origin.clone())
        })
    }

    fn owns_resource_origin(&self, origin: &str) -> bool {
        let Some(scope) = self.active_scope() else {
            return false;
        };
        self.registry
            .entry(&scope.station_peer_id)
            .is_some_and(|entry| {
                entry.routes.iter().any(|route| {
                    route.route_type == StationRouteType::Direct
                        && route.endpoint_origin.trim_end_matches('/')
                            == origin.trim_end_matches('/')
                })
            })
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
    transition: Arc<Mutex<()>>,
    diagnostics: Arc<Mutex<RuntimeDiagnostics>>,
}

impl StationRuntime {
    pub fn start(config_dir: &Path) -> Result<Self, String> {
        let registry = Arc::new(StationRegistry::new(config_dir));
        let binding = Arc::new(StationBindingService::new(registry.active_entry()));
        let transport_owner = StationTransportOwner::start().map_err(|error| error.to_string())?;
        let transport = transport_owner.handle();
        let stopped = Arc::new(AtomicBool::new(false));
        let transition = Arc::new(Mutex::new(()));
        let diagnostics = Arc::new(Mutex::new(RuntimeDiagnostics::default()));
        if let Some(entry) = registry.active_entry() {
            prepare_entry_transport(&transport, &entry)?;
        }
        let executor = Arc::new(RuntimeRequestExecutor {
            registry: registry.clone(),
            binding: binding.clone(),
            transport: transport.clone(),
            stopped: stopped.clone(),
            transition: transition.clone(),
            diagnostics: diagnostics.clone(),
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
            transition,
            diagnostics,
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

    pub fn diagnostics(&self) -> StationTransportDiagnostics {
        self.diagnostics
            .lock()
            .map(|diagnostics| diagnostics.snapshot())
            .unwrap_or_default()
    }

    #[cfg(feature = "acceptance-webdriver")]
    pub fn set_acceptance_direct_route_override(
        &self,
        endpoint_origin: Option<&str>,
    ) -> Result<(), String> {
        let Some(endpoint_origin) = endpoint_origin else {
            return self
                .transport
                .clear_acceptance_direct_route_overrides()
                .map_err(|error| error.to_string());
        };
        let lease = self
            .binding
            .route_lease(TrafficClass::Interactive)
            .map_err(|error| error.message)?;
        if lease.route.route_type != StationRouteType::Direct {
            return Err(
                "Acceptance Direct route override requires an active Direct route".to_string(),
            );
        }
        self.transport
            .set_acceptance_direct_route_override(
                &lease.station_peer_id,
                &lease.route_id,
                endpoint_origin,
            )
            .map_err(|error| error.to_string())
    }

    pub fn active_station_peer_id(&self) -> Option<String> {
        self.binding
            .committed_entry()
            .map(|entry| entry.station_peer_id)
            .filter(|peer_id| !peer_id.trim().is_empty())
    }

    pub fn active_endpoint_origin(&self) -> Option<String> {
        self.binding.committed_entry().and_then(|entry| {
            entry
                .active_route()
                .map(|route| route.endpoint_origin.clone())
        })
    }

    pub fn switch_station_with_teardown(
        &self,
        station_peer_id: &str,
        route_id: Option<&str>,
        before_commit: &(dyn Fn(bool) -> Result<(), StationBindingError> + Send + Sync),
    ) -> Result<StationBindingState, StationBindingError> {
        let _transition = self.transition.lock().map_err(|_| {
            StationBindingError::new(
                "station_switch_failed",
                "Station transition lock unavailable",
                true,
            )
        })?;
        if self.stopped.load(Ordering::Acquire) {
            return Err(StationBindingError::new(
                "station_runtime_stopped",
                "Station runtime is stopped",
                false,
            ));
        }
        let before = self.binding.state();
        let previous = self.binding.route_lease(TrafficClass::Interactive).ok();
        let hooks = RuntimeBindingHooks {
            transport: &self.transport,
            before_commit: Some(before_commit),
        };
        let result =
            self.binding
                .switch_with_hooks(&self.registry, station_peer_id, route_id, &hooks);
        if let Ok(state) = &result {
            if let Some(previous) = previous.as_ref() {
                if previous.route_id != state.active_route_id.clone().unwrap_or_default()
                    || previous.route_revision != state.route_revision
                    || previous.station_peer_id != state.station_peer_id.clone().unwrap_or_default()
                {
                    self.transport.close_route(previous);
                }
                if state.station_peer_id.as_deref() != Some(previous.station_peer_id.as_str())
                    || state.lifecycle_generation != previous.lifecycle_generation
                {
                    self.resources
                        .revoke_scope(&previous.station_peer_id, previous.lifecycle_generation);
                }
            }
            if before.station_peer_id != state.station_peer_id
                || before.active_route_id != state.active_route_id
                || before.route_revision != state.route_revision
            {
                if let Ok(mut diagnostics) = self.diagnostics.lock() {
                    diagnostics.push_transition(StationRouteTransitionDiagnostic {
                        sequence: 0,
                        reason: "explicit_switch".to_string(),
                        station_peer_id: state.station_peer_id.clone().unwrap_or_default(),
                        previous_route_id: before.active_route_id.clone().unwrap_or_default(),
                        next_route_id: state.active_route_id.clone().unwrap_or_default(),
                        previous_route_revision: before.route_revision,
                        next_route_revision: state.route_revision,
                        lifecycle_generation: state.lifecycle_generation,
                        previous_lease_cancelled: previous
                            .as_ref()
                            .is_some_and(route_lease::RouteLease::is_cancelled),
                    });
                }
            }
        }
        retire_inactive_transport(&self.binding, &self.transport);
        result
    }

    pub fn resume_persisted(&self) -> Result<StationBindingState, StationBindingError> {
        let _transition = self.transition.lock().map_err(|_| {
            StationBindingError::new(
                "station_switch_failed",
                "Station transition lock unavailable",
                true,
            )
        })?;
        let hooks = RuntimeBindingHooks {
            transport: &self.transport,
            before_commit: None,
        };
        self.binding
            .resume_persisted_with_hooks(&self.registry, &hooks)
    }

    pub fn remove_station(
        &self,
        station_peer_id: &str,
    ) -> Result<(StationBindingState, bool), StationBindingError> {
        let _transition = self.transition.lock().map_err(|_| {
            StationBindingError::new(
                "station_switch_failed",
                "Station transition lock unavailable",
                true,
            )
        })?;
        let previous = self.binding.route_lease(TrafficClass::Interactive).ok();
        let result = self
            .binding
            .remove_station(&self.registry, station_peer_id)?;
        if let Some(previous) = previous.filter(|_| result.1) {
            self.transport.close_route(&previous);
            self.resources
                .revoke_scope(&previous.station_peer_id, previous.lifecycle_generation);
            retire_inactive_transport(&self.binding, &self.transport);
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

    pub fn store_verified_routes(
        &self,
        routes: &[crate::infrastructure::station_discovery::VerifiedStationRoute],
    ) -> Result<Vec<StationEntry>, StationBindingError> {
        let _transition = self.transition.lock().map_err(|_| {
            StationBindingError::new(
                "station_switch_failed",
                "Station transition lock unavailable",
                true,
            )
        })?;
        let result = self.binding.store_verified_routes(&self.registry, routes);
        retire_inactive_transport(&self.binding, &self.transport);
        result
    }

    pub fn shutdown(&self) -> Result<(), String> {
        let _transition = self
            .transition
            .lock()
            .map_err(|_| "Station transition lock unavailable".to_string())?;
        self.stopped.store(true, Ordering::Release);
        self.binding.revoke();
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
        match error.code.as_str() {
            "station_route_stale" => StationTransportErrorKind::StaleRoute,
            "station_no_route" | "station_route_unavailable" => StationTransportErrorKind::NoRoute,
            _ => StationTransportErrorKind::Unavailable,
        },
        error.message,
        false,
    )
}

fn closed_policy_transport_error(
    policy: StationRoutePolicy,
    error: StationTransportError,
) -> StationTransportError {
    if policy != StationRoutePolicy::Auto
        && matches!(
            error.kind,
            StationTransportErrorKind::Unavailable | StationTransportErrorKind::Timeout
        )
    {
        StationTransportError::new(
            StationTransportErrorKind::NoRoute,
            error.message,
            error.submitted,
        )
    } else {
        error
    }
}

fn route_policy_permits(policy: StationRoutePolicy, route_type: StationRouteType) -> bool {
    match policy {
        StationRoutePolicy::Auto => true,
        StationRoutePolicy::DirectOnly => route_type == StationRouteType::Direct,
        StationRoutePolicy::RelayOnly => route_type == StationRouteType::Relay,
    }
}

fn station_transport_error_code(kind: StationTransportErrorKind) -> String {
    match kind {
        StationTransportErrorKind::Overloaded => "station_overloaded",
        StationTransportErrorKind::Cancelled | StationTransportErrorKind::Shutdown => {
            "station_cancelled"
        }
        StationTransportErrorKind::StaleRoute => "station_stale_route",
        StationTransportErrorKind::NoRoute => "station_no_route",
        StationTransportErrorKind::RoutePolicyConflict => "station_route_policy_conflict",
        _ => "station_transport_failed",
    }
    .to_string()
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
            .prepare_route(TransportIdentityScope::Relay(relay_peer_id))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn entry_transport_scope(entry: &StationEntry) -> Option<TransportIdentityScope> {
    let route = entry.active_route()?;
    (route.route_type == StationRouteType::Relay)
        .then(|| {
            route
                .relay_peer_id
                .clone()
                .map(TransportIdentityScope::Relay)
        })
        .flatten()
}

fn retire_inactive_transport(binding: &StationBindingService, transport: &StationTransportHandle) {
    let retained = binding
        .committed_entry()
        .as_ref()
        .and_then(entry_transport_scope);
    if let Err(error) = transport.retire_except(retained.as_ref(), Duration::from_secs(5)) {
        tracing::warn!(
            error = %error,
            "inactive Station transport did not retire after binding commit"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::station_runtime::client::{StationRequestBody, StationRouteSecurity};
    use crate::infrastructure::station_discovery::VerifiedStationRoute;
    use reqwest::Method;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::thread;
    use tokio_util::sync::CancellationToken;

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "peers-station-runtime-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn direct_route(route_id: &str, origin: String) -> VerifiedStationRoute {
        VerifiedStationRoute {
            station_peer_id: "station-one".to_string(),
            node_peer_id: format!("station-one-{route_id}"),
            station_root_public_key: vec![1, 2, 3],
            node_authorization_digest: [4; 32],
            authorization_epoch: 1,
            route_id: route_id.to_string(),
            route_generation: 1,
            endpoint_origin: origin.clone(),
            relay_peer_id: None,
            inner_tls_spki_sha256: None,
            addresses: vec![origin],
            attestation_bytes: None,
            connection_grant: None,
            expires_at_unix_ms: None,
        }
    }

    fn serve_empty_response_once() -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let _ = stream.read(&mut request);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
        });
        (origin, server)
    }

    #[test]
    fn automatic_failover_replays_sse_without_cancelling_caller_scope() {
        let unavailable_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let unavailable_origin = format!("http://{}", unavailable_listener.local_addr().unwrap());
        drop(unavailable_listener);
        let (available_origin, server) = serve_empty_response_once();
        let runtime = StationRuntime::start(&temp_dir("sse-failover")).unwrap();
        runtime
            .store_verified_routes(&[
                direct_route("route-a", unavailable_origin),
                direct_route("route-b", available_origin),
            ])
            .unwrap();
        runtime
            .switch_station_with_teardown("station-one", Some("route-a"), &|_| Ok(()))
            .unwrap();
        runtime.binding().mark_bound().unwrap();
        let before = runtime.binding().state();

        let actor_ptid = format!("ptid:test:sse-failover-{}", std::process::id());
        let cancellation = CancellationToken::new();
        crate::infrastructure::event_stream::register_test_control(
            &actor_ptid,
            cancellation.clone(),
        );
        let response = runtime
            .client()
            .execute_raw(StationRequest {
                method: Method::GET,
                path_and_query: "/events/stream".to_string(),
                headers: Default::default(),
                body: StationRequestBody::Empty,
                timeout: Duration::from_secs(5),
                admission_timeout: Duration::from_secs(1),
                traffic_class: TrafficClass::Realtime,
                route_security: StationRouteSecurity::VerifiedRoute,
                route_policy: client::StationRoutePolicy::Auto,
                replay_policy: ReplayPolicy::SafeRead,
                cancellation: cancellation.clone(),
                expected_scope: None,
            })
            .expect("SSE request must replay on the replacement route");

        assert_eq!(response.status, 200);
        assert!(!cancellation.is_cancelled());
        assert_eq!(
            runtime.binding().state().active_route_id.as_deref(),
            Some("route-b")
        );
        let diagnostics = runtime.diagnostics();
        assert_eq!(diagnostics.attempts.len(), 2);
        assert_eq!(diagnostics.attempts[0].route_id, "route-a");
        assert_eq!(diagnostics.attempts[0].outcome, "failed");
        assert_eq!(diagnostics.attempts[1].route_id, "route-b");
        assert_eq!(diagnostics.attempts[1].outcome, "connected");
        assert!(diagnostics.attempts[0].sequence < diagnostics.attempts[1].sequence);
        let transition = diagnostics
            .transitions
            .last()
            .expect("automatic failover transition");
        assert_eq!(transition.reason, "automatic_failover");
        assert_eq!(transition.station_peer_id, "station-one");
        assert_eq!(transition.previous_route_id, "route-a");
        assert_eq!(transition.next_route_id, "route-b");
        assert_eq!(transition.lifecycle_generation, before.lifecycle_generation);
        assert!(transition.next_route_revision > before.route_revision);
        assert!(transition.previous_lease_cancelled);

        drop(response);
        crate::infrastructure::event_stream::stop(&actor_ptid);
        server.join().unwrap();
    }

    #[test]
    fn closed_route_policy_conflict_does_not_mutate_binding() {
        let runtime = StationRuntime::start(&temp_dir("route-policy-conflict")).unwrap();
        runtime
            .store_verified_routes(&[direct_route("route-a", "http://127.0.0.1:1".to_string())])
            .unwrap();
        runtime
            .switch_station_with_teardown("station-one", Some("route-a"), &|_| Ok(()))
            .unwrap();
        runtime.binding().mark_bound().unwrap();
        let before = runtime.binding().state();
        let transition_count = runtime.diagnostics().transitions.len();

        let error = match runtime.client().execute_raw(StationRequest {
            method: Method::GET,
            path_and_query: "/app-meta/version".to_string(),
            headers: Default::default(),
            body: StationRequestBody::Empty,
            timeout: Duration::from_secs(1),
            admission_timeout: Duration::from_secs(1),
            traffic_class: TrafficClass::Interactive,
            route_security: StationRouteSecurity::VerifiedRoute,
            route_policy: client::StationRoutePolicy::RelayOnly,
            replay_policy: ReplayPolicy::SafeRead,
            cancellation: CancellationToken::new(),
            expected_scope: None,
        }) {
            Err(error) => error,
            Ok(_) => panic!("Relay-only must reject a committed Direct lease"),
        };

        assert!(matches!(
            error.kind,
            client::StationClientErrorKind::RoutePolicyConflict
        ));
        assert_eq!(runtime.binding().state(), before);
        let diagnostics = runtime.diagnostics();
        assert_eq!(diagnostics.attempts.len(), 1);
        assert_eq!(
            diagnostics.attempts[0].error_code.as_deref(),
            Some("station_route_policy_conflict")
        );
        assert_eq!(diagnostics.transitions.len(), transition_count);
    }

    #[test]
    fn unavailable_closed_route_is_typed_no_route_without_failover() {
        let unavailable_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let unavailable_origin = format!("http://{}", unavailable_listener.local_addr().unwrap());
        drop(unavailable_listener);
        let runtime = StationRuntime::start(&temp_dir("closed-route-no-route")).unwrap();
        runtime
            .store_verified_routes(&[direct_route("route-a", unavailable_origin)])
            .unwrap();
        runtime
            .switch_station_with_teardown("station-one", Some("route-a"), &|_| Ok(()))
            .unwrap();
        runtime.binding().mark_bound().unwrap();
        let before = runtime.binding().state();
        let transition_count = runtime.diagnostics().transitions.len();

        let error = match runtime.client().execute_raw(StationRequest {
            method: Method::GET,
            path_and_query: "/app-meta/version".to_string(),
            headers: Default::default(),
            body: StationRequestBody::Empty,
            timeout: Duration::from_secs(1),
            admission_timeout: Duration::from_secs(1),
            traffic_class: TrafficClass::Interactive,
            route_security: StationRouteSecurity::VerifiedRoute,
            route_policy: client::StationRoutePolicy::DirectOnly,
            replay_policy: ReplayPolicy::SafeRead,
            cancellation: CancellationToken::new(),
            expected_scope: None,
        }) {
            Err(error) => error,
            Ok(_) => panic!("closed Direct route failure must be typed no-route"),
        };

        assert!(matches!(
            error.kind,
            client::StationClientErrorKind::NoRoute
        ));
        assert_eq!(runtime.binding().state(), before);
        let diagnostics = runtime.diagnostics();
        assert_eq!(diagnostics.attempts.len(), 1);
        assert_eq!(
            diagnostics.attempts[0].error_code.as_deref(),
            Some("station_no_route")
        );
        assert_eq!(diagnostics.transitions.len(), transition_count);
    }
}
