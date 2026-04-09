use crate::domain::auth::session::{validate_login_input, from_station_response, validate_token, AuthDomainError, AuthSession};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::storage::{self, StorageKind};
use crate::infrastructure::station_client;
use crate::application::oauth2 as application_oauth2;
use crate::contracts::{AuthLoginInput, AuthValidateTokenInput, StubPayload};
use crate::state::{AppState, SessionState};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use tauri::State;

pub fn auth_login(input: AuthLoginInput, state: &State<AppState>) -> AppResult<StubPayload> {
    if let Err(error) = validate_login_input(&input.account, &input.password) {
        return map_domain_error(error);
    }

    let body = json!({ "email": input.account, "password": input.password });
    let resp = match station_client::post_json_no_auth("/actor/login", body) {
        Ok(r) => r,
        Err(e) => return AppResult::fail(ErrorCode::Unauthorized, &e, None),
    };

    let data = match resp.get("data") {
        Some(d) => d,
        None => return AppResult::fail(ErrorCode::Unauthorized, "unexpected response from station", None),
    };

    let token = data
        .pointer("/tokens/access_token")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if token.is_empty() {
        return AppResult::fail(ErrorCode::Unauthorized, "no token in station response", None);
    }

    let actor_id = data
        .pointer("/actor/id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let session = from_station_response(actor_id, token);
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
    if snapshot.token.is_none() {
        if let Some((actor_id, token)) = application_oauth2::read_station_session() {
            snapshot = SessionState {
                actor_id: Some(actor_id),
                token: Some(token),
            };
        }
    }
    if snapshot.token.is_none() {
        if let Some((actor_id, token)) = application_oauth2::try_bridge_from_connections() {
            snapshot = SessionState {
                actor_id: Some(actor_id),
                token: Some(token),
            };
        }
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

pub fn auth_validate_token(
    input: AuthValidateTokenInput,
    state: &State<AppState>,
) -> AppResult<StubPayload> {
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

fn write_session(
    state: &State<AppState>,
    session: &AuthSession,
) -> Result<(), AppResult<StubPayload>> {
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
    storage::write_string_atomic(&file_path, &payload).map_err(|_| {
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
    storage::app_file_path("desktop", StorageKind::Temp, &["auth", "session.json"]).unwrap_or_else(
        |_| {
            std::env::temp_dir()
                .join("peers-touch")
                .join("desktop")
                .join("auth-session.json")
        },
    )
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

/// Load the Station JWT that was persisted by `save_oauth_callback`
/// (via the oauth-bridge call) and write it into AppState so the BFF
/// session is immediately active without requiring an app restart.
pub fn ensure_station_session(state: &State<AppState>) -> AppResult<StubPayload> {
    let (actor_id, token) = match application_oauth2::read_station_session() {
        Some(pair) => pair,
        None => {
            return AppResult::fail(
                ErrorCode::NotFound,
                "no station session found",
                Some(json!({ "command": "ensure_station_session", "reason": "session_missing" })),
            )
        }
    };

    let session = from_station_response(actor_id, token);
    if let Err(error) = write_session(state, &session) {
        return error;
    }
    if let Err(error) = persist_session(&session) {
        return error;
    }

    AppResult::success(StubPayload {
        command: "ensure_station_session".to_string(),
        status: "ok".to_string(),
    })
}
