use super::domain_settings::{
    default_settings, default_value, key_name, parse_key, side_effect, validate_value, SettingKey, SettingSideEffect,
};
use super::storage_infrastructure::{load_settings, save_settings, StorageError};
use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{SettingsGetInput, SettingsSetInput, StubPayload};
use crate::state::AppState;
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn settings_get(state: &AppState, input: SettingsGetInput) -> AppResult<StubPayload> {
    let key = match parse_key(&input.key) {
        Ok(key) => key,
        Err(message) => return invalid_value("settings_get", message),
    };
    let settings = match load_settings_with_defaults() {
        Ok(settings) => settings,
        Err(error) => return storage_error_to_result("settings_get", error),
    };
    let current = settings
        .get(key_name(key))
        .cloned()
        .unwrap_or_else(|| default_value(key));
    if let Err(error) = apply_side_effect(state, key, &current) {
        return error;
    }
    AppResult::success(StubPayload {
        command: "settings_get".to_string(),
        status: format!("ok:{}", key_name(key)),
    })
}

pub fn settings_set(state: &AppState, input: SettingsSetInput) -> AppResult<StubPayload> {
    let key = match parse_key(&input.key) {
        Ok(key) => key,
        Err(message) => return invalid_value("settings_set", message),
    };
    let value = match validate_value(key, &input.value) {
        Ok(value) => value,
        Err(message) => return invalid_value("settings_set", message),
    };
    let mut settings = match load_settings_with_defaults() {
        Ok(settings) => settings,
        Err(error) => return storage_error_to_result("settings_set", error),
    };
    settings.insert(key_name(key).to_string(), value.clone());
    if let Err(error) = save_settings(&settings) {
        return storage_error_to_result("settings_set", error);
    }
    if let Err(error) = apply_side_effect(state, key, &value) {
        return error;
    }
    AppResult::success(StubPayload {
        command: "settings_set".to_string(),
        status: format!("updated:{}", key_name(key)),
    })
}

pub fn settings_reset(state: &AppState) -> AppResult<StubPayload> {
    let mut settings = HashMap::new();
    for (key, value) in default_settings() {
        settings.insert(key, value);
    }
    if let Err(error) = save_settings(&settings) {
        return storage_error_to_result("settings_reset", error);
    }
    for key in [SettingKey::Theme, SettingKey::Locale, SettingKey::TelemetryEnabled] {
        let value = settings
            .get(key_name(key))
            .cloned()
            .unwrap_or_else(|| default_value(key));
        if let Err(error) = apply_side_effect(state, key, &value) {
            return error;
        }
    }
    AppResult::success(StubPayload {
        command: "settings_reset".to_string(),
        status: "reset".to_string(),
    })
}

fn load_settings_with_defaults() -> Result<HashMap<String, Value>, StorageError> {
    let mut settings = load_settings()?;
    for (key, default) in default_settings() {
        settings.entry(key).or_insert(default);
    }
    Ok(settings)
}

fn apply_side_effect(state: &AppState, key: SettingKey, value: &Value) -> Result<(), AppResult<StubPayload>> {
    match side_effect(key) {
        SettingSideEffect::None => Ok(()),
        SettingSideEffect::ThemeChanged => {
            let mut guard = state.settings.lock().map_err(|_| {
                AppResult::fail(
                    ErrorCode::InternalError,
                    "failed to apply settings side effect",
                    Some(json!({ "command": "settings", "key": "theme", "reason": "settings_lock_failed" })),
                )
            })?;
            guard.theme = value.as_str().map(|raw| raw.to_string());
            Ok(())
        }
        SettingSideEffect::LocaleChanged => {
            let mut guard = state.settings.lock().map_err(|_| {
                AppResult::fail(
                    ErrorCode::InternalError,
                    "failed to apply settings side effect",
                    Some(json!({ "command": "settings", "key": "locale", "reason": "settings_lock_failed" })),
                )
            })?;
            guard.locale = value.as_str().map(|raw| raw.to_string());
            Ok(())
        }
    }
}

fn invalid_value(command: &str, message: String) -> AppResult<StubPayload> {
    AppResult::fail(
        ErrorCode::InvalidArgument,
        message,
        Some(json!({ "command": command, "reason": "invalid_value" })),
    )
}

fn storage_error_to_result(command: &str, error: StorageError) -> AppResult<StubPayload> {
    match error {
        StorageError::ReadFailed(message) => AppResult::fail(
            ErrorCode::InternalError,
            "failed to read settings",
            Some(json!({ "command": command, "reason": "read_failed", "source": message })),
        ),
        StorageError::WriteFailed(message) => AppResult::fail(
            ErrorCode::Conflict,
            "failed to write settings",
            Some(json!({ "command": command, "reason": "write_failed", "source": message })),
        ),
    }
}
