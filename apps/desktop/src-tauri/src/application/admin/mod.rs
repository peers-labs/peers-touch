use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{AdminExecuteActionInput, AdminNetworkProbeInput, StubPayload};
use crate::state::AppState;
use super::domain_admin::{
    authorize, build_request_id, emit_audit, validate_action, validate_probe_target, AccessContext,
    AdminCapability,
};

fn current_access_context(state: &AppState) -> Result<AccessContext, AppResult<StubPayload>> {
    match state.session.lock() {
        Ok(session) => Ok(AccessContext {
            actor_id: session.actor_id.clone(),
            token: session.token.clone(),
        }),
        Err(_) => Err(AppResult::fail(
            ErrorCode::InternalError,
            "failed to access session state",
            None,
        )),
    }
}

fn ensure_admin(
    context: &AccessContext,
    capability: AdminCapability,
    request_id: &str,
) -> Result<(), AppResult<StubPayload>> {
    if authorize(context, capability) {
        return Ok(());
    }
    emit_audit(
        request_id,
        capability,
        context.actor_id.as_deref(),
        "forbidden",
    );
    Err(AppResult::fail(
        ErrorCode::Forbidden,
        "admin capability required",
        Some(serde_json::json!({ "requestId": request_id })),
    ))
}

pub fn admin_health(state: &AppState) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    let context = match current_access_context(state) {
        Ok(context) => context,
        Err(error) => return error,
    };
    if let Err(error) = ensure_admin(&context, AdminCapability::Health, &request_id) {
        return error;
    }
    emit_audit(
        &request_id,
        AdminCapability::Health,
        context.actor_id.as_deref(),
        "ok",
    );
    AppResult::success(StubPayload {
        command: "admin_health".to_string(),
        status: "ok".to_string(),
    })
}

pub fn admin_network_probe(state: &AppState, input: AdminNetworkProbeInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    let context = match current_access_context(state) {
        Ok(context) => context,
        Err(error) => return error,
    };
    if let Err(error) = ensure_admin(&context, AdminCapability::NetworkProbe, &request_id) {
        return error;
    }
    if let Err(message) = validate_probe_target(&input.target) {
        emit_audit(
            &request_id,
            AdminCapability::NetworkProbe,
            context.actor_id.as_deref(),
            "invalid_argument",
        );
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            message,
            Some(serde_json::json!({ "requestId": request_id })),
        );
    }
    emit_audit(
        &request_id,
        AdminCapability::NetworkProbe,
        context.actor_id.as_deref(),
        "ok",
    );
    AppResult::success(StubPayload {
        command: "admin_network_probe".to_string(),
        status: format!("reachable:{}", input.target.trim()),
    })
}

pub fn admin_execute_action(state: &AppState, input: AdminExecuteActionInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    let context = match current_access_context(state) {
        Ok(context) => context,
        Err(error) => return error,
    };
    if let Err(error) = ensure_admin(&context, AdminCapability::ExecuteAction, &request_id) {
        return error;
    }
    if let Err(message) = validate_action(&input.action) {
        emit_audit(
            &request_id,
            AdminCapability::ExecuteAction,
            context.actor_id.as_deref(),
            "invalid_argument",
        );
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            message,
            Some(serde_json::json!({ "requestId": request_id })),
        );
    }
    emit_audit(
        &request_id,
        AdminCapability::ExecuteAction,
        context.actor_id.as_deref(),
        "ok",
    );
    AppResult::success(StubPayload {
        command: "admin_execute_action".to_string(),
        status: format!("executed:{}", input.action.trim()),
    })
}
