pub mod client;
pub mod resource;
pub mod route_lease;
mod route_refresh;

use crate::application::station_binding::{
    StationBindingError, StationBindingHooks, StationBindingService, StationBindingState,
};
use crate::application::station_runtime::client::{
    ReplayPolicy, StationClient, StationRequest, StationRequestExecutor, StationRequestScope,
    StationResponse, StationRoutePolicy, StationTransportError, StationTransportErrorKind,
    TrafficClass,
};
use crate::application::station_runtime::resource::StationResourceHandle;
use crate::infrastructure::station::{StationTransportHandle, StationTransportOwner};
use crate::infrastructure::station_registry::{
    route_attestation_is_current, StationEntry, StationRegistry, StationRouteHealth,
    StationRouteType,
};
use serde::Serialize;
use station_libp2p_http::TransportIdentityProof;
use station_trust::transport_identity::TransportIdentityScope;
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
    fn execute_request(
        &self,
        mut request: StationRequest,
        deadline: Option<std::time::Instant>,
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
        self.renew_route_before_submission(&request, deadline)?;
        if let Some(deadline) = deadline {
            request.bound_to_deadline(deadline)?;
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
                let Some(mut replay) = replay else {
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
                let _transition = self.request_transition(
                    &replay,
                    deadline.unwrap_or_else(|| std::time::Instant::now() + replay.timeout),
                )?;
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
                if let Some(deadline) = deadline {
                    replay.bound_to_deadline(deadline)?;
                }
                self.execute_once(replay)
                    .map(|(_, response)| response)
                    .map_err(|failure| failure.error)
            }
            Err(failure) => Err(failure.error),
        }
    }
}

impl StationRequestExecutor for RuntimeRequestExecutor {
    fn execute(&self, request: StationRequest) -> Result<StationResponse, StationTransportError> {
        self.execute_request(request, None)
    }

    fn execute_bounded(
        &self,
        request: StationRequest,
        deadline: std::time::Instant,
    ) -> Result<StationResponse, StationTransportError> {
        self.execute_request(request, Some(deadline))
    }

    fn execute_for_station(
        &self,
        station_peer_id: &str,
        mut request: StationRequest,
    ) -> Result<StationResponse, StationTransportError> {
        if self.stopped.load(Ordering::Acquire) {
            return Err(StationTransportError::new(
                StationTransportErrorKind::Shutdown,
                "Station runtime is shutting down",
                false,
            ));
        }
        let entry = self.registry.entry(station_peer_id).ok_or_else(|| {
            StationTransportError::new(
                StationTransportErrorKind::Unavailable,
                "Target Station route is unavailable",
                false,
            )
        })?;
        let pin = self
            .registry
            .federation_signing_key_pin(station_peer_id)
            .map_err(|error| {
                StationTransportError::new(
                    StationTransportErrorKind::InvalidRoute,
                    format!("Target Station pin is invalid: {error}"),
                    false,
                )
            })?
            .ok_or_else(|| {
                StationTransportError::new(
                    StationTransportErrorKind::InvalidRoute,
                    "Target Station route is not Federation-pinned",
                    false,
                )
            })?;
        if pin.station_peer_id != station_peer_id {
            return Err(StationTransportError::new(
                StationTransportErrorKind::InvalidRoute,
                "Target Station pin binding mismatch",
                false,
            ));
        }
        let route = entry.active_route().ok_or_else(|| {
            StationTransportError::new(
                StationTransportErrorKind::Unavailable,
                "Target Station has no active route",
                false,
            )
        })?;
        if !route_attestation_is_current(route, current_unix_ms())
            || matches!(
                route.health,
                StationRouteHealth::Unavailable | StationRouteHealth::Revoked
            )
        {
            return Err(StationTransportError::new(
                StationTransportErrorKind::StaleRoute,
                "Target Station route is expired or unavailable",
                false,
            ));
        }
        if !route_policy_permits(request.route_policy, route.route_type)
            || !request.route_security.permits(&route.endpoint_origin)
        {
            return Err(StationTransportError::new(
                StationTransportErrorKind::InvalidRoute,
                "Target Station route violates request transport policy",
                false,
            ));
        }
        let expected_scope = StationRequestScope {
            station_peer_id: entry.station_peer_id.clone(),
            lifecycle_generation: entry.lifecycle_generation,
        };
        if request
            .expected_scope
            .as_ref()
            .is_some_and(|expected| expected != &expected_scope)
        {
            return Err(StationTransportError::new(
                StationTransportErrorKind::StaleRoute,
                "Target Station request belongs to a stale lifecycle",
                false,
            ));
        }
        request.expected_scope = Some(expected_scope);
        prepare_entry_transport(&self.transport, &entry).map_err(|error| {
            StationTransportError::new(StationTransportErrorKind::Unavailable, error, false)
        })?;
        let lease = route_lease::RouteLease::from_entry(
            &entry,
            request.traffic_class,
            request.cancellation.clone(),
        )
        .ok_or_else(|| {
            StationTransportError::new(
                StationTransportErrorKind::Unavailable,
                "Target Station route lease is unavailable",
                false,
            )
        })?;
        let request_path = request
            .path_and_query
            .split_once('?')
            .map_or(request.path_and_query.as_str(), |(path, _)| path)
            .to_string();
        match self.transport.execute(&lease, request) {
            Ok(response) => {
                self.record_attempt(
                    &lease,
                    StationRoutePolicy::Auto,
                    &request_path,
                    "connected",
                    None,
                );
                Ok(response)
            }
            Err(error) => {
                self.record_attempt(
                    &lease,
                    StationRoutePolicy::Auto,
                    &request_path,
                    "failed",
                    Some(error.kind),
                );
                Err(error)
            }
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
        dial_multiaddr: Option<&str>,
    ) -> Result<(), String> {
        let lease = match self.binding.route_lease(TrafficClass::Interactive) {
            Ok(lease) => lease,
            Err(_) if dial_multiaddr.is_none() => {
                return self
                    .transport
                    .clear_acceptance_direct_route_overrides()
                    .map_err(|clear_error| clear_error.to_string());
            }
            Err(error) => return Err(error.message),
        };
        if lease.route.route_type != StationRouteType::Direct {
            if dial_multiaddr.is_none() {
                return self
                    .transport
                    .clear_acceptance_direct_route_overrides()
                    .map_err(|error| error.to_string());
            }
            return Err(
                "Acceptance Direct route override requires an active Direct route".to_string(),
            );
        }
        let previous_override = self
            .transport
            .replace_acceptance_direct_route_override(
                &lease.station_peer_id,
                &lease.route_id,
                &lease.route.node_peer_id,
                dial_multiaddr,
            )
            .map_err(|error| error.to_string())?;
        self.transport
            .close_route_with_direct_override(&lease, previous_override);
        if dial_multiaddr.is_none() {
            self.transport
                .clear_acceptance_direct_route_overrides()
                .map_err(|error| error.to_string())?;
        }
        Ok(())
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

    pub fn sign_transport_identity_proof(
        &self,
        scope: TransportIdentityScope,
        message: &[u8],
    ) -> Result<TransportIdentityProof, String> {
        self.transport
            .sign_identity_proof(scope, message)
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
        commit_verified_route_refresh(&self.registry, &self.binding, &self.transport, routes)
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

fn commit_verified_route_refresh(
    registry: &StationRegistry,
    binding: &StationBindingService,
    transport: &StationTransportHandle,
    routes: &[crate::infrastructure::station_discovery::VerifiedStationRoute],
) -> Result<Vec<StationEntry>, StationBindingError> {
    let mut result = binding.store_verified_routes(registry, routes)?;
    let current = binding.state();
    if let (Some(station_peer_id), Some(route_id)) = (
        current.station_peer_id.as_deref(),
        current.active_route_id.as_deref(),
    ) {
        if let Some(entry) = result
            .iter()
            .find(|entry| entry.station_peer_id == station_peer_id)
        {
            let refreshed = entry
                .selection_view(route_id)
                .filter(|candidate| !entry.has_same_active_contract(candidate));
            if refreshed.is_some() {
                let hooks = RuntimeBindingHooks {
                    transport,
                    before_commit: None,
                };
                binding.switch_with_hooks(registry, station_peer_id, Some(route_id), &hooks)?;
                if let Some(committed) = registry.entry(station_peer_id) {
                    if let Some(slot) = result
                        .iter_mut()
                        .find(|entry| entry.station_peer_id == station_peer_id)
                    {
                        *slot = committed;
                    }
                }
            }
        }
    }
    retire_inactive_transport(binding, transport);
    Ok(result)
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

fn current_unix_ms() -> i64 {
    i64::try_from(time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000)
        .unwrap_or(i64::MAX)
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
    let scope = match route.route_type {
        StationRouteType::Direct => {
            TransportIdentityScope::DirectStation(entry.station_peer_id.clone())
        }
        StationRouteType::Relay => TransportIdentityScope::Relay(
            route
                .relay_peer_id
                .clone()
                .ok_or_else(|| "Circuit route has no Relay identity".to_string())?,
        ),
    };
    transport
        .prepare_route(scope)
        .map_err(|error| error.to_string())
}

fn entry_transport_scope(entry: &StationEntry) -> Option<TransportIdentityScope> {
    let route = entry.active_route()?;
    match route.route_type {
        StationRouteType::Direct => Some(TransportIdentityScope::DirectStation(
            entry.station_peer_id.clone(),
        )),
        StationRouteType::Relay => route
            .relay_peer_id
            .clone()
            .map(TransportIdentityScope::Relay),
    }
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
    use std::net::TcpListener;
    use std::path::PathBuf;
    use tokio_util::sync::CancellationToken;

    const TEST_NODE_PEER_ID: &str = "12D3KooWGo2HxmjfSQZKTheDEbgDBpSuhUxTNsr8DnTkXCDzdaZL";

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
        let port = reqwest::Url::parse(&origin)
            .unwrap()
            .port_or_known_default()
            .unwrap();
        VerifiedStationRoute {
            station_peer_id: "station-one".to_string(),
            node_peer_id: TEST_NODE_PEER_ID.to_string(),
            station_root_public_key: vec![1, 2, 3],
            node_authorization_digest: [4; 32],
            authorization_epoch: 1,
            route_id: route_id.to_string(),
            route_generation: 1,
            endpoint_origin: origin.clone(),
            relay_peer_id: None,
            inner_tls_spki_sha256: Some([7; 32]),
            addresses: vec![format!("/ip4/127.0.0.1/tcp/{port}/p2p/{TEST_NODE_PEER_ID}")],
            attestation_bytes: Some(vec![8, 9]),
            connection_grant: None,
            expires_at_unix_ms: Some(i64::MAX),
        }
    }

    fn renewal_executor(runtime: &StationRuntime) -> RuntimeRequestExecutor {
        RuntimeRequestExecutor {
            registry: runtime.registry.clone(),
            binding: runtime.binding.clone(),
            transport: runtime.transport.clone(),
            stopped: runtime.stopped.clone(),
            transition: runtime.transition.clone(),
            diagnostics: runtime.diagnostics.clone(),
        }
    }

    fn renewal_request(runtime: &StationRuntime) -> StationRequest {
        StationRequest {
            method: Method::POST,
            path_and_query: "/conversation/commands".to_string(),
            headers: Default::default(),
            body: StationRequestBody::Empty,
            timeout: Duration::from_secs(10),
            admission_timeout: Duration::from_secs(1),
            traffic_class: TrafficClass::Interactive,
            route_security: StationRouteSecurity::VerifiedRoute,
            route_policy: StationRoutePolicy::Auto,
            replay_policy: ReplayPolicy::Never,
            cancellation: CancellationToken::new(),
            expected_scope: renewal_executor(runtime).active_scope(),
        }
    }

    fn renewal_endpoint(
        route: VerifiedStationRoute,
    ) -> crate::infrastructure::station_discovery::VerifiedEndpoint {
        crate::infrastructure::station_discovery::VerifiedEndpoint {
            role: crate::infrastructure::station_discovery::VerifiedEndpointRole::DirectStation,
            endpoint_peer_id: route.node_peer_id.clone(),
            canonical_origin: route.endpoint_origin.clone(),
            endpoint_public_key: vec![],
            routes: vec![route],
        }
    }

    #[test]
    fn bounded_read_pre_submission_discovery_cancels_headers_and_body() {
        use std::io::{Read, Write};
        use std::sync::mpsc;

        for (body, expire) in [(false, false), (true, false), (true, true)] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let origin = format!("http://{}", listener.local_addr().unwrap());
            let runtime = StationRuntime::start(&temp_dir(if body {
                "bounded-discovery-body"
            } else {
                "bounded-discovery-headers"
            }))
            .unwrap();
            let mut route = direct_route("route-a", origin);
            route.expires_at_unix_ms = Some(current_unix_ms() + 10_000);
            runtime.store_verified_routes(&[route]).unwrap();
            runtime
                .switch_station_with_teardown("station-one", Some("route-a"), &|_| Ok(()))
                .unwrap();
            runtime.binding().mark_bound().unwrap();
            let before = runtime.binding().state();
            let first = search_core::CancelToken::new();
            let second = search_core::CancelToken::new();
            let shared = search_core::CancelToken::all(vec![first.clone(), second.clone()]);
            let (entered, entry) = mpsc::channel();
            let (release, released) = mpsc::channel();
            let (checked, checks) = mpsc::channel();
            let (done, finished) = mpsc::channel();
            let started = std::time::Instant::now();
            let deadline = started + Duration::from_secs(5);
            std::thread::scope(|threads| {
                threads.spawn(move || {
                    let (mut socket, _) = listener.accept().unwrap();
                    socket
                        .set_read_timeout(Some(Duration::from_secs(2)))
                        .unwrap();
                    let mut bytes = [0; 4096];
                    let count = socket.read(&mut bytes).unwrap();
                    assert!(String::from_utf8_lossy(&bytes[..count])
                        .starts_with("POST /.well-known/peers-touch/access"));
                    if body {
                        socket
                            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n")
                            .unwrap();
                    }
                    entered.send(()).unwrap();
                    let _ = released.recv_timeout(Duration::from_secs(8));
                });
                threads.spawn(|| {
                    let result = runtime
                        .client()
                        .request_bounded_proto_read::<_, search_core::model::wire::SearchResponse>(
                            &runtime.client().active_scope().unwrap(),
                            "/api/v1/social/search/query",
                            "test-token",
                            &search_core::model::wire::QueryIntent::default(),
                            deadline,
                            &|| {
                                if first.is_cancelled() && !second.is_cancelled() {
                                    let _ = checked.send(());
                                }
                                shared.check().map_err(|error| error.to_string())
                            },
                        );
                    done.send(result).unwrap();
                });
                entry.recv_timeout(Duration::from_secs(2)).unwrap();
                first.cancel();
                checks.recv_timeout(Duration::from_secs(1)).unwrap();
                assert!(
                    finished.try_recv().is_err(),
                    "remaining subscriber lost its read"
                );
                let cancelled_at = std::time::Instant::now();
                if !expire {
                    second.cancel();
                }
                let result = finished.recv_timeout(if expire {
                    Duration::from_millis(5_500)
                } else {
                    Duration::from_millis(500)
                });
                release.send(()).unwrap();
                assert!(
                    result.is_ok(),
                    "production discovery retained the cancelled worker"
                );
                assert!(matches!(
                    result.unwrap().unwrap_err().kind,
                    client::StationClientErrorKind::Cancelled
                ));
                if expire {
                    assert!(started.elapsed() >= Duration::from_secs(5));
                    assert!(started.elapsed() < Duration::from_millis(5_500));
                } else {
                    assert!(cancelled_at.elapsed() < Duration::from_secs(1));
                }
                assert!(
                    runtime.transition.try_lock().is_ok(),
                    "renewal retained transition lock"
                );
            });
            assert_eq!(before, runtime.binding().state());
            assert!(runtime.diagnostics().attempts.is_empty());
            runtime.shutdown().unwrap();
        }
    }

    #[test]
    fn ordinary_timeout_can_failover_while_bounded_deadline_cannot() {
        use std::sync::mpsc;
        for bounded in [false, true] {
            let stalled = TcpListener::bind("127.0.0.1:0").unwrap();
            let origin = format!("http://{}", stalled.local_addr().unwrap());
            let replacement = TcpListener::bind("127.0.0.1:0").unwrap();
            let replacement_origin = format!("http://{}", replacement.local_addr().unwrap());
            drop(replacement);
            let runtime = StationRuntime::start(&temp_dir("timeout-replay-policy")).unwrap();
            runtime
                .store_verified_routes(&[
                    direct_route("route-a", origin),
                    direct_route("route-b", replacement_origin),
                ])
                .unwrap();
            runtime
                .switch_station_with_teardown("station-one", Some("route-a"), &|_| Ok(()))
                .unwrap();
            runtime.binding().mark_bound().unwrap();
            let executor = renewal_executor(&runtime);
            let mut request = renewal_request(&runtime);
            request.timeout = Duration::from_millis(150);
            request.admission_timeout = request.timeout;
            request.replay_policy = ReplayPolicy::SafeRead;
            let cancellation = request.cancellation.clone();
            let (release, released) = mpsc::channel();
            let started = std::time::Instant::now();
            std::thread::scope(|threads| {
                threads.spawn(move || {
                    let (socket, _) = stalled.accept().unwrap();
                    let _ = released.recv_timeout(Duration::from_secs(2));
                    drop(socket);
                });
                let result = if bounded {
                    executor.execute_bounded(request, started + Duration::from_millis(150))
                } else {
                    executor.execute(request)
                };
                release.send(()).unwrap();
                let error = result
                    .err()
                    .expect("replacement is deliberately unavailable");
                if bounded {
                    assert_eq!(error.kind, StationTransportErrorKind::Timeout);
                } else {
                    assert_eq!(error.kind, StationTransportErrorKind::Unavailable);
                }
                assert!(
                    !cancellation.is_cancelled(),
                    "attempt cleanup cancelled caller scope"
                );
                assert!(started.elapsed() < Duration::from_secs(1));
            });
            let diagnostics = runtime.diagnostics();
            assert_eq!(diagnostics.attempts.len(), if bounded { 1 } else { 2 });
            assert_eq!(
                diagnostics.attempts[0].error_code.as_deref(),
                Some("station_transport_failed")
            );
            let failovers = diagnostics
                .transitions
                .iter()
                .filter(|transition| transition.reason == "automatic_failover")
                .count();
            assert_eq!(failovers, usize::from(!bounded));
            runtime.shutdown().unwrap();
        }
    }

    #[test]
    fn bounded_read_transition_admission_preserves_deadline_and_cancellation() {
        for cancel in [false, true] {
            let runtime = StationRuntime::start(&temp_dir("bounded-renewal-lock")).unwrap();
            let mut route = direct_route("route-a", "http://127.0.0.1:4101".into());
            route.expires_at_unix_ms = Some(current_unix_ms() + 10_000);
            runtime.store_verified_routes(&[route]).unwrap();
            runtime
                .switch_station_with_teardown("station-one", Some("route-a"), &|_| Ok(()))
                .unwrap();
            runtime.binding().mark_bound().unwrap();
            let before = runtime.binding().state();
            let held = runtime.transition.lock().unwrap();
            let executor = renewal_executor(&runtime);
            let request = renewal_request(&runtime);
            let token = request.cancellation.clone();
            let started = std::time::Instant::now();
            std::thread::scope(|threads| {
                let read = threads.spawn(|| {
                    executor.execute_bounded(request, started + Duration::from_millis(150))
                });
                if cancel {
                    token.cancel();
                }
                let error = read.join().unwrap().err().unwrap();
                assert_eq!(
                    error.kind,
                    if cancel {
                        StationTransportErrorKind::Cancelled
                    } else {
                        StationTransportErrorKind::Timeout
                    }
                );
                assert!(!error.submitted);
                assert!(started.elapsed() < Duration::from_millis(500));
            });
            drop(held);
            assert_eq!(before, runtime.binding().state());
            assert!(runtime.diagnostics().attempts.is_empty());
        }
    }

    #[test]
    fn bounded_route_renewal_preserves_scope_before_never_replayed_command() {
        for expired in [false, true] {
            let runtime = StationRuntime::start(&temp_dir(if expired {
                "expired-route-renewal"
            } else {
                "near-expiry-route-renewal"
            }))
            .unwrap();
            let mut route = direct_route("route-a", "http://127.0.0.1:4101".to_string());
            route.expires_at_unix_ms = Some(current_unix_ms() + 1_000);
            runtime
                .store_verified_routes(std::slice::from_ref(&route))
                .unwrap();
            runtime
                .switch_station_with_teardown("station-one", Some("route-a"), &|_| Ok(()))
                .unwrap();
            runtime.binding().mark_bound().unwrap();
            let previous = runtime
                .binding()
                .route_lease(TrafficClass::Interactive)
                .unwrap();
            let before = runtime.binding().state();
            if expired {
                std::thread::sleep(Duration::from_millis(1_100));
                assert!(runtime
                    .binding()
                    .route_lease(TrafficClass::Interactive)
                    .is_err());
            }
            let request = renewal_request(&runtime);
            route.expires_at_unix_ms = Some(i64::MAX);
            renewal_executor(&runtime)
                .renew_route_with(&request, |_, _| Ok(renewal_endpoint(route)))
                .unwrap();
            let after = runtime.binding().state();
            assert_eq!(before.phase, after.phase);
            assert_eq!(before.station_peer_id, after.station_peer_id);
            assert_eq!(before.lifecycle_generation, after.lifecycle_generation);
            assert_eq!(after.route_revision, before.route_revision + 1);
            assert!(previous.is_cancelled());
            assert!(!request.cancellation.is_cancelled());
            assert!(runtime
                .binding()
                .route_lease(TrafficClass::Interactive)
                .is_ok());
            assert!(runtime.diagnostics().attempts.is_empty());
            renewal_executor(&runtime)
                .renew_route_with(&request, |_, _| panic!("current proof must be reused"))
                .unwrap();
        }
    }

    #[test]
    fn route_renewal_rejects_identity_changes_and_cancelled_results_without_commit() {
        for case in [
            "station", "root", "node", "route", "epoch", "cancel", "stale", "policy",
        ] {
            let runtime =
                StationRuntime::start(&temp_dir(&format!("renewal-reject-{case}"))).unwrap();
            let mut route = direct_route("route-a", "http://127.0.0.1:4101".to_string());
            route.expires_at_unix_ms = Some(current_unix_ms() + 10_000);
            runtime
                .store_verified_routes(std::slice::from_ref(&route))
                .unwrap();
            runtime
                .switch_station_with_teardown("station-one", Some("route-a"), &|_| Ok(()))
                .unwrap();
            runtime.binding().mark_bound().unwrap();
            let mut request = renewal_request(&runtime);
            let before = runtime.binding().state();
            route.expires_at_unix_ms = Some(i64::MAX);
            match case {
                "station" => route.station_peer_id = "station-other".to_string(),
                "root" => route.station_root_public_key = vec![9, 9],
                "node" => route.node_peer_id = "node-other".to_string(),
                "route" => route.route_id = "route-other".to_string(),
                "epoch" => route.authorization_epoch = 0,
                "policy" => request.route_policy = StationRoutePolicy::RelayOnly,
                "stale" => {
                    request
                        .expected_scope
                        .as_mut()
                        .unwrap()
                        .lifecycle_generation += 1
                }
                _ => {}
            }
            let result = renewal_executor(&runtime).renew_route_with(&request, |_, _| {
                if matches!(case, "stale" | "policy") {
                    panic!("stale or policy-conflicting routes must not trigger discovery");
                }
                if case == "cancel" {
                    request.cancellation.cancel();
                }
                Ok(renewal_endpoint(route))
            });
            if case == "policy" {
                assert!(result.is_ok());
            } else {
                assert!(result.is_err(), "{case}");
            }
            assert_eq!(before, runtime.binding().state());
            assert!(runtime.diagnostics().attempts.is_empty());
        }
    }

    #[test]
    fn same_route_refresh_is_committed_before_the_old_lease_expires() {
        let runtime = StationRuntime::start(&temp_dir("same-route-refresh")).unwrap();
        let current = direct_route("route-a", "http://127.0.0.1:4101".to_string());
        runtime
            .store_verified_routes(std::slice::from_ref(&current))
            .unwrap();
        runtime
            .switch_station_with_teardown("station-one", Some("route-a"), &|_| Ok(()))
            .unwrap();
        runtime.binding().mark_bound().unwrap();
        let before = runtime.binding().state();
        let old_lease = runtime
            .binding()
            .route_lease(TrafficClass::Interactive)
            .unwrap();

        let mut refreshed = current;
        refreshed.authorization_epoch = 2;
        refreshed.route_generation = 2;
        refreshed.node_authorization_digest = [9; 32];
        refreshed.attestation_bytes = Some(vec![10, 11]);
        let entries = runtime
            .store_verified_routes(std::slice::from_ref(&refreshed))
            .unwrap();

        let after = runtime.binding().state();
        assert_eq!(after.station_peer_id, before.station_peer_id);
        assert_eq!(after.active_route_id, before.active_route_id);
        assert_eq!(after.lifecycle_generation, before.lifecycle_generation);
        assert_eq!(after.route_revision, before.route_revision + 1);
        assert!(old_lease.is_cancelled());
        assert_eq!(
            entries[0].active_route().unwrap().authorization_epoch,
            refreshed.authorization_epoch
        );
        assert_eq!(
            runtime
                .binding()
                .committed_entry()
                .unwrap()
                .active_route()
                .unwrap()
                .node_authorization_digest,
            refreshed.node_authorization_digest
        );
    }

    #[test]
    fn target_station_requests_reuse_bounded_pool_without_switching_binding() {
        let runtime = StationRuntime::start(&temp_dir("target-station-request")).unwrap();
        let active = direct_route("route-a", "http://127.0.0.1:4101".to_string());
        let mut authority = direct_route("route-b", "http://127.0.0.1:4102".to_string());
        authority.station_peer_id = "station-two".to_string();
        authority.station_root_public_key = vec![5, 6, 7];
        let mut second_authority = direct_route("route-c", "http://127.0.0.1:4103".to_string());
        second_authority.station_peer_id = "station-three".to_string();
        second_authority.station_root_public_key = vec![8, 9, 10];
        runtime
            .store_verified_routes(&[active, authority, second_authority])
            .unwrap();
        runtime
            .registry
            .pin_or_verify_federation_signing_key("station-two", "station-two-key", [0x22; 32])
            .unwrap();
        runtime
            .registry
            .pin_or_verify_federation_signing_key("station-three", "station-three-key", [0x33; 32])
            .unwrap();
        runtime
            .switch_station_with_teardown("station-one", Some("route-a"), &|_| Ok(()))
            .unwrap();
        runtime.binding().mark_bound().unwrap();
        let before = runtime.binding().state();

        let result = runtime
            .client()
            .request_proto_for_actor_at_station::<
                crate::model::chat::GetConversationPublicHeadRequest,
                crate::model::chat::GetConversationPublicHeadResponse,
            >(
                "station-two",
                Method::GET,
                "/conversation/public-head",
                "token",
                Some(&[("conversation_id", "conversation-a".to_string())]),
                None,
            );

        assert!(result.is_err());
        let second_result = runtime
            .client()
            .request_proto_for_actor_at_station::<
                crate::model::chat::GetConversationPublicHeadRequest,
                crate::model::chat::GetConversationPublicHeadResponse,
            >(
                "station-three",
                Method::GET,
                "/conversation/public-head",
                "token",
                Some(&[("conversation_id", "conversation-b".to_string())]),
                None,
            );

        assert!(second_result.is_err());
        assert_eq!(runtime.binding().state(), before);
        let attempts = runtime.diagnostics().attempts;
        assert_eq!(
            attempts
                .iter()
                .rev()
                .take(2)
                .map(|attempt| attempt.station_peer_id.as_str())
                .collect::<Vec<_>>(),
            ["station-three", "station-two"],
        );
        assert_eq!(attempts.last().unwrap().route_id, "route-c");
    }

    #[test]
    fn automatic_failover_adopts_verified_replacement_before_second_transport_failure() {
        let unavailable_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let unavailable_origin = format!("http://{}", unavailable_listener.local_addr().unwrap());
        drop(unavailable_listener);
        let replacement_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let replacement_origin = format!("http://{}", replacement_listener.local_addr().unwrap());
        drop(replacement_listener);
        let runtime = StationRuntime::start(&temp_dir("sse-failover")).unwrap();
        runtime
            .store_verified_routes(&[
                direct_route("route-a", unavailable_origin),
                direct_route("route-b", replacement_origin),
            ])
            .unwrap();
        runtime
            .switch_station_with_teardown("station-one", Some("route-a"), &|_| Ok(()))
            .unwrap();
        runtime.binding().mark_bound().unwrap();
        let before = runtime.binding().state();

        let cancellation = CancellationToken::new();
        let error = match runtime.client().execute_raw(StationRequest {
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
        }) {
            Err(error) => error,
            Ok(_) => panic!("replacement transport failure must remain visible"),
        };

        assert!(
            matches!(error.kind, client::StationClientErrorKind::Unavailable),
            "{error:?}"
        );
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
        assert_eq!(diagnostics.attempts[1].outcome, "failed");
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
