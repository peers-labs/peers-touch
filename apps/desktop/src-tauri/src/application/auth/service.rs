use crate::contracts::{
    AccessDecisionInput, AccessDecisionPayload, AccessDecisionProjection,
    AccessGateActionProjection, AccessGateProjection, AccessSubmitInviteInput,
    AccessSubmitLoginInput, AuthSessionPayload, AuthValidateTokenInput,
};
use crate::domain::auth::session::{
    from_station_response, validate_login_input, validate_token, AuthDomainError, AuthSession,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::session_store::SessionSource;
use crate::infrastructure::session_vault::{self, SessionVaultError};
use crate::infrastructure::station_client;
use crate::model::access_gate::{
    submit_access_gate_request, AccessDecision, AccessDecisionState, AccessGateClientInfo,
    AccessGateState, AccessGateType, CancelAccessAttemptRequest, CancelAccessAttemptResponse,
    GetAccessDecisionRequest, GetAccessDecisionResponse, StartAccessAttemptRequest,
    StartAccessAttemptResponse, SubmitAccessGateRequest, SubmitAccessGateResponse,
};
use crate::model::actor::ActorProfile;
use crate::model::auth::{LoginRequest, LoginResponse};
use crate::state::AppState;
use serde_json::json;
use zeroize::Zeroizing;

pub(crate) const DESKTOP_SESSION_CLASS: &str = "desktop";

pub(crate) fn takeover_station_session_token(
    token: &str,
) -> Result<String, station_client::StationClientError> {
    takeover_station_session_token_for_device(token, DESKTOP_SESSION_CLASS)
}

pub(crate) fn takeover_station_session_token_for_device(
    token: &str,
    device_type: &str,
) -> Result<String, station_client::StationClientError> {
    let body = json!({ "device_type": device_type });
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
    prepare_messaging_profile(state, account_id, actor_ptid)?;
    activate_messaging_profile_worker(state, account_id, token)
}

pub(crate) fn prepare_messaging_profile(
    state: &AppState,
    account_id: &str,
    actor_ptid: &str,
) -> Result<(), String> {
    if account_id.trim().is_empty() || actor_ptid.trim().is_empty() {
        return Err("messaging activation identity is incomplete".to_string());
    }
    if !actor_ptid.starts_with("ptid:") {
        return Err("messaging activation requires canonical actor PTID".to_string());
    }
    let identity_key_ref =
        crate::infrastructure::local_scope::LocalScope::from_actor_ptid(actor_ptid)
            .identity_key_ref();
    let actor_identity = crate::domain::crypto::get_or_create_identity(&identity_key_ref)
        .map_err(|error| format!("messaging actor identity unavailable: {error}"))?;
    let actor_identity_seed = Zeroizing::new(actor_identity.seed_bytes());
    state.messaging_engines.activate_profile(
        account_id.to_string(),
        actor_ptid.to_string(),
        &actor_identity_seed,
        crate::messaging::INITIAL_ACTOR_IDENTITY_PROFILE_VERSION,
    )?;
    Ok(())
}

pub(crate) fn activate_messaging_profile_worker(
    state: &AppState,
    account_id: &str,
    token: &str,
) -> Result<(), String> {
    if account_id.trim().is_empty() || token.trim().is_empty() {
        return Err("messaging worker activation identity is incomplete".to_string());
    }
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

fn access_post<Req, Resp, T>(
    path: &str,
    body: &Req,
    err_code: ErrorCode,
    context: &str,
) -> Result<Resp, AppResult<T>>
where
    Req: prost::Message,
    Resp: prost::Message + Default,
    T: serde::Serialize,
{
    station_client::post_peers_proto_no_auth(path, body).map_err(|error| {
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
    })
}

fn should_resume_access_binding(
    phase: &crate::application::station_binding::StationBindingPhase,
) -> bool {
    matches!(
        phase,
        crate::application::station_binding::StationBindingPhase::Connecting
            | crate::application::station_binding::StationBindingPhase::Failed
    )
}

fn access_scope<T: serde::Serialize>() -> Result<(String, String, u64), AppResult<T>> {
    let binding_service = crate::application::station_binding::service();
    let mut binding = binding_service.state();
    if should_resume_access_binding(&binding.phase) {
        binding = binding_service
            .resume_persisted(station_client::station_registry())
            .map_err(|error| {
                AppResult::fail(
                    ErrorCode::Conflict,
                    error.message,
                    Some(json!({
                        "code": error.code,
                        "retryable": error.retryable,
                    })),
                )
            })?;
    }
    if binding.phase != crate::application::station_binding::StationBindingPhase::AccessGate
        && binding.phase != crate::application::station_binding::StationBindingPhase::Bound
    {
        return Err(AppResult::fail(
            ErrorCode::Conflict,
            "Station identity has not been verified",
            None,
        ));
    }
    if binding.bound_url.as_deref() != Some(station_client::station_base_url().as_str()) {
        return Err(AppResult::fail(
            ErrorCode::Conflict,
            "Verified Station scope does not match the active Station",
            None,
        ));
    }
    let station_peer_id = station_client::active_station_peer_id().ok_or_else(|| {
        AppResult::fail(
            ErrorCode::Unauthorized,
            "Active Station identity is unavailable",
            None,
        )
    })?;
    let device_id = crate::application::key_exchange::device_install::get_or_create_device_id()
        .map_err(|error| {
            AppResult::fail(
                ErrorCode::InternalError,
                format!("Canonical device identity is unavailable: {error}"),
                None,
            )
        })?;
    station_client::set_device_id(device_id.clone());
    let generation = binding.generation;
    if generation == 0 {
        return Err(AppResult::fail(
            ErrorCode::Conflict,
            "Station scope is not ready",
            None,
        ));
    }
    Ok((station_peer_id, device_id, generation))
}

fn start_access_attempt_with_scope<T: serde::Serialize>(
) -> Result<(StartAccessAttemptResponse, (String, String, u64)), AppResult<T>> {
    let (station_peer_id, device_id, lifecycle_generation) = access_scope::<T>()?;
    let response = access_post::<_, StartAccessAttemptResponse, T>(
        "/actor/access/start",
        &StartAccessAttemptRequest {
            station_url: station_client::station_base_url(),
            client: Some(AccessGateClientInfo {
                platform: "desktop".to_string(),
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                device_id: device_id.clone(),
                locale: String::new(),
                lifecycle_generation,
            }),
            session_id: String::new(),
            station_peer_id: station_peer_id.clone(),
        },
        ErrorCode::Unauthorized,
        "Access gate start failed",
    )?;
    Ok((response, (station_peer_id, device_id, lifecycle_generation)))
}

fn start_access_attempt<T: serde::Serialize>() -> Result<StartAccessAttemptResponse, AppResult<T>> {
    start_access_attempt_with_scope::<T>().map(|(response, _)| response)
}

#[derive(Debug, Clone)]
pub(crate) struct OAuthAccessAttemptBinding {
    pub station_peer_id: String,
    pub access_attempt_id: String,
    pub gate_id: String,
    pub device_id: String,
    pub lifecycle_generation: u64,
}

pub(crate) fn start_oauth_access_attempt<T: serde::Serialize>(
) -> Result<OAuthAccessAttemptBinding, AppResult<T>> {
    let (response, (station_peer_id, device_id, lifecycle_generation)) =
        start_access_attempt_with_scope::<T>()?;
    let decision = response.decision.ok_or_else(|| {
        AppResult::fail(
            ErrorCode::InternalError,
            "OAuth access start response is missing its decision",
            None,
        )
    })?;
    if decision.state != AccessDecisionState::ActionRequired as i32 {
        return Err(AppResult::fail(
            ErrorCode::Forbidden,
            decision_block_reason(&decision),
            None,
        ));
    }
    let gate = decision
        .gates
        .iter()
        .find(|gate| gate.gate_id == decision.current_gate_id)
        .ok_or_else(|| {
            AppResult::fail(
                ErrorCode::InternalError,
                "OAuth access decision is missing its current gate",
                None,
            )
        })?;
    let supported = gate.alternative_actions.iter().any(|action| {
        action.action_id == "auth.oauth"
            && action.submit_action == "start_oauth"
            && action.r#type == AccessGateType::AuthOauth as i32
    });
    if gate.r#type != AccessGateType::AuthLogin as i32 || !supported {
        return Err(AppResult::fail(
            ErrorCode::Forbidden,
            "Station did not advertise OAuth for the current access gate",
            None,
        ));
    }
    Ok(OAuthAccessAttemptBinding {
        station_peer_id,
        access_attempt_id: decision.attempt_id,
        gate_id: decision.current_gate_id,
        device_id,
        lifecycle_generation,
    })
}

fn submit_request<T: serde::Serialize>(
    attempt_id: String,
    gate_id: String,
    gate_type: i32,
    action_id: String,
    schema_revision: u32,
    schema_digest: String,
    submission_id: String,
    action_input: submit_access_gate_request::ActionInput,
) -> Result<SubmitAccessGateResponse, AppResult<T>> {
    let (station_peer_id, device_id, lifecycle_generation) = access_scope::<T>()?;
    access_post::<_, SubmitAccessGateResponse, T>(
        "/actor/access/submit",
        &SubmitAccessGateRequest {
            attempt_id,
            gate_id,
            r#type: gate_type,
            action_input: Some(action_input),
            action_id,
            station_peer_id,
            device_id,
            lifecycle_generation,
            schema_revision,
            schema_digest,
            submission_id,
        },
        ErrorCode::Unauthorized,
        "Access gate submit failed",
    )
}

pub fn access_start() -> AppResult<AccessDecisionPayload> {
    match start_access_attempt::<AccessDecisionPayload>() {
        Ok(response) => decision_payload("access_start", "ready", response.decision),
        Err(error) => error,
    }
}

pub fn access_submit_invite_code(
    input: AccessSubmitInviteInput,
) -> AppResult<AccessDecisionPayload> {
    let code = input.invite_code.trim();
    if code.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "Invite code is required", None);
    }
    let response = match submit_request::<AccessDecisionPayload>(
        input.attempt_id,
        input.gate_id,
        input.gate_type,
        input.action_id,
        input.schema_revision,
        input.schema_digest,
        input.submission_id,
        submit_access_gate_request::ActionInput::InviteCode(code.to_string()),
    ) {
        Ok(response) => response,
        Err(error) => return error,
    };
    decision_payload("access_submit_invite_code", "evaluated", response.decision)
}

pub fn access_submit_login(
    input: AccessSubmitLoginInput,
    state: &AppState,
) -> AppResult<AuthSessionPayload> {
    if let Err(error) = validate_login_input(&input.account, &input.password) {
        return map_domain_error(error);
    }
    let device_type = input
        .device_type
        .as_deref()
        .unwrap_or(DESKTOP_SESSION_CLASS);
    let response = match submit_request::<AuthSessionPayload>(
        input.attempt_id,
        input.gate_id,
        input.gate_type,
        input.action_id,
        input.schema_revision,
        input.schema_digest,
        input.submission_id,
        submit_access_gate_request::ActionInput::Login(LoginRequest {
            email: input.account,
            password: input.password,
            device_type: device_type.to_string(),
        }),
    ) {
        Ok(response) => response,
        Err(error) => return error,
    };
    let Some(decision) = response.decision.as_ref() else {
        return AppResult::fail(
            ErrorCode::InternalError,
            "Login failed: access gate response missing decision",
            None,
        );
    };
    if decision.state != AccessDecisionState::Granted as i32 {
        return AppResult::fail(ErrorCode::Forbidden, decision_block_reason(decision), None);
    }
    let Some(login_response) = response.login_response else {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "Login failed: access gate response missing login session",
            None,
        );
    };
    finish_login(login_response, state, "access_submit_login")
}

pub fn access_decision(input: AccessDecisionInput) -> AppResult<AccessDecisionPayload> {
    let (station_peer_id, device_id, lifecycle_generation) =
        match access_scope::<AccessDecisionPayload>() {
            Ok(scope) => scope,
            Err(error) => return error,
        };
    match access_post::<_, GetAccessDecisionResponse, AccessDecisionPayload>(
        "/actor/access/decision",
        &GetAccessDecisionRequest {
            attempt_id: input.attempt_id,
            station_peer_id,
            device_id,
            lifecycle_generation,
        },
        ErrorCode::Unauthorized,
        "Access decision failed",
    ) {
        Ok(response) => decision_payload("access_decision", "evaluated", response.decision),
        Err(error) => error,
    }
}

pub fn access_cancel(input: AccessDecisionInput) -> AppResult<AccessDecisionPayload> {
    let (station_peer_id, device_id, lifecycle_generation) =
        match access_scope::<AccessDecisionPayload>() {
            Ok(scope) => scope,
            Err(error) => return error,
        };
    match access_post::<_, CancelAccessAttemptResponse, AccessDecisionPayload>(
        "/actor/access/cancel",
        &CancelAccessAttemptRequest {
            attempt_id: input.attempt_id,
            station_peer_id,
            device_id,
            lifecycle_generation,
        },
        ErrorCode::Unauthorized,
        "Access cancellation failed",
    ) {
        Ok(response) => AppResult::success(AccessDecisionPayload {
            command: "access_cancel".to_string(),
            status: if response.cancelled {
                "cancelled".to_string()
            } else {
                "closed".to_string()
            },
            decision: empty_access_decision(),
        }),
        Err(error) => error,
    }
}

fn decision_payload(
    command: &str,
    status: &str,
    decision: Option<AccessDecision>,
) -> AppResult<AccessDecisionPayload> {
    let Some(decision) = decision else {
        return AppResult::fail(
            ErrorCode::InternalError,
            "Access response missing decision",
            None,
        );
    };
    match project_access_decision(&decision) {
        Ok(decision) => AppResult::success(AccessDecisionPayload {
            command: command.to_string(),
            status: status.to_string(),
            decision,
        }),
        Err(message) => AppResult::fail(ErrorCode::InternalError, message, None),
    }
}

pub(crate) fn project_access_decision(
    decision: &AccessDecision,
) -> Result<AccessDecisionProjection, String> {
    let state = AccessDecisionState::try_from(decision.state)
        .map_err(|_| "Access decision has an unknown state".to_string())?;
    let gates = decision
        .gates
        .iter()
        .map(|gate| {
            let gate_type = AccessGateType::try_from(gate.r#type)
                .map_err(|_| "Access gate has an unknown type".to_string())?;
            let gate_state = AccessGateState::try_from(gate.state)
                .map_err(|_| "Access gate has an unknown state".to_string())?;
            let alternative_actions = gate
                .alternative_actions
                .iter()
                .map(|action| {
                    let action_type = AccessGateType::try_from(action.r#type)
                        .map_err(|_| "Access gate action has an unknown type".to_string())?;
                    Ok(AccessGateActionProjection {
                        action_id: action.action_id.clone(),
                        action_type: action_type.as_str_name().to_string(),
                        submit_action: action.submit_action.clone(),
                        schema_revision: action.schema_revision,
                        schema_digest: action.schema_digest.clone(),
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;
            Ok(AccessGateProjection {
                gate_id: gate.gate_id.clone(),
                gate_type: gate_type.as_str_name().to_string(),
                state: gate_state.as_str_name().to_string(),
                title: gate.title.clone(),
                description: gate.description.clone(),
                blocking_reason: gate.blocking_reason.clone(),
                submit_action: gate.submit_action.clone(),
                input_schema_json: gate.input_schema_json.clone(),
                alternative_actions,
                action_id: gate.action_id.clone(),
                schema_revision: gate.schema_revision,
                schema_digest: gate.schema_digest.clone(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(AccessDecisionProjection {
        state: state.as_str_name().to_string(),
        attempt_id: decision.attempt_id.clone(),
        current_gate_id: decision.current_gate_id.clone(),
        gates,
        actor_ptid: decision
            .actor
            .as_ref()
            .map(|actor| actor.ptid.clone())
            .filter(|ptid| !ptid.is_empty()),
        access_grant_id: decision.access_grant_id.clone(),
        expires_at_unix_ms: decision.expires_at.as_ref().and_then(|timestamp| {
            u64::try_from(timestamp.seconds)
                .ok()
                .and_then(|seconds| seconds.checked_mul(1000))
                .and_then(|millis| {
                    u64::try_from(timestamp.nanos)
                        .ok()
                        .map(|nanos| millis + nanos / 1_000_000)
                })
        }),
        message: decision.message.clone(),
    })
}

fn decision_block_reason(decision: &AccessDecision) -> String {
    if !decision.message.trim().is_empty() {
        return decision.message.clone();
    }
    decision
        .gates
        .iter()
        .map(|gate| gate.blocking_reason.trim())
        .find(|reason| !reason.is_empty())
        .unwrap_or("Station access was not granted")
        .to_string()
}

fn empty_access_decision() -> AccessDecisionProjection {
    AccessDecisionProjection {
        state: AccessDecisionState::Unspecified.as_str_name().to_string(),
        attempt_id: String::new(),
        current_gate_id: String::new(),
        gates: Vec::new(),
        actor_ptid: None,
        access_grant_id: String::new(),
        expires_at_unix_ms: None,
        message: String::new(),
    }
}

fn finish_login(
    data: LoginResponse,
    state: &AppState,
    command: &str,
) -> AppResult<AuthSessionPayload> {
    let token = data
        .tokens
        .as_ref()
        .map(|tokens| tokens.access_token.clone())
        .unwrap_or_default();
    if token.is_empty() {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "Login failed: no token in response",
            None,
        );
    }

    let actor_ptid = data
        .actor_ref
        .as_ref()
        .map(|actor| actor.ptid.clone())
        .unwrap_or_default();
    if !actor_ptid.starts_with("ptid:") {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "Login response missing canonical actor PTID",
            None,
        );
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

    let account_id = match crate::infrastructure::auth_identity::upsert_password(
        &actor_ptid,
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
    if let Err(error) =
        activate_messaging_profile(state, &account_id, &session.actor_ptid, &session.token)
    {
        tracing::warn!(
            account_id = %account_id,
            actor_ptid = %session.actor_ptid,
            error = %error,
            "authenticated session retained while durable messaging activation awaits retry"
        );
    }

    AppResult::success(AuthSessionPayload {
        command: command.to_string(),
        status: "authenticated".to_string(),
        actor_ptid: Some(actor_ptid),
        session_token: Some(session.token.clone()),
        name: Some(name),
        email: Some(email_str),
        avatar_url: Some(avatar),
        avatar_local_path,
        login_method: Some("password".to_string()),
    })
}

pub fn auth_logout(state: &AppState) -> AppResult<AuthSessionPayload> {
    let active_account_id = crate::infrastructure::auth_identity::read_state()
        .ok()
        .and_then(|s| s.active_account_id);
    if let Some(ref account_id) = active_account_id {
        if let Err(error) = run_required_logout_cleanup(
            account_id,
            crate::infrastructure::auth_identity::clear_account_session,
            session_vault::purge_raw_session_for_account,
            |account_id| deactivate_messaging_profile(state, account_id),
        ) {
            return error;
        }
    }
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

fn run_required_logout_cleanup(
    account_id: &str,
    clear_durable_session: impl FnOnce(&str) -> Result<(), String>,
    purge_raw_session: impl FnOnce(&str),
    deactivate_messaging: impl FnOnce(&str) -> Result<(), String>,
) -> Result<(), AppResult<AuthSessionPayload>> {
    let mut failures = Vec::new();
    if let Err(error) = clear_durable_session(account_id) {
        tracing::error!(
            error = %error,
            "failed to clear durable account session during logout"
        );
        failures.push(json!({
            "operation": "durable_session_clear",
            "message": error,
        }));
    }
    purge_raw_session(account_id);
    if let Err(error) = deactivate_messaging(account_id) {
        tracing::error!(
            error = %error,
            "failed to deactivate messaging profile during logout"
        );
        failures.push(json!({
            "operation": "messaging_engine_deactivation",
            "message": error,
        }));
    }
    if failures.is_empty() {
        return Ok(());
    }
    Err(AppResult::fail(
        ErrorCode::InternalError,
        "Failed to complete logout cleanup",
        Some(json!({
            "command": "auth_logout",
            "reason": "logout_cleanup_failed",
            "failures": failures,
        })),
    ))
}

pub(crate) fn detach_for_station_switch(
    state: &AppState,
) -> Result<(), AppResult<AuthSessionPayload>> {
    if let Err(error) = state.secure_content.shutdown() {
        tracing::warn!(error = %error, "failed to stop Secure Content for Station switch");
    }
    if let Err(error) = state.messaging_engines.deactivate_all() {
        tracing::warn!(error = %error, "failed to deactivate messaging engines for Station switch");
    }
    for session in state.sessions.clear() {
        crate::infrastructure::event_stream::stop(&session.actor.ptid);
    }
    Ok(())
}

pub(crate) struct PrevalidatedAccountSwitchSession {
    account_id: String,
    actor_ptid: String,
    token: String,
}

pub(crate) struct PreparedAccountSwitchSession {
    pub account_id: String,
    pub actor_ptid: String,
    pub token: String,
    pub payload: AuthSessionPayload,
}

pub(crate) fn prepare_account_switch_session(
    raw_account_id: &str,
) -> Result<PrevalidatedAccountSwitchSession, AppResult<AuthSessionPayload>> {
    if raw_account_id.trim().is_empty() {
        return Err(unauthorized(
            "missing account",
            json!({ "command": "account_switch", "reason": "account_missing" }),
        ));
    }
    let identity_state = crate::infrastructure::auth_identity::read_state().map_err(|error| {
        unauthorized(
            format!("account lookup failed: {error}"),
            json!({ "command": "account_switch", "reason": "account_missing" }),
        )
    })?;
    // Resolve any provider-scoped alias to the stable canonical id for the
    // person, so a switch lands on the row that owns the PIN/session.
    let Some(account_id) = crate::infrastructure::auth_identity::canonical_account_id(
        &identity_state.accounts,
        raw_account_id,
    ) else {
        return Err(unauthorized(
            "missing account",
            json!({ "command": "account_switch", "reason": "account_missing" }),
        ));
    };
    if session_vault::account_requires_pin(&account_id) {
        return Err(unauthorized(
            "pin required",
            json!({ "command": "account_switch", "reason": "pin_required" }),
        ));
    }

    let blob = match session_vault::load_raw_session_for_account(&account_id, None) {
        Ok(Some(blob)) => blob,
        Ok(None) => {
            return Err(unauthorized(
                "missing session",
                json!({ "command": "account_switch", "reason": "session_missing" }),
            ))
        }
        Err(error) => return Err(session_vault_to_app(error)),
    };
    let expected_actor_ptid =
        session_vault::actor_ptid_for_account(&account_id).ok_or_else(|| {
            unauthorized(
                "account has no canonical actor PTID",
                json!({ "command": "account_switch", "reason": "actor_ptid_missing" }),
            )
        })?;
    let initial_session = validate_token(&blob.token).map_err(map_domain_error)?;
    if initial_session.actor_ptid != blob.actor_ptid
        || initial_session.actor_ptid != expected_actor_ptid
    {
        return Err(unauthorized(
            "selected account session PTID mismatch",
            json!({ "command": "account_switch", "reason": "actor_ptid_mismatch" }),
        ));
    }

    Ok(PrevalidatedAccountSwitchSession {
        account_id,
        actor_ptid: expected_actor_ptid,
        token: initial_session.token,
    })
}

pub(crate) fn acquire_account_switch_session(
    prevalidated: PrevalidatedAccountSwitchSession,
) -> Result<PreparedAccountSwitchSession, AppResult<AuthSessionPayload>> {
    let token = takeover_station_session_token(&prevalidated.token)
        .map_err(|error| session_takeover_failed(error, Some(&prevalidated.account_id), None))?;
    let session = validate_token(&token).map_err(map_domain_error)?;
    if session.actor_ptid != prevalidated.actor_ptid {
        return Err(unauthorized(
            "selected account session PTID mismatch",
            json!({ "command": "account_switch", "reason": "actor_ptid_mismatch" }),
        ));
    }
    probe_session_with_station(&token)?;

    let profile =
        crate::infrastructure::auth_identity::find_profile_by_actor_ptid(&session.actor_ptid);
    let (name, email, avatar_url, avatar_local_path, login_method) = match profile {
        Some(profile) => (
            Some(profile.name).filter(|value| !value.is_empty()),
            Some(profile.email).filter(|value| !value.is_empty()),
            Some(profile.avatar_url).filter(|value| !value.is_empty()),
            profile.avatar_local_path.filter(|value| !value.is_empty()),
            Some(profile.provider),
        ),
        None => (None, None, None, None, None),
    };
    let payload = AuthSessionPayload {
        command: "account_switch".to_string(),
        status: "authenticated".to_string(),
        actor_ptid: Some(session.actor_ptid.clone()),
        session_token: Some(session.token.clone()),
        name,
        email,
        avatar_url,
        avatar_local_path,
        login_method,
    };

    Ok(PreparedAccountSwitchSession {
        account_id: prevalidated.account_id,
        actor_ptid: session.actor_ptid,
        token: session.token,
        payload,
    })
}

pub(crate) fn persist_prepared_account_switch_session(
    prepared: &PreparedAccountSwitchSession,
) -> Result<(), AppResult<AuthSessionPayload>> {
    let session = from_station_response(prepared.actor_ptid.clone(), prepared.token.clone());
    persist_session_if_unprotected(&prepared.account_id, &session, SessionSource::Password)?;
    mark_account_has_session(&prepared.account_id, &prepared.token);
    Ok(())
}

pub fn auth_restore_session(state: &AppState) -> AppResult<AuthSessionPayload> {
    auth_restore_session_for_device(state, DESKTOP_SESSION_CLASS)
}

pub(crate) fn auth_restore_session_for_device(
    state: &AppState,
    device_type: &str,
) -> AppResult<AuthSessionPayload> {
    if let Err(error) = crate::application::oauth2::reconcile_broker_cancellations_after_restart() {
        return AppResult::fail(
            ErrorCode::InternalError,
            "oauth cancellation recovery failed",
            Some(json!({ "cause": error })),
        );
    }
    let Some(account_id) = session_vault::active_account_id() else {
        return unauthorized(
            "missing session",
            json!({ "command": "auth_restore_session", "reason": "session_missing" }),
        );
    };
    if session_vault::account_requires_pin(&account_id) {
        session_vault::purge_raw_session_for_account(&account_id);
        return unauthorized(
            "pin required",
            json!({ "command": "auth_restore_session", "reason": "pin_required" }),
        );
    }
    let blob = match session_vault::load_raw_session_for_account(&account_id, None) {
        Ok(Some(blob)) => blob,
        Ok(None) => {
            return unauthorized(
                "missing session",
                json!({ "command": "auth_restore_session", "reason": "session_missing" }),
            )
        }
        Err(error) => return session_vault_to_app(error),
    };
    if blob.source == SessionSource::OauthBridge {
        match crate::application::oauth2::reconcile_broker_acknowledgement_for_account(&account_id)
        {
            Ok(crate::application::oauth2::BrokerAcknowledgementRecovery::Ready) => {}
            Ok(crate::application::oauth2::BrokerAcknowledgementRecovery::Pending) => {
                return unauthorized(
                    "oauth session activation pending",
                    json!({
                        "command": "auth_restore_session",
                        "reason": "oauth_acknowledgement_pending",
                    }),
                )
            }
            Ok(crate::application::oauth2::BrokerAcknowledgementRecovery::Rejected(reason)) => {
                return unauthorized(
                    "oauth session activation rejected",
                    json!({
                        "command": "auth_restore_session",
                        "reason": "oauth_acknowledgement_rejected",
                        "cause": reason,
                    }),
                )
            }
            Err(error) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    "oauth session activation recovery failed",
                    Some(json!({ "cause": error })),
                )
            }
        }
    }
    let initial_session = match validate_token(&blob.token) {
        Ok(session) => session,
        Err(error) => return map_domain_error(error),
    };
    let token = match takeover_station_session_token_for_device(&blob.token, device_type) {
        Ok(token) => token,
        Err(error) => {
            session_vault::purge_raw_session_for_actor_ptid(&initial_session.actor_ptid);
            return session_takeover_failed(error, Some(&account_id), None);
        }
    };
    let session = match validate_token(&token) {
        Ok(session) => session,
        Err(error) => {
            session_vault::purge_raw_session_for_actor_ptid(&initial_session.actor_ptid);
            return map_domain_error(error);
        }
    };
    if session.actor_ptid != blob.actor_ptid {
        session_vault::purge_raw_session_for_actor_ptid(&blob.actor_ptid);
        return unauthorized(
            "session actor PTID mismatch",
            json!({ "command": "auth_restore_session", "reason": "actor_ptid_mismatch" }),
        );
    }
    if let Err(error) = verify_session_with_station(&token, &account_id, state) {
        return error;
    }
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
            "restored session retained while durable messaging activation awaits retry"
        );
    }
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
    AppResult::success(AuthSessionPayload {
        command: "auth_restore_session".to_string(),
        status: "restored".to_string(),
        actor_ptid: Some(session.actor_ptid.clone()),
        session_token: Some(session.token.clone()),
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
            return unauthorized(
                "missing token",
                json!({ "command": "auth_validate_token", "reason": "token_missing" }),
            )
        }
    };
    let session = match validate_token(&token) {
        Ok(session) => session,
        Err(error) => return map_domain_error(error),
    };
    let Some(account_id) = session_vault::active_account_id() else {
        return unauthorized(
            "missing active account",
            json!({ "command": "auth_validate_token", "reason": "account_missing" }),
        );
    };
    if let Err(error) = verify_session_with_station(&token, &account_id, state) {
        return error;
    }
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
    match crate::application::oauth2::reconcile_broker_acknowledgement_for_account(&account_id) {
        Ok(crate::application::oauth2::BrokerAcknowledgementRecovery::Ready) => {}
        Ok(crate::application::oauth2::BrokerAcknowledgementRecovery::Pending) => {
            return unauthorized(
                "oauth session activation pending",
                json!({
                    "command": "ensure_station_session",
                    "reason": "oauth_acknowledgement_pending",
                }),
            )
        }
        Ok(crate::application::oauth2::BrokerAcknowledgementRecovery::Rejected(reason)) => {
            return unauthorized(
                "oauth session activation rejected",
                json!({
                    "command": "ensure_station_session",
                    "reason": "oauth_acknowledgement_rejected",
                    "cause": reason,
                }),
            )
        }
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "oauth session activation recovery failed",
                Some(json!({ "cause": error })),
            )
        }
    }

    let actor_ptid = blob.actor_ptid;
    let token = blob.token;
    if let Err(error) = verify_session_with_station(&token, &account_id, state) {
        return error;
    }
    let session = from_station_response(actor_ptid.clone(), token);
    if let Err(error) =
        persist_session_if_unprotected(&account_id, &session, SessionSource::OauthBridge)
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
            "OAuth session retained while durable messaging activation awaits retry"
        );
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

    if let Ok(id_state) = crate::infrastructure::auth_identity::read_state() {
        if let Some(active_id) = &id_state.active_account_id {
            mark_account_has_session(active_id, &session.token);
        }
    }

    AppResult::success(AuthSessionPayload {
        command: "ensure_station_session".to_string(),
        status: "authenticated".to_string(),
        actor_ptid: Some(actor_ptid),
        session_token: Some(session.token.clone()),
        name: p_name,
        email: p_email,
        avatar_url: p_avatar,
        avatar_local_path: p_local_avatar,
        login_method: Some("oauth".to_string()),
    })
}

fn verify_session_with_station(
    token: &str,
    account_id: &str,
    state: &AppState,
) -> Result<(), AppResult<AuthSessionPayload>> {
    station_client::request_peers_proto_no_body::<ActorProfile>(
        reqwest::Method::GET,
        "/actor/profile",
        token,
        None,
    )
    .map(|_| ())
    .map_err(|error| {
        if station_verification_rejects_session(&error) {
            if run_required_logout_cleanup(
                account_id,
                crate::infrastructure::auth_identity::clear_account_session,
                session_vault::purge_raw_session_for_account,
                |account_id| deactivate_messaging_profile(state, account_id),
            )
            .is_err()
            {
                tracing::error!(
                    "failed to fully clean local state after Station rejected the session"
                );
            }
            let mut details = error.details.unwrap_or_else(|| json!({}));
            if let Some(object) = details.as_object_mut() {
                object.insert("code".to_string(), json!("session_revoked"));
                object
                    .entry("reason".to_string())
                    .or_insert_with(|| json!("station_rejected"));
            }
            return AppResult::fail(ErrorCode::Unauthorized, "session revoked", Some(details));
        } else {
            tracing::warn!(
                error_kind = ?error.kind,
                "session validation unavailable; retaining local session"
            );
        }
        error.into_app_result("Session validation failed")
    })
}

fn probe_session_with_station(token: &str) -> Result<(), AppResult<AuthSessionPayload>> {
    station_client::request_peers_proto_no_body::<ActorProfile>(
        reqwest::Method::GET,
        "/actor/profile",
        token,
        None,
    )
    .map(|_| ())
    .map_err(|error| {
        if station_verification_rejects_session(&error) {
            let mut details = error.details.unwrap_or_else(|| json!({}));
            if let Some(object) = details.as_object_mut() {
                object.insert("code".to_string(), json!("session_revoked"));
                object.insert("reason".to_string(), json!("station_rejected"));
            }
            AppResult::fail(ErrorCode::Unauthorized, "session revoked", Some(details))
        } else {
            error.into_app_result("Session validation failed")
        }
    })
}

fn station_verification_rejects_session(error: &station_client::StationClientError) -> bool {
    matches!(
        error.kind,
        station_client::StationClientErrorKind::SessionRevoked
            | station_client::StationClientErrorKind::HttpStatus(401)
    )
}

#[cfg(test)]
mod tests {
    use super::{
        run_required_logout_cleanup, should_resume_access_binding,
        station_verification_rejects_session, DESKTOP_SESSION_CLASS,
    };
    use crate::application::station_binding::StationBindingPhase;
    use crate::contracts::AuthSessionPayload;
    use crate::error::ErrorCode;
    use crate::infrastructure::station_client::{StationClientError, StationClientErrorKind};
    use std::cell::Cell;

    #[test]
    fn desktop_uses_the_canonical_session_class() {
        assert_eq!(DESKTOP_SESSION_CLASS, "desktop");
    }

    #[test]
    fn logout_cleanup_succeeds_only_after_all_required_operations() {
        let durable_session_clear_called = Cell::new(false);
        let raw_session_purge_called = Cell::new(false);
        let messaging_deactivation_called = Cell::new(false);

        let result = run_required_logout_cleanup(
            "station:account",
            |_| {
                durable_session_clear_called.set(true);
                Ok(())
            },
            |_| raw_session_purge_called.set(true),
            |_| {
                messaging_deactivation_called.set(true);
                Ok(())
            },
        );

        assert!(result.is_ok());
        assert!(durable_session_clear_called.get());
        assert!(raw_session_purge_called.get());
        assert!(messaging_deactivation_called.get());
    }

    #[test]
    fn logout_cleanup_fails_when_durable_session_clear_fails() {
        let raw_session_purge_called = Cell::new(false);
        let messaging_deactivation_called = Cell::new(false);

        let result = run_required_logout_cleanup(
            "station:account",
            |_| Err("identity store write failed".to_string()),
            |_| raw_session_purge_called.set(true),
            |_| {
                messaging_deactivation_called.set(true);
                Ok(())
            },
        );

        assert!(raw_session_purge_called.get());
        assert!(messaging_deactivation_called.get());
        assert_logout_cleanup_failure(
            result,
            &[("durable_session_clear", "identity store write failed")],
        );
    }

    #[test]
    fn logout_cleanup_fails_when_messaging_deactivation_fails() {
        let durable_session_clear_called = Cell::new(false);
        let raw_session_purge_called = Cell::new(false);

        let result = run_required_logout_cleanup(
            "station:account",
            |_| {
                durable_session_clear_called.set(true);
                Ok(())
            },
            |_| raw_session_purge_called.set(true),
            |_| Err("worker stop failed".to_string()),
        );

        assert!(durable_session_clear_called.get());
        assert!(raw_session_purge_called.get());
        assert_logout_cleanup_failure(
            result,
            &[("messaging_engine_deactivation", "worker stop failed")],
        );
    }

    #[test]
    fn logout_cleanup_reports_all_required_operation_failures() {
        let result = run_required_logout_cleanup(
            "station:account",
            |_| Err("identity store write failed".to_string()),
            |_| {},
            |_| Err("worker stop failed".to_string()),
        );

        assert_logout_cleanup_failure(
            result,
            &[
                ("durable_session_clear", "identity store write failed"),
                ("messaging_engine_deactivation", "worker stop failed"),
            ],
        );
    }

    #[test]
    fn explicit_station_revocation_requires_local_session_cleanup() {
        for kind in [
            StationClientErrorKind::SessionRevoked,
            StationClientErrorKind::HttpStatus(401),
        ] {
            assert!(station_verification_rejects_session(
                &StationClientError::new(kind, "rejected", None)
            ));
        }
    }

    #[test]
    fn transient_station_failure_retains_local_session() {
        assert!(!station_verification_rejects_session(
            &StationClientError::new(
                StationClientErrorKind::Network,
                "temporarily unavailable",
                None,
            )
        ));
    }

    #[test]
    fn access_start_resumes_only_persisted_incomplete_station_bindings() {
        assert!(should_resume_access_binding(
            &StationBindingPhase::Connecting
        ));
        assert!(should_resume_access_binding(&StationBindingPhase::Failed));
        for phase in [
            StationBindingPhase::Unbound,
            StationBindingPhase::AccessGate,
            StationBindingPhase::Bound,
            StationBindingPhase::Switching,
        ] {
            assert!(!should_resume_access_binding(&phase));
        }
    }

    fn assert_logout_cleanup_failure(
        result: Result<(), crate::error::AppResult<AuthSessionPayload>>,
        expected_failures: &[(&str, &str)],
    ) {
        let failure = result.expect_err("logout cleanup must fail closed");
        assert!(!failure.ok);
        assert!(failure.data.is_none());
        let error = failure.error.expect("typed logout error is required");
        assert_eq!(error.code, ErrorCode::InternalError);
        let details = error.details.expect("logout failure details are required");
        assert_eq!(details["command"], "auth_logout");
        assert_eq!(details["reason"], "logout_cleanup_failed");
        let failures = details["failures"]
            .as_array()
            .expect("logout operation failures are required");
        assert_eq!(failures.len(), expected_failures.len());
        for (actual, (operation, message)) in failures.iter().zip(expected_failures) {
            assert_eq!(actual["operation"], *operation);
            assert_eq!(actual["message"], *message);
        }
    }
}
