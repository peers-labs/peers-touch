use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{
    AppletActionInput, AppletConfigSetInput, AppletIdInput, AppletInvokeInput, StubPayload,
};
use crate::state::AppState;
use serde_json::{json, Value};
use super::domain_applets::{
    authorize, build_request_id, emit_audit, normalize_capability, AccessContext,
};

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str, request_id: &str) -> AppResult<StubPayload> {
    AppResult::fail(
        ErrorCode::InvalidArgument,
        message,
        Some(serde_json::json!({ "requestId": request_id })),
    )
}

fn current_access_context(state: &AppState) -> Result<AccessContext, AppResult<StubPayload>> {
    match state.session.lock() {
        Ok(session) => Ok(AccessContext {
            actor_id: session.actor_id.clone(),
        }),
        Err(_) => Err(AppResult::fail(
            ErrorCode::InternalError,
            "failed to access session state",
            None,
        )),
    }
}

fn ensure_allowed(
    context: &AccessContext,
    request_id: &str,
    command: &str,
    applet_id: Option<&str>,
    capability: &str,
) -> Result<(), AppResult<StubPayload>> {
    if authorize(context, capability) {
        return Ok(());
    }
    emit_audit(
        request_id,
        command,
        applet_id,
        capability,
        context.actor_id.as_deref(),
        "forbidden",
    );
    Err(AppResult::fail(
        ErrorCode::Forbidden,
        "applet capability denied",
        Some(serde_json::json!({
            "requestId": request_id,
            "capability": capability
        })),
    ))
}

fn invoke_gateway(
    state: &AppState,
    command: &str,
    applet_id: Option<&str>,
    capability: &str,
    action: Option<&str>,
    params: Option<Value>,
) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    let context = match current_access_context(state) {
        Ok(context) => context,
        Err(error) => return error,
    };
    let normalized_capability = normalize_capability(capability);
    if let Err(error) = ensure_allowed(
        &context,
        &request_id,
        command,
        applet_id,
        &normalized_capability,
    ) {
        return error;
    }

    let response = match command {
        "applets_list" => json!({ "applets": [] }),
        "applets_get" => json!({
            "id": applet_id.unwrap_or_default(),
            "name": "Applet",
            "title": "Applet",
            "description": "",
            "active": false
        }),
        "applets_get_config" => json!({ "config": {} }),
        "applets_activate" | "applets_deactivate" | "applets_set_config" => json!({ "ok": true }),
        "applets_action" => json!({ "ok": true, "result": params.unwrap_or_else(|| json!({})) }),
        "applets_invoke" => json!({
            "ok": true,
            "capability": normalized_capability,
            "action": action,
            "result": params.unwrap_or_else(|| json!({}))
        }),
        _ => {
            emit_audit(
                &request_id,
                command,
                applet_id,
                &normalized_capability,
                context.actor_id.as_deref(),
                "not_implemented",
            );
            return AppResult::fail(
                ErrorCode::NotImplemented,
                "unsupported applet command",
                Some(serde_json::json!({
                    "requestId": request_id,
                    "command": command
                })),
            );
        }
    };

    emit_audit(
        &request_id,
        command,
        applet_id,
        &normalized_capability,
        context.actor_id.as_deref(),
        "ok",
    );
    success_payload(command, response)
}

pub fn applets_list(state: &AppState) -> AppResult<StubPayload> {
    invoke_gateway(state, "applets_list", None, "applets.list", None, None)
}

pub fn applets_get(state: &AppState, input: AppletIdInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    invoke_gateway(
        state,
        "applets_get",
        Some(input.id.trim()),
        "applets.get",
        None,
        None,
    )
}

pub fn applets_activate(state: &AppState, input: AppletIdInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    invoke_gateway(
        state,
        "applets_activate",
        Some(input.id.trim()),
        "applets.activate",
        None,
        None,
    )
}

pub fn applets_deactivate(state: &AppState, input: AppletIdInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    invoke_gateway(
        state,
        "applets_deactivate",
        Some(input.id.trim()),
        "applets.deactivate",
        None,
        None,
    )
}

pub fn applets_get_config(state: &AppState, input: AppletIdInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    invoke_gateway(
        state,
        "applets_get_config",
        Some(input.id.trim()),
        "applets.get_config",
        None,
        None,
    )
}

pub fn applets_set_config(state: &AppState, input: AppletConfigSetInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    let _ = input.config;
    invoke_gateway(
        state,
        "applets_set_config",
        Some(input.id.trim()),
        "applets.set_config",
        None,
        None,
    )
}

pub fn applets_action(state: &AppState, input: AppletActionInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    if input.action.trim().is_empty() {
        return invalid_argument("action is required", &request_id);
    }
    invoke_gateway(
        state,
        "applets_action",
        Some(input.id.trim()),
        "applets.action",
        Some(input.action.trim()),
        input.params,
    )
}

pub fn applets_invoke(state: &AppState, input: AppletInvokeInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    if input.capability.trim().is_empty() {
        return invalid_argument("capability is required", &request_id);
    }
    invoke_gateway(
        state,
        "applets_invoke",
        Some(input.id.trim()),
        input.capability.as_str(),
        input.action.as_deref(),
        input.params,
    )
}
