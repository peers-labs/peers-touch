//! Resolve `actor_id` to per-actor in-memory store bucket keys.

const DEFAULT_ACTOR_BUCKET: &str = "__default__";

/// Map empty `actor_id` to a dedicated bucket (legacy + tests). Logs at info.
pub fn actor_bucket_id(actor_id: &str) -> String {
    if actor_id.is_empty() {
        tracing::info!(
            target: "actor_bucket",
            "empty actor_id; using __default__ in-memory store bucket (legacy or tests)"
        );
        return DEFAULT_ACTOR_BUCKET.to_string();
    }
    actor_id.to_string()
}
