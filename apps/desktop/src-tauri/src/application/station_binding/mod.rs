use serde::Serialize;
use std::sync::{Mutex, TryLockError};
use tokio_util::sync::CancellationToken;

use crate::application::station_runtime::client::TrafficClass;
use crate::application::station_runtime::route_lease::RouteLease;
use crate::infrastructure::station_registry::{
    route_attestation_is_current, StationEntry, StationRegistry, StationRouteHealth,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StationBindingPhase {
    Unbound,
    Connecting,
    AccessGate,
    Bound,
    Switching,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct StationBindingError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl StationBindingError {
    pub(crate) fn new(code: &str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            retryable,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct StationBindingState {
    pub phase: StationBindingPhase,
    pub station_peer_id: Option<String>,
    pub active_route_id: Option<String>,
    pub target_station_peer_id: Option<String>,
    pub target_route_id: Option<String>,
    pub route_revision: u64,
    pub lifecycle_generation: u64,
    pub error: Option<StationBindingError>,
}

impl StationBindingState {
    fn from_persisted_entry(entry: Option<StationEntry>) -> Self {
        match entry {
            Some(entry) => Self {
                phase: StationBindingPhase::Connecting,
                station_peer_id: Some(entry.station_peer_id.clone()),
                active_route_id: None,
                target_station_peer_id: Some(entry.station_peer_id),
                target_route_id: Some(entry.active_route_id),
                route_revision: entry.route_revision,
                lifecycle_generation: entry.lifecycle_generation,
                error: None,
            },
            None => Self {
                phase: StationBindingPhase::Unbound,
                station_peer_id: None,
                active_route_id: None,
                target_station_peer_id: None,
                target_route_id: None,
                route_revision: 0,
                lifecycle_generation: 0,
                error: None,
            },
        }
    }

    pub fn transport_scope(&self) -> Option<(&str, &str, u64)> {
        if !matches!(
            self.phase,
            StationBindingPhase::AccessGate | StationBindingPhase::Bound
        ) {
            return None;
        }
        Some((
            self.station_peer_id.as_deref()?,
            self.active_route_id.as_deref()?,
            self.route_revision,
        ))
    }
}

pub trait StationBindingHooks: Send + Sync {
    fn verify_route(&self, entry: &StationEntry) -> Result<(), StationBindingError>;

    fn teardown_transport(
        &self,
        previous: Option<&StationEntry>,
        target: &StationEntry,
    ) -> Result<(), StationBindingError>;

    fn teardown_scope(
        &self,
        previous: Option<&StationEntry>,
        target: &StationEntry,
    ) -> Result<(), StationBindingError>;
}

pub struct StationBindingService {
    inner: Mutex<BindingInner>,
    transition: Mutex<()>,
}

struct BindingInner {
    state: StationBindingState,
    committed: Option<StationEntry>,
    route_cancellation: CancellationToken,
}

impl StationBindingService {
    pub fn new(active_entry: Option<StationEntry>) -> Self {
        Self {
            inner: Mutex::new(BindingInner {
                state: StationBindingState::from_persisted_entry(active_entry),
                committed: None,
                route_cancellation: CancellationToken::new(),
            }),
            transition: Mutex::new(()),
        }
    }

    pub fn state(&self) -> StationBindingState {
        self.inner
            .lock()
            .expect("StationBindingService state lock poisoned")
            .state
            .clone()
    }

    pub fn route_lease(
        &self,
        traffic_class: TrafficClass,
    ) -> Result<RouteLease, StationBindingError> {
        let inner = self.inner.lock().map_err(|_| {
            StationBindingError::new(
                "station_binding_unavailable",
                "The Station binding snapshot is unavailable",
                true,
            )
        })?;
        let state = &inner.state;
        state.transport_scope().ok_or_else(|| {
            StationBindingError::new(
                "station_binding_not_ready",
                "The Station transport scope is not ready",
                true,
            )
        })?;
        let entry = inner.committed.as_ref().ok_or_else(|| {
            StationBindingError::new(
                "station_binding_not_ready",
                "The Station binding has no committed route",
                false,
            )
        })?;
        let route = entry.active_route().ok_or_else(|| {
            StationBindingError::new(
                "station_route_unavailable",
                "The active Station route is unavailable",
                true,
            )
        })?;
        if matches!(
            route.health,
            StationRouteHealth::Unavailable | StationRouteHealth::Revoked
        ) || !route_attestation_is_current(route, unix_ms())
        {
            return Err(StationBindingError::new(
                "station_route_unavailable",
                "The active Station route is unavailable or expired",
                true,
            ));
        }
        RouteLease::from_entry(entry, traffic_class, inner.route_cancellation.clone()).ok_or_else(
            || {
                StationBindingError::new(
                    "station_route_unavailable",
                    "The active Station route is unavailable",
                    true,
                )
            },
        )
    }

    pub fn committed_entry(&self) -> Option<StationEntry> {
        self.inner.lock().ok()?.committed.clone()
    }

    pub fn revoke(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.route_cancellation.cancel();
            inner.committed = None;
            inner.state = StationBindingState::from_persisted_entry(None);
        }
    }

    pub fn failover(
        &self,
        registry: &StationRegistry,
        lease: &RouteLease,
        hooks: &dyn StationBindingHooks,
    ) -> Result<StationBindingState, StationBindingError> {
        let _transition =
            self.transition_guard("Another Station route transition is already in progress")?;
        let state = self.state();
        if state.station_peer_id.as_deref() != Some(lease.station_peer_id.as_str())
            || state.active_route_id.as_deref() != Some(lease.route_id.as_str())
            || state.route_revision != lease.route_revision
            || state.lifecycle_generation != lease.lifecycle_generation
        {
            return Err(StationBindingError::new(
                "station_route_stale",
                "The failed Station route lease is no longer current",
                true,
            ));
        }
        let target = registry
            .failover_candidate(&lease.station_peer_id, &lease.route_id)
            .map_err(failover_candidate_error)?;
        hooks.verify_route(&target)?;
        let previous = self.committed_entry();
        hooks.teardown_transport(previous.as_ref(), &target)?;
        let target = registry
            .commit_selection(&target, Some(&lease.route_id))
            .map_err(registry_switch_error)?;
        self.commit_target(&target, state.phase);
        Ok(self.state())
    }

    pub fn mark_bound(&self) -> Result<StationBindingState, StationBindingError> {
        let mut inner = self
            .inner
            .lock()
            .expect("StationBindingService state lock poisoned");
        let state = &mut inner.state;
        if state.phase == StationBindingPhase::Bound && state.transport_scope().is_some() {
            return Ok(state.clone());
        }
        if state.phase != StationBindingPhase::AccessGate || state.transport_scope().is_none() {
            return Err(StationBindingError::new(
                "station_binding_not_ready",
                "The Station access gate has not been completed",
                false,
            ));
        }
        state.phase = StationBindingPhase::Bound;
        state.error = None;
        Ok(state.clone())
    }

    #[cfg(test)]
    pub(crate) fn reconcile_route_revision(&self, target: &StationEntry) -> StationBindingState {
        let mut inner = self
            .inner
            .lock()
            .expect("StationBindingService state lock poisoned");
        if inner.state.station_peer_id.as_deref() != Some(target.station_peer_id.as_str())
            || inner.state.lifecycle_generation != target.lifecycle_generation
            || !matches!(
                inner.state.phase,
                StationBindingPhase::AccessGate | StationBindingPhase::Bound
            )
        {
            return inner.state.clone();
        }
        let previous_route_failed =
            inner
                .state
                .active_route_id
                .as_deref()
                .is_some_and(|route_id| {
                    target.routes.iter().any(|route| {
                        route.route_id == route_id
                            && route.health == StationRouteHealth::Unavailable
                    })
                });
        let replacement_route_ready = target.active_route().is_some_and(|route| {
            matches!(
                route.health,
                StationRouteHealth::Available | StationRouteHealth::Degraded
            )
        });
        let same_route_refresh =
            inner.state.active_route_id.as_deref() == Some(target.active_route_id.as_str());
        if (!previous_route_failed && !same_route_refresh) || !replacement_route_ready {
            return inner.state.clone();
        }
        if inner.state.route_revision != target.route_revision
            || inner.state.active_route_id.as_deref() != Some(target.active_route_id.as_str())
        {
            inner.route_cancellation.cancel();
            inner.route_cancellation = CancellationToken::new();
        }
        let state = &mut inner.state;
        state.active_route_id = Some(target.active_route_id.clone());
        state.target_station_peer_id = None;
        state.target_route_id = None;
        state.route_revision = target.route_revision;
        state.lifecycle_generation = target.lifecycle_generation;
        state.error = None;
        inner.committed = Some(target.clone());
        inner.state.clone()
    }

    pub(crate) fn store_verified_routes(
        &self,
        registry: &StationRegistry,
        routes: &[crate::infrastructure::station_discovery::VerifiedStationRoute],
    ) -> Result<Vec<StationEntry>, StationBindingError> {
        let _transition =
            self.transition_guard("Another Station route transition is already in progress")?;
        let entries = registry
            .replace_verified_routes(routes)
            .map_err(registry_switch_error)?;
        // Discovery refreshes candidates only. A committed lease remains on its
        // verified snapshot until selection/failover explicitly commits another.
        Ok(entries)
    }

    pub fn remove_station(
        &self,
        registry: &StationRegistry,
        station_peer_id: &str,
    ) -> Result<(StationBindingState, bool), StationBindingError> {
        let _transition = self.transition_guard("Another Station switch is already in progress")?;
        let current = self.state();
        let was_selected = current.station_peer_id.as_deref() == Some(station_peer_id);
        registry.remove(station_peer_id).map_err(|error| {
            StationBindingError::new(
                "station_switch_failed",
                format!("Could not remove the Station: {}", error.kind()),
                true,
            )
        })?;
        if was_selected {
            self.replace_state(StationBindingState::from_persisted_entry(None));
        }
        Ok((self.state(), was_selected))
    }

    pub(crate) fn resume_persisted_with_hooks(
        &self,
        registry: &StationRegistry,
        hooks: &dyn StationBindingHooks,
    ) -> Result<StationBindingState, StationBindingError> {
        let _transition =
            self.transition_guard("Another Station binding transition is already in progress")?;
        let current = self.state();
        if matches!(
            current.phase,
            StationBindingPhase::AccessGate | StationBindingPhase::Bound
        ) && current.transport_scope().is_some()
        {
            return Ok(current);
        }
        if !matches!(
            current.phase,
            StationBindingPhase::Connecting | StationBindingPhase::Failed
        ) || current.active_route_id.is_some()
        {
            return Err(StationBindingError::new(
                "station_binding_not_ready",
                "The persisted Station binding cannot be resumed from its current phase",
                false,
            ));
        }
        let target_station_peer_id = current.target_station_peer_id.clone().ok_or_else(|| {
            StationBindingError::new(
                "station_unselected",
                "Select a Station before continuing",
                false,
            )
        })?;
        let target_route_id = current.target_route_id.clone().ok_or_else(|| {
            StationBindingError::new(
                "station_route_unavailable",
                "The persisted Station route is unavailable",
                false,
            )
        })?;
        let target = registry.entry(&target_station_peer_id).ok_or_else(|| {
            StationBindingError::new(
                "station_selection_changed",
                "The persisted Station selection no longer exists",
                false,
            )
        })?;
        if registry.active_station_peer_id().as_deref() != Some(target_station_peer_id.as_str())
            || target.active_route_id != target_route_id
        {
            return Err(StationBindingError::new(
                "station_selection_changed",
                "The persisted Station route no longer matches the active registry binding",
                false,
            ));
        }
        self.update_state(|state| {
            state.phase = StationBindingPhase::Connecting;
            state.error = None;
        });
        if let Err(error) = hooks.verify_route(&target) {
            self.update_state(|state| {
                state.phase = StationBindingPhase::Failed;
                state.error = Some(error.clone());
            });
            return Err(error);
        }
        self.commit_target(&target, StationBindingPhase::AccessGate);
        Ok(self.state())
    }

    pub(crate) fn switch_with_hooks(
        &self,
        registry: &StationRegistry,
        station_peer_id: &str,
        route_id: Option<&str>,
        hooks: &dyn StationBindingHooks,
    ) -> Result<StationBindingState, StationBindingError> {
        let station_peer_id = station_peer_id.trim();
        if station_peer_id.is_empty() {
            return Err(StationBindingError::new(
                "station_unselected",
                "Select a Station before continuing",
                false,
            ));
        }
        let _transition = self.transition_guard("Another Station switch is already in progress")?;
        let target = registry.entry(station_peer_id).ok_or_else(|| {
            StationBindingError::new(
                "station_not_registered",
                "Add the Station before selecting it",
                false,
            )
        })?;
        let route_id = route_id.unwrap_or(&target.active_route_id);
        let target = target
            .selection_view(route_id)
            .filter(|entry| {
                entry.active_route().is_some_and(|route| {
                    !matches!(
                        route.health,
                        StationRouteHealth::Unavailable | StationRouteHealth::Revoked
                    ) && route_attestation_is_current(route, unix_ms())
                })
            })
            .ok_or_else(|| {
                StationBindingError::new(
                    "station_route_unavailable",
                    "Station route is unavailable or expired",
                    false,
                )
            })?;
        let previous_state = self.state();
        let committed_entry = self.committed_entry();
        if previous_state.station_peer_id.as_deref() == Some(station_peer_id)
            && previous_state.active_route_id.as_deref() == Some(target.active_route_id.as_str())
            && previous_state.route_revision == target.route_revision
            && committed_entry
                .as_ref()
                .is_some_and(|committed| committed.has_same_active_contract(&target))
            && matches!(
                previous_state.phase,
                StationBindingPhase::AccessGate | StationBindingPhase::Bound
            )
        {
            return Ok(previous_state);
        }
        let previous_entry = committed_entry;
        let station_changed = previous_state
            .station_peer_id
            .as_deref()
            .is_some_and(|peer_id| peer_id != target.station_peer_id);

        self.update_state(|state| {
            if state.transport_scope().is_none() {
                state.phase = StationBindingPhase::Connecting;
            }
            state.target_station_peer_id = Some(target.station_peer_id.clone());
            state.target_route_id = Some(target.active_route_id.clone());
            state.error = None;
        });

        if let Err(error) = hooks.verify_route(&target) {
            self.restore_or_fail(previous_state, error.clone());
            return Err(error);
        }
        let teardown = if station_changed {
            hooks.teardown_scope(previous_entry.as_ref(), &target)
        } else {
            hooks.teardown_transport(previous_entry.as_ref(), &target)
        };
        if let Err(error) = teardown {
            self.replace_state(previous_state);
            return Err(error);
        }
        let target = match registry.commit_selection(&target, None) {
            Ok(target) => target,
            Err(error) => {
                self.restore_or_fail(previous_state, registry_switch_error(error).clone());
                return Err(StationBindingError::new(
                    "station_switch_failed",
                    "Could not persist the Station binding",
                    true,
                ));
            }
        };
        let phase = if !station_changed && previous_state.phase == StationBindingPhase::Bound {
            StationBindingPhase::Bound
        } else {
            StationBindingPhase::AccessGate
        };
        self.commit_target(&target, phase);
        Ok(self.state())
    }

    fn commit_target(&self, target: &StationEntry, phase: StationBindingPhase) {
        let mut inner = self
            .inner
            .lock()
            .expect("StationBindingService state lock poisoned");
        inner.route_cancellation.cancel();
        inner.route_cancellation = CancellationToken::new();
        let state = &mut inner.state;
        state.phase = phase;
        state.station_peer_id = Some(target.station_peer_id.clone());
        state.active_route_id = Some(target.active_route_id.clone());
        state.target_station_peer_id = None;
        state.target_route_id = None;
        state.route_revision = target.route_revision;
        state.lifecycle_generation = target.lifecycle_generation;
        state.error = None;
        inner.committed = Some(target.clone());
    }

    fn restore_or_fail(&self, previous: StationBindingState, error: StationBindingError) {
        if previous.transport_scope().is_some() {
            self.replace_state(previous);
        } else {
            self.update_state(|state| {
                state.phase = StationBindingPhase::Failed;
                state.station_peer_id = None;
                state.active_route_id = None;
                state.error = Some(error);
            });
        }
    }

    fn transition_guard(
        &self,
        message: &str,
    ) -> Result<std::sync::MutexGuard<'_, ()>, StationBindingError> {
        self.transition.try_lock().map_err(|error| match error {
            TryLockError::WouldBlock => {
                StationBindingError::new("station_switch_in_progress", message, true)
            }
            TryLockError::Poisoned(_) => StationBindingError::new(
                "station_switch_failed",
                "The Station switch coordinator is unavailable",
                true,
            ),
        })
    }

    fn replace_state(&self, next: StationBindingState) {
        let mut inner = self
            .inner
            .lock()
            .expect("StationBindingService state lock poisoned");
        let scope_changed = inner.state.transport_scope() != next.transport_scope()
            || inner.state.lifecycle_generation != next.lifecycle_generation;
        if scope_changed {
            inner.route_cancellation.cancel();
            inner.route_cancellation = CancellationToken::new();
            inner.committed = None;
        }
        inner.state = next;
    }

    fn update_state(&self, update: impl FnOnce(&mut StationBindingState)) {
        let mut inner = self
            .inner
            .lock()
            .expect("StationBindingService state lock poisoned");
        update(&mut inner.state);
    }
}

fn registry_switch_error(error: std::io::Error) -> StationBindingError {
    StationBindingError::new(
        "station_switch_failed",
        format!("Could not persist the Station binding: {}", error.kind()),
        true,
    )
}

fn failover_candidate_error(error: std::io::Error) -> StationBindingError {
    if matches!(
        error.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotConnected
    ) {
        StationBindingError::new(
            "station_no_route",
            "The Station has no eligible verified failover route",
            true,
        )
    } else {
        registry_switch_error(error)
    }
}

fn unix_ms() -> i64 {
    i64::try_from(time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000)
        .unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::station_discovery::VerifiedStationRoute;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Arc, Barrier};

    struct TestHooks {
        verify_error: Option<StationBindingError>,
        teardown_error: Option<StationBindingError>,
        transport_teardown_called: AtomicBool,
        scope_teardown_called: AtomicBool,
    }

    impl TestHooks {
        fn success() -> Self {
            Self {
                verify_error: None,
                teardown_error: None,
                transport_teardown_called: AtomicBool::new(false),
                scope_teardown_called: AtomicBool::new(false),
            }
        }
    }

    impl StationBindingHooks for TestHooks {
        fn verify_route(&self, _entry: &StationEntry) -> Result<(), StationBindingError> {
            match &self.verify_error {
                Some(error) => Err(error.clone()),
                None => Ok(()),
            }
        }

        fn teardown_transport(
            &self,
            _previous: Option<&StationEntry>,
            _target: &StationEntry,
        ) -> Result<(), StationBindingError> {
            self.transport_teardown_called.store(true, Ordering::SeqCst);
            match &self.teardown_error {
                Some(error) => Err(error.clone()),
                None => Ok(()),
            }
        }

        fn teardown_scope(
            &self,
            _previous: Option<&StationEntry>,
            _target: &StationEntry,
        ) -> Result<(), StationBindingError> {
            self.scope_teardown_called.store(true, Ordering::SeqCst);
            match &self.teardown_error {
                Some(error) => Err(error.clone()),
                None => Ok(()),
            }
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        static NEXT_ID: AtomicU64 = AtomicU64::new(1);
        let path = std::env::temp_dir().join(format!(
            "peers-station-binding-{name}-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn route(station_peer_id: &str, route_id: &str, origin: &str) -> VerifiedStationRoute {
        let node_peer_id = "12D3KooWGo2HxmjfSQZKTheDEbgDBpSuhUxTNsr8DnTkXCDzdaZL".to_string();
        let port = reqwest::Url::parse(origin)
            .unwrap()
            .port_or_known_default()
            .unwrap();
        VerifiedStationRoute {
            station_peer_id: station_peer_id.to_string(),
            node_peer_id: node_peer_id.clone(),
            station_root_public_key: vec![1, 2, 3],
            node_authorization_digest: [4; 32],
            authorization_epoch: 1,
            route_id: route_id.to_string(),
            route_generation: 1,
            endpoint_origin: origin.to_string(),
            relay_peer_id: None,
            inner_tls_spki_sha256: Some([7; 32]),
            addresses: vec![format!("/ip4/127.0.0.1/tcp/{port}/p2p/{node_peer_id}")],
            attestation_bytes: Some(vec![8, 9]),
            connection_grant: None,
            expires_at_unix_ms: Some(i64::MAX),
        }
    }

    fn registry_with(routes: &[(&str, &str, &str)]) -> StationRegistry {
        let registry = StationRegistry::new(&temp_dir("registry"));
        for (station_peer_id, route_id, origin) in routes {
            registry
                .upsert_verified_route(
                    &route(station_peer_id, route_id, origin),
                    Some((*station_peer_id).to_string()),
                )
                .unwrap();
        }
        registry
    }

    fn bound_service(
        registry: &StationRegistry,
        station_peer_id: &str,
        route_id: Option<&str>,
    ) -> StationBindingService {
        let service = StationBindingService::new(None);
        service
            .switch_with_hooks(registry, station_peer_id, route_id, &TestHooks::success())
            .unwrap();
        service.mark_bound().unwrap();
        service
    }

    #[test]
    fn station_switch_commits_identity_and_enters_access_gate() {
        let registry = registry_with(&[
            ("peer-a", "route-a", "https://a.example"),
            ("peer-b", "route-b", "https://b.example"),
        ]);
        let service = bound_service(&registry, "peer-a", None);
        let hooks = TestHooks::success();

        let state = service
            .switch_with_hooks(&registry, "peer-b", None, &hooks)
            .unwrap();

        assert_eq!(registry.active_station_peer_id().as_deref(), Some("peer-b"));
        assert_eq!(state.phase, StationBindingPhase::AccessGate);
        assert_eq!(state.station_peer_id.as_deref(), Some("peer-b"));
        assert!(hooks.scope_teardown_called.load(Ordering::SeqCst));
        assert!(!hooks.transport_teardown_called.load(Ordering::SeqCst));
    }

    #[test]
    fn same_route_id_refresh_requires_verified_selection_commit() {
        let registry = StationRegistry::new(&temp_dir("same-route-refresh"));
        let current = route("peer-a", "route-a", "https://a.example");
        registry
            .replace_verified_routes(std::slice::from_ref(&current))
            .unwrap();
        let service = bound_service(&registry, "peer-a", Some("route-a"));
        let before = service.state();

        let mut refreshed = current;
        refreshed.authorization_epoch = 2;
        refreshed.node_authorization_digest = [9; 32];
        registry
            .replace_verified_routes(std::slice::from_ref(&refreshed))
            .unwrap();
        assert_eq!(service.state(), before);
        assert_eq!(
            service
                .route_lease(TrafficClass::Interactive)
                .unwrap()
                .route
                .authorization_epoch,
            1
        );

        let hooks = TestHooks::success();
        let after = service
            .switch_with_hooks(&registry, "peer-a", Some("route-a"), &hooks)
            .unwrap();

        assert_eq!(after.phase, StationBindingPhase::Bound);
        assert_eq!(after.route_revision, before.route_revision + 1);
        assert!(hooks.transport_teardown_called.load(Ordering::SeqCst));
        assert_eq!(
            service
                .route_lease(TrafficClass::Interactive)
                .unwrap()
                .route
                .authorization_epoch,
            2
        );
    }

    #[test]
    fn station_switch_uses_committed_identity_when_old_registry_entry_is_missing() {
        let registry = registry_with(&[
            ("peer-a", "route-a", "https://a.example"),
            ("peer-b", "route-b", "https://b.example"),
        ]);
        let service = bound_service(&registry, "peer-a", None);
        registry.remove("peer-a").unwrap();
        let hooks = TestHooks::success();

        let state = service
            .switch_with_hooks(&registry, "peer-b", None, &hooks)
            .unwrap();

        assert_eq!(state.station_peer_id.as_deref(), Some("peer-b"));
        assert!(hooks.scope_teardown_called.load(Ordering::SeqCst));
        assert!(!hooks.transport_teardown_called.load(Ordering::SeqCst));
    }

    #[test]
    fn same_station_route_switch_preserves_lifecycle_generation() {
        let registry = registry_with(&[
            ("peer-a", "direct", "https://direct.example"),
            ("peer-a", "relay", "https://relay.example"),
        ]);
        let service = bound_service(&registry, "peer-a", Some("direct"));
        let before = service.state();
        let previous = service
            .route_lease(TrafficClass::Interactive)
            .expect("current Direct lease");
        let hooks = TestHooks::success();

        let state = service
            .switch_with_hooks(&registry, "peer-a", Some("relay"), &hooks)
            .unwrap();

        assert_eq!(state.active_route_id.as_deref(), Some("relay"));
        assert_eq!(state.lifecycle_generation, before.lifecycle_generation);
        assert!(state.route_revision > before.route_revision);
        assert!(hooks.transport_teardown_called.load(Ordering::SeqCst));
        assert!(!hooks.scope_teardown_called.load(Ordering::SeqCst));
        assert!(previous.is_cancelled());
        let current = service
            .route_lease(TrafficClass::Interactive)
            .expect("replacement Relay lease");
        assert_eq!(current.route_id, "relay");
        assert!(!current.is_cancelled());
    }

    #[test]
    fn removing_bound_station_revokes_existing_route_lease() {
        let registry = registry_with(&[("peer-a", "route-a", "https://a.example")]);
        let service = bound_service(&registry, "peer-a", None);
        let lease = service.route_lease(TrafficClass::Interactive).unwrap();

        let (_, removed) = service.remove_station(&registry, "peer-a").unwrap();

        assert!(removed);
        assert!(lease.is_cancelled());
        assert_eq!(service.state().phase, StationBindingPhase::Unbound);
    }

    #[test]
    fn automatic_route_failover_preserves_bound_session_scope() {
        let registry = registry_with(&[
            ("peer-a", "route-a", "https://a.example"),
            ("peer-a", "route-b", "https://b.example"),
        ]);
        let service = bound_service(&registry, "peer-a", Some("route-a"));
        let before = service.state();
        let target = registry
            .failover_route("peer-a", "route-a", before.route_revision)
            .unwrap();

        let after = service.reconcile_route_revision(&target);

        assert_eq!(after.phase, StationBindingPhase::Bound);
        assert_eq!(after.station_peer_id, before.station_peer_id);
        assert_eq!(after.lifecycle_generation, before.lifecycle_generation);
        assert_eq!(after.active_route_id.as_deref(), Some("route-b"));
        assert!(after.route_revision > before.route_revision);
    }

    #[test]
    fn failover_tears_down_old_transport_before_committing_replacement() {
        let registry = registry_with(&[
            ("peer-a", "route-a", "https://a.example"),
            ("peer-a", "route-b", "https://b.example"),
        ]);
        let service = bound_service(&registry, "peer-a", Some("route-a"));
        let lease = service.route_lease(TrafficClass::Interactive).unwrap();
        let hooks = TestHooks::success();

        let state = service.failover(&registry, &lease, &hooks).unwrap();

        assert_eq!(state.phase, StationBindingPhase::Bound);
        assert_eq!(state.active_route_id.as_deref(), Some("route-b"));
        assert!(hooks.transport_teardown_called.load(Ordering::SeqCst));
        assert!(!hooks.scope_teardown_called.load(Ordering::SeqCst));
        assert!(lease.is_cancelled());
    }

    #[test]
    fn failover_without_an_eligible_route_is_typed_no_route() {
        let registry = registry_with(&[("peer-a", "route-a", "https://a.example")]);
        let service = bound_service(&registry, "peer-a", Some("route-a"));
        let lease = service.route_lease(TrafficClass::Interactive).unwrap();

        let error = service
            .failover(&registry, &lease, &TestHooks::success())
            .expect_err("a single-route Station cannot fail over");

        assert_eq!(error.code, "station_no_route");
        assert!(error.retryable);
        assert!(!lease.is_cancelled());
    }

    #[test]
    fn automatic_failover_adoption_rejects_manual_or_lifecycle_changes() {
        let registry = registry_with(&[
            ("peer-a", "route-a", "https://a.example"),
            ("peer-a", "route-b", "https://b.example"),
        ]);
        let service = bound_service(&registry, "peer-a", Some("route-a"));
        let before = service.state();
        let manual = registry.set_active_route("peer-a", "route-b").unwrap();

        service.reconcile_route_revision(&manual);
        assert_eq!(service.state(), before);

        let mut replaced = manual;
        replaced.lifecycle_generation = before.lifecycle_generation + 1;
        replaced
            .routes
            .iter_mut()
            .find(|route| route.route_id == "route-a")
            .unwrap()
            .health = StationRouteHealth::Unavailable;
        service.reconcile_route_revision(&replaced);
        assert_eq!(service.state(), before);
    }

    #[test]
    fn persisted_binding_starts_connecting_and_resumes() {
        let registry = registry_with(&[("peer-a", "route-a", "https://a.example")]);
        let entry = registry.set_active_station("peer-a").unwrap();
        let service = StationBindingService::new(Some(entry));
        assert_eq!(service.state().phase, StationBindingPhase::Connecting);

        let state = service
            .resume_persisted_with_hooks(&registry, &TestHooks::success())
            .unwrap();
        assert_eq!(state.phase, StationBindingPhase::AccessGate);
        assert_eq!(state.station_peer_id.as_deref(), Some("peer-a"));
        assert_eq!(state.active_route_id.as_deref(), Some("route-a"));
    }

    #[test]
    fn route_verification_failure_keeps_old_binding() {
        let registry = registry_with(&[
            ("peer-a", "route-a", "https://a.example"),
            ("peer-b", "route-b", "https://b.example"),
        ]);
        let service = bound_service(&registry, "peer-a", None);
        let hooks = TestHooks {
            verify_error: Some(StationBindingError::new(
                "station_unreachable",
                "offline",
                true,
            )),
            ..TestHooks::success()
        };

        let error = service
            .switch_with_hooks(&registry, "peer-b", None, &hooks)
            .unwrap_err();

        assert_eq!(error.code, "station_unreachable");
        assert_eq!(service.state().station_peer_id.as_deref(), Some("peer-a"));
        assert_eq!(registry.active_station_peer_id().as_deref(), Some("peer-a"));
    }

    #[test]
    fn binding_becomes_ready_only_after_access_gate_completion() {
        let registry = registry_with(&[("peer-a", "route-a", "https://a.example")]);
        let service = StationBindingService::new(None);
        let state = service
            .switch_with_hooks(&registry, "peer-a", None, &TestHooks::success())
            .unwrap();
        assert_eq!(state.phase, StationBindingPhase::AccessGate);
        assert_eq!(
            service.mark_bound().unwrap().phase,
            StationBindingPhase::Bound
        );
    }

    struct BlockingHooks {
        entered: Arc<Barrier>,
        release: Arc<Barrier>,
    }

    impl StationBindingHooks for BlockingHooks {
        fn verify_route(&self, _entry: &StationEntry) -> Result<(), StationBindingError> {
            self.entered.wait();
            self.release.wait();
            Ok(())
        }

        fn teardown_transport(
            &self,
            _previous: Option<&StationEntry>,
            _target: &StationEntry,
        ) -> Result<(), StationBindingError> {
            Ok(())
        }

        fn teardown_scope(
            &self,
            _previous: Option<&StationEntry>,
            _target: &StationEntry,
        ) -> Result<(), StationBindingError> {
            Ok(())
        }
    }

    #[test]
    fn concurrent_switch_is_rejected_deterministically() {
        let registry = Arc::new(registry_with(&[
            ("peer-a", "route-a", "https://a.example"),
            ("peer-b", "route-b", "https://b.example"),
            ("peer-c", "route-c", "https://c.example"),
        ]));
        let service = Arc::new(bound_service(&registry, "peer-a", None));
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));

        let worker_service = service.clone();
        let worker_registry = registry.clone();
        let worker_entered = entered.clone();
        let worker_release = release.clone();
        let worker = std::thread::spawn(move || {
            worker_service.switch_with_hooks(
                &worker_registry,
                "peer-b",
                None,
                &BlockingHooks {
                    entered: worker_entered,
                    release: worker_release,
                },
            )
        });

        entered.wait();
        let error = service
            .switch_with_hooks(&registry, "peer-c", None, &TestHooks::success())
            .unwrap_err();
        assert_eq!(error.code, "station_switch_in_progress");

        release.wait();
        worker.join().unwrap().unwrap();
        assert_eq!(registry.active_station_peer_id().as_deref(), Some("peer-b"));
    }
}
