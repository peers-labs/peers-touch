use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{
    ProviderModelAddInput, ProviderModelDeleteInput, ProviderModelFetchInput, ProviderModelToggleAllInput,
    ProviderModelToggleInput, ProviderModelUpdateInput, StubPayload,
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

pub fn model_add(input: ProviderModelAddInput) -> AppResult<StubPayload> {
    if input.provider_id.trim().is_empty() {
        return invalid_argument("provider_id is required");
    }
    let _ = input.data;
    success_payload("model_add", json!({ "ok": true }))
}

pub fn model_update(input: ProviderModelUpdateInput) -> AppResult<StubPayload> {
    if input.provider_id.trim().is_empty() || input.model_id.trim().is_empty() {
        return invalid_argument("provider_id and model_id are required");
    }
    let _ = input.data;
    success_payload("model_update", json!({ "ok": true }))
}

pub fn model_delete(input: ProviderModelDeleteInput) -> AppResult<StubPayload> {
    if input.provider_id.trim().is_empty() || input.model_id.trim().is_empty() {
        return invalid_argument("provider_id and model_id are required");
    }
    success_payload("model_delete", json!({ "ok": true }))
}

pub fn model_fetch_remote(input: ProviderModelFetchInput) -> AppResult<StubPayload> {
    if input.provider_id.trim().is_empty() {
        return invalid_argument("provider_id is required");
    }
    let _ = input.data;
    success_payload("model_fetch_remote", json!({ "ok": true, "models": [] }))
}

pub fn model_toggle(input: ProviderModelToggleInput) -> AppResult<StubPayload> {
    if input.provider_id.trim().is_empty() || input.model_id.trim().is_empty() {
        return invalid_argument("provider_id and model_id are required");
    }
    let _ = input.enabled;
    success_payload("model_toggle", json!({ "ok": true }))
}

pub fn model_toggle_all(input: ProviderModelToggleAllInput) -> AppResult<StubPayload> {
    if input.provider_id.trim().is_empty() {
        return invalid_argument("provider_id is required");
    }
    let _ = input.enabled;
    success_payload("model_toggle_all", json!({ "ok": true }))
}
