use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{
    AppletActionInput, AppletConfigSetInput, AppletIdInput, StubPayload,
};
use serde_json::json;

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

pub fn applets_list() -> AppResult<StubPayload> {
    success_payload("applets_list", json!({ "applets": [] }))
}

pub fn applets_get(input: AppletIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload(
        "applets_get",
        json!({
            "id":input.id,
            "name":"Applet",
            "title":"Applet",
            "description":"",
            "active":false
        }),
    )
}

pub fn applets_activate(input: AppletIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("applets_activate", json!({ "ok": true }))
}

pub fn applets_deactivate(input: AppletIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("applets_deactivate", json!({ "ok": true }))
}

pub fn applets_get_config(input: AppletIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    success_payload("applets_get_config", json!({ "config": {} }))
}

pub fn applets_set_config(input: AppletConfigSetInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let _ = input.config;
    success_payload("applets_set_config", json!({ "ok": true }))
}

pub fn applets_action(input: AppletActionInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    if input.action.trim().is_empty() {
        return invalid_argument("action is required");
    }
    success_payload("applets_action", json!({ "ok": true, "result": input.params.unwrap_or_else(|| json!({})) }))
}
