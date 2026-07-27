use crate::contracts::{
    ProviderCheckInput, ProviderCreateInput, ProviderIdInput, ProviderUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use serde_json::json;

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
            &format!("Version conflict: current={}, submitted={}", current, submitted),
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

pub fn provider_list(_scope: &str, token: &str) -> AppResult<StubPayload> {
    let resp = match station_api::list_providers(token) {
        Ok(v) => v,
        Err(e) => return station_error_to_result(e),
    };
    success_payload("provider_list", resp)
}

pub fn provider_get(_scope: &str, token: &str, input: ProviderIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }

    let resp = match station_api::get_provider(token, id) {
        Ok(v) => v,
        Err(e) => return station_error_to_result(e),
    };
    success_payload("provider_get", resp)
}

pub fn provider_update(
    _scope: &str,
    token: &str,
    input: ProviderUpdateInput,
) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }

    let resp = match station_api::update_provider_full(
        token,
        id,
        input.enabled,
        input.config_json.as_deref(),
        input.key_vaults.as_deref(),
        input.version,
    ) {
        Ok(v) => v,
        Err(e) => return station_error_to_result(e),
    };
    success_payload("provider_update", resp)
}

pub fn provider_check(
    _scope: &str,
    _token: &str,
    input: ProviderCheckInput,
) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return success_payload(
            "provider_check",
            json!({ "ok": false, "error": "id is required" }),
        );
    }
    success_payload(
        "provider_check",
        json!({ "ok": true, "provider_id": id, "note": "reachability check delegated to Station" }),
    )
}

pub fn provider_create(
    _scope: &str,
    token: &str,
    input: ProviderCreateInput,
) -> AppResult<StubPayload> {
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

    let provider_id = name.to_lowercase().replace(' ', "-");

    let provider = match station_api::create_provider(
        token,
        &provider_id,
        name,
        &base_url,
        &protocol,
        None,
    ) {
        Ok(p) => p,
        Err(e) => return station_error_to_result(e),
    };

    if let Some(api_key) = parse_key_vault_api_key(&input.key_vaults) {
        let _ = station_api::set_credential(token, &provider.name, &api_key);
    }

    success_payload(
        "provider_create",
        json!({
            "provider": {
                "id": provider.name,
                "name": provider.display_name,
                "enabled": provider.enabled,
                "version": provider.version,
            }
        }),
    )
}

pub fn provider_delete(
    _scope: &str,
    token: &str,
    input: ProviderIdInput,
) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }

    if let Err(e) = station_api::delete_provider(token, id, 0) {
        return station_error_to_result(e);
    }

    success_payload("provider_delete", json!({ "deleted": true }))
}

pub fn provider_list_available_models(_scope: &str, token: &str) -> AppResult<StubPayload> {
    let resp = match station_api::list_available_models(token) {
        Ok(v) => v,
        Err(e) => return station_error_to_result(e),
    };
    success_payload("provider_list_available_models", resp)
}

pub fn model_fetch_remote(_scope: &str, token: &str, provider_id: &str) -> AppResult<StubPayload> {
    let resp = match station_api::get_provider(token, provider_id) {
        Ok(v) => v,
        Err(_) => return success_payload("model_fetch_remote", json!({ "ok": true, "models": [] })),
    };

    let provider = resp.get("provider").cloned().unwrap_or(json!({}));
    let runtime_kind = provider.get("runtime_kind").and_then(|v| v.as_str()).unwrap_or("");
    let models_command = provider.get("models_command").and_then(|v| v.as_str()).unwrap_or("");

    if runtime_kind == "cli" && !models_command.is_empty() {
        let models = execute_cli_models_command(models_command);
        return success_payload("model_fetch_remote", json!({ "ok": true, "models": models }));
    }

    let models = provider.get("models").cloned().unwrap_or(json!([]));
    success_payload("model_fetch_remote", json!({ "ok": true, "models": models }))
}

fn execute_cli_models_command(command: &str) -> Vec<String> {
    use std::process::Command;

    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return vec![];
    }

    let output = Command::new(parts[0])
        .args(&parts[1..])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect()
        }
        _ => vec![],
    }
}

pub fn model_delete(token: &str, provider_id: &str, model_id: &str) -> AppResult<StubPayload> {
    if let Err(e) = station_api::hide_model(token, provider_id, model_id) {
        return station_error_to_result(e);
    }
    success_payload("model_delete", json!({ "ok": true }))
}

fn parse_key_vault_api_key(key_vaults: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(key_vaults)
        .ok()
        .and_then(|v| v.get("api_key").and_then(|k| k.as_str()).map(String::from))
}
