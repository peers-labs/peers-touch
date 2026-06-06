use crate::contracts::{
    ProviderCheckInput, ProviderCreateInput, ProviderIdInput, ProviderUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use serde_json::json;
use state::{find_seeded_provider, persist_provider_store, with_provider_store, ProviderRecord};

pub(crate) mod cli_runtime;
pub(crate) mod remote;
pub(crate) mod state;
pub(crate) mod sync;

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

fn internal_error() -> AppResult<StubPayload> {
    tracing::error!("Failed to acquire provider store lock");
    AppResult::fail(
        ErrorCode::InternalError,
        "Failed to access provider store",
        None,
    )
}

pub fn provider_list(scope: Option<&str>) -> AppResult<StubPayload> {
    let providers = match with_provider_store(scope, |store| {
        store
            .providers
            .iter()
            .map(ProviderRecord::to_json)
            .collect::<Vec<_>>()
    }) {
        Ok(providers) => providers,
        Err(_) => return internal_error(),
    };
    success_payload(
        "provider_list",
        json!({
            "providers": providers,
            "total": providers.len()
        }),
    )
}

pub fn provider_get(scope: Option<&str>, input: ProviderIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    match with_provider_store(scope, |store| {
        store
            .providers
            .iter()
            .find(|provider| provider.id == id)
            .map(ProviderRecord::to_json)
    }) {
        Ok(Some(provider)) => success_payload("provider_get", json!({ "provider": provider })),
        Ok(None) => AppResult::fail(ErrorCode::NotFound, "Provider not found", None),
        Err(_) => internal_error(),
    }
}

pub fn provider_update(scope: Option<&str>, input: ProviderUpdateInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    match with_provider_store(scope, |store| {
        let Some(provider) = store
            .providers
            .iter_mut()
            .find(|provider| provider.id == id)
        else {
            return None;
        };
        provider.enabled = input.enabled;
        if let Some(key_vaults) = input.key_vaults {
            provider.key_vaults = key_vaults;
        }
        if let Some(config_json) = input.config_json {
            provider.config_json = config_json;
        }
        Some(provider.to_json())
    }) {
        Ok(Some(provider)) => {
            if persist_provider_store(scope).is_err() {
                tracing::error!("Failed to persist provider store after update");
                return internal_error();
            }
            success_payload("provider_update", json!({ "provider": provider }))
        }
        Ok(None) => AppResult::fail(ErrorCode::NotFound, "Provider not found", None),
        Err(_) => internal_error(),
    }
}

pub fn provider_check(scope: Option<&str>, input: ProviderCheckInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return success_payload(
            "provider_check",
            json!({ "ok": false, "error": "id is required" }),
        );
    }
    let provider = match with_provider_store(scope, |store| {
        store
            .providers
            .iter()
            .find(|provider| provider.id == id)
            .cloned()
    }) {
        Ok(provider) => provider,
        Err(_) => return internal_error(),
    };
    let Some(provider) = provider else {
        return success_payload(
            "provider_check",
            json!({ "ok": false, "error": "provider not found" }),
        );
    };
    let api_key = input
        .key_vaults
        .as_deref()
        .and_then(parse_key_vault_api_key)
        .or_else(|| parse_key_vault_api_key(&provider.key_vaults))
        .unwrap_or_default();
    if api_key.trim().is_empty() {
        return success_payload(
            "provider_check",
            json!({ "ok": false, "error": "api_key is required" }),
        );
    }
    let base_url = input
        .config_json
        .as_deref()
        .and_then(|raw| parse_config_field(raw, "base_url"))
        .or_else(|| parse_config_field(&provider.config_json, "base_url"))
        .unwrap_or_default();
    if base_url.trim().is_empty() {
        return success_payload(
            "provider_check",
            json!({ "ok": false, "error": "base_url is required" }),
        );
    }
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return success_payload(
            "provider_check",
            json!({ "ok": false, "error": "base_url must start with http:// or https://" }),
        );
    }
    let model = input
        .config_json
        .as_deref()
        .and_then(|raw| parse_config_field(raw, "model"))
        .filter(|value| !value.trim().is_empty())
        .or_else(|| Some(provider.check_model.clone()))
        .unwrap_or_default();
    if model.trim().is_empty() {
        return success_payload(
            "provider_check",
            json!({ "ok": false, "error": "model is required" }),
        );
    }
    let protocol = input
        .config_json
        .as_deref()
        .and_then(|raw| parse_config_field(raw, "protocol"))
        .or_else(|| parse_config_field(&provider.config_json, "protocol"));
    match remote::probe_provider(&base_url, &api_key, &model, protocol.as_deref()) {
        Ok(result) => success_payload(
            "provider_check",
            json!({
                "ok": true,
                "message": format!("provider {} reachable via {}", id, result.endpoint)
            }),
        ),
        Err(err) => success_payload("provider_check", json!({ "ok": false, "error": err })),
    }
}

pub fn provider_create(scope: Option<&str>, input: ProviderCreateInput) -> AppResult<StubPayload> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let provider = match with_provider_store(scope, |store| {
        let id = format!("provider-{}", store.providers.len() + 1);
        let provider = ProviderRecord {
            id,
            name: name.to_string(),
            description: input.description,
            logo: input.logo,
            enabled: true,
            key_vaults: input.key_vaults,
            config_json: input.config_json,
            check_model: "default".to_string(),
            models: vec![],
            builtin: false,
            show_checker: true,
            show_api_key: true,
        };
        store.providers.push(provider.clone());
        provider.to_json()
    }) {
        Ok(provider) => provider,
        Err(_) => return internal_error(),
    };
    if persist_provider_store(scope).is_err() {
        tracing::error!("Failed to persist provider store after create");
        return internal_error();
    }
    success_payload("provider_create", json!({ "provider": provider }))
}

pub fn provider_delete(scope: Option<&str>, input: ProviderIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let deleted = match with_provider_store(scope, |store| {
        let before = store.providers.len();
        store.providers.retain(|provider| provider.id != id);
        before != store.providers.len()
    }) {
        Ok(deleted) => deleted,
        Err(_) => return internal_error(),
    };
    if deleted && persist_provider_store(scope).is_err() {
        tracing::error!("Failed to persist provider store after delete");
        return internal_error();
    }
    success_payload("provider_delete", json!({ "success": deleted }))
}

pub fn provider_apply_preset(
    scope: Option<&str>,
    input: ProviderIdInput,
) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let Some(seed) = find_seeded_provider(id) else {
        return AppResult::fail(ErrorCode::NotFound, "Provider preset not found", None);
    };
    match with_provider_store(scope, |store| {
        if let Some(existing) = store.providers.iter_mut().find(|p| p.id == id) {
            *existing = seed.clone();
        } else {
            store.providers.push(seed.clone());
        }
        seed.to_json()
    }) {
        Ok(provider) => {
            if persist_provider_store(scope).is_err() {
                tracing::error!("Failed to persist provider store after apply preset");
                return internal_error();
            }
            success_payload(
                "provider_apply_preset",
                json!({ "ok": true, "provider": provider }),
            )
        }
        Err(_) => internal_error(),
    }
}

pub fn provider_list_available_models(scope: Option<&str>) -> AppResult<StubPayload> {
    let providers = match with_provider_store(scope, |store| {
        store
            .providers
            .iter()
            .filter(|p| p.enabled)
            .map(ProviderRecord::to_json)
            .collect::<Vec<_>>()
    }) {
        Ok(providers) => providers,
        Err(_) => return internal_error(),
    };
    success_payload(
        "provider_list_available_models",
        json!({ "providers": providers }),
    )
}

fn parse_key_vault_api_key(raw: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| {
            v.get("api_key")
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string)
        })
}

fn parse_config_field(raw: &str, key: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| {
            v.get(key)
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{ProviderCheckInput, ProviderIdInput};

    fn parse_status(payload: &StubPayload) -> serde_json::Value {
        serde_json::from_str(&payload.status).expect("status should be valid json")
    }

    #[test]
    fn provider_check_should_fail_for_empty_id() {
        let result = provider_check(
            None,
            ProviderCheckInput {
                id: "".to_string(),
                key_vaults: None,
                config_json: None,
            },
        );
        assert!(result.ok);
        let payload = result.data.expect("payload should exist");
        let status = parse_status(&payload);
        assert_eq!(status["ok"], false);
        assert_eq!(status["error"], "id is required");
    }

    #[test]
    fn provider_check_should_fail_when_api_key_missing() {
        let result = provider_check(
            None,
            ProviderCheckInput {
                id: "openai".to_string(),
                key_vaults: None,
                config_json: Some(
                    "{\"base_url\":\"https://api.openai.com/v1\",\"model\":\"gpt-4o-mini\"}"
                        .to_string(),
                ),
            },
        );
        assert!(result.ok);
        let payload = result.data.expect("payload should exist");
        let status = parse_status(&payload);
        assert_eq!(status["ok"], false);
        assert_eq!(status["error"], "api_key is required");
    }

    #[test]
    fn apply_preset_should_reset_modified_provider_to_seed() {
        let scope = Some("test-apply-preset");
        with_provider_store(scope, |store| {
            if let Some(provider) = store.providers.iter_mut().find(|p| p.id == "openai") {
                provider.name = "Modified Name".to_string();
                provider.enabled = false;
            }
        })
        .unwrap();
        let result = provider_apply_preset(
            scope,
            ProviderIdInput {
                id: "openai".to_string(),
            },
        );
        assert!(result.ok);
        let payload = result.data.expect("payload should exist");
        let status = parse_status(&payload);
        assert_eq!(status["ok"], true);
        assert_eq!(status["provider"]["name"], "OpenAI");
        assert_eq!(status["provider"]["enabled"], true);
        let stored = with_provider_store(scope, |store| {
            store
                .providers
                .iter()
                .find(|p| p.id == "openai")
                .map(|p| p.name.clone())
        })
        .unwrap();
        assert_eq!(stored, Some("OpenAI".to_string()));
    }

    #[test]
    fn apply_preset_should_fail_for_non_seed_provider() {
        let result = provider_apply_preset(
            None,
            ProviderIdInput {
                id: "custom-provider-xyz".to_string(),
            },
        );
        assert!(!result.ok);
    }
}
