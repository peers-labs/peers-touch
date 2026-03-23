use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SettingKey {
    Theme,
    Locale,
    TelemetryEnabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingSideEffect {
    None,
    ThemeChanged,
    LocaleChanged,
}

pub fn parse_key(key: &str) -> Result<SettingKey, String> {
    match key.trim() {
        "theme" => Ok(SettingKey::Theme),
        "locale" => Ok(SettingKey::Locale),
        "telemetry_enabled" => Ok(SettingKey::TelemetryEnabled),
        _ => Err("unsupported setting key".to_string()),
    }
}

pub fn key_name(key: SettingKey) -> &'static str {
    match key {
        SettingKey::Theme => "theme",
        SettingKey::Locale => "locale",
        SettingKey::TelemetryEnabled => "telemetry_enabled",
    }
}

pub fn default_value(key: SettingKey) -> Value {
    match key {
        SettingKey::Theme => Value::String("system".to_string()),
        SettingKey::Locale => Value::String("zh-CN".to_string()),
        SettingKey::TelemetryEnabled => Value::Bool(false),
    }
}

pub fn default_settings() -> Vec<(String, Value)> {
    vec![
        (
            key_name(SettingKey::Theme).to_string(),
            default_value(SettingKey::Theme),
        ),
        (
            key_name(SettingKey::Locale).to_string(),
            default_value(SettingKey::Locale),
        ),
        (
            key_name(SettingKey::TelemetryEnabled).to_string(),
            default_value(SettingKey::TelemetryEnabled),
        ),
    ]
}

pub fn side_effect(key: SettingKey) -> SettingSideEffect {
    match key {
        SettingKey::Theme => SettingSideEffect::ThemeChanged,
        SettingKey::Locale => SettingSideEffect::LocaleChanged,
        SettingKey::TelemetryEnabled => SettingSideEffect::None,
    }
}

pub fn validate_value(key: SettingKey, value: &Value) -> Result<Value, String> {
    match key {
        SettingKey::Theme => {
            let theme = value
                .as_str()
                .ok_or_else(|| "theme must be string".to_string())?
                .trim();
            if !matches!(theme, "light" | "dark" | "system") {
                return Err("theme must be one of light|dark|system".to_string());
            }
            Ok(Value::String(theme.to_string()))
        }
        SettingKey::Locale => {
            let locale = value
                .as_str()
                .ok_or_else(|| "locale must be string".to_string())?
                .trim();
            if locale.is_empty() {
                return Err("locale must not be empty".to_string());
            }
            if locale.len() > 32 {
                return Err("locale is too long".to_string());
            }
            Ok(Value::String(locale.to_string()))
        }
        SettingKey::TelemetryEnabled => {
            let enabled = value
                .as_bool()
                .ok_or_else(|| "telemetry_enabled must be boolean".to_string())?;
            Ok(Value::Bool(enabled))
        }
    }
}
