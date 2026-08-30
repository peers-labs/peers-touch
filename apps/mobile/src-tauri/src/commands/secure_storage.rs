use tauri::State;

use crate::error::MobileResult;
use crate::platform::secure_storage::SecureStorage;

#[tauri::command]
pub fn secure_storage_set(
    storage: State<'_, SecureStorage>,
    key: String,
    value: String,
) -> MobileResult<()> {
    validate_key(&key)?;
    storage.set(&key, &value).map_err(Into::into)
}

#[tauri::command]
pub fn secure_storage_get(
    storage: State<'_, SecureStorage>,
    key: String,
) -> MobileResult<Option<String>> {
    validate_key(&key)?;
    storage.get(&key).map_err(Into::into)
}

#[tauri::command]
pub fn secure_storage_remove(storage: State<'_, SecureStorage>, key: String) -> MobileResult<()> {
    validate_key(&key)?;
    storage.remove(&key).map_err(Into::into)
}

fn validate_key(key: &str) -> MobileResult<()> {
    if key.trim().is_empty() {
        return Err(crate::error::MobileError::invalid_input(
            "secure storage key must not be empty",
        ));
    }

    if !key
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.'))
    {
        return Err(crate::error::MobileError::invalid_input(
            "secure storage key may only contain ASCII letters, digits, dash, underscore, and dot",
        ));
    }
    if key.starts_with("oauth.") {
        return Err(crate::error::MobileError::invalid_input(
            "secure storage key belongs to a Rust-owned namespace",
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_storage_commands_cannot_address_native_oauth_records() {
        assert!(validate_key("mobile.storage.smoke").is_ok());
        assert!(validate_key("oauth.active.index").is_err());
        assert!(validate_key("oauth.session.scope").is_err());
    }
}
