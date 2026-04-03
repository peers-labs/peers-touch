use crate::contracts::FrontendLogInput;

#[tauri::command]
pub fn frontend_log(input: FrontendLogInput) {
    let data_str = input.data.as_deref().unwrap_or("");
    match input.level.as_str() {
        "error" => tracing::error!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message),
        "warn" => tracing::warn!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message),
        "debug" => tracing::debug!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message),
        _ => tracing::info!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message),
    }
}
