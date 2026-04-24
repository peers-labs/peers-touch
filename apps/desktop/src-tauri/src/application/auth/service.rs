use crate::domain::auth::session::{validate_login_input, from_station_response, validate_token, AuthDomainError, AuthSession};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::storage::{self, StorageKind};
use crate::infrastructure::station_client;
use crate::model::actor::ActorProfile;
use crate::application::oauth2 as application_oauth2;
use crate::contracts::{AuthLoginInput, AuthSessionPayload, AuthValidateTokenInput};
use crate::state::{AppState, SessionState};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;

pub fn auth_login(input: AuthLoginInput, state: &AppState) -> AppResult<AuthSessionPayload> {
    if let Err(error) = validate_login_input(&input.account, &input.password) {
        return map_domain_error(error);
    }

    let body = json!({ "email": input.account, "password": input.password });
    let resp = match station_client::post_json_no_auth("/actor/login", body) {
        Ok(r) => r,
        Err(e) => return AppResult::fail(ErrorCode::Unauthorized, format!("Login failed: {}", e), None),
    };

    let data = match resp.get("data") {
        Some(d) => d,
        None => return AppResult::fail(ErrorCode::Unauthorized, "Login failed: unexpected response from station", None),
    };

    let token = data
        .pointer("/tokens/access_token")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if token.is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "Login failed: no token in response", None);
    }

    // Extract actor identity from the station response
    let actor_id = data
        .pointer("/actor/id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let name = data
        .pointer("/actor/display_name")
        .or_else(|| data.pointer("/actor/name"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let email_str = data
        .pointer("/actor/email")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let avatar = data
        .pointer("/actor/icon")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    // Station login response may not include avatar; fetch from profile API.
    let avatar = if avatar.is_empty() && !token.is_empty() {
        station_client::request_peers_proto_no_body::<ActorProfile>(
            reqwest::Method::GET,
            "/actor/profile",
            &token,
            None,
        )
        .ok()
        .map(|p| p.avatar)
        .filter(|s| !s.is_empty())
        .unwrap_or(avatar)
    } else {
        avatar
    };

    let session = from_station_response(actor_id.clone(), token);
    if let Err(error) = write_session(state, &session) {
        return error;
    }
    if let Err(error) = persist_session(&session) {
        return error;
    }

    let _ = crate::infrastructure::auth_identity::upsert_password(
        &actor_id,
        &name,
        &email_str,
        if avatar.is_empty() { None } else { Some(avatar.as_str()) },
    );

    // Mark session as restorable (will be encrypted once PIN is set)
    mark_account_has_session(&format!("password:{}", actor_id), &session.token);

    AppResult::success(AuthSessionPayload {
        command: "auth_login".to_string(),
        status: "authenticated".to_string(),
        actor_id: Some(actor_id),
        name: Some(name),
        email: Some(email_str),
        avatar_url: Some(avatar),
        avatar_local_path: None,
        login_method: Some("password".to_string()),
    })
}

pub fn auth_logout(state: &AppState) -> AppResult<AuthSessionPayload> {
    // Clear encrypted session for the active account
    let active_account_id = crate::infrastructure::auth_identity::read_state()
        .ok()
        .and_then(|s| s.active_account_id);
    if let Some(ref account_id) = active_account_id {
        let _ = crate::infrastructure::auth_identity::clear_account_session(account_id);
    }

    if let Err(error) = clear_session(state) {
        return error;
    }
    if let Err(error) = clear_persisted_session() {
        return error;
    }
    AppResult::success(AuthSessionPayload {
        command: "auth_logout".to_string(),
        status: "logged_out".to_string(),
        actor_id: None,
        name: None,
        email: None,
        avatar_url: None,
        avatar_local_path: None,
        login_method: None,
    })
}

pub fn auth_restore_session(state: &AppState) -> AppResult<AuthSessionPayload> {
    let mut snapshot = match read_session(state) {
        Ok(snapshot) => snapshot,
        Err(error) => return error,
    };
    if snapshot.token.is_none() {
        snapshot = read_persisted_session().unwrap_or(snapshot);
    }

    // Restore only from memory or disk. No OAuth bridge fallback.
    let token = match snapshot.token {
        Some(token) => token,
        None => {
            return unauthorized(
                "missing session",
                json!({ "command": "auth_restore_session", "reason": "session_missing" }),
            )
        }
    };
    let session = match validate_token(&token) {
        Ok(session) => session,
        Err(error) => {
            let _ = clear_session(state);
            return map_domain_error(error);
        }
    };
    if let Err(error) = write_session(state, &session) {
        return error;
    }
    if let Err(error) = persist_session(&session) {
        return error;
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
    AppResult::success(AuthSessionPayload {
        command: "auth_restore_session".to_string(),
        status: "restored".to_string(),
        actor_id: Some(session.actor_id.clone()),
        name: p_name,
        email: p_email,
        avatar_url: p_avatar,
        avatar_local_path: p_local_avatar,
        login_method: p_method,
    })
}

pub fn auth_validate_token(
    input: AuthValidateTokenInput,
    state: &AppState,
) -> AppResult<AuthSessionPayload> {
    let token = match input.token {
        Some(token) if !token.trim().is_empty() => token,
        _ => {
            let snapshot = match read_session(state) {
                Ok(snapshot) => snapshot,
                Err(error) => return error,
            };
            match snapshot.token {
                Some(token) if !token.trim().is_empty() => token,
                _ => {
                    return unauthorized(
                        "missing token",
                        json!({ "command": "auth_validate_token", "reason": "token_missing" }),
                    )
                }
            }
        }
    };
    let session = match validate_token(&token) {
        Ok(session) => session,
        Err(error) => {
            let _ = clear_session(state);
            return map_domain_error(error);
        }
    };
    if let Err(error) = write_session(state, &session) {
        return error;
    }
    if let Err(error) = persist_session(&session) {
        return error;
    }
    AppResult::success(AuthSessionPayload {
        command: "auth_validate_token".to_string(),
        status: "valid".to_string(),
        actor_id: Some(session.actor_id.clone()),
        name: None,
        email: None,
        avatar_url: None,
        avatar_local_path: None,
        login_method: None,
    })
}

fn read_session(state: &AppState) -> Result<SessionState, AppResult<AuthSessionPayload>> {
    let guard = state.session.lock().map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "Failed to access session state",
            None,
        )
    })?;
    Ok(SessionState {
        actor_id: guard.actor_id.clone(),
        token: guard.token.clone(),
    })
}

fn write_session(
    state: &AppState,
    session: &AuthSession,
) -> Result<(), AppResult<AuthSessionPayload>> {
    let mut guard = state.session.lock().map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "Failed to access session state",
            None,
        )
    })?;
    guard.actor_id = Some(session.actor_id.clone());
    guard.token = Some(session.token.clone());
    Ok(())
}

fn clear_session(state: &AppState) -> Result<(), AppResult<AuthSessionPayload>> {
    let mut guard = state.session.lock().map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "Failed to access session state",
            None,
        )
    })?;
    guard.actor_id = None;
    guard.token = None;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedSession {
    actor_id: String,
    token: String,
}

fn persist_session(session: &AuthSession) -> Result<(), AppResult<AuthSessionPayload>> {
    let file_path = persisted_session_file();
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|_| {
            AppResult::fail(
                ErrorCode::InternalError,
                "Failed to persist session: could not create directory",
                None,
            )
        })?;
    }
    let payload = serde_json::to_string(&PersistedSession {
        actor_id: session.actor_id.clone(),
        token: session.token.clone(),
    })
    .map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "Failed to persist session: serialization error",
            None,
        )
    })?;
    storage::write_string_atomic(&file_path, &payload).map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "Failed to persist session: write error",
            None,
        )
    })
}

fn read_persisted_session() -> Option<SessionState> {
    let file_path = persisted_session_file();
    let raw = fs::read_to_string(file_path).ok()?;
    let persisted = serde_json::from_str::<PersistedSession>(&raw).ok()?;
    Some(SessionState {
        actor_id: Some(persisted.actor_id),
        token: Some(persisted.token),
    })
}

fn clear_persisted_session() -> Result<(), AppResult<AuthSessionPayload>> {
    let file_path = persisted_session_file();
    if !file_path.exists() {
        return Ok(());
    }
    fs::remove_file(file_path).map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "Failed to clear session",
            None,
        )
    })
}

fn persisted_session_file() -> PathBuf {
    // Use Data storage for persistence across reboots; Temp is cleared by the OS.
    storage::app_file_path("desktop", StorageKind::Data, &["auth", "session.json"]).unwrap_or_else(
        |_| {
            std::env::temp_dir()
                .join("peers-touch")
                .join("desktop")
                .join("auth-session.json")
        },
    )
}

fn map_domain_error(error: AuthDomainError) -> AppResult<AuthSessionPayload> {
    match error {
        AuthDomainError::InvalidArgument(message) => AppResult::fail(
            ErrorCode::InvalidArgument,
            message,
            Some(json!({ "command": "auth" })),
        ),
        AuthDomainError::Unauthorized(message) => unauthorized(
            message,
            json!({ "command": "auth", "reason": "token_invalid_or_expired" }),
        ),
    }
}

fn unauthorized(message: impl Into<String>, details: serde_json::Value) -> AppResult<AuthSessionPayload> {
    AppResult::fail(ErrorCode::Unauthorized, message, Some(details))
}

/// Mark account as having a restorable session; if PIN is set, encrypt the token.
fn mark_account_has_session(account_id: &str, token: &str) {
    if let Ok(state) = crate::infrastructure::auth_identity::read_state() {
        if let Some(account) = state.accounts.iter().find(|a| a.id == account_id) {
            if account.pin_protection.is_some() {
                // Account has PIN: we can't encrypt without the PIN, but mark as having session.
                // The token will be encrypted next time the user provides their PIN.
                let mut s = state.clone();
                if let Some(a) = s.accounts.iter_mut().find(|a| a.id == account_id) {
                    a.has_session = true;
                }
                let _ = crate::infrastructure::auth_identity::write_state(&s);
            } else {
                // No PIN: mark as having session (plaintext fallback via legacy session.json)
                let mut s = state.clone();
                if let Some(a) = s.accounts.iter_mut().find(|a| a.id == account_id) {
                    a.has_session = true;
                }
                let _ = crate::infrastructure::auth_identity::write_state(&s);
            }
        }
    }
}

/// Load the Station JWT that was persisted by `save_oauth_callback`
/// (via the oauth-bridge call) and write it into AppState so the BFF
/// session is immediately active without requiring an app restart.
pub fn ensure_station_session(state: &AppState) -> AppResult<AuthSessionPayload> {
    let (actor_id, token) = match application_oauth2::read_station_session() {
        Some(pair) => pair,
        None => {
            return AppResult::fail(
                ErrorCode::NotFound,
                "No station session found to restore",
                None,
            )
        }
    };

    let session = from_station_response(actor_id.clone(), token);
    if let Err(error) = write_session(state, &session) {
        return error;
    }
    if let Err(error) = persist_session(&session) {
        return error;
    }

    let profile = crate::infrastructure::auth_identity::find_profile_by_actor_id(&actor_id);
    let (p_name, p_email, p_avatar) = match &profile {
        Some(p) => (
            Some(p.name.clone()).filter(|v| !v.is_empty()),
            Some(p.email.clone()).filter(|v| !v.is_empty()),
            Some(p.avatar_url.clone()).filter(|v| !v.is_empty()),
        ),
        None => (None, None, None),
    };

    // Find the OAuth account ID from identities for session marking
    if let Ok(id_state) = crate::infrastructure::auth_identity::read_state() {
        if let Some(active_id) = &id_state.active_account_id {
            mark_account_has_session(active_id, &session.token);
        }
    }

    AppResult::success(AuthSessionPayload {
        command: "ensure_station_session".to_string(),
        status: "authenticated".to_string(),
        actor_id: Some(actor_id),
        name: p_name,
        email: p_email,
        avatar_url: p_avatar,
        avatar_local_path: None,
        login_method: Some("oauth".to_string()),
    })
}
