use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{AccountIdInput, AccountUpsertOAuthInput, StubPayload};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AccountIdentityState {
    active_account_id: Option<String>,
    accounts: Vec<AccountIdentity>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AccountIdentity {
    id: String,
    provider: String,
    provider_user_id: String,
    name: String,
    email: String,
    avatar_url: String,
    profile_url: String,
    last_login_at: String,
}

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

fn config_dir() -> CmdResult<PathBuf> {
    let home = std::env::var("HOME").map_err(|_| internal_error("HOME is not set"))?;
    let dir = PathBuf::from(home).join(".peers-touch").join("account");
    if let Err(err) = fs::create_dir_all(&dir) {
        return Err(internal_error(format!("failed to create account dir: {err}")));
    }
    Ok(dir)
}

fn identity_path() -> CmdResult<PathBuf> {
    Ok(config_dir()?.join("identities.json"))
}

fn chrono_like_now_unix() -> i64 {
    let now = SystemTime::now();
    let d = now.duration_since(UNIX_EPOCH).unwrap_or(Duration::from_secs(0));
    d.as_secs() as i64
}

fn unix_to_rfc3339(sec: i64) -> String {
    let dt = time::OffsetDateTime::from_unix_timestamp(sec)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    dt.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn read_state() -> CmdResult<AccountIdentityState> {
    let path = identity_path()?;
    if !path.exists() {
        return Ok(AccountIdentityState::default());
    }
    let text = match fs::read_to_string(&path) {
        Ok(v) => v,
        Err(err) => return Err(internal_error(format!("failed to read account state: {err}"))),
    };
    if text.trim().is_empty() {
        return Ok(AccountIdentityState::default());
    }
    serde_json::from_str::<AccountIdentityState>(&text)
        .map_err(|err| internal_error(format!("invalid account state json: {err}")))
}

fn write_state(state: &AccountIdentityState) -> CmdResult<()> {
    let path = identity_path()?;
    let body = serde_json::to_string_pretty(state)
        .map_err(|err| internal_error(format!("failed to serialize account state: {err}")))?;
    fs::write(path, body).map_err(|err| internal_error(format!("failed to write account state: {err}")))
}

fn to_json(account: &AccountIdentity) -> serde_json::Value {
    json!({
        "id": account.id,
        "provider": account.provider,
        "provider_user_id": account.provider_user_id,
        "name": account.name,
        "email": account.email,
        "avatar_url": account.avatar_url,
        "profile_url": account.profile_url,
        "last_login_at": account.last_login_at,
    })
}

pub fn account_list() -> AppResult<StubPayload> {
    let mut state = try_cmd!(read_state());
    state.accounts.sort_by(|a, b| b.last_login_at.cmp(&a.last_login_at));
    success_payload(
        "account_list",
        json!({
            "accounts": state.accounts.iter().map(to_json).collect::<Vec<_>>(),
            "active_account_id": state.active_account_id,
        }),
    )
}

pub fn account_get_active() -> AppResult<StubPayload> {
    let state = try_cmd!(read_state());
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
    let mut state = try_cmd!(read_state());
    if !state.accounts.iter().any(|item| item.id == input.id) {
        return AppResult::fail(ErrorCode::NotFound, "account not found", None);
    }
    state.active_account_id = Some(input.id);
    try_cmd!(write_state(&state));
    success_payload("account_switch", json!({ "ok": true }))
}

pub fn account_upsert_oauth(input: AccountUpsertOAuthInput) -> AppResult<StubPayload> {
    if input.provider.trim().is_empty() {
        return invalid_argument("provider is required");
    }
    if input.provider_user_id.trim().is_empty() {
        return invalid_argument("provider_user_id is required");
    }
    let mut state = try_cmd!(read_state());
    let account_id = format!("{}:{}", input.provider, input.provider_user_id);
    let name = input
        .name
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| input.provider_user_id.clone());
    let now = unix_to_rfc3339(chrono_like_now_unix());

    if let Some(existing) = state.accounts.iter_mut().find(|item| item.id == account_id) {
        existing.name = name;
        existing.email = input.email.unwrap_or_default();
        existing.avatar_url = input.avatar_url.unwrap_or_default();
        existing.profile_url = input.profile_url.unwrap_or_default();
        existing.last_login_at = now;
    } else {
        state.accounts.push(AccountIdentity {
            id: account_id.clone(),
            provider: input.provider,
            provider_user_id: input.provider_user_id,
            name,
            email: input.email.unwrap_or_default(),
            avatar_url: input.avatar_url.unwrap_or_default(),
            profile_url: input.profile_url.unwrap_or_default(),
            last_login_at: now,
        });
    }

    state.active_account_id = Some(account_id.clone());
    try_cmd!(write_state(&state));
    success_payload("account_upsert_oauth", json!({ "ok": true, "active_account_id": account_id }))
}
