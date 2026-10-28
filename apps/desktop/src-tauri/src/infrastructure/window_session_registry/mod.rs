//! Per-window `ActiveSession` registry.
//!
//! This is the sole in-process session authority. Each Tauri window has an
//! independent PTID-bound session, so multiple windows cannot observe or
//! overwrite each other's actor context.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use crate::domain::identity::{ActiveSession, ActorRef};

/// Thread-safe registry of `(window_label → ActiveSession)`. Designed for
/// a small number of windows (single-digit), so a plain `RwLock<HashMap>`
/// is more than fast enough and avoids pulling in a new dependency.
#[derive(Default)]
pub struct WindowSessionRegistry {
    inner: RwLock<HashMap<String, SessionBinding>>,
    revision: AtomicU64,
    change_observer: Option<Arc<dyn Fn(&str) + Send + Sync>>,
}

struct SessionBinding {
    session: ActiveSession,
    revision: u64,
}

impl SessionBinding {
    fn same_authority(&self, session: &ActiveSession) -> bool {
        self.account_id == session.account_id
            && self.actor.ptid == session.actor.ptid
            && self.jwt == session.jwt
    }
}

impl std::ops::Deref for SessionBinding {
    type Target = ActiveSession;
    fn deref(&self) -> &Self::Target {
        &self.session
    }
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
            revision: AtomicU64::new(0),
            change_observer: None,
        }
    }

    /// Invalidation runs under the identity write guard before old reads can
    /// publish. Observers must not re-enter this registry.
    pub fn with_change_observer(mut self, observer: Arc<dyn Fn(&str) + Send + Sync>) -> Self {
        self.change_observer = Some(observer);
        self
    }

    fn changed(&self, window: &str) {
        if let Some(observer) = &self.change_observer {
            observer(window);
        }
    }

    /// Bind (or replace) the session for `window_label`. Returns the previous
    /// binding if there was one — handy for PR-3's audit logging.
    pub fn bind(&self, session: ActiveSession) -> Option<ActiveSession> {
        let mut map = self
            .inner
            .write()
            .expect("WindowSessionRegistry write lock poisoned");
        self.insert_session(&mut map, session)
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
            self.changed(&kicked_label);
            if let Some(prev) = map.remove(&kicked_label) {
                kicked.push(prev.session);
            }
        }
        let previous_window_session = self.insert_session(&mut map, session);
        Ok(ExclusiveBindingCommit {
            window_label: label,
            previous_window_session,
            kicked,
        })
    }

    fn insert_session(
        &self,
        map: &mut HashMap<String, SessionBinding>,
        mut session: ActiveSession,
    ) -> Option<ActiveSession> {
        let label = session.window_label.clone();
        if let Some(existing) = map.get_mut(&label) {
            if existing.same_authority(&session) {
                // Background validation retains both file ownership and the
                // search publication fence under the same identity lock.
                session.activation_id = existing.activation_id.clone();
                return Some(std::mem::replace(&mut existing.session, session));
            }
        }
        self.changed(&label);
        let revision = self.revision.fetch_add(1, Ordering::SeqCst);
        map.insert(label, SessionBinding { session, revision })
            .map(|b| b.session)
    }

    pub fn rollback_exclusive(&self, commit: ExclusiveBindingCommit) -> Result<(), String> {
        let mut map = self
            .inner
            .write()
            .map_err(|_| "window session registry write lock poisoned".to_string())?;
        self.changed(&commit.window_label);
        map.remove(&commit.window_label);
        if let Some(previous) = commit.previous_window_session {
            let revision = self.revision.fetch_add(1, Ordering::SeqCst);
            map.insert(
                previous.window_label.clone(),
                SessionBinding {
                    session: previous,
                    revision,
                },
            );
        }
        for kicked in commit.kicked {
            self.changed(&kicked.window_label);
            let revision = self.revision.fetch_add(1, Ordering::SeqCst);
            map.insert(
                kicked.window_label.clone(),
                SessionBinding {
                    session: kicked,
                    revision,
                },
            );
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
        self.changed(window_label);
        let removed = map.remove(window_label).map(|b| b.session);
        removed
    }

    pub fn try_unbind_actor(&self, actor_ptid: &str) -> Result<Vec<ActiveSession>, String> {
        let mut map = self
            .inner
            .write()
            .map_err(|_| "window session registry write lock poisoned".to_string())?;
        let labels = map
            .iter()
            .filter_map(|(label, session)| {
                (session.actor.ptid == actor_ptid).then(|| label.clone())
            })
            .collect::<Vec<_>>();
        Ok(labels
            .into_iter()
            .filter_map(|label| {
                self.changed(&label);
                map.remove(&label).map(|b| b.session)
            })
            .collect())
    }

    /// Remove every window session during a process-wide Station cutover.
    pub fn clear(&self) -> Vec<ActiveSession> {
        let mut map = self
            .inner
            .write()
            .expect("WindowSessionRegistry write lock poisoned");
        for label in map.keys() {
            self.changed(label);
        }
        map.drain().map(|(_, binding)| binding.session).collect()
    }

    /// Snapshot the session bound to `window_label`.
    pub fn get(&self, window_label: &str) -> Option<ActiveSession> {
        let map = self
            .inner
            .read()
            .expect("WindowSessionRegistry read lock poisoned");
        map.get(window_label).map(|binding| binding.session.clone())
    }

    /// Snapshot identity and its monotonic publication fence under one lock.
    /// A change to this window binding invalidates its in-flight private reads,
    /// including A → B → A transitions that restore the same token.
    pub fn get_with_revision(&self, window_label: &str) -> Option<(ActiveSession, u64)> {
        let map = self.inner.read().ok()?;
        map.get(window_label)
            .map(|b| (b.session.clone(), b.revision))
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
    ///
    /// Ordering is deterministic: newest binding revision first, then the
    /// window label. Consumers reconciling one worker per account (the
    /// capability supervisor) resolve overlapping windows to the newest
    /// binding instead of relying on HashMap iteration order.
    pub fn snapshot_all(&self) -> Vec<ActiveSession> {
        let map = self
            .inner
            .read()
            .expect("WindowSessionRegistry read lock poisoned");
        let mut bindings: Vec<&SessionBinding> = map.values().collect();
        bindings.sort_by(|left, right| {
            right
                .revision
                .cmp(&left.revision)
                .then_with(|| left.session.window_label.cmp(&right.session.window_label))
        });
        bindings
            .into_iter()
            .map(|binding| binding.session.clone())
            .collect()
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

    #[test]
    fn repeated_session_validation_preserves_attachment_owner() {
        let reg = WindowSessionRegistry::new();
        reg.bind_exclusive(sample("main", "password:alice", "ptid:test:alice"));
        let activation = reg.get("main").unwrap().activation_id;

        reg.bind_exclusive(sample("main", "password:alice", "ptid:test:alice"));
        assert_eq!(reg.get("main").unwrap().activation_id, activation);
        reg.bind(sample("main", "password:alice", "ptid:test:alice"));
        assert_eq!(reg.get("main").unwrap().activation_id, activation);
    }

    #[test]
    fn changed_authority_and_relogin_start_new_activations() {
        let reg = WindowSessionRegistry::new();
        reg.bind_exclusive(sample("main", "password:alice", "ptid:test:alice"));
        let mut activation = reg.get("main").unwrap().activation_id;
        let mut renewed = sample("main", "password:alice", "ptid:test:alice");
        renewed.jwt = "renewed-token".into();
        for next in [
            renewed,
            sample("main", "oauth:alice", "ptid:test:alice"),
            sample("main", "oauth:alice", "ptid:test:bob"),
        ] {
            reg.bind_exclusive(next);
            let current = reg.get("main").unwrap().activation_id;
            assert_ne!(current, activation);
            activation = current;
        }
        reg.unbind("main");
        reg.bind_exclusive(sample("main", "oauth:alice", "ptid:test:bob"));
        assert_ne!(reg.get("main").unwrap().activation_id, activation);
    }

    #[test]
    fn failed_binding_rolls_back_activation_and_exclusivity() {
        let reg = WindowSessionRegistry::new();
        reg.bind(sample("main", "password:alice", "ptid:test:alice"));
        reg.bind(sample("second", "password:bob", "ptid:test:bob"));
        let original = reg.get("main").unwrap().activation_id;
        let second = reg.get("second").unwrap().activation_id;
        let commit = reg
            .try_bind_exclusive(sample("main", "password:bob", "ptid:test:bob"))
            .unwrap();
        assert!(reg.get("second").is_none());
        assert_ne!(reg.get("main").unwrap().activation_id, original);
        reg.rollback_exclusive(commit).unwrap();
        assert_eq!(reg.get("main").unwrap().activation_id, original);
        assert_eq!(reg.get("second").unwrap().activation_id, second);
    }

    #[test]
    fn snapshot_all_orders_by_newest_binding_revision() {
        let reg = WindowSessionRegistry::default();
        // Revision is a process-monotonic publication fence; a later binding
        // always outranks an earlier one regardless of window label.
        reg.bind_exclusive(sample("other", "password:bob", "ptid:test:bob"));
        reg.bind_exclusive(sample("main", "password:alice", "ptid:test:alice"));
        reg.bind_exclusive(sample("main", "password:alice", "ptid:test:alice"));

        let labels: Vec<String> = reg
            .snapshot_all()
            .iter()
            .map(|s| s.window_label.clone())
            .collect();
        assert_eq!(labels, vec!["main".to_string(), "other".to_string()]);

        reg.unbind("main");
        reg.unbind("other");
        reg.bind_exclusive(sample("alpha", "password:dave", "ptid:test:dave"));
        reg.bind_exclusive(sample("zeta", "password:carol", "ptid:test:carol"));
        let labels: Vec<String> = reg
            .snapshot_all()
            .iter()
            .map(|s| s.window_label.clone())
            .collect();
        assert_eq!(labels, vec!["zeta".to_string(), "alpha".to_string()]);
    }

    #[test]
    fn search_revision_is_window_scoped_and_never_reused_after_rebinding() {
        let reg = WindowSessionRegistry::new();
        reg.bind(sample("main", "alice", "ptid:test:alice"));
        let original = reg.get_with_revision("main").unwrap().1;
        reg.bind(sample("second", "bob", "ptid:test:bob"));
        assert_eq!(reg.get_with_revision("main").unwrap().1, original);
        reg.unbind("main");
        reg.bind(sample("main", "bob", "ptid:test:bob"));
        reg.bind(sample("main", "alice", "ptid:test:alice"));
        assert_ne!(reg.get_with_revision("main").unwrap().1, original);
    }

    #[test]
    fn validation_retains_file_owner_and_search_fence_without_invalidation() {
        let changes = Arc::new(std::sync::Mutex::new(Vec::new()));
        let observer_changes = changes.clone();
        let reg = WindowSessionRegistry::new().with_change_observer(Arc::new(move |window| {
            observer_changes.lock().unwrap().push(window.to_string());
        }));
        reg.bind(sample("main", "alice", "ptid:test:alice"));
        let (original, revision) = reg.get_with_revision("main").unwrap();
        reg.bind(sample("main", "alice", "ptid:test:alice"));
        reg.bind_exclusive(sample("main", "alice", "ptid:test:alice"));
        let (validated, validated_revision) = reg.get_with_revision("main").unwrap();
        assert_eq!(validated.activation_id, original.activation_id);
        assert_eq!(validated_revision, revision);
        assert_eq!(*changes.lock().unwrap(), vec!["main"]);

        let mut renewed = sample("main", "alice", "ptid:test:alice");
        renewed.jwt = "renewed-token".into();
        reg.bind_exclusive(renewed);
        let (rebound, rebound_revision) = reg.get_with_revision("main").unwrap();
        assert_ne!(rebound.activation_id, original.activation_id);
        assert_ne!(rebound_revision, revision);
        assert_eq!(*changes.lock().unwrap(), vec!["main", "main"]);
    }
}
