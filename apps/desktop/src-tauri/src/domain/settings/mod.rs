use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SettingKey {
    Theme,
    Locale,
    TelemetryEnabled,
    CurrentAgent,
    ChatScreenshotShortcut,
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
        "settings.currentAgent" => Ok(SettingKey::CurrentAgent),
        "settings.chat.screenshotShortcut" => Ok(SettingKey::ChatScreenshotShortcut),
        _ => Err("unsupported setting key".to_string()),
    }
}

pub fn key_name(key: SettingKey) -> &'static str {
    match key {
        SettingKey::Theme => "theme",
        SettingKey::Locale => "locale",
        SettingKey::TelemetryEnabled => "telemetry_enabled",
        SettingKey::CurrentAgent => "settings.currentAgent",
        SettingKey::ChatScreenshotShortcut => "settings.chat.screenshotShortcut",
    }
}

pub fn default_value(key: SettingKey) -> Value {
    match key {
        SettingKey::Theme => Value::String("system".to_string()),
        SettingKey::Locale => Value::String("zh-CN".to_string()),
        SettingKey::TelemetryEnabled => Value::Bool(false),
        SettingKey::CurrentAgent => Value::String("assistant".to_string()),
        SettingKey::ChatScreenshotShortcut => Value::String("Mod+Shift+A".to_string()),
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
        (
            key_name(SettingKey::CurrentAgent).to_string(),
            default_value(SettingKey::CurrentAgent),
        ),
        (
            key_name(SettingKey::ChatScreenshotShortcut).to_string(),
            default_value(SettingKey::ChatScreenshotShortcut),
        ),
    ]
}

pub fn side_effect(key: SettingKey) -> SettingSideEffect {
    match key {
        SettingKey::Theme => SettingSideEffect::ThemeChanged,
        SettingKey::Locale => SettingSideEffect::LocaleChanged,
        SettingKey::TelemetryEnabled
        | SettingKey::CurrentAgent
        | SettingKey::ChatScreenshotShortcut => SettingSideEffect::None,
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
        SettingKey::CurrentAgent => {
            let name = value
                .as_str()
                .ok_or_else(|| "settings.currentAgent must be string".to_string())?
                .trim();
            if name.is_empty() {
                return Err("settings.currentAgent must not be empty".to_string());
            }
            if name.len() > 128 {
                return Err("settings.currentAgent is too long".to_string());
            }
            Ok(Value::String(name.to_string()))
        }
        SettingKey::ChatScreenshotShortcut => {
            let shortcut = value
                .as_str()
                .ok_or_else(|| "settings.chat.screenshotShortcut must be string".to_string())?
                .trim();
            if shortcut.is_empty() {
                return Err("settings.chat.screenshotShortcut must not be empty".to_string());
            }
            if shortcut.len() > 64 {
                return Err("settings.chat.screenshotShortcut is too long".to_string());
            }
            Ok(Value::String(shortcut.to_string()))
        }
    }
}
