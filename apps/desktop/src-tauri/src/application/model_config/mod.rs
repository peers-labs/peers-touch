use crate::contracts::{ModelConfigKeyInput, ModelConfigSetInput, ProviderIdInputV2, StubPayload};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::storage::{app_file_path, write_string_atomic, StorageKind};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

static MODEL_CONFIG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn model_config_lock() -> &'static Mutex<()> {
    MODEL_CONFIG_LOCK.get_or_init(|| Mutex::new(()))
}

fn load_config() -> Result<HashMap<String, Value>, ()> {
    let path =
        app_file_path("desktop", StorageKind::Config, &["model-registry.json"]).map_err(|_| ())?;
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|_| ()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(_) => Err(()),
    }
}

fn save_config(config: &HashMap<String, Value>) -> Result<(), ()> {
    let path =
        app_file_path("desktop", StorageKind::Config, &["model-registry.json"]).map_err(|_| ())?;
    let payload = serde_json::to_string(config).map_err(|_| ())?;
    write_string_atomic(&path, &payload).map_err(|_| ())
}

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

fn internal_error() -> AppResult<StubPayload> {
    AppResult::fail(
        ErrorCode::InternalError,
        "error.modelConfig.storeAccessFailed",
        None,
    )
}

pub fn model_config_list() -> AppResult<StubPayload> {
    let _guard = match model_config_lock().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let config = match load_config() {
        Ok(config) => config,
        Err(_) => return internal_error(),
    };
    success_payload("model_config_list", json!({ "config": config }))
}

pub fn model_config_get(input: ModelConfigKeyInput) -> AppResult<StubPayload> {
    let key = input.key.trim();
    if key.is_empty() {
        return invalid_argument("key is required");
    }
    let _guard = match model_config_lock().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let config = match load_config() {
        Ok(config) => config,
        Err(_) => return internal_error(),
    };
    let value = config.get(key).cloned();
    success_payload(
        "model_config_get",
        json!({ "key": key, "ref": value, "resolved": value }),
    )
}

pub fn model_config_set(input: ModelConfigSetInput) -> AppResult<StubPayload> {
    let key = input.key.trim().to_string();
    if key.is_empty() {
        return invalid_argument("key is required");
    }
    let _guard = match model_config_lock().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let mut config = match load_config() {
        Ok(config) => config,
        Err(_) => return internal_error(),
    };
    if let Some(value) = input.r#ref {
        if !value
            .get("provider")
            .and_then(Value::as_str)
            .is_some_and(|v| !v.trim().is_empty())
            || !value
                .get("model")
                .and_then(Value::as_str)
                .is_some_and(|v| !v.trim().is_empty())
        {
            return invalid_argument("Provider and model are required");
        }
        config.insert(key.clone(), value.clone());
        if save_config(&config).is_err() {
            return internal_error();
        }
        return success_payload("model_config_set", json!({ "key": key, "ref": value }));
    }
    config.remove(&key);
    if save_config(&config).is_err() {
        return internal_error();
    }
    success_payload(
        "model_config_set",
        json!({ "key": key, "ref": Value::Null }),
    )
}

pub fn model_config_delete(input: ModelConfigKeyInput) -> AppResult<StubPayload> {
    let key = input.key.trim().to_string();
    if key.is_empty() {
        return invalid_argument("key is required");
    }
    let _guard = match model_config_lock().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let mut config = match load_config() {
        Ok(config) => config,
        Err(_) => return internal_error(),
    };
    let deleted = config.remove(&key).is_some();
    if save_config(&config).is_err() {
        return internal_error();
    }
    success_payload("model_config_delete", json!({ "ok": deleted }))
}

pub fn model_config_provider_references(input: ProviderIdInputV2) -> AppResult<StubPayload> {
    let provider_id = input.provider_id.trim();
    if provider_id.is_empty() {
        return invalid_argument("provider_id is required");
    }
    let _guard = match model_config_lock().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let config = match load_config() {
        Ok(config) => config,
        Err(_) => return internal_error(),
    };
    let mut references: Vec<Value> = Vec::new();
    for (key, val) in config.iter() {
        let p = val.get("provider").and_then(|v| v.as_str()).unwrap_or("");
        if p == provider_id {
            let model = val.get("model").and_then(|v| v.as_str()).unwrap_or("");
            references.push(json!({
                "service": "chat",
                "key": key,
                "provider": provider_id,
                "model": model
            }));
        }
    }
    success_payload(
        "model_config_provider_references",
        json!({ "references": references }),
    )
}
