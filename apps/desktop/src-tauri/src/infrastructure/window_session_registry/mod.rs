//! Per-window `ActiveSession` registry.
//!
//! Replaces (in PR-3) the single shared `AppState.session` with one binding
//! per Tauri window, so multiple windows can host different actors inside a
//! single Rust process without poisoning each other's API calls.
//!
//! Status: **introduced in PR-2** as a no-op skeleton. PR-3 migrates Tauri
//! commands to look up sessions through this registry.

use std::collections::HashMap;
use std::sync::RwLock;

use crate::domain::identity::{ActiveSession, ActorRef};

/// Thread-safe registry of `(window_label → ActiveSession)`. Designed for
/// a small number of windows (single-digit), so a plain `RwLock<HashMap>`
/// is more than fast enough and avoids pulling in a new dependency.
#[derive(Default)]
pub struct WindowSessionRegistry {
    inner: RwLock<HashMap<String, ActiveSession>>,
}

impl WindowSessionRegistry {
    pub fn new() -> Self {
        Self { inner: RwLock::new(HashMap::new()) }
    }

    /// Bind (or replace) the session for `window_label`. Returns the previous
    /// binding if there was one — handy for PR-3's audit logging.
    pub fn bind(&self, session: ActiveSession) -> Option<ActiveSession> {
        let mut map = self
            .inner
            .write()
            .expect("WindowSessionRegistry write lock poisoned");
        let label = session.window_label.clone();
        map.insert(label, session)
    }

    /// Remove the session bound to `window_label`. Returns the removed
    /// session, if any.
    pub fn unbind(&self, window_label: &str) -> Option<ActiveSession> {
        let mut map = self
            .inner
            .write()
            .expect("WindowSessionRegistry write lock poisoned");
        map.remove(window_label)
    }

    /// Snapshot the session bound to `window_label`.
    pub fn get(&self, window_label: &str) -> Option<ActiveSession> {
        let map = self
            .inner
            .read()
            .expect("WindowSessionRegistry read lock poisoned");
        map.get(window_label).cloned()
    }

    /// Snapshot the actor bound to `window_label`, if any.
    pub fn actor(&self, window_label: &str) -> Option<ActorRef> {
        self.get(window_label).map(|s| s.actor)
    }

    /// Snapshot the JWT bound to `window_label`, if any.
    pub fn token(&self, window_label: &str) -> Option<String> {
        self.get(window_label).map(|s| s.jwt)
    }

    /// Number of bound sessions (test utility).
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.inner
            .read()
            .expect("WindowSessionRegistry read lock poisoned")
            .len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(label: &str, account: &str, actor: &str) -> ActiveSession {
        ActiveSession::new(label, account, ActorRef::new_person(actor), "tok")
    }

    #[test]
    fn bind_and_get_round_trips() {
        let reg = WindowSessionRegistry::new();
        reg.bind(sample("main", "password:1", "1"));
        let snap = reg.get("main").expect("session present");
        assert_eq!(snap.actor.actor_id, "1");
        assert_eq!(snap.account_id, "password:1");
    }

    #[test]
    fn windows_are_isolated_from_each_other() {
        let reg = WindowSessionRegistry::new();
        reg.bind(sample("main", "password:1", "1"));
        reg.bind(sample("second", "password:2", "2"));
        assert_eq!(reg.actor("main").unwrap().actor_id, "1");
        assert_eq!(reg.actor("second").unwrap().actor_id, "2");
        assert_eq!(reg.len(), 2);
    }

    #[test]
    fn unbind_removes_only_target_window() {
        let reg = WindowSessionRegistry::new();
        reg.bind(sample("main", "password:1", "1"));
        reg.bind(sample("second", "password:2", "2"));
        let removed = reg.unbind("main").expect("removed");
        assert_eq!(removed.actor.actor_id, "1");
        assert!(reg.get("main").is_none());
        assert!(reg.get("second").is_some());
    }
}
