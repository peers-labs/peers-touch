use crate::contracts::{
    ProviderCheckInput, ProviderCreateInput, ProviderIdInput, ProviderUpdateInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;

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

    let mut result = resp.clone();
    if let Some(provider) = result.get_mut("provider") {
        let is_configured = provider
            .get("credential_status")
            .and_then(|v| v.as_str())
            .unwrap_or("not_configured")
            == "configured";
        provider["has_api_key"] = json!(is_configured);

        if is_configured {
            if let Ok(cred) = station_api::resolve_credential(token, id) {
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
    _scope: &str,
    token: &str,
    input: ProviderUpdateInput,
) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }

    if let Some(api_key) = input
        .key_vaults
        .as_deref()
        .and_then(parse_key_vault_api_key)
    {
        if !api_key.is_empty() {
            let _ = station_api::set_credential(token, id, &api_key);
        }
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

    let provider =
        match station_api::create_provider(token, &provider_id, name, &base_url, &protocol, None) {
            Ok(p) => p,
            Err(e) => return station_error_to_result(e),
        };

    if let Some(api_key) = parse_key_vault_api_key(&input.key_vaults) {
        let _ = station_api::set_credential(token, &provider.id, &api_key);
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

pub fn provider_delete(scope: &str, token: &str, input: ProviderIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return AppResult::fail(ErrorCode::InvalidArgument, "id is required", None);
    }

    let version = match station_api::get_providers(token, scope) {
        Ok(providers) => match providers.into_iter().find(|provider| provider.id == id) {
            Some(provider) => provider.version,
            None => {
                return AppResult::fail(
                    ErrorCode::NotFound,
                    &format!("provider not found: {id}"),
                    None,
                )
            }
        },
        Err(e) => return station_error_to_result(e),
    };

    if let Err(e) = station_api::delete_provider(token, id, version) {
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

pub fn model_fetch_remote(scope: &str, token: &str, provider_id: &str) -> AppResult<StubPayload> {
    let resp = match station_api::get_provider(token, provider_id) {
        Ok(v) => v,
        Err(_) => {
            return success_payload("model_fetch_remote", json!({ "ok": true, "models": [] }))
        }
    };

    let provider = resp.get("provider").cloned().unwrap_or(json!({}));
    let runtime_kind = provider
        .get("runtime_kind")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let models_command = provider
        .get("models_command")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    if runtime_kind == "cli" && !models_command.is_empty() {
        let models = execute_cli_models_command(models_command, scope, provider_id);
        if models.is_empty() {
            return success_payload(
                "model_fetch_remote",
                json!({
                    "ok": false,
                    "models": [],
                    "error": format!("CLI command returned no models: {}", models_command)
                }),
            );
        }
        return success_payload(
            "model_fetch_remote",
            json!({ "ok": true, "models": models }),
        );
    }

    let models = provider.get("models").cloned().unwrap_or(json!([]));
    success_payload(
        "model_fetch_remote",
        json!({ "ok": true, "models": models }),
    )
}

fn execute_cli_models_command(command: &str, actor_ptid: &str, provider_id: &str) -> Vec<String> {
    let cred_key = credential_env_key_for_provider(provider_id);
    let env = build_cli_env(actor_ptid, provider_id, "", cred_key);
    let workspace = ensure_actor_workspace(actor_ptid, provider_id);
    let output = run_cli_subprocess(command, &env, &workspace, None);
    match output {
        Some(stdout) => parse_cli_model_list(&stdout),
        None => vec![],
    }
}

fn credential_env_key_for_provider(provider_id: &str) -> Option<&'static str> {
    match provider_id {
        "codex-cli" => Some("OPENAI_API_KEY"),
        "claude-cli" => Some("ANTHROPIC_API_KEY"),
        _ => None,
    }
}

// --- WS-2: Actor Workspace ---

fn ensure_actor_workspace(actor_ptid: &str, provider_id: &str) -> PathBuf {
    let base = app_data_dir();
    let workspace = base
        .join("actors")
        .join(actor_ptid)
        .join("cli")
        .join(provider_id)
        .join("workspace");
    if !workspace.exists() {
        let _ = std::fs::create_dir_all(&workspace);
    }
    workspace
}

fn app_data_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(".peers-touch")
}

// --- WS-3: CLI Env Injection ---

fn build_cli_env(
    actor_ptid: &str,
    provider_id: &str,
    token: &str,
    credential_env_key: Option<&str>,
) -> HashMap<String, String> {
    let workspace = ensure_actor_workspace(actor_ptid, provider_id);
    let station_url = std::env::var("PEERS_STATION_URL").unwrap_or_default();

    let mut env = HashMap::new();
    env.insert("PATH".to_string(), enriched_path());
    env.insert("PEERS_ACTOR_PTID".to_string(), actor_ptid.to_string());
    env.insert("PEERS_PROVIDER_ID".to_string(), provider_id.to_string());
    env.insert(
        "PEERS_WORKSPACE".to_string(),
        workspace.to_string_lossy().to_string(),
    );
    if !station_url.is_empty() {
        env.insert("PEERS_STATION_URL".to_string(), station_url);
    }
    if !token.is_empty() {
        env.insert("PEERS_AUTH_TOKEN".to_string(), token.to_string());
    }

    // WS-4: Credential injection
    if let Some(env_key) = credential_env_key {
        if !env_key.is_empty() && !token.is_empty() {
            if let Ok(cred) = station_api::resolve_credential(token, provider_id) {
                if !cred.api_key.is_empty() {
                    env.insert(env_key.to_string(), cred.api_key);
                }
            }
        }
    }

    env
}

fn run_cli_subprocess(
    command: &str,
    env: &HashMap<String, String>,
    cwd: &PathBuf,
    stdin_input: Option<&str>,
) -> Option<String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return None;
    }

    let mut cmd = Command::new(parts[0]);
    cmd.args(&parts[1..])
        .current_dir(cwd)
        .envs(env)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if stdin_input.is_some() {
        cmd.stdin(Stdio::piped());
    }

    let mut child = cmd.spawn().ok()?;

    if let Some(input) = stdin_input {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(input.as_bytes());
        }
    }

    let output = child.wait_with_output().ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        None
    }
}

// --- WS-5: Output Format Normalization ---

fn parse_cli_model_list(stdout: &str) -> Vec<String> {
    let trimmed = stdout.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        parse_json_models(trimmed)
    } else {
        trimmed
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect()
    }
}

#[derive(Debug)]
pub struct CLIResponse {
    pub content: String,
    pub model: Option<String>,
}

pub fn parse_cli_execution_output(stdout: &str) -> CLIResponse {
    let trimmed = stdout.trim();
    if trimmed.starts_with('{') {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(content) = val.get("content").and_then(|v| v.as_str()) {
                return CLIResponse {
                    content: content.to_string(),
                    model: val
                        .get("model")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                };
            }
        }
    }
    CLIResponse {
        content: trimmed.to_string(),
        model: None,
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

fn parse_json_models(json_str: &str) -> Vec<String> {
    let val: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let models_array = val
        .get("models")
        .and_then(|m| m.as_array())
        .or_else(|| val.as_array());

    match models_array {
        Some(arr) => arr
            .iter()
            .filter_map(|item| {
                if let Some(s) = item.as_str() {
                    return Some(s.to_string());
                }
                item.get("slug")
                    .and_then(|v| v.as_str())
                    .or_else(|| item.get("id").and_then(|v| v.as_str()))
                    .or_else(|| item.get("name").and_then(|v| v.as_str()))
                    .or_else(|| item.get("model_id").and_then(|v| v.as_str()))
                    .map(|s| s.to_string())
            })
            .collect(),
        None => vec![],
    }
}

pub fn model_toggle(
    token: &str,
    provider_id: &str,
    model_id: &str,
    enabled: bool,
) -> AppResult<StubPayload> {
    let models = match station_api::list_models(token, provider_id) {
        Ok(m) => m,
        Err(e) => return station_error_to_result(e),
    };
    let model = match models.iter().find(|m| m.model_id == model_id) {
        Some(m) => m,
        None => return AppResult::fail(ErrorCode::NotFound, "Model not found", None),
    };
    if let Err(e) = station_api::update_model(
        token,
        provider_id,
        model_id,
        model.version,
        None,
        Some(enabled),
    ) {
        return station_error_to_result(e);
    }
    success_payload("model_toggle", json!({ "ok": true, "enabled": enabled }))
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
