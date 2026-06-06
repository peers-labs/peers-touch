use crate::application::provider::{remote as provider_remote, state as provider_state};
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};

use super::value_string;

mod cli_wrapped;
mod http_llm;
mod registry;
mod types;

use types::{ProviderControl, ProviderKind, ProviderRequest};
pub(crate) use types::{ProviderResponse as RuntimeCompletion, ResolvedProvider};

#[derive(Debug)]
struct ProviderExecutionConfig {
    kind: ProviderKind,
    endpoint: String,
    api_key: String,
    protocol: &'static str,
    control: ProviderControl,
}

fn parse_json_object(raw: &str) -> serde_json::Value {
    serde_json::from_str(raw).unwrap_or_else(|_| serde_json::json!({}))
}

fn parse_api_key(raw: &str) -> String {
    parse_json_object(raw)
        .get("api_key")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn first_value_string(value: &serde_json::Value, keys: &[&str]) -> String {
    keys.iter()
        .map(|key| value_string(value, key))
        .find(|item| !item.is_empty())
        .unwrap_or_default()
}

fn kind_for_protocol(protocol: &str) -> ProviderKind {
    if protocol == "cli-wrapped" {
        ProviderKind::CliWrapped
    } else {
        ProviderKind::HttpLlm
    }
}

fn parse_provider_control(config: &serde_json::Value) -> ProviderControl {
    let timeout_ms = config.get("timeout_ms").and_then(serde_json::Value::as_u64);
    let cwd = value_string(config, "cwd");
    let env = config
        .get("env")
        .and_then(serde_json::Value::as_object)
        .map(|items| {
            items
                .iter()
                .filter_map(|(key, value)| {
                    value
                        .as_str()
                        .map(|item| (key.trim().to_string(), item.trim().to_string()))
                })
                .filter(|(key, _)| !key.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    ProviderControl {
        timeout_ms,
        cwd: if cwd.is_empty() { None } else { Some(cwd) },
        env,
    }
}

fn resolve_execution_config(
    config_json: &str,
    key_vaults: &str,
    model_protocol: Option<&str>,
) -> Result<ProviderExecutionConfig, AppResult<StubPayload>> {
    let config = parse_json_object(config_json);
    let api_key = parse_api_key(key_vaults);
    let provider_protocol = value_string(&config, "protocol");
    let protocol =
        provider_remote::resolve_model_protocol(model_protocol, Some(provider_protocol.as_str()));
    let kind = kind_for_protocol(protocol);
    let endpoint = if kind == ProviderKind::CliWrapped {
        first_value_string(&config, &["cli_command", "command", "base_url"])
    } else {
        value_string(&config, "base_url")
    };
    if endpoint.is_empty() {
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            if kind == ProviderKind::CliWrapped {
                "CLI provider command is required"
            } else {
                "Provider base URL is required"
            },
            None,
        ));
    }

    Ok(ProviderExecutionConfig {
        kind,
        endpoint,
        api_key,
        protocol,
        control: parse_provider_control(&config),
    })
}

fn resolve_provider_record(
    provider_hint: Option<&str>,
    model_hint: Option<&str>,
) -> Result<(provider_state::ProviderRecord, String), AppResult<StubPayload>> {
    let provider_hint = provider_hint.unwrap_or("").trim();
    let model_hint = model_hint.unwrap_or("").trim();
    let provider = provider_state::with_provider_store(None, |store| {
        if !provider_hint.is_empty() {
            return store
                .providers
                .iter()
                .find(|provider| provider.id == provider_hint)
                .cloned();
        }
        if !model_hint.is_empty() {
            return store
                .providers
                .iter()
                .find(|provider| {
                    provider.enabled
                        && (provider.check_model == model_hint
                            || provider.models.iter().any(|model| model.id == model_hint))
                })
                .cloned();
        }
        store
            .providers
            .iter()
            .find(|provider| provider.enabled)
            .cloned()
    })
    .ok()
    .flatten()
    .ok_or_else(|| AppResult::fail(ErrorCode::NotFound, "Provider not found", None))?;

    if !provider.enabled {
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            "Provider is disabled",
            None,
        ));
    }
    let model = if model_hint.is_empty() {
        provider
            .models
            .iter()
            .find(|model| model.enabled)
            .map(|model| model.id.clone())
            .unwrap_or_else(|| provider.check_model.clone())
    } else {
        model_hint.to_string()
    };
    if model.trim().is_empty() {
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            "Model is required",
            None,
        ));
    }
    Ok((provider, model))
}

pub(crate) fn resolve_provider(
    provider_hint: Option<&str>,
    model_hint: Option<&str>,
) -> Result<ResolvedProvider, AppResult<StubPayload>> {
    let (provider, model_id) = resolve_provider_record(provider_hint, model_hint)?;
    let model_record = provider.models.iter().find(|model| model.id == model_id);
    let execution_config = resolve_execution_config(
        &provider.config_json,
        &provider.key_vaults,
        model_record.and_then(|model| model.protocol_override.as_deref()),
    )?;
    let adapter = registry::adapter_for(execution_config.kind)?;

    Ok(ResolvedProvider {
        provider_id: provider.id,
        kind: execution_config.kind,
        endpoint: execution_config.endpoint,
        api_key: execution_config.api_key,
        model_id,
        protocol: execution_config.protocol,
        capability: adapter.capability(),
        control: execution_config.control,
    })
}

pub(crate) fn complete(
    provider: &ResolvedProvider,
    prompt: &str,
) -> Result<RuntimeCompletion, AppResult<StubPayload>> {
    let adapter = registry::adapter_for(provider.kind)?;
    adapter.complete(ProviderRequest { provider, prompt })
}

#[cfg(test)]
mod tests {
    use super::*;
    use types::ProviderCapability;

    #[test]
    fn resolve_execution_config_should_use_http_base_url() {
        let config = resolve_execution_config(
            r#"{"protocol":"openai-compatible","base_url":"https://llm.example/v1"}"#,
            r#"{"api_key":"test-key"}"#,
            None,
        )
        .expect("config should resolve");

        assert_eq!(config.kind, ProviderKind::HttpLlm);
        assert_eq!(config.endpoint, "https://llm.example/v1");
        assert_eq!(config.api_key, "test-key");
        assert_eq!(config.protocol, "openai-compatible");
    }

    #[test]
    fn resolve_execution_config_should_prefer_cli_command_for_cli_provider() {
        let config = resolve_execution_config(
            r#"{"protocol":"cli","base_url":"fallback","cli_command":"codex exec"}"#,
            "{}",
            None,
        )
        .expect("cli config should resolve");

        assert_eq!(config.kind, ProviderKind::CliWrapped);
        assert_eq!(config.endpoint, "codex exec");
        assert_eq!(config.protocol, "cli-wrapped");
    }

    #[test]
    fn resolve_execution_config_should_report_missing_endpoint_by_protocol() {
        let http_error = resolve_execution_config(r#"{"protocol":"openai"}"#, "{}", None)
            .expect_err("http provider should require base_url");
        assert_eq!(
            http_error.error.expect("error").message,
            "Provider base URL is required"
        );

        let cli_error = resolve_execution_config(r#"{"protocol":"cli"}"#, "{}", None)
            .expect_err("cli provider should require command");
        assert_eq!(
            cli_error.error.expect("error").message,
            "CLI provider command is required"
        );
    }

    #[test]
    fn resolve_execution_config_should_capture_control_options() {
        let config = resolve_execution_config(
            r#"{
                "protocol":"cli",
                "cli_command":"codex exec",
                "timeout_ms":3000,
                "cwd":"/tmp/work",
                "env":{"A":"1","B":" 2 "}
            }"#,
            "{}",
            None,
        )
        .expect("config should resolve");

        assert_eq!(config.control.timeout_ms, Some(3000));
        assert_eq!(config.control.cwd.as_deref(), Some("/tmp/work"));
        assert_eq!(
            config.control.env,
            vec![
                ("A".to_string(), "1".to_string()),
                ("B".to_string(), "2".to_string())
            ]
        );
    }

    #[test]
    fn http_capability_should_not_mark_black_box() {
        let adapter = registry::adapter_for(ProviderKind::HttpLlm).expect("adapter");

        assert_eq!(
            adapter.capability(),
            ProviderCapability {
                stream: false,
                cancel: false,
                tool_call: false,
                black_box: false,
            }
        );
    }

    #[test]
    fn cli_capability_should_mark_black_box() {
        let adapter = registry::adapter_for(ProviderKind::CliWrapped).expect("adapter");

        assert_eq!(
            adapter.capability(),
            ProviderCapability {
                stream: false,
                cancel: false,
                tool_call: false,
                black_box: true,
            }
        );
    }

    #[test]
    fn native_provider_should_not_have_adapter_yet() {
        let error = match registry::adapter_for(ProviderKind::Native) {
            Ok(_) => panic!("native adapter is not ready"),
            Err(error) => error,
        };

        assert_eq!(
            error.error.expect("error").message,
            "Native provider is not available yet"
        );
    }
}
