use crate::application::security::{is_secret_like_key, redact_json_value};
use crate::contracts::StubPayload;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::storage::{self, StorageKind};
use reqwest::{Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PluginManifest {
    #[serde(rename = "pluginId")]
    pub plugin_id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    #[serde(rename = "trustLevel")]
    pub trust_level: String,
    #[serde(rename = "riskLevel")]
    pub risk_level: String,
    pub source: String,
    pub tools: Vec<PluginToolManifest>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PluginToolManifest {
    pub name: String,
    pub description: String,
    pub schema: Value,
    pub runtime: PluginToolRuntime,
    #[serde(rename = "riskLevel")]
    pub risk_level: Option<String>,
    #[serde(rename = "needsApproval")]
    pub needs_approval: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
#[serde(rename_all = "camelCase")]
pub enum PluginToolRuntime {
    #[serde(rename = "static")]
    Static { response: Value },
    #[serde(rename = "http")]
    Http {
        url: String,
        method: Option<String>,
        headers: Option<HashMap<String, String>>,
        timeout_ms: Option<u64>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct InstalledPlugin {
    manifest: PluginManifest,
    #[serde(rename = "installedAt")]
    installed_at: String,
    #[serde(rename = "marketId")]
    market_id: Option<String>,
    #[serde(rename = "filePath")]
    file_path: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct PluginStore {
    plugins: Vec<InstalledPlugin>,
}

fn plugin_store() -> &'static Mutex<PluginStore> {
    static STORE: OnceLock<Mutex<PluginStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(load_store()))
}

fn success_payload(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn plugin_store_path() -> Result<PathBuf, String> {
    storage::app_file_path("desktop", StorageKind::Data, &["plugins", "plugins.json"])
        .map_err(|error| format!("failed to resolve plugin store path: {error:?}"))
}

fn load_store() -> PluginStore {
    let path = match plugin_store_path() {
        Ok(path) => path,
        Err(error) => {
            tracing::warn!(error = %error, "Failed to resolve plugin store path");
            return PluginStore::default();
        }
    };
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return PluginStore::default()
        }
        Err(error) => {
            tracing::warn!(error = %error, path = %path.display(), "Failed to read plugin store");
            return PluginStore::default();
        }
    };
    serde_json::from_str::<PluginStore>(&content).unwrap_or_else(|error| {
        tracing::warn!(error = %error, path = %path.display(), "Failed to parse plugin store");
        PluginStore::default()
    })
}

fn persist_store(store: &PluginStore) -> Result<(), String> {
    let path = plugin_store_path()?;
    let content = serde_json::to_string_pretty(store)
        .map_err(|error| format!("failed to serialize plugin store: {error}"))?;
    storage::write_string_atomic(&path, &content)
        .map_err(|error| format!("failed to write plugin store: {error}"))
}

fn persist_error(error: impl std::fmt::Display) -> AppResult<StubPayload> {
    tracing::error!(error = %error, "Failed to persist plugin store");
    AppResult::fail(
        ErrorCode::InternalError,
        format!("failed to persist plugin store: {error}"),
        None,
    )
}

pub fn install_plugin_from_content(
    content: &str,
    source: &str,
    market_id: Option<String>,
    file_path: Option<String>,
) -> AppResult<StubPayload> {
    let manifest = match parse_plugin_manifest(content, source) {
        Ok(manifest) => manifest,
        Err(error) => return AppResult::fail(ErrorCode::InvalidArgument, error, None),
    };
    let plugin_id = manifest.plugin_id.clone();
    let mut guard = match plugin_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access plugin store: {error}"),
                None,
            )
        }
    };
    let existed = guard
        .plugins
        .iter()
        .any(|plugin| plugin.manifest.plugin_id == plugin_id);
    guard
        .plugins
        .retain(|plugin| plugin.manifest.plugin_id != plugin_id);
    guard.plugins.push(InstalledPlugin {
        manifest,
        installed_at: now_rfc3339(),
        market_id,
        file_path,
    });
    if let Err(error) = persist_store(&guard) {
        return persist_error(error);
    }
    success_payload(
        "plugins_install",
        json!({
            "id": plugin_id,
            "identifier": plugin_id,
            "name": guard.plugins.last().map(|plugin| plugin.manifest.name.as_str()).unwrap_or(""),
            "isNew": !existed,
            "packageType": "plugin",
            "scanVerdict": "manifest-validated"
        }),
    )
}

pub fn uninstall_plugin_by_market_package(
    market_id: &str,
    file_path: &str,
) -> AppResult<StubPayload> {
    let mut guard = match plugin_store().lock() {
        Ok(guard) => guard,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to access plugin store: {error}"),
                None,
            )
        }
    };
    let before = guard.plugins.len();
    let mut removed_id = String::new();
    guard.plugins.retain(|plugin| {
        let matched = plugin.market_id.as_deref() == Some(market_id)
            && plugin.file_path.as_deref() == Some(file_path);
        if matched {
            removed_id = plugin.manifest.plugin_id.clone();
        }
        !matched
    });
    if before == guard.plugins.len() {
        return AppResult::fail(ErrorCode::NotFound, "plugin package is not installed", None);
    }
    if let Err(error) = persist_store(&guard) {
        return persist_error(error);
    }
    success_payload(
        "plugins_uninstall",
        json!({ "ok": true, "pluginId": removed_id }),
    )
}

pub fn plugin_tool_registry_entries() -> Result<Vec<Value>, String> {
    let guard = plugin_store()
        .lock()
        .map_err(|error| format!("failed to access plugin store: {error}"))?;
    let mut entries = Vec::new();
    for plugin in &guard.plugins {
        for tool in &plugin.manifest.tools {
            entries.push(json!({
                "name": format!("plugin.{}.{}", plugin.manifest.plugin_id, tool.name),
                "displayName": tool.name,
                "description": tool.description,
                "source": "plugin",
                "serverName": plugin.manifest.plugin_id,
                "category": "plugin",
                "enabled": true,
                "needs_approval": tool.needs_approval.unwrap_or(true),
                "riskLevel": tool.risk_level.as_deref().unwrap_or(plugin.manifest.risk_level.as_str()),
                "trustLevel": plugin.manifest.trust_level,
                "packageType": "plugin",
                "executionOwner": "desktop-rust",
                "executable": true,
                "schema": tool.schema
            }));
        }
    }
    Ok(entries)
}

pub fn execute_plugin_tool(
    plugin_id: &str,
    tool_name: &str,
    arguments: Value,
    call_id: Option<&str>,
) -> Result<Value, String> {
    let started = std::time::Instant::now();
    let guard = plugin_store()
        .lock()
        .map_err(|error| format!("failed to access plugin store: {error}"))?;
    let plugin = guard
        .plugins
        .iter()
        .find(|plugin| plugin.manifest.plugin_id == plugin_id)
        .ok_or_else(|| format!("plugin not installed: {plugin_id}"))?;
    let tool = plugin
        .manifest
        .tools
        .iter()
        .find(|tool| tool.name == tool_name)
        .ok_or_else(|| format!("plugin tool not found: {tool_name}"))?;
    let output = execute_plugin_runtime(&tool.runtime, arguments.clone())?;
    Ok(json!({
        "ok": true,
        "toolName": tool_name,
        "callId": call_id.unwrap_or_default(),
        "arguments": redact_json_value(&arguments),
        "durationMs": started.elapsed().as_millis() as u64,
        "output": output,
        "audit": {
            "source": "plugin",
            "pluginId": plugin.manifest.plugin_id,
            "toolName": tool_name,
            "executionOwner": "desktop-rust",
            "approvalRequired": tool.needs_approval.unwrap_or(true),
            "trustLevel": plugin.manifest.trust_level,
            "riskLevel": tool.risk_level.as_deref().unwrap_or(plugin.manifest.risk_level.as_str()),
            "executedAt": now_rfc3339()
        }
    }))
}

fn execute_plugin_runtime(runtime: &PluginToolRuntime, arguments: Value) -> Result<Value, String> {
    match runtime {
        PluginToolRuntime::Static { response } => Ok(redact_json_value(response)),
        PluginToolRuntime::Http {
            url,
            method,
            headers,
            timeout_ms,
        } => execute_http_plugin_runtime(
            url,
            method.as_deref(),
            headers.as_ref(),
            timeout_ms,
            arguments,
        ),
    }
}

fn execute_http_plugin_runtime(
    url: &str,
    method: Option<&str>,
    headers: Option<&HashMap<String, String>>,
    timeout_ms: &Option<u64>,
    arguments: Value,
) -> Result<Value, String> {
    let url = validate_connector_url(url)?;
    validate_connector_headers(headers)?;
    let method_name = method.unwrap_or("POST").trim().to_ascii_uppercase();
    if method_name != "GET" && method_name != "POST" {
        return Err("HTTP plugin runtime only supports GET and POST".to_string());
    }
    let method = Method::from_bytes(method_name.as_bytes())
        .map_err(|error| format!("invalid HTTP plugin method: {error}"))?;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(8_000).clamp(1_000, 10_000));
    let client = reqwest::blocking::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("failed to create plugin HTTP client: {error}"))?;
    let mut request = client.request(method.clone(), url.clone());
    if let Some(headers) = headers {
        for (key, value) in headers {
            if key.contains('\n')
                || key.contains('\r')
                || value.contains('\n')
                || value.contains('\r')
            {
                return Err("HTTP plugin runtime headers must not contain newlines".to_string());
            }
            request = request.header(key, value);
        }
    }
    if method == Method::POST {
        request = request.json(&arguments);
    }
    let response = request
        .send()
        .map_err(|error| format!("plugin HTTP connector request failed: {error}"))?;
    let status = response.status().as_u16();
    if !response.status().is_success() {
        return Err(format!(
            "plugin HTTP connector returned non-success status: {status}"
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body = response
        .text()
        .map_err(|error| format!("failed to read plugin HTTP connector response: {error}"))?;
    let parsed_body = if content_type.contains("application/json") {
        serde_json::from_str::<Value>(&body)
            .map(|value| redact_json_value(&value))
            .unwrap_or_else(|_| json!({"text": body}))
    } else {
        json!({"text": body})
    };
    Ok(json!({
        "status": status,
        "url": connector_url_origin(&url),
        "contentType": content_type,
        "body": parsed_body,
        "redactions": ["secret-like-json-fields"]
    }))
}

fn validate_connector_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim())
        .map_err(|error| format!("invalid HTTP plugin runtime URL: {error}"))?;
    match url.scheme() {
        "https" => {}
        "http" if is_loopback_url(&url) => {}
        "http" => {
            return Err(
                "HTTP plugin runtime only allows http for loopback development endpoints"
                    .to_string(),
            )
        }
        _ => return Err("HTTP plugin runtime URL must use https".to_string()),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("HTTP plugin runtime URL must not embed credentials".to_string());
    }
    if is_private_or_metadata_ip(&url) && !is_loopback_url(&url) {
        return Err(
            "HTTP plugin runtime must not target private network or metadata IPs".to_string(),
        );
    }
    Ok(url)
}

fn validate_connector_headers(headers: Option<&HashMap<String, String>>) -> Result<(), String> {
    let Some(headers) = headers else {
        return Ok(());
    };
    for (key, value) in headers {
        if key.contains('\n') || key.contains('\r') || value.contains('\n') || value.contains('\r')
        {
            return Err("HTTP plugin runtime headers must not contain newlines".to_string());
        }
        if is_secret_like_key(key) {
            return Err("HTTP plugin runtime headers must use credential references, not inline secret-like header names".to_string());
        }
    }
    Ok(())
}

fn connector_url_origin(url: &Url) -> String {
    match url.port() {
        Some(port) => format!("{}://{}:{port}", url.scheme(), url.host_str().unwrap_or("")),
        None => format!("{}://{}", url.scheme(), url.host_str().unwrap_or("")),
    }
}

fn is_loopback_url(url: &Url) -> bool {
    match url.host_str() {
        Some("localhost") => true,
        Some(host) => host
            .parse::<IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false),
        None => false,
    }
}

fn is_private_or_metadata_ip(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let Ok(ip) = host.parse::<IpAddr>() else {
        return false;
    };
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.octets() == [169, 254, 169, 254]
        }
        IpAddr::V6(ip) => ip.is_loopback() || ip.is_unspecified(),
    }
}

fn parse_plugin_manifest(content: &str, source: &str) -> Result<PluginManifest, String> {
    let value: Value =
        serde_json::from_str(content).map_err(|error| format!("invalid plugin JSON: {error}"))?;
    let manifest = value.get("plugin").cloned().unwrap_or(value);
    let plugin_id = required_manifest_string(&manifest, "pluginId")
        .or_else(|_| required_manifest_string(&manifest, "plugin_id"))?;
    let name = required_manifest_string(&manifest, "name")?;
    let tools = manifest
        .get("tools")
        .and_then(Value::as_array)
        .ok_or_else(|| "plugin manifest must include tools[]".to_string())?;
    if tools.is_empty() {
        return Err("plugin manifest must declare at least one tool".to_string());
    }
    let parsed_tools = tools
        .iter()
        .map(parse_plugin_tool)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(PluginManifest {
        plugin_id,
        name,
        description: optional_manifest_string(&manifest, "description"),
        version: optional_manifest_string(&manifest, "version").if_empty_then("1.0.0".to_string()),
        trust_level: optional_manifest_string(&manifest, "trustLevel")
            .if_empty_then("community".to_string()),
        risk_level: optional_manifest_string(&manifest, "riskLevel")
            .if_empty_then("medium".to_string()),
        source: optional_manifest_string(&manifest, "source").if_empty_then(source.to_string()),
        tools: parsed_tools,
    })
}

fn parse_plugin_tool(value: &Value) -> Result<PluginToolManifest, String> {
    let name = required_manifest_string(value, "name")?;
    let runtime = value
        .get("runtime")
        .cloned()
        .ok_or_else(|| format!("plugin tool {name} must include runtime"))?;
    let runtime = serde_json::from_value::<PluginToolRuntime>(runtime)
        .map_err(|error| format!("unsupported runtime for plugin tool {name}: {error}"))?;
    Ok(PluginToolManifest {
        name,
        description: optional_manifest_string(value, "description"),
        schema: value
            .get("schema")
            .cloned()
            .unwrap_or_else(|| json!({"type": "object", "properties": {}})),
        runtime,
        risk_level: value
            .get("riskLevel")
            .or_else(|| value.get("risk_level"))
            .and_then(Value::as_str)
            .map(str::to_string),
        needs_approval: value
            .get("needsApproval")
            .or_else(|| value.get("needs_approval"))
            .and_then(Value::as_bool),
    })
}

fn required_manifest_string(value: &Value, key: &str) -> Result<String, String> {
    let value = optional_manifest_string(value, key);
    if value.is_empty() {
        Err(format!("plugin manifest field {key} is required"))
    } else {
        Ok(value)
    }
}

fn optional_manifest_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_string()
}

trait EmptyDefault {
    fn if_empty_then(self, fallback: String) -> String;
}

impl EmptyDefault for String {
    fn if_empty_then(self, fallback: String) -> String {
        if self.is_empty() {
            fallback
        } else {
            self
        }
    }
}

fn now_rfc3339() -> String {
    let unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs() as i64;
    let dt =
        time::OffsetDateTime::from_unix_timestamp(unix).unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    dt.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn with_temp_storage_root(f: impl FnOnce()) {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "peers-touch-plugin-store-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&base).expect("temp storage root");
        std::env::set_var("PEERS_STORAGE_ROOT", base.to_str().expect("utf8 path"));
        if let Ok(mut store) = plugin_store().lock() {
            store.plugins.clear();
        }
        f();
        if let Ok(mut store) = plugin_store().lock() {
            store.plugins.clear();
        }
        std::env::remove_var("PEERS_STORAGE_ROOT");
        let _ = fs::remove_dir_all(base);
    }

    fn sample_plugin() -> String {
        r#"{
          "plugin": {
            "pluginId": "demo",
            "name": "Demo Plugin",
            "description": "A constrained plugin",
            "version": "1.0.0",
            "trustLevel": "community",
            "riskLevel": "medium",
            "tools": [
              {
                "name": "summarize",
                "description": "Return a static summary",
                "needsApproval": true,
                "riskLevel": "medium",
                "schema": {"type":"object","properties":{"text":{"type":"string"}}},
                "runtime": {"kind":"static","response":{"summary":"ok"}}
              }
            ]
          }
        }"#
        .to_string()
    }

    #[test]
    fn plugin_manifest_requires_constrained_runtime() {
        let manifest = parse_plugin_manifest(&sample_plugin(), "market").expect("valid plugin");
        assert_eq!(manifest.plugin_id, "demo");
        assert_eq!(manifest.tools[0].name, "summarize");
        assert!(manifest.tools[0].needs_approval.unwrap_or(false));

        let invalid = r#"{"pluginId":"bad","name":"Bad","tools":[{"name":"run","runtime":{"kind":"process","command":"sh"}}]}"#;
        assert!(parse_plugin_manifest(invalid, "market").is_err());
    }

    #[test]
    fn plugin_tools_project_policy_metadata_and_execute_with_audit() {
        with_temp_storage_root(|| {
            let installed = install_plugin_from_content(
                &sample_plugin(),
                "market",
                Some("market-a".to_string()),
                Some("plugins/demo/plugin.json".to_string()),
            );
            assert!(installed.ok, "plugin should install");

            let entries = plugin_tool_registry_entries().expect("registry entries");
            let entry = entries
                .iter()
                .find(|entry| {
                    entry.get("name").and_then(Value::as_str) == Some("plugin.demo.summarize")
                })
                .expect("plugin tool entry");
            assert_eq!(entry.get("source").and_then(Value::as_str), Some("plugin"));
            assert_eq!(
                entry.get("needs_approval").and_then(Value::as_bool),
                Some(true)
            );
            assert_eq!(
                entry.get("trustLevel").and_then(Value::as_str),
                Some("community")
            );

            let output = execute_plugin_tool(
                "demo",
                "summarize",
                json!({"text": "hello"}),
                Some("call_1"),
            )
            .expect("plugin tool should execute");
            assert_eq!(
                output
                    .get("audit")
                    .and_then(|audit| audit.get("source"))
                    .and_then(Value::as_str),
                Some("plugin")
            );
        });
    }

    #[test]
    fn plugin_http_connector_executes_with_redacted_output_bits_ut() {
        with_temp_storage_root(|| {
            let url = start_http_connector_fixture();
            let plugin = format!(
                r#"{{
                  "plugin": {{
                    "pluginId": "http-demo",
                    "name": "HTTP Demo Connector",
                    "trustLevel": "community",
                    "riskLevel": "high",
                    "tools": [
                      {{
                        "name": "fetch",
                        "description": "Call constrained HTTP connector",
                        "needsApproval": true,
                        "schema": {{"type":"object","properties":{{"query":{{"type":"string"}}}}}},
                        "runtime": {{"kind":"http","url":"{}","method":"POST","timeout_ms":2000}}
                      }}
                    ]
                  }}
                }}"#,
                url
            );
            let installed =
                install_plugin_from_content(&plugin, "market", Some("market-b".to_string()), None);
            assert!(installed.ok, "HTTP connector plugin should install");

            let output = execute_plugin_tool(
                "http-demo",
                "fetch",
                json!({"query": "hello", "access_token": "raw-token"}),
                Some("call_http"),
            )
            .expect("HTTP connector should execute");

            assert_eq!(output.get("ok").and_then(Value::as_bool), Some(true));
            assert_eq!(
                output
                    .get("arguments")
                    .and_then(|arguments| arguments.get("access_token"))
                    .and_then(Value::as_str),
                Some("[redacted]")
            );
            assert_eq!(
                output
                    .get("output")
                    .and_then(|output| output.get("body"))
                    .and_then(|body| body.get("access_token"))
                    .and_then(Value::as_str),
                Some("[redacted]")
            );
            assert_eq!(
                output
                    .get("audit")
                    .and_then(|audit| audit.get("source"))
                    .and_then(Value::as_str),
                Some("plugin")
            );
        });
    }

    #[test]
    fn plugin_http_connector_policy_blocks_unsafe_targets_and_inline_secrets_bits_ut() {
        assert!(validate_connector_url("http://example.com/hook").is_err());
        assert!(validate_connector_url("https://169.254.169.254/latest/meta-data").is_err());
        assert!(validate_connector_url("https://user:pass@example.com/hook").is_err());

        let mut headers = HashMap::new();
        headers.insert("authorization".to_string(), "Bearer raw".to_string());
        assert!(validate_connector_headers(Some(&headers)).is_err());
    }

    fn start_http_connector_fixture() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture");
        let addr = listener.local_addr().expect("fixture addr");
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0_u8; 4096];
                let _ = stream.read(&mut buffer);
                let body = r#"{"ok":true,"access_token":"server-token","data":{"message":"done"}}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        format!("http://{}", addr)
    }
}
