use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{ProviderCheckInput, ProviderCreateInput, ProviderIdInput, ProviderUpdateInput, StubPayload};
use serde_json::json;
use std::sync::{Mutex, OnceLock};

#[derive(Clone)]
struct ProviderRecord {
    id: String,
    name: String,
    description: String,
    logo: String,
    enabled: bool,
    key_vaults: String,
    config_json: String,
    check_model: String,
}

impl ProviderRecord {
    fn to_json(&self) -> serde_json::Value {
        json!({
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "logo": self.logo,
            "enabled": self.enabled,
            "key_vaults": self.key_vaults,
            "config_json": self.config_json,
            "check_model": self.check_model
        })
    }
}

#[derive(Default)]
struct ProviderStore {
    providers: Vec<ProviderRecord>,
}

impl ProviderStore {
    fn seeded() -> Self {
        Self {
            providers: vec![ProviderRecord {
                id: "openai-default".to_string(),
                name: "OpenAI".to_string(),
                description: "Default provider".to_string(),
                logo: "".to_string(),
                enabled: true,
                key_vaults: "{\"api_key\":\"\"}".to_string(),
                config_json: "{\"base_url\":\"https://api.openai.com/v1\",\"default_model\":\"gpt-4o-mini\"}".to_string(),
                check_model: "gpt-4o-mini".to_string(),
            }],
        }
    }
}

static PROVIDER_STORE: OnceLock<Mutex<ProviderStore>> = OnceLock::new();

fn provider_store() -> &'static Mutex<ProviderStore> {
    PROVIDER_STORE.get_or_init(|| Mutex::new(ProviderStore::seeded()))
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
    AppResult::fail(ErrorCode::InternalError, "failed to access provider store", None)
}

pub fn provider_list() -> AppResult<StubPayload> {
    let guard = match provider_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let providers = guard.providers.iter().map(ProviderRecord::to_json).collect::<Vec<_>>();
    success_payload(
        "provider_list",
        json!({
            "providers": providers,
            "total": providers.len()
        }),
    )
}

pub fn provider_get(input: ProviderIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let guard = match provider_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    if let Some(provider) = guard.providers.iter().find(|provider| provider.id == id) {
        return success_payload("provider_get", json!({ "provider": provider.to_json() }));
    }
    AppResult::fail(ErrorCode::NotFound, "provider not found", None)
}

pub fn provider_update(input: ProviderUpdateInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match provider_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    if let Some(provider) = guard.providers.iter_mut().find(|provider| provider.id == id) {
        provider.enabled = input.enabled;
        if let Some(key_vaults) = input.key_vaults {
            provider.key_vaults = key_vaults;
        }
        if let Some(config_json) = input.config_json {
            provider.config_json = config_json;
        }
        return success_payload("provider_update", json!({ "provider": provider.to_json() }));
    }
    AppResult::fail(ErrorCode::NotFound, "provider not found", None)
}

pub fn provider_check(input: ProviderCheckInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    success_payload(
        "provider_check",
        json!({
            "ok": true,
            "message": format!("provider {} is reachable", id)
        }),
    )
}

pub fn provider_create(input: ProviderCreateInput) -> AppResult<StubPayload> {
    let name = input.name.trim();
    if name.is_empty() {
        return invalid_argument("name is required");
    }
    let mut guard = match provider_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let id = format!("provider-{}", guard.providers.len() + 1);
    let provider = ProviderRecord {
        id,
        name: name.to_string(),
        description: input.description,
        logo: input.logo,
        enabled: true,
        key_vaults: input.key_vaults,
        config_json: input.config_json,
        check_model: "default".to_string(),
    };
    guard.providers.push(provider.clone());
    success_payload("provider_create", json!({ "provider": provider.to_json() }))
}

pub fn provider_delete(input: ProviderIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    let mut guard = match provider_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let before = guard.providers.len();
    guard.providers.retain(|provider| provider.id != id);
    let deleted = before != guard.providers.len();
    success_payload("provider_delete", json!({ "success": deleted }))
}

pub fn provider_apply_preset(input: ProviderIdInput) -> AppResult<StubPayload> {
    let id = input.id.trim();
    if id.is_empty() {
        return invalid_argument("id is required");
    }
    success_payload(
        "provider_apply_preset",
        json!({
            "ok": true,
            "provider_id": id
        }),
    )
}

pub fn provider_list_available_models() -> AppResult<StubPayload> {
    let guard = match provider_store().lock() {
        Ok(guard) => guard,
        Err(_) => return internal_error(),
    };
    let providers = guard.providers.iter().map(ProviderRecord::to_json).collect::<Vec<_>>();
    success_payload("provider_list_available_models", json!({ "providers": providers }))
}
