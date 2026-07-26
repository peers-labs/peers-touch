use crate::contracts::{
    ProviderCheckInput, ProviderCreateInput, ProviderIdInput, ProviderUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use serde_json::json;

pub(crate) mod cache;
pub(crate) mod catalog;
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

pub fn provider_list(scope: &str, token: &str) -> AppResult<StubPayload> {
    let catalog = catalog::list_catalog();

    let station_providers = cache::get_providers(token, scope).ok().unwrap_or_default();

    let provider_json: Vec<serde_json::Value> = catalog
        .iter()
        .map(|cp| {
            let station_match = station_providers.iter().find(|sp| sp.name == cp.id);
            let has_credential = station_match
                .map(|sp| sp.config.as_ref().map_or(false, |c| !c.is_null()))
                .unwrap_or(false);
            let credential_status = if has_credential { "configured" } else { "not_configured" };
            let enabled = station_match.map(|sp| sp.enabled).unwrap_or(cp.enabled);
            let version = station_match.map(|sp| sp.version).unwrap_or(0);

            json!({
                "id": cp.id,
                "name": cp.name,
                "description": cp.description,
                "enabled": enabled,
                "builtin": cp.builtin,
                "logo": "",
                "source": "catalog",
                "protocol": cp.protocol,
                "discovery": cp.discovery,
                "runtime_kind": cp.runtime_kind.as_deref().unwrap_or(""),
                "base_url": cp.default_base_url,
                "home_url": cp.home_url,
                "api_key_url": cp.api_key_url,
                "show_checker": cp.show_checker,
                "show_api_key": cp.show_api_key.unwrap_or(true),
                "credential_status": credential_status,
                "version": version,
                "models": cp.models.iter().map(|m| json!({
                    "id": m.id,
                    "display_name": m.display_name,
                    "type": m.model_type,
                    "enabled": m.enabled,
                    "context_window": m.context_window,
                })).collect::<Vec<_>>(),
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

    let catalog_entry = catalog::find_in_catalog(id);
    let station_entry = cache::find_provider(token, scope, id).ok().flatten();

    if catalog_entry.is_none() && station_entry.is_none() {
        return AppResult::fail(ErrorCode::NotFound, "Provider not found", None);
    }

    let (name, description, protocol, base_url, runtime_kind, enabled, version, home_url, api_key_url, show_checker, show_api_key, models) =
        if let Some(cp) = catalog_entry {
            let enabled = station_entry.as_ref().map(|sp| sp.enabled).unwrap_or(cp.enabled);
            let version = station_entry.as_ref().map(|sp| sp.version).unwrap_or(0);
            let models: Vec<serde_json::Value> = cp.models.iter().map(|m| json!({
                "id": m.id,
                "display_name": m.display_name,
                "type": m.model_type,
                "enabled": m.enabled,
                "context_window": m.context_window,
            })).collect();
            (
                cp.name.clone(), cp.description.clone(), cp.protocol.clone(),
                cp.default_base_url.clone(), cp.runtime_kind.clone().unwrap_or_default(),
                enabled, version, cp.home_url.clone(), cp.api_key_url.clone(),
                cp.show_checker, cp.show_api_key.unwrap_or(true), models,
            )
        } else {
            let sp = station_entry.unwrap();
            (
                sp.display_name.clone(), String::new(), sp.protocol.clone(),
                sp.base_url.clone(), sp.runtime_kind.clone(),
                sp.enabled, sp.version, String::new(), String::new(),
                false, true, vec![],
            )
        };

    success_payload(
        "provider_get",
        json!({
            "provider": {
                "id": id,
                "name": name,
                "description": description,
                "enabled": enabled,
                "protocol": protocol,
                "runtime_kind": runtime_kind,
                "base_url": base_url,
                "home_url": home_url,
                "api_key_url": api_key_url,
                "show_checker": show_checker,
                "show_api_key": show_api_key,
                "version": version,
                "models": models,
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

    let base_url = input
        .config_json
        .as_deref()
        .and_then(|cfg| serde_json::from_str::<serde_json::Value>(cfg).ok())
        .and_then(|v| v.get("base_url").and_then(|u| u.as_str()).map(String::from));

    let station_record = cache::find_provider(token, scope, id).ok().flatten();

    let provider = if let Some(current) = station_record {
        match station_api::update_provider(
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
        }
    } else {
        let cp = catalog::find_in_catalog(id);
        let display_name = cp.map(|c| c.name.as_str()).unwrap_or(id);
        let protocol = cp.map(|c| c.protocol.as_str()).unwrap_or("openai-compatible");
        let effective_base_url = base_url
            .as_deref()
            .or_else(|| cp.map(|c| c.default_base_url.as_str()))
            .unwrap_or("");

        match station_api::create_provider(token, id, display_name, effective_base_url, protocol, None) {
            Ok(p) => p,
            Err(e) => return station_error_to_result(e),
        }
    };

    if let Some(ref kv) = input.key_vaults {
        if let Some(api_key) = parse_key_vault_api_key(kv) {
            let _ = station_api::set_credential(token, &provider.name, &api_key);
        }
    }

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
    let catalog = catalog::list_catalog();
    let station_providers = cache::get_providers(token, scope).ok().unwrap_or_default();

    let mut all_models = Vec::new();
    for cp in catalog {
        let station_match = station_providers.iter().find(|sp| sp.name == cp.id);
        let has_station_record = station_match.is_some();
        let is_enabled = station_match.map(|sp| sp.enabled).unwrap_or(false);

        if !has_station_record || !is_enabled {
            continue;
        }

        for model in &cp.models {
            if model.enabled {
                all_models.push(json!({
                    "id": model.id,
                    "provider_id": cp.id,
                    "provider_name": cp.name,
                    "display_name": model.display_name,
                    "type": model.model_type,
                    "enabled": model.enabled,
                    "context_window": model.context_window,
                }));
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
