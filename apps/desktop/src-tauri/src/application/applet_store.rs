use crate::contracts::{
    AppletStoreGetVersionInput, AppletStoreInstallInput, AppletStoreListCatalogInput,
    AppletStoreListInstalledInput, AppletStoreMaterializeBundleInput, AppletStoreUninstallInput,
    StubPayload,
};
use crate::domain::applets::{drain_audit_records, requeue_audit_records, AccessContext};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use reqwest::Method;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

const STORE_BASE: &str = "/api/v1/applets";

fn success_payload(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn invalid_argument(command: &str, message: &str) -> AppResult<StubPayload> {
    AppResult::fail(
        ErrorCode::InvalidArgument,
        message,
        Some(json!({ "command": command })),
    )
}

fn device_id(input_device_id: Option<String>) -> String {
    input_device_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "desktop-default".to_string())
}

fn channel(value: Option<String>) -> String {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| "stable".to_string())
}

fn actor_ptid(context: &AccessContext) -> String {
    context
        .actor_ptid
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown-actor")
        .to_string()
}

fn cache_root(data_dir: &Path) -> PathBuf {
    data_dir.join("applets").join("store-cache")
}

fn safe_cache_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn cache_path(data_dir: &Path, actor: &str, device: &str, name: &str) -> PathBuf {
    cache_root(data_dir)
        .join(safe_cache_segment(actor))
        .join(safe_cache_segment(device))
        .join(format!("{}.json", name))
}

fn bundle_root(data_dir: &Path) -> PathBuf {
    data_dir.join("applets").join("store-bundles")
}

fn safe_relative_file(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('/')
        || trimmed.contains('\\')
        || trimmed
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return None;
    }
    Some(trimmed.to_string())
}

fn write_cache(path: &Path, payload: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create applet store cache dir: {}", error))?;
    }
    let body = serde_json::to_string_pretty(payload)
        .map_err(|error| format!("encode applet store cache: {}", error))?;
    fs::write(path, body).map_err(|error| format!("write applet store cache: {}", error))
}

fn read_cache(path: &Path) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn station_error(
    command: &str,
    error: station_client::StationClientError,
    cache: Option<Value>,
) -> AppResult<StubPayload> {
    match cache {
        Some(mut cached) => {
            cached["source"] = json!("cache");
            cached["stale"] = json!(true);
            cached["stationUnavailable"] = json!(true);
            cached["stationError"] = json!(error.message);
            success_payload(command, cached)
        }
        None => error.into_app_result(command),
    }
}

fn station_bundle_url(bundle_url: &str) -> Result<String, String> {
    let trimmed = bundle_url.trim();
    if trimmed.is_empty() {
        return Err("bundleUrl is required".to_string());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let base = station_client::station_base_url();
        if !trimmed.starts_with(&base) {
            return Err("bundleUrl must belong to the active Station".to_string());
        }
        return Ok(trimmed.to_string());
    }
    if !trimmed.starts_with('/') {
        return Err("bundleUrl must be an absolute Station path".to_string());
    }
    Ok(format!("{}{}", station_client::station_base_url(), trimmed))
}

fn station_asset_url(bundle_url: &str, entry: &str, asset_path: &str) -> Result<String, String> {
    if asset_path == entry {
        return station_bundle_url(bundle_url);
    }
    let trimmed = bundle_url.trim();
    let marker = "path=";
    let path_start = trimmed
        .find(marker)
        .ok_or_else(|| "bundleUrl must include a path query to derive asset URLs".to_string())?
        + marker.len();
    let path_end = trimmed[path_start..]
        .find('&')
        .map(|index| path_start + index)
        .unwrap_or(trimmed.len());
    let storage_path = &trimmed[path_start..path_end];
    let storage_dir = storage_path
        .rsplit_once('/')
        .map(|(dir, _)| dir)
        .unwrap_or("");
    let asset_storage_path = if storage_dir.is_empty() {
        asset_path.to_string()
    } else {
        format!("{}/{}", storage_dir, asset_path)
    };
    let next = format!(
        "{}{}{}",
        &trimmed[..path_start],
        asset_storage_path,
        &trimmed[path_end..]
    );
    station_bundle_url(&next)
}

fn sha256_digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn download_station_asset(
    context: &AccessContext,
    url: &str,
) -> Result<Vec<u8>, (ErrorCode, String, Value)> {
    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .and_then(|client| client.get(url).bearer_auth(&context.token).send())
        .map_err(|error| {
            (
                ErrorCode::InternalError,
                "download applet package asset".to_string(),
                json!({ "error": error.to_string() }),
            )
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err((
            ErrorCode::InternalError,
            "download applet package asset".to_string(),
            json!({ "status": status.as_u16() }),
        ));
    }
    response
        .bytes()
        .map(|bytes| bytes.to_vec())
        .map_err(|error| {
            (
                ErrorCode::InternalError,
                "read applet package asset".to_string(),
                json!({ "error": error.to_string() }),
            )
        })
}

pub fn list_catalog(
    context: AccessContext,
    input: AppletStoreListCatalogInput,
    data_dir: &Path,
) -> AppResult<StubPayload> {
    let actor = actor_ptid(&context);
    let device = device_id(input.device_id);
    let cache_file = cache_path(data_dir, &actor, &device, "catalog");
    let query = vec![
        ("actor_ptid", actor.clone()),
        ("device_id", device.clone()),
        (
            "target_platform",
            input
                .target_platform
                .unwrap_or_else(|| "desktop".to_string()),
        ),
        ("channel", channel(input.channel)),
        ("search_keyword", input.search_keyword.unwrap_or_default()),
        ("limit", input.limit.unwrap_or(100).to_string()),
        ("offset", input.offset.unwrap_or(0).to_string()),
    ];

    match station_client::request_json_auth(
        Method::GET,
        &format!("{}/catalog", STORE_BASE),
        &context.token,
        Some(&query),
        None,
    ) {
        Ok(mut response) => {
            response["source"] = json!("station");
            response["stale"] = json!(false);
            if let Err(error) = write_cache(&cache_file, &response) {
                tracing::warn!(error = %error, "Failed to write applet catalog cache");
            }
            success_payload("applets_store_list_catalog", response)
        }
        Err(error) => station_error("applets_store_list_catalog", error, read_cache(&cache_file)),
    }
}

pub fn list_installed(
    context: AccessContext,
    input: AppletStoreListInstalledInput,
    data_dir: &Path,
) -> AppResult<StubPayload> {
    let actor = actor_ptid(&context);
    let device = device_id(input.device_id);
    let cache_file = cache_path(data_dir, &actor, &device, "installed");
    let query = vec![
        ("actor_ptid", actor.clone()),
        ("device_id", device.clone()),
        (
            "include_disabled",
            input.include_disabled.unwrap_or(false).to_string(),
        ),
    ];

    match station_client::request_json_auth(
        Method::GET,
        &format!("{}/installed", STORE_BASE),
        &context.token,
        Some(&query),
        None,
    ) {
        Ok(mut response) => {
            response["source"] = json!("station");
            response["stale"] = json!(false);
            if let Err(error) = write_cache(&cache_file, &response) {
                tracing::warn!(error = %error, "Failed to write applet installed cache");
            }
            success_payload("applets_store_list_installed", response)
        }
        Err(error) => station_error(
            "applets_store_list_installed",
            error,
            read_cache(&cache_file),
        ),
    }
}

pub fn install(context: AccessContext, input: AppletStoreInstallInput) -> AppResult<StubPayload> {
    let applet_id = input.applet_id.trim();
    if applet_id.is_empty() {
        return invalid_argument("applets_store_install", "appletId is required");
    }

    let body = json!({
        "actor_ptid": actor_ptid(&context),
        "device_id": device_id(input.device_id),
        "applet_id": applet_id,
        "version": input.version.unwrap_or_default(),
        "channel": channel(input.channel),
        "config": input.config.unwrap_or_else(|| json!({})),
    });
    match station_client::request_json_auth(
        Method::POST,
        &format!("{}/install", STORE_BASE),
        &context.token,
        None,
        Some(&body),
    ) {
        Ok(mut response) => {
            response["source"] = json!("station");
            success_payload("applets_store_install", response)
        }
        Err(error) => error.into_app_result("applets_store_install"),
    }
}

pub fn uninstall(
    context: AccessContext,
    input: AppletStoreUninstallInput,
) -> AppResult<StubPayload> {
    let applet_id = input.applet_id.trim();
    if applet_id.is_empty() {
        return invalid_argument("applets_store_uninstall", "appletId is required");
    }

    let body = json!({
        "actor_ptid": actor_ptid(&context),
        "device_id": device_id(input.device_id),
        "applet_id": applet_id,
    });
    match station_client::request_json_auth(
        Method::POST,
        &format!("{}/uninstall", STORE_BASE),
        &context.token,
        None,
        Some(&body),
    ) {
        Ok(mut response) => {
            response["source"] = json!("station");
            success_payload("applets_store_uninstall", response)
        }
        Err(error) => error.into_app_result("applets_store_uninstall"),
    }
}

pub fn get_version(
    context: AccessContext,
    input: AppletStoreGetVersionInput,
    data_dir: &Path,
) -> AppResult<StubPayload> {
    let applet_id = input.applet_id.trim();
    if applet_id.is_empty() {
        return invalid_argument("applets_store_get_version", "appletId is required");
    }

    let device = "version";
    let cache_file = cache_path(data_dir, &actor_ptid(&context), device, applet_id);
    let query = vec![
        ("applet_id", applet_id.to_string()),
        ("version", input.version.unwrap_or_default()),
        ("channel", channel(input.channel)),
    ];
    match station_client::request_json_auth(
        Method::GET,
        &format!("{}/version", STORE_BASE),
        &context.token,
        Some(&query),
        None,
    ) {
        Ok(mut response) => {
            response["source"] = json!("station");
            response["stale"] = json!(false);
            if let Err(error) = write_cache(&cache_file, &response) {
                tracing::warn!(error = %error, "Failed to write applet version cache");
            }
            success_payload("applets_store_get_version", response)
        }
        Err(error) => station_error("applets_store_get_version", error, read_cache(&cache_file)),
    }
}

pub fn materialize_bundle(
    context: AccessContext,
    input: AppletStoreMaterializeBundleInput,
    data_dir: &Path,
) -> AppResult<StubPayload> {
    let applet_id = input.applet_id.trim();
    if applet_id.is_empty() {
        return invalid_argument("applets_store_materialize_bundle", "appletId is required");
    }
    let entry = match input.entry.as_deref().and_then(safe_relative_file) {
        Some(value) => value,
        None => {
            return invalid_argument(
                "applets_store_materialize_bundle",
                "entry must be a safe relative file path",
            )
        }
    };
    let version = input
        .version
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "current".to_string());
    let directory = bundle_root(data_dir)
        .join(safe_cache_segment(applet_id))
        .join(safe_cache_segment(&version));

    let mut assets = input.assets.unwrap_or_default();
    let bundle_sha256 = input.bundle_sha256.unwrap_or_default();
    if assets.is_empty() {
        assets.push(crate::contracts::AppletStoreBundleAssetInput {
            path: entry.clone(),
            sha256: bundle_sha256.clone(),
        });
    }
    if !assets.iter().any(|asset| asset.path == entry) {
        assets.push(crate::contracts::AppletStoreBundleAssetInput {
            path: entry.clone(),
            sha256: bundle_sha256,
        });
    }

    let mut materialized = Vec::with_capacity(assets.len());
    for asset in assets {
        let asset_path = match safe_relative_file(&asset.path) {
            Some(value) => value,
            None => {
                return invalid_argument(
                    "applets_store_materialize_bundle",
                    "asset path must be safe and relative",
                )
            }
        };
        let url = match station_asset_url(&input.bundle_url, &entry, &asset_path) {
            Ok(value) => value,
            Err(message) => return invalid_argument("applets_store_materialize_bundle", &message),
        };
        let bytes = match download_station_asset(&context, &url) {
            Ok(value) => value,
            Err((code, message, details)) => return AppResult::fail(code, message, Some(details)),
        };
        let digest = sha256_digest(bytes.as_ref());
        let expected = asset.sha256.trim();
        if !expected.is_empty() && digest != expected.to_lowercase() {
            return AppResult::fail(
                ErrorCode::Conflict,
                "applet package asset integrity mismatch",
                Some(json!({ "path": asset_path, "expected": expected, "actual": digest })),
            );
        }

        let file_path = directory.join(&asset_path);
        if let Some(parent) = file_path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    "create applet bundle cache directory",
                    Some(json!({ "error": error.to_string() })),
                );
            }
        }
        if let Err(error) = fs::write(&file_path, bytes.as_slice()) {
            return AppResult::fail(
                ErrorCode::InternalError,
                "write applet bundle cache",
                Some(json!({ "error": error.to_string() })),
            );
        }
        materialized.push(json!({
            "path": asset_path,
            "filePath": file_path.to_string_lossy(),
            "sha256": digest,
        }));
    }

    let file_path = directory.join(&entry);
    let entry_digest = materialized
        .iter()
        .find(|item| item.get("path").and_then(Value::as_str) == Some(entry.as_str()))
        .and_then(|item| item.get("sha256").and_then(Value::as_str))
        .unwrap_or("")
        .to_string();

    success_payload(
        "applets_store_materialize_bundle",
        json!({
            "directory": directory.to_string_lossy(),
            "entry": entry,
            "filePath": file_path.to_string_lossy(),
            "sha256": entry_digest,
            "assets": materialized,
            "source": "station"
        }),
    )
}

pub fn upload_audit(context: AccessContext, device: Option<String>) -> AppResult<StubPayload> {
    let records = drain_audit_records();
    if records.is_empty() {
        return success_payload(
            "applets_store_upload_audit",
            json!({
                "acceptedCount": 0,
                "rejectedAuditIds": [],
                "source": "local"
            }),
        );
    }

    let actor = actor_ptid(&context);
    let device_id = device_id(device);
    let body_records = records
        .iter()
        .map(|record| {
            json!({
                "audit_id": record.request_id,
                "actor_ptid": if record.actor_ptid == "anonymous" { actor.clone() } else { record.actor_ptid.clone() },
                "device_id": device_id.clone(),
                "applet_id": record.applet_id.clone(),
                "version": "",
                "session_id": "",
                "capability": record.capability.clone(),
                "method": record.command.clone(),
                "decision": if record.outcome == "ok" { "APPLET_AUDIT_DECISION_ALLOWED" } else { "APPLET_AUDIT_DECISION_DENIED" },
                "reason": record.outcome.clone(),
                "metadata": {
                    "outcome": record.outcome.clone(),
                    "command": record.command.clone()
                },
                "recorded_at": 0
            })
        })
        .collect::<Vec<_>>();
    let body = json!({ "records": body_records });
    match station_client::request_json_auth(
        Method::POST,
        &format!("{}/audit/ingest", STORE_BASE),
        &context.token,
        None,
        Some(&body),
    ) {
        Ok(mut response) => {
            response["source"] = json!("station");
            success_payload("applets_store_upload_audit", response)
        }
        Err(error) => {
            requeue_audit_records(records);
            error.into_app_result("applets_store_upload_audit")
        }
    }
}
