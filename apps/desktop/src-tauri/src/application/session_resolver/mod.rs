//! Window-aware session resolution.
//!
//! Every Tauri command goes through this helper to look up "who is the
//! current actor for *this* window". Until PR-4 deletes `AppState.session`,
//! the resolver prefers the per-window registry but falls back to the legacy
//! global so partially-migrated paths keep working.
//!
//! Once every command takes a `tauri::Window` parameter and writes/reads
//! exclusively through the registry, the legacy fallback becomes dead code
//! and gets removed.

use std::sync::Arc;
use tauri::Window;

use crate::state::AppState;

/// JWT token bound to the actor that this window is authenticated as.
/// Returns `None` only when the window has no active session at all.
pub fn token_for_window(state: &Arc<AppState>, window: &Window) -> Option<String> {
    if let Some(t) = state.sessions.token(window.label()) {
        if !t.trim().is_empty() {
            return Some(t);
        }
    }
    state
        .session
        .lock()
        .ok()
        .and_then(|g| g.token.clone())
        .filter(|t| !t.trim().is_empty())
}

/// Station-internal actor id bound to this window's session.
pub fn actor_id_for_window(state: &Arc<AppState>, window: &Window) -> Option<String> {
    if let Some(actor) = state.sessions.actor(window.label()) {
        if !actor.actor_id.trim().is_empty() {
            return Some(actor.actor_id);
        }
    }
    state
        .session
        .lock()
        .ok()
        .and_then(|g| g.actor_id.clone())
        .filter(|s| !s.trim().is_empty())
}
