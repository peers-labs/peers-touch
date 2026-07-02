use crate::contracts::{
    AccessDecisionPayload, AccessSubmitInviteInput, AccessSubmitLoginInput, AuthLoginInput,
    AuthSessionPayload, AuthValidateTokenInput,
};
use crate::domain::auth::session::{
    from_station_response, validate_login_input, validate_token, AuthDomainError, AuthSession,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::session_store::{PersistedSession, SessionSource};
use crate::infrastructure::session_vault::{self, SessionVaultError};
use crate::infrastructure::station_client;
use crate::model::actor::ActorProfile;
use crate::state::{AppState, SessionState};
use serde_json::{json, Value};

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

fn value_field<'a>(value: &'a Value, snake_case: &str, camel_case: &str) -> Option<&'a Value> {
    value.get(snake_case).or_else(|| value.get(camel_case))
}

fn string_field(value: &Value, snake_case: &str, camel_case: &str) -> String {
    value_field(value, snake_case, camel_case)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

/// Performs a no-auth POST to a Station access endpoint and returns the
/// `data` envelope object. Network and unexpected-shape failures map to a
/// typed `AppResult` error generic over the caller's payload type.
fn access_post<T: serde::Serialize>(
    path: &str,
    body: Value,
    err_code: ErrorCode,
    context: &str,
) -> Result<Value, AppResult<T>> {
    let resp = station_client::post_json_no_auth(path, body)
        .map_err(|error| AppResult::fail(err_code, format!("{}: {}", context, error), None))?;
    resp.get("data").cloned().ok_or_else(|| {
        AppResult::fail(
            err_code,
            format!("{}: unexpected response from station", context),
            Some(resp),
        )
    })
}

/// Extract the `AccessDecision` object from a Station access envelope's `data`.
fn decision_from_data<T: serde::Serialize>(
    data: &Value,
    context: &str,
) -> Result<Value, AppResult<T>> {
    value_field(data, "decision", "decision")
        .cloned()
        .ok_or_else(|| {
            AppResult::fail(
                ErrorCode::InternalError,
                format!("{}: response missing decision", context),
                Some(data.clone()),
            )
        })
}

/// True when a decision is in the GRANTED terminal state. The Station emits
/// both a numeric enum (3) and a string name depending on wire encoding, so we
/// match either.
fn decision_is_granted(decision: &Value) -> bool {
    let state = value_field(decision, "state", "state");
    state.and_then(|v| v.as_i64()) == Some(3)
        || state.and_then(|v| v.as_str()) == Some("ACCESS_DECISION_STATE_GRANTED")
}

/// Build a human-readable reason from a non-granted decision: the decision
/// message if present, otherwise the first non-empty gate blocking reason.
fn decision_block_reason(decision: &Value) -> String {
    let message = string_field(decision, "message", "message");
    if !message.is_empty() {
        return message;
    }
    value_field(decision, "gates", "gates")
        .and_then(|v| v.as_array())
        .and_then(|gates| {
            gates
                .iter()
                .filter_map(|gate| value_field(gate, "blocking_reason", "blockingReason"))
                .filter_map(|v| v.as_str())
                .find(|v| !v.trim().is_empty())
        })
        .unwrap_or("Station access was not granted")
        .to_string()
}

/// Start an access attempt and return the Station's initial decision.
fn start_access_attempt<T: serde::Serialize>() -> Result<Value, AppResult<T>> {
    let data = access_post::<T>(
        "/actor/access/start",
        json!({
            "station_url": station_client::station_base_url(),
            "client": {
                "platform": "desktop",
                "app_version": env!("CARGO_PKG_VERSION"),
                "device_id": "",
                "locale": ""
            }
        }),
        ErrorCode::Unauthorized,
        "Access gate start failed",
    )?;
    decision_from_data(&data, "Access gate start failed")
}

/// Submit the login credential gate. On a granted decision returns the
/// embedded `login_response` object; otherwise surfaces the block reason.
fn submit_login_gate(
    attempt_id: &str,
    account: &str,
    password: &str,
) -> Result<Value, AppResult<AuthSessionPayload>> {
    let data = access_post::<AuthSessionPayload>(
        "/actor/access/submit",
        json!({
            "attempt_id": attempt_id,
            "gate_id": "auth.login",
            "type": 2,
            "login": {
                "email": account,
                "password": password,
                "device_type": "desktop"
            }
        }),
        ErrorCode::Unauthorized,
        "Login failed",
    )?;
    let decision = decision_from_data::<AuthSessionPayload>(&data, "Login failed")?;
    if !decision_is_granted(&decision) {
        return Err(AppResult::fail(
            ErrorCode::Forbidden,
            decision_block_reason(&decision),
            Some(json!({ "decision": decision })),
        ));
    }
    value_field(&data, "login_response", "loginResponse")
        .cloned()
        .ok_or_else(|| {
            AppResult::fail(
                ErrorCode::Unauthorized,
                "Login failed: access gate response missing login session",
                Some(data),
            )
        })
}

/// Start an access attempt and hand the raw decision back to the client so it
/// can drive the interactive gate chain (invite code, then login).
pub fn access_start() -> AppResult<AccessDecisionPayload> {
    match start_access_attempt::<AccessDecisionPayload>() {
        Ok(decision) => AppResult::success(AccessDecisionPayload {
            command: "access_start".to_string(),
            status: "ready".to_string(),
            decision,
        }),
        Err(error) => error,
    }
}

/// Redeem a self-service invite code for a live attempt and return the
/// re-evaluated decision. This never produces a session; the chain advances to
/// the login gate once the code passes.
pub fn access_submit_invite_code(
    input: AccessSubmitInviteInput,
) -> AppResult<AccessDecisionPayload> {
    let code = input.invite_code.trim();
    if code.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "Invite code is required", None);
    }
    let data = match access_post::<AccessDecisionPayload>(
        "/actor/access/submit",
        json!({
            "attempt_id": input.attempt_id,
            "gate_id": "invite.code",
            "type": 5,
            "invite_code": code
        }),
        ErrorCode::Forbidden,
        "Invite code rejected",
    ) {
        Ok(data) => data,
        Err(error) => return error,
    };
    match decision_from_data::<AccessDecisionPayload>(&data, "Invite code rejected") {
        Ok(decision) => AppResult::success(AccessDecisionPayload {
            command: "access_submit_invite_code".to_string(),
            status: "evaluated".to_string(),
            decision,
        }),
        Err(error) => error,
    }
}

/// Submit the login credential gate for a live attempt and, on grant, land the
/// full desktop session (token persistence, avatar download, account state).
pub fn access_submit_login(
    input: AccessSubmitLoginInput,
    state: &AppState,
) -> AppResult<AuthSessionPayload> {
    if let Err(error) = validate_login_input(&input.account, &input.password) {
        return map_domain_error(error);
    }
    let data = match submit_login_gate(&input.attempt_id, &input.account, &input.password) {
        Ok(data) => data,
        Err(error) => return error,
    };
    finish_login(data, state, "access_submit_login")
}

pub fn auth_login(input: AuthLoginInput, state: &AppState) -> AppResult<AuthSessionPayload> {
    if let Err(error) = validate_login_input(&input.account, &input.password) {
        return map_domain_error(error);
    }

    let attempt = match start_access_attempt::<AuthSessionPayload>() {
        Ok(decision) => decision,
        Err(error) => return error,
    };
    let attempt_id = string_field(&attempt, "attempt_id", "attemptId");
    if attempt_id.is_empty() {
        return AppResult::fail(
            ErrorCode::InternalError,
            "Access gate start failed: station did not return an attempt",
            Some(attempt),
        );
    }
    let data = match submit_login_gate(&attempt_id, &input.account, &input.password) {
        Ok(data) => data,
        Err(error) => return error,
    };
    finish_login(data, state, "auth_login")
}

/// Land a granted login: extract the token + actor identity, persist the
/// session, download the avatar, and return the rich auth payload. Shared by
/// the one-shot `auth_login` and the interactive `access_submit_login`.
fn finish_login(data: Value, state: &AppState, command: &str) -> AppResult<AuthSessionPayload> {
    let tokens = value_field(&data, "tokens", "tokens")
        .cloned()
        .unwrap_or(Value::Null);
    let token = string_field(&tokens, "access_token", "accessToken");
    if token.is_empty() {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "Login failed: no token in response",
            None,
        );
    }

    // Extract actor identity from the station response
    let actor = value_field(&data, "actor", "actor")
        .cloned()
        .unwrap_or(Value::Null);
    let actor_id = string_field(&actor, "id", "id");

    let name = string_field(&actor, "display_name", "displayName");
    let name = if name.is_empty() {
        string_field(&actor, "username", "username")
    } else {
        name
    };

    let email_str = string_field(&actor, "email", "email");
    let avatar = string_field(&actor, "icon", "icon");

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

    let account_id = match crate::infrastructure::auth_identity::upsert_password(
        &actor_id,
        &name,
        &email_str,
        if avatar.is_empty() {
            None
        } else {
            Some(avatar.as_str())
        },
    ) {
        Ok(account_id) => account_id,
        Err(reason) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to persist account identity: {reason}"),
                None,
            )
        }
    };
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
        command: command.to_string(),
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
    if let Some(ref acc) = active_account_id {
        session_vault::purge_raw_session_for_account(acc);
    } else if let Some(ref aid) = bound_actor {
        session_vault::purge_raw_session_for_actor(aid);
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

        if let Some(blob) = match load_raw_session_for_account(&active_account) {
            Ok(blob) => blob,
            Err(error) => return error,
        } {
            if let Some(ref mem) = snapshot.actor_id {
                if mem != &blob.actor_id {
                    tracing::warn!(
                        in_memory = %mem,
                        persisted_actor = %blob.actor_id,
                        "auth_restore_session: replacing stale in-memory actor binding with active account session"
                    );
                }
            }
            snapshot = SessionState {
                actor_id: Some(blob.actor_id),
                token: Some(blob.token),
            };
            loaded_from_persistent_store = true;
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
    let account_id = session_vault::active_account_id().unwrap_or_else(|| {
        crate::infrastructure::local_scope::account_id_for_password_actor(&session.actor_id)
    });
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
    let account_id = session_vault::active_account_id().unwrap_or_else(|| {
        crate::infrastructure::local_scope::account_id_for_password_actor(&session.actor_id)
    });
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
    Ok(blob)
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
/// the account picker matches reality. Raw tokens are stored per local account
/// scope, so different Stations never share the same restorable token slot.
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

    let Some(account_id) = active_account.clone() else {
        return AppResult::fail(
            ErrorCode::NotFound,
            "No station session found to restore",
            None,
        );
    };

    let blob = match session_vault::load_raw_session_for_account(
        &account_id,
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
    let account_id = session_vault::active_account_id().unwrap_or_else(|| {
        crate::infrastructure::local_scope::account_id_for_password_actor(&session.actor_id)
    });
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
