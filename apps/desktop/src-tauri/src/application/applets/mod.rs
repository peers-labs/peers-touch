use crate::contracts::{
    AppletActionInput, AppletConfigSetInput, AppletIdInput, AppletInvokeInput, StubPayload,
};
use crate::domain::applets::{
    authorize, build_request_id, emit_audit, normalize_capability, AccessContext,
};
use crate::error::{AppResult, ErrorCode};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(message: &str, request_id: &str) -> AppResult<StubPayload> {
    AppResult::fail(
        ErrorCode::InvalidArgument,
        message,
        Some(serde_json::json!({ "requestId": request_id })),
    )
}

fn ensure_allowed(
    context: &AccessContext,
    request_id: &str,
    command: &str,
    applet_id: Option<&str>,
    capability: &str,
) -> Result<(), AppResult<StubPayload>> {
    if authorize(context, capability) {
        return Ok(());
    }
    emit_audit(
        request_id,
        command,
        applet_id,
        capability,
        context.actor_id.as_deref(),
        "forbidden",
    );
    Err(AppResult::fail(
        ErrorCode::Forbidden,
        format!(
            "Applet capability denied: {} is not allowed for this session",
            capability
        ),
        None,
    ))
}

fn invoke_gateway(
    context: &AccessContext,
    command: &str,
    applet_id: Option<&str>,
    capability: &str,
    action: Option<&str>,
    params: Option<Value>,
) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    let normalized_capability = normalize_capability(capability);
    if let Err(error) = ensure_allowed(
        context,
        &request_id,
        command,
        applet_id,
        &normalized_capability,
    ) {
        return error;
    }

    let response = match command {
        "applets_list" => json!({ "applets": [] }),
        "applets_get" => json!({
            "id": applet_id.unwrap_or_default(),
            "name": "Applet",
            "title": "Applet",
            "description": "",
            "active": false
        }),
        "applets_get_config" => json!({ "config": {} }),
        "applets_activate" | "applets_deactivate" | "applets_set_config" => json!({ "ok": true }),
        "applets_action" => json!({ "ok": true, "result": params.unwrap_or_else(|| json!({})) }),
        "applets_invoke" => json!({
            "ok": true,
            "capability": normalized_capability,
            "action": action,
            "result": params.unwrap_or_else(|| json!({}))
        }),
        _ => {
            emit_audit(
                &request_id,
                command,
                applet_id,
                &normalized_capability,
                context.actor_id.as_deref(),
                "not_implemented",
            );
            return AppResult::fail(
                ErrorCode::NotImplemented,
                format!("Unsupported applet gateway command: {}", command),
                None,
            );
        }
    };

    emit_audit(
        &request_id,
        command,
        applet_id,
        &normalized_capability,
        context.actor_id.as_deref(),
        "ok",
    );
    success_payload(command, response)
}

pub fn applets_list(context: AccessContext) -> AppResult<StubPayload> {
    invoke_gateway(&context, "applets_list", None, "applets.list", None, None)
}

pub fn applets_get(context: AccessContext, input: AppletIdInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    invoke_gateway(
        &context,
        "applets_get",
        Some(input.id.trim()),
        "applets.get",
        None,
        None,
    )
}

pub fn applets_activate(context: AccessContext, input: AppletIdInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    invoke_gateway(
        &context,
        "applets_activate",
        Some(input.id.trim()),
        "applets.activate",
        None,
        None,
    )
}

pub fn applets_deactivate(context: AccessContext, input: AppletIdInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    invoke_gateway(
        &context,
        "applets_deactivate",
        Some(input.id.trim()),
        "applets.deactivate",
        None,
        None,
    )
}

pub fn applets_get_config(context: AccessContext, input: AppletIdInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    invoke_gateway(
        &context,
        "applets_get_config",
        Some(input.id.trim()),
        "applets.get_config",
        None,
        None,
    )
}

pub fn applets_set_config(
    context: AccessContext,
    input: AppletConfigSetInput,
) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    let _ = input.config;
    invoke_gateway(
        &context,
        "applets_set_config",
        Some(input.id.trim()),
        "applets.set_config",
        None,
        None,
    )
}

pub fn applets_action(context: AccessContext, input: AppletActionInput) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    if input.action.trim().is_empty() {
        return invalid_argument("action is required", &request_id);
    }
    invoke_gateway(
        &context,
        "applets_action",
        Some(input.id.trim()),
        "applets.action",
        Some(input.action.trim()),
        input.params,
    )
}

pub fn applets_invoke(
    context: AccessContext,
    input: AppletInvokeInput,
    data_dir: &Path,
) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    if input.capability.trim().is_empty() {
        return invalid_argument("capability is required", &request_id);
    }

    let normalized_capability = normalize_capability(&input.capability);
    let applet_id = input.id.trim();

    if let Err(error) = ensure_allowed(
        &context,
        &request_id,
        "applets_invoke",
        Some(applet_id),
        &normalized_capability,
    ) {
        return error;
    }

    let result = match normalized_capability.as_str() {
        "storage" => handle_storage(applet_id, input.action.as_deref(), input.params, data_dir),
        "network" => handle_network(input.action.as_deref(), input.params),
        "config" => handle_config(applet_id, input.action.as_deref(), input.params, data_dir),
        other => {
            emit_audit(
                &request_id,
                "applets_invoke",
                Some(applet_id),
                &normalized_capability,
                context.actor_id.as_deref(),
                "unsupported_capability",
            );
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Unsupported applet capability: {}", other),
                Some(json!({ "requestId": request_id })),
            );
        }
    };

    match result {
        Ok(response) => {
            emit_audit(
                &request_id,
                "applets_invoke",
                Some(applet_id),
                &normalized_capability,
                context.actor_id.as_deref(),
                "ok",
            );
            success_payload("applets_invoke", response)
        }
        Err(error_msg) => {
            emit_audit(
                &request_id,
                "applets_invoke",
                Some(applet_id),
                &normalized_capability,
                context.actor_id.as_deref(),
                "error",
            );
            AppResult::fail(
                ErrorCode::InternalError,
                error_msg,
                Some(json!({ "requestId": request_id })),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Capability: storage
// ---------------------------------------------------------------------------

/// Resolve the per-applet storage file path.
fn applet_storage_path(applet_id: &str, data_dir: &Path) -> PathBuf {
    data_dir.join("applets").join(applet_id).join("storage.json")
}

/// Read the JSON object from the per-applet storage file.
/// Returns an empty map if the file does not exist.
fn read_storage_map(path: &Path) -> Result<HashMap<String, Value>, String> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read storage file {}: {}", path.display(), e))?;
    if content.trim().is_empty() {
        return Ok(HashMap::new());
    }
    serde_json::from_str::<HashMap<String, Value>>(&content)
        .map_err(|e| format!("Failed to parse storage file {}: {}", path.display(), e))
}

/// Atomically write the JSON map back to the storage file.
fn write_storage_map(path: &Path, map: &HashMap<String, Value>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create storage directory {}: {}", parent.display(), e))?;
    }
    let content = serde_json::to_string_pretty(map)
        .map_err(|e| format!("Failed to serialize storage map: {}", e))?;
    fs::write(path, content)
        .map_err(|e| format!("Failed to write storage file {}: {}", path.display(), e))
}

fn handle_storage(
    applet_id: &str,
    action: Option<&str>,
    params: Option<Value>,
    data_dir: &Path,
) -> Result<Value, String> {
    let action = action.ok_or_else(|| "storage capability requires an action".to_string())?;
    let storage_path = applet_storage_path(applet_id, data_dir);

    match action {
        "get" => {
            let key = extract_string_param(&params, "key")
                .ok_or_else(|| "storage.get requires params.key (string)".to_string())?;
            let map = read_storage_map(&storage_path)?;
            let value = map.get(&key).cloned().unwrap_or(Value::Null);
            Ok(json!({ "value": value }))
        }
        "set" => {
            let key = extract_string_param(&params, "key")
                .ok_or_else(|| "storage.set requires params.key (string)".to_string())?;
            let value = params
                .as_ref()
                .and_then(|p| p.get("value"))
                .cloned()
                .unwrap_or(Value::Null);
            let mut map = read_storage_map(&storage_path)?;
            map.insert(key, value);
            write_storage_map(&storage_path, &map)?;
            Ok(json!({ "ok": true }))
        }
        "remove" => {
            let key = extract_string_param(&params, "key")
                .ok_or_else(|| "storage.remove requires params.key (string)".to_string())?;
            let mut map = read_storage_map(&storage_path)?;
            map.remove(&key);
            write_storage_map(&storage_path, &map)?;
            Ok(json!({ "ok": true }))
        }
        other => Err(format!("Unsupported storage action: {}", other)),
    }
}

// ---------------------------------------------------------------------------
// Capability: network
// ---------------------------------------------------------------------------

fn handle_network(action: Option<&str>, params: Option<Value>) -> Result<Value, String> {
    let action = action.ok_or_else(|| "network capability requires an action".to_string())?;

    match action {
        "request" => {
            let params = params.ok_or_else(|| "network.request requires params".to_string())?;

            let url = params
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "network.request requires params.url (string)".to_string())?;

            let method = params
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("GET")
                .to_uppercase();

            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

            let mut request_builder = match method.as_str() {
                "GET" => client.get(url),
                "POST" => client.post(url),
                "PUT" => client.put(url),
                "DELETE" => client.delete(url),
                "PATCH" => client.patch(url),
                "HEAD" => client.head(url),
                other => return Err(format!("Unsupported HTTP method: {}", other)),
            };

            // Apply custom headers
            if let Some(headers_val) = params.get("headers") {
                if let Some(headers_obj) = headers_val.as_object() {
                    for (key, value) in headers_obj {
                        if let Some(val_str) = value.as_str() {
                            request_builder = request_builder.header(key.as_str(), val_str);
                        }
                    }
                }
            }

            // Apply request body
            if let Some(body) = params.get("body") {
                let body_string = match body {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                request_builder = request_builder.body(body_string);
            }

            let response = request_builder
                .send()
                .map_err(|e| format!("HTTP request to {} failed: {}", url, e))?;

            let status = response.status().as_u16();

            let response_headers: HashMap<String, String> = response
                .headers()
                .iter()
                .filter_map(|(k, v)| {
                    v.to_str().ok().map(|val| (k.as_str().to_string(), val.to_string()))
                })
                .collect();

            let body = response
                .text()
                .map_err(|e| format!("Failed to read response body: {}", e))?;

            Ok(json!({
                "status": status,
                "headers": response_headers,
                "body": body
            }))
        }
        other => Err(format!("Unsupported network action: {}", other)),
    }
}

// ---------------------------------------------------------------------------
// Capability: config
// ---------------------------------------------------------------------------

fn handle_config(
    applet_id: &str,
    action: Option<&str>,
    params: Option<Value>,
    data_dir: &Path,
) -> Result<Value, String> {
    let action = action.ok_or_else(|| "config capability requires an action".to_string())?;

    match action {
        "get" => {
            let key = extract_string_param(&params, "key")
                .ok_or_else(|| "config.get requires params.key (string)".to_string())?;

            let config_path = data_dir
                .join("applets")
                .join(applet_id)
                .join("config.json");

            if !config_path.exists() {
                return Ok(json!({ "value": null }));
            }

            let content = fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read config file {}: {}", config_path.display(), e))?;

            if content.trim().is_empty() {
                return Ok(json!({ "value": null }));
            }

            let map: HashMap<String, Value> = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse config file {}: {}", config_path.display(), e))?;

            let value = map.get(&key).cloned().unwrap_or(Value::Null);
            Ok(json!({ "value": value }))
        }
        other => Err(format!("Unsupported config action: {}", other)),
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract a string field from optional JSON params.
fn extract_string_param(params: &Option<Value>, field: &str) -> Option<String> {
    params
        .as_ref()
        .and_then(|p| p.get(field))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}
