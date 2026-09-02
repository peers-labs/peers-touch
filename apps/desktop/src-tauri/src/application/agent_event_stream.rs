use crate::infrastructure::station_client;
use reqwest::blocking::Client;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct AgentEventPayload {
    #[serde(rename = "streamId")]
    stream_id: String,
    #[serde(rename = "agentId")]
    agent_id: String,
    event: String,
    data: Value,
}

fn agent_event_cancel_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn register_stream(stream_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut registry) = agent_event_cancel_registry().lock() {
        registry.insert(stream_id.to_string(), Arc::clone(&flag));
    }
    flag
}

pub fn unregister_stream(stream_id: &str) {
    if let Ok(mut registry) = agent_event_cancel_registry().lock() {
        registry.remove(stream_id);
    }
}

pub fn cancel_stream(stream_id: &str) {
    if let Ok(registry) = agent_event_cancel_registry().lock() {
        if let Some(flag) = registry.get(stream_id.trim()) {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

pub fn stream(
    app: &AppHandle,
    event_channel: &str,
    stream_id: &str,
    agent_id: &str,
    task_id: Option<&str>,
    after_event_seq: i64,
    token: &str,
    cancel_flag: &AtomicBool,
) -> Result<(), String> {
    let url = format!(
        "{}{}",
        station_client::station_base_url(),
        "/sub-agent/agent/events/subscribe"
    );
    let client = Client::builder()
        .build()
        .map_err(|error| format!("failed to create Station event client: {error}"))?;
    let mut body = json!({
        "agent_id": agent_id,
        "after_event_seq": after_event_seq.max(0),
    });
    if let Some(task_id) = task_id.map(str::trim).filter(|value| !value.is_empty()) {
        body["task_id"] = json!(task_id);
    }
    let mut response = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .map_err(|error| format!("Station agent event stream request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Station agent event stream returned HTTP {}",
            response.status()
        ));
    }

    let mut bytes = [0_u8; 4096];
    let mut buffer = String::new();
    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            return Ok(());
        }
        let read = response
            .read(&mut bytes)
            .map_err(|error| format!("failed to read Station agent event stream: {error}"))?;
        if read == 0 {
            break;
        }
        buffer.push_str(&String::from_utf8_lossy(&bytes[..read]));
        while let Some(frame_end) = buffer.find("\n\n") {
            let frame = buffer[..frame_end].to_string();
            buffer = buffer[frame_end + 2..].to_string();
            if let Some((event, data)) = parse_sse_frame(&frame) {
                emit(app, event_channel, stream_id, agent_id, &event, data);
            }
        }
    }
    Ok(())
}

pub fn emit_error(
    app: &AppHandle,
    event_channel: &str,
    stream_id: &str,
    agent_id: &str,
    error: String,
) {
    emit(
        app,
        event_channel,
        stream_id,
        agent_id,
        "error",
        json!({ "error": error }),
    );
}

fn parse_sse_frame(frame: &str) -> Option<(String, Value)> {
    let mut event = "message".to_string();
    let mut data_lines = Vec::new();
    for line in frame.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(value) = line.strip_prefix("event:") {
            event = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("data:") {
            data_lines.push(value.trim_start().to_string());
        }
    }
    if data_lines.is_empty() {
        return None;
    }
    let data = data_lines.join("\n");
    let parsed = serde_json::from_str::<Value>(&data).unwrap_or_else(|_| json!({ "raw": data }));
    Some((event, parsed))
}

fn emit(
    app: &AppHandle,
    event_channel: &str,
    stream_id: &str,
    agent_id: &str,
    event: &str,
    data: Value,
) {
    if let Err(error) = app.emit(
        event_channel,
        AgentEventPayload {
            stream_id: stream_id.to_string(),
            agent_id: agent_id.to_string(),
            event: event.to_string(),
            data,
        },
    ) {
        tracing::warn!(error = %error, event_channel, "Failed to emit Agent event");
    }
}

#[cfg(test)]
mod tests {
    use super::parse_sse_frame;

    #[test]
    fn parses_multiline_agent_event_once_for_all_consumers() {
        let (event, data) = parse_sse_frame(
            "event: agent.authority.invalidated\r\ndata: {\"payload\":\r\ndata: {\"agent_id\":\"agent-1\"}}\r\n",
        )
        .expect("event frame");

        assert_eq!(event, "agent.authority.invalidated");
        assert_eq!(data["payload"]["agent_id"], "agent-1");
    }
}
