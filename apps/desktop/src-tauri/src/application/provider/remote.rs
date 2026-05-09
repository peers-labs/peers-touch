use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde_json::Value;
use std::collections::BTreeSet;
use std::time::Duration;

pub(crate) struct ProbeResult {
    pub(crate) endpoint: String,
    pub(crate) models: Vec<String>,
}

type ProbeFn = fn(&Client, &str, &str) -> Result<ProbeResult, String>;

struct ProtocolAdapter {
    key: &'static str,
    aliases: &'static [&'static str],
    probe: ProbeFn,
}

fn normalize_base_url(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

fn redact_url(url: &str) -> String {
    let normalized = normalize_base_url(url);
    if let Some(pos) = normalized.find("key=") {
        format!("{}key=***", &normalized[..pos])
    } else {
        normalized
    }
}

fn build_openai_candidate_endpoints(base_url: &str) -> Vec<String> {
    let normalized = normalize_base_url(base_url);
    let mut endpoints = vec![format!("{}/models", normalized)];
    if normalized.ends_with("/v1") {
        endpoints.push(format!("{}/api/tags", normalized.trim_end_matches("/v1")));
    } else {
        endpoints.push(format!("{}/v1/models", normalized));
        endpoints.push(format!("{}/api/tags", normalized));
    }
    let mut seen = BTreeSet::new();
    endpoints
        .into_iter()
        .filter(|item| seen.insert(item.clone()))
        .collect::<Vec<_>>()
}

fn extract_openai_models(payload: &Value) -> Vec<String> {
    let mut models = vec![];
    if let Some(items) = payload.get("data").and_then(Value::as_array) {
        for item in items {
            if let Some(id) = item.get("id").and_then(Value::as_str) {
                let value = id.trim();
                if !value.is_empty() {
                    models.push(value.to_string());
                }
            }
        }
    }
    if let Some(items) = payload.get("models").and_then(Value::as_array) {
        for item in items {
            if let Some(id) = item.as_str() {
                let value = id.trim();
                if !value.is_empty() {
                    models.push(value.to_string());
                }
                continue;
            }
            if let Some(name) = item
                .get("name")
                .and_then(Value::as_str)
                .or_else(|| item.get("id").and_then(Value::as_str))
            {
                let value = name.trim();
                if !value.is_empty() {
                    models.push(value.to_string());
                }
            }
        }
    }
    let mut seen = BTreeSet::new();
    models
        .into_iter()
        .filter(|item| seen.insert(item.clone()))
        .collect::<Vec<_>>()
}

fn request_json(client: &Client, endpoint: &str, headers: &HeaderMap) -> Result<Value, String> {
    let mut request = client
        .get(endpoint)
        .header(CONTENT_TYPE, "application/json");
    request = request.headers(headers.clone());
    let response = request
        .send()
        .map_err(|err| format!("request {} failed: {}", endpoint, err))?;
    if !response.status().is_success() {
        return Err(format!(
            "request {} failed with status {}",
            endpoint,
            response.status()
        ));
    }
    response
        .json()
        .map_err(|err| format!("invalid response {}: {}", endpoint, err))
}

fn openai_headers(api_key: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if !api_key.trim().is_empty() {
        let value = format!("Bearer {}", api_key.trim());
        if let Ok(auth) = HeaderValue::from_str(&value) {
            headers.insert(AUTHORIZATION, auth);
        }
    }
    headers
}

fn anthropic_headers(api_key: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if !api_key.trim().is_empty() {
        if let Ok(api_value) = HeaderValue::from_str(api_key.trim()) {
            headers.insert(HeaderName::from_static("x-api-key"), api_value);
        }
    }
    headers.insert(
        HeaderName::from_static("anthropic-version"),
        HeaderValue::from_static("2023-06-01"),
    );
    headers
}

fn google_headers() -> HeaderMap {
    HeaderMap::new()
}

fn request_openai_models(
    client: &Client,
    base_url: &str,
    api_key: &str,
) -> Result<ProbeResult, String> {
    let headers = openai_headers(api_key);
    let mut last_error = String::from("no endpoint available");
    for endpoint in build_openai_candidate_endpoints(base_url) {
        match request_json(client, &endpoint, &headers) {
            Ok(payload) => {
                let models = extract_openai_models(&payload);
                return Ok(ProbeResult { endpoint, models });
            }
            Err(err) => last_error = err,
        }
    }
    Err(last_error)
}

fn request_anthropic_models(
    client: &Client,
    base_url: &str,
    api_key: &str,
) -> Result<ProbeResult, String> {
    let headers = anthropic_headers(api_key);
    let base = normalize_base_url(base_url);
    let mut endpoints = vec![format!("{}/v1/models", base), format!("{}/models", base)];
    let mut seen = BTreeSet::new();
    endpoints.retain(|item| seen.insert(item.clone()));
    let mut last_error = String::from("no endpoint available");
    for endpoint in endpoints {
        match request_json(client, &endpoint, &headers) {
            Ok(payload) => {
                let models = extract_openai_models(&payload);
                return Ok(ProbeResult { endpoint, models });
            }
            Err(err) => last_error = err,
        }
    }
    Err(last_error)
}

fn extract_ollama_models(payload: &Value) -> Vec<String> {
    payload
        .get("models")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(Value::as_str))
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn extract_gemini_models(payload: &Value) -> Vec<String> {
    payload
        .get("models")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(Value::as_str))
                .map(|name| name.trim().trim_start_matches("models/").to_string())
                .filter(|name| !name.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn request_ollama_models(client: &Client, base_url: &str) -> Result<ProbeResult, String> {
    let endpoint = format!("{}/api/tags", normalize_base_url(base_url));
    let payload = request_json(client, &endpoint, &HeaderMap::new())?;
    let models = extract_ollama_models(&payload);
    Ok(ProbeResult { endpoint, models })
}

fn request_gemini_models(
    client: &Client,
    base_url: &str,
    api_key: &str,
) -> Result<ProbeResult, String> {
    let base = normalize_base_url(base_url);
    if base.contains("/openai") {
        return request_openai_models(client, &base, api_key);
    }
    let endpoint = if api_key.trim().is_empty() {
        format!("{}/models", base)
    } else {
        format!("{}/models?key={}", base, api_key.trim())
    };
    let payload = request_json(client, &endpoint, &google_headers())?;
    let models = extract_gemini_models(&payload);
    Ok(ProbeResult { endpoint, models })
}

fn model_matches(expected: &str, candidate: &str) -> bool {
    candidate == expected || candidate.starts_with(&format!("{}:", expected))
}

fn protocol_adapters() -> &'static [ProtocolAdapter] {
    static ADAPTERS: &[ProtocolAdapter] = &[
        ProtocolAdapter {
            key: "openai-compatible",
            aliases: &["openai-compatible", "openai"],
            probe: request_openai_models,
        },
        ProtocolAdapter {
            key: "anthropic",
            aliases: &["anthropic", "claude"],
            probe: request_anthropic_models,
        },
        ProtocolAdapter {
            key: "ollama",
            aliases: &["ollama"],
            probe: |client, base_url, _| request_ollama_models(client, base_url),
        },
        ProtocolAdapter {
            key: "gemini",
            aliases: &["gemini", "google"],
            probe: request_gemini_models,
        },
    ];
    ADAPTERS
}

fn resolve_protocol_key(protocol: Option<&str>) -> &'static str {
    let normalized = protocol
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "openai-compatible".to_string());
    for adapter in protocol_adapters() {
        if adapter.aliases.iter().any(|alias| *alias == normalized) {
            return adapter.key;
        }
    }
    "openai-compatible"
}

fn resolve_protocol_adapter(protocol: Option<&str>) -> &'static ProtocolAdapter {
    let key = resolve_protocol_key(protocol);
    protocol_adapters()
        .iter()
        .find(|adapter| adapter.key == key)
        .unwrap_or(&protocol_adapters()[0])
}

pub(crate) fn resolve_model_protocol<'a>(
    model_protocol: Option<&'a str>,
    provider_protocol: Option<&'a str>,
) -> &'static str {
    let effective = model_protocol
        .filter(|v| !v.trim().is_empty())
        .or(provider_protocol);
    resolve_protocol_key(effective)
}

pub(crate) fn probe_provider(
    base_url: &str,
    api_key: &str,
    model: &str,
    protocol: Option<&str>,
) -> Result<ProbeResult, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|err| format!("create http client failed: {}", err))?;
    let adapter = resolve_protocol_adapter(protocol);
    let result = (adapter.probe)(&client, base_url, api_key)?;
    let expected = model.trim();
    if !expected.is_empty() && !result.models.is_empty() {
        let matched = result
            .models
            .iter()
            .any(|item| model_matches(expected, item));
        if !matched {
            return Err(format!("model {} not found on provider", expected));
        }
    }
    Ok(result)
}

pub(crate) fn fetch_models(
    base_url: &str,
    api_key: &str,
    protocol: Option<&str>,
) -> Result<Vec<String>, String> {
    let result = probe_provider(base_url, api_key, "", protocol)?;
    Ok(result.models)
}

pub(crate) struct CompletionResult {
    pub(crate) text: String,
    pub(crate) model: String,
}

pub(crate) fn chat_completion(
    base_url: &str,
    api_key: &str,
    model: &str,
    protocol: Option<&str>,
    user_message: &str,
) -> Result<CompletionResult, String> {
    let protocol_key = resolve_protocol_key(protocol);
    tracing::info!(
        command = "chat_completion",
        base_url = %redact_url(base_url),
        model = %model,
        protocol = %protocol_key,
        "Starting chat completion"
    );
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("create http client failed: {}", e))?;
    match protocol_key {
        "anthropic" => completion_anthropic(&client, base_url, api_key, model, user_message),
        "gemini" => completion_gemini(&client, base_url, api_key, model, user_message),
        "ollama" => completion_ollama(&client, base_url, model, user_message),
        _ => completion_openai(&client, base_url, api_key, model, user_message),
    }
}

fn post_json(
    client: &Client,
    url: &str,
    headers: &HeaderMap,
    body: &Value,
) -> Result<Value, String> {
    tracing::debug!(url = %redact_url(url), "POST request");
    let response = client
        .post(url)
        .headers(headers.clone())
        .header(CONTENT_TYPE, "application/json")
        .json(body)
        .send()
        .map_err(|e| {
            tracing::error!(url = %redact_url(url), error = %e, "HTTP request failed");
            format!("request failed: {}", e)
        })?;
    let status = response.status();
    if !status.is_success() {
        let body_text = response.text().unwrap_or_default();
        let detail = serde_json::from_str::<Value>(&body_text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(Value::as_str)
                    .map(String::from)
            })
            .unwrap_or(body_text);
        tracing::error!(url = %redact_url(url), status = %status, "HTTP request returned error status");
        return Err(format!("{} {}", status, detail));
    }
    tracing::info!(url = %redact_url(url), status = %status, "HTTP request succeeded");
    response
        .json()
        .map_err(|e| format!("parse response failed: {}", e))
}

fn completion_openai(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    message: &str,
) -> Result<CompletionResult, String> {
    let base = normalize_base_url(base_url);
    let url = format!("{}/chat/completions", base);
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": message}],
        "stream": false
    });
    let payload = post_json(client, &url, &openai_headers(api_key), &body)?;
    let text = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let used_model = payload
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(model)
        .to_string();
    Ok(CompletionResult {
        text,
        model: used_model,
    })
}

fn completion_anthropic(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    message: &str,
) -> Result<CompletionResult, String> {
    let base = normalize_base_url(base_url);
    let url = format!("{}/v1/messages", base);
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": message}]
    });
    let payload = post_json(client, &url, &anthropic_headers(api_key), &body)?;
    let text = payload
        .get("content")
        .and_then(Value::as_array)
        .and_then(|blocks| {
            blocks
                .iter()
                .find(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        })
        .and_then(|b| b.get("text"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let used_model = payload
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(model)
        .to_string();
    Ok(CompletionResult {
        text,
        model: used_model,
    })
}

fn completion_gemini(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    message: &str,
) -> Result<CompletionResult, String> {
    let base = normalize_base_url(base_url);
    if base.contains("/openai") {
        return completion_openai(client, &base, api_key, model, message);
    }
    let url = if api_key.trim().is_empty() {
        format!("{}/models/{}:generateContent", base, model)
    } else {
        format!(
            "{}/models/{}:generateContent?key={}",
            base,
            model,
            api_key.trim()
        )
    };
    let body = serde_json::json!({
        "contents": [{"parts": [{"text": message}]}]
    });
    let payload = post_json(client, &url, &google_headers(), &body)?;
    let text = payload
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(Value::as_array)
        .and_then(|p| p.first())
        .and_then(|p| p.get("text"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Ok(CompletionResult {
        text,
        model: model.to_string(),
    })
}

fn completion_ollama(
    client: &Client,
    base_url: &str,
    model: &str,
    message: &str,
) -> Result<CompletionResult, String> {
    let base = normalize_base_url(base_url);
    let url = format!("{}/api/chat", base);
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": message}],
        "stream": false
    });
    let payload = post_json(client, &url, &HeaderMap::new(), &body)?;
    let text = payload
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let used_model = payload
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(model)
        .to_string();
    Ok(CompletionResult {
        text,
        model: used_model,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resolve_protocol_should_support_aliases() {
        assert_eq!(resolve_protocol_key(Some("openai")), "openai-compatible");
        assert_eq!(resolve_protocol_key(Some("google")), "gemini");
        assert_eq!(resolve_protocol_key(Some("claude")), "anthropic");
    }

    #[test]
    fn resolve_protocol_should_fallback_to_openai_compatible() {
        assert_eq!(resolve_protocol_key(Some("unknown")), "openai-compatible");
        assert_eq!(resolve_protocol_key(Some("  ")), "openai-compatible");
        assert_eq!(resolve_protocol_key(None), "openai-compatible");
    }

    #[test]
    fn model_protocol_override_takes_precedence_over_provider() {
        assert_eq!(
            resolve_model_protocol(Some("anthropic"), Some("openai-compatible")),
            "anthropic"
        );
    }

    #[test]
    fn model_protocol_falls_back_to_provider_when_none() {
        assert_eq!(resolve_model_protocol(None, Some("gemini")), "gemini");
    }

    #[test]
    fn model_protocol_falls_back_to_provider_when_empty() {
        assert_eq!(
            resolve_model_protocol(Some("  "), Some("anthropic")),
            "anthropic"
        );
    }

    #[test]
    fn model_protocol_falls_back_to_system_default_when_both_none() {
        assert_eq!(resolve_model_protocol(None, None), "openai-compatible");
    }

    #[test]
    fn extract_openai_models_from_data_array() {
        let payload = json!({
            "data": [
                { "id": "gpt-4o", "object": "model" },
                { "id": "gpt-4o-mini", "object": "model" },
                { "id": "  " }
            ]
        });
        let models = extract_openai_models(&payload);
        assert_eq!(models, vec!["gpt-4o", "gpt-4o-mini"]);
    }

    #[test]
    fn extract_openai_models_from_models_array_with_name_field() {
        let payload = json!({
            "models": [
                { "name": "llama3:latest" },
                { "id": "phi3" }
            ]
        });
        let models = extract_openai_models(&payload);
        assert_eq!(models, vec!["llama3:latest", "phi3"]);
    }

    #[test]
    fn extract_openai_models_from_string_models_array() {
        let payload = json!({
            "models": ["model-a", "model-b", "model-a"]
        });
        let models = extract_openai_models(&payload);
        assert_eq!(models, vec!["model-a", "model-b"]);
    }

    #[test]
    fn extract_openai_models_deduplicates() {
        let payload = json!({
            "data": [
                { "id": "gpt-4o" },
                { "id": "gpt-4o" }
            ]
        });
        let models = extract_openai_models(&payload);
        assert_eq!(models, vec!["gpt-4o"]);
    }

    #[test]
    fn extract_openai_models_empty_payload() {
        let models = extract_openai_models(&json!({}));
        assert!(models.is_empty());
    }

    #[test]
    fn extract_ollama_models_from_tags_response() {
        let payload = json!({
            "models": [
                { "name": "llama3:latest", "size": 4700000000_u64 },
                { "name": "mistral:7b", "size": 4100000000_u64 },
                { "name": "  " }
            ]
        });
        let models = extract_ollama_models(&payload);
        assert_eq!(models, vec!["llama3:latest", "mistral:7b"]);
    }

    #[test]
    fn extract_ollama_models_empty_response() {
        let models = extract_ollama_models(&json!({ "models": [] }));
        assert!(models.is_empty());
    }

    #[test]
    fn extract_gemini_models_strips_prefix() {
        let payload = json!({
            "models": [
                { "name": "models/gemini-2.0-flash" },
                { "name": "models/gemini-1.5-pro" },
                { "name": "gemini-nano" }
            ]
        });
        let models = extract_gemini_models(&payload);
        assert_eq!(
            models,
            vec!["gemini-2.0-flash", "gemini-1.5-pro", "gemini-nano"]
        );
    }

    #[test]
    fn extract_gemini_models_empty_response() {
        let models = extract_gemini_models(&json!({ "models": [] }));
        assert!(models.is_empty());
    }

    #[test]
    fn build_openai_endpoints_for_standard_url() {
        let endpoints = build_openai_candidate_endpoints("https://api.openai.com/v1");
        assert_eq!(endpoints[0], "https://api.openai.com/v1/models");
        assert!(endpoints.iter().any(|e| e.contains("/api/tags")));
    }

    #[test]
    fn build_openai_endpoints_for_non_v1_url() {
        let endpoints = build_openai_candidate_endpoints("https://custom.example.com");
        assert_eq!(endpoints[0], "https://custom.example.com/models");
        assert!(endpoints.iter().any(|e| e.contains("/v1/models")));
        assert!(endpoints.iter().any(|e| e.contains("/api/tags")));
    }

    #[test]
    fn build_openai_endpoints_trims_trailing_slash() {
        let endpoints = build_openai_candidate_endpoints("https://api.openai.com/v1/");
        assert_eq!(endpoints[0], "https://api.openai.com/v1/models");
    }

    #[test]
    fn openai_headers_include_bearer_token() {
        let headers = openai_headers("sk-test-key");
        let auth = headers
            .get(AUTHORIZATION)
            .expect("should have Authorization");
        assert_eq!(auth.to_str().unwrap(), "Bearer sk-test-key");
    }

    #[test]
    fn openai_headers_skip_empty_key() {
        let headers = openai_headers("  ");
        assert!(headers.get(AUTHORIZATION).is_none());
    }

    #[test]
    fn anthropic_headers_include_api_key_and_version() {
        let headers = anthropic_headers("ant-key");
        let api_key = headers.get("x-api-key").expect("should have x-api-key");
        assert_eq!(api_key.to_str().unwrap(), "ant-key");
        let version = headers
            .get("anthropic-version")
            .expect("should have anthropic-version");
        assert_eq!(version.to_str().unwrap(), "2023-06-01");
    }

    #[test]
    fn anthropic_headers_skip_empty_key_but_keep_version() {
        let headers = anthropic_headers("  ");
        assert!(headers.get("x-api-key").is_none());
        assert!(headers.get("anthropic-version").is_some());
    }

    #[test]
    fn model_matches_exact() {
        assert!(model_matches("gpt-4o", "gpt-4o"));
    }

    #[test]
    fn model_matches_with_tag() {
        assert!(model_matches("llama3", "llama3:latest"));
    }

    #[test]
    fn model_matches_rejects_partial() {
        assert!(!model_matches("gpt-4", "gpt-4o"));
    }

    #[test]
    fn normalize_base_url_trims_and_strips_slash() {
        assert_eq!(
            normalize_base_url("  https://api.example.com/v1/  "),
            "https://api.example.com/v1"
        );
    }
}
