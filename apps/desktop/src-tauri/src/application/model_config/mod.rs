use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{ModelConfigKeyInput, ModelConfigSetInput, ProviderIdInputV2, StubPayload};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

#[derive(Default)]
struct ModelConfigStore {
    config: HashMap<String, Value>,
}

impl ModelConfigStore {
    fn seeded() -> Self {
        let mut config = HashMap::new();
        config.insert(
            "default".to_string(),
            json!({
                "provider":"openai-default",
                "model":"gpt-4o-mini"
            }),
        );
        Self { config }
    }
}

static MODEL_CONFIG_STORE: OnceLock<Mutex<ModelConfigStore>> = OnceLock::new();

fn model_config_store() -> &'static Mutex<ModelConfigStore> {
    MODEL_CONFIG_STORE.get_or_init(|| Mutex::new(ModelConfigStore::seeded()))
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
    AppResult::fail(ErrorCode::InternalError, "failed to access model config store", None)
}

pub fn model_config_list() -> AppResult<StubPayload> {
    let guard = match model_config_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    success_payload("model_config_list", json!({ "config": guard.config }))
}

pub fn model_config_get(input: ModelConfigKeyInput) -> AppResult<StubPayload> {
    let key = input.key.trim();
    if key.is_empty() {
        return invalid_argument("key is required");
    }
    let guard = match model_config_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let value = guard.config.get(key).cloned();
    success_payload("model_config_get", json!({ "key": key, "ref": value, "resolved": value }))
}

pub fn model_config_set(input: ModelConfigSetInput) -> AppResult<StubPayload> {
    let key = input.key.trim().to_string();
    if key.is_empty() {
        return invalid_argument("key is required");
    }
    let mut guard = match model_config_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    if let Some(value) = input.r#ref {
        guard.config.insert(key.clone(), value.clone());
        return success_payload("model_config_set", json!({ "key": key, "ref": value }));
    }
    guard.config.remove(&key);
    success_payload("model_config_set", json!({ "key": key, "ref": Value::Null }))
}

pub fn model_config_delete(input: ModelConfigKeyInput) -> AppResult<StubPayload> {
    let key = input.key.trim().to_string();
    if key.is_empty() {
        return invalid_argument("key is required");
    }
    let mut guard = match model_config_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let deleted = guard.config.remove(&key).is_some();
    success_payload("model_config_delete", json!({ "ok": deleted }))
}

pub fn model_config_provider_references(input: ProviderIdInputV2) -> AppResult<StubPayload> {
    let provider_id = input.provider_id.trim();
    if provider_id.is_empty() {
        return invalid_argument("provider_id is required");
    }
    success_payload(
        "model_config_provider_references",
        json!({
            "references": [{
                "service":"chat",
                "key":"default",
                "provider":provider_id,
                "model":"gpt-4o-mini"
            }]
        }),
    )
}
