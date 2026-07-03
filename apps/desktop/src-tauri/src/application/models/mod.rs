use crate::application::provider::{remote as provider_remote, state as provider_state};
use crate::contracts::{
    ProviderModelAddInput, ProviderModelDeleteInput, ProviderModelFetchInput,
    ProviderModelToggleAllInput, ProviderModelToggleInput, ProviderModelUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use provider_state::{persist_provider_store, with_provider_store, ModelRecord};
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

fn internal_error() -> AppResult<StubPayload> {
    tracing::error!("Failed to acquire provider store lock");
    AppResult::fail(
        ErrorCode::InternalError,
        "Failed to access provider store",
        None,
    )
}

fn get_json_string_field(data: &serde_json::Value, key: &str) -> Option<String> {
    data.get(key)
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string)
}

fn get_json_bool_field(data: &serde_json::Value, key: &str, default: bool) -> bool {
    data.get(key)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(default)
}

fn get_json_u32_field(data: &serde_json::Value, key: &str, default: u32) -> u32 {
    data.get(key)
        .and_then(serde_json::Value::as_u64)
        .map(|v| v as u32)
        .unwrap_or(default)
}

fn normalized_model_type(raw: Option<String>) -> String {
    raw.map(|v| v.trim().to_lowercase())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "chat".to_string())
}

fn parse_model_from_data(data: &serde_json::Value) -> Result<ModelRecord, &'static str> {
    let id = get_json_string_field(data, "id")
        .unwrap_or_default()
        .trim()
        .to_string();
    if id.is_empty() {
        return Err("model id is required");
    }
    let display_name = get_json_string_field(data, "display_name")
        .unwrap_or_else(|| id.clone())
        .trim()
        .to_string();
    Ok(ModelRecord {
        id,
        display_name: if display_name.is_empty() {
            get_json_string_field(data, "id").unwrap_or_default()
        } else {
            display_name
        },
        r#type: normalized_model_type(get_json_string_field(data, "type")),
        enabled: get_json_bool_field(data, "enabled", true),
        context_window: get_json_u32_field(data, "context_window", 0),
        function_call: get_json_bool_field(data, "function_call", false),
        vision: get_json_bool_field(data, "vision", false),
        reasoning: get_json_bool_field(data, "reasoning", false),
        search: get_json_bool_field(data, "search", false),
        image_output: get_json_bool_field(data, "image_output", false),
        video: get_json_bool_field(data, "video", false),
        protocol_override: get_json_string_field(data, "protocol_override")
            .filter(|v| !v.trim().is_empty()),
    })
}

fn apply_model_update(model: &mut ModelRecord, data: &serde_json::Value) {
    if let Some(display_name) = get_json_string_field(data, "display_name") {
        let value = display_name.trim();
        model.display_name = if value.is_empty() {
            model.id.clone()
        } else {
            value.to_string()
        };
    }
    if let Some(model_type) = get_json_string_field(data, "type") {
        model.r#type = normalized_model_type(Some(model_type));
    }
    if data.get("enabled").is_some() {
        model.enabled = get_json_bool_field(data, "enabled", model.enabled);
    }
    if data.get("context_window").is_some() {
        model.context_window = get_json_u32_field(data, "context_window", model.context_window);
    }
    if data.get("function_call").is_some() {
        model.function_call = get_json_bool_field(data, "function_call", model.function_call);
    }
    if data.get("vision").is_some() {
        model.vision = get_json_bool_field(data, "vision", model.vision);
    }
    if data.get("reasoning").is_some() {
        model.reasoning = get_json_bool_field(data, "reasoning", model.reasoning);
    }
    if data.get("search").is_some() {
        model.search = get_json_bool_field(data, "search", model.search);
    }
    if data.get("image_output").is_some() {
        model.image_output = get_json_bool_field(data, "image_output", model.image_output);
    }
    if data.get("video").is_some() {
        model.video = get_json_bool_field(data, "video", model.video);
    }
    if data.get("protocol_override").is_some() {
        model.protocol_override =
            get_json_string_field(data, "protocol_override").filter(|v| !v.trim().is_empty());
    }
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

/// The seeded model ids of a provider, used as a fallback when a CLI provider
/// cannot enumerate its models dynamically.
fn cli_preset_model_ids(provider: &provider_state::ProviderRecord) -> Vec<String> {
    provider
        .models
        .iter()
        .map(|model| model.id.clone())
        .collect()
}

/// Splits a whitespace-separated CLI command line into program + arguments.
/// Model-listing commands are simple invocations (e.g. `cursor-agent --list-models`)
/// and do not require shell quoting.
fn split_models_command(command_line: &str) -> Vec<String> {
    command_line
        .split_whitespace()
        .map(ToString::to_string)
        .collect()
}

/// Executes a CLI provider's model-listing command and parses model ids from its
/// stdout. Supports both a JSON catalog (e.g. TRAE `debug models`) and a plain
/// line-based listing (e.g. Cursor `--list-models`).
fn run_cli_models_command(command_line: &str) -> Result<Vec<String>, String> {
    let parts = split_models_command(command_line);
    let Some((program, args)) = parts.split_first() else {
        return Err("models command is empty".to_string());
    };
    let output = std::process::Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|error| format!("failed to run models command: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let code = output
            .status
            .code()
            .map(|value| value.to_string())
            .unwrap_or_else(|| "signal".to_string());
        return Err(format!(
            "models command exited with status {code}: {stderr}"
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_cli_models_output(&stdout))
}

/// Parses model ids out of a CLI model-listing command's stdout.
///
/// TRAE emits a JSON object `{ "models": [{ "slug": "..." }, ...] }`, while Cursor
/// emits plain `id - Display Name` lines. JSON is preferred when the output parses
/// cleanly; otherwise each line's leading identifier token is used.
fn parse_cli_models_output(stdout: &str) -> Vec<String> {
    let mut models = Vec::new();
    let mut push = |id: &str| {
        let id = id.trim();
        if !id.is_empty() && !models.iter().any(|existing| existing == id) {
            models.push(id.to_string());
        }
    };

    if let Some(entries) = parse_json_model_catalog(stdout) {
        for id in entries {
            push(&id);
        }
        return models;
    }

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Take the leading token before an optional " - Display Name" suffix.
        let id = line
            .split_once(" - ")
            .map(|(id, _)| id)
            .unwrap_or(line)
            .trim();
        // Skip header/separator lines that are not valid model identifiers.
        if id.is_empty() || id.contains(char::is_whitespace) || id.contains(':') {
            continue;
        }
        push(id);
    }
    models
}

/// Extracts model identifiers from a JSON model catalog. Returns `None` when the
/// output is not JSON or does not contain a recognizable model array.
fn parse_json_model_catalog(stdout: &str) -> Option<Vec<String>> {
    let value = serde_json::from_str::<serde_json::Value>(stdout.trim()).ok()?;
    let array = value
        .get("models")
        .or_else(|| value.get("data"))
        .and_then(serde_json::Value::as_array)
        .or_else(|| value.as_array())?;
    let ids = array
        .iter()
        .filter_map(|entry| {
            entry
                .get("slug")
                .or_else(|| entry.get("id"))
                .or_else(|| entry.get("name"))
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string)
        })
        .collect::<Vec<_>>();
    if ids.is_empty() {
        None
    } else {
        Some(ids)
    }
}

pub fn model_add(scope: Option<&str>, input: ProviderModelAddInput) -> AppResult<StubPayload> {
    let provider_id = input.provider_id.trim();
    if provider_id.is_empty() {
        return invalid_argument("provider_id is required");
    }
    let model = match parse_model_from_data(&input.data) {
        Ok(model) => model,
        Err(message) => return invalid_argument(message),
    };
    match with_provider_store(scope, |store| {
        let Some(provider) = store
            .providers
            .iter_mut()
            .find(|provider| provider.id == provider_id)
        else {
            return Err(ErrorCode::NotFound);
        };
        if provider.models.iter().any(|item| item.id == model.id) {
            return Err(ErrorCode::Conflict);
        }
        if provider.check_model.trim().is_empty() {
            provider.check_model = model.id.clone();
        }
        let model_id = model.id.clone();
        provider.models.push(model);
        Ok(model_id)
    }) {
        Ok(Ok(model_id)) => {
            if persist_provider_store(scope).is_err() {
                tracing::error!("Failed to persist provider store after model add");
                return internal_error();
            }
            success_payload("model_add", json!({ "ok": true, "model_id": model_id }))
        }
        Ok(Err(ErrorCode::Conflict)) => {
            AppResult::fail(ErrorCode::Conflict, "Model already exists", None)
        }
        Ok(Err(_)) => AppResult::fail(ErrorCode::NotFound, "Provider not found", None),
        Err(_) => internal_error(),
    }
}

pub fn model_update(
    scope: Option<&str>,
    input: ProviderModelUpdateInput,
) -> AppResult<StubPayload> {
    let provider_id = input.provider_id.trim();
    let model_id = input.model_id.trim();
    if provider_id.is_empty() || model_id.is_empty() {
        return invalid_argument("provider_id and model_id are required");
    }
    match with_provider_store(scope, |store| {
        let Some(provider) = store
            .providers
            .iter_mut()
            .find(|provider| provider.id == provider_id)
        else {
            return Err("provider");
        };
        let Some(model) = provider
            .models
            .iter_mut()
            .find(|model| model.id == model_id)
        else {
            return Err("model");
        };
        apply_model_update(model, &input.data);
        Ok(())
    }) {
        Ok(Ok(())) => {
            if persist_provider_store(scope).is_err() {
                tracing::error!("Failed to persist provider store after model update");
                return internal_error();
            }
            success_payload("model_update", json!({ "ok": true }))
        }
        Ok(Err("model")) => AppResult::fail(ErrorCode::NotFound, "Model not found", None),
        Ok(Err(_)) => AppResult::fail(ErrorCode::NotFound, "Provider not found", None),
        Err(_) => internal_error(),
    }
}

pub fn model_delete(
    scope: Option<&str>,
    input: ProviderModelDeleteInput,
) -> AppResult<StubPayload> {
    let provider_id = input.provider_id.trim();
    let model_id = input.model_id.trim();
    if provider_id.is_empty() || model_id.is_empty() {
        return invalid_argument("provider_id and model_id are required");
    }
    match with_provider_store(scope, |store| {
        let Some(provider) = store
            .providers
            .iter_mut()
            .find(|provider| provider.id == provider_id)
        else {
            return Err("provider");
        };
        let before = provider.models.len();
        provider.models.retain(|model| model.id != model_id);
        if before == provider.models.len() {
            return Err("model");
        }
        if provider.check_model == model_id {
            provider.check_model = provider
                .models
                .first()
                .map(|model| model.id.clone())
                .unwrap_or_default();
        }
        Ok(())
    }) {
        Ok(Ok(())) => {
            if persist_provider_store(scope).is_err() {
                tracing::error!("Failed to persist provider store after model delete");
                return internal_error();
            }
            success_payload("model_delete", json!({ "ok": true }))
        }
        Ok(Err("model")) => AppResult::fail(ErrorCode::NotFound, "Model not found", None),
        Ok(Err(_)) => AppResult::fail(ErrorCode::NotFound, "Provider not found", None),
        Err(_) => internal_error(),
    }
}

pub fn model_fetch_remote(
    scope: Option<&str>,
    input: ProviderModelFetchInput,
) -> AppResult<StubPayload> {
    let provider_id = input.provider_id.trim();
    if provider_id.is_empty() {
        return invalid_argument("provider_id is required");
    }
    let provider = match with_provider_store(scope, |store| {
        store
            .providers
            .iter()
            .find(|provider| provider.id == provider_id)
            .cloned()
    }) {
        Ok(provider) => provider,
        Err(_) => return internal_error(),
    };
    let Some(provider) = provider else {
        return AppResult::fail(ErrorCode::NotFound, "Provider not found", None);
    };
    let input_api_key = input
        .data
        .as_ref()
        .and_then(|v| v.get("api_key"))
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_default();
    let api_key = if input_api_key.trim().is_empty() {
        parse_key_vault_api_key(&provider.key_vaults).unwrap_or_default()
    } else {
        input_api_key
    };
    let input_base_url = input
        .data
        .as_ref()
        .and_then(|v| v.get("base_url"))
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_default();
    let base_url = if input_base_url.trim().is_empty() {
        parse_config_field(&provider.config_json, "base_url").unwrap_or_default()
    } else {
        input_base_url
    };
    let protocol = parse_config_field(&provider.config_json, "protocol");
    // CLI runtime providers do not expose an HTTP endpoint. Route them through the
    // provider's own model-listing command when available, otherwise fall back to
    // the statically seeded model presets so the UI never shows "base_url is required".
    if parse_config_field(&provider.config_json, "runtime_kind").as_deref() == Some("cli") {
        let models_command = parse_config_field(&provider.config_json, "models_command")
            .filter(|value| !value.trim().is_empty());
        if let Some(command_line) = models_command {
            return match run_cli_models_command(&command_line) {
                Ok(models) if !models.is_empty() => success_payload(
                    "model_fetch_remote",
                    json!({ "ok": true, "models": models }),
                ),
                Ok(_) => success_payload(
                    "model_fetch_remote",
                    json!({ "ok": true, "models": cli_preset_model_ids(&provider) }),
                ),
                Err(err) => success_payload(
                    "model_fetch_remote",
                    json!({ "ok": false, "error": err, "models": [] }),
                ),
            };
        }
        return success_payload(
            "model_fetch_remote",
            json!({ "ok": true, "models": cli_preset_model_ids(&provider) }),
        );
    }
    if base_url.trim().is_empty() {
        return success_payload(
            "model_fetch_remote",
            json!({ "ok": false, "error": "base_url is required", "models": [] }),
        );
    }
    match provider_remote::fetch_models(&base_url, &api_key, protocol.as_deref()) {
        Ok(models) => success_payload(
            "model_fetch_remote",
            json!({ "ok": true, "models": models }),
        ),
        Err(err) => success_payload(
            "model_fetch_remote",
            json!({ "ok": false, "error": err, "models": [] }),
        ),
    }
}

pub fn model_toggle(
    scope: Option<&str>,
    input: ProviderModelToggleInput,
) -> AppResult<StubPayload> {
    let provider_id = input.provider_id.trim();
    let model_id = input.model_id.trim();
    if provider_id.is_empty() || model_id.is_empty() {
        return invalid_argument("provider_id and model_id are required");
    }
    match with_provider_store(scope, |store| {
        let Some(provider) = store
            .providers
            .iter_mut()
            .find(|provider| provider.id == provider_id)
        else {
            return Err("provider");
        };
        let Some(model) = provider
            .models
            .iter_mut()
            .find(|model| model.id == model_id)
        else {
            return Err("model");
        };
        model.enabled = input.enabled;
        Ok(())
    }) {
        Ok(Ok(())) => {
            if persist_provider_store(scope).is_err() {
                tracing::error!("Failed to persist provider store after model toggle");
                return internal_error();
            }
            success_payload("model_toggle", json!({ "ok": true }))
        }
        Ok(Err("model")) => AppResult::fail(ErrorCode::NotFound, "Model not found", None),
        Ok(Err(_)) => AppResult::fail(ErrorCode::NotFound, "Provider not found", None),
        Err(_) => internal_error(),
    }
}

pub fn model_toggle_all(
    scope: Option<&str>,
    input: ProviderModelToggleAllInput,
) -> AppResult<StubPayload> {
    let provider_id = input.provider_id.trim();
    if provider_id.is_empty() {
        return invalid_argument("provider_id is required");
    }
    match with_provider_store(scope, |store| {
        let Some(provider) = store
            .providers
            .iter_mut()
            .find(|provider| provider.id == provider_id)
        else {
            return Err(());
        };
        provider
            .models
            .iter_mut()
            .for_each(|model| model.enabled = input.enabled);
        Ok(())
    }) {
        Ok(Ok(())) => {
            if persist_provider_store(scope).is_err() {
                tracing::error!("Failed to persist provider store after model toggle all");
                return internal_error();
            }
            success_payload("model_toggle_all", json!({ "ok": true }))
        }
        Ok(Err(())) => AppResult::fail(ErrorCode::NotFound, "Provider not found", None),
        Err(_) => internal_error(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{
        ProviderModelAddInput, ProviderModelDeleteInput, ProviderModelFetchInput,
        ProviderModelToggleInput,
    };
    use provider_state::ProviderRecord;
    use serde_json::json;

    const TEST_SCOPE: Option<&str> = Some("__test_models_app__");

    fn ensure_provider(provider_id: &str) {
        let exists = with_provider_store(TEST_SCOPE, |store| {
            store.providers.iter().any(|item| item.id == provider_id)
        })
        .expect("store lock should work");
        if exists {
            return;
        }
        with_provider_store(TEST_SCOPE, |store| {
            store.providers.push(ProviderRecord {
                id: provider_id.to_string(),
                name: "Test Provider".to_string(),
                description: "".to_string(),
                logo: "".to_string(),
                enabled: true,
                key_vaults: "{\"api_key\":\"test-key\"}".to_string(),
                config_json: "{\"base_url\":\"https://api.openai.com/v1\",\"protocol\":\"openai-compatible\"}".to_string(),
                check_model: "".to_string(),
                models: vec![],
                builtin: false,
                show_checker: true,
                show_api_key: true,
            });
        })
        .expect("store lock should work");
    }

    fn parse_status(payload: &StubPayload) -> serde_json::Value {
        serde_json::from_str(&payload.status).expect("status should be valid json")
    }

    #[test]
    fn model_add_toggle_delete_should_update_shared_provider_state() {
        let provider_id = "provider-test-model-lifecycle";
        ensure_provider(provider_id);
        let add_result = model_add(
            TEST_SCOPE,
            ProviderModelAddInput {
                provider_id: provider_id.to_string(),
                data: json!({
                    "id": "m-test-1",
                    "display_name": "m-test-1",
                    "type": "chat",
                    "enabled": true
                }),
            },
        );
        assert!(add_result.ok);
        let toggle_result = model_toggle(
            TEST_SCOPE,
            ProviderModelToggleInput {
                provider_id: provider_id.to_string(),
                model_id: "m-test-1".to_string(),
                enabled: false,
            },
        );
        assert!(toggle_result.ok);
        {
            let enabled = with_provider_store(TEST_SCOPE, |store| {
                store
                    .providers
                    .iter()
                    .find(|item| item.id == provider_id)
                    .and_then(|provider| provider.models.iter().find(|item| item.id == "m-test-1"))
                    .map(|model| model.enabled)
                    .unwrap_or(true)
            })
            .expect("store lock should work");
            assert!(!enabled);
        }
        let delete_result = model_delete(
            TEST_SCOPE,
            ProviderModelDeleteInput {
                provider_id: provider_id.to_string(),
                model_id: "m-test-1".to_string(),
            },
        );
        assert!(delete_result.ok);
        {
            let exists = with_provider_store(TEST_SCOPE, |store| {
                store
                    .providers
                    .iter()
                    .find(|item| item.id == provider_id)
                    .map(|provider| provider.models.iter().any(|item| item.id == "m-test-1"))
                    .unwrap_or(false)
            })
            .expect("store lock should work");
            assert!(!exists);
        }
    }

    #[test]
    fn model_fetch_remote_should_fail_when_base_url_missing() {
        let provider_id = "provider-test-fetch";
        ensure_provider(provider_id);
        {
            with_provider_store(TEST_SCOPE, |store| {
                let provider = store
                    .providers
                    .iter_mut()
                    .find(|item| item.id == provider_id)
                    .expect("provider should exist");
                provider.config_json = "{}".to_string();
            })
            .expect("store lock should work");
        }
        let result = model_fetch_remote(
            TEST_SCOPE,
            ProviderModelFetchInput {
                provider_id: provider_id.to_string(),
                data: None,
            },
        );
        assert!(result.ok);
        let payload = result.data.expect("payload should exist");
        let status = parse_status(&payload);
        assert_eq!(status["ok"], false);
        assert_eq!(status["error"], "base_url is required");
    }

    #[test]
    fn parse_cli_models_output_should_read_trae_json_catalog() {
        let stdout = r#"{"models":[
            {"slug":"GPT-5.5","config_name":"gpt","model_provider_id":"trae"},
            {"slug":"Gemini-3.1-Pro-Preview","config_name":"gemini"},
            {"slug":"DeepSeek-V4-Pro"}
        ]}"#;
        let models = parse_cli_models_output(stdout);
        assert_eq!(
            models,
            vec![
                "GPT-5.5".to_string(),
                "Gemini-3.1-Pro-Preview".to_string(),
                "DeepSeek-V4-Pro".to_string(),
            ]
        );
    }

    #[test]
    fn parse_cli_models_output_should_read_cursor_line_listing() {
        let stdout = "auto - Auto\ngpt-5 - GPT 5\nclaude-4-sonnet - Claude 4 Sonnet\n";
        let models = parse_cli_models_output(stdout);
        assert_eq!(
            models,
            vec![
                "auto".to_string(),
                "gpt-5".to_string(),
                "claude-4-sonnet".to_string(),
            ]
        );
    }

    #[test]
    fn parse_cli_models_output_should_dedupe_ids() {
        let stdout = "{\"models\":[{\"slug\":\"a\"},{\"slug\":\"a\"},{\"slug\":\"b\"}]}";
        let models = parse_cli_models_output(stdout);
        assert_eq!(models, vec!["a".to_string(), "b".to_string()]);
    }

    /// End-to-end check against a locally installed TRAE CLI. Ignored by default
    /// because it depends on the `traecli` binary being present on the host.
    /// Run with: `cargo test --lib run_cli_models_command_should_enumerate_trae_models -- --ignored`
    #[test]
    #[ignore]
    fn run_cli_models_command_should_enumerate_trae_models() {
        let models =
            run_cli_models_command("traecli debug models").expect("traecli should list models");
        assert!(
            !models.is_empty(),
            "expected at least one model from traecli"
        );
        assert!(
            models.iter().all(|id| !id.trim().is_empty()),
            "model ids must not be blank"
        );
    }

    /// End-to-end check against a locally installed Cursor CLI. Ignored by default
    /// because it depends on the `cursor-agent` binary being present on the host.
    /// Run with: `cargo test --lib run_cli_models_command_should_enumerate_cursor_models -- --ignored`
    #[test]
    #[ignore]
    fn run_cli_models_command_should_enumerate_cursor_models() {
        let models = run_cli_models_command("cursor-agent --list-models")
            .expect("cursor-agent should list models");
        assert!(
            !models.is_empty(),
            "expected at least one model from cursor-agent"
        );
        assert!(
            models
                .iter()
                .all(|id| !id.trim().is_empty() && !id.contains(char::is_whitespace)),
            "model ids must be blank-free single tokens"
        );
    }
}
