use std::sync::Arc;
use crate::error::AppResult;
use crate::contracts::{AuthLoginInput, AuthSessionPayload, AuthValidateTokenInput};
use crate::domain::identity::{ActiveSession, ActorRef};
use crate::infrastructure::identity_event::{self, IdentityChangeReason, IdentityChangedPayload};
use crate::state::AppState;
use tauri::{AppHandle, State, Window};

use crate::application::auth::service as auth_service;

/// Bind the freshly-authenticated identity to the originating window so
/// every subsequent command issued from that window resolves to the
/// correct actor — even when other windows host a different actor.
fn bind_window_session(state: &Arc<AppState>, window: &Window, payload: &AuthSessionPayload) {
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
    let actor = ActorRef::new_person(actor_id.clone());
    let account_id = payload
        .login_method
        .as_deref()
        .map(|m| format!("{}:{}", m, actor_id))
        .unwrap_or_else(|| actor_id.clone());
    state
        .sessions
        .bind(ActiveSession::new(window.label(), account_id, actor, token));
}

fn broadcast_identity(app: &AppHandle, reason: IdentityChangeReason, payload: &AppResult<AuthSessionPayload>) {
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
    window: &Window,
    result: &AppResult<AuthSessionPayload>,
) {
    if !result.ok {
        return;
    }
    if let Some(data) = &result.data {
        bind_window_session(state, window, data);
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
    bind_after(state.inner(), &window, &result);
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
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let result = auth_service::auth_restore_session(state.inner());
    bind_after(state.inner(), &window, &result);
    result
}

#[tauri::command]
pub fn auth_validate_token(
    input: AuthValidateTokenInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let result = auth_service::auth_validate_token(input, state.inner());
    bind_after(state.inner(), &window, &result);
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
    bind_after(state.inner(), &window, &result);
    broadcast_identity(&app, IdentityChangeReason::OauthBridge, &result);
    result
}
