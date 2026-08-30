use crate::contracts::{
    AccountAuthorizePinRecoveryInput, AccountIdInput, AccountRemovePinInput, AccountResetPinInput,
    AccountSetPinInput, AccountUnlockInput, AccountUpsertOAuthInput, AuthSessionPayload,
    StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::identity_event::{self, IdentityChangeReason, IdentityChangedPayload};
use crate::infrastructure::session_vault;
use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, State, Window};

use crate::application::account as application_account;
use crate::application::auth::service as auth_service;
use crate::application::key_exchange::device_install;
use crate::application::session_resolver;

fn window_token_for_account(
    state: &Arc<AppState>,
    window: &Window,
    account_id: &str,
    command: &str,
) -> Result<String, AppResult<StubPayload>> {
    let Some(session) = state.sessions.get(window.label()) else {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "Window has no committed session",
            Some(serde_json::json!({
                "command": command,
                "reason": "window_session_missing"
            })),
        ));
    };
    if session.account_id != account_id {
        return Err(AppResult::fail(
            ErrorCode::Forbidden,
            "Input account does not match the window session",
            Some(serde_json::json!({
                "command": command,
                "reason": "window_account_mismatch"
            })),
        ));
    }
    Ok(session.jwt)
}

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
) -> AppResult<AuthSessionPayload> {
    let transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    let identity_state = match crate::infrastructure::auth_identity::read_state() {
        Ok(identity_state) => identity_state,
        Err(error) => {
            return AppResult::fail(ErrorCode::InternalError, error, None);
        }
    };
    if !identity_state
        .accounts
        .iter()
        .any(|account| account.id == input.id)
    {
        return AppResult::fail(ErrorCode::NotFound, "Account not found", None);
    }
    let result = match auth_service::prepare_auth_restore_session_for_account_during_transition(
        state.inner(),
        &transition,
        Some(&input.id),
    ) {
        Ok(prepared) => {
            let identity_state = match crate::infrastructure::auth_identity::read_state() {
                Ok(identity_state) => identity_state,
                Err(error) => {
                    return AppResult::fail(ErrorCode::InternalError, error, None);
                }
            };
            let prepared = match prepared.with_fallback_active_identity_state(identity_state) {
                Ok(prepared) => prepared,
                Err(error) => {
                    return AppResult::fail(ErrorCode::InternalError, error, None);
                }
            };
            crate::interface::tauri_commands::auth::commit_tauri_session_with_identity_state(
                state.inner(),
                &app,
                &window,
                prepared,
            )
        }
        Err(error) => error,
    };
    if result.ok {
        identity_event::emit(
            &app,
            IdentityChangedPayload {
                reason: IdentityChangeReason::Switch,
                actor_id: result.data.as_ref().and_then(|data| data.actor_id.clone()),
                login_method: result
                    .data
                    .as_ref()
                    .and_then(|data| data.login_method.clone()),
            },
        );
    }
    result
}

#[tauri::command]
pub fn account_upsert_oauth(
    input: AccountUpsertOAuthInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<StubPayload> {
    application_account::account_upsert_oauth(input, state.inner())
}

/// Set a PIN for an account. The current session token is read from AppState
/// so it can be encrypted and stored alongside the account.
#[tauri::command]
pub fn account_set_pin(
    input: AccountSetPinInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let account_id = input.account_id.clone();
    let token =
        match window_token_for_account(state.inner(), &window, &account_id, "account_set_pin") {
            Ok(token) => token,
            Err(error) => return error,
        };
    let result = application_account::account_set_pin(input, Some(&token));
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
    let _transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };

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

    let unlocked = result
        .data
        .as_ref()
        .and_then(|d| serde_json::from_str::<serde_json::Value>(&d.status).ok())
        .and_then(|value| {
            Some((
                value.get("token")?.as_str()?.to_string(),
                value.get("account_id")?.as_str()?.to_string(),
                value
                    .get("actor_id")
                    .and_then(|actor| actor.as_str())
                    .map(str::to_string),
            ))
        });

    let (token, persisted_account_id, persisted_actor_id) = match unlocked {
        Some(unlocked) => unlocked,
        None => {
            return AppResult::fail(
                crate::error::ErrorCode::InternalError,
                "failed to extract persisted session binding from unlock result",
                None,
            )
        }
    };
    let initial_session = match auth_service::validate_pin_session_token(
        &account_id_clone,
        &persisted_account_id,
        persisted_actor_id.as_deref(),
        &token,
    ) {
        Ok(session) => session,
        Err(error) => return error,
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
    if let Err(error) = auth_service::invalidate_revoked_actor_runtime(
        state.inner(),
        &initial_session.actor_id,
        &account_id_clone,
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to invalidate superseded actor runtime: {error}"),
            Some(serde_json::json!({
                "command": "account_unlock",
                "reason": "revoked_runtime_cleanup_failed"
            })),
        );
    }

    let session = match auth_service::validate_pin_session_token(
        &account_id_clone,
        &persisted_account_id,
        Some(&initial_session.actor_id),
        &token,
    ) {
        Ok(session) => session,
        Err(error) => return error,
    };
    if let Err(error) = auth_service::verify_session_with_station(&token) {
        return error;
    }

    // Re-encrypt session for next cold start
    if let Err(error) =
        session_vault::save_encrypted_session_and_purge_raw(&account_id_clone, &pin_clone, &token)
    {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to persist unlocked session: {error}"),
            None,
        );
    }

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

    let canonical_ptid = auth_service::canonical_ptid_for_token(&token);
    let actor_id = session.actor_id;
    let prepared = auth_service::PreparedAuthSession {
        payload: AuthSessionPayload {
            command: "account_unlock".to_string(),
            status: "authenticated".to_string(),
            actor_id: Some(actor_id.clone()),
            ptid: canonical_ptid,
            name: p_name,
            email: p_email,
            avatar_url: p_avatar,
            avatar_local_path: p_local_avatar,
            login_method: p_method.clone(),
        },
        account_id: account_id_clone.clone(),
        actor_id: actor_id.clone(),
        token,
        revoked_previous_actor_sessions: true,
        identity_state: None,
    };
    let identity_state = match crate::infrastructure::auth_identity::read_state() {
        Ok(identity_state) => identity_state,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let prepared = match prepared.with_fallback_active_identity_state(identity_state) {
        Ok(prepared) => prepared,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let unlock_payload =
        crate::interface::tauri_commands::auth::commit_tauri_session_with_identity_state(
            state.inner(),
            &app,
            &window,
            prepared,
        );
    if !unlock_payload.ok {
        return unlock_payload;
    }

    identity_event::emit(
        &app,
        IdentityChangedPayload {
            reason: IdentityChangeReason::Unlock,
            actor_id: Some(actor_id),
            login_method: p_method,
        },
    );

    unlock_payload
}

#[tauri::command]
pub fn account_relink_pin(
    input: AccountUnlockInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let account_id = input.account_id.clone();
    let token =
        match window_token_for_account(state.inner(), &window, &account_id, "account_relink_pin") {
            Ok(token) => token,
            Err(error) => return error,
        };
    let result = application_account::account_relink_pin(input, Some(&token));
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

#[tauri::command]
pub fn account_authorize_pin_recovery(
    state: State<'_, Arc<AppState>>,
    window: Window,
    input: AccountAuthorizePinRecoveryInput,
) -> AppResult<StubPayload> {
    let Some(session) = state.sessions.get(&window.label()) else {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "PIN recovery requires a fresh window session",
            None,
        );
    };
    application_account::account_authorize_pin_recovery(
        &input.recovery_id,
        &window.label(),
        &session.account_id,
        &session.jwt,
    )
}

#[tauri::command]
pub fn account_begin_pin_recovery(window: Window, input: AccountIdInput) -> AppResult<StubPayload> {
    application_account::account_begin_pin_recovery(&input.id, &window.label())
}

#[tauri::command]
pub fn account_reset_pin(window: Window, input: AccountResetPinInput) -> AppResult<StubPayload> {
    application_account::account_reset_pin(input, &window.label())
}
