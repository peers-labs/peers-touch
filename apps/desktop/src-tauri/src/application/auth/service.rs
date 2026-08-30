use crate::contracts::{
    AccessDecisionPayload, AccessSubmitInviteInput, AccessSubmitLoginInput, AuthLoginInput,
    AuthSessionPayload, AuthValidateTokenInput,
};
use crate::domain::auth::session::{
    from_station_response, validate_login_input, validate_token, AuthDomainError, AuthSession,
};
use crate::domain::identity::{ActiveSession, ActorRef};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::auth_identity::AccountIdentityState;
use crate::infrastructure::session_store::SessionSource;
use crate::infrastructure::session_vault::{self, SessionVaultError};
use crate::infrastructure::station_client;
use crate::model::actor::ActorProfile;
use crate::state::AppState;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::MutexGuard;

pub(crate) struct PreparedAuthSession {
    pub payload: AuthSessionPayload,
    pub account_id: String,
    pub actor_ptid: String,
    pub token: String,
    pub revoked_previous_actor_sessions: bool,
    pub identity_state: Option<AccountIdentityState>,
}

impl PreparedAuthSession {
    pub fn active_session(&self, window_label: &str) -> ActiveSession {
        ActiveSession::new(
            window_label,
            self.account_id.clone(),
            ActorRef::new_person(self.actor_ptid.clone()),
            self.token.clone(),
        )
    }

    pub(crate) fn with_fallback_active_identity_state(
        mut self,
        state: AccountIdentityState,
    ) -> Result<Self, String> {
        if self.identity_state.is_none() {
            self.identity_state = Some(restore_account_session_state(state, &self.account_id)?);
        }
        Ok(self)
    }
}

type PreparedAuthResult = Result<PreparedAuthSession, AppResult<AuthSessionPayload>>;

pub(crate) fn validate_pin_session_token(
    account_id: &str,
    persisted_account_id: &str,
    persisted_actor_ptid: Option<&str>,
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
    if session.actor_ptid.trim().is_empty() {
        return Err(unauthorized(
            "unlocked token has no actor subject",
            json!({
                "command": "account_unlock",
                "reason": "actor_missing"
            }),
        ));
    }
    let Some(persisted_actor_ptid) =
        persisted_actor_ptid.filter(|actor_ptid| !actor_ptid.trim().is_empty())
    else {
        return Err(unauthorized(
            "encrypted session has no persisted actor binding; sign in again",
            json!({
                "command": "account_unlock",
                "reason": "persisted_actor_missing"
            }),
        ));
    };
    if persisted_actor_ptid != session.actor_ptid {
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
        &session.actor_ptid,
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
        if let Some(actor_ref) = profile.r#ref {
            if actor_ref.ptid.starts_with("ptid:") {
                return Some(actor_ref.ptid);
            }
        }
    }
    None
}

pub(crate) fn activate_messaging_profile(
    state: &AppState,
    account_id: &str,
    actor_ptid: &str,
    token: &str,
) -> Result<(), String> {
    let preparation = prepare_messaging_profile_activation(state, account_id, actor_ptid, token)?;
    if let Err(error) = commit_messaging_profile_activation(state, &preparation, token) {
        return match rollback_messaging_profile_preparation(state, preparation) {
            Ok(()) => Err(error),
            Err(rollback) => Err(format!(
                "{error}; messaging preparation rollback failed: {rollback}"
            )),
        };
    }
    Ok(())
}

pub(crate) struct PreparedMessagingActivation {
    account_id: String,
    engine_existed: bool,
}

pub(crate) fn prepare_messaging_profile_activation(
    state: &AppState,
    account_id: &str,
    actor_ptid: &str,
    token: &str,
) -> Result<PreparedMessagingActivation, String> {
    if account_id.trim().is_empty() || actor_ptid.trim().is_empty() || token.trim().is_empty() {
        return Err("messaging activation identity is incomplete".to_string());
    }
    if !actor_ptid.starts_with("ptid:") {
        return Err("messaging activation requires canonical actor PTID".to_string());
    }
    let engine_existed = state.messaging_engines.get(account_id)?.is_some();
    let identity_key_ref =
        crate::infrastructure::local_scope::LocalScope::from_actor_ptid(actor_ptid)
            .identity_key_ref();
    let actor_identity = crate::domain::crypto::get_or_create_identity(&identity_key_ref)
        .map_err(|error| format!("messaging actor identity unavailable: {error}"))?;
    if let Err(error) = state.messaging_engines.activate_profile(
        account_id.to_string(),
        actor_ptid.to_string(),
        actor_identity.seed_bytes(),
        crate::messaging::INITIAL_ACTOR_IDENTITY_PROFILE_VERSION,
    ) {
        if !engine_existed {
            let _ = deactivate_messaging_profile(state, account_id);
        }
        return Err(error);
    }
    Ok(PreparedMessagingActivation {
        account_id: account_id.to_string(),
        engine_existed,
    })
}

pub(crate) fn commit_messaging_profile_activation(
    state: &AppState,
    preparation: &PreparedMessagingActivation,
    token: &str,
) -> Result<(), String> {
    state
        .messaging_engines
        .activate_profile_worker(&preparation.account_id, token.to_string())
}

pub(crate) fn rollback_messaging_profile_preparation(
    state: &AppState,
    preparation: PreparedMessagingActivation,
) -> Result<(), String> {
    if preparation.engine_existed {
        Ok(())
    } else {
        deactivate_messaging_profile(state, &preparation.account_id)
    }
}

pub(crate) fn invalidate_revoked_actor_runtime(
    state: &AppState,
    actor_ptid: &str,
    account_id: &str,
) -> Result<(), String> {
    let mut failures = Vec::new();
    let mut affected_accounts = match state.sessions.try_unbind_actor(actor_ptid) {
        Ok(removed_sessions) => removed_sessions
            .into_iter()
            .map(|session| session.account_id)
            .collect::<HashSet<_>>(),
        Err(error) => {
            failures.push(format!("window session cleanup failed: {error}"));
            HashSet::new()
        }
    };
    affected_accounts.insert(account_id.to_string());

    crate::infrastructure::event_stream::stop(actor_ptid);
    match crate::infrastructure::auth_identity::read_state() {
        Ok(mut identity_state) => {
            for account in &mut identity_state.accounts {
                if affected_accounts.contains(&account.id) {
                    account.encrypted_session = None;
                    account.session_expires_at = None;
                    account.has_session = false;
                }
            }
            if identity_state
                .active_account_id
                .as_ref()
                .is_some_and(|active| affected_accounts.contains(active))
            {
                identity_state.active_account_id = None;
            }
            if let Err(error) = crate::infrastructure::auth_identity::write_state(&identity_state) {
                failures.push(format!("durable actor invalidation failed: {error}"));
            }
        }
        Err(error) => failures.push(format!("durable actor state read failed: {error}")),
    }
    for affected_account in &affected_accounts {
        session_vault::purge_raw_session_for_account(affected_account);
    }
    for affected_account in affected_accounts {
        if let Err(error) = state
            .messaging_engines
            .deactivate_profile_worker(&affected_account)
        {
            failures.push(format!("{affected_account}: {error}"));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "failed to deactivate revoked actor messaging workers: {}",
            failures.join("; ")
        ))
    }
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
    commit_http_gateway_session_with_identity_state(state, prepared)
}

pub(crate) fn commit_http_gateway_session_with_identity_state(
    state: &AppState,
    prepared: PreparedAuthSession,
) -> AppResult<AuthSessionPayload> {
    commit_http_gateway_session_with_identity_writer(
        state,
        prepared,
        crate::infrastructure::auth_identity::write_state,
    )
}

#[cfg(feature = "acceptance-webdriver")]
pub(crate) fn commit_http_gateway_session_with_identity_write_failure(
    state: &AppState,
    prepared: PreparedAuthSession,
) -> AppResult<AuthSessionPayload> {
    commit_http_gateway_session_with_identity_writer(state, prepared, |_| {
        Err("injected durable active account write failure".to_string())
    })
}

fn commit_http_gateway_session_with_identity_writer(
    state: &AppState,
    prepared: PreparedAuthSession,
    write_identity: impl Fn(&AccountIdentityState) -> Result<(), String>,
) -> AppResult<AuthSessionPayload> {
    let previous_identity_state = match prepared.identity_state.as_ref() {
        Some(_) => match crate::infrastructure::auth_identity::read_state() {
            Ok(state) => Some(state),
            Err(error) => {
                return AppResult::fail(ErrorCode::InternalError, error, None);
            }
        },
        None => None,
    };
    let activation = match prepare_messaging_profile_activation(
        state,
        &prepared.account_id,
        &prepared.actor_ptid,
        &prepared.token,
    ) {
        Ok(activation) => activation,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to prepare messaging identity: {error}"),
                Some(json!({
                    "command": prepared.payload.command,
                    "reason": "engine_preparation_failed"
                })),
            )
        }
    };

    let binding = match state
        .sessions
        .try_bind_exclusive(prepared.active_session("http-gateway"))
    {
        Ok(binding) => binding,
        Err(error) => {
            let rollback_error = rollback_messaging_profile_preparation(state, activation).err();
            let message = rollback_error.map_or_else(
                || format!("Failed to commit authenticated identity: {error}"),
                |rollback| {
                    format!(
                        "Failed to commit authenticated identity: {error}; messaging preparation rollback failed: {rollback}"
                    )
                },
            );
            return AppResult::fail(
                ErrorCode::InternalError,
                message,
                Some(json!({
                    "command": prepared.payload.command,
                    "reason": "identity_commit_failed"
                })),
            );
        }
    };
    if let Err(error) = prepared
        .identity_state
        .as_ref()
        .map(&write_identity)
        .transpose()
    {
        let runtime_rollback = state.sessions.rollback_exclusive(binding).err();
        let preparation_rollback = rollback_messaging_profile_preparation(state, activation).err();
        let rollback_error = [runtime_rollback, preparation_rollback]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("; ");
        let message = if rollback_error.is_empty() {
            format!("Failed to commit authenticated identity: {error}")
        } else {
            format!(
                "Failed to commit authenticated identity: {error}; rollback failed: {rollback_error}"
            )
        };
        return AppResult::fail(
            ErrorCode::InternalError,
            message,
            Some(json!({
                "command": prepared.payload.command,
                "reason": "identity_commit_failed"
            })),
        );
    }

    if let Err(error) = commit_messaging_profile_activation(state, &activation, &prepared.token) {
        let runtime_rollback = state.sessions.rollback_exclusive(binding).err();
        let durable_rollback = previous_identity_state
            .as_ref()
            .map(&write_identity)
            .transpose()
            .err();
        let preparation_rollback = rollback_messaging_profile_preparation(state, activation).err();
        let rollback_error = [runtime_rollback, durable_rollback, preparation_rollback]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("; ");
        let message = if rollback_error.is_empty() {
            format!("Failed to activate committed messaging identity: {error}")
        } else {
            format!(
                "Failed to activate committed messaging identity: {error}; rollback failed: {rollback_error}"
            )
        };
        return AppResult::fail(
            ErrorCode::InternalError,
            message,
            Some(json!({
                "command": prepared.payload.command,
                "reason": "engine_activation_failed"
            })),
        );
    }

    AppResult::success(prepared.payload)
}

/*
 * The HTTP gateway uses the reserved `http-gateway` registry label above.
 * Tauri windows commit the same prepared session through the command-layer
 * transaction so both paths retain one PTID-scoped runtime authority.
 */

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
    let station_peer_id = station_client::active_station_peer_id().ok_or_else(|| {
        AppResult::fail(
            ErrorCode::Unauthorized,
            "Access gate start failed: active Station identity is unavailable",
            None,
        )
    })?;
    let data = access_post::<T>(
        "/actor/access/start",
        json!({
            "station_peer_id": station_peer_id,
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

    let actor_ref = value_field(&data, "actor_ref", "actorRef")
        .cloned()
        .unwrap_or(Value::Null);
    let actor_ptid = string_field(&actor_ref, "ptid", "ptid");
    if !actor_ptid.starts_with("ptid:") {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "Login response missing canonical actor PTID",
            None,
        ));
    }

    let profile = station_client::request_peers_proto_no_body::<ActorProfile>(
        reqwest::Method::GET,
        "/actor/profile",
        &token,
        None,
    )
    .ok();
    let name = profile
        .as_ref()
        .map(|profile| profile.display_name.clone())
        .unwrap_or_default();
    let email_str = String::new();
    let avatar = profile
        .as_ref()
        .map(|profile| profile.avatar.clone())
        .unwrap_or_default();

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
    let session = from_station_response(actor_ptid.clone(), token);
    let expected_account_id =
        crate::infrastructure::local_scope::account_id_for_password_ptid(&actor_ptid);
    if let Err(error) = invalidate_revoked_actor_runtime(state, &actor_ptid, &expected_account_id) {
        return Err(AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to invalidate revoked actor runtime: {error}"),
            Some(json!({
                "command": command,
                "reason": "revoked_runtime_invalidation_failed"
            })),
        ));
    }

    let (account_id, mut identity_state) =
        match crate::infrastructure::auth_identity::prepare_password_upsert(
            &actor_ptid,
            &name,
            &email_str,
            if avatar.is_empty() {
                None
            } else {
                Some(avatar.as_str())
            },
        ) {
            Ok(prepared) => prepared,
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
        crate::application::profile::avatar_resolve_local(&avatar)
    } else {
        None
    };
    if let Some(account) = identity_state
        .accounts
        .iter_mut()
        .find(|account| account.id == account_id)
    {
        account.avatar_local_path = avatar_local_path.clone();
    }

    if let Err(error) = mark_account_has_session(&mut identity_state, &account_id) {
        return Err(AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to prepare account session state: {error}"),
            None,
        ));
    }
    Ok(PreparedAuthSession {
        payload: AuthSessionPayload {
            command: command.to_string(),
            status: "authenticated".to_string(),
            actor_ptid: Some(actor_ptid.clone()),
            session_token: Some(access_token),
            name: Some(name),
            email: Some(email_str),
            avatar_url: Some(avatar),
            avatar_local_path,
            login_method: Some("password".to_string()),
        },
        account_id,
        actor_ptid,
        token: session.token,
        revoked_previous_actor_sessions: true,
        identity_state: Some(identity_state),
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
    auth_logout_during_transition(state, &transition, state.sessions.get("http-gateway"))
}

pub(crate) fn auth_logout_during_transition(
    state: &AppState,
    _transition: &MutexGuard<'_, ()>,
    committed_session: Option<ActiveSession>,
) -> AppResult<AuthSessionPayload> {
    let Some(target_session) = committed_session else {
        return unauthorized(
            "missing session",
            json!({ "command": "auth_logout", "reason": "session_missing" }),
        );
    };
    let account_id = target_session.account_id;
    {
        let _ = crate::infrastructure::auth_identity::clear_account_session(&account_id);
        if let Err(error) = deactivate_messaging_profile(state, &account_id) {
            tracing::warn!(account_id = %account_id, error = %error, "failed to deactivate messaging profile");
        }
        session_vault::purge_raw_session_for_account(&account_id);
    }
    state.sessions.unbind(&target_session.window_label);
    crate::infrastructure::event_stream::stop(&target_session.actor.ptid);
    AppResult::success(AuthSessionPayload {
        command: "auth_logout".to_string(),
        status: "logged_out".to_string(),
        actor_ptid: None,
        session_token: None,
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
        crate::infrastructure::event_stream::stop(&session.actor.ptid);
    }
    Ok(())
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
    let Some(account_id) = selected_account.map(str::to_string) else {
        return Err(unauthorized(
            "missing session",
            json!({ "command": "auth_restore_session", "reason": "session_missing" }),
        ));
    };
    if session_vault::account_requires_pin(&account_id) {
        session_vault::purge_raw_session_for_account(&account_id);
        return Err(unauthorized(
            "pin required",
            json!({ "command": "auth_restore_session", "reason": "pin_required" }),
        ));
    }
    let blob = match session_vault::load_raw_session_for_account(&account_id, None) {
        Ok(Some(blob)) => blob,
        Ok(None) => {
            return Err(unauthorized(
                "missing session",
                json!({ "command": "auth_restore_session", "reason": "session_missing" }),
            ))
        }
        Err(error) => return Err(session_vault_to_app(error)),
    };
    let initial_session = match validate_token(&blob.token) {
        Ok(session) => session,
        Err(error) => return Err(map_domain_error(error)),
    };
    if initial_session.actor_ptid != blob.actor_ptid {
        session_vault::purge_raw_session_for_account(&account_id);
        return Err(unauthorized(
            "restored token does not belong to the persisted actor PTID",
            json!({
                "command": "auth_restore_session",
                "reason": "account_actor_mismatch"
            }),
        ));
    }
    let token = match takeover_station_session_token(&blob.token) {
        Ok(token) => {
            if let Err(error) =
                invalidate_revoked_actor_runtime(state, &initial_session.actor_ptid, &account_id)
            {
                session_vault::purge_raw_session_for_account(&account_id);
                return Err(AppResult::fail(
                    ErrorCode::InternalError,
                    format!("Failed to invalidate revoked actor runtime: {error}"),
                    Some(json!({
                        "command": "auth_restore_session",
                        "reason": "revoked_runtime_invalidation_failed"
                    })),
                ));
            }
            token
        }
        Err(error) => {
            session_vault::purge_raw_session_for_account(&account_id);
            return Err(session_takeover_failed(error, Some(&account_id), None));
        }
    };
    let session = match validate_token(&token) {
        Ok(session) => session,
        Err(error) => {
            session_vault::purge_raw_session_for_account(&account_id);
            return Err(map_domain_error(error));
        }
    };
    if session.actor_ptid != blob.actor_ptid {
        session_vault::purge_raw_session_for_account(&account_id);
        return Err(unauthorized(
            "session actor PTID mismatch",
            json!({ "command": "auth_restore_session", "reason": "actor_ptid_mismatch" }),
        ));
    }
    if let Err(error) = verify_session_with_station(&token) {
        session_vault::purge_raw_session_for_account(&account_id);
        return Err(error);
    }
    if let Err(error) =
        persist_session_if_unprotected(&account_id, &session, SessionSource::Password)
    {
        return Err(error);
    }
    let identity_state = match crate::infrastructure::auth_identity::read_state() {
        Ok(state) => state,
        Err(error) => {
            return Err(AppResult::fail(ErrorCode::InternalError, error, None));
        }
    };
    let identity_state = match restore_account_session_state(identity_state, &account_id) {
        Ok(state) => Some(state),
        Err(error) => {
            return Err(AppResult::fail(ErrorCode::InternalError, error, None));
        }
    };
    let profile =
        crate::infrastructure::auth_identity::find_profile_by_actor_ptid(&session.actor_ptid);
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
    let token = session.token.clone();
    Ok(PreparedAuthSession {
        payload: AuthSessionPayload {
            command: "auth_restore_session".to_string(),
            status: "restored".to_string(),
            actor_ptid: Some(session.actor_ptid.clone()),
            session_token: Some(token.clone()),
            name: p_name,
            email: p_email,
            avatar_url: p_avatar,
            avatar_local_path: p_local_avatar,
            login_method: p_method,
        },
        account_id,
        actor_ptid: session.actor_ptid,
        token,
        revoked_previous_actor_sessions: true,
        identity_state,
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
    auth_validate_token_during_transition(
        input,
        state,
        &transition,
        state.sessions.get("http-gateway"),
    )
}

pub(crate) fn auth_validate_token_during_transition(
    input: AuthValidateTokenInput,
    state: &AppState,
    _transition: &MutexGuard<'_, ()>,
    committed_session: Option<ActiveSession>,
) -> AppResult<AuthSessionPayload> {
    let Some(snapshot) = committed_session else {
        return unauthorized(
            "missing committed session",
            json!({ "command": "auth_validate_token", "reason": "session_missing" }),
        );
    };
    let token = match input.token {
        Some(token) if !token.trim().is_empty() => token,
        _ => snapshot.jwt.clone(),
    };
    let session = match validate_token(&token) {
        Ok(session) => session,
        Err(error) => return map_domain_error(error),
    };
    if let Err(error) = verify_session_with_station(&token) {
        return error;
    }
    if snapshot.actor.ptid != session.actor_ptid {
        return unauthorized(
            "validated token does not belong to the committed session actor",
            json!({
                "command": "auth_validate_token",
                "reason": "account_actor_mismatch"
            }),
        );
    };
    let account_id = snapshot.account_id;
    if let Err(error) =
        persist_session_if_unprotected(&account_id, &session, SessionSource::Password)
    {
        return error;
    }
    if let Err(error) =
        activate_messaging_profile(state, &account_id, &session.actor_ptid, &session.token)
    {
        tracing::warn!(
            account_id = %account_id,
            actor_ptid = %session.actor_ptid,
            error = %error,
            "validated session retained while durable messaging activation awaits retry"
        );
    }
    AppResult::success(AuthSessionPayload {
        command: "auth_validate_token".to_string(),
        status: "valid".to_string(),
        actor_ptid: Some(session.actor_ptid.clone()),
        session_token: Some(session.token.clone()),
        name: None,
        email: None,
        avatar_url: None,
        avatar_local_path: None,
        login_method: None,
    })
}

fn session_vault_to_app(e: SessionVaultError) -> AppResult<AuthSessionPayload> {
    AppResult::fail(
        ErrorCode::InternalError,
        format!("Session persistence error: {e}"),
        None,
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
fn mark_account_has_session(
    state: &mut AccountIdentityState,
    account_id: &str,
) -> Result<(), String> {
    for account in &mut state.accounts {
        if account.id != account_id && account.pin_protection.is_none() {
            account.has_session = false;
        }
    }

    let account = state
        .accounts
        .iter_mut()
        .find(|account| account.id == account_id)
        .ok_or_else(|| format!("account not found: {account_id}"))?;
    account.has_session = true;
    state.active_account_id = Some(account_id.to_string());
    Ok(())
}

fn restore_account_session_state(
    mut state: AccountIdentityState,
    account_id: &str,
) -> Result<AccountIdentityState, String> {
    mark_account_has_session(&mut state, account_id)?;
    Ok(state)
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
    expected_actor_ptid: Option<&str>,
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

    let actor_ptid = blob.actor_ptid;
    let token = blob.token;
    if expected_actor_ptid.is_some_and(|expected| expected != actor_ptid) {
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
    if session.actor_ptid != actor_ptid {
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

    let profile = crate::infrastructure::auth_identity::find_profile_by_actor_ptid(&actor_ptid);
    let (p_name, p_email, p_avatar, p_local_avatar) = match &profile {
        Some(p) => (
            Some(p.name.clone()).filter(|v| !v.is_empty()),
            Some(p.email.clone()).filter(|v| !v.is_empty()),
            Some(p.avatar_url.clone()).filter(|v| !v.is_empty()),
            p.avatar_local_path.clone().filter(|v| !v.is_empty()),
        ),
        None => (None, None, None, None),
    };

    let mut identity_state = match crate::infrastructure::auth_identity::read_state() {
        Ok(state) => state,
        Err(error) => {
            return Err(AppResult::fail(
                ErrorCode::InternalError,
                format!("Failed to read account session state: {error}"),
                None,
            ))
        }
    };
    if let Err(error) = mark_account_has_session(&mut identity_state, account_id) {
        return Err(AppResult::fail(
            ErrorCode::InternalError,
            format!("Failed to prepare account session state: {error}"),
            None,
        ));
    }

    Ok(PreparedAuthSession {
        payload: AuthSessionPayload {
            command: "ensure_station_session".to_string(),
            status: "authenticated".to_string(),
            actor_ptid: Some(actor_ptid.clone()),
            session_token: Some(session.token.clone()),
            name: p_name,
            email: p_email,
            avatar_url: p_avatar,
            avatar_local_path: p_local_avatar,
            login_method: Some("oauth".to_string()),
        },
        account_id: account_id.to_string(),
        actor_ptid,
        token: session.token,
        revoked_previous_actor_sessions: false,
        identity_state: Some(identity_state),
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
    use super::{restore_account_session_state, validate_pin_session_token, PreparedAuthSession};
    use crate::contracts::AuthSessionPayload;
    use crate::infrastructure::auth_identity::{AccountIdentity, AccountIdentityState};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    fn jwt_for_actor(actor_ptid: &str) -> String {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"HS256"}"#);
        let payload = URL_SAFE_NO_PAD.encode(
            serde_json::json!({
                "subject_ptid": actor_ptid,
                "exp": u64::MAX,
            })
            .to_string(),
        );
        format!("{header}.{payload}.signature")
    }

    #[test]
    fn restored_takeover_reactivates_durable_account_session() {
        let state = AccountIdentityState {
            active_account_id: None,
            accounts: vec![
                AccountIdentity {
                    id: "station:account-old".to_string(),
                    has_session: true,
                    ..AccountIdentity::default()
                },
                AccountIdentity {
                    id: "station:account-restored".to_string(),
                    has_session: false,
                    ..AccountIdentity::default()
                },
            ],
        };

        let restored = restore_account_session_state(state, "station:account-restored")
            .expect("restored account should remain durable");

        assert_eq!(
            restored.active_account_id.as_deref(),
            Some("station:account-restored")
        );
        assert!(!restored.accounts[0].has_session);
        assert!(restored.accounts[1].has_session);
    }

    #[test]
    fn caller_fallback_does_not_replace_prepared_restore_state() {
        let prepared_state = restore_account_session_state(
            AccountIdentityState {
                active_account_id: None,
                accounts: vec![AccountIdentity {
                    id: "station:account-restored".to_string(),
                    has_session: false,
                    ..AccountIdentity::default()
                }],
            },
            "station:account-restored",
        )
        .expect("restore state should be prepared");
        let prepared = PreparedAuthSession {
            payload: AuthSessionPayload {
                command: "auth_restore_session".to_string(),
                status: "restored".to_string(),
                actor_ptid: Some("ptid:restored".to_string()),
                session_token: Some("token".to_string()),
                name: None,
                email: None,
                avatar_url: None,
                avatar_local_path: None,
                login_method: None,
            },
            account_id: "station:account-restored".to_string(),
            actor_ptid: "ptid:restored".to_string(),
            token: "token".to_string(),
            revoked_previous_actor_sessions: true,
            identity_state: Some(prepared_state),
        };
        let stale_fallback = AccountIdentityState {
            active_account_id: None,
            accounts: vec![AccountIdentity {
                id: "station:account-restored".to_string(),
                has_session: false,
                ..AccountIdentity::default()
            }],
        };

        let prepared = prepared
            .with_fallback_active_identity_state(stale_fallback)
            .expect("prepared restore state should remain valid");
        let committed = prepared
            .identity_state
            .expect("prepared restore state must win over caller fallback");

        assert_eq!(
            committed.active_account_id.as_deref(),
            Some("station:account-restored")
        );
        assert!(committed.accounts[0].has_session);
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

        assert_eq!(session.actor_ptid, "ptid:v1:actor:canonical-456");
        assert_ne!(session.actor_ptid, "provider-user-123");
    }

    #[test]
    fn pin_unlock_rejects_legacy_session_without_actor_binding() {
        let account_id = "station:scope:github:provider-user-123";
        let token = jwt_for_actor("ptid:v1:actor:canonical-456");

        for persisted_actor_ptid in [None, Some("")] {
            let error = match validate_pin_session_token(
                account_id,
                account_id,
                persisted_actor_ptid,
                &token,
            ) {
                Ok(_) => panic!("legacy PIN session must require a fresh login"),
                Err(error) => error,
            };

            assert_eq!(
                error
                    .error
                    .and_then(|error| error.details)
                    .and_then(|details| details.get("reason").cloned()),
                Some(serde_json::json!("persisted_actor_missing"))
            );
        }
    }
}
