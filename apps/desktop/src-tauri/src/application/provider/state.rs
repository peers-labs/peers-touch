use crate::infrastructure::storage::{
    app_file_path, resolve_user_scope, write_string_atomic, StorageKind,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

fn expand_env_vars(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find("${") {
        result.push_str(&rest[..start]);
        let after_start = &rest[start + 2..];
        match after_start.find('}') {
            Some(end) => {
                let expr = &after_start[..end];
                let (var_name, default_val) = match expr.find(":-") {
                    Some(sep) => (&expr[..sep], Some(&expr[sep + 2..])),
                    None => (expr, None),
                };
                match std::env::var(var_name) {
                    Ok(val) if !val.is_empty() => result.push_str(&val),
                    _ => {
                        if let Some(dv) = default_val {
                            result.push_str(dv);
                        } else {
                            tracing::warn!(var = %var_name, "env var not set, resolved to empty");
                        }
                    }
                }
                rest = &after_start[end + 1..];
            }
            None => {
                result.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    result.push_str(rest);
    result
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct ModelRecord {
    pub(crate) id: String,
    pub(crate) display_name: String,
    pub(crate) r#type: String,
    pub(crate) enabled: bool,
    pub(crate) context_window: u32,
    pub(crate) function_call: bool,
    pub(crate) vision: bool,
    pub(crate) reasoning: bool,
    pub(crate) search: bool,
    pub(crate) image_output: bool,
    pub(crate) video: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) protocol_override: Option<String>,
}

impl ModelRecord {
    pub(crate) fn to_json(&self) -> serde_json::Value {
        let mut value = json!({
            "id": self.id,
            "display_name": self.display_name,
            "type": self.r#type,
            "enabled": self.enabled,
            "context_window": self.context_window,
            "function_call": self.function_call,
            "vision": self.vision,
            "reasoning": self.reasoning,
            "search": self.search,
            "image_output": self.image_output,
            "video": self.video
        });
        if let Some(protocol) = &self.protocol_override {
            value["protocol_override"] = serde_json::Value::String(protocol.clone());
        }
        value
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct ProviderRecord {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) logo: String,
    pub(crate) enabled: bool,
    pub(crate) key_vaults: String,
    pub(crate) config_json: String,
    pub(crate) check_model: String,
    pub(crate) models: Vec<ModelRecord>,
    pub(crate) builtin: bool,
    pub(crate) show_checker: bool,
    #[serde(default = "default_true")]
    pub(crate) show_api_key: bool,
}

fn default_true() -> bool {
    true
}

impl ProviderRecord {
    pub(crate) fn to_json(&self) -> serde_json::Value {
        json!({
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "logo": self.logo,
            "enabled": self.enabled,
            "builtin": self.builtin,
            "show_checker": self.show_checker,
            "show_api_key": self.show_api_key,
            "key_vaults": self.key_vaults,
            "config_json": self.config_json,
            "check_model": self.check_model,
            "models": self.models.iter().map(ModelRecord::to_json).collect::<Vec<_>>()
        })
    }
}

#[derive(Clone, Default)]
pub(crate) struct ProviderStore {
    pub(crate) providers: Vec<ProviderRecord>,
}

pub(crate) const DEFAULT_PROVIDER_SCOPE: &str = "__default__";

#[derive(Deserialize)]
struct ProviderPresetRoot {
    providers: Vec<ProviderPreset>,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct ProviderOverrideFile {
    #[serde(default)]
    pub(crate) revision: u64,
    #[serde(default, alias = "providers")]
    pub(crate) provider_overrides: Vec<ProviderRecord>,
    #[serde(default)]
    pub(crate) tombstones: Vec<String>,
}

#[derive(Deserialize)]
struct ProviderPreset {
    id: String,
    name: String,
    description: String,
    enabled: bool,
    builtin: bool,
    show_checker: bool,
    #[serde(default = "default_true")]
    show_api_key: bool,
    protocol: String,
    discovery: String,
    home_url: String,
    api_key_url: String,
    default_base_url: String,
    #[serde(default)]
    api_key: String,
    models: Vec<ModelPreset>,
}

#[derive(Deserialize)]
struct ModelPreset {
    id: String,
    display_name: String,
    #[serde(rename = "type")]
    model_type: String,
    enabled: bool,
    context_window: u32,
}

impl ProviderStore {
    fn seeded() -> Self {
        let raw = include_str!("providers.default.yaml");
        let expanded = expand_env_vars(raw);
        let parsed = serde_yaml::from_str::<ProviderPresetRoot>(&expanded);
        let Ok(root) = parsed else {
            tracing::error!("Failed to parse provider presets YAML");
            return Self { providers: vec![] };
        };
        let providers = root
            .providers
            .into_iter()
            .map(|preset| {
                let models = preset
                    .models
                    .into_iter()
                    .map(|model| ModelRecord {
                        id: model.id,
                        display_name: model.display_name,
                        r#type: model.model_type,
                        enabled: model.enabled,
                        context_window: model.context_window,
                        function_call: false,
                        vision: false,
                        reasoning: false,
                        search: false,
                        image_output: false,
                        video: false,
                        protocol_override: None,
                    })
                    .collect::<Vec<_>>();
                let check_model = models
                    .iter()
                    .find(|model| model.enabled)
                    .map(|model| model.id.clone())
                    .or_else(|| models.first().map(|model| model.id.clone()))
                    .unwrap_or_else(|| "default".to_string());
                let config_json = json!({
                    "base_url": preset.default_base_url,
                    "default_model": check_model,
                    "protocol": preset.protocol,
                    "discovery": preset.discovery,
                    "home_url": preset.home_url,
                    "api_key_url": preset.api_key_url
                })
                .to_string();
                let key_vaults = if preset.api_key.is_empty() {
                    "{\"api_key\":\"\"}".to_string()
                } else {
                    json!({ "api_key": preset.api_key }).to_string()
                };
                ProviderRecord {
                    id: preset.id.clone(),
                    name: preset.name,
                    description: preset.description,
                    logo: "".to_string(),
                    enabled: preset.enabled,
                    key_vaults,
                    config_json,
                    check_model,
                    models,
                    builtin: preset.builtin,
                    show_checker: preset.show_checker,
                    show_api_key: preset.show_api_key,
                }
            })
            .collect::<Vec<_>>();
        tracing::info!(count = providers.len(), "Provider store seeded");
        Self { providers }
    }
}

fn scope_override_path(scope: &str) -> PathBuf {
    let scope = resolve_user_scope(Some(scope));
    app_file_path(
        "desktop",
        StorageKind::Config,
        &["providers", "users", &scope, "override.yaml"],
    )
    .unwrap_or_else(|_| PathBuf::from(format!("providers.users.{scope}.override.yaml")))
}

fn load_scope_store(scope: &str) -> (ProviderStore, u64) {
    let path = scope_override_path(scope);
    if !path.exists() {
        return (ProviderStore::seeded(), 0);
    }
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return (ProviderStore::seeded(), 0),
    };
    let parsed = match serde_yaml::from_str::<ProviderOverrideFile>(&raw) {
        Ok(parsed) => parsed,
        Err(_) => return (ProviderStore::seeded(), 0),
    };
    let merged = apply_scope_override(
        ProviderStore::seeded(),
        &parsed.provider_overrides,
        &parsed.tombstones,
    );
    (merged, parsed.revision)
}

fn write_scope_store(scope: &str, store: &ProviderStore, revision: u64) -> Result<(), ()> {
    let mut payload = compute_scope_override(store);
    payload.revision = revision;
    let serialized = serde_yaml::to_string(&payload).map_err(|_| ())?;
    let path = scope_override_path(scope);
    write_string_atomic(&path, &serialized).map_err(|_| ())
}

pub(crate) fn apply_scope_override(
    mut seeded: ProviderStore,
    provider_overrides: &[ProviderRecord],
    tombstones: &[String],
) -> ProviderStore {
    if !tombstones.is_empty() {
        seeded
            .providers
            .retain(|provider| !tombstones.iter().any(|id| id == &provider.id));
    }
    for override_provider in provider_overrides {
        if let Some(existing) = seeded
            .providers
            .iter_mut()
            .find(|provider| provider.id == override_provider.id)
        {
            *existing = override_provider.clone();
            continue;
        }
        seeded.providers.push(override_provider.clone());
    }
    seeded
}

pub(crate) fn compute_scope_override(store: &ProviderStore) -> ProviderOverrideFile {
    let seeded = ProviderStore::seeded();
    let mut provider_overrides = Vec::new();
    for provider in &store.providers {
        let from_seed = seeded
            .providers
            .iter()
            .find(|seed_provider| seed_provider.id == provider.id);
        match from_seed {
            Some(seed_provider) if seed_provider == provider => {}
            _ => provider_overrides.push(provider.clone()),
        }
    }
    let tombstones = seeded
        .providers
        .iter()
        .filter(|seed_provider| {
            !store
                .providers
                .iter()
                .any(|provider| provider.id == seed_provider.id)
        })
        .map(|provider| provider.id.clone())
        .collect::<Vec<_>>();
    ProviderOverrideFile {
        revision: 0,
        provider_overrides,
        tombstones,
    }
}

#[derive(Default)]
struct ProviderStoreRegistry {
    stores: HashMap<String, ProviderStore>,
    revisions: HashMap<String, u64>,
}

impl ProviderStoreRegistry {
    fn ensure_scope(&mut self, scope: &str) -> &mut ProviderStore {
        if !self.stores.contains_key(scope) {
            let (store, revision) = load_scope_store(scope);
            self.stores.insert(scope.to_string(), store);
            self.revisions.insert(scope.to_string(), revision);
        }
        self.stores
            .get_mut(scope)
            .expect("scope store should exist after ensure")
    }

    fn persist_scope(&mut self, scope: &str) -> Result<(), ()> {
        let store = self.stores.get(scope).cloned().ok_or(())?;
        let next_revision = self
            .revisions
            .get(scope)
            .copied()
            .unwrap_or(0)
            .saturating_add(1);
        write_scope_store(scope, &store, next_revision)?;
        self.revisions.insert(scope.to_string(), next_revision);
        Ok(())
    }
}

static PROVIDER_STORE_REGISTRY: OnceLock<Mutex<ProviderStoreRegistry>> = OnceLock::new();

fn provider_store_registry() -> &'static Mutex<ProviderStoreRegistry> {
    PROVIDER_STORE_REGISTRY.get_or_init(|| Mutex::new(ProviderStoreRegistry::default()))
}

pub(crate) fn resolve_scope(scope: Option<&str>) -> String {
    let raw = scope.unwrap_or(DEFAULT_PROVIDER_SCOPE).trim();
    if raw.is_empty() {
        return DEFAULT_PROVIDER_SCOPE.to_string();
    }
    raw.to_string()
}

pub(crate) fn with_provider_store<R>(
    scope: Option<&str>,
    operation: impl FnOnce(&mut ProviderStore) -> R,
) -> Result<R, ()> {
    let scope_key = resolve_scope(scope);
    tracing::debug!(scope = %scope_key, "Accessing provider store");
    let mut guard = provider_store_registry().lock().map_err(|_| {
        tracing::error!("Failed to acquire provider store lock");
    })?;
    let store = guard.ensure_scope(&scope_key);
    Ok(operation(store))
}

pub(crate) fn find_seeded_provider(provider_id: &str) -> Option<ProviderRecord> {
    let seeded = ProviderStore::seeded();
    seeded
        .providers
        .into_iter()
        .find(|provider| provider.id == provider_id)
}

pub(crate) fn persist_provider_store(scope: Option<&str>) -> Result<(), ()> {
    let mut guard = provider_store_registry().lock().map_err(|_| ())?;
    let scope_key = resolve_scope(scope);
    guard.ensure_scope(&scope_key);
    guard.persist_scope(&scope_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeded_store_should_include_extended_provider_presets() {
        let seeded = ProviderStore::seeded();
        let required = ["openrouter", "mistral", "groq", "together", "cohere"];
        for provider_id in required {
            let exists = seeded
                .providers
                .iter()
                .any(|provider| provider.id == provider_id);
            assert!(exists);
        }
    }

    #[test]
    fn should_generate_tombstone_for_deleted_seed_provider() {
        let mut store = ProviderStore::seeded();
        store.providers.retain(|provider| provider.id != "openai");
        let override_file = compute_scope_override(&store);
        assert!(override_file.tombstones.iter().any(|id| id == "openai"));
        let merged = apply_scope_override(
            ProviderStore::seeded(),
            &override_file.provider_overrides,
            &override_file.tombstones,
        );
        let has_openai = merged
            .providers
            .iter()
            .any(|provider| provider.id == "openai");
        assert!(!has_openai);
    }

    #[test]
    fn model_to_json_should_include_protocol_override_when_set() {
        let model = ModelRecord {
            id: "test-model".to_string(),
            display_name: "Test".to_string(),
            r#type: "chat".to_string(),
            enabled: true,
            context_window: 4096,
            function_call: false,
            vision: false,
            reasoning: false,
            search: false,
            image_output: false,
            video: false,
            protocol_override: Some("anthropic".to_string()),
        };
        let output = model.to_json();
        assert_eq!(output["protocol_override"], "anthropic");
    }

    #[test]
    fn model_to_json_should_omit_protocol_override_when_none() {
        let model = ModelRecord {
            id: "test-model".to_string(),
            display_name: "Test".to_string(),
            r#type: "chat".to_string(),
            enabled: true,
            context_window: 4096,
            function_call: false,
            vision: false,
            reasoning: false,
            search: false,
            image_output: false,
            video: false,
            protocol_override: None,
        };
        let output = model.to_json();
        assert!(output.get("protocol_override").is_none());
    }
}
