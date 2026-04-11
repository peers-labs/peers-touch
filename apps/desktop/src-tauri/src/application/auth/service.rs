use crate::domain::auth::session::{validate_login_input, from_station_response, validate_token, AuthDomainError, AuthSession};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::storage::{self, StorageKind};
use crate::infrastructure::station_client;
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
        Err(e) => return AppResult::fail(ErrorCode::Unauthorized, "error.auth.loginFailed", Some(json!({ "detail": e.to_string() }))),
    };

    let data = match resp.get("data") {
        Some(d) => d,
        None => return AppResult::fail(ErrorCode::Unauthorized, "error.auth.unexpectedResponse", None),
    };

    let token = data
        .pointer("/tokens/access_token")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if token.is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "error.auth.noToken", None);
    }

    // Extract actor identity from the station response
    let actor_id = data
        .pointer("/actor/id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let name = data
        .pointer("/actor/name")
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

    let session = from_station_response(actor_id.clone(), token);
    if let Err(error) = write_session(state, &session) {
        return error;
    }
    if let Err(error) = persist_session(&session) {
        return error;
    }

    AppResult::success(AuthSessionPayload {
        command: "auth_login".to_string(),
        status: "authenticated".to_string(),
        actor_id: Some(actor_id),
        name: Some(name),
        email: Some(email_str),
        avatar_url: Some(avatar),
        login_method: Some("password".to_string()),
    })
}

pub fn auth_logout(state: &AppState) -> AppResult<AuthSessionPayload> {
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
    AppResult::success(AuthSessionPayload {
        command: "auth_restore_session".to_string(),
        status: "restored".to_string(),
        actor_id: Some(session.actor_id.clone()),
        name: None,
        email: None,
        avatar_url: None,
        login_method: None,
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
        login_method: None,
    })
}

fn read_session(state: &AppState) -> Result<SessionState, AppResult<AuthSessionPayload>> {
    let guard = state.session.lock().map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "error.auth.sessionLockFailed",
            Some(json!({ "reason": "session_lock_failed" })),
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
            "error.auth.sessionLockFailed",
            Some(json!({ "reason": "session_lock_failed" })),
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
            "error.auth.sessionLockFailed",
            Some(json!({ "reason": "session_lock_failed" })),
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
                "error.auth.sessionPersistFailed",
                Some(json!({ "reason": "session_directory_create_failed" })),
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
            "error.auth.sessionPersistFailed",
            Some(json!({ "reason": "session_serialize_failed" })),
        )
    })?;
    storage::write_string_atomic(&file_path, &payload).map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "error.auth.sessionPersistFailed",
            Some(json!({ "reason": "session_write_failed" })),
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
            "error.auth.sessionClearFailed",
            Some(json!({ "reason": "session_remove_failed" })),
        )
    })
}

fn persisted_session_file() -> PathBuf {
    storage::app_file_path("desktop", StorageKind::Temp, &["auth", "session.json"]).unwrap_or_else(
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

/// Load the Station JWT that was persisted by `save_oauth_callback`
/// (via the oauth-bridge call) and write it into AppState so the BFF
/// session is immediately active without requiring an app restart.
pub fn ensure_station_session(state: &AppState) -> AppResult<AuthSessionPayload> {
    let (actor_id, token) = match application_oauth2::read_station_session() {
        Some(pair) => pair,
        None => {
            return AppResult::fail(
                ErrorCode::NotFound,
                "error.auth.sessionNotFound",
                Some(json!({ "command": "ensure_station_session", "reason": "session_missing" })),
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

    AppResult::success(AuthSessionPayload {
        command: "ensure_station_session".to_string(),
        status: "ok".to_string(),
        actor_id: Some(actor_id),
        name: None,
        email: None,
        avatar_url: None,
        login_method: Some("oauth".to_string()),
    })
}
