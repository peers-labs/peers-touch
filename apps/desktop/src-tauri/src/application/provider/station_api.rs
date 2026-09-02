use reqwest::Method;
use serde::{de::Error as _, Deserialize, Deserializer, Serialize};
use serde_json::{json, Value};

use crate::infrastructure::station_client::{self, StationClientError};

fn deserialize_proto_i64<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum ProtoI64 {
        Number(i64),
        String(String),
    }

    match ProtoI64::deserialize(deserializer)? {
        ProtoI64::Number(value) => Ok(value),
        ProtoI64::String(value) => value.parse().map_err(D::Error::custom),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StationProvider {
    pub id: String,
    #[serde(default)]
    pub actor_ptid: String,
    pub name: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub runtime_kind: String,
    pub enabled: bool,
    #[serde(default, deserialize_with = "deserialize_proto_i64")]
    pub version: i64,
    #[serde(default)]
    pub config: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StationModel {
    pub id: String,
    #[serde(default)]
    pub actor_ptid: String,
    pub provider_id: String,
    pub model_id: String,
    pub display_name: String,
    pub enabled: bool,
    #[serde(default, deserialize_with = "deserialize_proto_i64")]
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialStatus {
    pub provider_id: String,
    pub configured: bool,
    pub status: String,
    #[serde(default, deserialize_with = "deserialize_proto_i64")]
    pub version: i64,
}

#[derive(Debug, Clone)]
pub enum StationApiError {
    VersionConflict { current: i64, submitted: i64 },
    NotFound(String),
    Unauthorized,
    Network(String),
    Internal(String),
}

impl From<StationClientError> for StationApiError {
    fn from(e: StationClientError) -> Self {
        match e.kind {
            station_client::StationClientErrorKind::SessionRevoked => StationApiError::Unauthorized,
            station_client::StationClientErrorKind::HttpStatus(409) => {
                StationApiError::VersionConflict {
                    current: -1,
                    submitted: -1,
                }
            }
            station_client::StationClientErrorKind::HttpStatus(404) => {
                StationApiError::NotFound(e.message)
            }
            station_client::StationClientErrorKind::HttpStatus(401) => {
                StationApiError::Unauthorized
            }
            station_client::StationClientErrorKind::Network => StationApiError::Network(e.message),
            _ => StationApiError::Internal(e.message),
        }
    }
}

pub fn list_providers(token: &str) -> Result<Value, StationApiError> {
    Ok(station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/provider/list",
        token,
        None,
        Some(&json!({})),
    )?)
}

pub fn get_providers(token: &str, _scope: &str) -> Result<Vec<StationProvider>, StationApiError> {
    let resp = station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/provider/list",
        token,
        None,
        Some(&json!({})),
    )?;

    serde_json::from_value(
        resp.get("providers")
            .cloned()
            .unwrap_or(Value::Array(vec![])),
    )
    .map_err(|e| StationApiError::Internal(format!("decode providers: {}", e)))
}

pub fn get_provider(token: &str, provider_id: &str) -> Result<Value, StationApiError> {
    Ok(station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/provider/get",
        token,
        None,
        Some(&json!({"provider_id": provider_id})),
    )?)
}

pub fn list_available_models(token: &str) -> Result<Value, StationApiError> {
    Ok(station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/model/available",
        token,
        None,
        Some(&json!({})),
    )?)
}

pub fn update_provider_full(
    token: &str,
    provider_id: &str,
    enabled: bool,
    config_json: Option<&str>,
    key_vaults: Option<&str>,
    version: i64,
) -> Result<Value, StationApiError> {
    let mut body = json!({
        "provider_id": provider_id,
        "version": version,
        "enabled": enabled,
    });
    if let Some(cfg) = config_json {
        if let Ok(v) = serde_json::from_str::<Value>(cfg) {
            if let Some(base_url) = v.get("base_url").and_then(|u| u.as_str()) {
                body["base_url"] = json!(base_url);
            }
        }
    }
    if let Some(kv) = key_vaults {
        body["key_vaults"] = json!(kv);
    }

    Ok(station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/provider/update",
        token,
        None,
        Some(&body),
    )?)
}

pub fn create_model(
    token: &str,
    provider_id: &str,
    model_id: &str,
    display_name: &str,
    enabled: bool,
    context_window: i32,
) -> Result<Value, StationApiError> {
    let body = json!({
        "provider_id": provider_id,
        "model_id": model_id,
        "display_name": display_name,
        "enabled": enabled,
        "context_window": context_window,
    });
    Ok(station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/model/create",
        token,
        None,
        Some(&body),
    )?)
}

pub fn create_provider(
    token: &str,
    provider_id: &str,
    display_name: &str,
    base_url: &str,
    protocol: &str,
    config: Option<&Value>,
) -> Result<StationProvider, StationApiError> {
    let mut body = json!({
        "provider_id": provider_id,
        "display_name": display_name,
        "base_url": base_url,
        "protocol": protocol,
    });
    if let Some(cfg) = config {
        body["config_json"] = cfg.clone();
    }

    let resp = station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/provider/create",
        token,
        None,
        Some(&body),
    )?;

    parse_provider_from_response(resp)
}

pub fn update_provider(
    token: &str,
    provider_id: &str,
    version: i64,
    display_name: Option<&str>,
    base_url: Option<&str>,
    enabled: Option<bool>,
    config: Option<&Value>,
) -> Result<StationProvider, StationApiError> {
    let mut body = json!({
        "provider_id": provider_id,
        "version": version,
    });
    if let Some(v) = display_name {
        body["display_name"] = json!(v);
    }
    if let Some(v) = base_url {
        body["base_url"] = json!(v);
    }
    if let Some(v) = enabled {
        body["enabled"] = json!(v);
    }
    if let Some(v) = config {
        body["config_json"] = v.clone();
    }

    let resp = station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/provider/update",
        token,
        None,
        Some(&body),
    )?;

    parse_provider_from_response(resp)
}

pub fn delete_provider(
    token: &str,
    provider_id: &str,
    version: i64,
) -> Result<(), StationApiError> {
    station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/provider/delete",
        token,
        None,
        Some(&json!({
            "provider_id": provider_id,
            "version": version,
        })),
    )?;
    Ok(())
}

pub fn list_models(token: &str, provider_id: &str) -> Result<Vec<StationModel>, StationApiError> {
    let resp = station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/model/list",
        token,
        None,
        Some(&json!({"provider_id": provider_id})),
    )?;

    let models: Vec<StationModel> =
        serde_json::from_value(resp.get("models").cloned().unwrap_or(Value::Array(vec![])))
            .unwrap_or_default();

    Ok(models)
}

pub fn update_model(
    token: &str,
    provider_id: &str,
    model_id: &str,
    version: i64,
    display_name: Option<&str>,
    enabled: Option<bool>,
) -> Result<StationModel, StationApiError> {
    let mut body = json!({
        "provider_id": provider_id,
        "model_id": model_id,
        "version": version,
    });
    if let Some(v) = display_name {
        body["display_name"] = json!(v);
    }
    if let Some(v) = enabled {
        body["enabled"] = json!(v);
    }

    let resp = station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/model/update",
        token,
        None,
        Some(&body),
    )?;

    let model: StationModel =
        serde_json::from_value(resp.get("model").cloned().unwrap_or_default())
            .map_err(|e| StationApiError::Internal(format!("decode model: {}", e)))?;

    Ok(model)
}

pub fn set_credential(
    token: &str,
    provider_id: &str,
    api_key: &str,
) -> Result<CredentialStatus, StationApiError> {
    let resp = station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/credential/set",
        token,
        None,
        Some(&json!({
            "provider_id": provider_id,
            "api_key": api_key,
        })),
    )?;

    serde_json::from_value(resp.get("status").cloned().unwrap_or_default())
        .map_err(|e| StationApiError::Internal(format!("decode credential status: {}", e)))
}

pub fn delete_credential(
    token: &str,
    provider_id: &str,
    version: i64,
) -> Result<(), StationApiError> {
    station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/credential/delete",
        token,
        None,
        Some(&json!({
            "provider_id": provider_id,
            "version": version,
        })),
    )?;
    Ok(())
}

pub fn credential_status(
    token: &str,
    provider_id: &str,
) -> Result<CredentialStatus, StationApiError> {
    let resp = station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/credential/status",
        token,
        None,
        Some(&json!({"provider_id": provider_id})),
    )?;

    serde_json::from_value(resp.get("status").cloned().unwrap_or_default())
        .map_err(|e| StationApiError::Internal(format!("decode credential status: {}", e)))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedCredential {
    pub provider_id: String,
    pub api_key: String,
    pub base_url: String,
    pub protocol: String,
}

pub fn resolve_credential(
    token: &str,
    provider_id: &str,
) -> Result<ResolvedCredential, StationApiError> {
    let resp = station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/credential/resolve",
        token,
        None,
        Some(&json!({"provider_id": provider_id})),
    )?;

    serde_json::from_value(resp.get("credential").cloned().unwrap_or_default())
        .map_err(|e| StationApiError::Internal(format!("decode resolved credential: {}", e)))
}

fn parse_provider_from_response(resp: Value) -> Result<StationProvider, StationApiError> {
    serde_json::from_value(resp.get("provider").cloned().unwrap_or_default())
        .map_err(|e| StationApiError::Internal(format!("decode provider: {}", e)))
}

pub fn hide_model(token: &str, provider_id: &str, model_id: &str) -> Result<(), StationApiError> {
    station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/provider/model/hide",
        token,
        None,
        Some(&json!({ "provider_id": provider_id, "model_id": model_id })),
    )?;
    Ok(())
}

pub fn get_hidden_models(token: &str, provider_id: &str) -> Result<Vec<String>, StationApiError> {
    let resp = station_client::request_json_auth(
        Method::POST,
        "/sub-agent/agent/provider/model/hidden",
        token,
        None,
        Some(&json!({ "provider_id": provider_id })),
    )?;

    let hidden: Vec<String> = serde_json::from_value(
        resp.get("hidden_models")
            .cloned()
            .unwrap_or(Value::Array(vec![])),
    )
    .unwrap_or_default();

    Ok(hidden)
}
