//! Validate PTID keys for per-actor in-memory stores.

pub fn actor_bucket_id(actor_ptid: &str) -> Result<String, &'static str> {
    let actor_ptid = actor_ptid.trim();
    if !actor_ptid.starts_with("ptid:") {
        return Err("canonical actor PTID is required");
    }
    Ok(actor_ptid.to_string())
}
