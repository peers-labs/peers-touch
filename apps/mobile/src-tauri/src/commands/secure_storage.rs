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
    storage.set(&key, &value)
}

#[tauri::command]
pub fn secure_storage_get(
    storage: State<'_, SecureStorage>,
    key: String,
) -> MobileResult<Option<String>> {
    validate_key(&key)?;
    storage.get(&key)
}

#[tauri::command]
pub fn secure_storage_remove(storage: State<'_, SecureStorage>, key: String) -> MobileResult<()> {
    validate_key(&key)?;
    storage.remove(&key)
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

    Ok(())
}
