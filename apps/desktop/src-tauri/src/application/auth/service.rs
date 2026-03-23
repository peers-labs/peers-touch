use super::auth_domain::{issue_session, validate_token, AuthDomainError, AuthSession};
use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{AuthLoginInput, AuthValidateTokenInput, StubPayload};
use crate::state::{AppState, SessionState};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use tauri::State;

pub fn auth_login(input: AuthLoginInput, state: &State<AppState>) -> AppResult<StubPayload> {
    let session = match issue_session(&input.account, &input.password) {
        Ok(session) => session,
        Err(error) => return map_domain_error(error),
    };
    if let Err(error) = write_session(state, &session) {
        return error;
    }
    if let Err(error) = persist_session(&session) {
        return error;
    }
    AppResult::success(StubPayload {
        command: "auth_login".to_string(),
        status: "authenticated".to_string(),
    })
}

pub fn auth_logout(state: &State<AppState>) -> AppResult<StubPayload> {
    if let Err(error) = clear_session(state) {
        return error;
    }
    if let Err(error) = clear_persisted_session() {
        return error;
    }
    AppResult::success(StubPayload {
        command: "auth_logout".to_string(),
        status: "logged_out".to_string(),
    })
}

pub fn auth_restore_session(state: &State<AppState>) -> AppResult<StubPayload> {
    let mut snapshot = match read_session(state) {
        Ok(snapshot) => snapshot,
        Err(error) => return error,
    };
    if snapshot.token.is_none() {
        snapshot = read_persisted_session().unwrap_or(snapshot);
    }
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
    AppResult::success(StubPayload {
        command: "auth_restore_session".to_string(),
        status: "restored".to_string(),
    })
}

pub fn auth_validate_token(input: AuthValidateTokenInput, state: &State<AppState>) -> AppResult<StubPayload> {
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
    AppResult::success(StubPayload {
        command: "auth_validate_token".to_string(),
        status: "valid".to_string(),
    })
}

fn read_session(state: &State<AppState>) -> Result<SessionState, AppResult<StubPayload>> {
    let guard = state.session.lock().map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "failed to access session state",
            Some(json!({ "reason": "session_lock_failed" })),
        )
    })?;
    Ok(SessionState {
        actor_id: guard.actor_id.clone(),
        token: guard.token.clone(),
    })
}

fn write_session(state: &State<AppState>, session: &AuthSession) -> Result<(), AppResult<StubPayload>> {
    let mut guard = state.session.lock().map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "failed to update session state",
            Some(json!({ "reason": "session_lock_failed" })),
        )
    })?;
    guard.actor_id = Some(session.actor_id.clone());
    guard.token = Some(session.token.clone());
    Ok(())
}

fn clear_session(state: &State<AppState>) -> Result<(), AppResult<StubPayload>> {
    let mut guard = state.session.lock().map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "failed to clear session state",
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

fn persist_session(session: &AuthSession) -> Result<(), AppResult<StubPayload>> {
    let file_path = persisted_session_file();
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|_| {
            AppResult::fail(
                ErrorCode::InternalError,
                "failed to persist session",
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
            "failed to encode session",
            Some(json!({ "reason": "session_serialize_failed" })),
        )
    })?;
    fs::write(file_path, payload).map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "failed to persist session",
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

fn clear_persisted_session() -> Result<(), AppResult<StubPayload>> {
    let file_path = persisted_session_file();
    if !file_path.exists() {
        return Ok(());
    }
    fs::remove_file(file_path).map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "failed to clear persisted session",
            Some(json!({ "reason": "session_remove_failed" })),
        )
    })
}

fn persisted_session_file() -> PathBuf {
    std::env::temp_dir()
        .join("peers-touch")
        .join("desktop")
        .join("auth-session.json")
}

fn map_domain_error(error: AuthDomainError) -> AppResult<StubPayload> {
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

fn unauthorized(message: impl Into<String>, details: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::Unauthorized, message, Some(details))
}
