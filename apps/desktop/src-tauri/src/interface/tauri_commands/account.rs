use crate::contracts::{
    AccountAuthorizePinRecoveryInput, AccountIdInput, AccountRemovePinInput, AccountResetPinInput,
    AccountSetPinInput, AccountUnlockInput, AccountUpsertOAuthInput, AuthSessionPayload,
    StubPayload,
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

fn auth_failure_to_stub(result: AppResult<AuthSessionPayload>) -> AppResult<StubPayload> {
    match result.error {
        Some(error) => AppResult::fail(error.code, error.message, error.details),
        None => AppResult::fail(
            ErrorCode::InternalError,
            "account transition failed without error details",
            None,
        ),
    }
}

fn account_transition_failure(stage: &str, message: impl Into<String>) -> AppResult<StubPayload> {
    AppResult::fail(
        ErrorCode::InternalError,
        "Account switch failed after old session detachment",
        Some(serde_json::json!({
            "command": "account_switch",
            "reason": "account_switch_failed_closed",
            "stage": stage,
            "detached": true,
            "message": message.into(),
        })),
    )
}

fn run_account_switch_transition<P, T>(
    prevalidate: impl FnOnce() -> Result<P, AppResult<StubPayload>>,
    detach_old: impl FnOnce() -> Result<(), AppResult<StubPayload>>,
    acquire_new: impl FnOnce(P) -> Result<T, AppResult<StubPayload>>,
    persist_active: impl FnOnce(&T) -> Result<(), AppResult<StubPayload>>,
    bind_new: impl FnOnce(&T) -> Result<(), AppResult<StubPayload>>,
) -> Result<T, AppResult<StubPayload>> {
    let prevalidated = prevalidate()?;
    detach_old()?;
    let prepared = acquire_new(prevalidated)?;
    persist_active(&prepared)?;
    bind_new(&prepared)?;
    Ok(prepared)
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
    let actor_ptid = match session_resolver::ptid_for_window(state.inner(), &window) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "Authentication required — please log in",
                None,
            );
        }
    };
    match device_install::get_or_create_device_id(actor_ptid.as_str()) {
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
    let switched_id = input.id.clone();
    let prepared = match run_account_switch_transition(
        || auth_service::prepare_account_switch_session(&switched_id).map_err(auth_failure_to_stub),
        || {
            let previous = state.sessions.unbind(window.label());
            if let Some(previous) = previous {
                state
                    .secure_content
                    .teardown_actor(&previous.actor.ptid)
                    .map_err(|error| {
                        account_transition_failure("detach_old_secure_content", error)
                    })?;
                crate::infrastructure::event_stream::stop(&previous.actor.ptid);
                auth_service::deactivate_messaging_profile(state.inner(), &previous.account_id)
                    .map_err(|error| account_transition_failure("detach_old_messaging", error))?;
            }
            Ok(())
        },
        |prevalidated| {
            auth_service::acquire_account_switch_session(prevalidated).map_err(auth_failure_to_stub)
        },
        |prepared| {
            let result = application_account::account_switch(input);
            if !result.ok {
                return Err(result);
            }
            auth_service::persist_prepared_account_switch_session(prepared)
                .map_err(auth_failure_to_stub)
        },
        |prepared| {
            auth_service::prepare_messaging_profile(
                state.inner(),
                &prepared.account_id,
                &prepared.actor_ptid,
            )
            .map_err(|error| account_transition_failure("prepare_new_messaging", error))?;

            let binding = state
                .sessions
                .try_bind_exclusive(ActiveSession::new(
                    window.label(),
                    prepared.account_id.clone(),
                    ActorRef::new_person(prepared.actor_ptid.clone()),
                    prepared.token.clone(),
                ))
                .map_err(|error| {
                    let _ = auth_service::deactivate_messaging_profile(
                        state.inner(),
                        &prepared.account_id,
                    );
                    account_transition_failure("bind_new_session", error)
                })?;

            if let Err(error) = auth_service::activate_messaging_profile_worker(
                state.inner(),
                &prepared.account_id,
                &prepared.token,
            ) {
                state.sessions.unbind(window.label());
                crate::infrastructure::event_stream::stop(&prepared.actor_ptid);
                let _ =
                    auth_service::deactivate_messaging_profile(state.inner(), &prepared.account_id);
                return Err(account_transition_failure("activate_new_messaging", error));
            }

            for kicked_session in binding.into_kicked() {
                if let Err(error) = state
                    .secure_content
                    .teardown_actor(&kicked_session.actor.ptid)
                {
                    tracing::warn!(
                        error = %error,
                        "secure content teardown failed during account-switch takeover"
                    );
                }
                let payload = serde_json::json!({
                    "reason": "takeover",
                    "actor_ptid": kicked_session.actor.ptid,
                });
                if let Err(error) =
                    app.emit_to(&kicked_session.window_label, SESSION_KICKED_EVENT, &payload)
                {
                    tracing::warn!(window = %kicked_session.window_label, error = %error, "account_switch: failed to emit local session kick");
                }
            }
            Ok(())
        },
    ) {
        Ok(prepared) => prepared,
        Err(error) => return error,
    };

    identity_event::emit(
        &app,
        IdentityChangedPayload {
            reason: IdentityChangeReason::Switch,
            actor_ptid: Some(prepared.actor_ptid),
            login_method: prepared.payload.login_method,
        },
    );
    AppResult::success(StubPayload {
        command: "account_switch".to_string(),
        status: serde_json::json!({ "ok": true }).to_string(),
    })
}

pub(crate) fn actor_ptid_for_account(account_id: &str) -> Option<String> {
    session_vault::actor_ptid_for_account(account_id)
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
    window: Window,
) -> AppResult<StubPayload> {
    let token = session_resolver::token_for_window(state.inner(), &window);
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

    let Some(account_actor_ptid) = session_vault::actor_ptid_for_account(&account_id_clone) else {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "account has no canonical actor PTID",
            None,
        );
    };
    let session = match crate::domain::auth::session::validate_token(&token) {
        Ok(session) if session.actor_ptid == account_actor_ptid => session,
        Ok(_) => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "unlocked session PTID does not match account",
                None,
            )
        }
        Err(_) => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "unlocked session has no canonical actor PTID",
                None,
            )
        }
    };

    // Re-encrypt session for next cold start
    let _ =
        session_vault::save_encrypted_session_and_purge_raw(&account_id_clone, &pin_clone, &token);

    // Switch the active account
    let _ = application_account::account_switch(crate::contracts::AccountIdInput {
        id: account_id_clone.clone(),
    });

    let profile =
        crate::infrastructure::auth_identity::find_profile_by_actor_ptid(&session.actor_ptid);
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
    let previous_window_session = state.sessions.get(window.label());
    if super::auth::secure_content_session_replaced(
        previous_window_session.as_ref(),
        &account_id_clone,
        &session.actor_ptid,
        &token,
    ) {
        if let Some(previous) = previous_window_session.as_ref() {
            if let Err(error) = state.secure_content.teardown_actor(&previous.actor.ptid) {
                tracing::warn!(
                    error = %error,
                    "secure content teardown failed while replacing unlocked session authority"
                );
            }
        }
    }
    let actor = ActorRef::new_person(session.actor_ptid.clone());
    let kicked = state.sessions.bind_exclusive(ActiveSession::new(
        window.label(),
        account_id_clone.clone(),
        actor,
        token.clone(),
    ));
    for kicked_session in kicked {
        if let Err(error) = state
            .secure_content
            .teardown_actor(&kicked_session.actor.ptid)
        {
            tracing::warn!(
                error = %error,
                "secure content teardown failed during account-unlock takeover"
            );
        }
        let payload = serde_json::json!({
            "reason": "takeover",
            "actor_ptid": kicked_session.actor.ptid,
        });
        if let Err(error) =
            app.emit_to(&kicked_session.window_label, SESSION_KICKED_EVENT, &payload)
        {
            tracing::warn!(window = %kicked_session.window_label, error = %error, "account_unlock: failed to emit local session kick");
        }
    }
    if let Err(error) = auth_service::activate_messaging_profile(
        &state,
        &account_id_clone,
        &session.actor_ptid,
        &token,
    ) {
        tracing::warn!(
            account_id = %account_id_clone,
            actor_ptid = %session.actor_ptid,
            error = %error,
            "unlocked session retained while durable messaging activation awaits retry"
        );
    }

    let unlock_payload = AppResult::success(AuthSessionPayload {
        command: "account_unlock".to_string(),
        status: "authenticated".to_string(),
        actor_ptid: Some(session.actor_ptid.clone()),
        session_token: Some(session.token.clone()),
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
            actor_ptid: Some(session.actor_ptid),
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
    let token = session_resolver::token_for_window(state.inner(), &window);
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

#[cfg(test)]
mod tests {
    use super::run_account_switch_transition;
    use crate::contracts::StubPayload;
    use crate::error::{AppResult, ErrorCode};
    use std::cell::RefCell;

    fn failure(stage: &str) -> AppResult<StubPayload> {
        AppResult::fail(
            ErrorCode::InternalError,
            stage,
            Some(serde_json::json!({ "stage": stage })),
        )
    }

    #[test]
    fn account_switch_prevalidates_before_detach_and_commits_after_detach() {
        let order = RefCell::new(Vec::new());
        let result: Result<&str, AppResult<StubPayload>> = run_account_switch_transition(
            || {
                order.borrow_mut().push("prevalidate");
                Ok("prevalidated")
            },
            || {
                order.borrow_mut().push("detach");
                Ok(())
            },
            |prevalidated| {
                assert_eq!(prevalidated, "prevalidated");
                order.borrow_mut().push("acquire");
                Ok("prepared")
            },
            |prepared| {
                assert_eq!(*prepared, "prepared");
                order.borrow_mut().push("persist_active");
                Ok(())
            },
            |prepared| {
                assert_eq!(*prepared, "prepared");
                order.borrow_mut().push("bind_new");
                Ok(())
            },
        );

        assert_eq!(result.unwrap(), "prepared");
        assert_eq!(
            *order.borrow(),
            vec![
                "prevalidate",
                "detach",
                "acquire",
                "persist_active",
                "bind_new"
            ]
        );
    }

    #[test]
    fn account_switch_prevalidation_failure_preserves_old_authority() {
        let order = RefCell::new(Vec::new());
        let result: Result<&str, AppResult<StubPayload>> = run_account_switch_transition(
            || {
                order.borrow_mut().push("prevalidate");
                Err::<&str, _>(failure("prevalidate"))
            },
            || {
                order.borrow_mut().push("detach");
                Ok(())
            },
            |_| {
                order.borrow_mut().push("acquire");
                Ok("prepared")
            },
            |_| {
                order.borrow_mut().push("persist_active");
                Ok(())
            },
            |_| {
                order.borrow_mut().push("bind_new");
                Ok(())
            },
        );

        assert!(result.is_err());
        assert_eq!(*order.borrow(), vec!["prevalidate"]);
    }

    #[test]
    fn account_switch_detach_failure_never_acquires_new_authority() {
        let order = RefCell::new(Vec::new());
        let result = run_account_switch_transition(
            || {
                order.borrow_mut().push("prevalidate");
                Ok("prevalidated")
            },
            || {
                order.borrow_mut().push("detach");
                Err(failure("detach"))
            },
            |_| {
                order.borrow_mut().push("acquire");
                Ok(())
            },
            |_| {
                order.borrow_mut().push("persist_active");
                Ok(())
            },
            |_| {
                order.borrow_mut().push("bind_new");
                Ok(())
            },
        );

        assert!(result.is_err());
        assert_eq!(*order.borrow(), vec!["prevalidate", "detach"]);
    }

    #[test]
    fn account_switch_acquisition_failure_never_persists_or_binds_new_authority() {
        let order = RefCell::new(Vec::new());
        let result: Result<&str, AppResult<StubPayload>> = run_account_switch_transition(
            || {
                order.borrow_mut().push("prevalidate");
                Ok("prevalidated")
            },
            || {
                order.borrow_mut().push("detach");
                Ok(())
            },
            |_| {
                order.borrow_mut().push("acquire");
                Err(failure("acquire"))
            },
            |_| {
                order.borrow_mut().push("persist_active");
                Ok(())
            },
            |_| {
                order.borrow_mut().push("bind_new");
                Ok(())
            },
        );

        assert!(result.is_err());
        assert_eq!(*order.borrow(), vec!["prevalidate", "detach", "acquire"]);
    }

    #[test]
    fn account_switch_persistence_failure_never_binds_new_authority() {
        let order = RefCell::new(Vec::new());
        let result = run_account_switch_transition(
            || {
                order.borrow_mut().push("prevalidate");
                Ok("prevalidated")
            },
            || {
                order.borrow_mut().push("detach");
                Ok(())
            },
            |_| {
                order.borrow_mut().push("acquire");
                Ok("prepared")
            },
            |_| {
                order.borrow_mut().push("persist_active");
                Err(failure("persist_active"))
            },
            |_| {
                order.borrow_mut().push("bind_new");
                Ok(())
            },
        );

        assert!(result.is_err());
        assert_eq!(
            *order.borrow(),
            vec!["prevalidate", "detach", "acquire", "persist_active"]
        );
    }

    #[test]
    fn account_switch_binding_failure_occurs_after_persistence() {
        let order = RefCell::new(Vec::new());
        let result = run_account_switch_transition(
            || {
                order.borrow_mut().push("prevalidate");
                Ok("prevalidated")
            },
            || {
                order.borrow_mut().push("detach");
                Ok(())
            },
            |_| {
                order.borrow_mut().push("acquire");
                Ok("prepared")
            },
            |_| {
                order.borrow_mut().push("persist_active");
                Ok(())
            },
            |_| {
                order.borrow_mut().push("bind_new");
                Err(failure("bind_new"))
            },
        );

        assert!(result.is_err());
        assert_eq!(
            *order.borrow(),
            vec![
                "prevalidate",
                "detach",
                "acquire",
                "persist_active",
                "bind_new"
            ]
        );
    }
}
