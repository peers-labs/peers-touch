use crate::contracts::{
    AccountIdInput, AccountRemovePinInput, AccountSetPinInput, AccountUnlockInput,
    AccountUpsertOAuthInput, AuthSessionPayload, StubPayload,
};
use crate::domain::identity::{ActiveSession, ActorRef};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::identity_event::{self, IdentityChangeReason, IdentityChangedPayload};
use crate::infrastructure::session_revocation::SESSION_KICKED_EVENT;
use crate::infrastructure::session_vault;
use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State, Window};

use crate::application::account as application_account;
use crate::application::auth::service as auth_service;
use crate::application::key_exchange::device_install;
use crate::application::session_resolver;

#[tauri::command]
pub fn account_list() -> AppResult<StubPayload> {
    application_account::account_list()
}

#[tauri::command]
pub fn account_get_active() -> AppResult<StubPayload> {
    application_account::account_get_active()
}

#[tauri::command]
pub fn account_get_device_id(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let actor_id = match session_resolver::actor_id_for_window(state.inner(), &window) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "Authentication required — please log in",
                None,
            );
        }
    };
    match device_install::get_or_create_device_id(actor_id.as_str()) {
        Ok(device_id) => {
            crate::infrastructure::station_client::set_device_id(device_id.clone());
            AppResult::success(StubPayload {
                command: "account_get_device_id".to_string(),
                status: serde_json::json!({ "device_id": device_id }).to_string(),
            })
        }
        Err(e) => AppResult::fail(ErrorCode::InternalError, format!("device_id: {e}"), None),
    }
}

#[tauri::command]
pub fn account_switch(
    input: AccountIdInput,
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<StubPayload> {
    let switched_id = input.id.clone();
    let result = application_account::account_switch(input);
    if result.ok {
        let actor_id = actor_id_for_account(&switched_id);
        // Re-bind this window's session to the freshly active actor. Without
        // this, switching accounts in window B would still leave window B's
        // command resolver pointing at the previous actor.
        if let Some(id) = actor_id.as_deref() {
            let token = state
                .session
                .lock()
                .ok()
                .and_then(|g| g.token.clone())
                .unwrap_or_default();
            if !token.is_empty() {
                let actor = ActorRef::new_person(id);
                state.sessions.bind(ActiveSession::new(
                    window.label(),
                    switched_id.clone(),
                    actor,
                    token,
                ));
            }
        }
        identity_event::emit(
            &app,
            IdentityChangedPayload {
                reason: IdentityChangeReason::Switch,
                actor_id,
                login_method: None,
            },
        );
    }
    result
}

/// Resolve the underlying station actor_id for a given local `account_id`
/// (e.g. `password:123` → `123`, `github:456` → `456`).
pub(crate) fn actor_id_for_account(account_id: &str) -> Option<String> {
    let raw = account_id
        .split_once(':')
        .map(|(_, id)| id.to_string())
        .unwrap_or_else(|| account_id.to_string());
    if raw.is_empty() {
        None
    } else {
        Some(raw)
    }
}

#[tauri::command]
pub fn account_upsert_oauth(input: AccountUpsertOAuthInput) -> AppResult<StubPayload> {
    application_account::account_upsert_oauth(input)
}

/// Set a PIN for an account. The current session token is read from AppState
/// so it can be encrypted and stored alongside the account.
#[tauri::command]
pub fn account_set_pin(
    input: AccountSetPinInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = state.session.lock().ok().and_then(|g| g.token.clone());
    let account_id = input.account_id.clone();
    let result = application_account::account_set_pin(input, token.as_deref());
    if result.ok {
        session_vault::purge_raw_session_for_account(&account_id);
    }
    result
}

/// Verify PIN and unlock a stored session. On success, writes the decrypted
/// token into AppState so subsequent API calls are authenticated.
#[tauri::command]
pub fn account_unlock(
    input: AccountUnlockInput,
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    window: Window,
) -> AppResult<AuthSessionPayload> {
    let account_id_clone = input.account_id.clone();
    let pin_clone = input.pin.clone();

    let result = application_account::account_unlock(input);
    if !result.ok {
        return AppResult::fail(
            result
                .error
                .as_ref()
                .map(|e| e.code.clone())
                .unwrap_or(crate::error::ErrorCode::InternalError),
            result
                .error
                .as_ref()
                .map(|e| e.message.clone())
                .unwrap_or_default(),
            result.error.and_then(|e| e.details),
        );
    }

    // Parse the token from the stub payload
    let token = result
        .data
        .as_ref()
        .and_then(|d| serde_json::from_str::<serde_json::Value>(&d.status).ok())
        .and_then(|v| {
            v.get("token")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
        });

    let token = match token {
        Some(t) => t,
        None => {
            return AppResult::fail(
                crate::error::ErrorCode::InternalError,
                "failed to extract token from unlock result",
                None,
            )
        }
    };

    // ── Token liveness check ───────────────────────────────────────────
    // The PIN may be correct, but the token it decrypts could already be
    // revoked or expired (Station may have restarted, kicked the device,
    // or simply outlived its TTL). Validate against Station BEFORE we
    // touch any in-memory or on-disk session — otherwise the user lands
    // on a "logged in" UI that immediately collapses on the next request,
    // and the failure surfaces as a confusing red error on the PIN screen.
    //
    // We probe `/actor/profile` because every authenticated actor has it
    // and the cost is one cheap GET.
    use crate::infrastructure::station_client::{
        request_peers_proto_no_body, StationClientErrorKind,
    };
    use crate::model::actor::ActorProfile;
    let probe = request_peers_proto_no_body::<ActorProfile>(
        reqwest::Method::GET,
        "/actor/profile",
        &token,
        None,
    );
    if let Err(err) = probe {
        // Stale token: drop the encrypted_session so the picker won't try
        // PIN unlock again, and surface a structured error so the frontend
        // can route the user straight to the right login form (password vs
        // OAuth) without spending an extra round-trip.
        let stale = matches!(err.kind, StationClientErrorKind::SessionRevoked)
            || err.message.to_ascii_lowercase().contains("unauthor")
            || err.message.contains("401");
        if stale {
            let _ = crate::infrastructure::auth_identity::clear_account_session(&account_id_clone);
            let provider = crate::infrastructure::auth_identity::read_state()
                .ok()
                .and_then(|s| s.accounts.into_iter().find(|a| a.id == account_id_clone))
                .map(|a| a.provider)
                .unwrap_or_default();
            let details = serde_json::json!({
                "code": "session_revoked",
                "reason": "expired",
                "account_id": account_id_clone,
                "provider": provider,
            });
            tracing::info!(
                account_id = %account_id_clone,
                "account_unlock: stored session is no longer valid; cleared encrypted_session"
            );
            return AppResult::fail(
                crate::error::ErrorCode::Unauthorized,
                "session revoked",
                Some(details),
            );
        }
        // Anything else (network, server 5xx) → surface the underlying
        // error untouched so the user can retry instead of being silently
        // dumped back into the login form.
        return AppResult::fail(
            crate::error::ErrorCode::InternalError,
            format!("failed to verify session: {}", err.message),
            err.details,
        );
    }

    let token = match auth_service::takeover_station_session_token(&token) {
        Ok(token) => token,
        Err(err) => {
            let _ = crate::infrastructure::auth_identity::clear_account_session(&account_id_clone);
            let provider = crate::infrastructure::auth_identity::read_state()
                .ok()
                .and_then(|s| s.accounts.into_iter().find(|a| a.id == account_id_clone))
                .map(|a| a.provider)
                .unwrap_or_default();
            return auth_service::session_takeover_failed(
                err,
                Some(&account_id_clone),
                Some(&provider),
            );
        }
    };

    // Write to AppState and per-actor session store (debug gateway still uses `AppState.session`)
    let session = crate::domain::auth::session::from_station_response(
        extract_actor_id_from_account(&account_id_clone),
        token.clone(),
    );

    if let Ok(mut guard) = state.session.lock() {
        guard.actor_id = Some(session.actor_id.clone());
        guard.token = Some(session.token.clone());
    }

    // Re-encrypt session for next cold start
    let _ =
        session_vault::save_encrypted_session_and_purge_raw(&account_id_clone, &pin_clone, &token);

    // Switch the active account
    let _ = application_account::account_switch(crate::contracts::AccountIdInput {
        id: account_id_clone.clone(),
    });

    let profile = crate::infrastructure::auth_identity::find_profile_by_actor_id(&session.actor_id);
    let (p_name, p_email, p_avatar, p_local_avatar, p_method) = match &profile {
        Some(p) => (
            Some(p.name.clone()).filter(|v| !v.is_empty()),
            Some(p.email.clone()).filter(|v| !v.is_empty()),
            Some(p.avatar_url.clone()).filter(|v| !v.is_empty()),
            p.avatar_local_path.clone().filter(|v| !v.is_empty()),
            Some(p.provider.clone()),
        ),
        None => (None, None, None, None, None),
    };

    // Bind the unlocked session to *this* window before broadcasting. If another
    // local window already owns this actor, the new unlock wins and the old
    // window is routed through the same global session-revoked flow.
    let actor = ActorRef::new_person(session.actor_id.clone());
    let kicked = state.sessions.bind_exclusive(ActiveSession::new(
        window.label(),
        account_id_clone.clone(),
        actor,
        token.clone(),
    ));
    for kicked_session in kicked {
        let payload = serde_json::json!({
            "reason": "takeover",
            "actor_id": kicked_session.actor.actor_id,
        });
        if let Err(error) =
            app.emit_to(&kicked_session.window_label, SESSION_KICKED_EVENT, &payload)
        {
            tracing::warn!(window = %kicked_session.window_label, error = %error, "account_unlock: failed to emit local session kick");
        }
    }

    let unlock_payload = AppResult::success(AuthSessionPayload {
        command: "account_unlock".to_string(),
        status: "authenticated".to_string(),
        actor_id: Some(session.actor_id.clone()),
        name: p_name,
        email: p_email,
        avatar_url: p_avatar,
        avatar_local_path: p_local_avatar,
        login_method: p_method.clone(),
    });

    identity_event::emit(
        &app,
        IdentityChangedPayload {
            reason: IdentityChangeReason::Unlock,
            actor_id: Some(session.actor_id),
            login_method: p_method,
        },
    );

    unlock_payload
}

#[tauri::command]
pub fn account_relink_pin(
    input: AccountUnlockInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    let token = state.session.lock().ok().and_then(|g| g.token.clone());
    let account_id = input.account_id.clone();
    let result = application_account::account_relink_pin(input, token.as_deref());
    if result.ok {
        session_vault::purge_raw_session_for_account(&account_id);
    }
    result
}

/// List accounts that have restorable sessions (for the login picker).
#[tauri::command]
pub fn account_list_restorable() -> AppResult<StubPayload> {
    application_account::account_list_restorable()
}

/// Drop the encrypted session blob for an account (e.g. after a server-side
/// revoke). Used by the frontend so the next launch routes the user to the
/// provider-appropriate login form instead of stale PIN entry.
#[tauri::command]
pub fn account_clear_session(input: AccountIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return AppResult::fail(
            crate::error::ErrorCode::InvalidArgument,
            "id is required",
            None,
        );
    }
    match crate::infrastructure::auth_identity::clear_account_session(&input.id) {
        Ok(()) => AppResult::success(StubPayload {
            command: "account_clear_session".to_string(),
            status: "ok".to_string(),
        }),
        Err(e) => AppResult::fail(
            crate::error::ErrorCode::InternalError,
            format!("clear_account_session: {e}"),
            None,
        ),
    }
}

/// Remove PIN protection from an account (requires current PIN for verification).
#[tauri::command]
pub fn account_remove_pin(input: AccountRemovePinInput) -> AppResult<StubPayload> {
    application_account::account_remove_pin(input)
}

/// Extract actor_id from account_id format like "password:abc" or "github:123".
fn extract_actor_id_from_account(account_id: &str) -> String {
    account_id
        .split_once(':')
        .map(|(_, id)| id.to_string())
        .unwrap_or_else(|| account_id.to_string())
}
