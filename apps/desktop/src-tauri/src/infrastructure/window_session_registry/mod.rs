//! Per-window `ActiveSession` registry.
//!
//! This is the sole in-process session authority. Each Tauri window has an
//! independent PTID-bound session, so multiple windows cannot observe or
//! overwrite each other's actor context.

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
        Self {
            inner: RwLock::new(HashMap::new()),
        }
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

    /// Bind a session and remove any other window already bound to the same
    /// Station actor. Returns the removed sessions so callers can notify those
    /// windows that a newer local login won.
    pub fn bind_exclusive(&self, session: ActiveSession) -> Vec<ActiveSession> {
        let mut map = self
            .inner
            .write()
            .expect("WindowSessionRegistry write lock poisoned");
        let label = session.window_label.clone();
        let actor_ptid = session.actor.ptid.clone();
        let kicked_labels: Vec<String> = map
            .iter()
            .filter_map(|(existing_label, existing)| {
                if *existing_label != label && existing.actor.ptid == actor_ptid {
                    Some(existing_label.clone())
                } else {
                    None
                }
            })
            .collect();
        let mut kicked = Vec::with_capacity(kicked_labels.len());
        for kicked_label in kicked_labels {
            if let Some(prev) = map.remove(&kicked_label) {
                kicked.push(prev);
            }
        }
        map.insert(label, session);
        kicked
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

    /// Remove every window session during a process-wide Station cutover.
    pub fn clear(&self) -> Vec<ActiveSession> {
        let mut map = self
            .inner
            .write()
            .expect("WindowSessionRegistry write lock poisoned");
        map.drain().map(|(_, session)| session).collect()
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

    /// Snapshot every bound session.
    ///
    /// Used for process shutdown and for routing account-scoped native
    /// projection invalidations to the windows bound to that account.
    /// Request paths must still go through `get` / `actor` / `token`.
    pub fn snapshot_all(&self) -> Vec<ActiveSession> {
        let map = self
            .inner
            .read()
            .expect("WindowSessionRegistry read lock poisoned");
        map.values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(label: &str, account: &str, actor_ptid: &str) -> ActiveSession {
        ActiveSession::new(label, account, ActorRef::new_person(actor_ptid), "tok")
    }

    #[test]
    fn bind_and_get_round_trips() {
        let reg = WindowSessionRegistry::new();
        reg.bind(sample("main", "password:alice", "ptid:test:alice"));
        let snap = reg.get("main").expect("session present");
        assert_eq!(snap.actor.ptid, "ptid:test:alice");
        assert_eq!(snap.account_id, "password:alice");
    }

    #[test]
    fn windows_are_isolated_from_each_other() {
        let reg = WindowSessionRegistry::new();
        reg.bind(sample("main", "password:alice", "ptid:test:alice"));
        reg.bind(sample("second", "password:bob", "ptid:test:bob"));
        assert_eq!(reg.actor("main").unwrap().ptid, "ptid:test:alice");
        assert_eq!(reg.actor("second").unwrap().ptid, "ptid:test:bob");
        assert_eq!(reg.len(), 2);
    }

    #[test]
    fn unbind_removes_only_target_window() {
        let reg = WindowSessionRegistry::new();
        reg.bind(sample("main", "password:alice", "ptid:test:alice"));
        reg.bind(sample("second", "password:bob", "ptid:test:bob"));
        let removed = reg.unbind("main").expect("removed");
        assert_eq!(removed.actor.ptid, "ptid:test:alice");
        assert!(reg.get("main").is_none());
        assert!(reg.get("second").is_some());
    }

    #[test]
    fn exclusive_bind_kicks_same_actor_in_other_window() {
        let reg = WindowSessionRegistry::new();
        reg.bind(sample("main", "password:alice", "ptid:test:alice"));
        reg.bind(sample("second", "password:bob", "ptid:test:bob"));

        let kicked = reg.bind_exclusive(sample("third", "password:alice", "ptid:test:alice"));

        assert_eq!(kicked.len(), 1);
        assert_eq!(kicked[0].window_label, "main");
        assert!(reg.get("main").is_none());
        assert!(reg.get("second").is_some());
        assert!(reg.get("third").is_some());
    }
}
