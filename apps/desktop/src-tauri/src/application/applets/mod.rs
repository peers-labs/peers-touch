use crate::domain::applets::{
    authorize, build_request_id, emit_audit, normalize_capability, AccessContext,
};
use crate::error::{AppResult, ErrorCode};
use crate::contracts::{
    AppletActionInput, AppletConfigSetInput, AppletIdInput, AppletInvokeInput, StubPayload,
};
use serde_json::{json, Value};

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
        format!(
            "Applet capability denied: {} is not allowed for this session",
            capability
        ),
        None,
    ))
}

fn invoke_gateway(
    context: &AccessContext,
    command: &str,
    applet_id: Option<&str>,
    capability: &str,
    action: Option<&str>,
    params: Option<Value>,
) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    let normalized_capability = normalize_capability(capability);
    if let Err(error) = ensure_allowed(
        context,
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
                format!("Unsupported applet gateway command: {}", command),
                None,
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

pub fn applets_list(context: AccessContext) -> AppResult<StubPayload> {
    invoke_gateway(&context, "applets_list", None, "applets.list", None, None)
}

pub fn applets_get(context: AccessContext, input: AppletIdInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    invoke_gateway(
        &context,
        "applets_get",
        Some(input.id.trim()),
        "applets.get",
        None,
        None,
    )
}

pub fn applets_activate(context: AccessContext, input: AppletIdInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    invoke_gateway(
        &context,
        "applets_activate",
        Some(input.id.trim()),
        "applets.activate",
        None,
        None,
    )
}

pub fn applets_deactivate(context: AccessContext, input: AppletIdInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    invoke_gateway(
        &context,
        "applets_deactivate",
        Some(input.id.trim()),
        "applets.deactivate",
        None,
        None,
    )
}

pub fn applets_get_config(context: AccessContext, input: AppletIdInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    invoke_gateway(
        &context,
        "applets_get_config",
        Some(input.id.trim()),
        "applets.get_config",
        None,
        None,
    )
}

pub fn applets_set_config(
    context: AccessContext,
    input: AppletConfigSetInput,
) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    let _ = input.config;
    invoke_gateway(
        &context,
        "applets_set_config",
        Some(input.id.trim()),
        "applets.set_config",
        None,
        None,
    )
}

pub fn applets_action(
    context: AccessContext,
    input: AppletActionInput,
) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    if input.action.trim().is_empty() {
        return invalid_argument("action is required", &request_id);
    }
    invoke_gateway(
        &context,
        "applets_action",
        Some(input.id.trim()),
        "applets.action",
        Some(input.action.trim()),
        input.params,
    )
}

pub fn applets_invoke(
    context: AccessContext,
    input: AppletInvokeInput,
) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    if input.capability.trim().is_empty() {
        return invalid_argument("capability is required", &request_id);
    }
    invoke_gateway(
        &context,
        "applets_invoke",
        Some(input.id.trim()),
        input.capability.as_str(),
        input.action.as_deref(),
        input.params,
    )
}
