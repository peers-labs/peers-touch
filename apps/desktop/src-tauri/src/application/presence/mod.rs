//! Presence supervisor — single source of truth for "am I online as actor X".
//!
//! See `domain::presence` for the vocabulary; this module is the side-effecting
//! part that interprets [`PresenceTrigger`]s against the running supervisor's
//! state and runs the **reconcile pipeline**:
//!
//!   1. `POST /presence/heartbeat`
//!   2. `GET  /friend-chat/pending`
//!   3. `friend_chat_sync_from_station` for every distinct session id
//!   4. `POST /friend-chat/message/ack` to clear station's queue
//!   5. Tauri event `presence.synced { actor_id, count, sessions }`
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

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
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

    /// Snapshot the current state for `actor_id`. Returns `Offline` for
    /// unknown actors.
    pub fn state_of(&self, actor_id: &str) -> PresenceState {
        let map = self
            .actors
            .lock()
            .expect("PresenceSupervisor lock poisoned");
        map.get(actor_id)
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
        actor_id: &str,
        token: &str,
        trigger: PresenceTrigger,
        app: AppHandle,
    ) -> Option<std::thread::JoinHandle<()>> {
        if actor_id.is_empty() {
            tracing::debug!(?trigger, "presence.notify ignored: empty actor_id");
            return None;
        }
        if token.is_empty() {
            tracing::debug!(
                ?trigger,
                actor = actor_id,
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
            let entry = map.entry(actor_id.to_string()).or_default();
            let from = entry.state;

            // Already in-flight: collapse this trigger.
            if entry.in_flight {
                tracing::debug!(
                    actor = actor_id,
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
                            actor = actor_id,
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
        let actor_id_owned = actor_id.to_string();
        let token_owned = token.to_string();
        let app_for_thread = app.clone();
        let handle = std::thread::Builder::new()
            .name(format!(
                "presence-{}",
                &actor_id_owned[..actor_id_owned.len().min(8)]
            ))
            .spawn(move || {
                let outcome = supervisor.run_reconcile(
                    &actor_id_owned,
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
                let entry = map.entry(actor_id_owned.clone()).or_default();
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
                    actor_id: actor_id_owned,
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
        actor_id: &str,
        token: &str,
        trigger: PresenceTrigger,
        target: PresenceState,
        _app: &AppHandle,
    ) -> ReconcileOutcome {
        match target {
            PresenceState::Offline => self.run_offline(actor_id, token, trigger),
            PresenceState::Online => self.run_online(actor_id, token, trigger),
        }
    }

    fn run_offline(
        &self,
        actor_id: &str,
        token: &str,
        trigger: PresenceTrigger,
    ) -> ReconcileOutcome {
        let result = match chat_storage::presence_offline(token, trigger.as_wire()) {
            Ok(_) => {
                tracing::info!(
                    actor = actor_id,
                    ?trigger,
                    "presence: marked offline at station"
                );
                ReconcileOutcome::ok(0, Vec::new())
            }
            Err(e) => {
                // /presence/offline is best-effort; the lease TTL is the authoritative safety net.
                tracing::warn!(actor = actor_id, ?trigger, error = %e, "presence: /presence/offline failed");
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
                    actor = actor_id,
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
        actor_id: &str,
        token: &str,
        trigger: PresenceTrigger,
    ) -> ReconcileOutcome {
        // Step 1: renew the actor presence lease so station stops queuing for us.
        if let Err(e) = chat_storage::presence_heartbeat(token, trigger.as_wire()) {
            tracing::warn!(actor = actor_id, ?trigger, error = %e, "presence: /presence/heartbeat failed");
            return ReconcileOutcome::failed();
        }

        // Step 2: drain whatever station has been holding for us.
        let pending = match chat_storage::friend_chat_pending(token) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(actor = actor_id, ?trigger, error = %e, "presence: /pending failed");
                // Treat /pending failure as a soft success: we *did* mark
                // ourselves online, even if we couldn't drain the queue.
                // The next heartbeat will retry.
                return ReconcileOutcome::ok(0, Vec::new());
            }
        };

        let (ulids, sessions) = collect_pending(&pending);
        if ulids.is_empty() {
            tracing::debug!(actor = actor_id, ?trigger, "presence: pending queue empty");
            return ReconcileOutcome::ok(0, Vec::new());
        }

        tracing::info!(
            actor = actor_id,
            ?trigger,
            count = ulids.len(),
            sessions = sessions.len(),
            "presence: draining pending queue"
        );

        // Step 3: pull each affected session into the local cursor-aware
        // store so the conversation list and message panel reflect the
        // catch-up. Failures are logged and continued — the goal is
        // best-effort drain, not transactional consistency.
        let user_scope = crate::infrastructure::local_scope::user_scope_for_actor(Some(actor_id));
        for sid in &sessions {
            if let Err(e) = chat_storage::sync_friend_from_station(token, &user_scope, sid, 50, 1) {
                tracing::warn!(
                    actor = actor_id,
                    session = sid,
                    error = %e,
                    "presence: per-session sync failed during reconcile"
                );
            }
        }

        // Step 4: ack so station drops the in-memory queue. We pass
        // status `1` (DELIVERED) which mirrors the convention used by
        // `friend_chat_ack_messages` upstream.
        if let Err(e) = chat_storage::ack_friend_messages(token, &ulids, 1) {
            tracing::warn!(actor = actor_id, error = %e, "presence: /ack failed");
            // Not a hard failure — the queue will be re-served on the
            // next /pending. We still report success so the supervisor
            // moves to Online and the cooldown applies.
        }

        ReconcileOutcome::ok(ulids.len() as u32, sessions)
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

/// Extract `(unique_ulids, unique_session_ulids)` from a `/pending`
/// response. The wire shape is whatever `chat_storage::get_pending_response_to_value`
/// produced; we walk it as untyped JSON to stay decoupled from the proto
/// model imports inside this module (and it's a tiny payload).
fn collect_pending(pending: &Value) -> (Vec<String>, Vec<String>) {
    let messages = pending
        .get("messages")
        .and_then(|v| v.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[]);

    let mut ulids = Vec::with_capacity(messages.len());
    let mut session_set: HashSet<String> = HashSet::new();
    let mut sessions = Vec::with_capacity(messages.len());
    for msg in messages {
        if let Some(ulid) = msg.get("ulid").and_then(|v| v.as_str()) {
            if !ulid.is_empty() {
                ulids.push(ulid.to_string());
            }
        }
        if let Some(sid) = msg.get("session_ulid").and_then(|v| v.as_str()) {
            if !sid.is_empty() && session_set.insert(sid.to_string()) {
                sessions.push(sid.to_string());
            }
        }
    }
    (ulids, sessions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn collect_pending_dedupes_session_ulids_and_preserves_order() {
        let payload = json!({
            "messages": [
                { "ulid": "m1", "session_ulid": "s1" },
                { "ulid": "m2", "session_ulid": "s1" },
                { "ulid": "m3", "session_ulid": "s2" },
                { "ulid": "m4", "session_ulid": "s1" },
            ]
        });
        let (ulids, sessions) = collect_pending(&payload);
        assert_eq!(ulids, vec!["m1", "m2", "m3", "m4"]);
        assert_eq!(sessions, vec!["s1", "s2"]);
    }

    #[test]
    fn collect_pending_handles_missing_fields() {
        let payload = json!({
            "messages": [
                { "ulid": "" },
                { "session_ulid": "" },
                { "session_ulid": "s1" },
                { "ulid": "m2", "session_ulid": "s1" },
            ]
        });
        let (ulids, sessions) = collect_pending(&payload);
        assert_eq!(ulids, vec!["m2"]);
        assert_eq!(sessions, vec!["s1"]);
    }

    #[test]
    fn collect_pending_handles_empty_payload() {
        let payload = json!({ "messages": [] });
        let (ulids, sessions) = collect_pending(&payload);
        assert!(ulids.is_empty());
        assert!(sessions.is_empty());
    }

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
