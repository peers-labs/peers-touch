use crate::application::provider::{cache as provider_cache, remote as provider_remote};
use crate::contracts::ChatCompletionInput;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const STREAM_EVENT_NAME: &str = "chat:stream-event";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEventPayload {
    pub stream_id: String,
    pub event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_args: Option<String>,
}

impl StreamEventPayload {
    fn text(stream_id: &str, content: &str) -> Self {
        Self {
            stream_id: stream_id.to_string(),
            event: "text".to_string(),
            content: Some(content.to_string()),
            model: None,
            error: None,
            tool_call_id: None,
            tool_call_name: None,
            tool_call_args: None,
        }
    }

    fn thinking(stream_id: &str, content: &str, done: bool) -> Self {
        Self {
            stream_id: stream_id.to_string(),
            event: "thinking".to_string(),
            content: Some(if done {
                format!("{}\n__done__", content)
            } else {
                content.to_string()
            }),
            model: None,
            error: None,
            tool_call_id: None,
            tool_call_name: None,
            tool_call_args: None,
        }
    }

    fn done(stream_id: &str, model: &str) -> Self {
        Self {
            stream_id: stream_id.to_string(),
            event: "done".to_string(),
            content: None,
            model: Some(model.to_string()),
            error: None,
            tool_call_id: None,
            tool_call_name: None,
            tool_call_args: None,
        }
    }

    fn error(stream_id: &str, error: &str) -> Self {
        Self {
            stream_id: stream_id.to_string(),
            event: "error".to_string(),
            content: None,
            model: None,
            error: Some(error.to_string()),
            tool_call_id: None,
            tool_call_name: None,
            tool_call_args: None,
        }
    }
}

struct StreamConfig {
    base_url: String,
    api_key: String,
    model_id: String,
    protocol: String,
    message: String,
}

pub async fn chat_completion_stream(app: AppHandle, stream_id: String, token: String, input: ChatCompletionInput) {
    let config = match resolve_stream_config(&token, &input) {
        Ok(config) => config,
        Err(err) => {
            let _ = app.emit(
                STREAM_EVENT_NAME,
                StreamEventPayload::error(&stream_id, &err),
            );
            let _ = app.emit(STREAM_EVENT_NAME, StreamEventPayload::done(&stream_id, ""));
            return;
        }
    };

    let result = match config.protocol.as_str() {
        "anthropic" => stream_anthropic(&app, &stream_id, &config).await,
        _ => stream_openai(&app, &stream_id, &config).await,
    };

    if let Err(err) = result {
        let _ = app.emit(
            STREAM_EVENT_NAME,
            StreamEventPayload::error(&stream_id, &err),
        );
    }

    let _ = app.emit(
        STREAM_EVENT_NAME,
        StreamEventPayload::done(&stream_id, &config.model_id),
    );
}

fn resolve_stream_config(token: &str, input: &ChatCompletionInput) -> Result<StreamConfig, String> {
    let message = input.message.trim().to_string();
    if message.is_empty() {
        return Err("Message is required".to_string());
    }

    let provider_id = input
        .provider_id
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    let model_hint = input.model.as_deref().unwrap_or("").trim().to_string();

    let provider_id = if provider_id.is_empty() && !model_hint.is_empty() {
        provider_cache::get_providers(token, "")
            .ok()
            .and_then(|providers| {
                providers
                    .iter()
                    .find(|p| p.enabled)
                    .map(|p| p.name.clone())
            })
            .unwrap_or_default()
    } else {
        provider_id
    };

    if provider_id.is_empty() {
        return Err("Provider ID is required".to_string());
    }

    let resolved = provider_cache::resolve_credential(token, &provider_id)
        .map_err(|_| "Provider not found or no credential".to_string())?;

    let base_url = resolved.base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("Provider base URL is required".to_string());
    }

    let model_id = if model_hint.is_empty() {
        String::new()
    } else {
        model_hint
    };

    if model_id.is_empty() {
        return Err("Model is required".to_string());
    }

    let protocol = provider_remote::resolve_model_protocol(
        None,
        Some(&resolved.protocol),
    )
    .to_string();

    Ok(StreamConfig {
        base_url,
        api_key: resolved.api_key,
        model_id,
        protocol,
        message,
    })
}

async fn stream_openai(
    app: &AppHandle,
    stream_id: &str,
    config: &StreamConfig,
) -> Result<(), String> {
    let url = format!("{}/chat/completions", config.base_url);
    let body = serde_json::json!({
        "model": config.model_id,
        "messages": [{"role": "user", "content": config.message}],
        "stream": true
    });

    let mut headers = HeaderMap::new();
    if !config.api_key.trim().is_empty() {
        let value = format!("Bearer {}", config.api_key.trim());
        if let Ok(auth) = HeaderValue::from_str(&value) {
            headers.insert(AUTHORIZATION, auth);
        }
    }
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .post(&url)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<Value>(&body_text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(Value::as_str)
                    .map(String::from)
            })
            .unwrap_or(body_text);
        return Err(format!("{} {}", status, detail));
    }

    let mut buffer = String::new();
    let mut stream = response.bytes_stream();
    use futures_lite::StreamExt;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim_end_matches('\r').to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || line.starts_with(':') {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if data.trim() == "[DONE]" {
                    return Ok(());
                }
                if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                    if let Some(delta) = parsed
                        .get("choices")
                        .and_then(Value::as_array)
                        .and_then(|c| c.first())
                        .and_then(|c| c.get("delta"))
                    {
                        if let Some(content) = delta.get("content").and_then(Value::as_str) {
                            if !content.is_empty() {
                                let _ = app.emit(
                                    STREAM_EVENT_NAME,
                                    StreamEventPayload::text(stream_id, content),
                                );
                            }
                        }
                        if let Some(reasoning) =
                            delta.get("reasoning_content").and_then(Value::as_str)
                        {
                            if !reasoning.is_empty() {
                                let _ = app.emit(
                                    STREAM_EVENT_NAME,
                                    StreamEventPayload::thinking(stream_id, reasoning, false),
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

async fn stream_anthropic(
    app: &AppHandle,
    stream_id: &str,
    config: &StreamConfig,
) -> Result<(), String> {
    let base = config.base_url.trim_end_matches('/');
    let url = format!("{}/v1/messages", base);
    let body = serde_json::json!({
        "model": config.model_id,
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": config.message}],
        "stream": true
    });

    let mut headers = HeaderMap::new();
    if !config.api_key.trim().is_empty() {
        if let Ok(api_value) = HeaderValue::from_str(config.api_key.trim()) {
            headers.insert(HeaderName::from_static("x-api-key"), api_value);
        }
    }
    headers.insert(
        HeaderName::from_static("anthropic-version"),
        HeaderValue::from_static("2023-06-01"),
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .post(&url)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        return Err(format!("{} {}", status, body_text));
    }

    let mut buffer = String::new();
    let mut stream = response.bytes_stream();
    use futures_lite::StreamExt;
    let mut in_thinking = false;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim_end_matches('\r').to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || line.starts_with(':') {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                    let event_type = parsed.get("type").and_then(Value::as_str).unwrap_or("");
                    match event_type {
                        "content_block_start" => {
                            if let Some(block_type) = parsed
                                .get("content_block")
                                .and_then(|b| b.get("type"))
                                .and_then(Value::as_str)
                            {
                                in_thinking = block_type == "thinking";
                            }
                        }
                        "content_block_delta" => {
                            if let Some(delta) = parsed.get("delta") {
                                let delta_type =
                                    delta.get("type").and_then(Value::as_str).unwrap_or("");
                                match delta_type {
                                    "text_delta" => {
                                        if let Some(text) =
                                            delta.get("text").and_then(Value::as_str)
                                        {
                                            if !text.is_empty() {
                                                let _ = app.emit(
                                                    STREAM_EVENT_NAME,
                                                    StreamEventPayload::text(stream_id, text),
                                                );
                                            }
                                        }
                                    }
                                    "thinking_delta" => {
                                        if let Some(thinking) =
                                            delta.get("thinking").and_then(Value::as_str)
                                        {
                                            if !thinking.is_empty() {
                                                let _ = app.emit(
                                                    STREAM_EVENT_NAME,
                                                    StreamEventPayload::thinking(
                                                        stream_id, thinking, false,
                                                    ),
                                                );
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                        "content_block_stop" => {
                            if in_thinking {
                                let _ = app.emit(
                                    STREAM_EVENT_NAME,
                                    StreamEventPayload::thinking(stream_id, "", true),
                                );
                                in_thinking = false;
                            }
                        }
                        "message_stop" => {
                            return Ok(());
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    Ok(())
}
