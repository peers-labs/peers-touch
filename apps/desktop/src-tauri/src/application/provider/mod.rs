use crate::contracts::{
    ProviderCheckInput, ProviderCreateInput, ProviderIdInput, ProviderUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use serde_json::json;
use state::{find_seeded_provider, persist_provider_store, with_provider_store, ProviderRecord};
use std::env;
use std::path::Path;

pub(crate) mod cache;
pub(crate) mod remote;
pub(crate) mod state;
pub(crate) mod station_api;
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
    let runtime_kind = input.runtime_kind;
    let cli_command = input.cli_command;
    let protocol = input.protocol;
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
        let config_json = input
            .config_json
            .map(|patch| merge_provider_config_json(provider.config_json.clone(), patch))
            .unwrap_or_else(|| provider.config_json.clone());
        provider.config_json =
            merge_provider_runtime_config(config_json, runtime_kind, cli_command, protocol);
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
    let effective_config = input
        .config_json
        .as_deref()
        .unwrap_or(&provider.config_json);
    if provider_is_cli(effective_config) {
        let command_line = parse_config_field(effective_config, "cli_command").unwrap_or_default();
        return check_cli_provider(id, &command_line);
    }
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
        .or_else(|| parse_config_field(effective_config, "base_url"))
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
        .or_else(|| parse_config_field(effective_config, "protocol"));
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
    let name = name.to_string();
    let provider = match with_provider_store(scope, |store| {
        let id = format!("provider-{}", store.providers.len() + 1);
        let config_json = merge_provider_runtime_config(
            input.config_json,
            input.runtime_kind,
            input.cli_command,
            input.protocol,
        );
        let provider = ProviderRecord {
            id,
            name: name.clone(),
            description: input.description,
            logo: input.logo,
            enabled: true,
            key_vaults: input.key_vaults,
            config_json,
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

fn merge_provider_runtime_config(
    raw: String,
    runtime_kind: Option<String>,
    cli_command: Option<String>,
    protocol: Option<String>,
) -> String {
    let mut value = serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| json!({}));
    if let Some(runtime_kind) = runtime_kind.map(|value| value.trim().to_string()) {
        if !runtime_kind.is_empty() {
            value["runtime_kind"] = serde_json::Value::String(runtime_kind);
        }
    }
    if let Some(cli_command) = cli_command.map(|value| value.trim().to_string()) {
        if !cli_command.is_empty() {
            value["cli_command"] = serde_json::Value::String(cli_command);
        }
    }
    if let Some(protocol) = protocol.map(|value| value.trim().to_string()) {
        if !protocol.is_empty() {
            value["protocol"] = serde_json::Value::String(protocol);
        }
    }
    value.to_string()
}

fn merge_provider_config_json(base: String, patch: String) -> String {
    let mut base_value = serde_json::from_str::<serde_json::Value>(&base)
        .ok()
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| json!({}));
    let patch_value = serde_json::from_str::<serde_json::Value>(&patch)
        .ok()
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| json!({}));
    if let (Some(base_map), Some(patch_map)) = (base_value.as_object_mut(), patch_value.as_object())
    {
        for (key, value) in patch_map {
            base_map.insert(key.clone(), value.clone());
        }
    }
    base_value.to_string()
}

fn provider_is_cli(config_json: &str) -> bool {
    parse_config_field(config_json, "runtime_kind")
        .map(|value| value.eq_ignore_ascii_case("cli"))
        .unwrap_or(false)
        || parse_config_field(config_json, "protocol")
            .map(|value| value.eq_ignore_ascii_case("cli"))
            .unwrap_or(false)
}

fn check_cli_provider(id: &str, command_line: &str) -> AppResult<StubPayload> {
    let Some(program) = command_line.split_whitespace().next() else {
        return success_payload(
            "provider_check",
            json!({ "ok": false, "error": "cli_command is required" }),
        );
    };
    if command_available(program) {
        return success_payload(
            "provider_check",
            json!({
                "ok": true,
                "message": format!("provider {id} CLI command available: {program}")
            }),
        );
    }
    success_payload(
        "provider_check",
        json!({ "ok": false, "error": format!("CLI command not found in PATH: {program}") }),
    )
}

fn command_available(program: &str) -> bool {
    let path = Path::new(program);
    if path.components().count() > 1 {
        return path.is_file();
    }
    env::var_os("PATH")
        .map(|paths| {
            env::split_paths(&paths).any(|dir| {
                let candidate = dir.join(program);
                candidate.is_file()
            })
        })
        .unwrap_or(false)
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
    fn provider_create_should_merge_cli_runtime_fields() {
        let result = provider_create(
            Some("test-create-cli-provider"),
            ProviderCreateInput {
                name: "Custom CLI".to_string(),
                description: "custom cli provider".to_string(),
                logo: "".to_string(),
                key_vaults: "{}".to_string(),
                config_json: "{}".to_string(),
                runtime_kind: Some("cli".to_string()),
                cli_command: Some("cursor-agent --print --output-format text --trust".to_string()),
                protocol: Some("cli".to_string()),
            },
        );
        assert!(result.ok);
        let payload = result.data.expect("payload should exist");
        let status = parse_status(&payload);
        let config: serde_json::Value =
            serde_json::from_str(status["provider"]["config_json"].as_str().unwrap())
                .expect("config should be json");
        assert_eq!(config["runtime_kind"], "cli");
        assert_eq!(config["protocol"], "cli");
        assert_eq!(
            config["cli_command"],
            "cursor-agent --print --output-format text --trust"
        );
    }

    #[test]
    fn provider_check_should_validate_cli_command_availability() {
        let result = provider_check(
            None,
            ProviderCheckInput {
                id: "cursor-cli".to_string(),
                key_vaults: None,
                config_json: Some(
                    "{\"runtime_kind\":\"cli\",\"cli_command\":\"definitely-missing-agent-cli\"}"
                        .to_string(),
                ),
            },
        );
        assert!(result.ok);
        let payload = result.data.expect("payload should exist");
        let status = parse_status(&payload);
        assert_eq!(status["ok"], false);
        assert_eq!(
            status["error"],
            "CLI command not found in PATH: definitely-missing-agent-cli"
        );
    }

    #[test]
    fn provider_update_should_preserve_cli_runtime_config() {
        let scope = Some("test-update-cli-provider");
        let create_result = provider_create(
            scope,
            ProviderCreateInput {
                name: "Toggle CLI".to_string(),
                description: "custom cli provider".to_string(),
                logo: "".to_string(),
                key_vaults: "{}".to_string(),
                config_json: "{\"runtime_kind\":\"cli\",\"cli_command\":\"traecli exec --skip-git-repo-check -\",\"protocol\":\"cli\"}".to_string(),
                runtime_kind: None,
                cli_command: None,
                protocol: None,
            },
        );
        assert!(create_result.ok);
        let payload = create_result.data.expect("payload should exist");
        let status = parse_status(&payload);
        let provider_id = status["provider"]["id"].as_str().unwrap().to_string();

        let update_result = provider_update(
            scope,
            ProviderUpdateInput {
                id: provider_id,
                enabled: false,
                key_vaults: Some("{}".to_string()),
                config_json: Some("{\"base_url\":\"\"}".to_string()),
                runtime_kind: None,
                cli_command: None,
                protocol: None,
            },
        );
        assert!(update_result.ok);
        let payload = update_result.data.expect("payload should exist");
        let status = parse_status(&payload);
        let config: serde_json::Value =
            serde_json::from_str(status["provider"]["config_json"].as_str().unwrap())
                .expect("config should be json");
        assert_eq!(config["runtime_kind"], "cli");
        assert_eq!(
            config["cli_command"],
            "traecli exec --skip-git-repo-check -"
        );
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
