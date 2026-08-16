use crate::contracts::FrontendLogInput;

fn sanitize_log_data(data: Option<&str>) -> String {
    let Some(data) = data else {
        return String::new();
    };
    match serde_json::from_str(data) {
        Ok(value) => crate::application::security::redact_json_value(&value).to_string(),
        Err(_) => data.to_string(),
    }
}

#[tauri::command]
pub fn frontend_log(input: FrontendLogInput) {
    let data_str = sanitize_log_data(input.data.as_deref());
    match input.level.as_str() {
        "error" => {
            tracing::error!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message)
        }
        "warn" => {
            tracing::warn!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message)
        }
        "debug" => {
            tracing::debug!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message)
        }
        _ => tracing::info!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message),
    }
}

#[cfg(test)]
mod tests {
    use super::sanitize_log_data;

    #[test]
    fn redacts_nested_secrets_before_writing_frontend_logs() {
        let sanitized = sanitize_log_data(Some(
            r#"{"req":{"account":"alice@p.t","password":"sensitive-value-a","nested":{"access_token":"sensitive-value-b","operation":"login"}}}"#,
        ));

        assert!(!sanitized.contains("sensitive-value-a"));
        assert!(!sanitized.contains("sensitive-value-b"));
        assert!(sanitized.contains("[redacted]"));
        assert!(sanitized.contains("alice@p.t"));
        assert!(sanitized.contains("login"));
    }
}
