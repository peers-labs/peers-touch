use crate::domain::pin_lock::{self, EncryptedSession, PinProtection};
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
    /// PIN protection metadata (None = no PIN set for this account).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin_protection: Option<PinProtection>,
    /// Encrypted session token (None = no saved session).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted_session: Option<EncryptedSession>,
    /// Whether this account has an active (restorable) session, regardless of PIN.
    #[serde(default)]
    pub has_session: bool,
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
            pin_protection: None,
            encrypted_session: None,
            has_session: false,
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

/// Persist a password-login identity into `identities.json`, mirroring what
/// `upsert_oauth` does for OAuth providers.  Sets the account as active and
/// returns the canonical `account_id` (`password:<actor_id>`).
pub fn upsert_password(
    actor_id: &str,
    name: &str,
    email: &str,
    avatar_url: Option<&str>,
) -> Result<String, String> {
    let mut state = read_state()?;
    let account_id = format!("password:{}", actor_id);
    let now = unix_to_rfc3339(chrono_like_now_unix());
    if let Some(existing) = state.accounts.iter_mut().find(|item| item.id == account_id) {
        if !name.is_empty() {
            existing.name = name.to_string();
        }
        if !email.is_empty() {
            existing.email = email.to_string();
        }
        if let Some(url) = avatar_url.filter(|v| !v.is_empty()) {
            existing.avatar_url = url.to_string();
        }
        existing.last_login_at = now;
    } else {
        state.accounts.push(AccountIdentity {
            id: account_id.clone(),
            provider: "password".to_string(),
            provider_user_id: actor_id.to_string(),
            name: name.to_string(),
            email: email.to_string(),
            avatar_url: avatar_url.unwrap_or_default().to_string(),
            profile_url: String::new(),
            created_at: now.clone(),
            last_login_at: now,
            pin_protection: None,
            encrypted_session: None,
            has_session: false,
        });
    }
    state.active_account_id = Some(account_id.clone());
    write_state(&state)?;
    Ok(account_id)
}

/// Look up an account profile by `actor_id`.
/// Search order: password account (`password:<actor_id>`) → active account → first account.
pub fn find_profile_by_actor_id(actor_id: &str) -> Option<AccountIdentity> {
    let state = read_state().ok()?;
    // First try password account
    if let Some(acc) = state
        .accounts
        .iter()
        .find(|a| a.id == format!("password:{}", actor_id))
    {
        return Some(acc.clone());
    }
    // Then try active account
    if let Some(active_id) = &state.active_account_id {
        if let Some(acc) = state.accounts.iter().find(|a| &a.id == active_id) {
            return Some(acc.clone());
        }
    }
    // Fallback to first account
    state.accounts.first().cloned()
}

/// Update the avatar URL for the currently active account identity.
/// Called after uploading a new avatar to Station, so the sidebar avatar stays in sync.
pub fn update_active_avatar(avatar_url: &str) -> Result<(), String> {
    let mut state = read_state()?;
    if let Some(active_id) = &state.active_account_id {
        if let Some(account) = state.accounts.iter_mut().find(|a| &a.id == active_id) {
            account.avatar_url = avatar_url.to_string();
            write_state(&state)?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// PIN protection & per-account encrypted session management
// ---------------------------------------------------------------------------

/// Set a PIN for an account. Encrypts the current session token (if provided) with the PIN.
pub fn set_account_pin(
    account_id: &str,
    pin: &str,
    current_token: Option<&str>,
) -> Result<(), String> {
    let mut state = read_state()?;
    let account = state
        .accounts
        .iter_mut()
        .find(|a| a.id == account_id)
        .ok_or_else(|| format!("account not found: {account_id}"))?;

    let protection = pin_lock::create_pin_protection(pin)?;

    if let Some(token) = current_token {
        let encrypted = pin_lock::encrypt_session(pin, &protection.enc_salt, account_id, token)?;
        account.encrypted_session = Some(encrypted);
        account.has_session = true;
    }

    account.pin_protection = Some(protection);
    write_state(&state)
}

/// Save an encrypted session for an account that already has a PIN set.
pub fn save_encrypted_session(account_id: &str, pin: &str, token: &str) -> Result<(), String> {
    let mut state = read_state()?;
    let account = state
        .accounts
        .iter_mut()
        .find(|a| a.id == account_id)
        .ok_or_else(|| format!("account not found: {account_id}"))?;

    let protection = account
        .pin_protection
        .as_ref()
        .ok_or_else(|| "no PIN set for this account".to_string())?;

    let encrypted = pin_lock::encrypt_session(pin, &protection.enc_salt, account_id, token)?;
    account.encrypted_session = Some(encrypted);
    account.has_session = true;
    write_state(&state)
}

/// Verify PIN and decrypt the stored session token for an account.
pub fn unlock_account_session(
    account_id: &str,
    pin: &str,
) -> Result<String, pin_lock::PinVerifyError> {
    let mut state = read_state().map_err(|e| pin_lock::PinVerifyError::Internal(e))?;
    let account = state
        .accounts
        .iter_mut()
        .find(|a| a.id == account_id)
        .ok_or_else(|| {
            pin_lock::PinVerifyError::Internal(format!("account not found: {account_id}"))
        })?;

    let protection = account
        .pin_protection
        .as_mut()
        .ok_or_else(|| pin_lock::PinVerifyError::Internal("no PIN set".to_string()))?;

    pin_lock::verify_pin(pin, protection)?;

    // Persist updated failure counters (reset on success)
    let _ = write_state(&state);

    // Re-read for decryption (ownership was moved)
    let state = read_state().map_err(|e| pin_lock::PinVerifyError::Internal(e))?;
    let account = state
        .accounts
        .iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| pin_lock::PinVerifyError::Internal("account disappeared".to_string()))?;

    let encrypted = account
        .encrypted_session
        .as_ref()
        .ok_or_else(|| pin_lock::PinVerifyError::Internal("no encrypted session".to_string()))?;

    let enc_salt = account
        .pin_protection
        .as_ref()
        .map(|p| p.enc_salt.as_str())
        .unwrap_or("");

    pin_lock::decrypt_session(pin, enc_salt, encrypted)
        .map_err(|e| pin_lock::PinVerifyError::Internal(e))
}

/// Clear stored session for an account (e.g. on explicit logout).
pub fn clear_account_session(account_id: &str) -> Result<(), String> {
    let mut state = read_state()?;
    if let Some(account) = state.accounts.iter_mut().find(|a| a.id == account_id) {
        account.encrypted_session = None;
        account.has_session = false;
    }
    write_state(&state)
}

/// List all accounts that have a saved session (for the account picker).
pub fn list_restorable_accounts() -> Result<Vec<AccountIdentity>, String> {
    let state = read_state()?;
    // Return all known accounts so the account picker shows every user
    // that has ever logged in. The frontend handles expired sessions by
    // redirecting to the login form instead of PIN entry.
    Ok(state.accounts)
}
