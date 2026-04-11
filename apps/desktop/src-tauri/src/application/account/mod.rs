use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::auth_identity;
use crate::contracts::{AccountIdInput, AccountUpsertOAuthInput, StubPayload};
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
    json!({
        "id": account.id,
        "provider": account.provider,
        "provider_user_id": account.provider_user_id,
        "name": account.name,
        "email": account.email,
        "avatar_url": account.avatar_url,
        "profile_url": account.profile_url,
        "created_at": account.created_at,
        "last_login_at": account.last_login_at,
    })
}

pub fn account_list() -> AppResult<StubPayload> {
    let mut state = try_cmd!(auth_identity::read_state().map_err(internal_error));
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
        return AppResult::fail(ErrorCode::NotFound, "error.account.notFound", None);
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
