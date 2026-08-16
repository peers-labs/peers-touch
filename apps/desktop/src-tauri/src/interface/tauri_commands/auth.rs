use crate::contracts::{
    AccessDecisionPayload, AccessSubmitInviteInput, AccessSubmitLoginInput, AuthLoginInput,
    AuthSessionPayload, AuthValidateTokenInput,
};
use crate::domain::identity::{ActiveSession, ActorRef};
use crate::error::AppResult;
use crate::infrastructure::identity_event::{self, IdentityChangeReason, IdentityChangedPayload};
use crate::infrastructure::session_revocation::SESSION_KICKED_EVENT;
use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State, Window};

use crate::application::auth::service as auth_service;

/// Bind the freshly-authenticated identity to the originating window so
/// every subsequent command issued from that window resolves to the
/// correct actor — even when other windows host a different actor.
fn bind_window_session(
    state: &Arc<AppState>,
    app: &AppHandle,
    window: &Window,
    payload: &AuthSessionPayload,
) {
    let actor_id = match payload.actor_id.as_deref() {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => return,
    };
    // The token is intentionally read from the legacy `AppState.session`
    // here: PR-3 keeps both stores in sync; PR-4 cuts the legacy store.
    let token = state
        .session
        .lock()
        .ok()
        .and_then(|g| g.token.clone())
        .unwrap_or_default();
    if token.is_empty() {
        return;
    }
    let mut actor = ActorRef::new_person(actor_id.clone());
    actor.ptid = payload.ptid.clone().unwrap_or_default();
    let account_id = crate::infrastructure::auth_identity::find_account_id_by_actor_id(&actor_id)
        .unwrap_or_else(|| {
            crate::infrastructure::local_scope::account_id_for_password_actor(&actor_id)
        });
    if let Err(error) =
        auth_service::activate_messaging_profile(state, &account_id, &actor_id, &token)
    {
        tracing::warn!(
            account_id = %account_id,
            actor_id = %actor_id,
            error = %error,
            "window session retained while messaging profile activation awaits retry"
        );
    }
    let kicked =
        state
            .sessions
            .bind_exclusive(ActiveSession::new(window.label(), account_id, actor, token));
    for session in kicked {
        let payload = serde_json::json!({
            "reason": "takeover",
            "actor_id": session.actor.actor_id,
        });
        if let Err(error) = app.emit_to(&session.window_label, SESSION_KICKED_EVENT, &payload) {
            tracing::warn!(window = %session.window_label, error = %error, "auth: failed to emit local session kick");
        }
    }
}

fn broadcast_identity(
    app: &AppHandle,
    reason: IdentityChangeReason,
    payload: &AppResult<AuthSessionPayload>,
) {
    if !payload.ok {
        return;
    }
    let data = match &payload.data {
        Some(data) => data,
        None => return,
    };
    identity_event::emit(
        app,
        IdentityChangedPayload {
            reason,
            actor_id: data.actor_id.clone(),
            login_method: data.login_method.clone(),
        },
    );
}

fn bind_after(
    state: &Arc<AppState>,
    app: &AppHandle,
    window: &Window,
    result: &AppResult<AuthSessionPayload>,
) {
    if !result.ok {
        return;
    }
    if let Some(data) = &result.data {
        bind_window_session(state, app, window, data);
    }
}

fn unbind_after(state: &Arc<AppState>, window: &Window, result: &AppResult<AuthSessionPayload>) {
    if !result.ok {
        return;
    }
    state.sessions.unbind(window.label());
}

#[tauri::command]
pub fn auth_login(
    input: AuthLoginInput,
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let result = auth_service::auth_login(input, state.inner());
    bind_after(state.inner(), &app, &window, &result);
    broadcast_identity(&app, IdentityChangeReason::Login, &result);
    result
}

/// Open an interactive access attempt and return the Station's initial gate
/// decision. This is a pre-login step in the gate chain — no session is
/// produced, so no window binding or identity broadcast is performed.
#[tauri::command]
pub fn access_start() -> AppResult<AccessDecisionPayload> {
    auth_service::access_start()
}

/// Redeem a self-service invite code against a live attempt and return the
/// re-evaluated decision. Advances the chain toward the login gate; never
/// produces a session on its own.
#[tauri::command]
pub fn access_submit_invite_code(
    input: AccessSubmitInviteInput,
) -> AppResult<AccessDecisionPayload> {
    auth_service::access_submit_invite_code(input)
}

/// Submit the login credential gate for a live attempt. On grant this lands
/// the full desktop session, so it reuses the same window binding and identity
/// broadcast as the one-shot `auth_login`.
#[tauri::command]
pub fn access_submit_login(
    input: AccessSubmitLoginInput,
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let result = auth_service::access_submit_login(input, state.inner());
    bind_after(state.inner(), &app, &window, &result);
    broadcast_identity(&app, IdentityChangeReason::Login, &result);
    result
}

#[tauri::command]
pub fn auth_logout(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let result = auth_service::auth_logout(state.inner());
    unbind_after(state.inner(), &window, &result);
    broadcast_identity(&app, IdentityChangeReason::Logout, &result);
    result
}

#[tauri::command]
pub fn auth_restore_session(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let result = auth_service::auth_restore_session(state.inner());
    bind_after(state.inner(), &app, &window, &result);
    result
}

#[tauri::command]
pub fn auth_validate_token(
    input: AuthValidateTokenInput,
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let result = auth_service::auth_validate_token(input, state.inner());
    bind_after(state.inner(), &app, &window, &result);
    result
}

/// Load a Station JWT (persisted during OAuth callback) into AppState
/// so the BFF session becomes immediately active.
#[tauri::command]
pub fn ensure_station_session(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let result = auth_service::ensure_station_session(state.inner());
    bind_after(state.inner(), &app, &window, &result);
    broadcast_identity(&app, IdentityChangeReason::OauthBridge, &result);
    result
}
