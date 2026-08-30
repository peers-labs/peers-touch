//! Presence Tauri command — single entry point for all lifecycle triggers.
//!
//! Frontend modules (browser visibility hook, identity event bridge, network
//! online/offline observer, periodic heartbeat) only ever call
//! `presence_notify({ trigger })`. The Rust side resolves the actor for the
//! invoking window, looks up the JWT, and hands both to the supervisor —
//! which then decides whether to act.
//!
//! See `application/presence` for the state machine and reconcile flow.

use std::sync::Arc;

use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State, Window};

use crate::application::presence::PresenceSupervisor;
use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::domain::presence::PresenceTrigger;
use crate::error::{AppResult, ErrorCode};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct PresenceNotifyInput {
    /// Snake-case wire form of [`PresenceTrigger`]. See `domain::presence`.
    pub trigger: String,
}

#[derive(Debug, Deserialize)]
pub struct PresenceQueryInput {
    pub actor_ptids: Vec<String>,
}

#[tauri::command]
pub fn presence_query(
    input: PresenceQueryInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "authentication required", None);
    }
    let body = json!({ "actor_ptids": input.actor_ptids });
    match crate::infrastructure::station_client::request_json_auth(
        Method::POST,
        "/presence/query",
        &token,
        None,
        Some(&body),
    ) {
        Ok(response) => AppResult::success(response),
        Err(error) => error.into_app_result("presence query failed"),
    }
}

/// Process a presence trigger for the window's bound actor.
///
/// Always returns success — the supervisor is intentionally
/// non-throwing because **lifecycle hooks must never block the UI**.
/// Triggers for unauthenticated windows or unknown wire-form strings are
/// silently dropped (with a debug log), mirroring how `visibilitychange`
/// fires regardless of auth state in the browser.
#[tauri::command]
pub fn presence_notify(
    input: PresenceNotifyInput,
    state: State<'_, Arc<AppState>>,
    supervisor: State<'_, Arc<PresenceSupervisor>>,
    app: AppHandle,
    window: Window,
) -> AppResult<StubPayload> {
    let trigger = match PresenceTrigger::from_wire(&input.trigger) {
        Some(t) => t,
        None => {
            tracing::debug!(trigger = %input.trigger, "presence_notify: unknown trigger");
            return AppResult::success(StubPayload {
                command: "presence_notify".to_string(),
                status: "{\"accepted\":false,\"reason\":\"unknown_trigger\"}".to_string(),
            });
        }
    };

    let actor_ptid = match session_resolver::ptid_for_window(state.inner(), &window) {
        Some(id) if !id.is_empty() => id,
        _ => {
            tracing::debug!(?trigger, "presence_notify: no bound actor for window");
            return AppResult::success(StubPayload {
                command: "presence_notify".to_string(),
                status: "{\"accepted\":false,\"reason\":\"no_actor\"}".to_string(),
            });
        }
    };

    let token = session_resolver::token_for_window(state.inner(), &window).unwrap_or_default();
    if token.trim().is_empty() {
        // Identity-logout triggers don't need a live token to do their
        // local-only side effects, but the supervisor needs one for the
        // station POSTs. Frontend should fire IdentityLoggedOut before
        // the token is invalidated; otherwise we noop here.
        tracing::debug!(
            ?trigger,
            actor = actor_ptid,
            "presence_notify: no token for window"
        );
        return AppResult::success(StubPayload {
            command: "presence_notify".to_string(),
            status: "{\"accepted\":false,\"reason\":\"no_token\"}".to_string(),
        });
    }

    let _ = supervisor.notify(&actor_ptid, &token, trigger, app);

    let _ = ErrorCode::Unauthorized; // keep the import live for future use
    AppResult::success(StubPayload {
        command: "presence_notify".to_string(),
        status: "{\"accepted\":true}".to_string(),
    })
}
