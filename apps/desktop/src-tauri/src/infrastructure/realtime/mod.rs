use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

static CONNECTED: AtomicBool = AtomicBool::new(false);
static FAIL_ONCE_KEYS: OnceLock<Mutex<Vec<String>>> = OnceLock::new();

fn fail_once_keys() -> &'static Mutex<Vec<String>> {
    FAIL_ONCE_KEYS.get_or_init(|| Mutex::new(Vec::new()))
}

pub fn ensure_connected() -> bool {
    if CONNECTED.load(Ordering::Relaxed) {
        return true;
    }
    CONNECTED.store(true, Ordering::Relaxed);
    true
}

pub fn send_relay_with_retry(retry_key: &str, max_retries: u8) -> Result<u8, String> {
    if !ensure_connected() {
        return Err("realtime disconnected".to_string());
    }
    let key = retry_key.trim().to_string();
    let mut retries = 0u8;
    while retries <= max_retries {
        if !should_fail_once(&key) {
            return Ok(retries);
        }
        retries = retries.saturating_add(1);
    }
    Err("relay send failed after retries".to_string())
}

fn should_fail_once(retry_key: &str) -> bool {
    if retry_key.is_empty() {
        return false;
    }
    if !retry_key.contains("fail_once") {
        return false;
    }
    match fail_once_keys().lock() {
        Ok(mut guard) => {
            if guard.iter().any(|item| item == retry_key) {
                return false;
            }
            guard.push(retry_key.to_string());
            true
        }
        Err(_) => false,
    }
}

pub fn publish_chat_event(event: &str, conversation_id: &str, message_id: Option<&str>) {
    let message = message_id.unwrap_or("");
    println!(
        "{{\"event\":\"{event}\",\"conversationId\":\"{conversation_id}\",\"messageId\":\"{message}\"}}"
    );
}
