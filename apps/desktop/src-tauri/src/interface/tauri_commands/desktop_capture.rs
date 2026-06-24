use std::sync::Mutex;

use serde::Deserialize;
use tauri::{plugin::TauriPlugin, AppHandle, Emitter, Runtime, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};

const CHAT_SCREENSHOT_SHORTCUT_EVENT: &str = "chat:screenshot-shortcut";

#[derive(Default)]
pub struct ChatScreenshotShortcutState {
    current: Mutex<Option<String>>,
}

#[derive(Debug, Deserialize)]
pub struct ChatScreenshotShortcutRegisterInput {
    pub shortcut: String,
}

pub fn global_shortcut_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Err(error) = app.emit(CHAT_SCREENSHOT_SHORTCUT_EVENT, serde_json::json!({}))
                {
                    tracing::warn!(error = %error, "Failed to emit chat screenshot shortcut event");
                }
            }
        })
        .build()
}

#[tauri::command]
pub fn chat_screenshot_shortcut_register(
    app: AppHandle,
    state: State<'_, ChatScreenshotShortcutState>,
    input: ChatScreenshotShortcutRegisterInput,
) -> AppResult<StubPayload> {
    let shortcut = match normalize_shortcut_for_tauri(input.shortcut.as_str()) {
        Ok(shortcut) => shortcut,
        Err(message) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "chat screenshot shortcut is invalid",
                Some(serde_json::json!({ "reason": message })),
            );
        }
    };

    let mut current = match state.current.lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("lock chat screenshot shortcut state: {error}"),
                None,
            );
        }
    };

    if current.as_deref() == Some(shortcut.as_str()) {
        return AppResult::success(StubPayload {
            command: "chat_screenshot_shortcut_register".to_string(),
            status: format!("registered:{shortcut}"),
        });
    }

    let previous_shortcut = current.take();
    if let Some(previous) = previous_shortcut.as_deref() {
        if let Err(error) = app.global_shortcut().unregister(previous) {
            tracing::warn!(
                shortcut = previous,
                error = %error,
                "Failed to unregister previous chat screenshot shortcut"
            );
        }
    }

    if let Err(error) = app.global_shortcut().register(shortcut.as_str()) {
        if let Some(previous) = previous_shortcut {
            if let Err(restore_error) = app.global_shortcut().register(previous.as_str()) {
                tracing::warn!(
                    shortcut = previous.as_str(),
                    error = %restore_error,
                    "Failed to restore previous chat screenshot shortcut"
                );
            } else {
                *current = Some(previous);
            }
        }
        return AppResult::fail(
            ErrorCode::Conflict,
            "chat screenshot shortcut registration failed",
            Some(serde_json::json!({
                "shortcut": shortcut,
                "reason": error.to_string(),
            })),
        );
    }

    *current = Some(shortcut.clone());
    AppResult::success(StubPayload {
        command: "chat_screenshot_shortcut_register".to_string(),
        status: format!("registered:{shortcut}"),
    })
}

fn normalize_shortcut_for_tauri(shortcut: &str) -> Result<String, String> {
    let mut key: Option<String> = None;
    let mut modifiers: Vec<String> = Vec::new();

    for token in shortcut
        .split('+')
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        let lower = token.to_ascii_lowercase();
        match lower.as_str() {
            "mod" | "commandorcontrol" => push_modifier(&mut modifiers, "CommandOrControl"),
            "meta" | "cmd" | "command" | "super" => push_modifier(&mut modifiers, "Command"),
            "ctrl" | "control" => push_modifier(&mut modifiers, "Control"),
            "shift" => push_modifier(&mut modifiers, "Shift"),
            "alt" | "option" => push_modifier(&mut modifiers, "Alt"),
            _ => {
                if key.is_some() {
                    return Err("shortcut must contain exactly one non-modifier key".to_string());
                }
                key = Some(normalize_shortcut_key(token)?);
            }
        }
    }

    if modifiers.is_empty() {
        return Err("shortcut must contain at least one modifier".to_string());
    }

    let key = key.ok_or_else(|| "shortcut key is required".to_string())?;
    modifiers.push(key);
    Ok(modifiers.join("+"))
}

fn push_modifier(modifiers: &mut Vec<String>, modifier: &str) {
    if !modifiers.iter().any(|item| item == modifier) {
        modifiers.push(modifier.to_string());
    }
}

fn normalize_shortcut_key(key: &str) -> Result<String, String> {
    if key.len() == 1 {
        let upper = key.to_ascii_uppercase();
        let character = upper.chars().next().unwrap_or_default();
        if character.is_ascii_alphanumeric() {
            return Ok(upper);
        }
    }

    match key.to_ascii_lowercase().as_str() {
        "space" => Ok("Space".to_string()),
        "enter" | "return" => Ok("Enter".to_string()),
        "escape" | "esc" => Ok("Escape".to_string()),
        "tab" => Ok("Tab".to_string()),
        other => Err(format!("unsupported shortcut key: {other}")),
    }
}
