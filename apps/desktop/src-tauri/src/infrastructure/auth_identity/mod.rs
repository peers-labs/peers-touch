use crate::domain::auth::session::validate_token;
use crate::domain::pin_lock::{self, EncryptedSession, PinProtection};
use crate::infrastructure::avatar_cache;
use crate::infrastructure::local_scope;
use crate::infrastructure::storage::{self, StorageKind};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
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
    pub actor_ptid: String,
    pub provider: String,
    pub provider_user_id: String,
    pub name: String,
    pub email: String,
    pub avatar_url: String,
    /// Local file path for cached avatar image (relative to storage root).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_local_path: Option<String>,
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
    /// Cleartext expiry epoch (seconds) of the encrypted session token.
    /// Used by the account picker to detect expired sessions without requiring PIN decryption.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_expires_at: Option<u64>,
    /// Whether this account has an active (restorable) session, regardless of PIN.
    #[serde(default)]
    pub has_session: bool,
}

fn token_actor_ptid(token: &str) -> Result<String, String> {
    let session =
        validate_token(token).map_err(|_| "session token is invalid or expired".to_string())?;
    if session.actor_ptid.trim().is_empty() {
        return Err("session token is missing its actor subject".to_string());
    }
    Ok(session.actor_ptid)
}

fn encrypted_session_actor_ptid(
    encrypted: &EncryptedSession,
) -> Result<&str, pin_lock::PinVerifyError> {
    let actor_ptid = encrypted.actor_ptid.trim();
    if actor_ptid.is_empty() {
        return Err(pin_lock::PinVerifyError::ActorBindingMissing);
    }
    Ok(actor_ptid)
}

pub fn account_identity_path() -> Result<PathBuf, String> {
    let station_scope = crate::infrastructure::local_scope::active_station_scope();
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["account", &station_scope, "identities.json"],
    )
    .map_err(|err| format!("failed to resolve account identity path: {err:?}"))
}

pub fn read_state() -> Result<AccountIdentityState, String> {
    let path = account_identity_path()?;
    if !path.exists() {
        return Ok(AccountIdentityState::default());
    }
    let text =
        fs::read_to_string(&path).map_err(|err| format!("failed to read account state: {err}"))?;
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
    actor_ptid: &str,
    provider: &str,
    provider_user_id: &str,
    name: &str,
    created_at: Option<&str>,
    email: Option<&str>,
    avatar_url: Option<&str>,
    profile_url: Option<&str>,
) -> Result<String, String> {
    upsert_oauth_state(
        actor_ptid,
        provider,
        provider_user_id,
        name,
        false,
        created_at,
        email,
        avatar_url,
        profile_url,
    )
}

pub fn upsert_oauth_with_session(
    actor_ptid: &str,
    provider: &str,
    provider_user_id: &str,
    name: &str,
    created_at: Option<&str>,
    email: Option<&str>,
    avatar_url: Option<&str>,
    profile_url: Option<&str>,
) -> Result<String, String> {
    upsert_oauth_state(
        actor_ptid,
        provider,
        provider_user_id,
        name,
        true,
        created_at,
        email,
        avatar_url,
        profile_url,
    )
}

fn upsert_oauth_state(
    actor_ptid: &str,
    provider: &str,
    provider_user_id: &str,
    name: &str,
    has_session: bool,
    created_at: Option<&str>,
    email: Option<&str>,
    avatar_url: Option<&str>,
    profile_url: Option<&str>,
) -> Result<String, String> {
    if !actor_ptid.trim().starts_with("ptid:") {
        return Err("canonical actor PTID is required".to_string());
    }
    let mut state = read_state()?;
    let account_id = oauth_account_id(provider, provider_user_id);
    let now = unix_to_rfc3339(chrono_like_now_unix());
    if let Some(existing) = state.accounts.iter_mut().find(|item| item.id == account_id) {
        existing.actor_ptid = actor_ptid.to_string();
        existing.name = name.to_string();
        existing.email = email.unwrap_or_default().to_string();
        existing.avatar_url = avatar_url.unwrap_or_default().to_string();
        existing.profile_url = profile_url.unwrap_or_default().to_string();
        existing.has_session = has_session;
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
            actor_ptid: actor_ptid.to_string(),
            provider: provider.to_string(),
            provider_user_id: provider_user_id.to_string(),
            name: name.to_string(),
            email: email.unwrap_or_default().to_string(),
            avatar_url: avatar_url.unwrap_or_default().to_string(),
            avatar_local_path: None,
            profile_url: profile_url.unwrap_or_default().to_string(),
            created_at: created,
            last_login_at: now,
            pin_protection: None,
            encrypted_session: None,
            session_expires_at: None,
            has_session,
        });
    }
    if has_session {
        for account in &mut state.accounts {
            if account.id != account_id && account.pin_protection.is_none() {
                account.has_session = false;
            }
        }
    }
    state.active_account_id = Some(account_id.clone());
    write_state(&state)?;
    Ok(account_id)
}

pub fn oauth_account_id(provider: &str, provider_user_id: &str) -> String {
    let station_scope = local_scope::active_station_scope();
    let provider_scope = storage::sanitize_storage_segment(provider);
    let provider_user_scope = storage::sanitize_storage_segment(provider_user_id);
    format!("station:{station_scope}:{provider_scope}:{provider_user_scope}")
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
/// returns the canonical station-scoped `account_id`.
pub fn upsert_password(
    actor_ptid: &str,
    name: &str,
    email: &str,
    avatar_url: Option<&str>,
) -> Result<String, String> {
    if !actor_ptid.trim().starts_with("ptid:") {
        return Err("canonical actor PTID is required".to_string());
    }
    let mut state = read_state()?;
    let account_id = local_scope::account_id_for_password_ptid(actor_ptid);
    let now = unix_to_rfc3339(chrono_like_now_unix());
    if let Some(existing) = state.accounts.iter_mut().find(|item| item.id == account_id) {
        existing.actor_ptid = actor_ptid.to_string();
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
            actor_ptid: actor_ptid.to_string(),
            provider: "password".to_string(),
            provider_user_id: actor_ptid.to_string(),
            name: name.to_string(),
            email: email.to_string(),
            avatar_url: avatar_url.unwrap_or_default().to_string(),
            avatar_local_path: None,
            profile_url: String::new(),
            created_at: now.clone(),
            last_login_at: now,
            pin_protection: None,
            encrypted_session: None,
            session_expires_at: None,
            has_session: false,
        });
    }
    state.active_account_id = Some(account_id.clone());
    write_state(&state)?;
    Ok(account_id)
}

pub fn find_profile_by_actor_ptid(actor_ptid: &str) -> Option<AccountIdentity> {
    let state = read_state().ok()?;
    state
        .accounts
        .into_iter()
        .find(|account| account.actor_ptid == actor_ptid)
}

/// Resolve the canonical `account_id` (e.g. `password:123`, `github:456`) for a
/// Station `actor_ptid`. Used by token-bound writers (profile sync, avatar sync)
/// to pick the correct LocalAccount record without trusting the volatile
/// `active_account_id` pointer.
///
/// Search order:
/// 1. The station-scoped password account.
/// 2. The currently-active account, if its `provider_user_id` matches.
/// 3. `None` if no active-station record holds this actor.
pub fn find_account_id_by_actor_ptid(actor_ptid: &str) -> Option<String> {
    if !actor_ptid.trim().starts_with("ptid:") {
        return None;
    }
    let state = read_state().ok()?;
    state
        .accounts
        .into_iter()
        .find(|account| account.actor_ptid == actor_ptid)
        .map(|account| account.id)
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
        let actor_ptid = token_actor_ptid(token)?;
        if actor_ptid != account.actor_ptid {
            return Err("session actor PTID does not match the selected account".to_string());
        }
        let encrypted =
            pin_lock::encrypt_session(pin, &protection.enc_salt, account_id, &actor_ptid, token)?;
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

    let actor_ptid = token_actor_ptid(token)?;
    if actor_ptid != account.actor_ptid {
        return Err("session actor PTID does not match the selected account".to_string());
    }
    let encrypted =
        pin_lock::encrypt_session(pin, &protection.enc_salt, account_id, &actor_ptid, token)?;
    account.encrypted_session = Some(encrypted);
    account.session_expires_at = extract_jwt_exp(token);
    account.has_session = true;
    write_state(&state)
}

/// Verify an account PIN without requiring an existing encrypted session.
/// Used after a fresh password/OAuth login to re-encrypt the new token under
/// the user's already-configured PIN.
pub fn verify_account_pin(account_id: &str, pin: &str) -> Result<(), pin_lock::PinVerifyError> {
    let mut state = read_state().map_err(pin_lock::PinVerifyError::Internal)?;
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
    write_state(&state).map_err(pin_lock::PinVerifyError::Internal)
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
    if encrypted.account_id != account_id {
        return Err(pin_lock::PinVerifyError::Internal(
            "encrypted session account does not match the selected account".to_string(),
        ));
    }
    let encrypted_actor_ptid = encrypted_session_actor_ptid(encrypted)?;
    if encrypted_actor_ptid != account.actor_ptid {
        return Err(pin_lock::PinVerifyError::Internal(
            "encrypted session actor PTID does not match the selected account".to_string(),
        ));
    }

    let enc_salt = account
        .pin_protection
        .as_ref()
        .map(|p| p.enc_salt.as_str())
        .unwrap_or("");

    let token = pin_lock::decrypt_session(pin, enc_salt, encrypted)
        .map_err(pin_lock::PinVerifyError::Internal)?;
    let token_actor_ptid = token_actor_ptid(&token).map_err(pin_lock::PinVerifyError::Internal)?;
    if token_actor_ptid != encrypted_actor_ptid {
        return Err(pin_lock::PinVerifyError::Internal(
            "decrypted session actor PTID does not match its persisted binding".to_string(),
        ));
    }
    Ok(token)
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

/// Remove PIN protection from an account after verifying the current PIN.
/// Also clears any encrypted session since it can no longer be decrypted without a PIN.
pub fn remove_account_pin(account_id: &str, pin: &str) -> Result<(), String> {
    // First verify the PIN (updates failure counters on the state)
    {
        let mut state = read_state()?;
        let account = state
            .accounts
            .iter_mut()
            .find(|a| a.id == account_id)
            .ok_or_else(|| format!("account not found: {account_id}"))?;

        let protection = account
            .pin_protection
            .as_mut()
            .ok_or_else(|| "no PIN set for this account".to_string())?;

        pin_lock::verify_pin(pin, protection).map_err(|e| match e {
            pin_lock::PinVerifyError::WrongPin { attempts_remaining } => {
                format!("incorrect PIN ({attempts_remaining} attempts remaining)")
            }
            pin_lock::PinVerifyError::LockedOut { remaining_secs } => {
                format!("account locked, retry in {remaining_secs}s")
            }
            pin_lock::PinVerifyError::ActorBindingMissing => {
                "encrypted session has no persisted actor binding".to_string()
            }
            pin_lock::PinVerifyError::Internal(msg) => msg,
        })?;

        // Persist updated failure counters (reset on success)
        write_state(&state)?;
    }

    // Re-read and strip PIN + encrypted session
    let mut state = read_state()?;
    if let Some(account) = state.accounts.iter_mut().find(|a| a.id == account_id) {
        account.pin_protection = None;
        account.encrypted_session = None;
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

// ---------------------------------------------------------------------------
// Avatar metadata sync
// ---------------------------------------------------------------------------
//
// File-level avatar I/O lives in `infrastructure::avatar_cache`. This module
// only persists the *metadata* (avatar_url + avatar_local_path) and delegates
// the actual download / lookup. Keeps identity-vs-cache boundaries clean.

/// Update the avatar_local_path for the currently active account.
pub fn update_active_avatar_local_path(local_path: &str) -> Result<(), String> {
    let mut state = read_state()?;
    if let Some(active_id) = &state.active_account_id {
        if let Some(account) = state.accounts.iter_mut().find(|a| &a.id == active_id) {
            account.avatar_local_path = Some(local_path.to_string());
            write_state(&state)?;
        }
    }
    Ok(())
}

/// Sync user profile metadata into `identities.json` and warm the avatar
/// cache (best-effort). Returns the cached avatar path if available.
pub fn sync_profile_locally(
    account_id: &str,
    name: Option<&str>,
    email: Option<&str>,
    avatar_url: Option<&str>,
    profile_url: Option<&str>,
) -> Result<Option<String>, String> {
    let mut state = read_state()?;
    let account = state
        .accounts
        .iter_mut()
        .find(|a| a.id == account_id)
        .ok_or_else(|| format!("account not found: {account_id}"))?;

    if let Some(n) = name.filter(|v| !v.is_empty()) {
        account.name = n.to_string();
    }
    if let Some(e) = email.filter(|v| !v.is_empty()) {
        account.email = e.to_string();
    }
    if let Some(p) = profile_url.filter(|v| !v.is_empty()) {
        account.profile_url = p.to_string();
    }

    let mut local_path: Option<String> = None;
    if let Some(url) = avatar_url.filter(|v| !v.is_empty()) {
        account.avatar_url = url.to_string();
        local_path = avatar_cache::try_ensure_local_string(url);
        account.avatar_local_path = local_path.clone();
    }

    write_state(&state)?;
    Ok(local_path)
}

/// Look up the cached avatar path for a given account. Returns `None` when
/// the metadata is missing or the on-disk file is not present.
pub fn get_avatar_local_path(account_id: &str) -> Option<String> {
    let state = read_state().ok()?;
    let account = state.accounts.iter().find(|a| a.id == account_id)?;
    let path_str = account.avatar_local_path.as_ref()?;
    let path = PathBuf::from(path_str);
    if path.exists() && path.metadata().map(|m| m.len() > 0).unwrap_or(false) {
        Some(path_str.clone())
    } else {
        None
    }
}

fn extract_jwt_exp(token: &str) -> Option<u64> {
    let payload_b64 = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload_b64).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    v.get("exp").and_then(|e| e.as_u64())
}
