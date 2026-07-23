use crate::contracts::{
    ProviderCheckInput, ProviderCreateInput, ProviderIdInput, ProviderUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use serde_json::json;

pub(crate) mod cache;
pub(crate) mod remote;
pub(crate) mod state;
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

pub fn provider_list(scope: &str, token: &str) -> AppResult<StubPayload> {
    let providers = match cache::get_providers(token, scope) {
        Ok(providers) => providers,
        Err(e) => return station_error_to_result(e),
    };

    let provider_json: Vec<serde_json::Value> = providers
        .iter()
        .map(|p| {
            json!({
                "id": p.name,
                "name": p.display_name,
                "description": "",
                "enabled": p.enabled,
                "logo": "",
                "source": "station",
                "protocol": p.protocol,
                "runtime_kind": p.runtime_kind,
                "base_url": p.base_url,
                "version": p.version,
            })
        })
        .collect();

    success_payload(
        "provider_list",
        json!({
            "providers": provider_json,
            "total": provider_json.len()
        }),
    )
}

pub fn provider_get(scope: &str, token: &str, input: ProviderIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }

    let provider = match cache::find_provider(token, scope, id) {
        Ok(Some(p)) => p,
        Ok(None) => return AppResult::fail(ErrorCode::NotFound, "Provider not found", None),
        Err(e) => return station_error_to_result(e),
    };

    success_payload(
        "provider_get",
        json!({
            "provider": {
                "id": provider.name,
                "name": provider.display_name,
                "enabled": provider.enabled,
                "protocol": provider.protocol,
                "runtime_kind": provider.runtime_kind,
                "base_url": provider.base_url,
                "version": provider.version,
                "config": provider.config,
            }
        }),
    )
}

pub fn provider_update(
    scope: &str,
    token: &str,
    input: ProviderUpdateInput,
) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }

    let current = match cache::find_provider(token, scope, id) {
        Ok(Some(p)) => p,
        Ok(None) => return AppResult::fail(ErrorCode::NotFound, "Provider not found", None),
        Err(e) => return station_error_to_result(e),
    };

    let base_url = input
        .config_json
        .as_deref()
        .and_then(|cfg| serde_json::from_str::<serde_json::Value>(cfg).ok())
        .and_then(|v| v.get("base_url").and_then(|u| u.as_str()).map(String::from));

    let provider = match station_api::update_provider(
        token,
        id,
        current.version,
        None,
        base_url.as_deref(),
        Some(input.enabled),
        None,
    ) {
        Ok(p) => p,
        Err(e) => return station_error_to_result(e),
    };

    cache::invalidate(scope);

    success_payload(
        "provider_update",
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

    // Provider reachability check is deferred to Station in future phases.
    // For now, return a basic "check not available" response.
    success_payload(
        "provider_check",
        json!({ "ok": true, "provider_id": id, "note": "reachability check delegated to Station" }),
    )
}

pub fn provider_create(
    scope: &str,
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

    // Set credential if provided
    if let Some(api_key) = parse_key_vault_api_key(&input.key_vaults) {
        let _ = station_api::set_credential(token, &provider.name, &api_key);
    }

    cache::invalidate(scope);

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
    scope: &str,
    token: &str,
    input: ProviderIdInput,
) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }

    let current = match cache::find_provider(token, scope, id) {
        Ok(Some(p)) => p,
        Ok(None) => return AppResult::fail(ErrorCode::NotFound, "Provider not found", None),
        Err(e) => return station_error_to_result(e),
    };

    if let Err(e) = station_api::delete_provider(token, id, current.version) {
        return station_error_to_result(e);
    }

    cache::invalidate(scope);

    success_payload("provider_delete", json!({ "deleted": true }))
}

pub fn provider_list_available_models(scope: &str, token: &str) -> AppResult<StubPayload> {
    let providers = match cache::get_providers(token, scope) {
        Ok(providers) => providers,
        Err(e) => return station_error_to_result(e),
    };

    let mut all_models = Vec::new();
    for provider in &providers {
        if !provider.enabled {
            continue;
        }
        if let Ok(models) = cache::get_models(token, scope, &provider.name) {
            for model in models {
                if model.enabled {
                    all_models.push(json!({
                        "id": model.model_id,
                        "provider_id": provider.name,
                        "provider_name": provider.display_name,
                        "display_name": model.display_name,
                        "enabled": model.enabled,
                    }));
                }
            }
        }
    }

    success_payload(
        "provider_list_available_models",
        json!({
            "models": all_models,
            "total": all_models.len()
        }),
    )
}

fn parse_key_vault_api_key(key_vaults: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(key_vaults)
        .ok()
        .and_then(|v| v.get("api_key").and_then(|k| k.as_str()).map(String::from))
}
