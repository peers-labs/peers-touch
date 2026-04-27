use crate::domain::auth::session::{from_station_response, validate_login_input, validate_token, AuthDomainError, AuthSession};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::session_store::{self, SessionSource};
use crate::infrastructure::station_client;
use crate::model::actor::ActorProfile;
use crate::contracts::{AuthLoginInput, AuthSessionPayload, AuthValidateTokenInput};
use crate::state::{AppState, SessionState};
use serde_json::json;

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

    // Resolve relative Station avatar path to absolute URL so identities.json
    // stores a renderable URL from the start (no need to wait for sync_user_profile).
    let avatar = if !avatar.is_empty() && avatar.starts_with('/') {
        format!("{}{}", station_client::station_base_url(), avatar)
    } else {
        avatar
    };

    let access_token = token.clone();
    let session = from_station_response(actor_id.clone(), token);
    if let Err(error) = write_session(state, &session) {
        return error;
    }
    if let Err(error) = session_store::save(&session.actor_id, &session.token, SessionSource::Password)
        .map_err(session_store_to_app)
    {
        return error;
    }

    let _ = crate::infrastructure::auth_identity::upsert_password(
        &actor_id,
        &name,
        &email_str,
        if avatar.is_empty() { None } else { Some(avatar.as_str()) },
    );

    // Download avatar to local cache immediately so the account picker shows
    // the correct image on next app start without waiting for sync_user_profile.
    let avatar_local_path = if !avatar.is_empty() {
        crate::application::profile::sync_avatar_with_download(&access_token, &avatar)
            .ok()
            .flatten()
    } else {
        None
    };

    // Mark session as restorable (will be encrypted once PIN is set)
    mark_account_has_session(&format!("password:{}", actor_id), &session.token);

    AppResult::success(AuthSessionPayload {
        command: "auth_login".to_string(),
        status: "authenticated".to_string(),
        actor_id: Some(actor_id),
        name: Some(name),
        email: Some(email_str),
        avatar_url: Some(avatar),
        avatar_local_path,
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

    let bound_actor = state
        .session
        .lock()
        .ok()
        .and_then(|g| g.actor_id.clone());
    if let Some(ref aid) = bound_actor {
        let _ = session_store::delete(aid);
    } else if let Some(ref acc) = active_account_id {
        let id = actor_id_from_account_id(acc);
        if !id.is_empty() {
            let _ = session_store::delete(&id);
        }
    }

    if let Err(error) = clear_session(state) {
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
        let active_actor = crate::infrastructure::auth_identity::read_state()
            .ok()
            .and_then(|s| s.active_account_id)
            .map(|acc| actor_id_from_account_id(&acc))
            .filter(|id| !id.is_empty());

        if let Some(ref active) = active_actor {
            if let Some(ref mem) = snapshot.actor_id {
                if mem != active {
                    tracing::warn!(
                        in_memory = %mem,
                        active_actor = %active,
                        "auth_restore_session: ignoring per-account disk session; active account does not match in-memory binding"
                    );
                } else if let Some(blob) = session_store::load(active) {
                    snapshot = SessionState {
                        actor_id: Some(blob.actor_id),
                        token: Some(blob.token),
                    };
                }
            } else if let Some(blob) = session_store::load(active) {
                snapshot = SessionState {
                    actor_id: Some(blob.actor_id),
                    token: Some(blob.token),
                };
            }
        }
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
    if let Err(error) = session_store::save(&session.actor_id, &session.token, SessionSource::Password)
        .map_err(session_store_to_app)
    {
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
    if let Err(error) = session_store::save(&session.actor_id, &session.token, SessionSource::Password)
        .map_err(session_store_to_app)
    {
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

fn session_store_to_app(e: session_store::SessionStoreError) -> AppResult<AuthSessionPayload> {
    AppResult::fail(
        ErrorCode::InternalError,
        format!("Session persistence error: {e}"),
        None,
    )
}

/// Local station `actor_id` part from an `account_id` like `password:123` or bare `123`.
fn actor_id_from_account_id(account_id: &str) -> String {
    account_id
        .split_once(':')
        .map(|(_, id)| id.to_string())
        .unwrap_or_else(|| account_id.to_string())
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
///
/// For non-PIN accounts, only ONE session is active at a time. When a new account
/// logs in, the previous non-PIN account's `has_session` is cleared so the
/// account picker matches reality. Raw tokens are also stored per-actor in
/// `infrastructure::session_store`.
fn mark_account_has_session(account_id: &str, _token: &str) {
    if let Ok(mut state) = crate::infrastructure::auth_identity::read_state() {
        for account in &mut state.accounts {
            if account.id != account_id && account.pin_protection.is_none() {
                account.has_session = false;
            }
        }

        if let Some(account) = state.accounts.iter_mut().find(|a| a.id == account_id) {
            account.has_session = true;
        }

        let _ = crate::infrastructure::auth_identity::write_state(&state);
    }
}

/// Load a Station JWT persisted for the **active** account (OAuth bridge) and
/// mirror it into `AppState` for the BFF.
pub fn ensure_station_session(state: &AppState) -> AppResult<AuthSessionPayload> {
    let active_actor = crate::infrastructure::auth_identity::read_state()
        .ok()
        .and_then(|s| s.active_account_id)
        .map(|acc| actor_id_from_account_id(&acc))
        .filter(|id| !id.is_empty());

    let Some(active) = active_actor else {
        return AppResult::fail(
            ErrorCode::NotFound,
            "No station session found to restore",
            None,
        )
    };

    let blob = match session_store::load(&active) {
        Some(b) if b.source == SessionSource::OauthBridge => b,
        Some(_) | None => {
            return AppResult::fail(
                ErrorCode::NotFound,
                "No station session found to restore",
                None,
            )
        }
    };

    if blob.actor_id != active {
        tracing::warn!(
            blob_actor = %blob.actor_id,
            active = %active,
            "ensure_station_session: session blob actor does not match active account; using blob"
        );
    }

    let actor_id = blob.actor_id;
    let token = blob.token;
    let session = from_station_response(actor_id.clone(), token);
    if let Err(error) = write_session(state, &session) {
        return error;
    }
    if let Err(error) = session_store::save(&session.actor_id, &session.token, SessionSource::OauthBridge)
        .map_err(session_store_to_app)
    {
        return error;
    }

    let profile = crate::infrastructure::auth_identity::find_profile_by_actor_id(&actor_id);
    let (p_name, p_email, p_avatar, p_local_avatar) = match &profile {
        Some(p) => (
            Some(p.name.clone()).filter(|v| !v.is_empty()),
            Some(p.email.clone()).filter(|v| !v.is_empty()),
            Some(p.avatar_url.clone()).filter(|v| !v.is_empty()),
            p.avatar_local_path.clone().filter(|v| !v.is_empty()),
        ),
        None => (None, None, None, None),
    };

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
        avatar_local_path: p_local_avatar,
        login_method: Some("oauth".to_string()),
    })
}
