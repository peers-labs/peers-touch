use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static MESSAGE_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub struct Conversation {
    pub id: String,
    pub unread_count: u32,
    pub last_message_id: Option<String>,
    pub last_timestamp_ms: u128,
}

#[derive(Debug, Clone)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub content: String,
    pub read: bool,
    pub via: DeliveryVia,
    pub retry_count: u8,
    pub timestamp_ms: u128,
}

#[derive(Debug, Clone, Copy)]
pub enum DeliveryVia {
    P2p,
    Relay,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeliveryOutcome {
    pub via: String,
    pub retries: u8,
}

pub fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

pub fn next_message_id(client_message_id: Option<&str>) -> String {
    if let Some(client_id) = client_message_id {
        let trimmed = client_id.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let counter = MESSAGE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("msg-{}-{counter}", now_ms())
}

pub fn normalize_conversation_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("conversation_id is required".to_string());
    }
    if trimmed.len() > 128 {
        return Err("conversation_id is too long".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn normalize_content(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("content is required".to_string());
    }
    if trimmed.len() > 4000 {
        return Err("content is too long".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn resolve_limit(raw: Option<u32>) -> usize {
    let candidate = raw.unwrap_or(50).max(1).min(200);
    candidate as usize
}

pub fn parse_cursor(raw: Option<&str>) -> Option<String> {
    raw.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub fn delivery_outcome(via: DeliveryVia, retries: u8) -> DeliveryOutcome {
    let via_name = match via {
        DeliveryVia::P2p => "p2p",
        DeliveryVia::Relay => "relay",
    };
    DeliveryOutcome {
        via: via_name.to_string(),
        retries,
    }
}
