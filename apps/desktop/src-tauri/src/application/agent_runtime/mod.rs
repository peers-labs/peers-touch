mod context;
mod prompt;
mod provider;
mod service;
mod trace;

pub(crate) use service::{execute_turn, list_traces};

fn success_payload(
    command: &str,
    data: serde_json::Value,
) -> crate::error::AppResult<crate::contracts::StubPayload> {
    crate::error::AppResult::success(crate::contracts::StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> crate::error::AppResult<crate::contracts::StubPayload> {
    crate::error::AppResult::fail(crate::error::ErrorCode::InvalidArgument, message, None)
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn stable_hash(input: &str) -> String {
    let mut hash: u64 = 1469598103934665603;
    for byte in input.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("{hash:016x}")
}

fn value_string(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}
