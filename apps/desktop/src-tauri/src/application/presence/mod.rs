//! Presence supervisor — single source of truth for "am I online as actor X".
//!
//! See `domain::presence` for the vocabulary; this module is the side-effecting
//! part that interprets [`PresenceTrigger`]s against the running supervisor's
//! state and renews the Station presence lease:
//!
//!   1. `POST /presence/heartbeat`
//!   2. Tauri event `presence.synced { actor_ptid, count, sessions }`
//!
//! Durable message reconciliation belongs to the Envelope runtime and
//! `/device/inbox/claim`; Presence does not own a second message queue.
//!
//! # Why a supervisor and not a free function
//!
//! Without coordination, every lifecycle hook would call `/pending`
//! independently and the same actor would get hammered N× per
//! visibility-change. The supervisor enforces three invariants:
//!
//!   * **At most one reconcile in flight per actor** — N concurrent
//!     triggers collapse into one network round-trip.
//!   * **Cooldown** — non-identity triggers within `COOLDOWN` of the last
//!     successful reconcile are absorbed silently (visibility/network
//!     thrash is the dominant noise source).
//!   * **Per-actor isolation** — actor A's reconcile never blocks actor
//!     B's, even if they share a process.
//!
//! Identity-driven triggers (`IdentitySwitched`, `IdentityLoggedOut`,
//! `AppShutdown`, `Manual`) bypass the cooldown — those are user-initiated
//! and dropping them would mean a logout never tells station we're gone.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::application::chat_storage;
use crate::domain::presence::{PresenceState, PresenceTransition, PresenceTrigger};
use crate::infrastructure::oss_cache;

/// Window inside which a non-bypassing trigger is silently absorbed if
/// reconcile already ran. Tuned just above the typical
/// `visibilitychange`+`focus` debounce noise (≈ 500 ms each).
const COOLDOWN: Duration = Duration::from_secs(3);

/// Tauri event name carrying [`PresenceTransition`]. Frontend listens on
/// this to refresh affected sessions; tests listen to assert reconcile
/// happened.
pub const PRESENCE_TRANSITION_EVENT: &str = "presence:transition";

/// Per-actor mutable state held inside the supervisor.
#[derive(Debug, Default, Clone)]
struct ActorPresence {
    state: PresenceState,
    last_reconcile_at: Option<Instant>,
    /// True while a reconcile is running. Used purely to short-circuit
    /// concurrent `notify` calls; the supervisor never blocks waiting on it.
    in_flight: bool,
}

/// Supervisor singleton. Cheap to clone (`Arc`-style internals) and safe
/// to share across threads. Lives on `AppState`.
pub struct PresenceSupervisor {
    actors: Mutex<HashMap<String, ActorPresence>>,
}

impl Default for PresenceSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

impl PresenceSupervisor {
    pub fn new() -> Self {
        Self {
            actors: Mutex::new(HashMap::new()),
        }
    }

    /// Snapshot the current state for `actor_ptid`. Returns `Offline` for
    /// unknown actors.
    pub fn state_of(&self, actor_ptid: &str) -> PresenceState {
        let map = self
            .actors
            .lock()
            .expect("PresenceSupervisor lock poisoned");
        map.get(actor_ptid)
            .map(|a| a.state)
            .unwrap_or(PresenceState::Offline)
    }

    /// Process a trigger. Returns `Some(handle)` on the JoinHandle of the
    /// reconcile thread (mostly for tests); `None` when the trigger was
    /// absorbed (cooldown, in-flight, no-op transition).
    ///
    /// The hot-path is non-blocking — network I/O happens on a detached
    /// thread, and the caller (a Tauri command) can return immediately.
    pub fn notify(
        self: &Arc<Self>,
        actor_ptid: &str,
        token: &str,
        trigger: PresenceTrigger,
        app: AppHandle,
    ) -> Option<std::thread::JoinHandle<()>> {
        if actor_ptid.is_empty() {
            tracing::debug!(?trigger, "presence.notify ignored: empty actor_ptid");
            return None;
        }
        if token.is_empty() {
            tracing::debug!(
                ?trigger,
                actor = actor_ptid,
                "presence.notify ignored: empty token"
            );
            return None;
        }

        let target = trigger.target_state();

        // --- Decide whether to act --------------------------------------
        let (from_state, should_run) = {
            let mut map = self
                .actors
                .lock()
                .expect("PresenceSupervisor lock poisoned");
            let entry = map.entry(actor_ptid.to_string()).or_default();
            let from = entry.state;

            // Already in-flight: collapse this trigger.
            if entry.in_flight {
                tracing::debug!(
                    actor = actor_ptid,
                    ?trigger,
                    "presence: collapsing trigger (in-flight)"
                );
                return None;
            }

            // Cooldown only applies to non-bypassing triggers, and only when
            // the target state matches the current state (i.e., we already
            // reconciled to here). Going Offline→Online or vice-versa is
            // always allowed regardless of cooldown — it's a real change.
            if !trigger.bypasses_cooldown() && from == target {
                if let Some(last) = entry.last_reconcile_at {
                    if last.elapsed() < COOLDOWN {
                        tracing::debug!(
                            actor = actor_ptid,
                            ?trigger,
                            "presence: absorbing trigger (cooldown)"
                        );
                        return None;
                    }
                }
            }

            entry.in_flight = true;
            (from, true)
        };

        if !should_run {
            return None;
        }

        // --- Spawn reconcile -------------------------------------------
        let supervisor = Arc::clone(self);
        let actor_ptid_owned = actor_ptid.to_string();
        let token_owned = token.to_string();
        let app_for_thread = app.clone();
        let handle = std::thread::Builder::new()
            .name(format!(
                "presence-{}",
                &actor_ptid_owned[..actor_ptid_owned.len().min(8)]
            ))
            .spawn(move || {
                let outcome = supervisor.run_reconcile(
                    &actor_ptid_owned,
                    &token_owned,
                    trigger,
                    target,
                    &app_for_thread,
                );

                // --- Commit the post-reconcile state regardless of outcome.
                let mut map = supervisor
                    .actors
                    .lock()
                    .expect("PresenceSupervisor lock poisoned");
                let entry = map.entry(actor_ptid_owned.clone()).or_default();
                entry.in_flight = false;
                if outcome.success {
                    entry.state = target;
                    entry.last_reconcile_at = Some(Instant::now());
                } else {
                    // Failed reconcile: keep us at the *opposite* state of
                    // the target so the next trigger retries. Don't punish
                    // last_reconcile_at — a real failure should not get
                    // cooldown-skipped on the retry attempt.
                    entry.state = match target {
                        PresenceState::Online => PresenceState::Offline,
                        PresenceState::Offline => entry.state,
                    };
                }

                let transition = PresenceTransition {
                    actor_ptid: actor_ptid_owned,
                    from: from_state,
                    to: entry.state,
                    trigger,
                    reconciled_count: outcome.count,
                    affected_sessions: outcome.sessions,
                };
                if let Err(e) = app_for_thread.emit(PRESENCE_TRANSITION_EVENT, &transition) {
                    tracing::warn!(error = %e, "presence: failed to emit transition event");
                }
            })
            .ok();
        handle
    }

    /// Body of the reconcile pipeline. Returns whatever happened so the
    /// caller can update the per-actor state machine accordingly.
    fn run_reconcile(
        &self,
        actor_ptid: &str,
        token: &str,
        trigger: PresenceTrigger,
        target: PresenceState,
        _app: &AppHandle,
    ) -> ReconcileOutcome {
        match target {
            PresenceState::Offline => self.run_offline(actor_ptid, token, trigger),
            PresenceState::Online => self.run_online(actor_ptid, token, trigger),
        }
    }

    fn run_offline(
        &self,
        actor_ptid: &str,
        token: &str,
        trigger: PresenceTrigger,
    ) -> ReconcileOutcome {
        let result = match chat_storage::presence_offline(token, trigger.as_wire()) {
            Ok(_) => {
                tracing::info!(
                    actor = actor_ptid,
                    ?trigger,
                    "presence: marked offline at station"
                );
                ReconcileOutcome::ok(0, Vec::new())
            }
            Err(e) => {
                // /presence/offline is best-effort; the lease TTL is the authoritative safety net.
                tracing::warn!(actor = actor_ptid, ?trigger, error = %e, "presence: /presence/offline failed");
                ReconcileOutcome::ok(0, Vec::new())
            }
        };

        // The Online → Offline edge is the natural moment to reclaim
        // disk: the user is no longer actively browsing chats so a
        // pause for a few hundred ms of `fs::remove_file` calls is
        // invisible. We do this *after* the /offline POST so a slow
        // GC pass cannot delay the station-side state change. AppShutdown
        // skips GC because the next launch will GC again on first
        // Offline→Online → no need to spend the user's exit budget.
        if !matches!(trigger, PresenceTrigger::AppShutdown) {
            let report = oss_cache::gc_with_default_budget();
            if report.evicted > 0 {
                tracing::info!(
                    actor = actor_ptid,
                    evicted = report.evicted,
                    bytes_before = report.bytes_before,
                    bytes_after = report.bytes_after,
                    "presence: oss attachment cache GC pass"
                );
            }
        }

        result
    }

    fn run_online(
        &self,
        actor_ptid: &str,
        token: &str,
        trigger: PresenceTrigger,
    ) -> ReconcileOutcome {
        // Renew the actor presence lease. Durable message recovery is owned by
        // the Envelope runtime, which resumes its actor-device inbox separately.
        if let Err(e) = chat_storage::presence_heartbeat(token, trigger.as_wire()) {
            tracing::warn!(actor = actor_ptid, ?trigger, error = %e, "presence: /presence/heartbeat failed");
            return ReconcileOutcome::failed();
        }
        ReconcileOutcome::ok(0, Vec::new())
    }
}

/// Internal record of what `run_reconcile` produced.
struct ReconcileOutcome {
    success: bool,
    count: u32,
    sessions: Vec<String>,
}

impl ReconcileOutcome {
    fn ok(count: u32, sessions: Vec<String>) -> Self {
        Self {
            success: true,
            count,
            sessions,
        }
    }
    fn failed() -> Self {
        Self {
            success: false,
            count: 0,
            sessions: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supervisor_starts_offline_for_unknown_actor() {
        let s = PresenceSupervisor::new();
        assert_eq!(s.state_of("unknown"), PresenceState::Offline);
    }

    #[test]
    fn supervisor_state_partitions_per_actor() {
        let s = PresenceSupervisor::new();
        // Manually populate two actors to exercise the per-actor map. We
        // do this through the Mutex directly because `notify` requires an
        // AppHandle (which is not available in unit tests).
        {
            let mut map = s.actors.lock().unwrap();
            map.insert(
                "a".to_string(),
                ActorPresence {
                    state: PresenceState::Online,
                    ..Default::default()
                },
            );
            map.insert(
                "b".to_string(),
                ActorPresence {
                    state: PresenceState::Offline,
                    ..Default::default()
                },
            );
        }
        assert_eq!(s.state_of("a"), PresenceState::Online);
        assert_eq!(s.state_of("b"), PresenceState::Offline);
    }
}
