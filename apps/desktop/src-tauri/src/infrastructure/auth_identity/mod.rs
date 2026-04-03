use crate::infrastructure::storage::{self, StorageKind};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AccountIdentityState {
    pub active_account_id: Option<String>,
    pub accounts: Vec<AccountIdentity>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AccountIdentity {
    pub id: String,
    pub provider: String,
    pub provider_user_id: String,
    pub name: String,
    pub email: String,
    pub avatar_url: String,
    pub profile_url: String,
    #[serde(default)]
    pub created_at: String,
    pub last_login_at: String,
}

pub fn account_identity_path() -> Result<PathBuf, String> {
    storage::app_file_path("desktop", StorageKind::Data, &["account", "identities.json"])
        .map_err(|err| format!("failed to resolve account identity path: {err:?}"))
}

pub fn read_state() -> Result<AccountIdentityState, String> {
    let path = account_identity_path()?;
    if !path.exists() {
        return Ok(AccountIdentityState::default());
    }
    let text = fs::read_to_string(&path).map_err(|err| format!("failed to read account state: {err}"))?;
    if text.trim().is_empty() {
        return Ok(AccountIdentityState::default());
    }
    serde_json::from_str::<AccountIdentityState>(&text)
        .map_err(|err| format!("invalid account state json: {err}"))
}

pub fn write_state(state: &AccountIdentityState) -> Result<(), String> {
    let path = account_identity_path()?;
    let body = serde_json::to_string_pretty(state)
        .map_err(|err| format!("failed to serialize account state: {err}"))?;
    storage::write_string_atomic(&path, &body)
        .map_err(|err| format!("failed to write account state: {err:?}"))
}

pub fn upsert_oauth(
    provider: &str,
    provider_user_id: &str,
    name: &str,
    created_at: Option<&str>,
    email: Option<&str>,
    avatar_url: Option<&str>,
    profile_url: Option<&str>,
) -> Result<String, String> {
    let mut state = read_state()?;
    let account_id = format!("{provider}:{provider_user_id}");
    let now = unix_to_rfc3339(chrono_like_now_unix());
    if let Some(existing) = state.accounts.iter_mut().find(|item| item.id == account_id) {
        existing.name = name.to_string();
        existing.email = email.unwrap_or_default().to_string();
        existing.avatar_url = avatar_url.unwrap_or_default().to_string();
        existing.profile_url = profile_url.unwrap_or_default().to_string();
        if existing.created_at.trim().is_empty() {
            existing.created_at = created_at
                .filter(|v| !v.trim().is_empty())
                .map(|v| v.to_string())
                .unwrap_or_else(|| existing.last_login_at.clone());
        }
        existing.last_login_at = now;
    } else {
        let created = created_at
            .filter(|v| !v.trim().is_empty())
            .map(|v| v.to_string())
            .unwrap_or_else(|| now.clone());
        state.accounts.push(AccountIdentity {
            id: account_id.clone(),
            provider: provider.to_string(),
            provider_user_id: provider_user_id.to_string(),
            name: name.to_string(),
            email: email.unwrap_or_default().to_string(),
            avatar_url: avatar_url.unwrap_or_default().to_string(),
            profile_url: profile_url.unwrap_or_default().to_string(),
            created_at: created,
            last_login_at: now,
        });
    }
    state.active_account_id = Some(account_id.clone());
    write_state(&state)?;
    Ok(account_id)
}

fn chrono_like_now_unix() -> i64 {
    let now = SystemTime::now();
    let d = now
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0));
    d.as_secs() as i64
}

fn unix_to_rfc3339(sec: i64) -> String {
    let dt =
        time::OffsetDateTime::from_unix_timestamp(sec).unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    dt.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}
