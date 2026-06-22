use serde_json::{json, Value};

pub const REDACTED: &str = "[redacted]";

pub fn is_secret_like_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    normalized.contains("api_key")
        || normalized.contains("apikey")
        || normalized.contains("authorization")
        || normalized.contains("bearer")
        || normalized.contains("secret")
        || normalized.contains("password")
        || normalized.contains("private_key")
        || normalized.contains("credential")
        || normalized == "token"
        || normalized.ends_with("_token")
        || normalized.contains("access_token")
        || normalized.contains("refresh_token")
        || normalized.contains("session_token")
}

pub fn redact_json_value(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (key, item) in map {
                if is_secret_like_key(key) {
                    out.insert(key.clone(), json!(REDACTED));
                } else {
                    out.insert(key.clone(), redact_json_value(item));
                }
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(redact_json_value).collect()),
        _ => value.clone(),
    }
}

pub fn redact_secret_like_values(value: &mut Value, path: &str, redactions: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map.iter_mut() {
                let child_path = if path.is_empty() {
                    key.to_string()
                } else {
                    format!("{path}.{key}")
                };
                if is_secret_like_key(key) {
                    *child = json!(REDACTED);
                    redactions.push(child_path);
                } else {
                    redact_secret_like_values(child, &child_path, redactions);
                }
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter_mut().enumerate() {
                redact_secret_like_values(child, &format!("{path}[{index}]"), redactions);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_secret_like_keys_recursively() {
        let redacted = redact_json_value(&json!({
            "authorization": "Bearer abc",
            "safe": {
                "query": "status",
                "refresh_token": "raw"
            }
        }));

        assert_eq!(redacted["authorization"], REDACTED);
        assert_eq!(redacted["safe"]["refresh_token"], REDACTED);
        assert_eq!(redacted["safe"]["query"], "status");
    }
}
