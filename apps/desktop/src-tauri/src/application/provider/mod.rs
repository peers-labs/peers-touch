use crate::application::station_runtime::client::StationClient;
use crate::contracts::{
    ProviderCheckInput, ProviderCreateInput, ProviderIdInput, ProviderUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::model;
use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Value};

pub(crate) mod remote;
pub(crate) mod station_api;

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn station_error_to_result(e: station_api::StationApiError) -> AppResult<StubPayload> {
    match e {
        station_api::StationApiError::VersionConflict { current, submitted } => AppResult::fail(
            ErrorCode::Conflict,
            &format!(
                "Version conflict: current={}, submitted={}",
                current, submitted
            ),
            None,
        ),
        station_api::StationApiError::NotFound(msg) => {
            AppResult::fail(ErrorCode::NotFound, &msg, None)
        }
        station_api::StationApiError::Unauthorized => {
            AppResult::fail(ErrorCode::Unauthorized, "Session expired", None)
        }
        station_api::StationApiError::Network(msg) => {
            AppResult::fail(ErrorCode::InternalError, &msg, None)
        }
        station_api::StationApiError::Internal(msg) => {
            AppResult::fail(ErrorCode::InternalError, &msg, None)
        }
    }
}

pub fn provider_list(
    station_client: &StationClient,
    _scope: &str,
    token: &str,
) -> AppResult<StubPayload> {
    let resp = match station_api::list_providers(station_client, token) {
        Ok(v) => v,
        Err(e) => return station_error_to_result(e),
    };
    success_payload("provider_list", resp)
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeDefaultInput {
    #[serde(default)]
    pub provider_id: String,
    #[serde(default)]
    pub model_id: String,
    #[serde(default)]
    pub expected_revision: i64,
}

pub fn runtime_default_get(station_client: &StationClient, token: &str) -> AppResult<StubPayload> {
    let resp = match station_client.request_proto::<
        model::agent::GetRuntimeDefaultRequest,
        model::agent::GetRuntimeDefaultResponse,
    >(
        Method::GET,
        "/sub-agent/agent/provider/runtime-default",
        token,
        None,
        None,
    ) {
        Ok(resp) => resp,
        Err(e) => return station_error_to_result(e.into()),
    };
    let data = match resp.runtime_default {
        Some(value) => json!({
            "providerId": value.provider_id,
            "modelId": value.model_id,
            "revision": value.revision,
        }),
        None => json!({ "providerId": "", "modelId": "", "revision": 0 }),
    };
    success_payload(
        "provider_runtime_default_get",
        json!({ "runtimeDefault": data }),
    )
}

pub fn runtime_default_set(
    station_client: &StationClient,
    token: &str,
    input: RuntimeDefaultInput,
) -> AppResult<StubPayload> {
    if input.provider_id.trim().is_empty() || input.model_id.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            "provider_id and model_id are required",
            None,
        );
    }
    let req = model::agent::SetRuntimeDefaultRequest {
        provider_id: input.provider_id,
        model_id: input.model_id,
        expected_revision: input.expected_revision,
    };
    let resp = match station_client.request_proto::<
        model::agent::SetRuntimeDefaultRequest,
        model::agent::SetRuntimeDefaultResponse,
    >(
        Method::POST,
        "/sub-agent/agent/provider/runtime-default",
        token,
        None,
        Some(&req),
    ) {
        Ok(resp) => resp,
        Err(e) => return station_error_to_result(e.into()),
    };
    let data = match resp.runtime_default {
        Some(value) => json!({
            "providerId": value.provider_id,
            "modelId": value.model_id,
            "revision": value.revision,
        }),
        None => json!({ "providerId": "", "modelId": "", "revision": 0 }),
    };
    success_payload(
        "provider_runtime_default_set",
        json!({ "runtimeDefault": data }),
    )
}

pub fn provider_get(
    station_client: &StationClient,
    _scope: &str,
    token: &str,
    input: ProviderIdInput,
) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }

    let resp = match station_api::get_provider(station_client, token, id) {
        Ok(v) => v,
        Err(e) => return station_error_to_result(e),
    };

    let mut result = resp.clone();
    if let Some(provider) = result.get_mut("provider") {
        let is_configured = provider
            .get("credential_status")
            .and_then(|v| v.as_str())
            .unwrap_or("not_configured")
            == "configured";
        provider["has_api_key"] = json!(is_configured);

        if is_configured {
            if let Ok(cred) = station_api::resolve_credential(station_client, token, id) {
                if !cred.api_key.is_empty() {
                    provider["api_key"] = json!(cred.api_key);
                }
                if !cred.base_url.is_empty()
                    && provider
                        .get("base_url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .is_empty()
                {
                    provider["base_url"] = json!(cred.base_url);
                }
            }
        }
    }

    success_payload("provider_get", result)
}

pub fn provider_update(
    station_client: &StationClient,
    _scope: &str,
    token: &str,
    input: ProviderUpdateInput,
) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }

    let api_key = input
        .key_vaults
        .as_deref()
        .and_then(parse_key_vault_api_key)
        .filter(|api_key| !api_key.is_empty());

    let resp = match station_api::update_provider_full(
        station_client,
        token,
        id,
        input.enabled,
        input.config_json.as_deref(),
        input.runtime_config.as_ref(),
        input.version,
    ) {
        Ok(v) => v,
        Err(e) => return station_error_to_result(e),
    };
    if let Some(api_key) = api_key {
        if let Err(error) = station_api::set_credential(station_client, token, id, &api_key) {
            return station_error_to_result(error);
        }
    }
    success_payload("provider_update", resp)
}

pub fn provider_check(
    station_client: &StationClient,
    _scope: &str,
    token: &str,
    input: ProviderCheckInput,
) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }
    match station_api::check_provider(station_client, token, id) {
        Ok(response) => success_payload("provider_check", response),
        Err(error) => station_error_to_result(error),
    }
}

pub fn provider_create(
    station_client: &StationClient,
    _scope: &str,
    token: &str,
    input: ProviderCreateInput,
) -> AppResult<StubPayload> {
    let provider_id = input.id.trim();
    if provider_id.is_empty()
        || !provider_id.bytes().all(|value| {
            value.is_ascii_lowercase() || value.is_ascii_digit() || value == b'-' || value == b'_'
        })
    {
        return AppResult::fail(ErrorCode::InvalidArgument, "invalid provider id", None);
    }
    let name = input.name.trim();
    if name.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "name is required", None);
    }

    let base_url = serde_json::from_str::<serde_json::Value>(&input.config_json)
        .ok()
        .and_then(|v| v.get("base_url").and_then(|u| u.as_str()).map(String::from))
        .unwrap_or_default();

    let protocol = serde_json::from_str::<serde_json::Value>(&input.config_json)
        .ok()
        .and_then(|v| v.get("protocol").and_then(|u| u.as_str()).map(String::from))
        .unwrap_or_else(|| "openai".to_string());

    let provider = match station_api::create_provider(
        station_client,
        token,
        provider_id,
        name,
        &base_url,
        &protocol,
        None,
    ) {
        Ok(p) => p,
        Err(e) => return station_error_to_result(e),
    };

    if let Some(api_key) = parse_key_vault_api_key(&input.key_vaults) {
        let _ = station_api::set_credential(station_client, token, &provider.id, &api_key);
    }

    success_payload(
        "provider_create",
        json!({
            "provider": {
                "id": provider.id,
                "name": provider.name,
                "enabled": provider.enabled,
                "version": provider.version,
            }
        }),
    )
}

pub fn provider_delete(
    station_client: &StationClient,
    _scope: &str,
    token: &str,
    input: ProviderIdInput,
) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }

    let provider = match station_api::get_provider_record(station_client, token, id) {
        Ok(provider) => provider,
        Err(error) => return station_error_to_result(error),
    };

    if let Err(e) = station_api::delete_provider(station_client, token, id, provider.version) {
        return station_error_to_result(e);
    }

    success_payload("provider_delete", json!({ "deleted": true }))
}

pub fn provider_list_available_models(
    station_client: &StationClient,
    _scope: &str,
    token: &str,
) -> AppResult<StubPayload> {
    let resp = match station_api::list_available_models(station_client, token) {
        Ok(v) => v,
        Err(e) => return station_error_to_result(e),
    };
    success_payload("provider_list_available_models", resp)
}

pub fn model_discover(
    station_client: &StationClient,
    _scope: &str,
    token: &str,
    provider_id: &str,
) -> AppResult<StubPayload> {
    let provider_id = provider_id.trim();
    if provider_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "provider_id is required", None);
    }
    match station_api::discover_provider_models(station_client, token, provider_id) {
        Ok(response) => success_payload("model_discover", response),
        Err(error) => station_error_to_result(error),
    }
}

pub fn enriched_path() -> String {
    let base = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/unknown".to_string());
    let extra = [
        format!("{home}/.local/bin"),
        format!("{home}/.cargo/bin"),
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
    ];
    let mut paths: Vec<&str> = extra.iter().map(|s| s.as_str()).collect();
    paths.extend(base.split(':'));
    paths.join(":")
}

pub fn model_add(
    station_client: &StationClient,
    token: &str,
    provider_id: &str,
    data: &Value,
) -> AppResult<StubPayload> {
    let model_id = data.get("id").and_then(Value::as_str).unwrap_or("").trim();
    if model_id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "model id is required", None);
    }

    let display_name = data
        .get("display_name")
        .and_then(Value::as_str)
        .unwrap_or(model_id)
        .trim();
    let enabled = data.get("enabled").and_then(Value::as_bool).unwrap_or(true);
    let context_window = data
        .get("context_window")
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .unwrap_or(0);
    let capabilities = data.get("capabilities").filter(|value| value.is_object());

    match station_api::create_model(
        station_client,
        token,
        provider_id.trim(),
        model_id,
        display_name,
        enabled,
        context_window,
        capabilities,
    ) {
        Ok(response) => success_payload("model_add", response),
        Err(error) => station_error_to_result(error),
    }
}

pub fn model_update(
    station_client: &StationClient,
    token: &str,
    provider_id: &str,
    model_id: &str,
    data: &Value,
) -> AppResult<StubPayload> {
    let models = match station_api::list_models(station_client, token, provider_id) {
        Ok(models) => models,
        Err(error) => return station_error_to_result(error),
    };
    let current = match models.iter().find(|model| model.model_id == model_id) {
        Some(model) => model,
        None => return AppResult::fail(ErrorCode::NotFound, "Model not found", None),
    };

    let display_name = data.get("display_name").and_then(Value::as_str);
    let enabled = data.get("enabled").and_then(Value::as_bool);
    let context_window = data
        .get("context_window")
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok());
    let capabilities = data.get("capabilities").filter(|value| value.is_object());

    match station_api::update_model(
        station_client,
        token,
        provider_id,
        model_id,
        current.version,
        display_name,
        enabled,
        context_window,
        capabilities,
    ) {
        Ok(model) => success_payload("model_update", json!({ "ok": true, "model": model })),
        Err(error) => station_error_to_result(error),
    }
}

pub fn model_toggle(
    station_client: &StationClient,
    token: &str,
    provider_id: &str,
    model_id: &str,
    enabled: bool,
) -> AppResult<StubPayload> {
    let models = match station_api::list_models(station_client, token, provider_id) {
        Ok(m) => m,
        Err(e) => return station_error_to_result(e),
    };
    let model = match models.iter().find(|m| m.model_id == model_id) {
        Some(m) => m,
        None => return AppResult::fail(ErrorCode::NotFound, "Model not found", None),
    };
    if let Err(e) = station_api::update_model(
        station_client,
        token,
        provider_id,
        model_id,
        model.version,
        None,
        Some(enabled),
        None,
        None,
    ) {
        return station_error_to_result(e);
    }
    success_payload("model_toggle", json!({ "ok": true, "enabled": enabled }))
}

pub fn model_delete(
    station_client: &StationClient,
    token: &str,
    provider_id: &str,
    model_id: &str,
) -> AppResult<StubPayload> {
    if let Err(e) = station_api::hide_model(station_client, token, provider_id, model_id) {
        return station_error_to_result(e);
    }
    success_payload("model_delete", json!({ "ok": true }))
}

fn parse_key_vault_api_key(key_vaults: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(key_vaults)
        .ok()
        .and_then(|v| v.get("api_key").and_then(|k| k.as_str()).map(String::from))
}
