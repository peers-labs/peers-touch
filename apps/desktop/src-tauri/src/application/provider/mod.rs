use crate::contracts::{
    ProviderCheckInput, ProviderCreateInput, ProviderIdInput, ProviderUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use serde_json::json;
use state::{find_seeded_provider, persist_provider_store, with_provider_store, ProviderRecord};
use std::path::Path;

pub(crate) mod cli_runtime;
pub(crate) mod remote;
pub(crate) mod state;
pub(crate) mod sync;

const MIN_CLI_TIMEOUT_MS: u64 = 100;
const MAX_CLI_TIMEOUT_MS: u64 = 60 * 60 * 1000;
const MAX_CLI_ENV_ITEMS: usize = 64;
const MAX_CLI_ENV_VALUE_LEN: usize = 8192;
const MAX_CLI_RETRIES: u64 = 5;
const MAX_CLI_TOOL_ALLOWLIST_ITEMS: usize = 128;
const MAX_CLI_TOOL_ALLOWLIST_ITEM_LEN: usize = 128;

fn cli_sandbox_preset_is_valid(value: &str) -> bool {
    matches!(
        value,
        "workspace-readonly" | "workspace-write" | "network-off" | "unrestricted"
    )
}

fn cli_tool_name_is_valid(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_CLI_TOOL_ALLOWLIST_ITEM_LEN
        && value.chars().all(|ch| {
            ch == '*'
                || ch == '-'
                || ch == '_'
                || ch == '.'
                || ch == ':'
                || ch == '/'
                || ch.is_ascii_alphanumeric()
        })
}

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

fn merge_json_object(existing: &str, patch: &str) -> String {
    let mut base = serde_json::from_str::<serde_json::Value>(existing)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    let Ok(patch_value) = serde_json::from_str::<serde_json::Value>(patch) else {
        return patch.to_string();
    };
    let Some(patch_object) = patch_value.as_object() else {
        return patch.to_string();
    };
    for (key, value) in patch_object {
        if value.is_null() {
            base.remove(key);
        } else {
            base.insert(key.clone(), value.clone());
        }
    }
    serde_json::Value::Object(base).to_string()
}

fn json_object(raw: &str) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let value = serde_json::from_str::<serde_json::Value>(raw)
        .map_err(|err| format!("provider config_json must be valid JSON: {}", err))?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| "provider config_json must be a JSON object".to_string())
}

fn merged_config_value(existing: &str, patch: Option<&str>) -> Result<serde_json::Value, String> {
    let mut base = json_object(existing)?;
    if let Some(raw_patch) = patch {
        let patch_object = json_object(raw_patch)?;
        for (key, value) in patch_object {
            if value.is_null() {
                base.remove(&key);
            } else {
                base.insert(key, value);
            }
        }
    }
    Ok(serde_json::Value::Object(base))
}

fn config_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
}

fn cli_command_from_config(config: &serde_json::Value) -> String {
    config_string(config, "cli_command")
        .or_else(|| config_string(config, "command"))
        .or_else(|| config_string(config, "base_url"))
        .unwrap_or_default()
}

fn env_key_is_valid(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(first) if first == '_' || first.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn validate_cli_guardrails(
    config: &serde_json::Value,
    require_command: bool,
) -> Result<(), String> {
    let command = cli_command_from_config(config);
    if command.is_empty() {
        if require_command {
            return Err("CLI provider command is required".to_string());
        }
    } else {
        cli_runtime::validate_command_spec(&command)?;
    }

    if let Some(timeout) = config.get("timeout_ms") {
        if !timeout.is_null() {
            let Some(timeout_ms) = timeout.as_u64() else {
                return Err("CLI provider timeout_ms must be a positive integer".to_string());
            };
            if !(MIN_CLI_TIMEOUT_MS..=MAX_CLI_TIMEOUT_MS).contains(&timeout_ms) {
                return Err(format!(
                    "CLI provider timeout_ms must be between {} and {} ms",
                    MIN_CLI_TIMEOUT_MS, MAX_CLI_TIMEOUT_MS
                ));
            }
        }
    }

    if let Some(cwd) = config.get("cwd") {
        if !cwd.is_null() {
            let Some(cwd) = cwd.as_str().map(str::trim) else {
                return Err("CLI provider cwd must be a string".to_string());
            };
            if !cwd.is_empty() {
                let path = Path::new(cwd);
                if !path.is_absolute() {
                    return Err("CLI provider cwd must be an absolute path".to_string());
                }
                if !path.is_dir() {
                    return Err("CLI provider cwd must point to an existing directory".to_string());
                }
            }
        }
    }

    if let Some(env) = config.get("env") {
        if !env.is_null() {
            let Some(env) = env.as_object() else {
                return Err("CLI provider env must be an object".to_string());
            };
            if env.len() > MAX_CLI_ENV_ITEMS {
                return Err(format!(
                    "CLI provider env can contain at most {} entries",
                    MAX_CLI_ENV_ITEMS
                ));
            }
            for (key, value) in env {
                let key = key.trim();
                if !env_key_is_valid(key) {
                    return Err(format!("CLI provider env key `{}` is invalid", key));
                }
                let Some(value) = value.as_str() else {
                    return Err(format!(
                        "CLI provider env value for `{}` must be a string",
                        key
                    ));
                };
                if value.len() > MAX_CLI_ENV_VALUE_LEN {
                    return Err(format!("CLI provider env value for `{}` is too long", key));
                }
            }
        }
    }

    if let Some(sandbox) = config.get("sandbox_preset") {
        if !sandbox.is_null() {
            let Some(sandbox) = sandbox.as_str().map(str::trim) else {
                return Err("CLI provider sandbox_preset must be a string".to_string());
            };
            if !sandbox.is_empty() && !cli_sandbox_preset_is_valid(sandbox) {
                return Err(
                    "CLI provider sandbox_preset must be workspace-readonly, workspace-write, network-off, or unrestricted"
                        .to_string(),
                );
            }
        }
    }

    if let Some(max_retries) = config.get("max_retries") {
        if !max_retries.is_null() {
            let Some(max_retries) = max_retries.as_u64() else {
                return Err("CLI provider max_retries must be a non-negative integer".to_string());
            };
            if max_retries > MAX_CLI_RETRIES {
                return Err(format!(
                    "CLI provider max_retries must be between 0 and {}",
                    MAX_CLI_RETRIES
                ));
            }
        }
    }

    if let Some(allowlist) = config.get("tool_allowlist") {
        if !allowlist.is_null() {
            let Some(allowlist) = allowlist.as_array() else {
                return Err("CLI provider tool_allowlist must be an array".to_string());
            };
            if allowlist.len() > MAX_CLI_TOOL_ALLOWLIST_ITEMS {
                return Err(format!(
                    "CLI provider tool_allowlist can contain at most {} entries",
                    MAX_CLI_TOOL_ALLOWLIST_ITEMS
                ));
            }
            for item in allowlist {
                let Some(item) = item.as_str().map(str::trim) else {
                    return Err("CLI provider tool_allowlist entries must be strings".to_string());
                };
                if !cli_tool_name_is_valid(item) {
                    return Err(format!(
                        "CLI provider tool_allowlist entry `{}` is invalid",
                        item
                    ));
                }
            }
        }
    }

    Ok(())
}

fn validate_provider_config_value(
    config: &serde_json::Value,
    require_cli_command: bool,
) -> Result<(), String> {
    let protocol = config_string(config, "protocol");
    let protocol_key = remote::resolve_protocol_key(protocol.as_deref());
    if protocol_key == "cli-wrapped" {
        validate_cli_guardrails(config, require_cli_command)?;
    }
    Ok(())
}

fn validate_provider_config_json(raw: &str, require_cli_command: bool) -> Result<(), String> {
    let config = serde_json::Value::Object(json_object(raw)?);
    validate_provider_config_value(&config, require_cli_command)
}

fn capability_item(key: &str, status: &str, control: &str, note: &str) -> serde_json::Value {
    json!({
        "key": key,
        "status": status,
        "control": control,
        "note": note
    })
}

fn provider_capabilities(protocol_key: &str) -> serde_json::Value {
    if protocol_key == "cli-wrapped" {
        return json!([
            capability_item("prompt_envelope", "partial", "bounded", "Prompt, memory, skills, and workspace are projected into CLI input; internal prompt rewriting is opaque"),
            capability_item("model_selection", "partial", "bounded", "Peers passes the selected model to the CLI; the CLI may still apply its own model routing"),
            capability_item("streaming", "unsupported", "black_box", "Current CLI wrapper captures the final stdout result only"),
            capability_item("tool_loop", "partial", "bridge_only", "Station tools are allowed only through a restricted bridge; internal CLI tools are raw observations"),
            capability_item("memory_write", "partial", "bridge_only", "Memory writes must go through Station APIs or bridge tools"),
            capability_item("skills_mcp_a2a", "partial", "projected", "Skills, MCP, and A2A are projected or bridged; internal use is not fully traceable"),
            capability_item("approval_policy", "partial", "station_enforced", "Station approvals guard bridge calls, but internal CLI side effects remain opaque"),
            capability_item("trace_fidelity", "partial", "observed", "Trace includes process lifecycle, stdout/stderr, and bridge events, not CLI internals"),
            capability_item("cancellation_timeout", "supported", "process", "Process timeout and kill are controlled by the wrapper")
        ]);
    }
    json!([
        capability_item(
            "prompt_envelope",
            "supported",
            "controlled",
            "Peers owns prompt assembly and runtime envelope"
        ),
        capability_item(
            "model_selection",
            "supported",
            "controlled",
            "Model backend and model id are selected by provider/model configuration"
        ),
        capability_item(
            "streaming",
            "partial",
            "backend_dependent",
            "Streaming depends on the selected model backend path"
        ),
        capability_item(
            "tool_loop",
            "supported",
            "station_governed",
            "Station can own tool policy, approval, and replayable tool events"
        ),
        capability_item(
            "memory_write",
            "supported",
            "station_governed",
            "Memory writes are mediated by Station memory services"
        ),
        capability_item(
            "skills_mcp_a2a",
            "supported",
            "station_governed",
            "Skills, MCP, and A2A can be exposed as governed Station capabilities"
        ),
        capability_item(
            "approval_policy",
            "supported",
            "station_enforced",
            "Tool and bridge actions must pass Station policy"
        ),
        capability_item(
            "trace_fidelity",
            "supported",
            "structured",
            "TurnTrace can capture structured model/tool/memory events"
        ),
        capability_item(
            "cancellation_timeout",
            "partial",
            "runtime",
            "Timeout/cancel depends on the backend adapter and runner"
        )
    ])
}

fn provider_guardrail_warnings(
    protocol_key: &str,
    config: &serde_json::Value,
) -> Vec<serde_json::Value> {
    if protocol_key != "cli-wrapped" {
        return vec![];
    }
    let mut warnings = vec![json!({
        "code": "cli_black_box",
        "message": "CLI-wrapped providers are black-box providers. Only process controls, projected input, stdout/stderr, and bridge events are reliable."
    })];
    if config
        .get("cwd")
        .and_then(serde_json::Value::as_str)
        .is_none()
    {
        warnings.push(json!({
            "code": "cwd_not_set",
            "message": "CLI provider cwd is not set; the process will inherit the launcher working directory."
        }));
    }
    if config
        .get("timeout_ms")
        .and_then(serde_json::Value::as_u64)
        .is_none()
    {
        warnings.push(json!({
            "code": "timeout_default",
            "message": "CLI provider timeout is not set; the default process timeout will be used."
        }));
    }
    if config
        .get("sandbox_preset")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .is_none()
    {
        warnings.push(json!({
            "code": "sandbox_default",
            "message": "CLI provider sandbox preset is not set; workspace-readonly will be used."
        }));
    }
    if config
        .get("tool_allowlist")
        .and_then(serde_json::Value::as_array)
        .filter(|items| !items.is_empty())
        .is_none()
    {
        warnings.push(json!({
            "code": "tool_allowlist_empty",
            "message": "CLI provider bridge tool allowlist is empty; no governed bridge tools will be exposed."
        }));
    }
    warnings
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
    enum UpdateResult {
        Updated(serde_json::Value),
        Invalid(String),
        NotFound,
    }
    match with_provider_store(scope, |store| {
        let Some(provider) = store
            .providers
            .iter_mut()
            .find(|provider| provider.id == id)
        else {
            return UpdateResult::NotFound;
        };
        provider.enabled = input.enabled;
        if let Some(key_vaults) = input.key_vaults {
            provider.key_vaults = key_vaults;
        }
        if let Some(config_json) = input.config_json {
            let merged_config = merge_json_object(&provider.config_json, &config_json);
            if let Err(err) = validate_provider_config_json(&merged_config, false) {
                return UpdateResult::Invalid(err);
            }
            provider.config_json = merged_config;
        }
        UpdateResult::Updated(provider.to_json())
    }) {
        Ok(UpdateResult::Updated(provider)) => {
            if persist_provider_store(scope).is_err() {
                tracing::error!("Failed to persist provider store after update");
                return internal_error();
            }
            success_payload("provider_update", json!({ "provider": provider }))
        }
        Ok(UpdateResult::Invalid(err)) => AppResult::fail(ErrorCode::InvalidArgument, err, None),
        Ok(UpdateResult::NotFound) => {
            AppResult::fail(ErrorCode::NotFound, "Provider not found", None)
        }
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
    let config = match merged_config_value(&provider.config_json, input.config_json.as_deref()) {
        Ok(config) => config,
        Err(err) => {
            return success_payload("provider_check", json!({ "ok": false, "error": err }));
        }
    };
    let protocol = config_string(&config, "protocol");
    let protocol_key = remote::resolve_protocol_key(protocol.as_deref());
    let capabilities = provider_capabilities(protocol_key);
    let warnings = provider_guardrail_warnings(protocol_key, &config);
    if let Err(err) = validate_provider_config_value(&config, true) {
        return success_payload(
            "provider_check",
            json!({
                "ok": false,
                "error": err,
                "capabilities": capabilities,
                "warnings": warnings
            }),
        );
    }
    let base_url = if protocol_key == "cli-wrapped" {
        cli_command_from_config(&config)
    } else {
        config_string(&config, "base_url").unwrap_or_default()
    };
    let api_key = input
        .key_vaults
        .as_deref()
        .and_then(parse_key_vault_api_key)
        .or_else(|| parse_key_vault_api_key(&provider.key_vaults))
        .unwrap_or_default();
    if protocol_key != "cli-wrapped" && api_key.trim().is_empty() {
        return success_payload(
            "provider_check",
            json!({
                "ok": false,
                "error": "api_key is required",
                "capabilities": capabilities,
                "warnings": warnings
            }),
        );
    }
    if base_url.trim().is_empty() {
        return success_payload(
            "provider_check",
            json!({
                "ok": false,
                "error": if protocol_key == "cli-wrapped" { "CLI provider command is required" } else { "base_url is required" },
                "capabilities": capabilities,
                "warnings": warnings
            }),
        );
    }
    if protocol_key != "cli-wrapped"
        && !base_url.starts_with("http://")
        && !base_url.starts_with("https://")
    {
        return success_payload(
            "provider_check",
            json!({
                "ok": false,
                "error": "base_url must start with http:// or https://",
                "capabilities": capabilities,
                "warnings": warnings
            }),
        );
    }
    let model = config_string(&config, "model")
        .filter(|value| !value.trim().is_empty())
        .or_else(|| Some(provider.check_model.clone()))
        .unwrap_or_default();
    if model.trim().is_empty() {
        return success_payload(
            "provider_check",
            json!({
                "ok": false,
                "error": "model is required",
                "capabilities": capabilities,
                "warnings": warnings
            }),
        );
    }
    match remote::probe_provider(&base_url, &api_key, &model, protocol.as_deref()) {
        Ok(result) => success_payload(
            "provider_check",
            json!({
                "ok": true,
                "message": format!("provider {} reachable via {}", id, result.endpoint),
                "capabilities": capabilities,
                "warnings": warnings
            }),
        ),
        Err(err) => success_payload(
            "provider_check",
            json!({
                "ok": false,
                "error": err,
                "capabilities": capabilities,
                "warnings": warnings
            }),
        ),
    }
}

pub fn provider_create(scope: Option<&str>, input: ProviderCreateInput) -> AppResult<StubPayload> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    if let Err(err) = validate_provider_config_json(&input.config_json, false) {
        return AppResult::fail(ErrorCode::InvalidArgument, err, None);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{ProviderCheckInput, ProviderIdInput, ProviderUpdateInput};

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
    fn provider_update_should_reject_invalid_cli_timeout() {
        let result = provider_update(
            Some("test-provider-invalid-cli-timeout"),
            ProviderUpdateInput {
                id: "openai".to_string(),
                enabled: true,
                key_vaults: None,
                config_json: Some(
                    json!({
                        "protocol": "cli-wrapped",
                        "base_url": "codex exec",
                        "timeout_ms": 0
                    })
                    .to_string(),
                ),
            },
        );

        assert!(!result.ok);
        assert_eq!(
            result.error.expect("error").message,
            "CLI provider timeout_ms must be between 100 and 3600000 ms"
        );
    }

    #[test]
    fn provider_update_should_reject_invalid_cli_policy() {
        let result = provider_update(
            Some("test-provider-invalid-cli-policy"),
            ProviderUpdateInput {
                id: "openai".to_string(),
                enabled: true,
                key_vaults: None,
                config_json: Some(
                    json!({
                        "protocol": "cli-wrapped",
                        "base_url": "codex exec",
                        "sandbox_preset": "root",
                        "max_retries": 6
                    })
                    .to_string(),
                ),
            },
        );

        assert!(!result.ok);
        assert_eq!(
            result.error.expect("error").message,
            "CLI provider sandbox_preset must be workspace-readonly, workspace-write, network-off, or unrestricted"
        );
    }

    #[test]
    fn provider_check_should_report_cli_guardrail_error_with_capabilities() {
        let result = provider_check(
            None,
            ProviderCheckInput {
                id: "openai".to_string(),
                key_vaults: None,
                config_json: Some(
                    json!({
                        "protocol": "cli-wrapped",
                        "base_url": "codex exec",
                        "model": "test-model",
                        "cwd": "relative/path"
                    })
                    .to_string(),
                ),
            },
        );
        assert!(result.ok);
        let payload = result.data.expect("payload should exist");
        let status = parse_status(&payload);
        assert_eq!(status["ok"], false);
        assert_eq!(status["error"], "CLI provider cwd must be an absolute path");
        assert!(status["capabilities"]
            .as_array()
            .is_some_and(|items| { items.iter().any(|item| item["key"] == "trace_fidelity") }));
    }

    #[test]
    fn provider_check_should_return_cli_capability_matrix() {
        let cwd = std::env::temp_dir().to_string_lossy().to_string();
        let result = provider_check(
            None,
            ProviderCheckInput {
                id: "openai".to_string(),
                key_vaults: None,
                config_json: Some(
                    json!({
                        "protocol": "cli-wrapped",
                        "base_url": "codex exec",
                        "model": "test-model",
                        "timeout_ms": 1000,
                        "cwd": cwd,
                        "env": { "PEERS_TEST_KEY": "1" },
                        "sandbox_preset": "workspace-readonly",
                        "max_retries": 1,
                        "tool_allowlist": ["memory.write"]
                    })
                    .to_string(),
                ),
            },
        );
        assert!(result.ok);
        let payload = result.data.expect("payload should exist");
        let status = parse_status(&payload);
        assert_eq!(status["ok"], true);
        assert_eq!(
            status["capabilities"]
                .as_array()
                .and_then(|items| items.iter().find(|item| item["key"] == "streaming"))
                .and_then(|item| item["status"].as_str()),
            Some("unsupported")
        );
        assert!(status["warnings"]
            .as_array()
            .is_some_and(|items| { items.iter().any(|item| item["code"] == "cli_black_box") }));
        assert!(!status["warnings"]
            .as_array()
            .is_some_and(|items| { items.iter().any(|item| item["code"] == "sandbox_default") }));
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
