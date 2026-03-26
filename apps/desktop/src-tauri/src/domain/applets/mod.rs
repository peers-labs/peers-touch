use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub struct AccessContext {
    pub actor_id: Option<String>,
}

pub fn build_request_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let counter = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("apl-{millis}-{counter}")
}

pub fn normalize_capability(capability: &str) -> String {
    capability.trim().to_ascii_lowercase()
}

pub fn is_capability_allowed(capability: &str) -> bool {
    matches!(
        capability,
        "applets.list"
            | "applets.get"
            | "applets.activate"
            | "applets.deactivate"
            | "applets.get_config"
            | "applets.set_config"
            | "applets.action"
    )
}

pub fn authorize(_context: &AccessContext, capability: &str) -> bool {
    is_capability_allowed(capability)
}

pub fn emit_audit(
    request_id: &str,
    command: &str,
    applet_id: Option<&str>,
    capability: &str,
    actor_id: Option<&str>,
    outcome: &str,
) {
    let actor = actor_id.unwrap_or("anonymous");
    let target = applet_id.unwrap_or("*");
    println!(
        "{{\"request_id\":\"{request_id}\",\"command\":\"{command}\",\"applet_id\":\"{target}\",\"capability\":\"{capability}\",\"actor\":\"{actor}\",\"outcome\":\"{outcome}\"}}"
    );
}
