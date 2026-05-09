use crate::contracts::{AuthLoginInput, AuthSessionPayload, AuthValidateTokenInput};
use crate::domain::auth::session::{
    from_station_response, validate_login_input, validate_token, AuthDomainError, AuthSession,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::session_store::{PersistedSession, SessionSource};
use crate::infrastructure::session_vault::{self, SessionVaultError};
use crate::infrastructure::station_client;
use crate::model::actor::ActorProfile;
use crate::state::{AppState, SessionState};
use serde_json::json;

pub(crate) fn takeover_station_session_token(
    token: &str,
) -> Result<String, station_client::StationClientError> {
    let body = json!({ "device_type": "desktop" });
    let resp = station_client::request_json_auth(
        reqwest::Method::POST,
        "/actor/session/takeover",
        token,
        None,
        Some(&body),
    )?;
    let access_token = resp
        .get("data")
        .and_then(|data| data.pointer("/tokens/access_token"))
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    if access_token.is_empty() {
        return Err(station_client::StationClientError::new(
            station_client::StationClientErrorKind::InvalidResponse,
            "session takeover response missing access token",
            Some(resp),
        ));
    }
    Ok(access_token)
}

pub(crate) fn session_takeover_failed<T: serde::Serialize>(
    error: station_client::StationClientError,
    account_id: Option<&str>,
    provider: Option<&str>,
) -> AppResult<T> {
    AppResult::fail(
        ErrorCode::Unauthorized,
        "session revoked",
        Some(json!({
            "code": "session_revoked",
            "reason": "takeover_failed",
            "account_id": account_id,
            "provider": provider,
            "raw": error.message,
        })),
    )
}

fn persist_session_if_unprotected(
    account_id: &str,
    session: &AuthSession,
    source: SessionSource,
) -> Result<(), AppResult<AuthSessionPayload>> {
    session_vault::persist_raw_session_for_account(
        account_id,
        &session.actor_id,
        &session.token,
        source,
    )
    .map_err(session_vault_to_app)
}

pub fn auth_login(input: AuthLoginInput, state: &AppState) -> AppResult<AuthSessionPayload> {
    if let Err(error) = validate_login_input(&input.account, &input.password) {
        return map_domain_error(error);
    }

    let body = json!({ "email": input.account, "password": input.password });
    let resp = match station_client::post_json_no_auth("/actor/login", body) {
        Ok(r) => r,
        Err(e) => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                format!("Login failed: {}", e),
                None,
            )
        }
    };

    let data = match resp.get("data") {
        Some(d) => d,
        None => {
            return AppResult::fail(
                ErrorCode::Unauthorized,
                "Login failed: unexpected response from station",
                None,
            )
        }
    };

    let token = data
        .pointer("/tokens/access_token")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if token.is_empty() {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "Login failed: no token in response",
            None,
        );
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

    let account_id = crate::infrastructure::auth_identity::upsert_password(
        &actor_id,
        &name,
        &email_str,
        if avatar.is_empty() {
            None
        } else {
            Some(avatar.as_str())
        },
    )
    .unwrap_or_else(|_| format!("password:{}", actor_id));
    if let Err(error) =
        persist_session_if_unprotected(&account_id, &session, SessionSource::Password)
    {
        return error;
    }

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
    mark_account_has_session(&account_id, &session.token);

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

    let bound_actor = state.session.lock().ok().and_then(|g| g.actor_id.clone());
    if let Some(ref aid) = bound_actor {
        session_vault::purge_raw_session_for_actor(aid);
    } else if let Some(ref acc) = active_account_id {
        session_vault::purge_raw_session_for_account(acc);
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
    let mut loaded_from_persistent_store = false;
    if snapshot.token.is_none() {
        let active_account = session_vault::active_account_id();
        if active_account
            .as_deref()
            .map(session_vault::account_requires_pin)
            .unwrap_or(false)
        {
            if let Some(account_id) = active_account.as_deref() {
                session_vault::purge_raw_session_for_account(account_id);
            }
            return unauthorized(
                "pin required",
                json!({ "command": "auth_restore_session", "reason": "pin_required" }),
            );
        }

        let active_actor = active_account
            .as_deref()
            .map(session_vault::actor_id_from_account_id)
            .filter(|id| !id.is_empty());

        if let Some(ref active) = active_actor {
            if let Some(ref mem) = snapshot.actor_id {
                if mem != active {
                    tracing::warn!(
                        in_memory = %mem,
                        active_actor = %active,
                        "auth_restore_session: ignoring per-account disk session; active account does not match in-memory binding"
                    );
                } else if let Some(blob) =
                    match load_raw_session_for_account(&active_account, active) {
                        Ok(blob) => blob,
                        Err(error) => return error,
                    }
                {
                    snapshot = SessionState {
                        actor_id: Some(blob.actor_id),
                        token: Some(blob.token),
                    };
                    loaded_from_persistent_store = true;
                }
            } else if let Some(blob) = match load_raw_session_for_account(&active_account, active) {
                Ok(blob) => blob,
                Err(error) => return error,
            } {
                snapshot = SessionState {
                    actor_id: Some(blob.actor_id),
                    token: Some(blob.token),
                };
                loaded_from_persistent_store = true;
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
    let initial_session = match validate_token(&token) {
        Ok(session) => session,
        Err(error) => {
            let _ = clear_session(state);
            return map_domain_error(error);
        }
    };
    if let Err(error) = verify_session_with_station(&token) {
        let _ = clear_session(state);
        return error;
    }
    let token = if loaded_from_persistent_store {
        match takeover_station_session_token(&token) {
            Ok(token) => token,
            Err(error) => {
                let _ = clear_session(state);
                session_vault::purge_raw_session_for_actor(&initial_session.actor_id);
                return session_takeover_failed(error, None, None);
            }
        }
    } else {
        token
    };
    let session = match validate_token(&token) {
        Ok(session) => session,
        Err(error) => {
            let _ = clear_session(state);
            session_vault::purge_raw_session_for_actor(&initial_session.actor_id);
            return map_domain_error(error);
        }
    };
    if let Err(error) = write_session(state, &session) {
        return error;
    }
    let account_id = session_vault::active_account_id().unwrap_or_else(|| session.actor_id.clone());
    if let Err(error) =
        persist_session_if_unprotected(&account_id, &session, SessionSource::Password)
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
    if let Err(error) = verify_session_with_station(&token) {
        let _ = clear_session(state);
        return error;
    }
    if let Err(error) = write_session(state, &session) {
        return error;
    }
    let account_id = session_vault::active_account_id().unwrap_or_else(|| session.actor_id.clone());
    if let Err(error) =
        persist_session_if_unprotected(&account_id, &session, SessionSource::Password)
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

fn session_vault_to_app(e: SessionVaultError) -> AppResult<AuthSessionPayload> {
    AppResult::fail(
        ErrorCode::InternalError,
        format!("Session persistence error: {e}"),
        None,
    )
}

fn load_raw_session_for_account(
    active_account: &Option<String>,
    active_actor: &str,
) -> Result<Option<PersistedSession>, AppResult<AuthSessionPayload>> {
    let Some(account_id) = active_account.as_deref() else {
        return Ok(None);
    };
    let blob =
        session_vault::load_raw_session_for_account(account_id, None).map_err(
            |error| match error {
                SessionVaultError::PinRequired { .. } => unauthorized(
                    "pin required",
                    json!({ "command": "auth_restore_session", "reason": "pin_required" }),
                ),
                other => session_vault_to_app(other),
            },
        )?;
    Ok(blob.filter(|blob| blob.actor_id == active_actor))
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

fn unauthorized(
    message: impl Into<String>,
    details: serde_json::Value,
) -> AppResult<AuthSessionPayload> {
    AppResult::fail(ErrorCode::Unauthorized, message, Some(details))
}

/// Mark account as having a restorable session.
///
/// For non-PIN accounts, only ONE session is active at a time. When a new
/// account logs in, the previous non-PIN account's `has_session` is cleared so
/// the account picker matches reality. Raw tokens are also stored per-actor in
/// `infrastructure::session_store`, keyed by `actor_id`, so a multi-actor
/// scenario (foreground PIN account, background OAuth account) doesn't trample
/// the legacy shared `session.json`.
///
/// PIN handling: keep existing PIN protection intact even when the encrypted
/// session blob was cleared after token expiry. The post-login UI can ask for
/// the existing PIN once and re-encrypt the fresh token; dropping the PIN here
/// would force the user through the heavier create+confirm PIN flow again.
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
    let active_account = session_vault::active_account_id();
    if active_account
        .as_deref()
        .map(session_vault::account_requires_pin)
        .unwrap_or(false)
    {
        if let Some(account_id) = active_account.as_deref() {
            session_vault::purge_raw_session_for_account(account_id);
        }
        return unauthorized(
            "pin required",
            json!({ "command": "ensure_station_session", "reason": "pin_required" }),
        );
    }

    let active_actor = active_account
        .as_deref()
        .map(session_vault::actor_id_from_account_id)
        .filter(|id| !id.is_empty());

    let Some(active) = active_actor else {
        return AppResult::fail(
            ErrorCode::NotFound,
            "No station session found to restore",
            None,
        );
    };

    let account_id = active_account.as_deref().unwrap_or(&active);
    let blob = match session_vault::load_raw_session_for_account(
        account_id,
        Some(SessionSource::OauthBridge),
    ) {
        Ok(Some(b)) => b,
        Ok(None) => {
            return AppResult::fail(
                ErrorCode::NotFound,
                "No station session found to restore",
                None,
            )
        }
        Err(SessionVaultError::PinRequired { .. }) => {
            return unauthorized(
                "pin required",
                json!({ "command": "ensure_station_session", "reason": "pin_required" }),
            )
        }
        Err(error) => return session_vault_to_app(error),
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
    if let Err(error) = verify_session_with_station(&token) {
        let _ = clear_session(state);
        return error;
    }
    let session = from_station_response(actor_id.clone(), token);
    if let Err(error) = write_session(state, &session) {
        return error;
    }
    let account_id = session_vault::active_account_id().unwrap_or_else(|| session.actor_id.clone());
    if let Err(error) =
        persist_session_if_unprotected(&account_id, &session, SessionSource::OauthBridge)
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

fn verify_session_with_station(token: &str) -> Result<(), AppResult<AuthSessionPayload>> {
    station_client::request_peers_proto_no_body::<ActorProfile>(
        reqwest::Method::GET,
        "/actor/profile",
        token,
        None,
    )
    .map(|_| ())
    .map_err(|error| error.into_app_result("Session validation failed"))
}
