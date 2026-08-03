use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde_json::Value;
use std::time::Duration;

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

fn resolve_protocol_key(protocol: Option<&str>) -> &'static str {
    let normalized = protocol
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "openai-compatible".to_string());

    match normalized.as_str() {
        "openai" | "openai-compatible" | "openai_compatible" => "openai-compatible",
        "anthropic" | "claude" => "anthropic",
        "gemini" | "google" => "gemini",
        "ollama" => "ollama",
        _ => "openai-compatible",
    }
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
    fn normalize_base_url_trims_and_strips_slash() {
        assert_eq!(
            normalize_base_url("  https://api.openai.com/v1/  "),
            "https://api.openai.com/v1"
        );
        assert_eq!(
            normalize_base_url("http://localhost:11434/"),
            "http://localhost:11434"
        );
    }
}
