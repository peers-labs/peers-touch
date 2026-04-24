use std::sync::Arc;
use crate::error::AppResult;
use crate::contracts::{
    AccountIdInput, AccountSetPinInput, AccountUnlockInput, AccountRemovePinInput,
    AccountUpsertOAuthInput, StubPayload,
    AuthSessionPayload,
};
use crate::state::AppState;
use tauri::State;

use crate::application::account as application_account;
use crate::application::auth::service as auth_service;

#[tauri::command]
pub fn account_list() -> AppResult<StubPayload> {
    application_account::account_list()
}

#[tauri::command]
pub fn account_get_active() -> AppResult<StubPayload> {
    application_account::account_get_active()
}

#[tauri::command]
pub fn account_switch(input: AccountIdInput) -> AppResult<StubPayload> {
    application_account::account_switch(input)
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
    let token = state
        .session
        .lock()
        .ok()
        .and_then(|g| g.token.clone());
    application_account::account_set_pin(input, token.as_deref())
}

/// Verify PIN and unlock a stored session. On success, writes the decrypted
/// token into AppState so subsequent API calls are authenticated.
#[tauri::command]
pub fn account_unlock(
    input: AccountUnlockInput,
    state: State<'_, Arc<AppState>>,
) -> AppResult<AuthSessionPayload> {
    let account_id_clone = input.account_id.clone();
    let pin_clone = input.pin.clone();

    let result = application_account::account_unlock(input);
    if !result.ok {
        return AppResult::fail(
            result.error.as_ref().map(|e| e.code.clone()).unwrap_or(crate::error::ErrorCode::InternalError),
            result.error.as_ref().map(|e| e.message.clone()).unwrap_or_default(),
            result.error.and_then(|e| e.details),
        );
    }

    // Parse the token from the stub payload
    let token = result
        .data
        .as_ref()
        .and_then(|d| serde_json::from_str::<serde_json::Value>(&d.status).ok())
        .and_then(|v| v.get("token").and_then(|t| t.as_str()).map(|s| s.to_string()));

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

    // Write to AppState and persist the legacy session file
    let session = crate::domain::auth::session::from_station_response(
        extract_actor_id_from_account(&account_id_clone),
        token.clone(),
    );

    if let Ok(mut guard) = state.session.lock() {
        guard.actor_id = Some(session.actor_id.clone());
        guard.token = Some(session.token.clone());
    }

    // Re-encrypt session for next cold start
    let _ = crate::infrastructure::auth_identity::save_encrypted_session(
        &account_id_clone,
        &pin_clone,
        &token,
    );

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
            Some(p.avatar_local_path.clone()).filter(|v| !v.is_empty()),
            Some(p.provider.clone()),
        ),
        None => (None, None, None, None, None),
    };

    AppResult::success(AuthSessionPayload {
        command: "account_unlock".to_string(),
        status: "authenticated".to_string(),
        actor_id: Some(session.actor_id),
        name: p_name,
        email: p_email,
        avatar_url: p_avatar,
        avatar_local_path: p_local_avatar,
        login_method: p_method,
    })
}

/// List accounts that have restorable sessions (for the login picker).
#[tauri::command]
pub fn account_list_restorable() -> AppResult<StubPayload> {
    application_account::account_list_restorable()
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
