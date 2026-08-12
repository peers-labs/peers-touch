use serde::Serialize;
use std::sync::{Mutex, OnceLock, TryLockError};

use crate::infrastructure::event_stream;
use crate::infrastructure::station_client;
use crate::infrastructure::station_registry::StationRegistry;

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
    pub selected_url: Option<String>,
    pub bound_url: Option<String>,
    pub target_url: Option<String>,
    pub generation: u64,
    pub error: Option<StationBindingError>,
}

impl StationBindingState {
    fn from_persisted_selection(selected_url: Option<String>) -> Self {
        let has_selection = selected_url.is_some();
        Self {
            phase: if has_selection {
                StationBindingPhase::Connecting
            } else {
                StationBindingPhase::Unbound
            },
            bound_url: None,
            target_url: selected_url.clone(),
            selected_url,
            generation: 0,
            error: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StationHandshake {
    pub label: Option<String>,
    pub peer_id: Option<String>,
    pub peers_count: Option<u32>,
}

pub trait StationBindingHooks: Send + Sync {
    fn handshake(&self, target_url: &str) -> Result<StationHandshake, StationBindingError>;

    fn teardown_old(
        &self,
        old_url: Option<&str>,
        target_url: &str,
    ) -> Result<(), StationBindingError>;
}

struct SystemStationBindingHooks;

impl StationBindingHooks for SystemStationBindingHooks {
    fn handshake(&self, target_url: &str) -> Result<StationHandshake, StationBindingError> {
        let (online, label, peer_id, peers_count) = station_client::probe_station(target_url);
        if !online {
            return Err(StationBindingError::new(
                "station_unreachable",
                "The selected Station is unavailable",
                true,
            ));
        }
        Ok(StationHandshake {
            label,
            peer_id,
            peers_count,
        })
    }

    fn teardown_old(
        &self,
        _old_url: Option<&str>,
        _target_url: &str,
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
    pub fn new(selected_url: Option<String>) -> Self {
        Self {
            state: Mutex::new(StationBindingState::from_persisted_selection(selected_url)),
            transition: Mutex::new(()),
        }
    }

    pub fn state(&self) -> StationBindingState {
        self.state
            .lock()
            .expect("StationBindingService state lock poisoned")
            .clone()
    }

    pub fn switch(
        &self,
        registry: &StationRegistry,
        target_url: &str,
    ) -> Result<StationBindingState, StationBindingError> {
        self.switch_with_hooks(registry, target_url, &SystemStationBindingHooks)
    }

    pub fn mark_bound(&self) -> Result<StationBindingState, StationBindingError> {
        let mut state = self
            .state
            .lock()
            .expect("StationBindingService state lock poisoned");
        if state.phase == StationBindingPhase::Bound && state.bound_url.is_some() {
            return Ok(state.clone());
        }
        if state.phase != StationBindingPhase::AccessGate || state.bound_url.is_none() {
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
        url: &str,
    ) -> Result<(StationBindingState, bool), StationBindingError> {
        let url = normalize_url(url);
        let _transition = self.transition.try_lock().map_err(|error| match error {
            TryLockError::WouldBlock => StationBindingError::new(
                "station_switch_in_progress",
                "Another Station switch is already in progress",
                true,
            ),
            TryLockError::Poisoned(_) => StationBindingError::new(
                "station_switch_failed",
                "The Station switch coordinator is unavailable",
                true,
            ),
        })?;

        let current = self.state();
        let was_selected = current.selected_url.as_deref() == Some(url.as_str())
            || current.bound_url.as_deref() == Some(url.as_str());
        registry.remove(&url).map_err(|error| {
            StationBindingError::new(
                "station_switch_failed",
                format!("Could not remove the Station: {}", error.kind()),
                true,
            )
        })?;

        if was_selected {
            event_stream::stop_all();
            self.update_state(|state| {
                state.generation += 1;
                state.phase = StationBindingPhase::Unbound;
                state.selected_url = None;
                state.bound_url = None;
                state.target_url = None;
                state.error = None;
            });
        }
        Ok((self.state(), was_selected))
    }

    fn switch_with_hooks(
        &self,
        registry: &StationRegistry,
        target_url: &str,
        hooks: &dyn StationBindingHooks,
    ) -> Result<StationBindingState, StationBindingError> {
        let target_url = normalize_url(target_url);
        if target_url.is_empty() {
            return Err(StationBindingError::new(
                "station_unselected",
                "Select a Station before continuing",
                false,
            ));
        }
        if !registry.list().iter().any(|entry| entry.url == target_url) {
            return Err(StationBindingError::new(
                "station_not_registered",
                "Add the Station before selecting it",
                false,
            ));
        }

        let _transition = match self.transition.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::WouldBlock) => {
                return Err(StationBindingError::new(
                    "station_switch_in_progress",
                    "Another Station switch is already in progress",
                    true,
                ));
            }
            Err(TryLockError::Poisoned(_)) => {
                return Err(StationBindingError::new(
                    "station_switch_failed",
                    "The Station switch coordinator is unavailable",
                    true,
                ));
            }
        };

        let previous = self.state();
        if previous.bound_url.as_deref() == Some(target_url.as_str())
            && previous.phase == StationBindingPhase::Bound
        {
            return Ok(previous);
        }

        self.update_state(|state| {
            state.generation += 1;
            state.phase = if state.bound_url.is_some() {
                StationBindingPhase::Switching
            } else {
                StationBindingPhase::Connecting
            };
            state.target_url = Some(target_url.clone());
            state.error = None;
        });

        let handshake = match hooks.handshake(&target_url) {
            Ok(handshake) => handshake,
            Err(error) => {
                if previous.bound_url.is_some() {
                    self.replace_state(previous);
                } else {
                    self.update_state(|state| {
                        state.phase = StationBindingPhase::Failed;
                        state.selected_url = None;
                        state.bound_url = None;
                        state.target_url = Some(target_url.clone());
                        state.error = Some(error.clone());
                    });
                }
                return Err(error);
            }
        };

        if let Err(error) = registry.update_probe(
            &target_url,
            handshake.label,
            handshake.peer_id,
            handshake.peers_count,
            true,
        ) {
            self.replace_state(previous);
            return Err(StationBindingError::new(
                "station_switch_failed",
                format!("Could not persist Station metadata: {}", error.kind()),
                true,
            ));
        }

        if let Err(error) = hooks.teardown_old(previous.bound_url.as_deref(), &target_url) {
            self.replace_state(previous);
            return Err(error);
        }

        if let Err(error) = registry.set_active(&target_url) {
            let binding_error = StationBindingError::new(
                "station_switch_failed",
                format!("Could not persist the Station selection: {}", error.kind()),
                true,
            );
            self.update_state(|state| {
                state.phase = StationBindingPhase::Failed;
                state.selected_url = None;
                state.bound_url = None;
                state.target_url = Some(target_url.clone());
                state.error = Some(binding_error.clone());
            });
            return Err(binding_error);
        }

        self.update_state(|state| {
            state.phase = StationBindingPhase::AccessGate;
            state.selected_url = Some(target_url.clone());
            state.bound_url = Some(target_url.clone());
            state.target_url = None;
            state.error = None;
        });
        Ok(self.state())
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

fn normalize_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

pub fn service() -> &'static StationBindingService {
    static SERVICE: OnceLock<StationBindingService> = OnceLock::new();
    SERVICE
        .get_or_init(|| StationBindingService::new(station_client::station_registry().active_url()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::station_registry::StationEntry;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Arc, Barrier};

    struct TestHooks {
        handshake_error: Option<StationBindingError>,
        teardown_error: Option<StationBindingError>,
        teardown_called: AtomicBool,
    }

    impl TestHooks {
        fn success() -> Self {
            Self {
                handshake_error: None,
                teardown_error: None,
                teardown_called: AtomicBool::new(false),
            }
        }
    }

    impl StationBindingHooks for TestHooks {
        fn handshake(&self, _target_url: &str) -> Result<StationHandshake, StationBindingError> {
            if let Some(error) = &self.handshake_error {
                return Err(error.clone());
            }
            Ok(StationHandshake {
                label: Some("Target".to_string()),
                peer_id: Some("peer-target".to_string()),
                peers_count: Some(1),
            })
        }

        fn teardown_old(
            &self,
            _old_url: Option<&str>,
            _target_url: &str,
        ) -> Result<(), StationBindingError> {
            self.teardown_called.store(true, Ordering::SeqCst);
            if let Some(error) = &self.teardown_error {
                return Err(error.clone());
            }
            Ok(())
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

    fn entry(url: &str) -> StationEntry {
        StationEntry {
            url: url.to_string(),
            label: None,
            peer_id: None,
            peers_count: None,
            last_probe: None,
            online: false,
        }
    }

    fn registry_with(urls: &[&str]) -> StationRegistry {
        let registry = StationRegistry::new(&temp_dir("registry"));
        for url in urls {
            registry.add(entry(url)).unwrap();
        }
        registry
    }

    fn bound_service(registry: &StationRegistry, url: &str) -> StationBindingService {
        let service = StationBindingService::new(None);
        service
            .switch_with_hooks(registry, url, &TestHooks::success())
            .unwrap();
        service.mark_bound().unwrap();
        service
    }

    #[test]
    fn successful_switch_commits_target_and_enters_access_gate() {
        let registry = registry_with(&["http://a.example", "http://b.example"]);
        let service = bound_service(&registry, "http://a.example");
        let hooks = TestHooks::success();

        let state = service
            .switch_with_hooks(&registry, "http://b.example/", &hooks)
            .unwrap();

        assert_eq!(registry.active_url().as_deref(), Some("http://b.example"));
        assert_eq!(state.phase, StationBindingPhase::AccessGate);
        assert_eq!(state.bound_url.as_deref(), Some("http://b.example"));
        assert!(hooks.teardown_called.load(Ordering::SeqCst));
    }

    #[test]
    fn persisted_selection_starts_connecting_not_bound() {
        let service = StationBindingService::new(Some("http://a.example".to_string()));
        let state = service.state();

        assert_eq!(state.phase, StationBindingPhase::Connecting);
        assert_eq!(state.selected_url.as_deref(), Some("http://a.example"));
        assert_eq!(state.target_url.as_deref(), Some("http://a.example"));
        assert_eq!(state.bound_url, None);
    }

    #[test]
    fn handshake_failure_keeps_old_binding() {
        let registry = registry_with(&["http://a.example", "http://b.example"]);
        let service = bound_service(&registry, "http://a.example");
        let hooks = TestHooks {
            handshake_error: Some(StationBindingError::new(
                "station_unreachable",
                "offline",
                true,
            )),
            ..TestHooks::success()
        };

        let error = service
            .switch_with_hooks(&registry, "http://b.example", &hooks)
            .unwrap_err();

        assert_eq!(error.code, "station_unreachable");
        assert_eq!(registry.active_url().as_deref(), Some("http://a.example"));
        assert_eq!(
            service.state().bound_url.as_deref(),
            Some("http://a.example")
        );
        assert!(!hooks.teardown_called.load(Ordering::SeqCst));
    }

    #[test]
    fn first_handshake_failure_keeps_retry_target() {
        let registry = registry_with(&["http://a.example"]);
        let service = StationBindingService::new(None);
        let hooks = TestHooks {
            handshake_error: Some(StationBindingError::new(
                "station_unreachable",
                "offline",
                true,
            )),
            ..TestHooks::success()
        };

        service
            .switch_with_hooks(&registry, "http://a.example", &hooks)
            .unwrap_err();

        let state = service.state();
        assert_eq!(state.phase, StationBindingPhase::Failed);
        assert_eq!(state.target_url.as_deref(), Some("http://a.example"));
        assert_eq!(
            state.error.as_ref().map(|error| error.code.as_str()),
            Some("station_unreachable")
        );
    }

    #[test]
    fn teardown_failure_keeps_old_binding() {
        let registry = registry_with(&["http://a.example", "http://b.example"]);
        let service = bound_service(&registry, "http://a.example");
        let hooks = TestHooks {
            teardown_error: Some(StationBindingError::new(
                "station_switch_failed",
                "teardown failed",
                true,
            )),
            ..TestHooks::success()
        };

        let error = service
            .switch_with_hooks(&registry, "http://b.example", &hooks)
            .unwrap_err();

        assert_eq!(error.code, "station_switch_failed");
        assert_eq!(registry.active_url().as_deref(), Some("http://a.example"));
        assert_eq!(service.state().phase, StationBindingPhase::Bound);
    }

    #[test]
    fn unknown_target_is_rejected_before_transition() {
        let registry = registry_with(&["http://a.example"]);
        let service = StationBindingService::new(None);

        let error = service
            .switch_with_hooks(&registry, "http://missing.example", &TestHooks::success())
            .unwrap_err();

        assert_eq!(error.code, "station_not_registered");
        assert_eq!(service.state().phase, StationBindingPhase::Unbound);
    }

    #[test]
    fn binding_becomes_ready_only_after_access_gate_completion() {
        let registry = registry_with(&["http://a.example"]);
        let service = StationBindingService::new(None);
        let state = service
            .switch_with_hooks(&registry, "http://a.example", &TestHooks::success())
            .unwrap();
        assert_eq!(state.phase, StationBindingPhase::AccessGate);

        let state = service.mark_bound().unwrap();
        assert_eq!(state.phase, StationBindingPhase::Bound);
    }

    struct BlockingHooks {
        entered: Arc<Barrier>,
        release: Arc<Barrier>,
    }

    impl StationBindingHooks for BlockingHooks {
        fn handshake(&self, _target_url: &str) -> Result<StationHandshake, StationBindingError> {
            self.entered.wait();
            self.release.wait();
            Ok(StationHandshake {
                label: None,
                peer_id: None,
                peers_count: None,
            })
        }

        fn teardown_old(
            &self,
            _old_url: Option<&str>,
            _target_url: &str,
        ) -> Result<(), StationBindingError> {
            Ok(())
        }
    }

    #[test]
    fn concurrent_switch_is_rejected_deterministically() {
        let registry = Arc::new(registry_with(&[
            "http://a.example",
            "http://b.example",
            "http://c.example",
        ]));
        let service = Arc::new(bound_service(&registry, "http://a.example"));
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));

        let worker_service = service.clone();
        let worker_registry = registry.clone();
        let worker_entered = entered.clone();
        let worker_release = release.clone();
        let worker = std::thread::spawn(move || {
            worker_service.switch_with_hooks(
                &worker_registry,
                "http://b.example",
                &BlockingHooks {
                    entered: worker_entered,
                    release: worker_release,
                },
            )
        });

        entered.wait();
        let error = service
            .switch_with_hooks(&registry, "http://c.example", &TestHooks::success())
            .unwrap_err();
        assert_eq!(error.code, "station_switch_in_progress");

        release.wait();
        worker.join().unwrap().unwrap();
        assert_eq!(registry.active_url().as_deref(), Some("http://b.example"));
    }
}
