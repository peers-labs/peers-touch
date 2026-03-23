pub fn is_available(conversation_id: &str) -> bool {
    let normalized = conversation_id.to_ascii_lowercase();
    if normalized.contains("relay") || normalized.contains("no-p2p") {
        return false;
    }
    true
}

pub fn send_message(conversation_id: &str, content: &str) -> Result<(), String> {
    if !is_available(conversation_id) {
        return Err("p2p unavailable".to_string());
    }
    if content.to_ascii_lowercase().contains("p2p_fail") {
        return Err("p2p send failed".to_string());
    }
    Ok(())
}
