use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub struct AccessContext {
    pub actor_id: Option<String>,
    pub token: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub enum AdminCapability {
    Health,
    NetworkProbe,
    ExecuteAction,
}

pub fn build_request_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let counter = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("adm-{millis}-{counter}")
}

pub fn authorize(context: &AccessContext, _capability: AdminCapability) -> bool {
    if let Some(actor_id) = &context.actor_id {
        let normalized = actor_id.to_ascii_lowercase();
        if normalized.starts_with("admin")
            || normalized.starts_with("root")
            || normalized.ends_with(":admin")
        {
            return true;
        }
    }
    if let Some(token) = &context.token {
        let normalized = token.to_ascii_lowercase();
        if normalized.contains("role:admin")
            || normalized.contains("role=admin")
            || normalized.contains("scope:admin")
        {
            return true;
        }
    }
    false
}

pub fn validate_probe_target(target: &str) -> Result<(), String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err("target is required".to_string());
    }
    if trimmed.len() > 256 {
        return Err("target is too long".to_string());
    }
    Ok(())
}

pub fn validate_action(action: &str) -> Result<(), String> {
    let trimmed = action.trim();
    if trimmed.is_empty() {
        return Err("action is required".to_string());
    }
    if trimmed.len() > 128 {
        return Err("action is too long".to_string());
    }
    Ok(())
}

pub fn emit_audit(
    request_id: &str,
    capability: AdminCapability,
    actor_id: Option<&str>,
    outcome: &str,
) {
    let capability_name = match capability {
        AdminCapability::Health => "admin_health",
        AdminCapability::NetworkProbe => "admin_network_probe",
        AdminCapability::ExecuteAction => "admin_execute_action",
    };
    let actor = actor_id.unwrap_or("anonymous");
    println!(
        "{{\"request_id\":\"{request_id}\",\"command\":\"{capability_name}\",\"actor\":\"{actor}\",\"outcome\":\"{outcome}\"}}"
    );
}
