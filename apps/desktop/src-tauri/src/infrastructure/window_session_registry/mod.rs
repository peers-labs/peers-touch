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

pub struct ExclusiveBindingCommit {
    window_label: String,
    previous_window_session: Option<ActiveSession>,
    kicked: Vec<ActiveSession>,
}

impl ExclusiveBindingCommit {
    pub fn into_kicked(self) -> Vec<ActiveSession> {
        self.kicked
    }
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
        self.try_bind_exclusive(session)
            .expect("WindowSessionRegistry write lock poisoned")
            .kicked
    }

    /// Fallible variant used by identity transactions. Authentication must
    /// fail closed when the authoritative window binding cannot be committed.
    pub fn try_bind_exclusive(
        &self,
        session: ActiveSession,
    ) -> Result<ExclusiveBindingCommit, String> {
        let mut map = self
            .inner
            .write()
            .map_err(|_| "window session registry write lock poisoned".to_string())?;
        let label = session.window_label.clone();
        let actor_id = session.actor.actor_id.clone();
        let kicked_labels: Vec<String> = map
            .iter()
            .filter_map(|(existing_label, existing)| {
                if *existing_label != label && existing.actor.actor_id == actor_id {
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
        let previous_window_session = map.insert(label.clone(), session);
        Ok(ExclusiveBindingCommit {
            window_label: label,
            previous_window_session,
            kicked,
        })
    }

    pub fn rollback_exclusive(&self, commit: ExclusiveBindingCommit) -> Result<(), String> {
        let mut map = self
            .inner
            .write()
            .map_err(|_| "window session registry write lock poisoned".to_string())?;
        map.remove(&commit.window_label);
        if let Some(previous) = commit.previous_window_session {
            map.insert(previous.window_label.clone(), previous);
        }
        for kicked in commit.kicked {
            map.insert(kicked.window_label.clone(), kicked);
        }
        Ok(())
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

    pub fn try_unbind_actor(&self, actor_id: &str) -> Result<Vec<ActiveSession>, String> {
        let mut map = self
            .inner
            .write()
            .map_err(|_| "window session registry write lock poisoned".to_string())?;
        let labels = map
            .iter()
            .filter_map(|(label, session)| {
                (session.actor.actor_id == actor_id).then(|| label.clone())
            })
            .collect::<Vec<_>>();
        Ok(labels
            .into_iter()
            .filter_map(|label| map.remove(&label))
            .collect())
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

    #[test]
    fn exclusive_bind_kicks_same_actor_in_other_window() {
        let reg = WindowSessionRegistry::new();
        reg.bind(sample("main", "password:1", "1"));
        reg.bind(sample("second", "password:2", "2"));

        let kicked = reg.bind_exclusive(sample("third", "password:1", "1"));

        assert_eq!(kicked.len(), 1);
        assert_eq!(kicked[0].window_label, "main");
        assert!(reg.get("main").is_none());
        assert!(reg.get("second").is_some());
        assert!(reg.get("third").is_some());
    }
}
