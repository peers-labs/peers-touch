use crate::contracts::{
    AccessDecisionPayload, AccessSubmitInviteInput, AccessSubmitLoginInput, AuthLoginInput,
    AuthSessionPayload, AuthValidateTokenInput,
};
use crate::domain::auth::session::{
    from_station_response, validate_login_input, validate_token, AuthDomainError, AuthSession,
};
use crate::domain::identity::{ActiveSession, ActorRef};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::session_store::{PersistedSession, SessionSource};
use crate::infrastructure::session_vault::{self, SessionVaultError};
use crate::infrastructure::station_client;
use crate::model::actor::ActorProfile;
use crate::state::{AppState, SessionState};
use serde_json::{json, Value};
use std::sync::MutexGuard;

pub(crate) struct PreparedAuthSession {
    pub payload: AuthSessionPayload,
    pub account_id: String,
    pub actor_id: String,
    pub token: String,
}

impl PreparedAuthSession {
    pub fn active_session(&self, window_label: &str) -> ActiveSession {
        let mut actor = ActorRef::new_person(self.actor_id.clone());
        actor.ptid = self.payload.ptid.clone().unwrap_or_default();
        ActiveSession::new(
            window_label,
            self.account_id.clone(),
            actor,
            self.token.clone(),
        )
    }

    fn legacy_session_state(&self) -> SessionState {
        SessionState {
            actor_id: Some(self.actor_id.clone()),
            token: Some(self.token.clone()),
            account_id: Some(self.account_id.clone()),
        }
    }
}

type PreparedAuthResult = Result<PreparedAuthSession, AppResult<AuthSessionPayload>>;

pub(crate) fn validate_pin_session_token(
    account_id: &str,
    persisted_account_id: &str,
    persisted_actor_id: Option<&str>,
    token: &str,
) -> Result<AuthSession, AppResult<AuthSessionPayload>> {
    if persisted_account_id != account_id {
        return Err(unauthorized(
            "encrypted session does not belong to the selected account",
            json!({
                "command": "account_unlock",
                "reason": "account_blob_mismatch"
            }),
        ));
    }
    let session = validate_token(token).map_err(map_domain_error)?;
    if session.actor_id.trim().is_empty() {
        return Err(unauthorized(
            "unlocked token has no actor subject",
            json!({
                "command": "account_unlock",
                "reason": "actor_missing"
            }),
        ));
    }
    if persisted_actor_id.is_some_and(|actor_id| actor_id != session.actor_id) {
        return Err(unauthorized(
            "unlocked token does not belong to the persisted session actor",
            json!({
                "command": "account_unlock",
                "reason": "account_actor_mismatch"
            }),
        ));
    }
    Ok(session)
}

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

pub(crate) fn canonical_ptid_for_token(token: &str) -> Option<String> {
    if let Ok(profile) = station_client::request_proto::<(), ActorProfile>(
        reqwest::Method::GET,
        "/api/v1/social/users/me",
        token,
        None,
        None::<&()>,
    ) {
        if profile.id.starts_with("ptid:") {
            return Some(profile.id);
        }
    }
    if let Ok(resp) =
        station_client::request_json(reqwest::Method::GET, "/actor/profile", token, None, None)
    {
        if let Some(network_id) = resp
            .get("data")
            .and_then(|d| d.get("peers_touch"))
            .and_then(|p| p.get("network_id"))
            .and_then(|n| n.as_str())
        {
            if network_id.starts_with("ptid:") {
                return Some(network_id.to_string());
            }
        }
        if let Some(id) = resp
            .get("data")
            .and_then(|d| d.get("id"))
            .and_then(|v| v.as_str())
        {
            if id.starts_with("ptid:") {
                return Some(id.to_string());
            }
        }
    }
    None
}

pub(crate) fn activate_messaging_profile(
    state: &AppState,
    account_id: &str,
    actor_id: &str,
    token: &str,
) -> Result<(), String> {
    if account_id.trim().is_empty() || actor_id.trim().is_empty() || token.trim().is_empty() {
        return Err("messaging activation identity is incomplete".to_string());
    }
    let ptid = canonical_ptid_for_token(token)
        .ok_or_else(|| "messaging activation could not resolve canonical PTID".to_string())?;
    let identity_key_ref =
        crate::infrastructure::local_scope::LocalScope::from_actor(actor_id).identity_key_ref();
    let actor_identity = crate::domain::crypto::get_or_create_identity(&identity_key_ref)
        .map_err(|error| format!("messaging actor identity unavailable: {error}"))?;
    let actor_identity_seed = actor_identity.seed_bytes();
    state.messaging_engines.activate_profile(
        account_id.to_string(),
        ptid,
        actor_identity_seed,
        crate::messaging::INITIAL_ACTOR_IDENTITY_PROFILE_VERSION,
    )?;
    state
        .messaging_engines
        .activate_profile_worker(account_id, token.to_string())
}

pub(crate) fn deactivate_messaging_profile(
    state: &AppState,
    account_id: &str,
) -> Result<(), String> {
    state.messaging_engines.deactivate(account_id).map(|_| ())
}

fn commit_legacy_prepared_session(
    state: &AppState,
    prepared: PreparedAuthSession,
) -> AppResult<AuthSessionPayload> {
    if let Err(error) = activate_messaging_profile(
        state,
        &prepared.account_id,
        &prepared.actor_id,
        &prepared.token,
    ) {
        tracing::warn!(
            account_id = %prepared.account_id,
            actor_id = %prepared.actor_id,
            error = %error,
            "HTTP Gateway session retained while durable messaging activation awaits retry"
        );
    }
    let mut mirror = match state.session.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to update legacy session mirror",
                None,
            )
        }
    };
    *mirror = prepared.legacy_session_state();
    AppResult::success(prepared.payload)
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
    let resp = station_client::post_json_no_auth(path, body).map_err(|error| {
        use station_client::StationClientErrorKind;
        match error.kind {
            StationClientErrorKind::HttpStatus(status) => {
                let code = match status {
                    400 => ErrorCode::InvalidArgument,
                    401 => ErrorCode::Unauthorized,
                    403 => ErrorCode::Forbidden,
                    404 => ErrorCode::NotFound,
                    409 => ErrorCode::Conflict,
                    _ => ErrorCode::InternalError,
                };
                AppResult::fail(
                    code,
                    format!("{}: {}", context, error.message),
                    error.details,
                )
            }
            _ => AppResult::fail(
                err_code,
                format!("{}: {}", context, error.message),
                error.details,
            ),
        }
    })?;
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
    let transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    match prepare_access_submit_login_during_transition(input, state, &transition) {
        Ok(prepared) => commit_legacy_prepared_session(state, prepared),
        Err(error) => error,
    }
}

pub(crate) fn prepare_access_submit_login_during_transition(
    input: AccessSubmitLoginInput,
    state: &AppState,
    transition: &MutexGuard<'_, ()>,
) -> PreparedAuthResult {
    if let Err(error) = validate_login_input(&input.account, &input.password) {
        return Err(map_domain_error(error));
    }
    let data = match submit_login_gate(&input.attempt_id, &input.account, &input.password) {
        Ok(data) => data,
        Err(error) => return Err(error),
    };
    prepare_login_during_transition(data, state, "access_submit_login", transition)
}

pub fn auth_login(input: AuthLoginInput, state: &AppState) -> AppResult<AuthSessionPayload> {
    let transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    match prepare_auth_login_during_transition(input, state, &transition) {
        Ok(prepared) => commit_legacy_prepared_session(state, prepared),
        Err(error) => error,
    }
}

pub(crate) fn prepare_auth_login_during_transition(
    input: AuthLoginInput,
    state: &AppState,
    transition: &MutexGuard<'_, ()>,
) -> PreparedAuthResult {
    if let Err(error) = validate_login_input(&input.account, &input.password) {
        return Err(map_domain_error(error));
    }

    let attempt = match start_access_attempt::<AuthSessionPayload>() {
        Ok(decision) => decision,
        Err(error) => {
            let should_fallback = error
                .error
                .as_ref()
                .is_some_and(|e| e.code == ErrorCode::NotFound);
            if should_fallback {
                tracing::info!(
                    "access-gate endpoint not found (404), falling back to direct /actor/login"
                );
                return direct_login_fallback(&input.account, &input.password, state, transition);
            }
            return Err(error);
        }
    };
    let attempt_id = string_field(&attempt, "attempt_id", "attemptId");
    if attempt_id.is_empty() {
        return Err(AppResult::fail(
            ErrorCode::InternalError,
            "Access gate start failed: station did not return an attempt",
            Some(attempt),
        ));
    }
    let data = match submit_login_gate(&attempt_id, &input.account, &input.password) {
        Ok(data) => data,
        Err(error) => return Err(error),
    };
    prepare_login_during_transition(data, state, "auth_login", transition)
}

/// Fallback for Stations that do not implement the access-gate flow.
/// Calls the legacy `/actor/login` endpoint directly.
fn direct_login_fallback(
    account: &str,
    password: &str,
    state: &AppState,
    transition: &MutexGuard<'_, ()>,
) -> PreparedAuthResult {
    let body = json!({
        "email": account,
        "password": password,
        "device_type": "desktop"
    });
    let resp = match station_client::post_json_no_auth("/actor/login", body) {
        Ok(resp) => resp,
        Err(error) => {
            return Err(AppResult::fail(
                ErrorCode::Unauthorized,
                format!("Direct login failed: {}", error),
                None,
            ));
        }
    };
    let data = match resp.get("data").cloned() {
        Some(data) => data,
        None => {
            return Err(AppResult::fail(
                ErrorCode::Unauthorized,
                "Direct login failed: unexpected response from station",
                Some(resp),
            ));
        }
    };
    prepare_login_during_transition(data, state, "auth_login_direct", transition)
}

/// Land a granted login: extract the token + actor identity, persist the
/// session, download the avatar, and return the rich auth payload. Shared by
/// the one-shot `auth_login` and the interactive `access_submit_login`.
fn prepare_login_during_transition(
    data: Value,
    state: &AppState,
    command: &str,
    _transition: &MutexGuard<'_, ()>,
) -> PreparedAuthResult {
    let tokens = value_field(&data, "tokens", "tokens")
        .cloned()
        .unwrap_or(Value::Null);
    let token = string_field(&tokens, "access_token", "accessToken");
    if token.is_empty() {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "Login failed: no token in response",
            None,
        ));
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

    // Resolve relative Station avatar path to absolute URL
    let avatar = if !avatar.is_empty() && avatar.starts_with('/') {
        format!("{}{}", station_client::station_base_url(), avatar)
    } else {
        avatar
    };

    let access_token = token.clone();
    let session = from_station_response(actor_id.clone(), token);

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
            return Err(AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to persist account identity: {reason}"),
                None,
            ))
        }
    };
    if let Err(error) =
        persist_session_if_unprotected(&account_id, &session, SessionSource::Password)
    {
        return Err(error);
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
    let ptid = canonical_ptid_for_token(&access_token);
    Ok(PreparedAuthSession {
        payload: AuthSessionPayload {
            command: command.to_string(),
            status: "authenticated".to_string(),
            actor_id: Some(actor_id.clone()),
            ptid,
            name: Some(name),
            email: Some(email_str),
            avatar_url: Some(avatar),
            avatar_local_path,
            login_method: Some("password".to_string()),
        },
        account_id,
        actor_id,
        token: session.token,
    })
}

pub fn auth_logout(state: &AppState) -> AppResult<AuthSessionPayload> {
    let transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    auth_logout_during_transition(state, &transition, None)
}

pub(crate) fn auth_logout_during_transition(
    state: &AppState,
    _transition: &MutexGuard<'_, ()>,
    committed_session: Option<SessionState>,
) -> AppResult<AuthSessionPayload> {
    let target_session = match committed_session {
        Some(session) => session,
        None => match read_session(state) {
            Ok(session) => session,
            Err(error) => return error,
        },
    };
    if let Some(ref account_id) = target_session.account_id {
        let _ = crate::infrastructure::auth_identity::clear_account_session(account_id);
        if let Err(error) = deactivate_messaging_profile(state, account_id) {
            tracing::warn!(account_id = %account_id, error = %error, "failed to deactivate messaging profile");
        }
        session_vault::purge_raw_session_for_account(account_id);
    } else if let Some(ref actor_id) = target_session.actor_id {
        session_vault::purge_raw_session_for_actor(actor_id);
    }

    if let Err(error) = clear_session_if_matches(state, &target_session) {
        return error;
    }
    AppResult::success(AuthSessionPayload {
        command: "auth_logout".to_string(),
        status: "logged_out".to_string(),
        actor_id: None,
        ptid: None,
        name: None,
        email: None,
        avatar_url: None,
        avatar_local_path: None,
        login_method: None,
    })
}

pub(crate) fn detach_for_station_switch(
    state: &AppState,
) -> Result<(), AppResult<AuthSessionPayload>> {
    if let Err(error) = state.messaging_engines.deactivate_all() {
        tracing::warn!(error = %error, "failed to deactivate messaging engines for Station switch");
    }
    for session in state.sessions.clear() {
        crate::infrastructure::event_stream::stop(&session.actor.actor_id);
    }
    clear_session(state)
}

pub fn auth_restore_session(state: &AppState) -> AppResult<AuthSessionPayload> {
    let transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    match prepare_auth_restore_session_during_transition(state, &transition) {
        Ok(prepared) => commit_legacy_prepared_session(state, prepared),
        Err(error) => error,
    }
}

pub(crate) fn prepare_auth_restore_session_during_transition(
    state: &AppState,
    transition: &MutexGuard<'_, ()>,
) -> PreparedAuthResult {
    let selected_account = session_vault::active_account_id();
    prepare_auth_restore_session_for_account_during_transition(
        state,
        transition,
        selected_account.as_deref(),
    )
}

pub(crate) fn prepare_auth_restore_session_for_account_during_transition(
    state: &AppState,
    _transition: &MutexGuard<'_, ()>,
    selected_account: Option<&str>,
) -> PreparedAuthResult {
    let mut snapshot = match read_session(state) {
        Ok(snapshot) => snapshot,
        Err(error) => return Err(error),
    };
    if !session_belongs_to_selected_account(&snapshot, selected_account) {
        snapshot = SessionState::default();
    }
    let mut loaded_from_persistent_store = false;
    if snapshot.token.is_none() {
        if selected_account
            .map(session_vault::account_requires_pin)
            .unwrap_or(false)
        {
            if let Some(account_id) = selected_account {
                session_vault::purge_raw_session_for_account(account_id);
            }
            return Err(unauthorized(
                "pin required",
                json!({ "command": "auth_restore_session", "reason": "pin_required" }),
            ));
        }

        let selected_account = selected_account.map(str::to_string);
        if let Some(blob) = match load_raw_session_for_account(&selected_account) {
            Ok(blob) => blob,
            Err(error) => return Err(error),
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
                account_id: selected_account.clone(),
            };
            loaded_from_persistent_store = true;
        }
    }

    // Restore only from memory or disk. No OAuth bridge fallback.
    let committed_snapshot = snapshot.clone();
    let restored_actor_id = snapshot.actor_id.clone();
    let restored_account_id = snapshot.account_id.clone();
    let token = match snapshot.token {
        Some(token) => token,
        None => {
            return Err(unauthorized(
                "missing session",
                json!({ "command": "auth_restore_session", "reason": "session_missing" }),
            ))
        }
    };
    let Some(expected_actor_id) = restored_actor_id else {
        let _ = clear_session_if_matches(state, &committed_snapshot);
        return Err(unauthorized(
            "restored session has no committed actor",
            json!({
                "command": "auth_restore_session",
                "reason": "actor_missing"
            }),
        ));
    };
    let Some(account_id) = restored_account_id.or_else(|| selected_account.map(str::to_string))
    else {
        let _ = clear_session_if_matches(state, &committed_snapshot);
        return Err(unauthorized(
            "restored session has no committed account",
            json!({
                "command": "auth_restore_session",
                "reason": "account_missing"
            }),
        ));
    };
    let initial_session = match validate_token(&token) {
        Ok(session) => session,
        Err(error) => {
            let _ = clear_session_if_matches(state, &committed_snapshot);
            return Err(map_domain_error(error));
        }
    };
    if initial_session.actor_id != expected_actor_id {
        let _ = clear_session_if_matches(state, &committed_snapshot);
        session_vault::purge_raw_session_for_account(&account_id);
        return Err(unauthorized(
            "restored token does not belong to the committed session actor",
            json!({
                "command": "auth_restore_session",
                "reason": "account_actor_mismatch"
            }),
        ));
    }
    if let Err(error) = verify_session_with_station(&token) {
        let _ = clear_session_if_matches(state, &committed_snapshot);
        return Err(error);
    }
    let token = if loaded_from_persistent_store {
        match takeover_station_session_token(&token) {
            Ok(token) => token,
            Err(error) => {
                let _ = clear_session_if_matches(state, &committed_snapshot);
                session_vault::purge_raw_session_for_actor(&initial_session.actor_id);
                return Err(session_takeover_failed(error, None, None));
            }
        }
    } else {
        token
    };
    let session = match validate_token(&token) {
        Ok(session) => session,
        Err(error) => {
            let _ = clear_session_if_matches(state, &committed_snapshot);
            session_vault::purge_raw_session_for_actor(&initial_session.actor_id);
            return Err(map_domain_error(error));
        }
    };
    if session.actor_id != expected_actor_id {
        let _ = clear_session_if_matches(state, &committed_snapshot);
        session_vault::purge_raw_session_for_account(&account_id);
        return Err(unauthorized(
            "rotated token changed the committed session actor",
            json!({
                "command": "auth_restore_session",
                "reason": "rotated_actor_mismatch"
            }),
        ));
    }
    if let Err(error) =
        persist_session_if_unprotected(&account_id, &session, SessionSource::Password)
    {
        return Err(error);
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
    let actor_id = session.actor_id.clone();
    let token = session.token.clone();
    Ok(PreparedAuthSession {
        payload: AuthSessionPayload {
            command: "auth_restore_session".to_string(),
            status: "restored".to_string(),
            actor_id: Some(actor_id.clone()),
            ptid: canonical_ptid_for_token(&token),
            name: p_name,
            email: p_email,
            avatar_url: p_avatar,
            avatar_local_path: p_local_avatar,
            login_method: p_method,
        },
        account_id,
        actor_id,
        token,
    })
}

pub fn auth_validate_token(
    input: AuthValidateTokenInput,
    state: &AppState,
) -> AppResult<AuthSessionPayload> {
    let transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    auth_validate_token_during_transition(input, state, &transition, None)
}

pub(crate) fn auth_validate_token_during_transition(
    input: AuthValidateTokenInput,
    state: &AppState,
    _transition: &MutexGuard<'_, ()>,
    committed_session: Option<SessionState>,
) -> AppResult<AuthSessionPayload> {
    let snapshot = match committed_session {
        Some(session) => session,
        None => match read_session(state) {
            Ok(snapshot) => snapshot,
            Err(error) => return error,
        },
    };
    let token = match input.token {
        Some(token) if !token.trim().is_empty() => token,
        _ => match snapshot.token.clone() {
            Some(token) if !token.trim().is_empty() => token,
            _ => {
                return unauthorized(
                    "missing token",
                    json!({ "command": "auth_validate_token", "reason": "token_missing" }),
                )
            }
        },
    };
    let session = match validate_token(&token) {
        Ok(session) => session,
        Err(error) => {
            let _ = clear_session_if_matches(state, &snapshot);
            return map_domain_error(error);
        }
    };
    if let Err(error) = verify_session_with_station(&token) {
        let _ = clear_session_if_matches(state, &snapshot);
        return error;
    }
    if snapshot.actor_id.as_deref() != Some(session.actor_id.as_str()) {
        return unauthorized(
            "validated token does not belong to the committed session actor",
            json!({
                "command": "auth_validate_token",
                "reason": "account_actor_mismatch"
            }),
        );
    };
    let Some(account_id) = snapshot.account_id else {
        return unauthorized(
            "validated token has no committed account",
            json!({
                "command": "auth_validate_token",
                "reason": "account_missing"
            }),
        );
    };
    if let Err(error) = write_session_for_account(state, &session, &account_id) {
        return error;
    }
    if let Err(error) =
        persist_session_if_unprotected(&account_id, &session, SessionSource::Password)
    {
        return error;
    }
    if let Err(error) =
        activate_messaging_profile(state, &account_id, &session.actor_id, &session.token)
    {
        tracing::warn!(
            account_id = %account_id,
            actor_id = %session.actor_id,
            error = %error,
            "validated session retained while durable messaging activation awaits retry"
        );
    }
    AppResult::success(AuthSessionPayload {
        command: "auth_validate_token".to_string(),
        status: "valid".to_string(),
        actor_id: Some(session.actor_id.clone()),
        ptid: canonical_ptid_for_token(&session.token),
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
        account_id: guard.account_id.clone(),
    })
}

fn write_session_for_account(
    state: &AppState,
    session: &AuthSession,
    account_id: &str,
) -> Result<(), AppResult<AuthSessionPayload>> {
    // The Tauri wrapper reads this tuple immediately afterward to replace the
    // window binding, so a rotated token must never be committed without its account.
    let mut guard = state.session.lock().map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "Failed to access session state",
            None,
        )
    })?;
    apply_session_identity(&mut guard, session, Some(account_id));
    Ok(())
}

fn apply_session_identity(
    target: &mut SessionState,
    session: &AuthSession,
    account_id: Option<&str>,
) {
    target.actor_id = Some(session.actor_id.clone());
    target.token = Some(session.token.clone());
    if let Some(account_id) = account_id {
        target.account_id = Some(account_id.to_string());
    }
}

fn session_belongs_to_selected_account(
    session: &SessionState,
    selected_account_id: Option<&str>,
) -> bool {
    selected_account_id
        .map(|account_id| session.account_id.as_deref() == Some(account_id))
        .unwrap_or(true)
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
    guard.account_id = None;
    Ok(())
}

fn clear_session_if_matches(
    state: &AppState,
    expected: &SessionState,
) -> Result<(), AppResult<AuthSessionPayload>> {
    let mut guard = state.session.lock().map_err(|_| {
        AppResult::fail(
            ErrorCode::InternalError,
            "Failed to access session state",
            None,
        )
    })?;
    if guard.account_id == expected.account_id
        && guard.actor_id == expected.actor_id
        && guard.token == expected.token
    {
        *guard = SessionState::default();
    }
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
    let transition = match state.identity_transition.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "Failed to coordinate identity transition",
                None,
            )
        }
    };
    let Some(account_id) = session_vault::active_account_id() else {
        return AppResult::fail(
            ErrorCode::NotFound,
            "No station session found to restore",
            None,
        );
    };
    match prepare_station_session_for_account_during_transition(
        state,
        &transition,
        &account_id,
        None,
    ) {
        Ok(prepared) => commit_legacy_prepared_session(state, prepared),
        Err(error) => error,
    }
}

pub(crate) fn prepare_station_session_for_account_during_transition(
    state: &AppState,
    _transition: &MutexGuard<'_, ()>,
    account_id: &str,
    expected_actor_id: Option<&str>,
) -> PreparedAuthResult {
    if session_vault::account_requires_pin(account_id) {
        session_vault::purge_raw_session_for_account(account_id);
        return Err(unauthorized(
            "pin required",
            json!({ "command": "ensure_station_session", "reason": "pin_required" }),
        ));
    }

    let blob = match session_vault::load_raw_session_for_account(
        account_id,
        Some(SessionSource::OauthBridge),
    ) {
        Ok(Some(b)) => b,
        Ok(None) => {
            return Err(AppResult::fail(
                ErrorCode::NotFound,
                "No station session found to restore",
                None,
            ))
        }
        Err(SessionVaultError::PinRequired { .. }) => {
            return Err(unauthorized(
                "pin required",
                json!({ "command": "ensure_station_session", "reason": "pin_required" }),
            ))
        }
        Err(error) => return Err(session_vault_to_app(error)),
    };

    let actor_id = blob.actor_id;
    let token = blob.token;
    if expected_actor_id.is_some_and(|expected| expected != actor_id) {
        return Err(unauthorized(
            "OAuth loopback actor does not match persisted session",
            json!({
                "command": "ensure_station_session",
                "reason": "loopback_actor_mismatch"
            }),
        ));
    }
    let session = match validate_token(&token) {
        Ok(session) => session,
        Err(error) => {
            session_vault::purge_raw_session_for_account(account_id);
            return Err(map_domain_error(error));
        }
    };
    if session.actor_id != actor_id {
        session_vault::purge_raw_session_for_account(account_id);
        return Err(unauthorized(
            "OAuth token does not belong to the persisted session actor",
            json!({
                "command": "ensure_station_session",
                "reason": "account_actor_mismatch"
            }),
        ));
    }
    if let Err(error) = verify_session_with_station(&token) {
        return Err(error);
    }
    if let Err(error) =
        persist_session_if_unprotected(account_id, &session, SessionSource::OauthBridge)
    {
        return Err(error);
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

    mark_account_has_session(account_id, &session.token);

    Ok(PreparedAuthSession {
        payload: AuthSessionPayload {
            command: "ensure_station_session".to_string(),
            status: "authenticated".to_string(),
            actor_id: Some(actor_id.clone()),
            ptid: canonical_ptid_for_token(&session.token),
            name: p_name,
            email: p_email,
            avatar_url: p_avatar,
            avatar_local_path: p_local_avatar,
            login_method: Some("oauth".to_string()),
        },
        account_id: account_id.to_string(),
        actor_id,
        token: session.token,
    })
}

pub(crate) fn verify_session_with_station(
    token: &str,
) -> Result<(), AppResult<AuthSessionPayload>> {
    station_client::request_peers_proto_no_body::<ActorProfile>(
        reqwest::Method::GET,
        "/actor/profile",
        token,
        None,
    )
    .map(|_| ())
    .map_err(|error| error.into_app_result("Session validation failed"))
}

#[cfg(test)]
mod tests {
    use super::{
        apply_session_identity, session_belongs_to_selected_account, validate_pin_session_token,
    };
    use crate::domain::auth::session::AuthSession;
    use crate::state::SessionState;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    fn session(actor_id: &str, token: &str) -> AuthSession {
        AuthSession {
            actor_id: actor_id.to_string(),
            token: token.to_string(),
            expires_at: 0,
        }
    }

    fn jwt_for_actor(actor_id: &str) -> String {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"HS256"}"#);
        let payload = URL_SAFE_NO_PAD.encode(
            serde_json::json!({
                "subject_id": actor_id,
                "exp": u64::MAX,
            })
            .to_string(),
        );
        format!("{header}.{payload}.signature")
    }

    #[test]
    fn restored_session_commits_account_with_rotated_token() {
        let mut target = SessionState::default();

        apply_session_identity(
            &mut target,
            &session("actor-new", "token-new"),
            Some("station:account-new"),
        );

        assert_eq!(target.actor_id.as_deref(), Some("actor-new"));
        assert_eq!(target.token.as_deref(), Some("token-new"));
        assert_eq!(target.account_id.as_deref(), Some("station:account-new"));
    }

    #[test]
    fn token_validation_preserves_committed_account() {
        let mut target = SessionState {
            actor_id: Some("actor-old".to_string()),
            token: Some("token-old".to_string()),
            account_id: Some("station:account-current".to_string()),
        };

        apply_session_identity(
            &mut target,
            &session("actor-current", "token-current"),
            None,
        );

        assert_eq!(target.actor_id.as_deref(), Some("actor-current"));
        assert_eq!(target.token.as_deref(), Some("token-current"));
        assert_eq!(
            target.account_id.as_deref(),
            Some("station:account-current"),
        );
    }

    #[test]
    fn restore_rejects_in_memory_session_owned_by_previous_account() {
        let previous = SessionState {
            actor_id: Some("actor-old".to_string()),
            token: Some("token-old".to_string()),
            account_id: Some("station:account-old".to_string()),
        };

        assert!(!session_belongs_to_selected_account(
            &previous,
            Some("station:account-new"),
        ));
        assert!(session_belongs_to_selected_account(
            &previous,
            Some("station:account-old"),
        ));
    }

    #[test]
    fn pin_unlock_uses_jwt_actor_when_oauth_provider_user_differs() {
        let account_id = "station:scope:github:provider-user-123";
        let token = jwt_for_actor("ptid:v1:actor:canonical-456");

        let session = validate_pin_session_token(
            account_id,
            account_id,
            Some("ptid:v1:actor:canonical-456"),
            &token,
        )
        .expect("JWT actor should be authoritative");

        assert_eq!(session.actor_id, "ptid:v1:actor:canonical-456");
        assert_ne!(session.actor_id, "provider-user-123");
    }
}
