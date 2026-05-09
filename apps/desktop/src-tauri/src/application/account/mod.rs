use crate::contracts::{
    AccountIdInput, AccountRemovePinInput, AccountSetPinInput, AccountUnlockInput,
    AccountUpsertOAuthInput, StubPayload,
};
use crate::domain::pin_lock::PinVerifyError;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::auth_identity;
use crate::infrastructure::session_vault;
use serde_json::json;

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

type CmdResult<T> = Result<T, AppResult<StubPayload>>;

macro_rules! try_cmd {
    ($expr:expr) => {
        match $expr {
            Ok(value) => value,
            Err(err) => return err,
        }
    };
}

fn internal_error(message: impl Into<String>) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InternalError, message, None)
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

fn to_json(account: &auth_identity::AccountIdentity) -> serde_json::Value {
    // `has_session` reported to the frontend must reflect whether the picker
    // can actually restore this account, not just whether some metadata flag
    // is set on disk. For PIN-protected accounts that means the encrypted
    // blob has to exist — otherwise routing into PIN entry guarantees a
    // "no encrypted session" dead-end the user can never escape from the
    // picker. Non-PIN accounts keep the raw flag because their token lives
    // in the per-actor session_store, not on the AccountIdentity row.
    let has_session = session_vault::account_has_restorable_session(account);
    json!({
        "id": account.id,
        "provider": account.provider,
        "provider_user_id": account.provider_user_id,
        "name": account.name,
        "email": account.email,
        "avatar_url": account.avatar_url,
        "avatar_local_path": account.avatar_local_path,
        "profile_url": account.profile_url,
        "created_at": account.created_at,
        "last_login_at": account.last_login_at,
        "has_pin": account.pin_protection.is_some(),
        "has_session": has_session,
    })
}

pub fn account_list() -> AppResult<StubPayload> {
    let mut state = try_cmd!(auth_identity::read_state().map_err(internal_error));
    session_vault::purge_raw_sessions_for_pin_accounts(&state.accounts);
    state
        .accounts
        .sort_by(|a, b| b.last_login_at.cmp(&a.last_login_at));
    success_payload(
        "account_list",
        json!({
            "accounts": state.accounts.iter().map(to_json).collect::<Vec<_>>(),
            "active_account_id": state.active_account_id,
        }),
    )
}

pub fn account_get_active() -> AppResult<StubPayload> {
    let state = try_cmd!(auth_identity::read_state().map_err(internal_error));
    session_vault::purge_raw_sessions_for_pin_accounts(&state.accounts);
    let active = match state.active_account_id {
        Some(active_id) => state.accounts.into_iter().find(|item| item.id == active_id),
        None => None,
    };
    success_payload(
        "account_get_active",
        json!({
            "account": active.as_ref().map(to_json),
        }),
    )
}

pub fn account_switch(input: AccountIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let mut state = try_cmd!(auth_identity::read_state().map_err(internal_error));
    if !state.accounts.iter().any(|item| item.id == input.id) {
        return AppResult::fail(ErrorCode::NotFound, "Account not found", None);
    }
    state.active_account_id = Some(input.id);
    try_cmd!(auth_identity::write_state(&state).map_err(internal_error));
    success_payload("account_switch", json!({ "ok": true }))
}

pub fn account_upsert_oauth(input: AccountUpsertOAuthInput) -> AppResult<StubPayload> {
    if input.provider.trim().is_empty() {
        return invalid_argument("provider is required");
    }
    if input.provider_user_id.trim().is_empty() {
        return invalid_argument("provider_user_id is required");
    }
    let provider = input.provider;
    let provider_user_id = input.provider_user_id;
    let name = input
        .name
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| provider_user_id.clone());
    let account_id = try_cmd!(auth_identity::upsert_oauth(
        &provider,
        &provider_user_id,
        &name,
        input.created_at.as_deref(),
        input.email.as_deref(),
        input.avatar_url.as_deref(),
        input.profile_url.as_deref(),
    )
    .map_err(internal_error));
    success_payload(
        "account_upsert_oauth",
        json!({ "ok": true, "active_account_id": account_id }),
    )
}

// ---------------------------------------------------------------------------
// PIN management & multi-account session unlock
// ---------------------------------------------------------------------------

/// Set or update a PIN for the given account. Encrypts the current session token.
pub fn account_set_pin(
    input: AccountSetPinInput,
    current_token: Option<&str>,
) -> AppResult<StubPayload> {
    if input.account_id.trim().is_empty() {
        return invalid_argument("account_id is required");
    }
    if input.pin.trim().is_empty() {
        return invalid_argument("pin is required");
    }
    try_cmd!(
        auth_identity::set_account_pin(&input.account_id, &input.pin, current_token)
            .map_err(internal_error)
    );
    success_payload("account_set_pin", json!({ "ok": true }))
}

/// Verify PIN and restore the encrypted session. Returns the session payload on success.
pub fn account_unlock(input: AccountUnlockInput) -> AppResult<StubPayload> {
    if input.account_id.trim().is_empty() {
        return invalid_argument("account_id is required");
    }
    if input.pin.trim().is_empty() {
        return invalid_argument("pin is required");
    }

    match auth_identity::unlock_account_session(&input.account_id, &input.pin) {
        Ok(token) => success_payload(
            "account_unlock",
            json!({ "ok": true, "token": token, "account_id": input.account_id }),
        ),
        Err(PinVerifyError::WrongPin { attempts_remaining }) => AppResult::fail(
            ErrorCode::Unauthorized,
            format!(
                "Incorrect PIN entered ({} attempt(s) remaining)",
                attempts_remaining
            ),
            None,
        ),
        Err(PinVerifyError::LockedOut { remaining_secs }) => AppResult::fail(
            ErrorCode::Forbidden,
            format!(
                "Account locked: too many failed PIN attempts (try again in {} seconds)",
                remaining_secs
            ),
            None,
        ),
        Err(PinVerifyError::Internal(msg)) => internal_error(msg),
    }
}

/// Re-encrypt the current authenticated session with an already-configured PIN.
pub fn account_relink_pin(
    input: AccountUnlockInput,
    current_token: Option<&str>,
) -> AppResult<StubPayload> {
    if input.account_id.trim().is_empty() {
        return invalid_argument("account_id is required");
    }
    if input.pin.trim().is_empty() {
        return invalid_argument("pin is required");
    }
    let Some(token) = current_token.filter(|t| !t.trim().is_empty()) else {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "active session is required to re-link PIN",
            Some(json!({ "command": "account_relink_pin", "reason": "session_missing" })),
        );
    };

    match auth_identity::verify_account_pin(&input.account_id, &input.pin) {
        Ok(()) => {}
        Err(PinVerifyError::WrongPin { attempts_remaining }) => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                format!(
                    "Incorrect PIN entered ({} attempt(s) remaining)",
                    attempts_remaining
                ),
                Some(json!({ "attempts_remaining": attempts_remaining })),
            )
        }
        Err(PinVerifyError::LockedOut { remaining_secs }) => {
            return AppResult::fail(
                ErrorCode::Forbidden,
                format!(
                    "Account locked: too many failed PIN attempts (try again in {} seconds)",
                    remaining_secs
                ),
                Some(json!({ "remaining_secs": remaining_secs })),
            )
        }
        Err(PinVerifyError::Internal(msg)) => return internal_error(msg),
    }

    try_cmd!(session_vault::save_encrypted_session_and_purge_raw(
        &input.account_id,
        &input.pin,
        token
    )
    .map_err(internal_error));
    success_payload(
        "account_relink_pin",
        json!({ "ok": true, "account_id": input.account_id }),
    )
}

/// List accounts that have restorable sessions (for the login account picker).
pub fn account_list_restorable() -> AppResult<StubPayload> {
    let accounts = try_cmd!(auth_identity::list_restorable_accounts().map_err(internal_error));
    session_vault::purge_raw_sessions_for_pin_accounts(&accounts);
    success_payload(
        "account_list_restorable",
        json!({
            "accounts": accounts.iter().map(to_json).collect::<Vec<_>>(),
        }),
    )
}

/// Remove PIN protection from an account (requires current PIN verification).
pub fn account_remove_pin(input: AccountRemovePinInput) -> AppResult<StubPayload> {
    if input.account_id.trim().is_empty() {
        return invalid_argument("account_id is required");
    }
    if input.pin.trim().is_empty() {
        return invalid_argument("pin is required");
    }
    try_cmd!(
        auth_identity::remove_account_pin(&input.account_id, &input.pin).map_err(internal_error)
    );
    success_payload("account_remove_pin", json!({ "ok": true }))
}
