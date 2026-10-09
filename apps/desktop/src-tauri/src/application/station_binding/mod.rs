use serde::Serialize;
use std::sync::{Mutex, OnceLock, TryLockError};

use crate::infrastructure::event_stream;
use crate::infrastructure::station_client;
use crate::infrastructure::station_registry::{StationEntry, StationRegistry};

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
    fn new(code: &str, message: impl Into<String>, retryable: bool) -> Self {
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

struct SystemStationBindingHooks;

impl StationBindingHooks for SystemStationBindingHooks {
    fn verify_route(&self, entry: &StationEntry) -> Result<(), StationBindingError> {
        if entry.active_route().is_none() {
            return Err(StationBindingError::new(
                "station_route_unavailable",
                "The selected Station has no active verified route",
                false,
            ));
        }
        Ok(())
    }

    fn teardown_transport(
        &self,
        _previous: Option<&StationEntry>,
        _target: &StationEntry,
    ) -> Result<(), StationBindingError> {
        event_stream::stop_all();
        Ok(())
    }

    fn teardown_scope(
        &self,
        _previous: Option<&StationEntry>,
        _target: &StationEntry,
    ) -> Result<(), StationBindingError> {
        event_stream::stop_all();
        Ok(())
    }
}

pub struct StationBindingService {
    state: Mutex<StationBindingState>,
    transition: Mutex<()>,
}

impl StationBindingService {
    pub fn new(active_entry: Option<StationEntry>) -> Self {
        Self {
            state: Mutex::new(StationBindingState::from_persisted_entry(active_entry)),
            transition: Mutex::new(()),
        }
    }

    pub fn state(&self) -> StationBindingState {
        self.state
            .lock()
            .expect("StationBindingService state lock poisoned")
            .clone()
    }

    pub fn station_changes(&self, registry: &StationRegistry, station_peer_id: &str) -> bool {
        let state = self.state();
        let current_station_peer_id = state
            .station_peer_id
            .clone()
            .or_else(|| registry.active_station_peer_id());
        current_station_peer_id.as_deref() != Some(station_peer_id)
    }

    pub fn route_changes(
        &self,
        registry: &StationRegistry,
        station_peer_id: &str,
        route_id: Option<&str>,
    ) -> bool {
        let Some(entry) = registry.entry(station_peer_id) else {
            return true;
        };
        let target_route_id = route_id.unwrap_or(&entry.active_route_id);
        let state = self.state();
        state.station_peer_id.as_deref() != Some(station_peer_id)
            || state.active_route_id.as_deref() != Some(target_route_id)
    }

    pub fn switch(
        &self,
        registry: &StationRegistry,
        station_peer_id: &str,
        route_id: Option<&str>,
    ) -> Result<StationBindingState, StationBindingError> {
        self.switch_with_hooks(
            registry,
            station_peer_id,
            route_id,
            &SystemStationBindingHooks,
        )
    }

    pub fn resume_persisted(
        &self,
        registry: &StationRegistry,
    ) -> Result<StationBindingState, StationBindingError> {
        self.resume_persisted_with_hooks(registry, &SystemStationBindingHooks)
    }

    pub fn mark_bound(&self) -> Result<StationBindingState, StationBindingError> {
        let mut state = self
            .state
            .lock()
            .expect("StationBindingService state lock poisoned");
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
            event_stream::stop_all();
            self.replace_state(StationBindingState::from_persisted_entry(None));
        }
        Ok((self.state(), was_selected))
    }

    fn resume_persisted_with_hooks(
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
        self.commit_target(&target);
        Ok(self.state())
    }

    fn switch_with_hooks(
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
        let mut target = registry.entry(station_peer_id).ok_or_else(|| {
            StationBindingError::new(
                "station_not_registered",
                "Add the Station before selecting it",
                false,
            )
        })?;
        if let Some(route_id) = route_id {
            target = registry
                .set_active_route(station_peer_id, route_id)
                .map_err(registry_switch_error)?;
        }

        let _transition = self.transition_guard("Another Station switch is already in progress")?;
        let previous_state = self.state();
        if previous_state.station_peer_id.as_deref() == Some(station_peer_id)
            && previous_state.active_route_id.as_deref() == Some(target.active_route_id.as_str())
            && previous_state.phase == StationBindingPhase::Bound
        {
            return Ok(previous_state);
        }
        let previous_entry = previous_state
            .station_peer_id
            .as_deref()
            .and_then(|peer_id| registry.entry(peer_id));
        let station_changed = previous_entry
            .as_ref()
            .is_some_and(|entry| entry.station_peer_id != target.station_peer_id);

        self.update_state(|state| {
            state.phase = if state.transport_scope().is_some() {
                StationBindingPhase::Switching
            } else {
                StationBindingPhase::Connecting
            };
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
        target = registry
            .set_active_station(station_peer_id)
            .map_err(registry_switch_error)?;
        self.commit_target(&target);
        Ok(self.state())
    }

    fn commit_target(&self, target: &StationEntry) {
        self.update_state(|state| {
            state.phase = StationBindingPhase::AccessGate;
            state.station_peer_id = Some(target.station_peer_id.clone());
            state.active_route_id = Some(target.active_route_id.clone());
            state.target_station_peer_id = None;
            state.target_route_id = None;
            state.route_revision = target.route_revision;
            state.lifecycle_generation = target.lifecycle_generation;
            state.error = None;
        });
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
        *self
            .state
            .lock()
            .expect("StationBindingService state lock poisoned") = next;
    }

    fn update_state(&self, update: impl FnOnce(&mut StationBindingState)) {
        let mut state = self
            .state
            .lock()
            .expect("StationBindingService state lock poisoned");
        update(&mut state);
    }
}

fn registry_switch_error(error: std::io::Error) -> StationBindingError {
    StationBindingError::new(
        "station_switch_failed",
        format!("Could not persist the Station binding: {}", error.kind()),
        true,
    )
}

pub fn service() -> &'static StationBindingService {
    static SERVICE: OnceLock<StationBindingService> = OnceLock::new();
    SERVICE.get_or_init(|| {
        StationBindingService::new(station_client::station_registry().active_entry())
    })
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
        VerifiedStationRoute {
            station_peer_id: station_peer_id.to_string(),
            station_host_public_key: vec![1, 2, 3],
            route_id: route_id.to_string(),
            route_generation: 1,
            endpoint_origin: origin.to_string(),
            relay_peer_id: None,
            inner_tls_spki_sha256: None,
            attestation_bytes: None,
            connection_grant: None,
            expires_at_unix_ms: None,
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
    fn same_station_route_switch_preserves_lifecycle_generation() {
        let registry = registry_with(&[
            ("peer-a", "direct", "https://direct.example"),
            ("peer-a", "relay", "https://relay.example"),
        ]);
        let service = bound_service(&registry, "peer-a", Some("direct"));
        let before = service.state();
        let hooks = TestHooks::success();

        let state = service
            .switch_with_hooks(&registry, "peer-a", Some("relay"), &hooks)
            .unwrap();

        assert_eq!(state.active_route_id.as_deref(), Some("relay"));
        assert_eq!(state.lifecycle_generation, before.lifecycle_generation);
        assert!(state.route_revision > before.route_revision);
        assert!(hooks.transport_teardown_called.load(Ordering::SeqCst));
        assert!(!hooks.scope_teardown_called.load(Ordering::SeqCst));
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
