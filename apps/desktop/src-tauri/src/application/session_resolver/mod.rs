//! Window-aware session resolution.
//!
//! Every Tauri command resolves its access context from the originating
//! window. There is no process-global identity fallback.

use std::sync::Arc;
use tauri::Window;

use crate::domain::identity::ActorRef;
use crate::state::AppState;

/// JWT token bound to the actor that this window is authenticated as.
/// Returns `None` only when the window has no active session at all.
pub fn token_for_window(state: &Arc<AppState>, window: &Window) -> Option<String> {
    state
        .sessions
        .token(window.label())
        .filter(|token| !token.trim().is_empty())
}

/// Complete Station actor identity bound to this Tauri window.
///
pub fn actor_for_window(state: &Arc<AppState>, window: &Window) -> Option<ActorRef> {
    state.sessions.actor(window.label())
}

/// Canonical PTID bound to this Tauri window.
pub fn ptid_for_window(state: &Arc<AppState>, window: &Window) -> Option<String> {
    actor_for_window(state, window)
        .map(|actor| actor.ptid)
        .filter(|ptid| ptid.starts_with("ptid:"))
}
