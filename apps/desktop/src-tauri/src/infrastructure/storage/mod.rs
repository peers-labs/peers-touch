use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug)]
pub enum StorageError {
    ReadFailed(String),
    WriteFailed(String),
}

pub fn load_settings() -> Result<HashMap<String, Value>, StorageError> {
    let file_path = settings_file_path();
    if !file_path.exists() {
        return Ok(HashMap::new());
    }
    let raw = fs::read_to_string(file_path)
        .map_err(|error| StorageError::ReadFailed(error.to_string()))?;
    let parsed =
        serde_json::from_str::<HashMap<String, Value>>(&raw).map_err(|error| {
            StorageError::ReadFailed(error.to_string())
        })?;
    Ok(parsed)
}

pub fn save_settings(settings: &HashMap<String, Value>) -> Result<(), StorageError> {
    let file_path = settings_file_path();
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| StorageError::WriteFailed(error.to_string()))?;
    }
    let payload = serde_json::to_string(settings)
        .map_err(|error| StorageError::WriteFailed(error.to_string()))?;
    fs::write(file_path, payload).map_err(|error| StorageError::WriteFailed(error.to_string()))
}

fn settings_file_path() -> PathBuf {
    std::env::temp_dir()
        .join("peers-touch")
        .join("desktop")
        .join("settings.json")
}
