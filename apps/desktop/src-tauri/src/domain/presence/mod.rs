//! Presence — the device-side concept of "I am online as actor X right now".
//!
//! # Why this lives at the domain layer
//!
//! `online`, `offline`, and `reconcile` recur across many subsystems
//! (chat, P2P signalling, identity switch, lifecycle hooks) and used to be
//! reasoned about ad-hoc inside each. Pulling them up here gives every
//! caller a single vocabulary:
//!
//!   - **What** can change presence? → `PresenceTrigger`
//!   - **What** state is actor-X in?  → `PresenceState`
//!   - **What** happened?             → `PresenceTransition`
//!
//! The application layer (`application::presence`) owns the supervisor that
//! interprets triggers against the current state and runs side-effects
//! (HTTP `/online`, `/pending`, `/ack`). Infrastructure modules
//! (`infrastructure::identity_event`, Tauri lifecycle hooks, browser-side
//! observers) only ever produce `PresenceTrigger`s; they do not carry any
//! domain logic of their own.
//!
//! # State machine
//!
//! ```text
//!     AppLaunch / IdentityRestored / IdentitySwitched
//!     NetworkOnline / AppForeground / Heartbeat
//!         │
//!         ▼
//!   ┌──────────┐  reconcile() ok   ┌──────────┐
//!   │ Offline  │ ─────────────────►│  Online  │
//!   │          │ ◄─────────────────│          │
//!   └──────────┘  AppShutdown /    └──────────┘
//!         ▲       NetworkOffline /      │
//!         │       LoggedOut             │ reconcile() fail
//!         └─────────────────────────────┘
//! ```
//!
//! `Reconciling` is intentionally *not* exposed as a third state — it is a
//! transient flag inside the supervisor (`in_flight: bool`) so the state
//! machine stays binary from a domain standpoint. Transient flags don't
//! belong in the durable taxonomy.

use serde::{Deserialize, Serialize};

/// Whether the device currently considers `actor_id` to be reachable
/// for real-time delivery (WebRTC + Station's pending-queue).
///
/// Note this is **per-actor**, not per-window. Two windows hosting the
/// same actor share one presence; two windows hosting different actors
/// have independent presences.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresenceState {
    /// Default. The actor is either signed-out, suspended, or not yet
    /// reconciled with the station. Pending messages may exist.
    Offline,
    /// Reconcile completed successfully — `/online` has been called and
    /// any pending queue has been pulled and acknowledged.
    Online,
}

impl Default for PresenceState {
    fn default() -> Self {
        PresenceState::Offline
    }
}

/// Why presence may need to transition. The supervisor decides whether
/// any given trigger actually warrants a reconcile based on the current
/// state and the cooldown window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresenceTrigger {
    /// Cold-start: app process just booted; called once after the initial
    /// session restore completes.
    AppLaunch,
    /// App moved to foreground / window became visible / received focus.
    /// Frontend collapses `visibilitychange`, `focus`, and `pageshow` into
    /// this single trigger.
    AppForeground,
    /// App went to background / minimised / lost focus. Used to drive
    /// `/offline` so station stops queuing for us.
    AppBackground,
    /// App is shutting down (window close / process quit). Same effect
    /// as `AppBackground` but expresses intent.
    AppShutdown,

    /// Auth `restoreSession` succeeded for an existing actor (no new
    /// login). This is a distinct trigger from `IdentitySwitched` because
    /// it implies *resumption*, not *change* — useful for analytics.
    IdentityRestored,
    /// User switched to a different actor inside the same process. Also
    /// fired on initial successful login.
    IdentitySwitched,
    /// User explicitly signed out. Drives `/offline` and clears
    /// per-actor in-memory state.
    IdentityLoggedOut,

    /// `navigator.onLine` flipped to true.
    NetworkOnline,
    /// `navigator.onLine` flipped to false.
    NetworkOffline,

    /// Periodic safety-net trigger (every 5 min). Only honoured if we
    /// have not heard from any other trigger for `HEARTBEAT_AFTER`.
    Heartbeat,

    /// Used by tests and `presence_notify` debug paths.
    Manual,
}

impl PresenceTrigger {
    /// Decode the snake_case wire form (used by the Tauri command and the
    /// frontend api binding) into the typed variant.
    pub fn from_wire(s: &str) -> Option<Self> {
        match s {
            "app_launch" => Some(PresenceTrigger::AppLaunch),
            "app_foreground" => Some(PresenceTrigger::AppForeground),
            "app_background" => Some(PresenceTrigger::AppBackground),
            "app_shutdown" => Some(PresenceTrigger::AppShutdown),
            "identity_restored" => Some(PresenceTrigger::IdentityRestored),
            "identity_switched" => Some(PresenceTrigger::IdentitySwitched),
            "identity_logged_out" => Some(PresenceTrigger::IdentityLoggedOut),
            "network_online" => Some(PresenceTrigger::NetworkOnline),
            "network_offline" => Some(PresenceTrigger::NetworkOffline),
            "heartbeat" => Some(PresenceTrigger::Heartbeat),
            "manual" => Some(PresenceTrigger::Manual),
            _ => None,
        }
    }

    /// Whether this trigger demands the actor become **Online** (vs.
    /// **Offline**). Pure function over the trigger variant; consulted by
    /// the supervisor when picking a target state.
    pub fn target_state(self) -> PresenceState {
        match self {
            PresenceTrigger::AppLaunch
            | PresenceTrigger::AppForeground
            | PresenceTrigger::IdentityRestored
            | PresenceTrigger::IdentitySwitched
            | PresenceTrigger::NetworkOnline
            | PresenceTrigger::Heartbeat
            | PresenceTrigger::Manual => PresenceState::Online,

            PresenceTrigger::AppBackground
            | PresenceTrigger::AppShutdown
            | PresenceTrigger::IdentityLoggedOut
            | PresenceTrigger::NetworkOffline => PresenceState::Offline,
        }
    }

    /// Whether the trigger should bypass the cooldown debounce. Identity
    /// transitions are user-initiated and must *always* run — debouncing
    /// them would silently drop a logout's `/offline` call.
    pub fn bypasses_cooldown(self) -> bool {
        matches!(
            self,
            PresenceTrigger::IdentityRestored
                | PresenceTrigger::IdentitySwitched
                | PresenceTrigger::IdentityLoggedOut
                | PresenceTrigger::AppShutdown
                | PresenceTrigger::Manual
        )
    }
}

/// A presence change worth observing. Emitted to the Tauri event bus so
/// frontend modules and tests can react without inspecting supervisor
/// internals.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresenceTransition {
    pub actor_id: String,
    pub from: PresenceState,
    pub to: PresenceState,
    pub trigger: PresenceTrigger,
    /// Number of pending messages reconciled from station. Only meaningful
    /// on a successful Offline→Online transition; otherwise zero.
    #[serde(default)]
    pub reconciled_count: u32,
    /// Distinct session ulids touched by the reconcile. Frontend uses
    /// this to refresh just those panels rather than the entire app.
    #[serde(default)]
    pub affected_sessions: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trigger_wire_form_is_snake_case_round_trip() {
        for &t in &[
            PresenceTrigger::AppLaunch,
            PresenceTrigger::AppForeground,
            PresenceTrigger::AppBackground,
            PresenceTrigger::AppShutdown,
            PresenceTrigger::IdentityRestored,
            PresenceTrigger::IdentitySwitched,
            PresenceTrigger::IdentityLoggedOut,
            PresenceTrigger::NetworkOnline,
            PresenceTrigger::NetworkOffline,
            PresenceTrigger::Heartbeat,
            PresenceTrigger::Manual,
        ] {
            let wire = serde_json::to_string(&t).unwrap();
            // Strip the JSON quotes added by serde for enum strings.
            let bare = wire.trim_matches('"');
            assert_eq!(PresenceTrigger::from_wire(bare), Some(t), "round-trip {bare}");
        }
    }

    #[test]
    fn target_state_partitions_triggers() {
        assert_eq!(PresenceTrigger::AppForeground.target_state(), PresenceState::Online);
        assert_eq!(PresenceTrigger::IdentitySwitched.target_state(), PresenceState::Online);
        assert_eq!(PresenceTrigger::AppShutdown.target_state(), PresenceState::Offline);
        assert_eq!(PresenceTrigger::IdentityLoggedOut.target_state(), PresenceState::Offline);
        assert_eq!(PresenceTrigger::NetworkOffline.target_state(), PresenceState::Offline);
    }

    #[test]
    fn identity_triggers_bypass_cooldown() {
        assert!(PresenceTrigger::IdentitySwitched.bypasses_cooldown());
        assert!(PresenceTrigger::IdentityLoggedOut.bypasses_cooldown());
        assert!(!PresenceTrigger::AppForeground.bypasses_cooldown());
        assert!(!PresenceTrigger::Heartbeat.bypasses_cooldown());
    }
}
