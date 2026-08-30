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
) -> Result<(), String> {
    let actor_ptid = payload
        .actor_ptid
        .as_deref()
        .filter(|ptid| ptid.starts_with("ptid:"))
        .ok_or_else(|| "authenticated response missing canonical actor_ptid".to_string())?
        .to_string();
    let token = payload
        .session_token
        .as_deref()
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| "authenticated response missing session token".to_string())?
        .to_string();
    let actor = ActorRef::new_person(actor_ptid.clone());
    let account_id =
        crate::infrastructure::auth_identity::find_account_id_by_actor_ptid(&actor_ptid)
            .ok_or_else(|| "authenticated actor has no local account".to_string())?;
    if let Err(error) =
        auth_service::activate_messaging_profile(state, &account_id, &actor_ptid, &token)
    {
        tracing::warn!(
            account_id = %account_id,
            actor_ptid = %actor_ptid,
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
            "actor_ptid": session.actor.ptid,
        });
        if let Err(error) = app.emit_to(&session.window_label, SESSION_KICKED_EVENT, &payload) {
            tracing::warn!(window = %session.window_label, error = %error, "auth: failed to emit local session kick");
        }
    }
    Ok(())
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
            actor_ptid: data.actor_ptid.clone(),
            login_method: data.login_method.clone(),
        },
    );
}

fn bind_after(
    state: &Arc<AppState>,
    app: &AppHandle,
    window: &Window,
    result: AppResult<AuthSessionPayload>,
) -> AppResult<AuthSessionPayload> {
    if !result.ok {
        return result;
    }
    if let Some(data) = &result.data {
        if let Err(error) = bind_window_session(state, app, window, data) {
            return AppResult::fail(crate::error::ErrorCode::Unauthorized, error, None);
        }
    }
    result
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
    let result = bind_after(
        state.inner(),
        &app,
        &window,
        auth_service::auth_login(input, state.inner()),
    );
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
    let result = bind_after(
        state.inner(),
        &app,
        &window,
        auth_service::access_submit_login(input, state.inner()),
    );
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
    bind_after(
        state.inner(),
        &app,
        &window,
        auth_service::auth_restore_session(state.inner()),
    )
}

#[tauri::command]
pub fn auth_validate_token(
    mut input: AuthValidateTokenInput,
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    if input
        .token
        .as_deref()
        .is_none_or(|token| token.trim().is_empty())
    {
        input.token =
            crate::application::session_resolver::token_for_window(state.inner(), &window);
    }
    bind_after(
        state.inner(),
        &app,
        &window,
        auth_service::auth_validate_token(input, state.inner()),
    )
}

/// Load a PTID-scoped Station JWT persisted during OAuth callback.
#[tauri::command]
pub fn ensure_station_session(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let result = bind_after(
        state.inner(),
        &app,
        &window,
        auth_service::ensure_station_session(state.inner()),
    );
    broadcast_identity(&app, IdentityChangeReason::OauthBridge, &result);
    result
}
