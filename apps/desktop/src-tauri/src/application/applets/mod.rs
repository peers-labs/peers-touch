use crate::application::provider::{remote as provider_remote, station_api as provider_cache};
use crate::contracts::{
    AppletActionInput, AppletConfigSetInput, AppletCreateSessionInput, AppletGatewayManifest,
    AppletGatewayService, AppletGatewaySkill, AppletIdInput, AppletInvokeInput, StubPayload,
};
use crate::domain::applets::{
    authorize_manifest_permission, build_request_id, capability_method, destroy_session,
    emit_audit, ensure_active_session, normalize_capability, register_active_session,
    AccessContext, AppletSessionManifestSnapshot,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use reqwest::blocking::Client;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::Method;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const APPLET_STORAGE_QUOTA_BYTES: usize = 10 * 1024 * 1024;
const APPLET_FILE_QUOTA_BYTES: usize = 10 * 1024 * 1024;
const DEFAULT_GATEWAY_MAX_PAYLOAD_BYTES: usize = 256 * 1024;
const DEFAULT_GATEWAY_SESSION_QUOTA_PER_MINUTE: u32 = 240;
const DEFAULT_GATEWAY_TIMEOUT_MS: u64 = 30_000;
const GATEWAY_QUOTA_WINDOW_MS: u128 = 60_000;
const APPLET_CLIPBOARD_MEMORY_FALLBACK_ENV: &str = "PEERS_APPLET_CLIPBOARD_BACKEND";
const DEFAULT_APPLET_TASK_COMPLETE_AFTER_MS: u64 = 100;
const PRODUCT_EXECUTORS_REQUIRED_ENV: &str = "PEERS_APPLET_REQUIRE_PRODUCT_EXECUTORS";
const ATELIER_PROJECTION_STREAM_REQUEST_TIMEOUT_MS: u64 = 1_000;
const PRODUCT_WINDOW_E2E_ENV: &str = "PEERS_APPLET_PRODUCT_WINDOW_E2E";
const PRODUCT_WINDOW_E2E_APPLET_ID_ENV: &str = "PEERS_APPLET_PRODUCT_WINDOW_E2E_APPLET_ID";
const PRODUCT_WINDOW_E2E_LAUNCH_OPTIONS_ENV: &str =
    "PEERS_APPLET_PRODUCT_WINDOW_E2E_LAUNCH_OPTIONS_JSON";
const PRODUCT_WINDOW_E2E_ATELIER_UNSUBSCRIBE_EVIDENCE_ENV: &str =
    "PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_UNSUBSCRIBE_EVIDENCE";
const PRODUCT_WINDOW_E2E_ATELIER_RENDERED_PROJECTION_EVIDENCE_ENV: &str =
    "PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_RENDERED_PROJECTION_EVIDENCE";
const PRODUCT_WINDOW_E2E_ATELIER_CREATED_PROJECT_EVIDENCE_ENV: &str =
    "PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_CREATED_PROJECT_EVIDENCE";
const PRODUCT_WINDOW_E2E_ATELIER_DECISION_RESOLVED_EVIDENCE_ENV: &str =
    "PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_DECISION_RESOLVED_EVIDENCE";
const PRODUCT_WINDOW_E2E_ATELIER_ARTIFACT_GATE_RENDERED_EVIDENCE_ENV: &str =
    "PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_ARTIFACT_GATE_RENDERED_EVIDENCE";
const PRODUCT_WINDOW_E2E_ATELIER_ARTIFACT_BODY_FETCHED_EVIDENCE_ENV: &str =
    "PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_ARTIFACT_BODY_FETCHED_EVIDENCE";
const PRODUCT_WINDOW_E2E_ATELIER_ARTIFACT_PREVIEW_OPENED_EVIDENCE_ENV: &str =
    "PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_ARTIFACT_PREVIEW_OPENED_EVIDENCE";
const PRODUCT_WINDOW_E2E_ATELIER_SUBSCRIPTION_DIAGNOSTIC_EVIDENCE_ENV: &str =
    "PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_SUBSCRIPTION_DIAGNOSTIC_EVIDENCE";
const ATELIER_FULL_E2E_ENV: &str = "PEERS_ATELIER_FULL_E2E";
const ATELIER_FULL_E2E_APPLET_ID_ENV: &str = "PEERS_ATELIER_FULL_E2E_APPLET_ID";
const ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID_ENV: &str = "PEERS_ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID";
const ATELIER_FULL_E2E_DESKTOP_READY_EVIDENCE_ENV: &str =
    "PEERS_ATELIER_FULL_E2E_DESKTOP_READY_EVIDENCE";
const ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE_ENV: &str =
    "PEERS_ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE";
const ATELIER_FULL_E2E_IDE_LAUNCH_EVIDENCE_ENV: &str = "PEERS_ATELIER_FULL_E2E_IDE_LAUNCH_EVIDENCE";
const ATELIER_FULL_E2E_IDE_LAUNCHER_ENV: &str = "PEERS_ATELIER_FULL_E2E_IDE_LAUNCHER";
const ATELIER_PROJECTION_CONTRACT_JSON: &str = include_str!(
    "../../../../../../apps/applets/atelier/contracts/atelier-projection.contract.json"
);

#[derive(Debug, Clone, Copy)]
struct GatewayLimits {
    max_payload_bytes: usize,
    session_quota_per_minute: u32,
    capability_timeout_ms: u64,
}

#[derive(Debug, Clone)]
struct AppletQuotaRecord {
    window_start_ms: u128,
    count: u32,
}

#[derive(Debug, Clone)]
struct AtelierProjectionSubscriptionRecord {
    applet_id: String,
    session_id: String,
    agent_id: String,
    task_id: Option<String>,
    cursor_key: String,
    after_event_seq: i64,
    last_event_seq: i64,
    cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AtelierProjectionCursorStore {
    cursors: HashMap<String, i64>,
}

#[derive(Debug, Clone)]
struct AtelierProjectionSubscriptionStart {
    key: String,
    cursor_key: String,
    started: bool,
    after_event_seq: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct AtelierArtifactRefShape {
    scheme: String,
    #[serde(rename = "pathSegments")]
    path_segments: usize,
    #[serde(rename = "terminalSegment")]
    terminal_segment: String,
}

#[derive(Debug, Clone, Deserialize)]
struct AtelierArtifactPreviewContract {
    #[serde(rename = "bodyRefShape")]
    body_ref_shape: AtelierArtifactRefShape,
    #[serde(rename = "sandboxRefShape")]
    sandbox_ref_shape: AtelierArtifactRefShape,
}

#[derive(Debug, Clone, Deserialize)]
struct AtelierProjectionContract {
    #[serde(rename = "artifactPreview")]
    artifact_preview: AtelierArtifactPreviewContract,
}

#[derive(Debug, Clone)]
struct AtelierArtifactRefShapes {
    body_ref_shape: AtelierArtifactRefShape,
    sandbox_ref_shape: AtelierArtifactRefShape,
}

static APPLET_SESSION_QUOTAS: OnceLock<Mutex<HashMap<String, AppletQuotaRecord>>> = OnceLock::new();
static APPLET_CLIPBOARD_TEXT: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static APPLET_EVENT_SUBSCRIPTIONS: OnceLock<Mutex<HashMap<String, HashSet<String>>>> =
    OnceLock::new();
static APPLET_EVENT_OUTBOX: OnceLock<Mutex<HashMap<String, Vec<Value>>>> = OnceLock::new();
static ATELIER_PROJECTION_SUBSCRIPTIONS: OnceLock<
    Mutex<HashMap<String, AtelierProjectionSubscriptionRecord>>,
> = OnceLock::new();

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
        Some(serde_json::json!({ "requestId": request_id, "appletErrorCode": "INVALID_PARAMS" })),
    )
}

fn applet_fail(
    rust_code: ErrorCode,
    applet_code: &str,
    message: impl Into<String>,
    request_id: &str,
    details: Value,
) -> AppResult<StubPayload> {
    let mut detail_map = match details {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    detail_map.insert("requestId".to_string(), json!(request_id));
    detail_map.insert("appletErrorCode".to_string(), json!(applet_code));
    AppResult::fail(rust_code, message, Some(Value::Object(detail_map)))
}

fn map_capability_error(message: &str) -> (&'static str, ErrorCode) {
    let lower = message.to_ascii_lowercase();
    if lower.contains("quota") || lower.contains("payload") || lower.contains("too large") {
        ("QUOTA_EXCEEDED", ErrorCode::Conflict)
    } else if lower.contains("timeout") || lower.contains("timed out") {
        ("QUOTA_EXCEEDED", ErrorCode::Conflict)
    } else if lower.contains("raw url")
        || lower.contains("requires")
        || lower.contains("unsupported")
        || lower.contains("topic")
        || lower.contains("path must")
        || lower.contains("method")
    {
        ("INVALID_PARAMS", ErrorCode::InvalidArgument)
    } else if lower.contains("permission")
        || lower.contains("does not allow")
        || lower.contains("forbidden")
        || lower.contains("policy")
    {
        ("POLICY_DENIED", ErrorCode::Forbidden)
    } else if lower.contains("session") {
        ("INVALID_SESSION", ErrorCode::Unauthorized)
    } else if lower.contains("service is not declared")
        || lower.contains("service binding")
        || lower.contains("service ")
    {
        ("SERVICE_NOT_FOUND", ErrorCode::NotFound)
    } else if lower.contains("cancel") {
        ("TASK_CANCELLED", ErrorCode::Conflict)
    } else {
        ("CAPABILITY_FAILED", ErrorCode::InternalError)
    }
}

fn quota_store() -> &'static Mutex<HashMap<String, AppletQuotaRecord>> {
    APPLET_SESSION_QUOTAS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn gateway_limits() -> GatewayLimits {
    GatewayLimits {
        max_payload_bytes: env_usize(
            "PEERS_APPLET_MAX_PAYLOAD_BYTES",
            DEFAULT_GATEWAY_MAX_PAYLOAD_BYTES,
            16 * 1024,
            4 * 1024 * 1024,
        ),
        session_quota_per_minute: env_usize(
            "PEERS_APPLET_SESSION_QUOTA_PER_MINUTE",
            DEFAULT_GATEWAY_SESSION_QUOTA_PER_MINUTE as usize,
            1,
            10_000,
        ) as u32,
        capability_timeout_ms: env_usize(
            "PEERS_APPLET_TIMEOUT_MS",
            DEFAULT_GATEWAY_TIMEOUT_MS as usize,
            100,
            120_000,
        ) as u64,
    }
}

fn env_usize(name: &str, default: usize, min: usize, max: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| (*value >= min) && (*value <= max))
        .unwrap_or(default)
}

fn env_bool(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

fn product_executors_required(params: Option<&Value>) -> bool {
    if env_bool(PRODUCT_EXECUTORS_REQUIRED_ENV) {
        return true;
    }
    params
        .and_then(|value| {
            value
                .get("productExecutorsOnly")
                .or_else(|| value.get("product_executors_only"))
                .or_else(|| {
                    value
                        .get("options")
                        .and_then(|options| options.get("productExecutorsOnly"))
                })
                .or_else(|| {
                    value
                        .get("options")
                        .and_then(|options| options.get("product_executors_only"))
                })
        })
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn serialized_value_size(value: &Value) -> Result<usize, String> {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .map_err(|error| format!("Failed to measure JSON payload size: {}", error))
}

fn serialized_invoke_size(input: &AppletInvokeInput) -> Result<usize, String> {
    serde_json::to_vec(input)
        .map(|bytes| bytes.len())
        .map_err(|error| format!("Failed to measure applet invoke payload size: {}", error))
}

fn requested_timeout_ms(params: &Option<Value>, default_timeout_ms: u64) -> u64 {
    params
        .as_ref()
        .and_then(|value| {
            value
                .get("timeoutMs")
                .or_else(|| value.get("timeout_ms"))
                .or_else(|| {
                    value
                        .get("options")
                        .and_then(|options| options.get("timeoutMs"))
                })
                .or_else(|| {
                    value
                        .get("options")
                        .and_then(|options| options.get("timeout_ms"))
                })
        })
        .and_then(Value::as_u64)
        .filter(|timeout_ms| *timeout_ms > 0)
        .map(|timeout_ms| timeout_ms.min(default_timeout_ms))
        .unwrap_or(default_timeout_ms)
}

fn enforce_payload_limit(
    input: &AppletInvokeInput,
    request_id: &str,
    limits: GatewayLimits,
) -> Result<(), AppResult<StubPayload>> {
    let payload_bytes = match serialized_invoke_size(input) {
        Ok(size) => size,
        Err(message) => {
            return Err(applet_fail(
                ErrorCode::InvalidArgument,
                "INVALID_PARAMS",
                message,
                request_id,
                json!({}),
            ));
        }
    };
    if payload_bytes > limits.max_payload_bytes {
        return Err(applet_fail(
            ErrorCode::Conflict,
            "QUOTA_EXCEEDED",
            format!(
                "Applet invoke payload exceeds gateway limit: {} > {} bytes",
                payload_bytes, limits.max_payload_bytes
            ),
            request_id,
            json!({ "limitKind": "payload", "limitBytes": limits.max_payload_bytes, "actualBytes": payload_bytes }),
        ));
    }
    Ok(())
}

fn enforce_response_payload_limit(
    response: &Value,
    request_id: &str,
    limits: GatewayLimits,
) -> Result<(), AppResult<StubPayload>> {
    let payload_bytes = match serialized_value_size(response) {
        Ok(size) => size,
        Err(message) => {
            return Err(applet_fail(
                ErrorCode::InvalidArgument,
                "INVALID_PARAMS",
                message,
                request_id,
                json!({}),
            ));
        }
    };
    if payload_bytes > limits.max_payload_bytes {
        return Err(applet_fail(
            ErrorCode::Conflict,
            "QUOTA_EXCEEDED",
            format!(
                "Applet response payload exceeds gateway limit: {} > {} bytes",
                payload_bytes, limits.max_payload_bytes
            ),
            request_id,
            json!({ "limitKind": "response_payload", "limitBytes": limits.max_payload_bytes, "actualBytes": payload_bytes }),
        ));
    }
    Ok(())
}

fn enforce_session_quota(
    context: &AccessContext,
    request_id: &str,
    applet_id: &str,
    session_id: &str,
    capability: &str,
    limits: GatewayLimits,
) -> Result<(), AppResult<StubPayload>> {
    let key = session_store_key(applet_id, session_id);
    let now = now_millis();
    let mut guard = match quota_store().lock() {
        Ok(guard) => guard,
        Err(_) => {
            return Err(applet_fail(
                ErrorCode::InternalError,
                "CAPABILITY_FAILED",
                "Applet quota registry is unavailable",
                request_id,
                json!({ "limitKind": "quota" }),
            ));
        }
    };
    let record = guard.entry(key).or_insert_with(|| AppletQuotaRecord {
        window_start_ms: now,
        count: 0,
    });
    if now.saturating_sub(record.window_start_ms) >= GATEWAY_QUOTA_WINDOW_MS {
        record.window_start_ms = now;
        record.count = 0;
    }
    if record.count >= limits.session_quota_per_minute {
        emit_audit(
            request_id,
            "applets_invoke",
            Some(applet_id),
            capability,
            context.actor_ptid.as_deref(),
            "quota_exceeded",
        );
        return Err(applet_fail(
            ErrorCode::Conflict,
            "QUOTA_EXCEEDED",
            format!(
                "Applet session quota exceeded: {} requests per minute",
                limits.session_quota_per_minute
            ),
            request_id,
            json!({ "limitKind": "request_quota", "windowMs": GATEWAY_QUOTA_WINDOW_MS, "limit": limits.session_quota_per_minute }),
        ));
    }
    record.count += 1;
    Ok(())
}

fn capability_error_details(error_msg: &str, timeout_ms: u64) -> Value {
    let lower = error_msg.to_ascii_lowercase();
    if lower.contains("timeout") || lower.contains("timed out") {
        json!({ "limitKind": "timeout", "timeoutMs": timeout_ms })
    } else if lower.contains("quota") {
        json!({ "limitKind": "quota" })
    } else if lower.contains("payload") || lower.contains("too large") {
        json!({ "limitKind": "payload" })
    } else {
        json!({})
    }
}

fn ensure_allowed(
    context: &AccessContext,
    request_id: &str,
    command: &str,
    applet_id: Option<&str>,
    capability: &str,
) -> Result<(), AppResult<StubPayload>> {
    if is_command_capability_allowed(capability) {
        return Ok(());
    }
    emit_audit(
        request_id,
        command,
        applet_id,
        capability,
        context.actor_ptid.as_deref(),
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

fn is_command_capability_allowed(capability: &str) -> bool {
    matches!(
        capability,
        "applets.list"
            | "applets.get"
            | "applets.activate"
            | "applets.deactivate"
            | "applets.get_config"
            | "applets.set_config"
            | "applets.create_session"
            | "applets.action"
    )
}

fn ensure_manifest_authorized(
    context: &AccessContext,
    request_id: &str,
    applet_id: &str,
    input: &AppletInvokeInput,
    normalized_capability: &str,
    data_dir: &Path,
) -> Result<(String, AppletGatewayManifest), AppResult<StubPayload>> {
    if input.manifest.id != applet_id {
        emit_audit(
            request_id,
            "applets_invoke",
            Some(applet_id),
            normalized_capability,
            context.actor_ptid.as_deref(),
            "manifest_mismatch",
        );
        return Err(AppResult::fail(
            ErrorCode::Forbidden,
            "Applet manifest id does not match invoke target",
            Some(json!({ "requestId": request_id, "appletErrorCode": "INVALID_MANIFEST" })),
        ));
    }

    let requested_manifest_snapshot = match manifest_snapshot(&input.manifest) {
        Ok(snapshot) => snapshot,
        Err(message) => {
            emit_audit(
                request_id,
                "applets_invoke",
                Some(applet_id),
                normalized_capability,
                context.actor_ptid.as_deref(),
                "manifest_mismatch",
            );
            return Err(AppResult::fail(
                ErrorCode::InvalidArgument,
                message,
                Some(json!({ "requestId": request_id, "appletErrorCode": "INVALID_MANIFEST" })),
            ));
        }
    };

    let trusted_session = match ensure_active_session(
        context,
        applet_id,
        &input.session_id,
        Some(data_dir),
        requested_manifest_snapshot,
    ) {
        Ok(session) => session,
        Err(message) => {
            let is_manifest_error = message.to_ascii_lowercase().contains("manifest");
            let applet_error_code = if is_manifest_error {
                "INVALID_MANIFEST"
            } else {
                "INVALID_SESSION"
            };
            emit_audit(
                request_id,
                "applets_invoke",
                Some(applet_id),
                normalized_capability,
                context.actor_ptid.as_deref(),
                if is_manifest_error {
                    "manifest_mismatch"
                } else {
                    "invalid_session"
                },
            );
            return Err(AppResult::fail(
                if is_manifest_error {
                    ErrorCode::Forbidden
                } else {
                    ErrorCode::Unauthorized
                },
                message,
                Some(
                    json!({ "requestId": request_id, "sessionId": input.session_id, "appletErrorCode": applet_error_code }),
                ),
            ));
        }
    };

    let trusted_manifest = gateway_manifest_from_snapshot(applet_id, trusted_session.manifest)
        .map_err(|message| {
            AppResult::fail(
                ErrorCode::InternalError,
                message,
                Some(json!({ "requestId": request_id, "appletErrorCode": "INVALID_MANIFEST" })),
            )
        })?;

    let method = match capability_method(normalized_capability, input.action.as_deref()) {
        Some(value) => value,
        None => {
            return Err(AppResult::fail(
                ErrorCode::InvalidArgument,
                "Applet capability action is required",
                Some(json!({ "requestId": request_id, "appletErrorCode": "INVALID_PARAMS" })),
            ));
        }
    };

    if !authorize_manifest_permission(&trusted_manifest.permissions, &method) {
        emit_audit(
            request_id,
            "applets_invoke",
            Some(applet_id),
            &method,
            context.actor_ptid.as_deref(),
            "permission_denied",
        );
        return Err(AppResult::fail(
            ErrorCode::Forbidden,
            format!("Applet manifest does not grant permission: {}", method),
            Some(json!({ "requestId": request_id, "appletErrorCode": "PERMISSION_DENIED" })),
        ));
    }

    Ok((method, trusted_manifest))
}

fn manifest_snapshot(
    manifest: &AppletGatewayManifest,
) -> Result<AppletSessionManifestSnapshot, String> {
    let services = manifest
        .services
        .iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to snapshot applet services: {}", error))?;
    let skills = manifest
        .skills
        .iter()
        .map(|skill| {
            serde_json::to_value(skill).map(|mut value| {
                remove_null_object_field(&mut value, "executor");
                value
            })
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to snapshot applet skills: {}", error))?;
    Ok(AppletSessionManifestSnapshot {
        permissions: manifest.permissions.clone(),
        services,
        skills,
    })
}

fn remove_null_object_field(value: &mut Value, field: &str) {
    if let Value::Object(map) = value {
        if map.get(field).is_some_and(Value::is_null) {
            map.remove(field);
        }
    }
}

fn gateway_manifest_from_snapshot(
    applet_id: &str,
    snapshot: AppletSessionManifestSnapshot,
) -> Result<AppletGatewayManifest, String> {
    let services = snapshot
        .services
        .into_iter()
        .map(serde_json::from_value::<AppletGatewayService>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            format!(
                "Trusted applet session service manifest is invalid: {}",
                error
            )
        })?;
    let skills = snapshot
        .skills
        .into_iter()
        .map(serde_json::from_value::<AppletGatewaySkill>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            format!(
                "Trusted applet session skill manifest is invalid: {}",
                error
            )
        })?;
    Ok(AppletGatewayManifest {
        id: applet_id.to_string(),
        permissions: snapshot.permissions,
        services,
        skills,
    })
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
                context.actor_ptid.as_deref(),
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
        context.actor_ptid.as_deref(),
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

pub fn applets_create_session(
    context: AccessContext,
    input: AppletCreateSessionInput,
    data_dir: &Path,
) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    let applet_id = input.id.trim().to_string();
    if applet_id.is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    if input.manifest.id != applet_id {
        emit_audit(
            &request_id,
            "applets_create_session",
            Some(&applet_id),
            "applets.create_session",
            context.actor_ptid.as_deref(),
            "manifest_mismatch",
        );
        return AppResult::fail(
            ErrorCode::Forbidden,
            "Applet manifest id does not match session target",
            Some(json!({ "requestId": request_id, "appletErrorCode": "INVALID_MANIFEST" })),
        );
    }
    if let Err(error) = ensure_allowed(
        &context,
        &request_id,
        "applets_create_session",
        Some(&applet_id),
        "applets.create_session",
    ) {
        return error;
    }

    let snapshot = match manifest_snapshot(&input.manifest) {
        Ok(snapshot) => snapshot,
        Err(message) => {
            emit_audit(
                &request_id,
                "applets_create_session",
                Some(&applet_id),
                "applets.create_session",
                context.actor_ptid.as_deref(),
                "manifest_mismatch",
            );
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                message,
                Some(json!({ "requestId": request_id, "appletErrorCode": "INVALID_MANIFEST" })),
            );
        }
    };
    let session_id = input
        .session_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("desktop-{}-{}", applet_id, build_request_id()));

    match register_active_session(&context, &applet_id, &session_id, Some(data_dir), snapshot) {
        Ok(_) => {
            emit_audit(
                &request_id,
                "applets_create_session",
                Some(&applet_id),
                "applets.create_session",
                context.actor_ptid.as_deref(),
                "ok",
            );
            success_payload(
                "applets_create_session",
                json!({ "ok": true, "appletId": applet_id, "sessionId": session_id }),
            )
        }
        Err(message) => {
            let is_manifest_error = message.to_ascii_lowercase().contains("manifest");
            emit_audit(
                &request_id,
                "applets_create_session",
                Some(&applet_id),
                "applets.create_session",
                context.actor_ptid.as_deref(),
                if is_manifest_error {
                    "manifest_mismatch"
                } else {
                    "invalid_session"
                },
            );
            AppResult::fail(
                if is_manifest_error {
                    ErrorCode::Forbidden
                } else {
                    ErrorCode::Unauthorized
                },
                message,
                Some(json!({
                    "requestId": request_id,
                    "sessionId": session_id,
                    "appletErrorCode": if is_manifest_error { "INVALID_MANIFEST" } else { "INVALID_SESSION" }
                })),
            )
        }
    }
}

pub fn applets_invoke(
    context: AccessContext,
    input: AppletInvokeInput,
    data_dir: &Path,
) -> AppResult<StubPayload> {
    let request_id = build_request_id();
    let limits = gateway_limits();
    if input.id.trim().is_empty() {
        return invalid_argument("id is required", &request_id);
    }
    if input.capability.trim().is_empty() {
        return invalid_argument("capability is required", &request_id);
    }
    if let Err(error) = enforce_payload_limit(&input, &request_id, limits) {
        return error;
    }

    let normalized_capability = normalize_capability(&input.capability);
    let applet_id = input.id.trim().to_string();
    let session_id = input.session_id.clone();

    let (method, trusted_manifest) = match ensure_manifest_authorized(
        &context,
        &request_id,
        &applet_id,
        &input,
        &normalized_capability,
        data_dir,
    ) {
        Ok(authorized) => authorized,
        Err(error) => return error,
    };

    if method == "lifecycle.destroy" {
        match destroy_session(&applet_id, &session_id, Some(data_dir)) {
            Ok(()) => {
                clear_session_work(&applet_id, &session_id);
                emit_audit(
                    &request_id,
                    "applets_invoke",
                    Some(&applet_id),
                    &method,
                    context.actor_ptid.as_deref(),
                    "ok",
                );
                return success_payload("applets_invoke", json!({ "ok": true }));
            }
            Err(message) => {
                return AppResult::fail(
                    ErrorCode::Unauthorized,
                    message,
                    Some(json!({ "requestId": request_id, "appletErrorCode": "INVALID_SESSION" })),
                );
            }
        }
    }

    if let Err(error) = enforce_session_quota(
        &context,
        &request_id,
        &applet_id,
        &session_id,
        &method,
        limits,
    ) {
        return error;
    }

    let manifest = trusted_manifest;
    let params = input.params.clone();
    let action = input.action.clone();

    if let Err(error) = ensure_allowed(
        &context,
        &request_id,
        "applets_invoke",
        Some(&applet_id),
        "applets.action",
    ) {
        return error;
    }

    let timeout_ms = requested_timeout_ms(&params, limits.capability_timeout_ms);
    let result = dispatch_with_timeout(
        context.clone(),
        applet_id.clone(),
        session_id,
        request_id.clone(),
        normalized_capability.clone(),
        manifest,
        action,
        params,
        data_dir.to_path_buf(),
        timeout_ms,
    );

    match result {
        Ok(response) => {
            if let Err(error) = enforce_response_payload_limit(&response, &request_id, limits) {
                return error;
            }
            emit_audit(
                &request_id,
                "applets_invoke",
                Some(&applet_id),
                &normalized_capability,
                context.actor_ptid.as_deref(),
                "ok",
            );
            success_payload("applets_invoke", response)
        }
        Err(error_msg) => {
            emit_audit(
                &request_id,
                "applets_invoke",
                Some(&applet_id),
                &normalized_capability,
                context.actor_ptid.as_deref(),
                "error",
            );
            let (applet_code, rust_code) = map_capability_error(&error_msg);
            let details = capability_error_details(&error_msg, timeout_ms);
            applet_fail(rust_code, applet_code, error_msg, &request_id, details)
        }
    }
}

fn dispatch_with_timeout(
    context: AccessContext,
    applet_id: String,
    session_id: String,
    request_id: String,
    normalized_capability: String,
    manifest: AppletGatewayManifest,
    action: Option<String>,
    params: Option<Value>,
    data_dir: PathBuf,
    timeout_ms: u64,
) -> Result<Value, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let timeout_capability = normalized_capability.clone();
    std::thread::spawn(move || {
        let result = dispatch_applet_capability(
            &context,
            &applet_id,
            &session_id,
            &request_id,
            &normalized_capability,
            &manifest,
            action.as_deref(),
            params,
            &data_dir,
        );
        let _ = sender.send(result);
    });
    match receiver.recv_timeout(Duration::from_millis(timeout_ms)) {
        Ok(result) => result,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err(format!(
            "Applet capability timed out after {} ms: {}",
            timeout_ms, timeout_capability
        )),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            Err("Applet capability worker disconnected before returning a result".to_string())
        }
    }
}

fn dispatch_applet_capability(
    context: &AccessContext,
    applet_id: &str,
    session_id: &str,
    request_id: &str,
    normalized_capability: &str,
    manifest: &AppletGatewayManifest,
    action: Option<&str>,
    params: Option<Value>,
    data_dir: &Path,
) -> Result<Value, String> {
    match normalized_capability {
        "app" => handle_app(applet_id, session_id, action),
        "lifecycle" => handle_lifecycle(applet_id, action),
        "navigation" => handle_navigation(action, params),
        "storage" => handle_storage(applet_id, action, params, data_dir),
        "network" => handle_network(context, applet_id, manifest, action, params, data_dir),
        "config" => handle_config(applet_id, action, params, data_dir),
        "system" => handle_system(action),
        "ui" => handle_ui(action, params),
        "device" => handle_device(action, params),
        "clipboard" => handle_clipboard(applet_id, session_id, action, params),
        "file" => handle_file(applet_id, action, params, data_dir),
        "events" => handle_events(applet_id, session_id, action, params),
        "skills" => handle_skills(context, applet_id, session_id, manifest, action, params),
        "tasks" => handle_tasks(
            context, applet_id, session_id, manifest, action, params, data_dir,
        ),
        "agent" => handle_agent(context, applet_id, session_id, request_id, action, params),
        "atelier" => handle_atelier(context, applet_id, session_id, action, params, data_dir),
        "ai" => handle_ai(context, request_id, action, params),
        "telemetry" => handle_telemetry(applet_id, session_id, action, params),
        other => Err(format!("Unsupported applet capability: {}", other)),
    }
}

// ---------------------------------------------------------------------------
// Capability: storage
// ---------------------------------------------------------------------------

/// Resolve the per-applet storage file path.
fn applet_storage_path(applet_id: &str, data_dir: &Path) -> PathBuf {
    data_dir
        .join("applets")
        .join(applet_id)
        .join("storage.json")
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
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create storage directory {}: {}",
                parent.display(),
                e
            )
        })?;
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
            let used_bytes = serde_json::to_string(&map)
                .map(|content| content.len())
                .map_err(|error| format!("Failed to measure storage quota: {}", error))?;
            if used_bytes > APPLET_STORAGE_QUOTA_BYTES {
                return Err(format!(
                    "storage quota exceeded: {} > {} bytes",
                    used_bytes, APPLET_STORAGE_QUOTA_BYTES
                ));
            }
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
        "clear" => {
            write_storage_map(&storage_path, &HashMap::new())?;
            Ok(json!({ "ok": true }))
        }
        "keys" => {
            let prefix = params
                .as_ref()
                .and_then(|value| value.get("prefix"))
                .and_then(Value::as_str);
            let map = read_storage_map(&storage_path)?;
            let mut keys = map
                .keys()
                .filter(|key| prefix.map(|value| key.starts_with(value)).unwrap_or(true))
                .cloned()
                .collect::<Vec<String>>();
            keys.sort();
            Ok(json!(keys))
        }
        "getInfo" | "get_info" => {
            let map = read_storage_map(&storage_path)?;
            let used_bytes = serde_json::to_string(&map)
                .map(|content| content.len())
                .unwrap_or_default();
            Ok(json!({
                "quotaBytes": APPLET_STORAGE_QUOTA_BYTES,
                "usedBytes": used_bytes,
                "keys": map.keys().cloned().collect::<Vec<String>>()
            }))
        }
        other => Err(format!("Unsupported storage action: {}", other)),
    }
}

// ---------------------------------------------------------------------------
// Capability: app / lifecycle / system / ui / events
// ---------------------------------------------------------------------------

fn product_window_e2e_enabled() -> bool {
    std::env::var(PRODUCT_WINDOW_E2E_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

fn product_window_e2e_launch_options(applet_id: &str) -> Result<Value, String> {
    if !product_window_e2e_enabled() {
        return Ok(json!({}));
    }
    let expected_applet_id = std::env::var(PRODUCT_WINDOW_E2E_APPLET_ID_ENV).unwrap_or_default();
    if expected_applet_id.trim().is_empty() || expected_applet_id.trim() != applet_id.trim() {
        return Ok(json!({}));
    }
    let raw = std::env::var(PRODUCT_WINDOW_E2E_LAUNCH_OPTIONS_ENV).unwrap_or_default();
    if raw.trim().is_empty() {
        return Ok(json!({}));
    }
    let value: Value = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "Invalid {} JSON for app.getLaunchOptions: {}",
            PRODUCT_WINDOW_E2E_LAUNCH_OPTIONS_ENV, error
        )
    })?;
    if !value.is_object() {
        return Err(format!(
            "{} must be a JSON object for app.getLaunchOptions",
            PRODUCT_WINDOW_E2E_LAUNCH_OPTIONS_ENV
        ));
    }
    Ok(value)
}

fn record_product_window_e2e_atelier_unsubscribe(
    applet_id: &str,
    session_id: &str,
    topic: &str,
) -> Result<(), String> {
    if !product_window_e2e_enabled() || topic != "atelier.projection.event" {
        return Ok(());
    }
    let expected_applet_id = std::env::var(PRODUCT_WINDOW_E2E_APPLET_ID_ENV).unwrap_or_default();
    if expected_applet_id.trim().is_empty() || expected_applet_id.trim() != applet_id.trim() {
        return Ok(());
    }
    let output_path = match std::env::var(PRODUCT_WINDOW_E2E_ATELIER_UNSUBSCRIBE_EVIDENCE_ENV) {
        Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => return Ok(()),
    };
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create product-window Atelier unsubscribe evidence directory: {}",
                error
            )
        })?;
    }
    let evidence = json!({
        "ok": true,
        "appletId": applet_id,
        "sessionId": session_id,
        "topic": topic,
        "event": "atelier.projection.unsubscribe",
        "launchMode": "product-window-certification",
        "productShell": true,
        "recordedAt": now_millis(),
    });
    fs::write(
        &output_path,
        serde_json::to_vec_pretty(&evidence).map_err(|error| {
            format!(
                "failed to serialize product-window Atelier unsubscribe evidence: {}",
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "failed to write product-window Atelier unsubscribe evidence {}: {}",
            output_path.display(),
            error
        )
    })
}

fn handle_app(applet_id: &str, session_id: &str, action: Option<&str>) -> Result<Value, String> {
    let launch_options = product_window_e2e_launch_options(applet_id)?;
    match action.ok_or_else(|| "app capability requires an action".to_string())? {
        "getContext" | "get_context" => Ok(json!({
            "appletId": applet_id,
            "sessionId": session_id,
            "platform": "desktop",
            "runtime": "lynx-web",
            "sdkVersion": "1.0.0",
            "bridgeProtocol": "peers-touch.applet.bridge",
            "launchParams": launch_options
        })),
        "getLaunchOptions" | "get_launch_options" => Ok(launch_options),
        other => Err(format!("Unsupported app action: {}", other)),
    }
}

fn handle_lifecycle(applet_id: &str, action: Option<&str>) -> Result<Value, String> {
    match action.ok_or_else(|| "lifecycle capability requires an action".to_string())? {
        "reportReady" | "report_ready" => {
            Ok(json!({ "ok": true, "appletId": applet_id, "state": "active" }))
        }
        "onReady" | "onShow" | "onHide" | "onPause" | "onResume" | "onDestroy" => {
            Ok(json!({ "ok": true, "appletId": applet_id }))
        }
        other => Err(format!("Unsupported lifecycle action: {}", other)),
    }
}

fn handle_navigation(action: Option<&str>, params: Option<Value>) -> Result<Value, String> {
    let action = action.ok_or_else(|| "navigation capability requires an action".to_string())?;
    match action {
        "openApplet" | "open_applet" => {
            let applet_id = extract_string_param(&params, "appletId")
                .or_else(|| extract_string_param(&params, "id"))
                .ok_or_else(|| "navigation.openApplet requires params.appletId".to_string())?;
            ensure_safe_navigation_id(&applet_id, "appletId")?;
            Ok(host_navigation_command(
                "openApplet",
                json!({ "appletId": applet_id }),
            ))
        }
        "closeApplet" | "close_applet" => {
            let reason = extract_string_param(&params, "reason").unwrap_or_default();
            Ok(host_navigation_command(
                "closeApplet",
                json!({ "reason": reason }),
            ))
        }
        "navigateTo" | "navigate_to" | "redirectTo" | "redirect_to" => {
            let page = extract_string_param(&params, "page")
                .or_else(|| extract_string_param(&params, "target"))
                .ok_or_else(|| format!("navigation.{} requires params.page", action))?;
            let page = normalize_navigation_page(&page)?;
            Ok(host_navigation_command(action, json!({ "page": page })))
        }
        "back" => {
            let delta = params
                .as_ref()
                .and_then(|value| value.get("delta"))
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .clamp(1, 10);
            Ok(host_navigation_command("back", json!({ "delta": delta })))
        }
        other => Err(format!("Unsupported navigation action: {}", other)),
    }
}

fn host_navigation_command(action: &str, params: Value) -> Value {
    json!({
        "ok": true,
        "__hostCommands": [{
            "type": "navigation",
            "action": action,
            "params": params
        }]
    })
}

fn ensure_safe_navigation_id(value: &str, field: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > 128
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(format!("navigation {} is invalid: {}", field, value));
    }
    Ok(())
}

fn normalize_navigation_page(page: &str) -> Result<String, String> {
    let trimmed = page.trim();
    if let Some(applet_id) = trimmed.strip_prefix("applet:") {
        ensure_safe_navigation_id(applet_id, "page")?;
        return Ok(trimmed.to_string());
    }

    match trimmed {
        "applets" | "search" | "chat" | "agent" | "settings" => Ok(trimmed.to_string()),
        _ => Err(format!("navigation target is not allowed: {}", page)),
    }
}

fn handle_system(action: Option<&str>) -> Result<Value, String> {
    match action.ok_or_else(|| "system capability requires an action".to_string())? {
        "getInfo" | "get_info" => Ok(json!({
            "platform": "desktop",
            "version": env!("CARGO_PKG_VERSION"),
            "appName": "Peers Touch Desktop",
            "theme": "system",
            "networkType": "unknown"
        })),
        "getTheme" | "get_theme" => Ok(json!("system")),
        "getNetworkType" | "get_network_type" => Ok(json!("unknown")),
        other => Err(format!("Unsupported system action: {}", other)),
    }
}

fn handle_device(action: Option<&str>, params: Option<Value>) -> Result<Value, String> {
    match action.ok_or_else(|| "device capability requires an action".to_string())? {
        "getSafeArea" | "get_safe_area" => Ok(host_device_command("getSafeArea", json!({}), true)),
        "getWindowInfo" | "get_window_info" => {
            Ok(host_device_command("getWindowInfo", json!({}), true))
        }
        "vibrate" => {
            let duration_ms = params
                .as_ref()
                .and_then(|value| value.get("durationMs").or_else(|| value.get("duration_ms")))
                .and_then(Value::as_u64)
                .unwrap_or(10)
                .min(500);
            Ok(json!({ "ok": true, "durationMs": duration_ms }))
        }
        other => Err(format!("Unsupported device action: {}", other)),
    }
}

fn host_device_command(action: &str, params: Value, returns_result: bool) -> Value {
    json!({
        "ok": true,
        "__hostCommands": [{
            "type": "device",
            "action": action,
            "params": params,
            "returnsResult": returns_result
        }]
    })
}

fn handle_ui(action: Option<&str>, params: Option<Value>) -> Result<Value, String> {
    let action = action.ok_or_else(|| "ui capability requires an action".to_string())?;
    let params = params.unwrap_or_else(|| json!({}));
    match action {
        "showToast" | "showLoading" | "hideLoading" | "setNavigationBar" | "set_navigation_bar" => {
            Ok(host_ui_command(action, params, false))
        }
        "showModal" | "showActionSheet" => Ok(host_ui_command(action, params, true)),
        other => Err(format!("Unsupported ui action: {}", other)),
    }
}

fn host_ui_command(action: &str, params: Value, returns_result: bool) -> Value {
    json!({
        "ok": true,
        "__hostCommands": [{
            "type": "ui",
            "action": action,
            "params": params,
            "returnsResult": returns_result
        }]
    })
}

fn clipboard_store() -> &'static Mutex<HashMap<String, String>> {
    APPLET_CLIPBOARD_TEXT.get_or_init(|| Mutex::new(HashMap::new()))
}

fn clipboard_memory_fallback_enabled() -> bool {
    cfg!(test)
        || std::env::var(APPLET_CLIPBOARD_MEMORY_FALLBACK_ENV)
            .ok()
            .map(|value| value.eq_ignore_ascii_case("memory"))
            .unwrap_or(false)
}

fn read_native_clipboard_text() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("native clipboard is unavailable: {}", error))?;
    clipboard
        .get_text()
        .map_err(|error| format!("native clipboard read failed: {}", error))
}

fn write_native_clipboard_text(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("native clipboard is unavailable: {}", error))?;
    clipboard
        .set_text(text.to_string())
        .map_err(|error| format!("native clipboard write failed: {}", error))
}

fn read_applet_clipboard_text(key: &str) -> Result<String, String> {
    match read_native_clipboard_text() {
        Ok(text) => Ok(text),
        Err(_) if clipboard_memory_fallback_enabled() => {
            let guard = clipboard_store()
                .lock()
                .map_err(|_| "applet clipboard memory fallback is unavailable".to_string())?;
            Ok(guard.get(key).cloned().unwrap_or_default())
        }
        Err(native_error) => Err(native_error),
    }
}

fn write_applet_clipboard_text(key: &str, text: &str) -> Result<(), String> {
    match write_native_clipboard_text(text) {
        Ok(()) => Ok(()),
        Err(_) if clipboard_memory_fallback_enabled() => {
            let mut guard = clipboard_store()
                .lock()
                .map_err(|_| "applet clipboard memory fallback is unavailable".to_string())?;
            guard.insert(key.to_string(), text.to_string());
            Ok(())
        }
        Err(native_error) => Err(native_error),
    }
}

fn handle_clipboard(
    applet_id: &str,
    session_id: &str,
    action: Option<&str>,
    params: Option<Value>,
) -> Result<Value, String> {
    let key = session_store_key(applet_id, session_id);
    match action.ok_or_else(|| "clipboard capability requires an action".to_string())? {
        "getText" | "get_text" => Ok(json!(read_applet_clipboard_text(&key)?)),
        "setText" | "set_text" => {
            let text = extract_string_param(&params, "text")
                .ok_or_else(|| "clipboard.setText requires params.text (string)".to_string())?;
            let user_activated = params
                .as_ref()
                .and_then(|value| {
                    value
                        .get("userActivated")
                        .or_else(|| value.get("user_activated"))
                })
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !user_activated {
                return Err(
                    "clipboard.setText requires a user-activated applet gesture".to_string()
                );
            }
            write_applet_clipboard_text(&key, &text)?;
            Ok(json!({ "ok": true }))
        }
        other => Err(format!("Unsupported clipboard action: {}", other)),
    }
}

fn event_subscription_store() -> &'static Mutex<HashMap<String, HashSet<String>>> {
    APPLET_EVENT_SUBSCRIPTIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn event_outbox_store() -> &'static Mutex<HashMap<String, Vec<Value>>> {
    APPLET_EVENT_OUTBOX.get_or_init(|| Mutex::new(HashMap::new()))
}

fn atelier_projection_subscription_store(
) -> &'static Mutex<HashMap<String, AtelierProjectionSubscriptionRecord>> {
    ATELIER_PROJECTION_SUBSCRIPTIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn atelier_projection_subscription_key(
    applet_id: &str,
    session_id: &str,
    agent_id: &str,
    task_id: Option<&str>,
) -> String {
    format!(
        "{}:{}:{}:{}",
        applet_id,
        session_id,
        agent_id,
        task_id.unwrap_or("*")
    )
}

fn atelier_projection_cursor_key(applet_id: &str, agent_id: &str, task_id: Option<&str>) -> String {
    format!("{}:{}:{}", applet_id, agent_id, task_id.unwrap_or("*"))
}

fn atelier_projection_cursor_store_path(data_dir: &Path) -> PathBuf {
    data_dir
        .join("applets")
        .join("runtime")
        .join("atelier_projection_cursors.json")
}

fn load_atelier_projection_cursor_store(
    data_dir: &Path,
) -> Result<AtelierProjectionCursorStore, String> {
    let path = atelier_projection_cursor_store_path(data_dir);
    if !path.exists() {
        return Ok(AtelierProjectionCursorStore::default());
    }
    let content = fs::read_to_string(&path).map_err(|error| {
        format!(
            "Failed to read Atelier projection cursor store {}: {}",
            path.display(),
            error
        )
    })?;
    if content.trim().is_empty() {
        return Ok(AtelierProjectionCursorStore::default());
    }
    serde_json::from_str::<AtelierProjectionCursorStore>(&content).map_err(|error| {
        format!(
            "Failed to parse Atelier projection cursor store {}: {}",
            path.display(),
            error
        )
    })
}

fn persist_atelier_projection_cursor(data_dir: &Path, key: &str, seq: i64) -> Result<(), String> {
    let path = atelier_projection_cursor_store_path(data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create Atelier projection cursor store directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }
    let mut store = load_atelier_projection_cursor_store(data_dir)?;
    let seq = seq.max(0);
    let entry = store.cursors.entry(key.to_string()).or_insert(0);
    *entry = (*entry).max(seq);
    let content = serde_json::to_string_pretty(&store)
        .map_err(|error| format!("Failed to serialize Atelier projection cursor store: {error}"))?;
    fs::write(&path, content).map_err(|error| {
        format!(
            "Failed to write Atelier projection cursor store {}: {}",
            path.display(),
            error
        )
    })
}

fn load_atelier_projection_cursor(data_dir: &Path, key: &str) -> Result<i64, String> {
    Ok(load_atelier_projection_cursor_store(data_dir)?
        .cursors
        .get(key)
        .copied()
        .unwrap_or(0)
        .max(0))
}

fn ensure_atelier_projection_subscription(
    applet_id: &str,
    session_id: &str,
    agent_id: &str,
    task_id: Option<&str>,
    after_event_seq: i64,
    data_dir: &Path,
) -> Result<AtelierProjectionSubscriptionStart, String> {
    let key = atelier_projection_subscription_key(applet_id, session_id, agent_id, task_id);
    let cursor_key = atelier_projection_cursor_key(applet_id, agent_id, task_id);
    let persisted_cursor = load_atelier_projection_cursor(data_dir, &cursor_key)?;
    let mut guard = atelier_projection_subscription_store()
        .lock()
        .map_err(|_| "Atelier projection subscription registry is unavailable".to_string())?;
    if let Some(record) = guard.get_mut(&key) {
        record.last_event_seq = record
            .last_event_seq
            .max(record.after_event_seq)
            .max(persisted_cursor);
        if !record.cancelled {
            return Ok(AtelierProjectionSubscriptionStart {
                key,
                cursor_key: record.cursor_key.clone(),
                started: false,
                after_event_seq: record.last_event_seq.max(record.after_event_seq),
            });
        }
        record.cancelled = false;
        record.after_event_seq = after_event_seq.max(0).max(persisted_cursor);
        record.last_event_seq = record
            .last_event_seq
            .max(after_event_seq.max(0))
            .max(persisted_cursor);
        return Ok(AtelierProjectionSubscriptionStart {
            key,
            cursor_key: record.cursor_key.clone(),
            started: true,
            after_event_seq: record.last_event_seq.max(record.after_event_seq),
        });
    }

    let normalized_after_event_seq = after_event_seq.max(0).max(persisted_cursor);
    guard.insert(
        key.clone(),
        AtelierProjectionSubscriptionRecord {
            applet_id: applet_id.to_string(),
            session_id: session_id.to_string(),
            agent_id: agent_id.to_string(),
            task_id: task_id.map(str::to_string),
            cursor_key: cursor_key.clone(),
            after_event_seq: normalized_after_event_seq,
            last_event_seq: normalized_after_event_seq,
            cancelled: false,
        },
    );
    Ok(AtelierProjectionSubscriptionStart {
        key,
        cursor_key,
        started: true,
        after_event_seq: normalized_after_event_seq,
    })
}

fn cancel_atelier_projection_subscriptions_for_session(applet_id: &str, session_id: &str) -> bool {
    let mut cancelled_any = false;
    if let Ok(mut guard) = atelier_projection_subscription_store().lock() {
        for record in guard.values_mut() {
            if record.applet_id == applet_id && record.session_id == session_id {
                if !record.cancelled {
                    cancelled_any = true;
                }
                record.cancelled = true;
            }
        }
    }
    cancelled_any
}

fn is_atelier_projection_subscription_active(key: &str) -> bool {
    atelier_projection_subscription_store()
        .lock()
        .ok()
        .and_then(|guard| guard.get(key).map(|record| !record.cancelled))
        .unwrap_or(false)
}

fn current_atelier_projection_cursor(key: &str, fallback: i64) -> i64 {
    atelier_projection_subscription_store()
        .lock()
        .ok()
        .and_then(|guard| {
            guard
                .get(key)
                .map(|record| record.last_event_seq.max(record.after_event_seq))
        })
        .unwrap_or(fallback.max(0))
}

fn mark_atelier_projection_event_seq(
    key: &str,
    cursor_key: &str,
    seq: i64,
    data_dir: &Path,
) -> Result<(), String> {
    let seq = seq.max(0);
    if let Ok(mut guard) = atelier_projection_subscription_store().lock() {
        if let Some(record) = guard.get_mut(key) {
            record.last_event_seq = record.last_event_seq.max(seq);
        }
    }
    persist_atelier_projection_cursor(data_dir, cursor_key, seq)
}

fn handle_events(
    applet_id: &str,
    session_id: &str,
    action: Option<&str>,
    params: Option<Value>,
) -> Result<Value, String> {
    let key = session_store_key(applet_id, session_id);
    match action.ok_or_else(|| "events capability requires an action".to_string())? {
        "subscribe" => {
            let topic = extract_event_topic(&params, "events.subscribe")?;
            ensure_subscribable_event_topic(&topic)?;
            let mut guard = event_subscription_store()
                .lock()
                .map_err(|_| "applet event subscription registry is unavailable".to_string())?;
            guard.entry(key).or_default().insert(topic.clone());
            Ok(json!({ "ok": true, "topic": topic, "subscribed": true }))
        }
        "unsubscribe" => {
            let topic = extract_event_topic(&params, "events.unsubscribe")?;
            ensure_subscribable_event_topic(&topic)?;
            let mut guard = event_subscription_store()
                .lock()
                .map_err(|_| "applet event subscription registry is unavailable".to_string())?;
            if let Some(topics) = guard.get_mut(&key) {
                topics.remove(&topic);
                if topics.is_empty() {
                    guard.remove(&key);
                }
            }
            if topic == "atelier.projection.event" {
                cancel_atelier_projection_subscriptions_for_session(applet_id, session_id);
                record_product_window_e2e_atelier_unsubscribe(applet_id, session_id, &topic)?;
            }
            Ok(json!({ "ok": true, "topic": topic, "subscribed": false }))
        }
        "emit" => {
            let topic = extract_event_topic(&params, "events.emit")?;
            ensure_emit_event_topic(&topic)?;
            let payload = params
                .as_ref()
                .and_then(|value| value.get("payload"))
                .cloned()
                .unwrap_or(Value::Null);
            Ok(with_gateway_events(
                applet_id,
                session_id,
                json!({ "ok": true, "topic": topic }),
                vec![json!({ "topic": topic, "payload": payload })],
            ))
        }
        "poll" | "drain" => Ok(json!({
            "ok": true,
            "events": drain_gateway_events(applet_id, session_id)?
        })),
        other => Err(format!("Unsupported events action: {}", other)),
    }
}

fn extract_event_topic(params: &Option<Value>, operation: &str) -> Result<String, String> {
    extract_string_param(params, "topic")
        .map(|topic| topic.trim().to_string())
        .filter(|topic| !topic.is_empty())
        .ok_or_else(|| format!("{} requires params.topic (string)", operation))
}

fn is_valid_event_topic(topic: &str) -> bool {
    !topic.is_empty()
        && topic.len() <= 128
        && !topic.starts_with('.')
        && !topic.ends_with('.')
        && !topic.contains("..")
        && topic
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
}

fn is_gateway_event_topic(topic: &str) -> bool {
    matches!(
        topic,
        "task.event" | "skill.stream" | "agent.stream" | "atelier.projection.event"
    )
}

fn is_custom_event_topic(topic: &str) -> bool {
    topic.starts_with("applet.") || topic.starts_with("custom.")
}

fn is_reserved_host_event_topic(topic: &str) -> bool {
    matches!(
        topic,
        "ready" | "show" | "hide" | "pause" | "resume" | "destroy" | "launch"
    )
}

fn ensure_subscribable_event_topic(topic: &str) -> Result<(), String> {
    if !is_valid_event_topic(topic) {
        return Err(format!("event topic is invalid: {}", topic));
    }
    if is_gateway_event_topic(topic) || is_custom_event_topic(topic) {
        return Ok(());
    }
    Err(format!(
        "event topic is not allowed for applet subscription: {}",
        topic
    ))
}

fn ensure_emit_event_topic(topic: &str) -> Result<(), String> {
    if is_reserved_host_event_topic(topic) || is_gateway_event_topic(topic) {
        return Err(format!(
            "events.emit cannot publish reserved Gateway or lifecycle topic: {}",
            topic
        ));
    }
    if !is_valid_event_topic(topic) || !is_custom_event_topic(topic) {
        return Err(format!("events.emit topic is not allowed: {}", topic));
    }
    Ok(())
}

fn is_session_subscribed_to_event(applet_id: &str, session_id: &str, topic: &str) -> bool {
    event_subscription_store()
        .lock()
        .ok()
        .and_then(|guard| {
            guard
                .get(&session_store_key(applet_id, session_id))
                .map(|topics| topics.contains(topic))
        })
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Capability: network
// ---------------------------------------------------------------------------

fn handle_network(
    context: &AccessContext,
    applet_id: &str,
    manifest: &AppletGatewayManifest,
    action: Option<&str>,
    params: Option<Value>,
    data_dir: &Path,
) -> Result<Value, String> {
    let action = action.ok_or_else(|| "network capability requires an action".to_string())?;

    match action {
        "request" => {
            let params = params.ok_or_else(|| "network.request requires params".to_string())?;
            let response = perform_network_request(context, manifest, &params, "GET")?;
            Ok(
                json!({ "status": response.status, "headers": sanitize_applet_response_headers(response.headers), "body": response.body }),
            )
        }
        "upload" => {
            let mut params = params.ok_or_else(|| "network.upload requires params".to_string())?;
            let file_path = params
                .get("filePath")
                .or_else(|| params.get("file_path"))
                .and_then(Value::as_str)
                .map(str::to_string);
            if params.get("body").is_none() {
                if let Some(file_path) = file_path.as_deref() {
                    let safe_path = safe_applet_relative_path(file_path)?;
                    let absolute = applet_files_dir(applet_id, data_dir).join(safe_path);
                    let content = fs::read_to_string(&absolute).map_err(|error| {
                        format!(
                            "network.upload failed to read sandbox file {}: {}",
                            file_path, error
                        )
                    })?;
                    let file_name = params
                        .get("fileName")
                        .or_else(|| params.get("file_name"))
                        .and_then(Value::as_str)
                        .unwrap_or(file_path)
                        .to_string();
                    if let Some(map) = params.as_object_mut() {
                        map.insert(
                            "body".to_string(),
                            json!({
                                "fileName": file_name,
                                "content": content
                            }),
                        );
                    }
                }
            }
            let response = perform_network_request(context, manifest, &params, "POST")?;
            Ok(
                json!({ "status": response.status, "headers": sanitize_applet_response_headers(response.headers), "body": response.body }),
            )
        }
        "download" => {
            let params = params.ok_or_else(|| "network.download requires params".to_string())?;
            let file_path = params
                .get("filePath")
                .or_else(|| params.get("file_path"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let response = perform_network_request(context, manifest, &params, "GET")?;
            let headers = sanitize_applet_response_headers(response.headers);
            if let Some(file_path) = file_path {
                let safe_path = safe_applet_relative_path(&file_path)?;
                let file_root = applet_files_dir(applet_id, data_dir);
                let absolute = file_root.join(safe_path);
                if let Some(parent) = absolute.parent() {
                    fs::create_dir_all(parent).map_err(|error| {
                        format!(
                            "network.download failed to create file directory: {}",
                            error
                        )
                    })?;
                }
                let content = response
                    .body
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| response.body.to_string());
                fs::write(&absolute, content.as_bytes()).map_err(|error| {
                    format!(
                        "network.download failed to write sandbox file {}: {}",
                        file_path, error
                    )
                })?;
                enforce_file_quota(&file_root)?;
                Ok(
                    json!({ "status": response.status, "headers": headers, "file": { "path": file_path, "sizeBytes": content.len() } }),
                )
            } else {
                Ok(json!({ "status": response.status, "headers": headers, "body": response.body }))
            }
        }
        other => Err(format!("Unsupported network action: {}", other)),
    }
}

fn perform_network_request(
    context: &AccessContext,
    manifest: &AppletGatewayManifest,
    params: &Value,
    default_method: &str,
) -> Result<station_client::JsonHttpResponse, String> {
    if params.get("url").is_some() {
        return Err("network.request must use service and path; raw URL is forbidden".to_string());
    }

    let service = params
        .get("service")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "network request requires params.service (string)".to_string())?;

    let path = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "network request requires params.path (string)".to_string())?;

    if !path.starts_with('/') || path.contains("..") {
        return Err("network request path must be absolute and sandbox-safe".to_string());
    }
    if path.contains('?') {
        return Err("network request query must use params.query".to_string());
    }

    let method = params
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or(default_method)
        .to_uppercase();

    if !matches!(
        method.as_str(),
        "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD"
    ) {
        return Err(format!("Unsupported HTTP method: {}", method));
    }

    let service = manifest
        .services
        .iter()
        .find(|candidate| candidate.id == service)
        .ok_or_else(|| format!("network request service is not declared: {}", service))?;
    ensure_service_allows(service, &method, path)?;

    let service_override = service_override_base_url(&service.id);
    if service.binding != "station-resolved" && service_override.is_none() {
        return Err(format!(
            "network request service binding is not executable by Desktop Gateway: {}",
            service.binding
        ));
    }

    let station_path = resolve_station_service_path(service, path)?;
    let query = parse_network_query(params)?;
    let body = params.get("body").cloned();
    let http_method = parse_http_method(&method)?;
    match service_override {
        Some(base_url) => station_client::request_json_response_base_url(
            &base_url,
            http_method,
            &station_path,
            &context.token,
            query.as_deref(),
            body,
        ),
        None => station_client::request_json_response(
            http_method,
            &station_path,
            &context.token,
            query.as_deref(),
            body,
        ),
    }
    .map_err(|error| format!("network gateway request failed: {}", error))
}

fn resolve_station_service_path(
    service: &AppletGatewayService,
    path: &str,
) -> Result<String, String> {
    let Some(public_prefix) = service.public_path_prefix.as_deref() else {
        return Ok(path.to_string());
    };
    let Some(station_prefix) = service.station_path_prefix.as_deref() else {
        return Ok(path.to_string());
    };
    if !is_safe_service_path_prefix(public_prefix) || !is_safe_service_path_prefix(station_prefix) {
        return Err(format!("Service {} has unsafe path prefix", service.id));
    }
    if path == public_prefix {
        return Ok(station_prefix.to_string());
    }
    let public_slash_prefix = format!("{}/", public_prefix.trim_end_matches('/'));
    if let Some(suffix) = path.strip_prefix(&public_slash_prefix) {
        return Ok(format!(
            "{}/{}",
            station_prefix.trim_end_matches('/'),
            suffix
        ));
    }
    if let Some(suffix) = path.strip_prefix(public_prefix) {
        if suffix.starts_with(':') {
            return Ok(format!(
                "{}{}",
                station_prefix.trim_end_matches('/'),
                suffix
            ));
        }
    }
    Ok(path.to_string())
}

fn is_safe_service_path_prefix(prefix: &str) -> bool {
    prefix.starts_with('/')
        && !prefix.ends_with('/')
        && !prefix.contains("..")
        && !prefix.contains('\\')
        && prefix
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '-' | '_' | ':'))
}

fn parse_network_query(params: &Value) -> Result<Option<Vec<(&str, String)>>, String> {
    let Some(query) = params.get("query") else {
        return Ok(None);
    };
    let Some(map) = query.as_object() else {
        return Err("network request params.query must be an object".to_string());
    };
    let mut pairs = Vec::new();
    for (key, value) in map {
        if key.trim().is_empty() {
            return Err("network request query keys must be non-empty".to_string());
        }
        match value {
            Value::String(text) => pairs.push((key.as_str(), text.clone())),
            Value::Number(number) => pairs.push((key.as_str(), number.to_string())),
            Value::Bool(flag) => pairs.push((key.as_str(), flag.to_string())),
            Value::Array(items) => {
                for item in items {
                    match item {
                        Value::String(text) => pairs.push((key.as_str(), text.clone())),
                        Value::Number(number) => pairs.push((key.as_str(), number.to_string())),
                        Value::Bool(flag) => pairs.push((key.as_str(), flag.to_string())),
                        _ => {
                            return Err(format!(
                                "network request query {} has unsupported value",
                                key
                            ))
                        }
                    }
                }
            }
            _ => {
                return Err(format!(
                    "network request query {} has unsupported value",
                    key
                ))
            }
        }
    }
    Ok(Some(pairs))
}

fn sanitize_applet_response_headers(headers: Value) -> Value {
    const ALLOWED_HEADERS: &[&str] = &[
        "cache-control",
        "content-length",
        "content-type",
        "etag",
        "last-modified",
        "x-correlation-id",
        "x-request-id",
    ];

    let Some(map) = headers.as_object() else {
        return json!({});
    };
    let mut sanitized = serde_json::Map::new();
    for (name, value) in map {
        let lower = name.to_ascii_lowercase();
        if ALLOWED_HEADERS.contains(&lower.as_str()) {
            sanitized.insert(lower, value.clone());
        }
    }
    Value::Object(sanitized)
}

fn service_override_base_url(service_id: &str) -> Option<String> {
    let suffix = service_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    std::env::var(format!("PEERS_APPLET_SERVICE_{}", suffix))
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| {
            value.starts_with("http://127.0.0.1:") || value.starts_with("http://localhost:")
        })
}

fn ensure_service_allows(
    service: &AppletGatewayService,
    method: &str,
    path: &str,
) -> Result<(), String> {
    if service.kind != "http" {
        return Err(format!("Unsupported service kind: {}", service.kind));
    }
    if !service
        .allowed_methods
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(method))
    {
        return Err(format!(
            "Service {} does not allow method {}",
            service.id, method
        ));
    }
    if !service
        .allowed_paths
        .iter()
        .any(|pattern| path_matches(pattern, path))
    {
        return Err(format!(
            "Service {} does not allow path {}",
            service.id, path
        ));
    }
    Ok(())
}

fn path_matches(pattern: &str, path: &str) -> bool {
    if pattern == path {
        return true;
    }
    pattern
        .strip_suffix('*')
        .map(|prefix| path.starts_with(prefix))
        .unwrap_or(false)
}

fn parse_http_method(method: &str) -> Result<Method, String> {
    method
        .parse::<Method>()
        .map_err(|error| format!("Unsupported HTTP method {}: {}", method, error))
}

// ---------------------------------------------------------------------------
// Capability: file
// ---------------------------------------------------------------------------

fn applet_files_dir(applet_id: &str, data_dir: &Path) -> PathBuf {
    data_dir.join("applets").join(applet_id).join("files")
}

fn safe_applet_relative_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim().trim_start_matches("./");
    if trimmed.is_empty()
        || trimmed.starts_with('/')
        || trimmed.contains("..")
        || trimmed.contains('\\')
    {
        return Err(format!("Applet file path is outside the sandbox: {}", path));
    }
    Ok(PathBuf::from(trimmed))
}

fn applet_file_path(applet_id: &str, data_dir: &Path, path: &str) -> Result<PathBuf, String> {
    Ok(applet_files_dir(applet_id, data_dir).join(safe_applet_relative_path(path)?))
}

fn directory_size_bytes(path: &Path) -> Result<usize, String> {
    if !path.exists() {
        return Ok(0);
    }
    let mut total = 0usize;
    for entry in fs::read_dir(path)
        .map_err(|error| format!("Failed to read file sandbox {}: {}", path.display(), error))?
    {
        let entry = entry.map_err(|error| format!("Failed to inspect file sandbox: {}", error))?;
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Failed to inspect applet file metadata: {}", error))?;
        if metadata.is_dir() {
            total = total.saturating_add(directory_size_bytes(&entry.path())?);
        } else {
            total = total.saturating_add(metadata.len() as usize);
        }
    }
    Ok(total)
}

fn enforce_file_quota(root: &Path) -> Result<(), String> {
    let used_bytes = directory_size_bytes(root)?;
    if used_bytes > APPLET_FILE_QUOTA_BYTES {
        return Err(format!(
            "file quota exceeded: {} > {} bytes",
            used_bytes, APPLET_FILE_QUOTA_BYTES
        ));
    }
    Ok(())
}

fn collect_file_entries(
    root: &Path,
    current: &Path,
    entries: &mut Vec<Value>,
) -> Result<(), String> {
    if !current.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(current).map_err(|error| {
        format!(
            "Failed to read file sandbox {}: {}",
            current.display(),
            error
        )
    })? {
        let entry = entry.map_err(|error| format!("Failed to inspect file sandbox: {}", error))?;
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Failed to inspect applet file metadata: {}", error))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|error| format!("Failed to resolve sandbox file path: {}", error))?
            .to_string_lossy()
            .replace('\\', "/");
        if metadata.is_dir() {
            entries.push(json!({ "path": relative, "kind": "directory", "sizeBytes": 0 }));
            collect_file_entries(root, &path, entries)?;
        } else {
            entries.push(json!({ "path": relative, "kind": "file", "sizeBytes": metadata.len() }));
        }
    }
    Ok(())
}

fn handle_file(
    applet_id: &str,
    action: Option<&str>,
    params: Option<Value>,
    data_dir: &Path,
) -> Result<Value, String> {
    let root = applet_files_dir(applet_id, data_dir);
    match action.ok_or_else(|| "file capability requires an action".to_string())? {
        "read" => {
            let path = extract_string_param(&params, "path")
                .ok_or_else(|| "file.read requires params.path (string)".to_string())?;
            let absolute = applet_file_path(applet_id, data_dir, &path)?;
            let content = fs::read_to_string(&absolute)
                .map_err(|error| format!("Failed to read applet file {}: {}", path, error))?;
            Ok(
                json!({ "path": path, "content": content, "sizeBytes": content.len(), "encoding": "utf8" }),
            )
        }
        "write" => {
            let path = extract_string_param(&params, "path")
                .ok_or_else(|| "file.write requires params.path (string)".to_string())?;
            let content = extract_string_param(&params, "content")
                .ok_or_else(|| "file.write requires params.content (string)".to_string())?;
            let absolute = applet_file_path(applet_id, data_dir, &path)?;
            if let Some(parent) = absolute.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Failed to create applet file directory: {}", error)
                })?;
            }
            fs::write(&absolute, content.as_bytes())
                .map_err(|error| format!("Failed to write applet file {}: {}", path, error))?;
            enforce_file_quota(&root)?;
            Ok(json!({ "path": path, "sizeBytes": content.len() }))
        }
        "delete" => {
            let path = extract_string_param(&params, "path")
                .ok_or_else(|| "file.delete requires params.path (string)".to_string())?;
            let absolute = applet_file_path(applet_id, data_dir, &path)?;
            if absolute.exists() {
                fs::remove_file(&absolute)
                    .map_err(|error| format!("Failed to delete applet file {}: {}", path, error))?;
            }
            Ok(json!({ "ok": true }))
        }
        "list" => {
            let scope = extract_string_param(&params, "path").unwrap_or_else(|| ".".to_string());
            let base = if scope == "." {
                root.clone()
            } else {
                root.join(safe_applet_relative_path(&scope)?)
            };
            let mut entries = Vec::new();
            collect_file_entries(&root, &base, &mut entries)?;
            entries.sort_by(|left, right| left["path"].as_str().cmp(&right["path"].as_str()));
            Ok(Value::Array(entries))
        }
        "getInfo" | "get_info" => {
            let mut entries = Vec::new();
            collect_file_entries(&root, &root, &mut entries)?;
            entries.sort_by(|left, right| left["path"].as_str().cmp(&right["path"].as_str()));
            Ok(json!({
                "quotaBytes": APPLET_FILE_QUOTA_BYTES,
                "usedBytes": directory_size_bytes(&root)?,
                "entries": entries
            }))
        }
        other => Err(format!("Unsupported file action: {}", other)),
    }
}

// ---------------------------------------------------------------------------
// Capability: skills / tasks / agent / ai / telemetry
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppletTaskRecord {
    task_id: String,
    request_id: String,
    applet_id: String,
    session_id: String,
    state: String,
    input: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    output: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    updated_at: String,
    sequence: u64,
    #[serde(default)]
    started_at_ms: u128,
    #[serde(default)]
    complete_after_ms: u64,
}

static APPLET_TASKS: OnceLock<Mutex<HashMap<String, AppletTaskRecord>>> = OnceLock::new();
static APPLET_RUNTIME_SKILLS: OnceLock<Mutex<HashMap<String, Vec<Value>>>> = OnceLock::new();

fn task_store() -> &'static Mutex<HashMap<String, AppletTaskRecord>> {
    APPLET_TASKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn task_store_path(data_dir: &Path) -> PathBuf {
    data_dir.join("applets").join("runtime").join("tasks.json")
}

fn load_persisted_tasks(data_dir: &Path) -> Result<(), String> {
    let path = task_store_path(data_dir);
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path).map_err(|error| {
        format!(
            "Failed to read applet task store {}: {}",
            path.display(),
            error
        )
    })?;
    if content.trim().is_empty() {
        return Ok(());
    }
    let persisted =
        serde_json::from_str::<HashMap<String, AppletTaskRecord>>(&content).map_err(|error| {
            format!(
                "Failed to parse applet task store {}: {}",
                path.display(),
                error
            )
        })?;
    let mut guard = task_store()
        .lock()
        .map_err(|_| "applet task store is unavailable".to_string())?;
    for (task_id, record) in persisted {
        guard.entry(task_id).or_insert(record);
    }
    Ok(())
}

fn persist_tasks(data_dir: &Path) -> Result<(), String> {
    let path = task_store_path(data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create applet task store directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }
    let guard = task_store()
        .lock()
        .map_err(|_| "applet task store is unavailable".to_string())?;
    let content = serde_json::to_string_pretty(&*guard)
        .map_err(|error| format!("Failed to serialize applet task store: {}", error))?;
    fs::write(&path, content).map_err(|error| {
        format!(
            "Failed to write applet task store {}: {}",
            path.display(),
            error
        )
    })
}

#[cfg(test)]
fn remove_task_record_for_test(task_id: &str) {
    if let Ok(mut guard) = task_store().lock() {
        guard.remove(task_id);
    }
}

#[cfg(test)]
fn set_quota_record_for_test(applet_id: &str, session_id: &str, count: u32) {
    if let Ok(mut guard) = quota_store().lock() {
        guard.insert(
            session_store_key(applet_id, session_id),
            AppletQuotaRecord {
                window_start_ms: now_millis(),
                count,
            },
        );
    }
}

fn runtime_skill_store() -> &'static Mutex<HashMap<String, Vec<Value>>> {
    APPLET_RUNTIME_SKILLS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn session_store_key(applet_id: &str, session_id: &str) -> String {
    format!("{}:{}", applet_id, session_id)
}

fn clear_session_work(applet_id: &str, session_id: &str) {
    let key = session_store_key(applet_id, session_id);
    if let Ok(mut guard) = task_store().lock() {
        guard.retain(|_, record| record.applet_id != applet_id || record.session_id != session_id);
    }
    if let Ok(mut guard) = runtime_skill_store().lock() {
        guard.remove(&key);
    }
    let mut had_atelier_projection_event_topic = false;
    if let Ok(mut guard) = event_subscription_store().lock() {
        had_atelier_projection_event_topic = guard
            .get(&key)
            .is_some_and(|topics| topics.contains("atelier.projection.event"));
        guard.remove(&key);
    }
    let cancelled_atelier_projection =
        cancel_atelier_projection_subscriptions_for_session(applet_id, session_id);
    if had_atelier_projection_event_topic || cancelled_atelier_projection {
        if let Err(error) = record_product_window_e2e_atelier_unsubscribe(
            applet_id,
            session_id,
            "atelier.projection.event",
        ) {
            tracing::warn!(
                error = %error,
                applet_id = %applet_id,
                session_id = %session_id,
                "Failed to record product-window Atelier unsubscribe evidence during session teardown",
            );
        }
    }
    if let Ok(mut guard) = event_outbox_store().lock() {
        guard.remove(&key);
    }
    if let Ok(mut guard) = quota_store().lock() {
        guard.remove(&key);
    }
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn now_timestamp() -> String {
    let millis = now_millis();
    let seconds = (millis / 1000) as i64;
    let nanos = ((millis % 1000) * 1_000_000) as u32;
    match time::OffsetDateTime::from_unix_timestamp(seconds) {
        Ok(timestamp) => timestamp
            .replace_nanosecond(nanos)
            .unwrap_or(timestamp)
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| millis.to_string()),
        Err(_) => millis.to_string(),
    }
}

fn with_gateway_events(
    applet_id: &str,
    session_id: &str,
    mut response: Value,
    events: Vec<Value>,
) -> Value {
    let deliverable_events = events
        .into_iter()
        .filter(|event| {
            event
                .get("topic")
                .and_then(Value::as_str)
                .map(|topic| is_session_subscribed_to_event(applet_id, session_id, topic))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    if !deliverable_events.is_empty() {
        if let Some(map) = response.as_object_mut() {
            map.insert("__events".to_string(), Value::Array(deliverable_events));
        }
    }
    response
}

fn enqueue_gateway_events(
    applet_id: &str,
    session_id: &str,
    events: Vec<Value>,
) -> Result<(), String> {
    let deliverable_events = events
        .into_iter()
        .filter(|event| {
            event
                .get("topic")
                .and_then(Value::as_str)
                .map(|topic| is_session_subscribed_to_event(applet_id, session_id, topic))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    if deliverable_events.is_empty() {
        return Ok(());
    }

    let key = session_store_key(applet_id, session_id);
    let mut guard = event_outbox_store()
        .lock()
        .map_err(|_| "applet event outbox is unavailable".to_string())?;
    let entry = guard.entry(key).or_default();
    entry.extend(deliverable_events);
    if entry.len() > 128 {
        let overflow = entry.len() - 128;
        entry.drain(0..overflow);
    }
    Ok(())
}

fn drain_gateway_events(applet_id: &str, session_id: &str) -> Result<Vec<Value>, String> {
    let key = session_store_key(applet_id, session_id);
    let mut guard = event_outbox_store()
        .lock()
        .map_err(|_| "applet event outbox is unavailable".to_string())?;
    Ok(guard.remove(&key).unwrap_or_default())
}

fn task_event(record: &AppletTaskRecord, state: &str, payload: Value) -> Value {
    json!({
        "topic": "task.event",
        "payload": {
            "taskId": record.task_id,
            "requestId": record.request_id,
            "state": state,
            "payload": payload,
            "sequence": record.sequence,
            "timestamp": now_timestamp()
        }
    })
}

fn task_complete_after_ms(params: &Value) -> u64 {
    let configured = params
        .get("completeAfterMs")
        .or_else(|| params.get("complete_after_ms"))
        .or_else(|| {
            params.get("options").and_then(|options| {
                options
                    .get("completeAfterMs")
                    .or_else(|| options.get("complete_after_ms"))
            })
        })
        .and_then(Value::as_u64)
        .or_else(|| {
            std::env::var("PEERS_APPLET_TASK_COMPLETE_AFTER_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
        })
        .unwrap_or(DEFAULT_APPLET_TASK_COMPLETE_AFTER_MS);
    configured.min(DEFAULT_GATEWAY_TIMEOUT_MS)
}

fn advance_task_record(record: &mut AppletTaskRecord) -> Option<Value> {
    if record.state != "running" && record.state != "progress" {
        return None;
    }

    let started_at_ms = if record.started_at_ms == 0 {
        record.started_at_ms = now_millis();
        record.started_at_ms
    } else {
        record.started_at_ms
    };
    let elapsed_ms = now_millis().saturating_sub(started_at_ms);

    if elapsed_ms >= u128::from(record.complete_after_ms) {
        record.state = "completed".to_string();
        record.sequence += 1;
        record.updated_at = now_timestamp();
        record.output = Some(record.input.clone());
        record.error = None;
        return Some(task_event(
            record,
            "completed",
            json!({ "progress": 1, "output": record.output }),
        ));
    }

    let progress_at_ms = u128::from(record.complete_after_ms / 2);
    if record.state == "running" && elapsed_ms >= progress_at_ms {
        record.state = "progress".to_string();
        record.sequence += 1;
        record.updated_at = now_timestamp();
        return Some(task_event(record, "progress", json!({ "progress": 0.5 })));
    }

    None
}

fn schedule_task_completion(task_id: String, data_dir: PathBuf, complete_after_ms: u64) {
    std::thread::spawn(move || {
        if complete_after_ms > 0 {
            std::thread::sleep(Duration::from_millis(complete_after_ms));
        }

        let mut guard = match task_store().lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let Some(record) = guard.get_mut(&task_id) else {
            return;
        };
        if record.state == "completed" || record.state == "cancelled" || record.state == "failed" {
            return;
        }
        record.state = "completed".to_string();
        record.sequence += 1;
        record.updated_at = now_timestamp();
        record.output = Some(record.input.clone());
        record.error = None;
        let applet_id = record.applet_id.clone();
        let session_id = record.session_id.clone();
        let event = task_event(
            record,
            "completed",
            json!({ "progress": 1, "output": record.output }),
        );
        drop(guard);

        if let Err(error) = enqueue_gateway_events(&applet_id, &session_id, vec![event]) {
            tracing::warn!(error = %error, task_id = %task_id, "Failed to enqueue completed applet task event");
        }
        if let Err(error) = persist_tasks(&data_dir) {
            tracing::warn!(error = %error, task_id = %task_id, "Failed to persist completed applet task");
        }
    });
}

fn handle_skills(
    context: &AccessContext,
    applet_id: &str,
    session_id: &str,
    manifest: &AppletGatewayManifest,
    action: Option<&str>,
    params: Option<Value>,
) -> Result<Value, String> {
    match action.ok_or_else(|| "skills capability requires an action".to_string())? {
        "register" => {
            let spec = params
                .as_ref()
                .and_then(|value| value.get("spec"))
                .cloned()
                .ok_or_else(|| "skills.register requires params.spec".to_string())?;
            let skill_id = spec
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "skills.register requires spec.id".to_string())?
                .to_string();
            let mut descriptor = spec;
            if let Some(map) = descriptor.as_object_mut() {
                map.insert("enabled".to_string(), Value::Bool(true));
            }
            let mut guard = runtime_skill_store()
                .lock()
                .map_err(|_| "runtime skill registry is unavailable".to_string())?;
            let entry = guard
                .entry(session_store_key(applet_id, session_id))
                .or_default();
            entry
                .retain(|skill| skill.get("id").and_then(Value::as_str) != Some(skill_id.as_str()));
            entry.push(descriptor);
            Ok(json!({ "ok": true, "skillId": skill_id }))
        }
        "list" => {
            let mut skills = manifest
                .skills
                .iter()
                .map(|skill| {
                    let mut descriptor = json!({
                        "id": skill.id,
                        "inputSchema": skill.input_schema,
                        "streaming": skill.streaming,
                        "enabled": true
                    });
                    if let Some(map) = descriptor.as_object_mut() {
                        if let Some(executor) = &skill.executor {
                            map.insert("executor".to_string(), executor.clone());
                        }
                    }
                    descriptor
                })
                .collect::<Vec<_>>();
            let guard = runtime_skill_store()
                .lock()
                .map_err(|_| "runtime skill registry is unavailable".to_string())?;
            if let Some(runtime_skills) = guard.get(&session_store_key(applet_id, session_id)) {
                skills.extend(runtime_skills.iter().cloned());
            }
            Ok(Value::Array(skills))
        }
        "invoke" => invoke_skill(context, applet_id, session_id, manifest, params),
        other => Err(format!("Unsupported skills action: {}", other)),
    }
}

fn invoke_skill(
    context: &AccessContext,
    applet_id: &str,
    session_id: &str,
    manifest: &AppletGatewayManifest,
    params: Option<Value>,
) -> Result<Value, String> {
    let params = params.ok_or_else(|| "skills.invoke requires params".to_string())?;
    let skill_id = params
        .get("skillId")
        .and_then(Value::as_str)
        .ok_or_else(|| "skills.invoke requires params.skillId".to_string())?;
    let request_id = params
        .get("options")
        .and_then(|options| options.get("requestId"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(build_request_id);
    let input = params.get("input").cloned().unwrap_or(Value::Null);
    let input_policy_deny = input
        .get("policyDeny")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let input_fail = input.get("fail").and_then(Value::as_bool).unwrap_or(false);
    let stream = params
        .get("options")
        .and_then(|options| options.get("stream"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let descriptor = match skill_descriptor(applet_id, session_id, manifest, skill_id)? {
        Some(descriptor) => descriptor,
        None => {
            return Ok(
                json!({ "ok": false, "skillId": skill_id, "requestId": request_id, "error": "POLICY_DENIED: skill is not registered for this applet session" }),
            );
        }
    };

    if let Some(network_params) = skill_network_executor_params(&descriptor, &input) {
        return invoke_network_skill(
            context,
            applet_id,
            session_id,
            manifest,
            skill_id,
            &request_id,
            input,
            stream,
            network_params,
        );
    }

    if let Some(agent_params) = skill_agent_executor_params(&descriptor, &input) {
        return invoke_agent_skill(
            context,
            applet_id,
            session_id,
            manifest,
            skill_id,
            &request_id,
            input,
            stream,
            agent_params,
        );
    }

    if descriptor.get("executor").is_some() {
        return Ok(
            json!({ "ok": false, "skillId": skill_id, "requestId": request_id, "error": "CAPABILITY_FAILED: unsupported skill executor" }),
        );
    }

    if product_executors_required(Some(&params)) {
        return Ok(
            json!({ "ok": false, "skillId": skill_id, "requestId": request_id, "error": "CAPABILITY_FAILED: product skill executor is required" }),
        );
    }

    if input_policy_deny {
        return Ok(
            json!({ "ok": false, "skillId": skill_id, "requestId": request_id, "error": "POLICY_DENIED" }),
        );
    }
    if input_fail {
        return Ok(
            json!({ "ok": false, "skillId": skill_id, "requestId": request_id, "error": "CAPABILITY_FAILED" }),
        );
    }

    let events = if stream {
        vec![
            json!({ "topic": "skill.stream", "payload": { "skillId": skill_id, "requestId": request_id, "type": "progress", "payload": { "progress": 0.5 }, "sequence": 1 }}),
            json!({ "topic": "skill.stream", "payload": { "skillId": skill_id, "requestId": request_id, "type": "final", "payload": input, "sequence": 2 }}),
        ]
    } else {
        Vec::new()
    };
    Ok(with_gateway_events(
        applet_id,
        session_id,
        json!({ "ok": true, "skillId": skill_id, "requestId": request_id, "output": input }),
        events,
    ))
}

fn invoke_network_skill(
    context: &AccessContext,
    applet_id: &str,
    session_id: &str,
    manifest: &AppletGatewayManifest,
    skill_id: &str,
    request_id: &str,
    input: Value,
    stream: bool,
    network_params: Value,
) -> Result<Value, String> {
    let execution = perform_network_request(context, manifest, &network_params, "POST");
    let (result, terminal_event) = match execution {
        Ok(response) => {
            let output = json!({
                "executor": "network",
                "status": response.status,
                "headers": sanitize_applet_response_headers(response.headers),
                "body": response.body
            });
            (
                json!({ "ok": true, "skillId": skill_id, "requestId": request_id, "output": output }),
                json!({ "topic": "skill.stream", "payload": { "skillId": skill_id, "requestId": request_id, "type": "final", "payload": output, "sequence": 2 }}),
            )
        }
        Err(error) => (
            json!({ "ok": false, "skillId": skill_id, "requestId": request_id, "error": error }),
            json!({ "topic": "skill.stream", "payload": { "skillId": skill_id, "requestId": request_id, "type": "error", "payload": { "input": input, "error": error }, "sequence": 2 }}),
        ),
    };
    let events = if stream {
        vec![
            json!({ "topic": "skill.stream", "payload": { "skillId": skill_id, "requestId": request_id, "type": "progress", "payload": { "progress": 0.5 }, "sequence": 1 }}),
            terminal_event,
        ]
    } else {
        Vec::new()
    };
    Ok(with_gateway_events(applet_id, session_id, result, events))
}

fn invoke_agent_skill(
    context: &AccessContext,
    applet_id: &str,
    session_id: &str,
    manifest: &AppletGatewayManifest,
    skill_id: &str,
    request_id: &str,
    input: Value,
    stream: bool,
    agent_params: Value,
) -> Result<Value, String> {
    if !authorize_manifest_permission(&manifest.permissions, "agent.stream") {
        let error =
            "PERMISSION_DENIED: agent.stream permission is required for agent skill executor"
                .to_string();
        return Ok(skill_executor_error_result(
            applet_id, session_id, skill_id, request_id, input, stream, error,
        ));
    }

    let message = agent_params
        .get("message")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            "agent skill executor requires request.message or input.message".to_string()
        })?;
    let body = json!({
        "agentSessionId": agent_params.get("agentSessionId").cloned(),
        "message": message,
        "metadata": agent_params.get("metadata").cloned().unwrap_or_else(|| json!({})),
    });
    let execution = station_client::request_json(
        Method::POST,
        "/agent/turn/execute",
        &context.token,
        None,
        Some(body),
    )
    .map_err(|error| format!("agent skill executor request failed: {}", error));
    let (result, terminal_event) = match execution {
        Ok(response) => {
            let output = json!({
                "executor": "agent",
                "response": response
            });
            (
                json!({ "ok": true, "skillId": skill_id, "requestId": request_id, "output": output }),
                json!({ "topic": "skill.stream", "payload": { "skillId": skill_id, "requestId": request_id, "type": "final", "payload": output, "sequence": 2 }}),
            )
        }
        Err(error) => (
            json!({ "ok": false, "skillId": skill_id, "requestId": request_id, "error": error }),
            json!({ "topic": "skill.stream", "payload": { "skillId": skill_id, "requestId": request_id, "type": "error", "payload": { "input": input, "error": error }, "sequence": 2 }}),
        ),
    };
    let events = if stream {
        vec![
            json!({ "topic": "skill.stream", "payload": { "skillId": skill_id, "requestId": request_id, "type": "progress", "payload": { "progress": 0.5 }, "sequence": 1 }}),
            terminal_event,
        ]
    } else {
        Vec::new()
    };
    Ok(with_gateway_events(applet_id, session_id, result, events))
}

fn skill_executor_error_result(
    applet_id: &str,
    session_id: &str,
    skill_id: &str,
    request_id: &str,
    input: Value,
    stream: bool,
    error: String,
) -> Value {
    let result =
        json!({ "ok": false, "skillId": skill_id, "requestId": request_id, "error": error });
    let events = if stream {
        vec![
            json!({ "topic": "skill.stream", "payload": { "skillId": skill_id, "requestId": request_id, "type": "error", "payload": { "input": input, "error": error }, "sequence": 1 }}),
        ]
    } else {
        Vec::new()
    };
    with_gateway_events(applet_id, session_id, result, events)
}

fn skill_network_executor_params(descriptor: &Value, input: &Value) -> Option<Value> {
    let executor = descriptor.get("executor")?;
    if executor.get("type").and_then(Value::as_str) != Some("network") {
        return None;
    }
    let mut request = executor.get("request")?.clone();
    if request.get("body").is_none() {
        if let Some(map) = request.as_object_mut() {
            map.insert("body".to_string(), input.clone());
        }
    }
    Some(request)
}

fn skill_agent_executor_params(descriptor: &Value, input: &Value) -> Option<Value> {
    let executor = descriptor.get("executor")?;
    if executor.get("type").and_then(Value::as_str) != Some("agent") {
        return None;
    }
    let mut request = executor
        .get("request")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if let Some(map) = request.as_object_mut() {
        if map.get("message").is_none() {
            if let Some(message) = input.get("message").and_then(Value::as_str) {
                map.insert("message".to_string(), Value::String(message.to_string()));
            }
        }
        if map.get("agentSessionId").is_none() {
            if let Some(agent_session_id) = input.get("agentSessionId").and_then(Value::as_str) {
                map.insert(
                    "agentSessionId".to_string(),
                    Value::String(agent_session_id.to_string()),
                );
            }
        }
        if map.get("metadata").is_none() {
            if let Some(metadata) = input.get("metadata").cloned() {
                map.insert("metadata".to_string(), metadata);
            }
        }
    }
    Some(request)
}

fn skill_descriptor(
    applet_id: &str,
    session_id: &str,
    manifest: &AppletGatewayManifest,
    skill_id: &str,
) -> Result<Option<Value>, String> {
    if let Some(skill) = manifest.skills.iter().find(|skill| skill.id == skill_id) {
        let mut descriptor = json!({
            "id": skill.id,
            "inputSchema": skill.input_schema,
            "streaming": skill.streaming,
            "enabled": true
        });
        if let Some(map) = descriptor.as_object_mut() {
            if let Some(executor) = &skill.executor {
                map.insert("executor".to_string(), executor.clone());
            }
        }
        return Ok(Some(descriptor));
    }
    let guard = runtime_skill_store()
        .lock()
        .map_err(|_| "runtime skill registry is unavailable".to_string())?;
    Ok(guard
        .get(&session_store_key(applet_id, session_id))
        .and_then(|skills| {
            skills
                .iter()
                .find(|skill| skill.get("id").and_then(Value::as_str) == Some(skill_id))
                .cloned()
        }))
}

fn task_network_executor_params(params: &Value) -> Option<Value> {
    let executor = params
        .get("executor")
        .or_else(|| params.get("executorType"))
        .or_else(|| params.get("executor_type"))
        .or_else(|| params.get("taskType"))
        .or_else(|| params.get("task_type"))
        .and_then(Value::as_str)?;
    if executor != "network" && executor != "network.request" {
        return None;
    }

    let input = params.get("input");
    params
        .get("request")
        .or_else(|| params.get("network"))
        .or_else(|| input.and_then(|value| value.get("request")))
        .or_else(|| input.and_then(|value| value.get("network")))
        .cloned()
        .or_else(|| {
            let request_source = if params.get("service").is_some() && params.get("path").is_some()
            {
                params
            } else {
                input?
            };
            let service = request_source.get("service")?.clone();
            let path = request_source.get("path")?.clone();
            let mut request = serde_json::Map::new();
            request.insert("service".to_string(), service);
            request.insert("path".to_string(), path);
            for key in ["method", "headers", "body", "timeoutMs", "timeout_ms"] {
                if let Some(value) = request_source.get(key) {
                    request.insert(key.to_string(), value.clone());
                }
            }
            Some(Value::Object(request))
        })
}

fn task_agent_executor_params(params: &Value) -> Option<Value> {
    let executor = params
        .get("executor")
        .or_else(|| params.get("executorType"))
        .or_else(|| params.get("executor_type"))
        .or_else(|| params.get("taskType"))
        .or_else(|| params.get("task_type"))
        .and_then(Value::as_str)?;
    if executor != "agent" && executor != "agent.stream" {
        return None;
    }

    let input = params.get("input");
    let mut request = params
        .get("request")
        .or_else(|| params.get("agent"))
        .or_else(|| input.and_then(|value| value.get("request")))
        .or_else(|| input.and_then(|value| value.get("agent")))
        .cloned()
        .unwrap_or_else(|| json!({}));

    if let Some(map) = request.as_object_mut() {
        let source = input.unwrap_or(params);
        if map.get("message").is_none() {
            if let Some(message) = source.get("message").and_then(Value::as_str) {
                map.insert("message".to_string(), Value::String(message.to_string()));
            }
        }
        if map.get("agentSessionId").is_none() {
            if let Some(agent_session_id) = source.get("agentSessionId").and_then(Value::as_str) {
                map.insert(
                    "agentSessionId".to_string(),
                    Value::String(agent_session_id.to_string()),
                );
            }
        }
        if map.get("metadata").is_none() {
            if let Some(metadata) = source.get("metadata").cloned() {
                map.insert("metadata".to_string(), metadata);
            }
        }
    }

    Some(request)
}

fn handle_tasks(
    context: &AccessContext,
    applet_id: &str,
    session_id: &str,
    manifest: &AppletGatewayManifest,
    action: Option<&str>,
    params: Option<Value>,
    data_dir: &Path,
) -> Result<Value, String> {
    load_persisted_tasks(data_dir)?;
    match action.ok_or_else(|| "tasks capability requires an action".to_string())? {
        "start" => {
            let task_id = build_request_id();
            let request_id = build_request_id();
            let input = params.unwrap_or_else(|| json!({}));
            let started_at_ms = now_millis();
            let record = AppletTaskRecord {
                task_id: task_id.clone(),
                request_id,
                applet_id: applet_id.to_string(),
                session_id: session_id.to_string(),
                state: "queued".to_string(),
                input: input.clone(),
                output: None,
                error: None,
                updated_at: now_timestamp(),
                sequence: 1,
                started_at_ms,
                complete_after_ms: task_complete_after_ms(&input),
            };
            let queued = task_event(&record, "queued", json!({ "progress": 0 }));
            let mut running_record = record.clone();
            running_record.state = "running".to_string();
            running_record.sequence = 2;
            running_record.updated_at = now_timestamp();
            let running = task_event(&running_record, "running", json!({ "progress": 0.1 }));
            let mut guard = task_store()
                .lock()
                .map_err(|_| "applet task store is unavailable".to_string())?;
            guard.insert(task_id.clone(), running_record.clone());
            drop(guard);

            if let Some(network_params) = task_network_executor_params(&input) {
                let execution = perform_network_request(context, manifest, &network_params, "GET");
                let mut guard = task_store()
                    .lock()
                    .map_err(|_| "applet task store is unavailable".to_string())?;
                let record = guard
                    .get_mut(&task_id)
                    .ok_or_else(|| format!("Applet task not found after start: {}", task_id))?;
                let terminal_event = match execution {
                    Ok(response) => {
                        let output = json!({
                            "executor": "network",
                            "status": response.status,
                            "headers": sanitize_applet_response_headers(response.headers),
                            "body": response.body
                        });
                        record.state = "completed".to_string();
                        record.output = Some(output.clone());
                        record.error = None;
                        record.sequence += 1;
                        record.updated_at = now_timestamp();
                        task_event(
                            record,
                            "completed",
                            json!({ "progress": 1, "output": output }),
                        )
                    }
                    Err(error) => {
                        record.state = "failed".to_string();
                        record.output = None;
                        record.error = Some(error.clone());
                        record.sequence += 1;
                        record.updated_at = now_timestamp();
                        task_event(record, "failed", json!({ "error": error }))
                    }
                };
                let response = with_gateway_events(
                    applet_id,
                    session_id,
                    task_record_json(record),
                    vec![queued, running, terminal_event],
                );
                drop(guard);
                persist_tasks(data_dir)?;
                return Ok(response);
            }

            if let Some(agent_params) = task_agent_executor_params(&input) {
                let execution = if authorize_manifest_permission(
                    &manifest.permissions,
                    "agent.stream",
                ) {
                    agent_params
                        .get("message")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            "agent task executor requires request.message or input.message"
                                .to_string()
                        })
                        .and_then(|message| {
                            let body = json!({
                                "agentSessionId": agent_params.get("agentSessionId").cloned(),
                                "message": message,
                                "metadata": agent_params
                                    .get("metadata")
                                    .cloned()
                                    .unwrap_or_else(|| json!({})),
                            });
                            station_client::request_json(
                                Method::POST,
                                "/agent/turn/execute",
                                &context.token,
                                None,
                                Some(body),
                            )
                            .map_err(|error| {
                                format!("agent task executor request failed: {}", error)
                            })
                        })
                } else {
                    Err(
                        "PERMISSION_DENIED: agent.stream permission is required for agent task executor"
                            .to_string(),
                    )
                };
                let mut guard = task_store()
                    .lock()
                    .map_err(|_| "applet task store is unavailable".to_string())?;
                let record = guard
                    .get_mut(&task_id)
                    .ok_or_else(|| format!("Applet task not found after start: {}", task_id))?;
                let terminal_event = match execution {
                    Ok(response) => {
                        let output = json!({
                            "executor": "agent",
                            "response": response
                        });
                        record.state = "completed".to_string();
                        record.output = Some(output.clone());
                        record.error = None;
                        record.sequence += 1;
                        record.updated_at = now_timestamp();
                        task_event(
                            record,
                            "completed",
                            json!({ "progress": 1, "output": output }),
                        )
                    }
                    Err(error) => {
                        record.state = "failed".to_string();
                        record.output = None;
                        record.error = Some(error.clone());
                        record.sequence += 1;
                        record.updated_at = now_timestamp();
                        task_event(record, "failed", json!({ "error": error }))
                    }
                };
                let response = with_gateway_events(
                    applet_id,
                    session_id,
                    task_record_json(record),
                    vec![queued, running, terminal_event],
                );
                drop(guard);
                persist_tasks(data_dir)?;
                return Ok(response);
            }

            if product_executors_required(Some(&input)) {
                let mut guard = task_store()
                    .lock()
                    .map_err(|_| "applet task store is unavailable".to_string())?;
                let record = guard
                    .get_mut(&task_id)
                    .ok_or_else(|| format!("Applet task not found after start: {}", task_id))?;
                let error = "CAPABILITY_FAILED: product task executor is required".to_string();
                record.state = "failed".to_string();
                record.output = None;
                record.error = Some(error.clone());
                record.sequence += 1;
                record.updated_at = now_timestamp();
                let failed = task_event(record, "failed", json!({ "error": error }));
                let response = with_gateway_events(
                    applet_id,
                    session_id,
                    task_record_json(record),
                    vec![queued, running, failed],
                );
                drop(guard);
                persist_tasks(data_dir)?;
                return Ok(response);
            }

            persist_tasks(data_dir)?;
            schedule_task_completion(
                task_id,
                data_dir.to_path_buf(),
                running_record.complete_after_ms,
            );
            Ok(with_gateway_events(
                applet_id,
                session_id,
                task_record_json(&running_record),
                vec![queued, running],
            ))
        }
        "get" => {
            let task_id = extract_string_param(&params, "taskId")
                .ok_or_else(|| "tasks.get requires params.taskId (string)".to_string())?;
            let mut guard = task_store()
                .lock()
                .map_err(|_| "applet task store is unavailable".to_string())?;
            let record = guard
                .get_mut(&task_id)
                .filter(|record| record.applet_id == applet_id && record.session_id == session_id)
                .ok_or_else(|| format!("Applet task not found: {}", task_id))?;
            if let Some(event) = advance_task_record(record) {
                let response = with_gateway_events(
                    applet_id,
                    session_id,
                    task_record_json(record),
                    vec![event],
                );
                drop(guard);
                persist_tasks(data_dir)?;
                return Ok(response);
            }
            let response = task_record_json(record);
            drop(guard);
            persist_tasks(data_dir)?;
            Ok(response)
        }
        "cancel" => {
            let task_id = extract_string_param(&params, "taskId")
                .ok_or_else(|| "tasks.cancel requires params.taskId (string)".to_string())?;
            let mut guard = task_store()
                .lock()
                .map_err(|_| "applet task store is unavailable".to_string())?;
            let record = guard
                .get_mut(&task_id)
                .filter(|record| record.applet_id == applet_id && record.session_id == session_id)
                .ok_or_else(|| format!("Applet task not found: {}", task_id))?;
            if record.state == "completed"
                || record.state == "cancelled"
                || record.state == "failed"
            {
                let response = task_record_json(record);
                drop(guard);
                persist_tasks(data_dir)?;
                return Ok(response);
            }
            record.state = "cancelled".to_string();
            record.sequence += 1;
            record.updated_at = now_timestamp();
            let event = task_event(record, "cancelled", json!({ "cancelled": true }));
            let response =
                with_gateway_events(applet_id, session_id, task_record_json(record), vec![event]);
            drop(guard);
            persist_tasks(data_dir)?;
            Ok(response)
        }
        other => Err(format!("Unsupported tasks action: {}", other)),
    }
}

fn task_record_json(record: &AppletTaskRecord) -> Value {
    let mut payload = json!({
        "taskId": record.task_id,
        "requestId": record.request_id,
        "appletId": record.applet_id,
        "sessionId": record.session_id,
        "state": record.state,
        "input": record.input,
        "updatedAt": record.updated_at,
        "sequence": record.sequence,
        "startedAtMs": record.started_at_ms,
        "completeAfterMs": record.complete_after_ms,
    });
    if let Some(map) = payload.as_object_mut() {
        if let Some(output) = &record.output {
            map.insert("output".to_string(), output.clone());
        }
        if let Some(error) = &record.error {
            map.insert("error".to_string(), Value::String(error.clone()));
        }
    }
    payload
}

fn handle_agent(
    context: &AccessContext,
    applet_id: &str,
    session_id: &str,
    request_id: &str,
    action: Option<&str>,
    params: Option<Value>,
) -> Result<Value, String> {
    match action.ok_or_else(|| "agent capability requires an action".to_string())? {
        "startSession" | "start_session" => Ok(json!({
            "agentSessionId": format!("agent:{}:{}", applet_id, session_id),
            "requestId": request_id,
            "createdAt": now_timestamp()
        })),
        "stream" | "send" => {
            let is_stream = matches!(action, Some("stream"));
            let params = params.ok_or_else(|| "agent.send requires params".to_string())?;
            let message = params
                .get("message")
                .and_then(|value| value.as_str())
                .ok_or_else(|| "agent.send requires params.message".to_string())?;
            let body = json!({
                "agentSessionId": params.get("agentSessionId").cloned(),
                "message": message,
                "metadata": params.get("metadata").cloned().unwrap_or_else(|| json!({})),
            });
            let response = station_client::request_json(
                Method::POST,
                "/agent/turn/execute",
                &context.token,
                None,
                Some(body),
            )
            .map_err(|error| format!("agent gateway request failed: {}", error))?;
            let content = response
                .get("content")
                .or_else(|| response.get("message"))
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let message_id = response
                .get("messageId")
                .or_else(|| response.get("message_id"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .unwrap_or_else(build_request_id);
            let events = if is_stream {
                vec![
                    json!({ "topic": "agent.stream", "payload": { "requestId": request_id, "type": "thinking", "payload": { "message": "started" }, "sequence": 1 }}),
                    json!({ "topic": "agent.stream", "payload": { "requestId": request_id, "type": "partial", "payload": { "content": content }, "sequence": 2 }}),
                    json!({ "topic": "agent.stream", "payload": { "requestId": request_id, "type": "final", "payload": { "messageId": message_id, "content": content }, "sequence": 3 }}),
                ]
            } else {
                Vec::new()
            };
            Ok(with_gateway_events(
                applet_id,
                session_id,
                json!({ "requestId": request_id, "messageId": message_id, "content": content }),
                events,
            ))
        }
        other => Err(format!("Unsupported agent action: {}", other)),
    }
}

fn handle_atelier(
    context: &AccessContext,
    applet_id: &str,
    session_id: &str,
    action: Option<&str>,
    params: Option<Value>,
    data_dir: &Path,
) -> Result<Value, String> {
    match action.ok_or_else(|| "atelier capability requires an action".to_string())? {
        "workspace.load" | "workspaceLoad" | "loadWorkspace" => station_client::request_json(
            Method::POST,
            "/sub-agent/agent/atelier/workspace/load",
            &context.token,
            None,
            Some(params.unwrap_or_else(|| json!({}))),
        )
        .map_err(|error| format!("atelier gateway request failed: {}", error)),
        "project.createFromGoal" | "project.create_from_goal" | "createProjectFromGoal" => {
            station_client::request_json(
                Method::POST,
                "/sub-agent/agent/atelier/project/create-from-goal",
                &context.token,
                None,
                Some(params.unwrap_or_else(|| json!({}))),
            )
            .map_err(|error| format!("atelier gateway request failed: {}", error))
        }
        "message.send" | "messageSend" => station_client::request_json(
            Method::POST,
            "/sub-agent/agent/atelier/message/send",
            &context.token,
            None,
            Some(params.unwrap_or_else(|| json!({}))),
        )
        .map_err(|error| format!("atelier gateway request failed: {}", error)),
        "escalation.resolve" | "escalationResolve" => station_client::request_json(
            Method::POST,
            "/sub-agent/agent/atelier/escalation/resolve",
            &context.token,
            None,
            Some(params.unwrap_or_else(|| json!({}))),
        )
        .map_err(|error| format!("atelier gateway request failed: {}", error)),
        "task.setStatus" | "task.set_status" | "setTaskStatus" => station_client::request_json(
            Method::POST,
            "/sub-agent/agent/atelier/task/set-status",
            &context.token,
            None,
            Some(params.unwrap_or_else(|| json!({}))),
        )
        .map_err(|error| format!("atelier gateway request failed: {}", error)),
        "task.purge" | "purgeTask" => station_client::request_json(
            Method::POST,
            "/sub-agent/agent/atelier/task/purge",
            &context.token,
            None,
            Some(params.unwrap_or_else(|| json!({}))),
        )
        .map_err(|error| format!("atelier gateway request failed: {}", error)),
        "provider.capabilities" | "providerCapabilities" => station_client::request_json(
            Method::POST,
            "/sub-agent/agent/atelier/provider/capabilities",
            &context.token,
            None,
            Some(params.unwrap_or_else(|| json!({}))),
        )
        .map_err(|error| format!("atelier gateway request failed: {}", error)),
        "feedback.submit" | "feedbackSubmit" => station_client::request_json(
            Method::POST,
            "/sub-agent/agent/atelier/feedback/submit",
            &context.token,
            None,
            Some(params.unwrap_or_else(|| json!({}))),
        )
        .map_err(|error| format!("atelier gateway request failed: {}", error)),
        "memory.confirmCandidate" | "memoryConfirmCandidate" => station_client::request_json(
            Method::POST,
            "/sub-agent/agent/atelier/memory/confirm-candidate",
            &context.token,
            None,
            Some(params.unwrap_or_else(|| json!({}))),
        )
        .map_err(|error| format!("atelier gateway request failed: {}", error)),
        "feedback.confirmRerun" | "feedbackConfirmRerun" => station_client::request_json(
            Method::POST,
            "/sub-agent/agent/atelier/feedback/confirm-rerun",
            &context.token,
            None,
            Some(params.unwrap_or_else(|| json!({}))),
        )
        .map_err(|error| format!("atelier gateway request failed: {}", error)),
        "workspace.open" | "workspaceOpen" => {
            handle_atelier_workspace_open(applet_id, session_id, params)
        }
        "artifact.body.fetch" | "artifactBodyFetch" => station_client::request_json(
            Method::POST,
            "/sub-agent/agent/atelier/artifact/body/fetch",
            &context.token,
            None,
            Some(params.unwrap_or_else(|| json!({}))),
        )
        .map_err(|error| format!("atelier gateway request failed: {}", error)),
        "artifact.preview.open" | "artifactPreviewOpen" => {
            handle_atelier_artifact_preview_open(params)
        }
        "events.subscribe" | "eventsSubscribe" => {
            let params = params.unwrap_or_else(|| json!({}));
            let agent_id = params
                .get("agentId")
                .or_else(|| params.get("agent_id"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "atelier.events.subscribe requires params.agentId".to_string())?
                .to_string();
            let task_id = params
                .get("taskId")
                .or_else(|| params.get("task_id"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let after_event_seq = params
                .get("afterEventSeq")
                .or_else(|| params.get("after_event_seq"))
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let subscription = start_atelier_projection_event_stream(
                applet_id.to_string(),
                session_id.to_string(),
                agent_id.clone(),
                task_id,
                after_event_seq,
                context.token.clone(),
                data_dir.to_path_buf(),
            )?;
            Ok(json!({
                "ok": true,
                "agentId": agent_id,
                "topic": "atelier.projection.event",
                "reused": !subscription.started,
                "afterEventSeq": subscription.after_event_seq
            }))
        }
        other => Err(format!("Unsupported atelier action: {}", other)),
    }
}

fn handle_atelier_workspace_open(
    applet_id: &str,
    session_id: &str,
    params: Option<Value>,
) -> Result<Value, String> {
    let params = params.unwrap_or_else(|| json!({}));
    let task_id = params
        .get("taskId")
        .or_else(|| params.get("task_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "atelier.workspace.open requires params.taskId".to_string())?;
    let workspace_uri = params
        .get("workspaceUri")
        .or_else(|| params.get("workspace_uri"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "atelier.workspace.open requires params.workspaceUri".to_string())?;
    validate_atelier_workspace_open_uri(task_id, workspace_uri)?;
    let ide_hint = params
        .get("ideHint")
        .or_else(|| params.get("ide_hint"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("vscode");
    let response = json!({
        "accepted": true,
        "opened": false,
        "taskId": task_id,
        "workspaceUri": workspace_uri,
        "ideHint": ide_hint,
        "mode": "host_intent",
        "reason": "Desktop Host accepted a validated Atelier workspace open intent; native IDE launch is gated for real E2E."
    });
    record_atelier_full_e2e_workspace_open(
        applet_id,
        session_id,
        task_id,
        workspace_uri,
        ide_hint,
        &response,
    )?;
    record_atelier_full_e2e_ide_launch(applet_id, session_id, task_id, workspace_uri, ide_hint)?;
    Ok(response)
}

fn validate_atelier_workspace_open_uri(task_id: &str, workspace_uri: &str) -> Result<(), String> {
    let parsed = Url::parse(workspace_uri)
        .map_err(|_| "atelier.workspace.open requires a valid workspaceUri".to_string())?;
    if parsed.scheme() != "pt-workspace" {
        return Err("atelier.workspace.open only accepts pt-workspace:// URIs".to_string());
    }
    if parsed.host_str() != Some("task") {
        return Err("atelier.workspace.open requires pt-workspace://task/<taskId>".to_string());
    }
    if parsed.username() != "" || parsed.password().is_some() || parsed.port().is_some() {
        return Err("atelier.workspace.open rejects authority credentials and ports".to_string());
    }
    if parsed.fragment().is_some() {
        return Err("atelier.workspace.open rejects URI fragments".to_string());
    }
    let task_segments: Vec<&str> = parsed
        .path_segments()
        .ok_or_else(|| "atelier.workspace.open requires task path segment".to_string())?
        .collect();
    if task_segments.len() != 1
        || task_segments[0].is_empty()
        || task_segments[0].chars().any(char::is_whitespace)
    {
        return Err(
            "atelier.workspace.open requires exactly one non-empty task path segment".to_string(),
        );
    }
    if task_segments[0] != task_id {
        return Err("atelier.workspace.open task path must match params.taskId".to_string());
    }
    let query_pairs: Vec<(String, String)> = parsed
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    if query_pairs.len() != 1
        || query_pairs[0].0 != "workspace"
        || query_pairs[0].1.trim().is_empty()
    {
        return Err(
            "atelier.workspace.open requires exactly one non-empty workspace query".to_string(),
        );
    }
    if query_pairs[0].1.chars().any(char::is_whitespace) {
        return Err(
            "atelier.workspace.open workspace query must not contain whitespace".to_string(),
        );
    }
    Ok(())
}

fn handle_atelier_artifact_preview_open(params: Option<Value>) -> Result<Value, String> {
    let params = params.unwrap_or_else(|| json!({}));
    let task_id = params
        .get("taskId")
        .or_else(|| params.get("task_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "atelier.artifact.preview.open requires params.taskId".to_string())?;
    let artifact_id = params
        .get("artifactId")
        .or_else(|| params.get("artifact_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "atelier.artifact.preview.open requires params.artifactId".to_string())?;
    let sandbox_ref = params
        .get("sandboxRef")
        .or_else(|| params.get("sandbox_ref"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "atelier.artifact.preview.open requires params.sandboxRef".to_string())?;
    if !is_canonical_atelier_sandbox_ref(sandbox_ref) {
        return Err(
            "atelier.artifact.preview.open only accepts canonical atelier-sandbox:// refs"
                .to_string(),
        );
    }
    let body_ref = params
        .get("bodyRef")
        .or_else(|| params.get("body_ref"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "atelier.artifact.preview.open requires params.bodyRef".to_string())?;
    if !is_canonical_atelier_artifact_body_ref(body_ref) {
        return Err(
            "atelier.artifact.preview.open only accepts canonical artifact:// body refs"
                .to_string(),
        );
    }
    let mode = params
        .get("mode")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("sandbox_manifest");
    if mode != "sandbox_manifest" {
        return Err("atelier.artifact.preview.open only accepts sandbox_manifest mode".to_string());
    }
    let kind = params
        .get("kind")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("metadata");
    let renderer_session_id = atelier_artifact_preview_renderer_session_id(task_id, artifact_id);
    Ok(json!({
        "accepted": true,
        "opened": true,
        "prepared": true,
        "taskId": task_id,
        "artifactId": artifact_id,
        "sandboxRef": sandbox_ref,
        "bodyRef": body_ref,
        "kind": kind,
        "mode": mode,
        "rendererSessionId": renderer_session_id,
        "rendererOwner": "desktop_host",
        "rendererMode": "host_sandbox_manifest",
        "rendererStatus": "rendered",
        "rendererCapabilities": [
            "sandbox_manifest_validation",
            "artifact_body_binding",
            "host_owned_renderer_session",
            "host_visual_renderer_surface"
        ],
        "__hostCommands": [{
            "type": "ui",
            "action": "openAtelierArtifactPreview",
            "returnsResult": true,
            "params": {
                "taskId": task_id,
                "artifactId": artifact_id,
                "sandboxRef": sandbox_ref,
                "bodyRef": body_ref,
                "kind": kind,
                "mode": mode,
                "rendererSessionId": renderer_session_id,
                "rendererOwner": "desktop_host",
                "rendererMode": "host_sandbox_manifest",
                "rendererStatus": "rendered",
                "rendererCapabilities": [
                    "sandbox_manifest_validation",
                    "artifact_body_binding",
                    "host_owned_renderer_session",
                    "host_visual_renderer_surface"
                ]
            }
        }],
        "reason": "Desktop Host opened a validated Atelier sandbox preview renderer surface."
    }))
}

fn is_canonical_atelier_sandbox_ref(value: &str) -> bool {
    atelier_artifact_ref_shapes()
        .as_ref()
        .is_some_and(|shapes| is_canonical_atelier_ref(value, &shapes.sandbox_ref_shape))
}

fn is_canonical_atelier_artifact_body_ref(value: &str) -> bool {
    atelier_artifact_ref_shapes()
        .as_ref()
        .is_some_and(|shapes| is_canonical_atelier_ref(value, &shapes.body_ref_shape))
}

fn atelier_artifact_ref_shapes() -> &'static Option<AtelierArtifactRefShapes> {
    static SHAPES: OnceLock<Option<AtelierArtifactRefShapes>> = OnceLock::new();
    SHAPES.get_or_init(|| {
        let contract: AtelierProjectionContract =
            serde_json::from_str(ATELIER_PROJECTION_CONTRACT_JSON).ok()?;
        Some(AtelierArtifactRefShapes {
            body_ref_shape: contract.artifact_preview.body_ref_shape,
            sandbox_ref_shape: contract.artifact_preview.sandbox_ref_shape,
        })
    })
}

fn is_canonical_atelier_ref(value: &str, shape: &AtelierArtifactRefShape) -> bool {
    if value.chars().any(char::is_whitespace) {
        return false;
    }
    let Some((scheme, rest)) = value.split_once("://") else {
        return false;
    };
    if scheme != shape.scheme {
        return false;
    }
    let segments: Vec<&str> = rest.split('/').collect();
    segments.len() == shape.path_segments + 1
        && segments
            .last()
            .is_some_and(|segment| *segment == shape.terminal_segment.as_str())
        && segments.iter().all(|segment| !segment.is_empty())
}

fn atelier_artifact_preview_renderer_session_id(task_id: &str, artifact_id: &str) -> String {
    format!(
        "atelier-preview:{}:{}",
        atelier_preview_session_component(task_id),
        atelier_preview_session_component(artifact_id)
    )
}

fn atelier_preview_session_component(value: &str) -> String {
    let normalized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let component = normalized.trim_matches('_');
    if component.is_empty() {
        "id".to_string()
    } else {
        component.to_string()
    }
}

fn start_atelier_projection_event_stream(
    applet_id: String,
    session_id: String,
    agent_id: String,
    task_id: Option<String>,
    after_event_seq: i64,
    token: String,
    data_dir: PathBuf,
) -> Result<AtelierProjectionSubscriptionStart, String> {
    let subscription = ensure_atelier_projection_subscription(
        &applet_id,
        &session_id,
        &agent_id,
        task_id.as_deref(),
        after_event_seq,
        &data_dir,
    )?;
    if !subscription.started {
        return Ok(subscription);
    }
    let subscription_for_thread = subscription.clone();
    std::thread::spawn(move || {
        let mut backoff_ms = 250_u64;
        loop {
            if !is_atelier_projection_subscription_active(&subscription_for_thread.key) {
                break;
            }
            let cursor = current_atelier_projection_cursor(
                &subscription_for_thread.key,
                subscription_for_thread.after_event_seq,
            );
            match stream_atelier_projection_events(
                &subscription_for_thread.key,
                &subscription_for_thread.cursor_key,
                &applet_id,
                &session_id,
                &agent_id,
                task_id.as_deref(),
                cursor,
                &token,
                &data_dir,
            ) {
                Ok(()) => {
                    if !is_atelier_projection_subscription_active(&subscription_for_thread.key) {
                        break;
                    }
                    tracing::warn!(applet_id = %applet_id, "Atelier projection event stream ended; reconnecting");
                }
                Err(error) => {
                    if !is_atelier_projection_subscription_active(&subscription_for_thread.key) {
                        break;
                    }
                    if let Err(enqueue_error) = enqueue_atelier_projection_subscription_rejected(
                        &applet_id,
                        &session_id,
                        "atelier.events.subscribe",
                        &error,
                    ) {
                        tracing::warn!(error = %enqueue_error, applet_id = %applet_id, "Failed to enqueue Atelier projection subscription rejection");
                    }
                    tracing::warn!(error = %error, applet_id = %applet_id, "Atelier projection event stream failed; reconnecting");
                }
            }
            std::thread::sleep(Duration::from_millis(backoff_ms));
            backoff_ms = (backoff_ms * 2).min(5_000);
        }
    });
    Ok(subscription)
}

fn stream_atelier_projection_events(
    subscription_key: &str,
    cursor_key: &str,
    applet_id: &str,
    session_id: &str,
    agent_id: &str,
    task_id: Option<&str>,
    after_event_seq: i64,
    token: &str,
    data_dir: &Path,
) -> Result<(), String> {
    if !is_atelier_projection_subscription_active(subscription_key) {
        return Ok(());
    }
    let url = format!(
        "{}{}",
        station_client::station_base_url(),
        "/sub-agent/agent/events/subscribe"
    );
    let client = Client::builder()
        .timeout(Duration::from_millis(
            ATELIER_PROJECTION_STREAM_REQUEST_TIMEOUT_MS,
        ))
        .build()
        .map_err(|error| format!("failed to create Station Atelier event client: {error}"))?;
    let mut body = json!({
        "agent_id": agent_id,
        "after_event_seq": after_event_seq.max(0),
    });
    if let Some(task_id) = task_id.map(str::trim).filter(|value| !value.is_empty()) {
        body["task_id"] = json!(task_id);
    }
    let mut response = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", token.trim()))
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .map_err(|error| {
            if error.is_timeout() {
                format!("TIMEOUT Station Atelier event stream request failed: {error}")
            } else {
                format!("Station Atelier event stream request failed: {error}")
            }
        })?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        let body = body.trim();
        if body.is_empty() {
            return Err(format!(
                "Station Atelier event stream returned HTTP {status}"
            ));
        }
        return Err(format!(
            "Station Atelier event stream returned HTTP {status}: {body}"
        ));
    }

    let mut bytes = [0_u8; 4096];
    let mut buffer = String::new();
    loop {
        if !is_atelier_projection_subscription_active(subscription_key) {
            break;
        }
        let read = match response.read(&mut bytes) {
            Ok(read) => read,
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {
                continue;
            }
            Err(error) => {
                return Err(format!(
                    "failed to read Station Atelier event stream: {error}"
                ));
            }
        };
        if read == 0 {
            break;
        }
        buffer.push_str(&String::from_utf8_lossy(&bytes[..read]));
        while let Some(frame_end) = buffer.find("\n\n") {
            let frame = buffer[..frame_end].to_string();
            buffer = buffer[frame_end + 2..].to_string();
            if let Some((_event, data)) = parse_atelier_sse_frame(&frame) {
                if let Some(projected) = station_event_to_atelier_projection_event(data) {
                    if let Some(seq) = projected.get("seq").and_then(Value::as_i64) {
                        mark_atelier_projection_event_seq(
                            subscription_key,
                            cursor_key,
                            seq,
                            data_dir,
                        )?;
                    }
                    enqueue_gateway_events(
                        applet_id,
                        session_id,
                        vec![json!({ "topic": "atelier.projection.event", "payload": projected })],
                    )?;
                }
            }
        }
    }
    Ok(())
}

fn enqueue_atelier_projection_subscription_rejected(
    applet_id: &str,
    session_id: &str,
    method: &str,
    reason: &str,
) -> Result<(), String> {
    enqueue_gateway_events(
        applet_id,
        session_id,
        vec![json!({
            "topic": "atelier.projection.event",
            "payload": {
                "kind": "atelier.projection.subscription-rejected",
                "method": method,
                "reason": reason,
            }
        })],
    )
}

fn parse_atelier_sse_frame(frame: &str) -> Option<(String, Value)> {
    let mut event = "message".to_string();
    let mut data_lines = Vec::new();
    for line in frame.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(value) = line.strip_prefix("event:") {
            event = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("data:") {
            data_lines.push(value.trim_start().to_string());
        }
    }
    if data_lines.is_empty() {
        return None;
    }
    let data = data_lines.join("\n");
    let parsed = serde_json::from_str::<Value>(&data).unwrap_or_else(|_| json!({ "raw": data }));
    Some((event, parsed))
}

fn station_event_to_atelier_projection_event(data: Value) -> Option<Value> {
    let event_id = data
        .get("event_id")
        .or_else(|| data.get("eventId"))
        .and_then(Value::as_str)?
        .to_string();
    let metadata = data.get("metadata").and_then(Value::as_object);
    let task_id = metadata
        .and_then(|meta| meta.get("task_id").or_else(|| meta.get("taskId")))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if task_id.is_empty() {
        return None;
    }
    let seq = metadata
        .and_then(|meta| meta.get("event_seq").or_else(|| meta.get("eventSeq")))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|raw| raw.parse::<i64>().ok()))
        })
        .unwrap_or(0);
    let payload = data.get("payload").cloned().unwrap_or_else(|| json!({}));
    let text = atelier_projection_event_text(&data, &payload);
    let block_kind = payload
        .get("block_kind")
        .or_else(|| payload.get("blockKind"))
        .and_then(Value::as_str)
        .unwrap_or("agent");
    if block_kind == "decision_resolved" {
        let block_id = payload
            .get("block_id")
            .or_else(|| payload.get("blockId"))
            .and_then(Value::as_str)?;
        let choice = payload.get("choice").and_then(Value::as_str)?;
        return Some(json!({
            "id": event_id,
            "seq": seq,
            "taskId": task_id,
            "receivedAt": now_timestamp(),
            "patch": {
                "kind": "decision.resolved",
                "taskId": task_id,
                "blockId": block_id,
                "choice": choice
            }
        }));
    }
    if block_kind == "artifact" {
        let artifact_id = payload
            .get("artifact_id")
            .or_else(|| payload.get("artifactId"))
            .and_then(Value::as_str)
            .unwrap_or(&event_id);
        let name = payload
            .get("name")
            .or_else(|| payload.get("title"))
            .and_then(Value::as_str)
            .unwrap_or("artifact");
        let kind = payload
            .get("kind")
            .or_else(|| payload.get("file_kind"))
            .or_else(|| payload.get("fileKind"))
            .and_then(Value::as_str)
            .unwrap_or("markdown");
        let mut artifact = serde_json::Map::new();
        artifact.insert("id".to_string(), json!(artifact_id));
        artifact.insert("name".to_string(), json!(name));
        artifact.insert(
            "kind".to_string(),
            json!(normalize_atelier_artifact_kind(kind)),
        );
        artifact.insert(
            "meta".to_string(),
            json!(payload
                .get("meta")
                .or_else(|| payload.get("produced_by"))
                .and_then(Value::as_str)
                .unwrap_or("Artifact")),
        );
        insert_optional_string(
            &mut artifact,
            "previewHint",
            payload
                .get("preview_hint")
                .or_else(|| payload.get("previewHint")),
        );
        insert_optional_string(
            &mut artifact,
            "bodyRef",
            payload.get("body_ref").or_else(|| payload.get("bodyRef")),
        );
        insert_optional_string(
            &mut artifact,
            "bodyHash",
            payload.get("body_hash").or_else(|| payload.get("bodyHash")),
        );
        insert_optional_string(
            &mut artifact,
            "bodySize",
            payload.get("body_size").or_else(|| payload.get("bodySize")),
        );
        insert_optional_string(
            &mut artifact,
            "bodyKind",
            payload.get("body_kind").or_else(|| payload.get("bodyKind")),
        );
        if let Some(preview_target) = atelier_artifact_preview_target(&payload) {
            artifact.insert("previewTarget".to_string(), preview_target);
        }
        insert_optional_string(&mut artifact, "url", payload.get("url"));
        if let Some(paths) = payload.get("paths") {
            artifact.insert("paths".to_string(), paths.clone());
        }
        insert_optional_string(&mut artifact, "src", payload.get("src"));
        insert_optional_string(&mut artifact, "size", payload.get("size"));
        return Some(json!({
            "id": event_id,
            "seq": seq,
            "taskId": task_id,
            "receivedAt": now_timestamp(),
            "patch": {
                "kind": "artifact.upsert",
                "taskId": task_id,
                "artifact": Value::Object(artifact)
            }
        }));
    }
    if block_kind == "gate_result" {
        let gate_id = payload
            .get("gate_id")
            .or_else(|| payload.get("gateId"))
            .and_then(Value::as_str)
            .unwrap_or(&event_id);
        return Some(json!({
            "id": event_id,
            "seq": seq,
            "taskId": task_id,
            "receivedAt": now_timestamp(),
            "patch": {
                "kind": "gate.upsert",
                "taskId": task_id,
                "gate": {
                    "id": gate_id,
                    "name": payload.get("name").and_then(Value::as_str).unwrap_or("Gate"),
                    "status": normalize_atelier_gate_status(payload.get("status").and_then(Value::as_str).unwrap_or("pending")),
                    "summary": payload
                        .get("summary")
                        .or_else(|| payload.get("result_summary"))
                        .or_else(|| payload.get("resultSummary"))
                        .and_then(Value::as_str)
                        .unwrap_or("Gate result updated"),
                    "checks": payload.get("checks").cloned().unwrap_or_else(|| json!([])),
                    "artifactIds": payload
                        .get("artifact_ids")
                        .or_else(|| payload.get("artifactIds"))
                        .cloned()
                        .unwrap_or_else(|| json!([])),
                    "at": now_timestamp()
                }
            }
        }));
    }
    let block = if block_kind == "user" {
        json!({
            "kind": "user",
            "id": event_id,
            "text": text,
            "at": now_timestamp(),
            "meta": payload
        })
    } else {
        json!({
            "kind": "agent",
            "id": event_id,
            "text": text,
            "at": now_timestamp(),
            "done": true,
            "meta": payload
        })
    };
    Some(json!({
        "id": event_id,
        "seq": seq,
        "taskId": task_id,
        "receivedAt": now_timestamp(),
        "patch": {
            "kind": "stream.append",
            "taskId": task_id,
            "blocks": [block]
        }
    }))
}

fn normalize_atelier_artifact_kind(kind: &str) -> &str {
    match kind {
        "web" | "image" | "diff" => kind,
        _ => "markdown",
    }
}

fn insert_optional_string(
    map: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Option<&Value>,
) {
    let Some(value) = value else {
        return;
    };
    let text = match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        _ => return,
    };
    map.insert(key.to_string(), Value::String(text));
}

fn atelier_artifact_preview_target(payload: &Value) -> Option<Value> {
    let target = payload
        .get("preview_target")
        .or_else(|| payload.get("previewTarget"))?
        .as_object()?;
    for forbidden in [
        "markdown", "content", "body", "html", "diff", "patch", "url", "src", "iframe",
    ] {
        if target.contains_key(forbidden) {
            return None;
        }
    }
    let mut mapped = serde_json::Map::new();
    insert_optional_string(&mut mapped, "kind", target.get("kind"));
    insert_optional_string(&mut mapped, "mode", target.get("mode"));
    insert_optional_string(&mut mapped, "label", target.get("label"));
    insert_optional_string(
        &mut mapped,
        "sandboxRef",
        target
            .get("sandbox_ref")
            .or_else(|| target.get("sandboxRef")),
    );
    insert_optional_string(
        &mut mapped,
        "bodyRef",
        target.get("body_ref").or_else(|| target.get("bodyRef")),
    );
    if mapped.is_empty() {
        return None;
    }
    Some(Value::Object(mapped))
}

fn normalize_atelier_gate_status(status: &str) -> &str {
    match status {
        "running" | "passed" | "failed" | "blocked" => status,
        _ => "pending",
    }
}

fn atelier_projection_event_text(data: &Value, payload: &Value) -> String {
    if let Some(summary) = payload
        .get("text")
        .or_else(|| payload.get("message"))
        .or_else(|| payload.get("content"))
        .or_else(|| payload.get("result_summary"))
        .or_else(|| payload.get("resultSummary"))
        .or_else(|| payload.get("title"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return summary.to_string();
    }
    match data
        .get("event_type")
        .or_else(|| data.get("eventType"))
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "agent.collaboration.task.created" => "已创建协作任务".to_string(),
        "agent.collaboration.node.running" => "Agent 节点开始执行".to_string(),
        "agent.collaboration.node.completed" => "Agent 节点已完成执行".to_string(),
        "agent.collaboration.node.failed" => "Agent 节点执行失败".to_string(),
        "agent.collaboration.task.completed" => "协作任务已完成".to_string(),
        "agent.collaboration.task.failed" => "协作任务失败".to_string(),
        "agent.collaboration.task.cancelled" => "协作任务已取消".to_string(),
        _ => "收到协作编排事件".to_string(),
    }
}

fn handle_ai(
    context: &AccessContext,
    request_id: &str,
    action: Option<&str>,
    params: Option<Value>,
) -> Result<Value, String> {
    match action.ok_or_else(|| "ai capability requires an action".to_string())? {
        "generate" => invoke_ai_generate(&context.token, request_id, params),
        "chat" => invoke_ai_chat(&context.token, request_id, params),
        other => Err(format!("Unsupported ai action: {}", other)),
    }
}

fn invoke_ai_generate(
    token: &str,
    request_id: &str,
    params: Option<Value>,
) -> Result<Value, String> {
    let params = params.ok_or_else(|| "ai.generate requires params".to_string())?;
    let prompt = params
        .get("prompt")
        .and_then(Value::as_str)
        .ok_or_else(|| "ai.generate requires params.prompt".to_string())?;
    let chat = json!({
        "messages": [{ "role": "user", "content": prompt }],
        "metadata": params.get("metadata").cloned().unwrap_or_else(|| json!({}))
    });
    let result = invoke_ai_chat(token, request_id, Some(chat))?;
    let content = result
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("");
    Ok(json!({ "requestId": request_id, "content": content }))
}

fn invoke_ai_chat(token: &str, request_id: &str, params: Option<Value>) -> Result<Value, String> {
    let params = params.ok_or_else(|| "ai.chat requires params".to_string())?;
    let messages = params
        .get("messages")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "ai.chat requires params.messages".to_string())?;
    let content = messages
        .iter()
        .rev()
        .find(|message| message.get("role").and_then(|value| value.as_str()) == Some("user"))
        .and_then(|message| message.get("content"))
        .and_then(|value| value.as_str())
        .ok_or_else(|| "ai.chat requires at least one user message".to_string())?;

    let requested_provider = params
        .get("metadata")
        .and_then(|m| m.get("providerId").or_else(|| m.get("provider_id")))
        .or_else(|| params.get("providerId"))
        .or_else(|| params.get("provider_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let provider_id = if requested_provider.is_empty() {
        provider_cache::get_providers(token, "")
            .ok()
            .and_then(|providers| providers.iter().find(|p| p.enabled).map(|p| p.name.clone()))
            .ok_or_else(|| "AI provider not found: no enabled provider is configured".to_string())?
    } else {
        requested_provider
    };

    let resolved = provider_cache::resolve_credential(token, &provider_id)
        .map_err(|_| format!("AI provider not found or no credential: {}", provider_id))?;

    let model_id = params
        .get("metadata")
        .and_then(|m| m.get("model"))
        .or_else(|| params.get("model"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if model_id.is_empty() {
        return Err("ai.chat requires a model".to_string());
    }

    let effective_protocol =
        provider_remote::resolve_model_protocol(None, Some(&resolved.protocol));

    let result = provider_remote::chat_completion(
        &resolved.base_url,
        &resolved.api_key,
        &model_id,
        Some(effective_protocol),
        content,
    )
    .map_err(|error| format!("ai.chat provider request failed: {}", error))?;

    Ok(
        json!({ "requestId": request_id, "message": { "role": "assistant", "content": result.text }, "model": result.model }),
    )
}

fn handle_telemetry(
    applet_id: &str,
    session_id: &str,
    action: Option<&str>,
    params: Option<Value>,
) -> Result<Value, String> {
    match action.ok_or_else(|| "telemetry capability requires an action".to_string())? {
        "track" => {
            record_product_window_e2e_telemetry(applet_id, session_id, params.as_ref())?;
            record_product_window_e2e_atelier_rendered_projection(
                applet_id,
                session_id,
                params.as_ref(),
            )?;
            record_product_window_e2e_atelier_created_project(
                applet_id,
                session_id,
                params.as_ref(),
            )?;
            record_product_window_e2e_atelier_decision_resolved(
                applet_id,
                session_id,
                params.as_ref(),
            )?;
            record_product_window_e2e_atelier_artifact_gate_rendered(
                applet_id,
                session_id,
                params.as_ref(),
            )?;
            record_product_window_e2e_atelier_artifact_body_fetched(
                applet_id,
                session_id,
                params.as_ref(),
            )?;
            record_product_window_e2e_atelier_artifact_preview_opened(
                applet_id,
                session_id,
                params.as_ref(),
            )?;
            record_product_window_e2e_atelier_subscription_diagnostic(
                applet_id,
                session_id,
                params.as_ref(),
            )?;
            record_atelier_full_e2e_desktop_ready(applet_id, session_id, params.as_ref())?;
            Ok(json!({ "ok": true }))
        }
        "reportError" | "mark" => Ok(json!({ "ok": true })),
        other => Err(format!("Unsupported telemetry action: {}", other)),
    }
}

fn record_product_window_e2e_telemetry(
    applet_id: &str,
    session_id: &str,
    params: Option<&Value>,
) -> Result<(), String> {
    let enabled = std::env::var("PEERS_APPLET_PRODUCT_WINDOW_E2E")
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }

    let event = params.map(|value| value.get("event").unwrap_or(value));
    let name = event
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if name != "applet.readiness.flow.completed" {
        return Ok(());
    }

    let output_path = match std::env::var("PEERS_APPLET_PRODUCT_WINDOW_E2E_EVIDENCE") {
        Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => return Ok(()),
    };
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create product-window readiness evidence directory: {}",
                error
            )
        })?;
    }

    let evidence = json!({
        "ok": true,
        "appletId": applet_id,
        "sessionId": session_id,
        "launchMode": "product-window-certification",
        "productShell": true,
        "event": name,
        "properties": event
            .and_then(|value| value.get("properties"))
            .cloned()
            .unwrap_or_else(|| json!({})),
        "recordedAt": now_timestamp(),
    });
    fs::write(
        &output_path,
        serde_json::to_vec_pretty(&evidence).map_err(|error| {
            format!(
                "failed to serialize product-window readiness evidence: {}",
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "failed to write product-window readiness evidence {}: {}",
            output_path.display(),
            error
        )
    })?;
    Ok(())
}

fn record_atelier_full_e2e_desktop_ready(
    applet_id: &str,
    session_id: &str,
    params: Option<&Value>,
) -> Result<(), String> {
    let enabled = std::env::var(ATELIER_FULL_E2E_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }

    let expected_applet_id =
        std::env::var(ATELIER_FULL_E2E_APPLET_ID_ENV).unwrap_or_else(|_| "peers.atelier".into());
    if expected_applet_id.trim() != "peers.atelier" || applet_id.trim() != expected_applet_id.trim()
    {
        return Ok(());
    }

    let event = params.map(|value| value.get("event").unwrap_or(value));
    let name = event
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if name != "official_applet.bootstrap" {
        return Ok(());
    }
    let service = event
        .and_then(|value| value.get("properties"))
        .and_then(|value| value.get("service"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if service != "atelier" {
        return Err("Atelier full E2E bootstrap telemetry must prove service=atelier".to_string());
    }

    let launch_id = std::env::var(ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID_ENV)
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if launch_id.is_empty() {
        return Err(format!(
            "{} must be present for Atelier full E2E ready evidence",
            ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID_ENV
        ));
    }
    let station_url = std::env::var("PEERS_APPLET_SERVICE_ATELIER")
        .or_else(|_| std::env::var("PEERS_STATION_URL"))
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .unwrap_or_default();
    if station_url.is_empty() {
        return Err(
            "PEERS_APPLET_SERVICE_ATELIER or PEERS_STATION_URL must be present for Atelier full E2E ready evidence"
                .to_string(),
        );
    }

    let output_path = match std::env::var(ATELIER_FULL_E2E_DESKTOP_READY_EVIDENCE_ENV) {
        Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => return Ok(()),
    };
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create Atelier full E2E Desktop ready evidence directory: {}",
                error
            )
        })?;
    }

    let evidence = json!({
        "ok": true,
        "launchId": launch_id,
        "appletId": "peers.atelier",
        "sessionId": session_id,
        "readiness": "NOT_READY",
        "globalReady": false,
        "serviceBinding": {
            "service": "atelier",
            "transport": "sdk.network.request",
            "stationUrlRedacted": true,
            "stationUrlHash": atelier_full_e2e_sha256(&station_url),
            "stationPathPrefix": "/applets/atelier/v1"
        },
        "productShell": {
            "kind": "desktop_host_product_shell",
            "appletId": "peers.atelier"
        },
        "productWindow": {
            "kind": "desktop_product_window",
            "appletId": "peers.atelier",
            "mounted": true
        },
        "event": name,
        "completedAt": now_timestamp(),
    });
    fs::write(
        &output_path,
        serde_json::to_vec_pretty(&evidence).map_err(|error| {
            format!(
                "failed to serialize Atelier full E2E Desktop ready evidence: {}",
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "failed to write Atelier full E2E Desktop ready evidence {}: {}",
            output_path.display(),
            error
        )
    })
}

fn atelier_full_e2e_enabled_for(applet_id: &str) -> bool {
    let enabled = std::env::var(ATELIER_FULL_E2E_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);
    if !enabled {
        return false;
    }
    let expected_applet_id =
        std::env::var(ATELIER_FULL_E2E_APPLET_ID_ENV).unwrap_or_else(|_| "peers.atelier".into());
    expected_applet_id.trim() == "peers.atelier" && applet_id.trim() == expected_applet_id.trim()
}

fn atelier_full_e2e_sha256(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn record_atelier_full_e2e_workspace_open(
    applet_id: &str,
    session_id: &str,
    task_id: &str,
    workspace_uri: &str,
    ide_hint: &str,
    response: &Value,
) -> Result<(), String> {
    if !atelier_full_e2e_enabled_for(applet_id) {
        return Ok(());
    }
    let output_path = match std::env::var(ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE_ENV) {
        Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => return Ok(()),
    };
    let launch_id = std::env::var(ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID_ENV)
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if launch_id.is_empty() {
        return Err(format!(
            "{} must be present for Atelier full E2E workspace open evidence",
            ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID_ENV
        ));
    }
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create Atelier full E2E workspace open evidence directory: {}",
                error
            )
        })?;
    }

    let evidence = json!({
        "ok": true,
        "launchId": launch_id,
        "appletId": "peers.atelier",
        "sessionId": session_id,
        "action": "atelier.workspace.open",
        "taskId": task_id,
        "workspaceUri": workspace_uri,
        "ideHintRedacted": true,
        "ideTargetHash": atelier_full_e2e_sha256(ide_hint),
        "accepted": response.get("accepted").and_then(Value::as_bool).unwrap_or(false),
        "opened": response.get("opened").and_then(Value::as_bool).unwrap_or(false),
        "mode": response.get("mode").and_then(Value::as_str).unwrap_or("host_intent"),
        "hostSideEffect": "workspace_open_intent",
        "realIdeLaunchProven": false,
        "completedAt": now_timestamp(),
    });
    fs::write(
        &output_path,
        serde_json::to_vec_pretty(&evidence).map_err(|error| {
            format!(
                "failed to serialize Atelier full E2E workspace open evidence: {}",
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "failed to write Atelier full E2E workspace open evidence {}: {}",
            output_path.display(),
            error
        )
    })
}

fn record_atelier_full_e2e_ide_launch(
    applet_id: &str,
    session_id: &str,
    task_id: &str,
    workspace_uri: &str,
    ide_hint: &str,
) -> Result<(), String> {
    if !atelier_full_e2e_enabled_for(applet_id) {
        return Ok(());
    }
    let output_path = match std::env::var(ATELIER_FULL_E2E_IDE_LAUNCH_EVIDENCE_ENV) {
        Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => return Ok(()),
    };
    let launcher = std::env::var(ATELIER_FULL_E2E_IDE_LAUNCHER_ENV)
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if launcher.is_empty()
        || launcher.contains('\0')
        || launcher.contains('\n')
        || launcher.contains('\r')
    {
        return Err(format!(
            "{} must name a non-empty executable path for Atelier full E2E IDE launch evidence",
            ATELIER_FULL_E2E_IDE_LAUNCHER_ENV
        ));
    }
    let launch_id = std::env::var(ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID_ENV)
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if launch_id.is_empty() {
        return Err(format!(
            "{} must be present for Atelier full E2E IDE launch evidence",
            ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID_ENV
        ));
    }

    let parsed = Url::parse(workspace_uri)
        .map_err(|_| "atelier.workspace.open requires a valid workspaceUri".to_string())?;
    let workspace_id = parsed
        .query_pairs()
        .find_map(|(key, value)| (key == "workspace").then(|| value.into_owned()))
        .ok_or_else(|| {
            "atelier.workspace.open requires workspace query for IDE launch evidence".to_string()
        })?;

    let status = Command::new(&launcher)
        .arg(ide_hint)
        .arg(task_id)
        .arg(&workspace_id)
        .arg(workspace_uri)
        .status()
        .map_err(|error| {
            format!(
                "failed to run Atelier full E2E IDE launcher {}: {}",
                launcher, error
            )
        })?;
    if !status.success() {
        return Err(format!(
            "Atelier full E2E IDE launcher {} exited with status {}",
            launcher, status
        ));
    }

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create Atelier full E2E IDE launch evidence directory: {}",
                error
            )
        })?;
    }

    let evidence = json!({
        "ok": true,
        "launchId": launch_id,
        "appletId": "peers.atelier",
        "sessionId": session_id,
        "action": "atelier.workspace.open",
        "taskId": task_id,
        "workspaceUri": workspace_uri,
        "ideTargetRedacted": true,
        "ideTargetHash": atelier_full_e2e_sha256(ide_hint),
        "realIdeLaunchProven": true,
        "launchOwner": "desktop_host",
        "resolver": "desktop_host.pt_workspace_uri",
        "workspaceId": workspace_id,
        "launchCommand": "env:PEERS_ATELIER_FULL_E2E_IDE_LAUNCHER",
        "appletFileShellExecuteExposed": false,
        "appletOpenExternalUrlExposed": false,
        "completedAt": now_timestamp(),
    });
    fs::write(
        &output_path,
        serde_json::to_vec_pretty(&evidence).map_err(|error| {
            format!(
                "failed to serialize Atelier full E2E IDE launch evidence: {}",
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "failed to write Atelier full E2E IDE launch evidence {}: {}",
            output_path.display(),
            error
        )
    })
}

fn record_product_window_e2e_atelier_rendered_projection(
    applet_id: &str,
    session_id: &str,
    params: Option<&Value>,
) -> Result<(), String> {
    let enabled = std::env::var(PRODUCT_WINDOW_E2E_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }

    let expected_applet_id = std::env::var(PRODUCT_WINDOW_E2E_APPLET_ID_ENV).unwrap_or_default();
    if expected_applet_id.trim().is_empty() || expected_applet_id.trim() != applet_id.trim() {
        return Ok(());
    }

    let event = params.map(|value| value.get("event").unwrap_or(value));
    let name = event
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if name != "atelier.projection.rendered" {
        return Ok(());
    }

    let output_path =
        match std::env::var(PRODUCT_WINDOW_E2E_ATELIER_RENDERED_PROJECTION_EVIDENCE_ENV) {
            Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
            _ => return Ok(()),
        };
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create product-window Atelier rendered projection evidence directory: {}",
                error
            )
        })?;
    }

    let evidence = json!({
        "ok": true,
        "appletId": applet_id,
        "sessionId": session_id,
        "launchMode": "product-window-certification",
        "productShell": true,
        "event": name,
        "properties": event
            .and_then(|value| value.get("properties"))
            .cloned()
            .unwrap_or_else(|| json!({})),
        "recordedAt": now_millis(),
    });
    fs::write(
        &output_path,
        serde_json::to_vec_pretty(&evidence).map_err(|error| {
            format!(
                "failed to serialize product-window Atelier rendered projection evidence: {}",
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "failed to write product-window Atelier rendered projection evidence {}: {}",
            output_path.display(),
            error
        )
    })?;
    Ok(())
}

fn record_product_window_e2e_atelier_subscription_diagnostic(
    applet_id: &str,
    session_id: &str,
    params: Option<&Value>,
) -> Result<(), String> {
    let enabled = std::env::var(PRODUCT_WINDOW_E2E_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }

    let expected_applet_id = std::env::var(PRODUCT_WINDOW_E2E_APPLET_ID_ENV).unwrap_or_default();
    if expected_applet_id.trim().is_empty() || expected_applet_id.trim() != applet_id.trim() {
        return Ok(());
    }

    let event = params.map(|value| value.get("event").unwrap_or(value));
    let name = event
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if name != "atelier.projection.subscription.diagnostic" {
        return Ok(());
    }

    let output_path =
        match std::env::var(PRODUCT_WINDOW_E2E_ATELIER_SUBSCRIPTION_DIAGNOSTIC_EVIDENCE_ENV) {
            Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
            _ => return Ok(()),
        };
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create product-window Atelier subscription diagnostic evidence directory: {}",
                error
            )
        })?;
    }

    let evidence = json!({
        "ok": true,
        "appletId": applet_id,
        "sessionId": session_id,
        "launchMode": "product-window-certification",
        "productShell": true,
        "event": name,
        "properties": event
            .and_then(|value| value.get("properties"))
            .cloned()
            .unwrap_or_else(|| json!({})),
        "recordedAt": now_millis(),
    });
    let mut line = serde_json::to_vec(&evidence).map_err(|error| {
        format!(
            "failed to serialize product-window Atelier subscription diagnostic evidence: {}",
            error
        )
    })?;
    line.push(b'\n');
    let mut options = fs::OpenOptions::new();
    options.create(true).append(true);
    let mut file = options.open(&output_path).map_err(|error| {
        format!(
            "failed to open product-window Atelier subscription diagnostic evidence {}: {}",
            output_path.display(),
            error
        )
    })?;
    use std::io::Write;
    file.write_all(&line).map_err(|error| {
        format!(
            "failed to write product-window Atelier subscription diagnostic evidence {}: {}",
            output_path.display(),
            error
        )
    })?;
    Ok(())
}

fn record_product_window_e2e_atelier_created_project(
    applet_id: &str,
    session_id: &str,
    params: Option<&Value>,
) -> Result<(), String> {
    let enabled = std::env::var(PRODUCT_WINDOW_E2E_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }

    let expected_applet_id = std::env::var(PRODUCT_WINDOW_E2E_APPLET_ID_ENV).unwrap_or_default();
    if expected_applet_id.trim().is_empty() || expected_applet_id.trim() != applet_id.trim() {
        return Ok(());
    }

    let event = params.map(|value| value.get("event").unwrap_or(value));
    let name = event
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if name != "atelier.project.created.rendered" {
        return Ok(());
    }

    let output_path = match std::env::var(PRODUCT_WINDOW_E2E_ATELIER_CREATED_PROJECT_EVIDENCE_ENV) {
        Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => return Ok(()),
    };
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create product-window Atelier created project evidence directory: {}",
                error
            )
        })?;
    }

    let evidence = json!({
        "ok": true,
        "appletId": applet_id,
        "sessionId": session_id,
        "launchMode": "product-window-certification",
        "productShell": true,
        "event": name,
        "properties": event
            .and_then(|value| value.get("properties"))
            .cloned()
            .unwrap_or_else(|| json!({})),
        "recordedAt": now_millis(),
    });
    fs::write(
        &output_path,
        serde_json::to_vec_pretty(&evidence).map_err(|error| {
            format!(
                "failed to serialize product-window Atelier created project evidence: {}",
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "failed to write product-window Atelier created project evidence {}: {}",
            output_path.display(),
            error
        )
    })?;
    Ok(())
}

fn record_product_window_e2e_atelier_decision_resolved(
    applet_id: &str,
    session_id: &str,
    params: Option<&Value>,
) -> Result<(), String> {
    let enabled = std::env::var(PRODUCT_WINDOW_E2E_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }

    let expected_applet_id = std::env::var(PRODUCT_WINDOW_E2E_APPLET_ID_ENV).unwrap_or_default();
    if expected_applet_id.trim().is_empty() || expected_applet_id.trim() != applet_id.trim() {
        return Ok(());
    }

    let event = params.map(|value| value.get("event").unwrap_or(value));
    let name = event
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if name != "atelier.decision.resolved.rendered" {
        return Ok(());
    }

    let output_path = match std::env::var(PRODUCT_WINDOW_E2E_ATELIER_DECISION_RESOLVED_EVIDENCE_ENV)
    {
        Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => return Ok(()),
    };
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create product-window Atelier decision resolved evidence directory: {}",
                error
            )
        })?;
    }

    let evidence = json!({
        "ok": true,
        "appletId": applet_id,
        "sessionId": session_id,
        "launchMode": "product-window-certification",
        "productShell": true,
        "event": name,
        "properties": event
            .and_then(|value| value.get("properties"))
            .cloned()
            .unwrap_or_else(|| json!({})),
        "recordedAt": now_millis(),
    });
    fs::write(
        &output_path,
        serde_json::to_vec_pretty(&evidence).map_err(|error| {
            format!(
                "failed to serialize product-window Atelier decision resolved evidence: {}",
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "failed to write product-window Atelier decision resolved evidence {}: {}",
            output_path.display(),
            error
        )
    })?;
    Ok(())
}

fn record_product_window_e2e_atelier_artifact_gate_rendered(
    applet_id: &str,
    session_id: &str,
    params: Option<&Value>,
) -> Result<(), String> {
    let enabled = std::env::var(PRODUCT_WINDOW_E2E_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }

    let expected_applet_id = std::env::var(PRODUCT_WINDOW_E2E_APPLET_ID_ENV).unwrap_or_default();
    if expected_applet_id.trim().is_empty() || expected_applet_id.trim() != applet_id.trim() {
        return Ok(());
    }

    let event = params.map(|value| value.get("event").unwrap_or(value));
    let name = event
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if name != "atelier.artifact_gate.rendered" {
        return Ok(());
    }

    let output_path =
        match std::env::var(PRODUCT_WINDOW_E2E_ATELIER_ARTIFACT_GATE_RENDERED_EVIDENCE_ENV) {
            Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
            _ => return Ok(()),
        };
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create product-window Atelier artifact/gate evidence directory: {}",
                error
            )
        })?;
    }

    let evidence = json!({
        "ok": true,
        "appletId": applet_id,
        "sessionId": session_id,
        "launchMode": "product-window-certification",
        "productShell": true,
        "event": name,
        "properties": event
            .and_then(|value| value.get("properties"))
            .cloned()
            .unwrap_or_else(|| json!({})),
        "recordedAt": now_millis(),
    });
    fs::write(
        &output_path,
        serde_json::to_vec_pretty(&evidence).map_err(|error| {
            format!(
                "failed to serialize product-window Atelier artifact/gate evidence: {}",
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "failed to write product-window Atelier artifact/gate evidence {}: {}",
            output_path.display(),
            error
        )
    })?;
    Ok(())
}

fn record_product_window_e2e_atelier_artifact_body_fetched(
    applet_id: &str,
    session_id: &str,
    params: Option<&Value>,
) -> Result<(), String> {
    let enabled = std::env::var(PRODUCT_WINDOW_E2E_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }

    let expected_applet_id = std::env::var(PRODUCT_WINDOW_E2E_APPLET_ID_ENV).unwrap_or_default();
    if expected_applet_id.trim().is_empty() || expected_applet_id.trim() != applet_id.trim() {
        return Ok(());
    }

    let event = params.map(|value| value.get("event").unwrap_or(value));
    let name = event
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if name != "atelier.artifact.body.fetched" {
        return Ok(());
    }

    let output_path =
        match std::env::var(PRODUCT_WINDOW_E2E_ATELIER_ARTIFACT_BODY_FETCHED_EVIDENCE_ENV) {
            Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
            _ => return Ok(()),
        };
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create product-window Atelier artifact body fetch evidence directory: {}",
                error
            )
        })?;
    }

    let evidence = json!({
        "ok": true,
        "appletId": applet_id,
        "sessionId": session_id,
        "launchMode": "product-window-certification",
        "productShell": true,
        "event": name,
        "properties": event
            .and_then(|value| value.get("properties"))
            .cloned()
            .unwrap_or_else(|| json!({})),
        "recordedAt": now_millis(),
    });
    fs::write(
        &output_path,
        serde_json::to_vec_pretty(&evidence).map_err(|error| {
            format!(
                "failed to serialize product-window Atelier artifact body fetch evidence: {}",
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "failed to write product-window Atelier artifact body fetch evidence {}: {}",
            output_path.display(),
            error
        )
    })?;
    Ok(())
}

fn record_product_window_e2e_atelier_artifact_preview_opened(
    applet_id: &str,
    session_id: &str,
    params: Option<&Value>,
) -> Result<(), String> {
    let enabled = std::env::var(PRODUCT_WINDOW_E2E_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }

    let expected_applet_id = std::env::var(PRODUCT_WINDOW_E2E_APPLET_ID_ENV).unwrap_or_default();
    if expected_applet_id.trim().is_empty() || expected_applet_id.trim() != applet_id.trim() {
        return Ok(());
    }

    let event = params.map(|value| value.get("event").unwrap_or(value));
    let name = event
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if name != "atelier.artifact.preview.opened" {
        return Ok(());
    }

    let output_path =
        match std::env::var(PRODUCT_WINDOW_E2E_ATELIER_ARTIFACT_PREVIEW_OPENED_EVIDENCE_ENV) {
            Ok(path) if !path.trim().is_empty() => PathBuf::from(path),
            _ => return Ok(()),
        };
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create product-window Atelier artifact preview open evidence directory: {}",
                error
            )
        })?;
    }

    let evidence = json!({
        "ok": true,
        "appletId": applet_id,
        "sessionId": session_id,
        "launchMode": "product-window-certification",
        "productShell": true,
        "event": name,
        "properties": event
            .and_then(|value| value.get("properties"))
            .cloned()
            .unwrap_or_else(|| json!({})),
        "recordedAt": now_millis(),
    });
    fs::write(
        &output_path,
        serde_json::to_vec_pretty(&evidence).map_err(|error| {
            format!(
                "failed to serialize product-window Atelier artifact preview open evidence: {}",
                error
            )
        })?,
    )
    .map_err(|error| {
        format!(
            "failed to write product-window Atelier artifact preview open evidence {}: {}",
            output_path.display(),
            error
        )
    })?;
    Ok(())
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

            let config_path = data_dir.join("applets").join(applet_id).join("config.json");

            if !config_path.exists() {
                return Ok(json!({ "value": null }));
            }

            let content = fs::read_to_string(&config_path).map_err(|e| {
                format!(
                    "Failed to read config file {}: {}",
                    config_path.display(),
                    e
                )
            })?;

            if content.trim().is_empty() {
                return Ok(json!({ "value": null }));
            }

            let map: HashMap<String, Value> = serde_json::from_str(&content).map_err(|e| {
                format!(
                    "Failed to parse config file {}: {}",
                    config_path.display(),
                    e
                )
            })?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::applets::{drain_audit_records, remove_session_record_for_test};

    fn context() -> AccessContext {
        AccessContext {
            actor_ptid: Some("ptid:person:applet-test".to_string()),
            token: "token-test".to_string(),
        }
    }

    fn manifest(permissions: Vec<&str>) -> AppletGatewayManifest {
        AppletGatewayManifest {
            id: "test-applet".to_string(),
            permissions: permissions.into_iter().map(str::to_string).collect(),
            services: vec![AppletGatewayService {
                id: "station-api".to_string(),
                kind: "http".to_string(),
                binding: "station-resolved".to_string(),
                allowed_methods: vec!["GET".to_string(), "POST".to_string()],
                allowed_paths: vec!["/api/v1/*".to_string()],
                public_path_prefix: None,
                station_path_prefix: None,
                streaming: false,
            }],
            skills: vec![crate::contracts::AppletGatewaySkill {
                id: "declared-skill".to_string(),
                input_schema: "schemas/skill.input.json".to_string(),
                streaming: true,
                executor: None,
            }],
        }
    }

    fn note_manifest() -> AppletGatewayManifest {
        AppletGatewayManifest {
            id: "peers.note".to_string(),
            permissions: vec!["network.request".to_string()],
            services: vec![AppletGatewayService {
                id: "note".to_string(),
                kind: "http".to_string(),
                binding: "station-resolved".to_string(),
                allowed_methods: vec![
                    "GET".to_string(),
                    "POST".to_string(),
                    "PATCH".to_string(),
                    "DELETE".to_string(),
                ],
                allowed_paths: vec![
                    "/v1/notes".to_string(),
                    "/v1/notes/*".to_string(),
                    "/v1/notes:search".to_string(),
                ],
                public_path_prefix: Some("/v1".to_string()),
                station_path_prefix: Some("/applets/note/v1".to_string()),
                streaming: false,
            }],
            skills: vec![],
        }
    }

    fn atelier_manifest() -> AppletGatewayManifest {
        AppletGatewayManifest {
            id: "peers.atelier".to_string(),
            permissions: vec![
                "network.request".to_string(),
                "events.subscribe".to_string(),
                "events.unsubscribe".to_string(),
                "events.poll".to_string(),
                "atelier.artifact.preview.open".to_string(),
                "atelier.events.subscribe".to_string(),
            ],
            services: vec![AppletGatewayService {
                id: "atelier".to_string(),
                kind: "http".to_string(),
                binding: "station-resolved".to_string(),
                allowed_methods: vec![
                    "GET".to_string(),
                    "POST".to_string(),
                    "PATCH".to_string(),
                    "DELETE".to_string(),
                ],
                allowed_paths: vec![
                    "/v1/workspace".to_string(),
                    "/v1/projects".to_string(),
                    "/v1/projects/*".to_string(),
                    "/v1/messages".to_string(),
                    "/v1/escalations:resolve".to_string(),
                    "/v1/tasks".to_string(),
                    "/v1/tasks/*".to_string(),
                ],
                public_path_prefix: Some("/v1".to_string()),
                station_path_prefix: Some("/applets/atelier/v1".to_string()),
                streaming: true,
            }],
            skills: vec![],
        }
    }

    fn invoke(
        session_id: &str,
        capability: &str,
        action: &str,
        params: Option<Value>,
        manifest: AppletGatewayManifest,
    ) -> AppletInvokeInput {
        AppletInvokeInput {
            id: "test-applet".to_string(),
            session_id: session_id.to_string(),
            capability: capability.to_string(),
            action: Some(action.to_string()),
            params,
            manifest,
        }
    }

    fn note_invoke(
        session_id: &str,
        capability: &str,
        action: &str,
        params: Option<Value>,
    ) -> AppletInvokeInput {
        AppletInvokeInput {
            id: "peers.note".to_string(),
            session_id: session_id.to_string(),
            capability: capability.to_string(),
            action: Some(action.to_string()),
            params,
            manifest: note_manifest(),
        }
    }

    fn atelier_invoke(
        session_id: &str,
        capability: &str,
        action: &str,
        params: Option<Value>,
    ) -> AppletInvokeInput {
        AppletInvokeInput {
            id: "peers.atelier".to_string(),
            session_id: session_id.to_string(),
            capability: capability.to_string(),
            action: Some(action.to_string()),
            params,
            manifest: atelier_manifest(),
        }
    }

    fn applets_invoke_registered(
        context: AccessContext,
        input: AppletInvokeInput,
        data_dir: &Path,
    ) -> AppResult<StubPayload> {
        let create = applets_create_session(
            context.clone(),
            AppletCreateSessionInput {
                id: input.id.clone(),
                session_id: Some(input.session_id.clone()),
                manifest: input.manifest.clone(),
            },
            data_dir,
        );
        if !create.ok {
            return create;
        }
        applets_invoke(context, input, data_dir)
    }

    #[test]
    fn rewrites_note_public_service_path_to_station_mount_path() {
        let service = note_manifest().services.remove(0);

        assert_eq!(
            resolve_station_service_path(&service, "/v1/notes").unwrap(),
            "/applets/note/v1/notes"
        );
        assert_eq!(
            resolve_station_service_path(&service, "/v1/notes/note-1").unwrap(),
            "/applets/note/v1/notes/note-1"
        );
        assert_eq!(
            resolve_station_service_path(&service, "/v1/notes:search").unwrap(),
            "/applets/note/v1/notes:search"
        );
    }

    #[test]
    fn rejects_note_network_paths_outside_declared_service_policy() {
        let result = perform_network_request(
            &context(),
            &note_manifest(),
            &json!({ "service": "note", "path": "/api/v1/notebook", "method": "GET" }),
            "GET",
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not allow path"));
    }

    #[test]
    fn parses_note_network_query_without_polluting_path_policy() {
        let params = json!({
            "service": "note",
            "path": "/v1/notes:search",
            "method": "GET",
            "query": {
                "q": "Gateway",
                "include_deleted": false,
                "tag": ["work", "draft"]
            }
        });

        let query = parse_network_query(&params).unwrap().unwrap();

        assert!(query.contains(&("q", "Gateway".to_string())));
        assert!(query.contains(&("include_deleted", "false".to_string())));
        assert!(query.contains(&("tag", "work".to_string())));
        assert!(query.contains(&("tag", "draft".to_string())));
        ensure_service_allows(&note_manifest().services[0], "GET", "/v1/notes:search").unwrap();
    }

    #[test]
    fn note_gateway_reaches_station_bundled_note_service() {
        let Ok(base_url) = std::env::var("PEERS_APPLET_NOTE_GATE_BASE_URL") else {
            return;
        };
        let token = std::env::var("PEERS_APPLET_NOTE_GATE_TOKEN")
            .expect("note product gate token should be provided by the gate server");
        std::env::set_var("PEERS_APPLET_SERVICE_NOTE", &base_url);

        let gateway_context = AccessContext {
            actor_ptid: Some("note-real-product-gate-actor".to_string()),
            token,
        };
        let data_dir = temp_data_dir("note-real-product-gate");
        let session_id = unique_session_id("session-note-product");
        let create = applets_invoke_registered(
            gateway_context.clone(),
            note_invoke(
                &session_id,
                "network",
                "request",
                Some(json!({
                    "service": "note",
                    "path": "/v1/notes",
                    "method": "POST",
                    "body": {
                        "title": "Gateway Note",
                        "content": "Created through Desktop Gateway"
                    }
                })),
            ),
            &data_dir,
        );
        assert!(create.ok, "create note failed: {:?}", create.error);
        let created: Value = serde_json::from_str(&create.data.unwrap().status).unwrap();
        assert_eq!(created.get("status").and_then(Value::as_u64), Some(201));
        assert_eq!(
            created
                .get("body")
                .and_then(|body| body.get("item"))
                .and_then(|note| note.get("title"))
                .and_then(Value::as_str),
            Some("Gateway Note")
        );

        let search = applets_invoke_registered(
            gateway_context,
            note_invoke(
                &session_id,
                "network",
                "request",
                Some(json!({
                    "service": "note",
                    "path": "/v1/notes:search",
                    "method": "GET",
                    "query": { "q": "Gateway" }
                })),
            ),
            &data_dir,
        );
        std::env::remove_var("PEERS_APPLET_SERVICE_NOTE");

        assert!(search.ok, "search note failed: {:?}", search.error);
        let searched: Value = serde_json::from_str(&search.data.unwrap().status).unwrap();
        assert_eq!(searched.get("status").and_then(Value::as_u64), Some(200));
        let items = searched
            .get("body")
            .and_then(|body| body.get("items"))
            .and_then(Value::as_array)
            .expect("search response should contain notes");
        assert!(
            items
                .iter()
                .any(|item| item.get("title").and_then(Value::as_str) == Some("Gateway Note")),
            "search response should include the created note: {:?}",
            searched
        );
    }

    #[test]
    fn atelier_artifact_preview_open_accepts_only_host_sandbox_manifest_intent() {
        let data_dir = temp_data_dir("atelier-preview-open");
        let session_id = unique_session_id("session-atelier-preview");
        let preview = applets_invoke_registered(
            context(),
            atelier_invoke(
                &session_id,
                "atelier",
                "artifact.preview.open",
                Some(json!({
                    "taskId": "task-1",
                    "artifactId": "artifact-1",
                    "sandboxRef": "atelier-sandbox://task-1/artifact-1/preview",
                    "bodyRef": "artifact://task-1/artifact-1/body",
                    "kind": "markdown",
                    "mode": "sandbox_manifest"
                })),
            ),
            &data_dir,
        );

        assert!(preview.ok, "preview open failed: {:?}", preview.error);
        let payload: Value = serde_json::from_str(&preview.data.unwrap().status).unwrap();
        assert_eq!(payload.get("accepted").and_then(Value::as_bool), Some(true));
        assert_eq!(payload.get("opened").and_then(Value::as_bool), Some(true));
        assert_eq!(payload.get("prepared").and_then(Value::as_bool), Some(true));
        assert_eq!(
            payload.get("sandboxRef").and_then(Value::as_str),
            Some("atelier-sandbox://task-1/artifact-1/preview")
        );
        assert_eq!(
            payload.get("bodyRef").and_then(Value::as_str),
            Some("artifact://task-1/artifact-1/body")
        );
        assert_eq!(
            payload.get("rendererSessionId").and_then(Value::as_str),
            Some("atelier-preview:task-1:artifact-1")
        );
        assert_eq!(
            payload.get("rendererOwner").and_then(Value::as_str),
            Some("desktop_host")
        );
        assert_eq!(
            payload.get("rendererMode").and_then(Value::as_str),
            Some("host_sandbox_manifest")
        );
        assert_eq!(
            payload.get("rendererStatus").and_then(Value::as_str),
            Some("rendered")
        );
        assert!(payload
            .get("rendererCapabilities")
            .and_then(Value::as_array)
            .is_some_and(|capabilities| capabilities.iter().any(|capability| {
                capability.as_str() == Some("host_visual_renderer_surface")
            })));
        let host_command = payload
            .get("__hostCommands")
            .and_then(Value::as_array)
            .and_then(|commands| commands.first())
            .expect("preview open should emit a Host UI command");
        assert_eq!(host_command.get("type").and_then(Value::as_str), Some("ui"));
        assert_eq!(
            host_command.get("action").and_then(Value::as_str),
            Some("openAtelierArtifactPreview")
        );
        assert_eq!(
            host_command.get("returnsResult").and_then(Value::as_bool),
            Some(true)
        );
        let host_params = host_command
            .get("params")
            .and_then(Value::as_object)
            .expect("preview Host UI command params should be present");
        assert_eq!(
            host_params.get("rendererSessionId").and_then(Value::as_str),
            Some("atelier-preview:task-1:artifact-1")
        );
        assert_eq!(
            host_params.get("sandboxRef").and_then(Value::as_str),
            Some("atelier-sandbox://task-1/artifact-1/preview")
        );
        assert!(host_params.get("url").is_none());
        assert!(host_params.get("iframe").is_none());
        assert!(host_params.get("html").is_none());
        assert!(payload.get("url").is_none());
        assert!(payload.get("iframe").is_none());
        assert!(payload.get("html").is_none());

        let denied = applets_invoke_registered(
            context(),
            atelier_invoke(
                &session_id,
                "atelier",
                "artifact.preview.open",
                Some(json!({
                    "taskId": "task-1",
                    "artifactId": "artifact-1",
                    "sandboxRef": "https://example.invalid/preview",
                    "bodyRef": "artifact://task-1/artifact-1/body",
                    "mode": "sandbox_manifest"
                })),
            ),
            &data_dir,
        );

        assert!(!denied.ok, "raw URL sandbox ref must be rejected");
        assert!(denied
            .error
            .as_ref()
            .is_some_and(|error| error.message.contains("atelier-sandbox://")));

        let bad_sandbox_segment = applets_invoke_registered(
            context(),
            atelier_invoke(
                &session_id,
                "atelier",
                "artifact.preview.open",
                Some(json!({
                    "taskId": "task-1",
                    "artifactId": "artifact-1",
                    "sandboxRef": "atelier-sandbox://task 1/artifact-1/preview",
                    "bodyRef": "artifact://task-1/artifact-1/body",
                    "mode": "sandbox_manifest"
                })),
            ),
            &data_dir,
        );

        assert!(
            !bad_sandbox_segment.ok,
            "sandbox refs with whitespace segments must be rejected"
        );
        assert!(bad_sandbox_segment
            .error
            .as_ref()
            .is_some_and(|error| error.message.contains("canonical atelier-sandbox://")));

        let bad_body_segment = applets_invoke_registered(
            context(),
            atelier_invoke(
                &session_id,
                "atelier",
                "artifact.preview.open",
                Some(json!({
                    "taskId": "task-1",
                    "artifactId": "artifact-1",
                    "sandboxRef": "atelier-sandbox://task-1/artifact-1/preview",
                    "bodyRef": "artifact://task-1/artifact 1/body",
                    "mode": "sandbox_manifest"
                })),
            ),
            &data_dir,
        );

        assert!(
            !bad_body_segment.ok,
            "body refs with whitespace segments must be rejected"
        );
        assert!(bad_body_segment
            .error
            .as_ref()
            .is_some_and(|error| error.message.contains("canonical artifact://")));
    }

    #[test]
    fn atelier_gateway_reaches_station_bundled_atelier_workspace() {
        let Ok(base_url) = std::env::var("PEERS_APPLET_ATELIER_GATE_BASE_URL") else {
            return;
        };
        let token = std::env::var("PEERS_APPLET_ATELIER_GATE_TOKEN")
            .expect("atelier product gate token should be provided by the gate server");
        let agent_id = std::env::var("PEERS_APPLET_ATELIER_GATE_AGENT_ID")
            .expect("atelier product gate agent id should be provided by the gate server");
        let task_id = std::env::var("PEERS_APPLET_ATELIER_GATE_TASK_ID")
            .expect("atelier product gate task id should be provided by the gate server");
        std::env::set_var("PEERS_APPLET_SERVICE_ATELIER", &base_url);
        std::env::set_var("PEERS_STATION_URL", &base_url);

        let gateway_context = AccessContext {
            actor_ptid: Some("atelier-real-product-gate-actor".to_string()),
            token: token.clone(),
        };
        let data_dir = temp_data_dir("atelier-real-product-gate");
        let session_id = unique_session_id("session-atelier-product");
        let workspace = applets_invoke_registered(
            gateway_context.clone(),
            atelier_invoke(
                &session_id,
                "network",
                "request",
                Some(json!({
                    "service": "atelier",
                    "path": "/v1/workspace",
                    "method": "GET"
                })),
            ),
            &data_dir,
        );

        assert!(workspace.ok, "workspace load failed: {:?}", workspace.error);
        let loaded: Value = serde_json::from_str(&workspace.data.unwrap().status).unwrap();
        assert_eq!(loaded.get("status").and_then(Value::as_u64), Some(200));
        assert_eq!(
            loaded
                .get("body")
                .and_then(|body| body.get("version"))
                .and_then(Value::as_str),
            Some("atelier-projection/v0")
        );
        assert_eq!(
            loaded
                .get("body")
                .and_then(|body| body.get("workspace"))
                .and_then(|body| body.get("tasks"))
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(
            loaded
                .get("body")
                .and_then(|body| body.get("selectedTaskId"))
                .and_then(Value::as_str),
            Some(task_id.as_str())
        );
        assert_eq!(
            loaded
                .get("body")
                .and_then(|body| body.get("workspace"))
                .and_then(|body| body.get("tasks"))
                .and_then(Value::as_array)
                .and_then(|tasks| tasks.first())
                .and_then(|task| task.get("id"))
                .and_then(Value::as_str),
            Some(task_id.as_str())
        );

        let subscribe_topic = applets_invoke_registered(
            gateway_context.clone(),
            atelier_invoke(
                &session_id,
                "events",
                "subscribe",
                Some(json!({ "topic": "atelier.projection.event" })),
            ),
            &data_dir,
        );
        assert!(
            subscribe_topic.ok,
            "events.subscribe failed: {:?}",
            subscribe_topic.error
        );
        let subscribe_stream = applets_invoke_registered(
            gateway_context.clone(),
            atelier_invoke(
                &session_id,
                "atelier",
                "events.subscribe",
                Some(json!({
                    "agentId": agent_id,
                    "taskId": task_id,
                    "afterEventSeq": 0
                })),
            ),
            &data_dir,
        );
        assert!(
            subscribe_stream.ok,
            "atelier.events.subscribe failed: {:?}",
            subscribe_stream.error
        );

        let mut projected_events = Vec::new();
        for _ in 0..40 {
            std::thread::sleep(Duration::from_millis(100));
            let poll = applets_invoke_registered(
                gateway_context.clone(),
                atelier_invoke(&session_id, "events", "poll", None),
                &data_dir,
            );
            assert!(poll.ok, "events.poll failed: {:?}", poll.error);
            let payload: Value = serde_json::from_str(&poll.data.unwrap().status).unwrap();
            let events = payload
                .get("events")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            projected_events.extend(events);
            let replayed_sequences = atelier_projection_event_sequences(&projected_events);
            if replayed_sequences.contains(&1) && replayed_sequences.contains(&2) {
                break;
            }
        }
        let projected = projected_events
            .iter()
            .find(|event| {
                event.get("topic").and_then(Value::as_str) == Some("atelier.projection.event")
            })
            .expect("Atelier projection event should be replayed through real Station stream");
        assert_eq!(
            projected
                .get("payload")
                .and_then(|payload| payload.get("seq"))
                .and_then(Value::as_i64),
            Some(1)
        );
        let reconnected_sequences = atelier_projection_event_sequences(&projected_events);
        assert!(
			reconnected_sequences.contains(&2),
			"controlled stream close should reconnect from persisted cursor and deliver seq=2: {:?}",
			reconnected_sequences
		);
        let replay_probe = fetch_atelier_replay_probe(&base_url);
        let replay_probe_requests = replay_probe
            .get("requests")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        assert!(
            replay_probe_request_matches(&replay_probe_requests, 0, &[]),
            "first controlled stream request should close before replay and keep afterEventSeq=0: {:?}",
            replay_probe
        );
        assert!(
            replay_probe_request_matches(&replay_probe_requests, 0, &[1]),
            "first controlled stream request should replay only seq=1 before close: {:?}",
            replay_probe
        );
        assert!(
            replay_probe_request_replays_after_cursor(&replay_probe_requests, 1, 2),
            "reconnected stream request should use persisted cursor afterEventSeq=1, replay seq=2, and not replay stale events: {:?}",
			replay_probe
		);
        assert_eq!(
            projected
                .get("payload")
                .and_then(|payload| payload.get("taskId"))
                .and_then(Value::as_str),
            Some(task_id.as_str())
        );
        assert_eq!(
            projected
                .get("payload")
                .and_then(|payload| payload.get("patch"))
                .and_then(|patch| patch.get("kind"))
                .and_then(Value::as_str),
            Some("stream.append")
        );

        let unsubscribe = applets_invoke_registered(
            gateway_context.clone(),
            atelier_invoke(
                &session_id,
                "events",
                "unsubscribe",
                Some(json!({ "topic": "atelier.projection.event" })),
            ),
            &data_dir,
        );
        assert!(
            unsubscribe.ok,
            "events.unsubscribe failed: {:?}",
            unsubscribe.error
        );

        let cursor_session_id = unique_session_id("session-atelier-product-cursor");
        let cursor_data_dir = temp_data_dir("atelier-real-product-gate-cursor");
        let subscribe_cursor_topic = applets_invoke_registered(
            gateway_context.clone(),
            atelier_invoke(
                &cursor_session_id,
                "events",
                "subscribe",
                Some(json!({ "topic": "atelier.projection.event" })),
            ),
            &cursor_data_dir,
        );
        assert!(
            subscribe_cursor_topic.ok,
            "cursor events.subscribe failed: {:?}",
            subscribe_cursor_topic.error
        );
        let subscribe_cursor_stream = applets_invoke_registered(
            gateway_context.clone(),
            atelier_invoke(
                &cursor_session_id,
                "atelier",
                "events.subscribe",
                Some(json!({
                    "agentId": agent_id,
                    "taskId": task_id,
                    "afterEventSeq": 1
                })),
            ),
            &cursor_data_dir,
        );
        assert!(
            subscribe_cursor_stream.ok,
            "cursor atelier.events.subscribe failed: {:?}",
            subscribe_cursor_stream.error
        );

        let mut cursor_projected_events = Vec::new();
        for _ in 0..20 {
            std::thread::sleep(Duration::from_millis(100));
            let poll = applets_invoke_registered(
                gateway_context.clone(),
                atelier_invoke(&cursor_session_id, "events", "poll", None),
                &cursor_data_dir,
            );
            assert!(poll.ok, "cursor events.poll failed: {:?}", poll.error);
            let payload: Value = serde_json::from_str(&poll.data.unwrap().status).unwrap();
            let events = payload
                .get("events")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            cursor_projected_events.extend(events);
            if cursor_projected_events.iter().any(|event| {
                event.get("topic").and_then(Value::as_str) == Some("atelier.projection.event")
                    && event
                        .get("payload")
                        .and_then(|payload| payload.get("seq"))
                        .and_then(Value::as_i64)
                        == Some(2)
            }) {
                break;
            }
        }
        let replayed_sequences = atelier_projection_event_sequences(&cursor_projected_events);
        assert!(
            !replayed_sequences.contains(&1),
            "cursor replay must not return events at or before afterEventSeq: {:?}",
            replayed_sequences
        );
        assert!(
            replayed_sequences.contains(&2),
            "cursor replay should return later durable event seq=2: {:?}",
            replayed_sequences
        );

        let unsubscribe_cursor = applets_invoke_registered(
            gateway_context,
            atelier_invoke(
                &cursor_session_id,
                "events",
                "unsubscribe",
                Some(json!({ "topic": "atelier.projection.event" })),
            ),
            &data_dir,
        );
        assert!(
            unsubscribe_cursor.ok,
            "cursor events.unsubscribe failed: {:?}",
            unsubscribe_cursor.error
        );
        std::env::remove_var("PEERS_APPLET_SERVICE_ATELIER");
        std::env::remove_var("PEERS_STATION_URL");
    }

    fn applet_error_code(result: &AppResult<StubPayload>) -> Option<String> {
        result
            .error
            .as_ref()
            .and_then(|error| error.details.as_ref())
            .and_then(|details| details.get("appletErrorCode"))
            .and_then(Value::as_str)
            .map(str::to_string)
    }

    fn atelier_projection_event_sequences(events: &[Value]) -> Vec<i64> {
        events
            .iter()
            .filter(|event| {
                event.get("topic").and_then(Value::as_str) == Some("atelier.projection.event")
            })
            .filter_map(|event| {
                event
                    .get("payload")
                    .and_then(|payload| payload.get("seq"))
                    .and_then(Value::as_i64)
            })
            .collect::<Vec<_>>()
    }

    fn fetch_atelier_replay_probe(base_url: &str) -> Value {
        let response = Client::new()
            .get(format!(
                "{}/__atelier_gate/replay_probe",
                base_url.trim_end_matches('/')
            ))
            .send()
            .expect("Atelier replay probe request should succeed")
            .text()
            .expect("Atelier replay probe body should be readable");
        serde_json::from_str(&response).expect("Atelier replay probe should return JSON")
    }

    fn replay_probe_request_matches(
        requests: &[Value],
        after_event_seq: i64,
        replayed_seqs: &[i64],
    ) -> bool {
        requests.iter().any(|request| {
            request.get("afterEventSeq").and_then(Value::as_i64) == Some(after_event_seq)
                && request
                    .get("replayedSeqs")
                    .and_then(Value::as_array)
                    .map(|values| values.iter().filter_map(Value::as_i64).collect::<Vec<_>>())
                    .as_deref()
                    == Some(replayed_seqs)
        })
    }

    fn replay_probe_request_replays_after_cursor(
        requests: &[Value],
        after_event_seq: i64,
        required_seq: i64,
    ) -> bool {
        requests.iter().any(|request| {
            let replayed_seqs = request
                .get("replayedSeqs")
                .and_then(Value::as_array)
                .map(|values| values.iter().filter_map(Value::as_i64).collect::<Vec<_>>())
                .unwrap_or_default();
            request.get("afterEventSeq").and_then(Value::as_i64) == Some(after_event_seq)
                && replayed_seqs.contains(&required_seq)
                && replayed_seqs.iter().all(|seq| *seq > after_event_seq)
        })
    }

    fn subscribe_event(
        session_id: &str,
        topic: &str,
        manifest: AppletGatewayManifest,
        data_dir: &Path,
    ) {
        let result = applets_invoke_registered(
            context(),
            invoke(
                session_id,
                "events",
                "subscribe",
                Some(json!({ "topic": topic })),
                manifest,
            ),
            data_dir,
        );
        assert!(result.ok, "event subscribe failed: {:?}", result.error);
    }

    fn temp_data_dir(name: &str) -> PathBuf {
        let request_id = build_request_id().replace('-', "_");
        let path = std::env::temp_dir().join(format!("peers-touch-applet-{}-{}", name, request_id));
        fs::create_dir_all(&path).expect("test temp dir should be created");
        path
    }

    fn unique_session_id(prefix: &str) -> String {
        format!("{}-{}", prefix, build_request_id())
    }

    fn full_e2e_env_lock() -> std::sync::MutexGuard<'static, ()> {
        static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        ENV_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[test]
    fn atelier_full_e2e_desktop_ready_evidence_is_schema_strong() {
        let _guard = full_e2e_env_lock();
        let data_dir = temp_data_dir("atelier-full-e2e-ready");
        let output_path = data_dir.join("atelier-full-e2e-desktop-ready.json");
        let station_url = "http://127.0.0.1:19091";
        std::env::set_var(ATELIER_FULL_E2E_ENV, "1");
        std::env::set_var(ATELIER_FULL_E2E_APPLET_ID_ENV, "peers.atelier");
        std::env::set_var(ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID_ENV, "launch-test-1");
        std::env::set_var(ATELIER_FULL_E2E_DESKTOP_READY_EVIDENCE_ENV, &output_path);
        std::env::set_var("PEERS_APPLET_SERVICE_ATELIER", station_url);

        let result = record_atelier_full_e2e_desktop_ready(
            "peers.atelier",
            "session-atl-ready",
            Some(&json!({
                "event": {
                    "name": "official_applet.bootstrap",
                    "properties": { "service": "atelier" }
                }
            })),
        );

        std::env::remove_var(ATELIER_FULL_E2E_ENV);
        std::env::remove_var(ATELIER_FULL_E2E_APPLET_ID_ENV);
        std::env::remove_var(ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID_ENV);
        std::env::remove_var(ATELIER_FULL_E2E_DESKTOP_READY_EVIDENCE_ENV);
        std::env::remove_var("PEERS_APPLET_SERVICE_ATELIER");

        assert!(result.is_ok(), "ready evidence failed: {:?}", result);
        let evidence: Value = serde_json::from_slice(
            &fs::read(&output_path).expect("ready evidence should be written"),
        )
        .expect("ready evidence should be JSON");
        assert_eq!(evidence["ok"], true);
        assert_eq!(evidence["launchId"], "launch-test-1");
        assert_eq!(evidence["appletId"], "peers.atelier");
        assert_eq!(evidence["readiness"], "NOT_READY");
        assert_eq!(evidence["globalReady"], false);
        assert_eq!(evidence["serviceBinding"]["service"], "atelier");
        assert_eq!(
            evidence["serviceBinding"]["transport"],
            "sdk.network.request"
        );
        assert_eq!(evidence["serviceBinding"]["stationUrlRedacted"], true);
        assert_eq!(
            evidence["serviceBinding"]["stationUrlHash"],
            atelier_full_e2e_sha256(station_url)
        );
        assert!(evidence["serviceBinding"].get("stationUrl").is_none());
        assert_eq!(
            evidence["serviceBinding"]["stationPathPrefix"],
            "/applets/atelier/v1"
        );
        assert_eq!(
            evidence["productShell"]["kind"],
            "desktop_host_product_shell"
        );
        assert_eq!(evidence["productWindow"]["kind"], "desktop_product_window");
        assert_eq!(evidence["productWindow"]["mounted"], true);
    }

    fn register_e2e_provider(
        _provider_id: &str,
        _protocol: &str,
        _model_id: &str,
        _base_url: &str,
    ) {
        // Provider registration now requires Station. E2E tests for ai.chat
        // capability must run against a real Station with providers configured.
    }

    #[test]
    fn rejects_invoke_before_explicit_session_creation() {
        let data_dir = temp_data_dir("unregistered-session");
        let session_id = "session-not-created";
        remove_session_record_for_test(session_id);
        let result = applets_invoke(
            context(),
            invoke(
                session_id,
                "app",
                "getContext",
                None,
                manifest(vec!["app.getContext"]),
            ),
            &data_dir,
        );
        assert!(!result.ok);
        assert_eq!(result.error.as_ref().unwrap().code, ErrorCode::Unauthorized);
        assert_eq!(
            applet_error_code(&result).as_deref(),
            Some("INVALID_SESSION")
        );
    }

    #[test]
    fn denies_capability_missing_from_manifest_permissions() {
        let data_dir = temp_data_dir("permission-denied");
        let result = applets_invoke_registered(
            context(),
            invoke(
                "session-deny",
                "ai",
                "chat",
                None,
                manifest(vec!["app.getContext"]),
            ),
            &data_dir,
        );
        assert!(!result.ok);
        assert_eq!(result.error.as_ref().unwrap().code, ErrorCode::Forbidden);
        assert_eq!(
            applet_error_code(&result).as_deref(),
            Some("PERMISSION_DENIED")
        );
    }

    #[test]
    fn rejects_manifest_permission_escalation_after_session_registration() {
        let data_dir = temp_data_dir("manifest-escalation");
        let session_id = "session-manifest-escalation";
        remove_session_record_for_test(session_id);
        let initial = applets_invoke_registered(
            context(),
            invoke(
                session_id,
                "app",
                "getContext",
                None,
                manifest(vec!["app.getContext"]),
            ),
            &data_dir,
        );
        assert!(initial.ok);

        let escalated = applets_invoke_registered(
            context(),
            invoke(
                session_id,
                "ai",
                "chat",
                Some(json!({ "messages": [{ "role": "user", "content": "should not run" }] })),
                manifest(vec!["app.getContext", "ai.chat"]),
            ),
            &data_dir,
        );
        assert!(!escalated.ok);
        assert_eq!(escalated.error.as_ref().unwrap().code, ErrorCode::Forbidden);
        assert!(escalated
            .error
            .as_ref()
            .unwrap()
            .message
            .contains("manifest changed"));
        assert_eq!(
            applet_error_code(&escalated).as_deref(),
            Some("INVALID_MANIFEST")
        );
    }

    #[test]
    fn rejects_raw_network_url_before_proxying() {
        let data_dir = temp_data_dir("raw-network-url");
        let result = applets_invoke_registered(
            context(),
            invoke(
                "session-raw-url",
                "network",
                "request",
                Some(json!({ "url": "https://example.com/api" })),
                manifest(vec!["network.request"]),
            ),
            &data_dir,
        );
        assert!(!result.ok);
        assert!(result
            .error
            .as_ref()
            .unwrap()
            .message
            .contains("raw URL is forbidden"));
        assert_eq!(
            applet_error_code(&result).as_deref(),
            Some("INVALID_PARAMS")
        );
    }

    #[test]
    fn rejects_network_path_outside_service_binding() {
        let data_dir = temp_data_dir("network-path-policy");
        let result = applets_invoke_registered(
            context(),
            invoke(
                "session-service-deny",
                "network",
                "request",
                Some(json!({ "service": "station-api", "path": "/admin", "method": "GET" })),
                manifest(vec!["network.request"]),
            ),
            &data_dir,
        );
        assert!(!result.ok);
        assert!(result
            .error
            .unwrap()
            .message
            .contains("does not allow path"));
    }

    #[test]
    fn rejects_oversized_gateway_request_payload() {
        let data_dir = temp_data_dir("gateway-payload-limit");
        let result = applets_invoke_registered(
            context(),
            invoke(
                "session-payload-too-large",
                "storage",
                "set",
                Some(
                    json!({ "key": "large", "value": "x".repeat(DEFAULT_GATEWAY_MAX_PAYLOAD_BYTES + 1024) }),
                ),
                manifest(vec!["storage.set"]),
            ),
            &data_dir,
        );
        assert!(!result.ok);
        assert_eq!(result.error.as_ref().unwrap().code, ErrorCode::Conflict);
        assert_eq!(
            applet_error_code(&result).as_deref(),
            Some("QUOTA_EXCEEDED")
        );
        assert_eq!(
            result
                .error
                .as_ref()
                .unwrap()
                .details
                .as_ref()
                .and_then(|details| details.get("limitKind"))
                .and_then(Value::as_str),
            Some("payload")
        );
    }

    #[test]
    fn rejects_session_request_quota_exhaustion() {
        let data_dir = temp_data_dir("quota");
        let session_id = unique_session_id("session-quota-exhausted");
        set_quota_record_for_test(
            "test-applet",
            &session_id,
            DEFAULT_GATEWAY_SESSION_QUOTA_PER_MINUTE,
        );
        let result = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "app",
                "getContext",
                None,
                manifest(vec!["app.getContext"]),
            ),
            &data_dir,
        );
        assert!(!result.ok);
        assert_eq!(result.error.as_ref().unwrap().code, ErrorCode::Conflict);
        assert_eq!(
            applet_error_code(&result).as_deref(),
            Some("QUOTA_EXCEEDED")
        );
    }

    #[test]
    fn allows_lifecycle_destroy_when_session_quota_is_exhausted() {
        let data_dir = temp_data_dir("quota-destroy");
        let session_id = unique_session_id("session-quota-destroy");
        let session_manifest = manifest(vec!["app.getContext", "lifecycle.destroy"]);
        remove_session_record_for_test(&session_id);
        let ready = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "app",
                "getContext",
                None,
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(ready.ok);

        set_quota_record_for_test(
            "test-applet",
            &session_id,
            DEFAULT_GATEWAY_SESSION_QUOTA_PER_MINUTE,
        );
        let destroyed = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "lifecycle",
                "destroy",
                None,
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(destroyed.ok);

        let after_destroy = applets_invoke_registered(
            context(),
            invoke(&session_id, "app", "getContext", None, session_manifest),
            &data_dir,
        );
        assert!(!after_destroy.ok);
        assert_eq!(
            applet_error_code(&after_destroy).as_deref(),
            Some("INVALID_SESSION")
        );
    }

    #[test]
    fn sanitizes_network_response_headers_before_returning_to_applet() {
        let sanitized = sanitize_applet_response_headers(json!({
            "Content-Type": "application/json",
            "Set-Cookie": "session=secret",
            "Authorization": "Bearer secret",
            "X-Request-Id": "request-1",
            "Server": "fixture"
        }));
        assert_eq!(
            sanitized.get("content-type").and_then(Value::as_str),
            Some("application/json")
        );
        assert_eq!(
            sanitized.get("x-request-id").and_then(Value::as_str),
            Some("request-1")
        );
        assert!(sanitized.get("set-cookie").is_none());
        assert!(sanitized.get("authorization").is_none());
        assert!(sanitized.get("server").is_none());
    }

    #[test]
    fn rejects_capability_execution_after_requested_timeout() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("timeout fixture should bind");
        let address = listener
            .local_addr()
            .expect("timeout fixture should expose address");
        let server = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0_u8; 1024];
                let _ = stream.read(&mut buffer);
                std::thread::sleep(Duration::from_millis(100));
                let body = r#"{"ok":true}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(), body
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        std::env::set_var(
            "PEERS_APPLET_SERVICE_TIMEOUT_API",
            format!("http://{}", address),
        );

        let mut timeout_manifest = manifest(vec!["network.request"]);
        timeout_manifest.services[0].id = "timeout-api".to_string();
        let data_dir = temp_data_dir("capability-timeout");
        let result = applets_invoke_registered(
            context(),
            invoke(
                "session-timeout",
                "network",
                "request",
                Some(
                    json!({ "service": "timeout-api", "path": "/api/v1/slow", "method": "GET", "timeoutMs": 10 }),
                ),
                timeout_manifest,
            ),
            &data_dir,
        );
        std::env::remove_var("PEERS_APPLET_SERVICE_TIMEOUT_API");
        let _ = server.join();

        assert!(!result.ok);
        assert!(result.error.as_ref().unwrap().message.contains("timed out"));
        assert_eq!(
            applet_error_code(&result).as_deref(),
            Some("QUOTA_EXCEEDED")
        );
        assert_eq!(
            result
                .error
                .as_ref()
                .unwrap()
                .details
                .as_ref()
                .and_then(|details| details.get("limitKind"))
                .and_then(Value::as_str),
            Some("timeout")
        );
    }

    #[test]
    fn rejects_storage_write_beyond_applet_quota() {
        let data_dir = temp_data_dir("storage-quota");
        let result = handle_storage(
            "test-applet",
            Some("set"),
            Some(json!({ "key": "large", "value": "x".repeat(APPLET_STORAGE_QUOTA_BYTES + 1024) })),
            &data_dir,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("storage quota exceeded"));
    }

    #[test]
    fn supports_storage_keys_with_prefix_filter() {
        let data_dir = temp_data_dir("storage-keys");
        handle_storage(
            "test-applet",
            Some("set"),
            Some(json!({ "key": "project:a", "value": 1 })),
            &data_dir,
        )
        .expect("project:a should be stored");
        handle_storage(
            "test-applet",
            Some("set"),
            Some(json!({ "key": "project:b", "value": 2 })),
            &data_dir,
        )
        .expect("project:b should be stored");
        handle_storage(
            "test-applet",
            Some("set"),
            Some(json!({ "key": "session:a", "value": 3 })),
            &data_dir,
        )
        .expect("session:a should be stored");

        let keys = handle_storage(
            "test-applet",
            Some("keys"),
            Some(json!({ "prefix": "project:" })),
            &data_dir,
        )
        .expect("storage.keys should succeed");

        assert_eq!(keys, json!(["project:a", "project:b"]));
    }

    #[test]
    fn supports_v1_app_lifecycle_and_ui_surface() {
        let app_context = handle_app("test-applet", "session-v1", Some("getContext"))
            .expect("app.getContext should succeed");
        assert_eq!(
            app_context.get("appletId").and_then(Value::as_str),
            Some("test-applet")
        );
        assert_eq!(
            app_context
                .get("launchParams")
                .and_then(Value::as_object)
                .map(|params| params.is_empty()),
            Some(true)
        );
        assert_eq!(
            handle_app("test-applet", "session-v1", Some("getLaunchOptions"))
                .expect("app.getLaunchOptions should succeed"),
            json!({})
        );
        assert!(handle_lifecycle("test-applet", Some("onPause"))
            .expect("lifecycle.onPause should succeed")
            .get("ok")
            .and_then(Value::as_bool)
            .unwrap_or(false));
        assert!(handle_ui(
            Some("setNavigationBar"),
            Some(json!({ "title": "Fixture" })),
        )
        .expect("ui.setNavigationBar should succeed")
        .get("ok")
        .and_then(Value::as_bool)
        .unwrap_or(false));
        let ui = handle_ui(Some("showModal"), Some(json!({ "title": "Fixture" })))
            .expect("ui.showModal should produce a Host command");
        assert_eq!(ui.get("ok").and_then(Value::as_bool), Some(true));
        let ui_command = ui
            .get("__hostCommands")
            .and_then(Value::as_array)
            .and_then(|commands| commands.first())
            .expect("ui command should be present");
        assert_eq!(ui_command.get("type").and_then(Value::as_str), Some("ui"));
        assert_eq!(
            ui_command.get("returnsResult").and_then(Value::as_bool),
            Some(true)
        );
        let navigation = handle_navigation(Some("navigateTo"), Some(json!({ "page": "applets" })))
            .expect("navigation.navigateTo should produce a Host command");
        assert_eq!(navigation.get("ok").and_then(Value::as_bool), Some(true));
        assert_eq!(
            navigation
                .get("__hostCommands")
                .and_then(Value::as_array)
                .and_then(|commands| commands.first())
                .and_then(|command| command.get("type"))
                .and_then(Value::as_str),
            Some("navigation")
        );
        assert!(handle_navigation(
            Some("navigateTo"),
            Some(json!({ "page": "https://example.invalid" })),
        )
        .is_err());
    }

    #[test]
    fn routes_navigation_through_authorized_host_command() {
        let session_manifest = manifest(vec!["navigation.navigateTo"]);
        let data_dir = temp_data_dir("navigation-command");
        let result = applets_invoke_registered(
            context(),
            invoke(
                "session-navigation",
                "navigation",
                "navigateTo",
                Some(json!({ "page": "applets" })),
                session_manifest,
            ),
            &data_dir,
        );

        assert!(result.ok, "navigation failed: {:?}", result.error);
        let status = result.data.unwrap().status;
        assert!(status.contains("\"__hostCommands\""));
        assert!(status.contains("\"navigation\""));
        assert!(status.contains("\"applets\""));
    }

    #[test]
    fn rejects_standalone_notes_route_but_accepts_official_note_applet_route() {
        assert_eq!(
            normalize_navigation_page("applet:peers.note").unwrap(),
            "applet:peers.note"
        );
        assert!(normalize_navigation_page("notes").is_err());
    }

    #[test]
    fn routes_ui_through_authorized_host_command() {
        let session_manifest = manifest(vec!["ui.showModal"]);
        let data_dir = temp_data_dir("ui-command");
        let result = applets_invoke_registered(
            context(),
            invoke(
                "session-ui",
                "ui",
                "showModal",
                Some(json!({ "title": "Confirm", "content": "Proceed" })),
                session_manifest,
            ),
            &data_dir,
        );

        assert!(result.ok, "ui.showModal failed: {:?}", result.error);
        let status = result.data.unwrap().status;
        assert!(status.contains("\"__hostCommands\""));
        assert!(status.contains("\"ui\""));
        assert!(status.contains("\"showModal\""));
        assert!(status.contains("\"returnsResult\":true"));
    }

    #[test]
    fn supports_v1_device_clipboard_and_file_surface() {
        let data_dir = temp_data_dir("device-clipboard-file");
        let safe_area =
            handle_device(Some("getSafeArea"), None).expect("device.getSafeArea should succeed");
        assert_eq!(safe_area.get("ok").and_then(Value::as_bool), Some(true));
        let safe_area_command = safe_area
            .get("__hostCommands")
            .and_then(Value::as_array)
            .and_then(|commands| commands.first())
            .expect("device.getSafeArea should be delegated to Host");
        assert_eq!(
            safe_area_command.get("type").and_then(Value::as_str),
            Some("device")
        );
        assert_eq!(
            safe_area_command.get("action").and_then(Value::as_str),
            Some("getSafeArea")
        );
        assert_eq!(
            safe_area_command
                .get("returnsResult")
                .and_then(Value::as_bool),
            Some(true)
        );
        let window_info = handle_device(Some("getWindowInfo"), None)
            .expect("device.getWindowInfo should succeed");
        assert_eq!(
            window_info
                .get("__hostCommands")
                .and_then(Value::as_array)
                .and_then(|commands| commands.first())
                .and_then(|command| command.get("action"))
                .and_then(Value::as_str),
            Some("getWindowInfo")
        );

        let denied_clipboard = handle_clipboard(
            "test-applet",
            "session-v1-surface",
            Some("setText"),
            Some(json!({ "text": "not-user-activated" })),
        );
        assert!(denied_clipboard.is_err());

        handle_clipboard(
            "test-applet",
            "session-v1-surface",
            Some("setText"),
            Some(json!({ "text": "copied", "userActivated": true })),
        )
        .expect("clipboard.setText should succeed with user activation");
        assert_eq!(
            handle_clipboard("test-applet", "session-v1-surface", Some("getText"), None)
                .expect("clipboard.getText should succeed"),
            json!("copied")
        );

        let written = handle_file(
            "test-applet",
            Some("write"),
            Some(json!({ "path": "state/session.json", "content": "{\"ok\":true}" })),
            &data_dir,
        )
        .expect("file.write should succeed");
        assert_eq!(
            written.get("path").and_then(Value::as_str),
            Some("state/session.json")
        );

        let read = handle_file(
            "test-applet",
            Some("read"),
            Some(json!({ "path": "state/session.json" })),
            &data_dir,
        )
        .expect("file.read should succeed");
        assert_eq!(
            read.get("content").and_then(Value::as_str),
            Some("{\"ok\":true}")
        );

        let entries = handle_file(
            "test-applet",
            Some("list"),
            Some(json!({ "path": "state" })),
            &data_dir,
        )
        .expect("file.list should succeed");
        assert!(entries.to_string().contains("state/session.json"));

        let info = handle_file("test-applet", Some("getInfo"), None, &data_dir)
            .expect("file.getInfo should succeed");
        assert!(info.get("usedBytes").and_then(Value::as_u64).unwrap_or(0) > 0);
    }

    #[test]
    fn enforces_event_subscription_state_and_topic_policy() {
        let data_dir = temp_data_dir("event-subscriptions");
        let session_id = unique_session_id("session-events");
        let session_manifest = manifest(vec![
            "events.subscribe",
            "events.unsubscribe",
            "events.emit",
        ]);

        let unsubscribed_emit = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "events",
                "emit",
                Some(json!({ "topic": "applet.local", "payload": { "value": 1 } })),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(unsubscribed_emit.ok);
        let unsubscribed_payload: Value =
            serde_json::from_str(&unsubscribed_emit.data.unwrap().status).unwrap();
        assert!(unsubscribed_payload.get("__events").is_none());

        subscribe_event(
            &session_id,
            "applet.local",
            session_manifest.clone(),
            &data_dir,
        );

        let subscribed_emit = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "events",
                "emit",
                Some(json!({ "topic": "applet.local", "payload": { "value": 2 } })),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(subscribed_emit.ok);
        let subscribed_payload: Value =
            serde_json::from_str(&subscribed_emit.data.unwrap().status).unwrap();
        assert!(subscribed_payload
            .get("__events")
            .and_then(Value::as_array)
            .is_some());

        let reserved_emit = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "events",
                "emit",
                Some(json!({ "topic": "task.event", "payload": {} })),
                session_manifest,
            ),
            &data_dir,
        );
        assert!(!reserved_emit.ok);
        assert_eq!(
            applet_error_code(&reserved_emit).as_deref(),
            Some("INVALID_PARAMS")
        );
    }

    #[test]
    fn uses_declared_skills_without_hardcoded_skill_results() {
        let data_dir = temp_data_dir("declared-skills");
        let result = applets_invoke_registered(
            context(),
            invoke(
                "session-skills",
                "skills",
                "list",
                None,
                manifest(vec!["skills.list"]),
            ),
            &data_dir,
        );
        assert!(result.ok);
        let status = result.data.unwrap().status;
        assert!(status.contains("declared-skill"));
        assert!(!status.contains("generic-skill"));
    }

    #[test]
    fn supports_runtime_skill_register_invoke_and_policy_deny() {
        let session_id = unique_session_id("session-skill-runtime");
        remove_session_record_for_test(&session_id);
        let data_dir = temp_data_dir("skill-runtime");
        let session_manifest =
            manifest(vec!["skills.register", "skills.invoke", "events.subscribe"]);
        let register = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "skills",
                "register",
                Some(
                    json!({ "spec": { "id": "runtime-skill", "inputSchema": { "type": "object" }, "streaming": true }}),
                ),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(register.ok);
        subscribe_event(
            &session_id,
            "skill.stream",
            session_manifest.clone(),
            &data_dir,
        );

        let invoke_result = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "skills",
                "invoke",
                Some(
                    json!({ "skillId": "runtime-skill", "input": { "value": 1 }, "options": { "stream": true, "requestId": "skill-request-1" }}),
                ),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(invoke_result.ok);
        let payload: Value = serde_json::from_str(&invoke_result.data.unwrap().status).unwrap();
        assert_eq!(payload.get("ok").and_then(Value::as_bool), Some(true));
        assert!(payload.get("__events").and_then(Value::as_array).is_some());

        let denied = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "skills",
                "invoke",
                Some(json!({ "skillId": "runtime-skill", "input": { "policyDeny": true } })),
                session_manifest,
            ),
            &data_dir,
        );
        assert!(denied.ok);
        assert!(denied.data.unwrap().status.contains("POLICY_DENIED"));
    }

    #[test]
    fn rejects_placeholder_skill_when_product_executors_required() {
        let session_id = unique_session_id("session-skill-product-required");
        remove_session_record_for_test(&session_id);
        let data_dir = temp_data_dir("skill-product-required");
        let session_manifest = manifest(vec!["skills.register", "skills.invoke"]);
        let register = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "skills",
                "register",
                Some(
                    json!({ "spec": { "id": "placeholder-skill", "inputSchema": { "type": "object" }, "streaming": false }}),
                ),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(register.ok);

        let invoke_result = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "skills",
                "invoke",
                Some(json!({
                    "skillId": "placeholder-skill",
                    "input": { "value": 1 },
                    "options": { "productExecutorsOnly": true }
                })),
                session_manifest,
            ),
            &data_dir,
        );

        assert!(invoke_result.ok);
        let payload: Value = serde_json::from_str(&invoke_result.data.unwrap().status).unwrap();
        assert_eq!(payload.get("ok").and_then(Value::as_bool), Some(false));
        assert!(payload
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(|error| error.contains("product skill executor is required")));
    }

    #[test]
    fn executes_network_skill_through_gateway_service_policy() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("skill fixture should bind");
        let address = listener
            .local_addr()
            .expect("skill fixture should expose address");
        let server = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0_u8; 2048];
                let _ = stream.read(&mut buffer);
                let body =
                    r#"{"message":"e2e-network-post-ok","echo":{"message":"skill-network"}}"#;
                let response = format!(
                    "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nX-Request-Id: skill-network\r\nSet-Cookie: session=secret\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        std::env::set_var(
            "PEERS_APPLET_SERVICE_SKILL_API",
            format!("http://{}", address),
        );

        let session_id = unique_session_id("session-skill-network");
        let data_dir = temp_data_dir("skill-network");
        let mut session_manifest =
            manifest(vec!["skills.register", "skills.invoke", "events.subscribe"]);
        session_manifest.services[0].id = "skill-api".to_string();
        let register = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "skills",
                "register",
                Some(json!({
                    "spec": {
                        "id": "network-summary",
                        "inputSchema": { "type": "object" },
                        "streaming": true,
                        "executor": {
                            "type": "network",
                            "request": {
                                "service": "skill-api",
                                "path": "/api/v1/e2e/echo",
                                "method": "POST"
                            }
                        }
                    }
                })),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(register.ok);
        subscribe_event(
            &session_id,
            "skill.stream",
            session_manifest.clone(),
            &data_dir,
        );

        let invoke_result = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "skills",
                "invoke",
                Some(json!({
                    "skillId": "network-summary",
                    "input": { "message": "skill-network" },
                    "options": { "stream": true, "requestId": "skill-network-request" }
                })),
                session_manifest,
            ),
            &data_dir,
        );
        assert!(
            invoke_result.ok,
            "network skill failed: {:?}",
            invoke_result.error
        );
        let payload: Value = serde_json::from_str(&invoke_result.data.unwrap().status).unwrap();
        assert_eq!(payload.get("ok").and_then(Value::as_bool), Some(true));
        assert_eq!(
            payload
                .get("output")
                .and_then(|output| output.get("status"))
                .and_then(Value::as_u64),
            Some(201)
        );
        assert_eq!(
            payload
                .get("output")
                .and_then(|output| output.get("body"))
                .and_then(|body| body.get("echo"))
                .and_then(|echo| echo.get("message"))
                .and_then(Value::as_str),
            Some("skill-network")
        );
        assert_eq!(
            payload
                .get("output")
                .and_then(|output| output.get("headers"))
                .and_then(|headers| headers.get("x-request-id"))
                .and_then(Value::as_str),
            Some("skill-network")
        );
        assert!(payload
            .get("output")
            .and_then(|output| output.get("headers"))
            .and_then(|headers| headers.get("set-cookie"))
            .is_none());
        assert!(payload
            .get("__events")
            .and_then(Value::as_array)
            .is_some_and(|events| events.iter().any(|event| {
                event
                    .get("payload")
                    .and_then(|payload| payload.get("type"))
                    .and_then(Value::as_str)
                    == Some("final")
            })));
        server.join().expect("skill fixture should complete");
    }

    #[test]
    fn fails_network_skill_when_service_policy_denies_request() {
        let data_dir = temp_data_dir("skill-network-deny");
        let session_id = unique_session_id("session-skill-network-deny");
        let session_manifest =
            manifest(vec!["skills.register", "skills.invoke", "events.subscribe"]);

        let register = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "skills",
                "register",
                Some(json!({
                    "spec": {
                        "id": "denied-network-summary",
                        "inputSchema": { "type": "object" },
                        "streaming": true,
                        "executor": {
                            "type": "network",
                            "request": {
                                "service": "station-api",
                                "path": "/admin",
                                "method": "POST"
                            }
                        }
                    }
                })),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(register.ok);
        subscribe_event(
            &session_id,
            "skill.stream",
            session_manifest.clone(),
            &data_dir,
        );

        let invoke_result = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "skills",
                "invoke",
                Some(json!({
                    "skillId": "denied-network-summary",
                    "input": { "message": "must-not-run" },
                    "options": { "stream": true, "requestId": "skill-network-deny-request" }
                })),
                session_manifest,
            ),
            &data_dir,
        );

        assert!(
            invoke_result.ok,
            "denied network skill returns typed skill result"
        );
        let payload: Value = serde_json::from_str(&invoke_result.data.unwrap().status).unwrap();
        assert_eq!(payload.get("ok").and_then(Value::as_bool), Some(false));
        assert!(payload
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(|error| error.contains("does not allow path")));
        assert!(payload
            .get("__events")
            .and_then(Value::as_array)
            .is_some_and(|events| events.iter().any(|event| {
                event
                    .get("payload")
                    .and_then(|payload| payload.get("type"))
                    .and_then(Value::as_str)
                    == Some("error")
            })));
    }

    #[test]
    fn denies_agent_skill_executor_without_agent_permission() {
        let data_dir = temp_data_dir("skill-agent-deny");
        let session_id = unique_session_id("session-skill-agent-deny");
        let session_manifest = manifest(vec!["skills.register", "skills.invoke"]);

        let register = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "skills",
                "register",
                Some(json!({
                    "spec": {
                        "id": "agent-summary",
                        "inputSchema": { "type": "object" },
                        "streaming": true,
                        "executor": { "type": "agent" }
                    }
                })),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(register.ok);

        let invoke_result = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "skills",
                "invoke",
                Some(json!({
                    "skillId": "agent-summary",
                    "input": { "message": "must-not-run" }
                })),
                session_manifest,
            ),
            &data_dir,
        );

        assert!(invoke_result.ok);
        let payload: Value = serde_json::from_str(&invoke_result.data.unwrap().status).unwrap();
        assert_eq!(payload.get("ok").and_then(Value::as_bool), Some(false));
        assert!(payload
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(
                |error| error.contains("PERMISSION_DENIED") && error.contains("agent.stream")
            ));
    }

    #[test]
    fn keeps_real_task_lifecycle_state() {
        let data_dir = temp_data_dir("task-lifecycle");
        let session_id = unique_session_id("session-task");
        let session_manifest = manifest(vec![
            "tasks.start",
            "tasks.get",
            "tasks.cancel",
            "events.subscribe",
        ]);
        subscribe_event(
            &session_id,
            "task.event",
            session_manifest.clone(),
            &data_dir,
        );
        let start = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "tasks",
                "start",
                Some(json!({ "kind": "sync", "completeAfterMs": 0 })),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(start.ok);
        let started: Value = serde_json::from_str(&start.data.unwrap().status).unwrap();
        let task_id = started.get("taskId").and_then(Value::as_str).unwrap();
        assert!(started.get("requestId").and_then(Value::as_str).is_some());
        assert!(started.get("updatedAt").and_then(Value::as_str).is_some());
        assert!(started.get("__events").and_then(Value::as_array).is_some());

        let complete = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "tasks",
                "get",
                Some(json!({ "taskId": task_id })),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(complete.ok);
        assert!(complete.data.unwrap().status.contains("completed"));

        let cancel = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "tasks",
                "cancel",
                Some(json!({ "taskId": task_id })),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(cancel.ok);
        assert!(cancel.data.unwrap().status.contains("completed"));

        let cancellable = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "tasks",
                "start",
                Some(json!({ "kind": "cancellable", "completeAfterMs": 10_000 })),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(cancellable.ok);
        let cancellable_payload: Value =
            serde_json::from_str(&cancellable.data.unwrap().status).unwrap();
        let cancellable_task_id = cancellable_payload
            .get("taskId")
            .and_then(Value::as_str)
            .unwrap();

        let cancelled = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "tasks",
                "cancel",
                Some(json!({ "taskId": cancellable_task_id })),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(cancelled.ok);
        assert!(cancelled.data.unwrap().status.contains("cancelled"));

        std::thread::sleep(Duration::from_millis(5));
        let after_cancel = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "tasks",
                "get",
                Some(json!({ "taskId": cancellable_task_id })),
                session_manifest,
            ),
            &data_dir,
        );
        assert!(after_cancel.ok);
        let after_cancel_status = after_cancel.data.unwrap().status;
        assert!(after_cancel_status.contains("cancelled"));
        assert!(!after_cancel_status.contains("completed"));
    }

    #[test]
    fn rejects_placeholder_task_when_product_executors_required() {
        let data_dir = temp_data_dir("task-product-required");
        let session_id = unique_session_id("session-task-product-required");
        let session_manifest = manifest(vec!["tasks.start", "events.subscribe"]);
        subscribe_event(
            &session_id,
            "task.event",
            session_manifest.clone(),
            &data_dir,
        );

        let start = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "tasks",
                "start",
                Some(json!({
                    "taskType": "readiness",
                    "input": { "value": 1 },
                    "productExecutorsOnly": true
                })),
                session_manifest,
            ),
            &data_dir,
        );

        assert!(start.ok, "placeholder task should become failed task");
        let payload: Value = serde_json::from_str(&start.data.unwrap().status).unwrap();
        assert_eq!(payload.get("state").and_then(Value::as_str), Some("failed"));
        assert!(payload
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(|error| error.contains("product task executor is required")));
        assert!(payload
            .get("__events")
            .and_then(Value::as_array)
            .is_some_and(|events| events.iter().any(|event| {
                event
                    .get("payload")
                    .and_then(|payload| payload.get("state"))
                    .and_then(Value::as_str)
                    == Some("failed")
            })));
    }

    #[test]
    fn executes_network_task_through_gateway_service_policy() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("task fixture should bind");
        let address = listener
            .local_addr()
            .expect("task fixture should expose address");
        let server = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0_u8; 2048];
                let _ = stream.read(&mut buffer);
                let body = r#"{"message":"e2e-network-post-ok","echo":{"message":"task-network"}}"#;
                let response = format!(
                    "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nX-Request-Id: task-network\r\nSet-Cookie: session=secret\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        std::env::set_var(
            "PEERS_APPLET_SERVICE_TASK_API",
            format!("http://{}", address),
        );

        let data_dir = temp_data_dir("task-network");
        let session_id = unique_session_id("session-task-network");
        let mut session_manifest = manifest(vec!["tasks.start", "events.subscribe"]);
        session_manifest.services[0].id = "task-api".to_string();
        subscribe_event(
            &session_id,
            "task.event",
            session_manifest.clone(),
            &data_dir,
        );

        let start = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "tasks",
                "start",
                Some(json!({
                    "taskType": "network",
                    "input": {
                        "request": {
                            "service": "task-api",
                            "path": "/api/v1/e2e/echo",
                            "method": "POST",
                            "body": { "message": "task-network" }
                        }
                    }
                })),
                session_manifest,
            ),
            &data_dir,
        );
        assert!(start.ok, "network task failed: {:?}", start.error);
        let payload: Value = serde_json::from_str(&start.data.unwrap().status).unwrap();
        assert_eq!(
            payload.get("state").and_then(Value::as_str),
            Some("completed")
        );
        assert_eq!(
            payload
                .get("output")
                .and_then(|output| output.get("status"))
                .and_then(Value::as_u64),
            Some(201)
        );
        assert_eq!(
            payload
                .get("output")
                .and_then(|output| output.get("body"))
                .and_then(|body| body.get("echo"))
                .and_then(|echo| echo.get("message"))
                .and_then(Value::as_str),
            Some("task-network")
        );
        assert_eq!(
            payload
                .get("output")
                .and_then(|output| output.get("headers"))
                .and_then(|headers| headers.get("x-request-id"))
                .and_then(Value::as_str),
            Some("task-network")
        );
        assert!(payload
            .get("output")
            .and_then(|output| output.get("headers"))
            .and_then(|headers| headers.get("set-cookie"))
            .is_none());
        assert!(payload
            .get("__events")
            .and_then(Value::as_array)
            .is_some_and(|events| events.iter().any(|event| {
                event
                    .get("payload")
                    .and_then(|payload| payload.get("state"))
                    .and_then(Value::as_str)
                    == Some("completed")
            })));
        server.join().expect("task fixture should complete");
    }

    #[test]
    fn fails_network_task_when_service_policy_denies_request() {
        let data_dir = temp_data_dir("task-network-deny");
        let session_id = unique_session_id("session-task-network-deny");
        let session_manifest = manifest(vec!["tasks.start"]);
        let start = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "tasks",
                "start",
                Some(json!({
                    "taskType": "network",
                    "input": {
                        "service": "station-api",
                        "path": "/admin",
                        "method": "POST",
                        "body": { "message": "must-not-run" }
                    }
                })),
                session_manifest,
            ),
            &data_dir,
        );

        assert!(start.ok, "denied network task should become failed task");
        let payload: Value = serde_json::from_str(&start.data.unwrap().status).unwrap();
        assert_eq!(payload.get("state").and_then(Value::as_str), Some("failed"));
        assert!(payload
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(|error| error.contains("does not allow path")));
    }

    #[test]
    fn executes_agent_task_through_station_client() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("agent task fixture should bind");
        let address = listener
            .local_addr()
            .expect("agent task fixture should expose address");
        let server = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0_u8; 2048];
                let _ = stream.read(&mut buffer);
                let body = r#"{"messageId":"agent-task-1","content":"agent-task-ok task-agent"}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        std::env::set_var("PEERS_STATION_URL", format!("http://{}", address));

        let data_dir = temp_data_dir("task-agent");
        let session_id = unique_session_id("session-task-agent");
        let session_manifest = manifest(vec!["tasks.start", "events.subscribe", "agent.stream"]);
        subscribe_event(
            &session_id,
            "task.event",
            session_manifest.clone(),
            &data_dir,
        );

        let start = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "tasks",
                "start",
                Some(json!({
                    "taskType": "agent",
                    "input": {
                        "message": "task-agent",
                        "metadata": { "source": "task-agent-test" }
                    }
                })),
                session_manifest,
            ),
            &data_dir,
        );
        std::env::remove_var("PEERS_STATION_URL");

        assert!(start.ok, "agent task failed: {:?}", start.error);
        let payload: Value = serde_json::from_str(&start.data.unwrap().status).unwrap();
        assert_eq!(
            payload.get("state").and_then(Value::as_str),
            Some("completed")
        );
        assert_eq!(
            payload
                .get("output")
                .and_then(|output| output.get("executor"))
                .and_then(Value::as_str),
            Some("agent")
        );
        assert_eq!(
            payload
                .get("output")
                .and_then(|output| output.get("response"))
                .and_then(|response| response.get("content"))
                .and_then(Value::as_str),
            Some("agent-task-ok task-agent")
        );
        assert!(payload
            .get("__events")
            .and_then(Value::as_array)
            .is_some_and(|events| events.iter().any(|event| {
                event
                    .get("payload")
                    .and_then(|payload| payload.get("state"))
                    .and_then(Value::as_str)
                    == Some("completed")
            })));
        server.join().expect("agent task fixture should complete");
    }

    #[test]
    fn fails_agent_task_executor_without_agent_permission() {
        let data_dir = temp_data_dir("task-agent-deny");
        let session_id = unique_session_id("session-task-agent-deny");
        let session_manifest = manifest(vec!["tasks.start"]);
        let start = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "tasks",
                "start",
                Some(json!({
                    "taskType": "agent",
                    "input": { "message": "must-not-run" }
                })),
                session_manifest,
            ),
            &data_dir,
        );

        assert!(start.ok, "denied agent task should become failed task");
        let payload: Value = serde_json::from_str(&start.data.unwrap().status).unwrap();
        assert_eq!(payload.get("state").and_then(Value::as_str), Some("failed"));
        assert!(payload
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(
                |error| error.contains("PERMISSION_DENIED") && error.contains("agent.stream")
            ));
    }

    #[test]
    fn drains_background_task_events_from_gateway_outbox() {
        let data_dir = temp_data_dir("task-outbox");
        let session_id = unique_session_id("session-task-outbox");
        let session_manifest = manifest(vec![
            "tasks.start",
            "tasks.cancel",
            "events.subscribe",
            "events.poll",
        ]);
        subscribe_event(
            &session_id,
            "task.event",
            session_manifest.clone(),
            &data_dir,
        );

        let start = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "tasks",
                "start",
                Some(json!({ "kind": "background", "completeAfterMs": 10 })),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(start.ok);
        let started: Value = serde_json::from_str(&start.data.unwrap().status).unwrap();
        let task_id = started.get("taskId").and_then(Value::as_str).unwrap();

        std::thread::sleep(Duration::from_millis(80));
        let polled = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "events",
                "poll",
                None,
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(polled.ok);
        let payload: Value = serde_json::from_str(&polled.data.unwrap().status).unwrap();
        let events = payload
            .get("events")
            .and_then(Value::as_array)
            .expect("events.poll should return an events array");
        assert!(events.iter().any(|event| {
            event
                .get("payload")
                .and_then(|payload| payload.get("taskId"))
                .and_then(Value::as_str)
                == Some(task_id)
                && event
                    .get("payload")
                    .and_then(|payload| payload.get("state"))
                    .and_then(Value::as_str)
                    == Some("completed")
        }));

        let drained = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "events",
                "poll",
                None,
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(drained.ok);
        let drained_payload: Value = serde_json::from_str(&drained.data.unwrap().status).unwrap();
        assert!(drained_payload
            .get("events")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty));

        let cancellable = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "tasks",
                "start",
                Some(json!({ "kind": "cancelled-background", "completeAfterMs": 50 })),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(cancellable.ok);
        let cancellable_payload: Value =
            serde_json::from_str(&cancellable.data.unwrap().status).unwrap();
        let cancellable_task_id = cancellable_payload
            .get("taskId")
            .and_then(Value::as_str)
            .unwrap();

        let cancelled = applets_invoke_registered(
            context(),
            invoke(
                &session_id,
                "tasks",
                "cancel",
                Some(json!({ "taskId": cancellable_task_id })),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(cancelled.ok);

        std::thread::sleep(Duration::from_millis(90));
        let after_cancel_poll = applets_invoke_registered(
            context(),
            invoke(&session_id, "events", "poll", None, session_manifest),
            &data_dir,
        );
        assert!(after_cancel_poll.ok);
        let after_cancel_payload: Value =
            serde_json::from_str(&after_cancel_poll.data.unwrap().status).unwrap();
        let after_cancel_events = after_cancel_payload
            .get("events")
            .and_then(Value::as_array)
            .expect("events.poll should return an events array");
        assert!(!after_cancel_events.iter().any(|event| {
            event
                .get("payload")
                .and_then(|payload| payload.get("taskId"))
                .and_then(Value::as_str)
                == Some(cancellable_task_id)
                && event
                    .get("payload")
                    .and_then(|payload| payload.get("state"))
                    .and_then(Value::as_str)
                    == Some("completed")
        }));
    }

    #[test]
    fn reloads_persisted_task_lifecycle_state() {
        let data_dir = temp_data_dir("task-persist");
        let session_manifest = manifest(vec!["tasks.start", "tasks.get"]);
        let start = applets_invoke_registered(
            context(),
            invoke(
                "session-task-persist",
                "tasks",
                "start",
                Some(json!({ "kind": "persist", "completeAfterMs": 10 })),
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(start.ok);
        let started: Value = serde_json::from_str(&start.data.unwrap().status).unwrap();
        let task_id = started
            .get("taskId")
            .and_then(Value::as_str)
            .unwrap()
            .to_string();
        assert!(task_store_path(&data_dir).exists());

        std::thread::sleep(Duration::from_millis(30));
        remove_task_record_for_test(&task_id);

        let reloaded = applets_invoke_registered(
            context(),
            invoke(
                "session-task-persist",
                "tasks",
                "get",
                Some(json!({ "taskId": task_id })),
                session_manifest,
            ),
            &data_dir,
        );
        assert!(reloaded.ok);
        assert!(reloaded.data.unwrap().status.contains("completed"));
    }

    #[test]
    fn live_desktop_e2e_chain() {
        let Ok(base_url) = std::env::var("PEERS_APPLET_E2E_BASE_URL") else {
            return;
        };
        std::env::set_var("PEERS_APPLET_SERVICE_STATION_API", &base_url);
        std::env::set_var("PEERS_STATION_URL", &base_url);
        register_e2e_provider(
            "applet-e2e-provider",
            "openai-compatible",
            "e2e-model",
            &base_url,
        );

        let live_manifest = manifest(vec![
            "network.request",
            "skills.register",
            "skills.invoke",
            "tasks.start",
            "tasks.get",
            "agent.startSession",
            "agent.stream",
            "ai.generate",
            "ai.chat",
        ]);

        let network = applets_invoke_registered(
            context(),
            invoke(
                "session-live",
                "network",
                "request",
                Some(json!({ "service": "station-api", "path": "/api/v1/e2e", "method": "GET" })),
                live_manifest.clone(),
            ),
            Path::new("."),
        );
        assert!(network.ok, "network failed: {:?}", network.error);
        assert!(network.data.unwrap().status.contains("e2e-network-ok"));

        let network_post = applets_invoke_registered(
            context(),
            invoke(
                "session-live",
                "network",
                "request",
                Some(
                    json!({ "service": "station-api", "path": "/api/v1/e2e/echo", "method": "POST", "body": { "message": "station-post" } }),
                ),
                live_manifest.clone(),
            ),
            Path::new("."),
        );
        assert!(
            network_post.ok,
            "network POST failed: {:?}",
            network_post.error
        );
        let network_post_status = network_post.data.unwrap().status;
        assert!(network_post_status.contains("e2e-network-post-ok"));
        assert!(network_post_status.contains("station-post"));

        let network_task = applets_invoke_registered(
            context(),
            invoke(
                "session-live",
                "tasks",
                "start",
                Some(json!({
                    "taskType": "network",
                    "input": {
                        "request": {
                            "service": "station-api",
                            "path": "/api/v1/e2e/echo",
                            "method": "POST",
                            "body": { "message": "task-network" }
                        }
                    }
                })),
                live_manifest.clone(),
            ),
            Path::new("."),
        );
        assert!(
            network_task.ok,
            "network task failed: {:?}",
            network_task.error
        );
        let network_task_status = network_task.data.unwrap().status;
        assert!(network_task_status.contains("\"state\":\"completed\""));
        assert!(network_task_status.contains("e2e-network-post-ok"));
        assert!(network_task_status.contains("task-network"));

        let agent_task = applets_invoke_registered(
            context(),
            invoke(
                "session-live",
                "tasks",
                "start",
                Some(json!({
                    "taskType": "agent",
                    "input": {
                        "message": "task-agent",
                        "metadata": { "source": "live-e2e" }
                    }
                })),
                live_manifest.clone(),
            ),
            Path::new("."),
        );
        assert!(agent_task.ok, "agent task failed: {:?}", agent_task.error);
        let agent_task_status = agent_task.data.unwrap().status;
        assert!(agent_task_status.contains("\"state\":\"completed\""));
        assert!(agent_task_status.contains("agent-e2e-ok"));
        assert!(agent_task_status.contains("task-agent"));

        let skill_register = applets_invoke_registered(
            context(),
            invoke(
                "session-live",
                "skills",
                "register",
                Some(json!({
                    "spec": {
                        "id": "network-summary",
                        "inputSchema": { "type": "object" },
                        "streaming": true,
                        "executor": {
                            "type": "network",
                            "request": {
                                "service": "station-api",
                                "path": "/api/v1/e2e/echo",
                                "method": "POST"
                            }
                        }
                    }
                })),
                live_manifest.clone(),
            ),
            Path::new("."),
        );
        assert!(
            skill_register.ok,
            "skill register failed: {:?}",
            skill_register.error
        );
        let skill = applets_invoke_registered(
            context(),
            invoke(
                "session-live",
                "skills",
                "invoke",
                Some(json!({
                    "skillId": "network-summary",
                    "input": { "message": "skill-network" }
                })),
                live_manifest.clone(),
            ),
            Path::new("."),
        );
        assert!(skill.ok, "skill failed: {:?}", skill.error);
        let skill_status = skill.data.unwrap().status;
        assert!(skill_status.contains("e2e-network-post-ok"));
        assert!(skill_status.contains("skill-network"));

        let agent_skill_register = applets_invoke_registered(
            context(),
            invoke(
                "session-live",
                "skills",
                "register",
                Some(json!({
                    "spec": {
                        "id": "agent-summary",
                        "inputSchema": { "type": "object" },
                        "streaming": true,
                        "executor": { "type": "agent" }
                    }
                })),
                live_manifest.clone(),
            ),
            Path::new("."),
        );
        assert!(
            agent_skill_register.ok,
            "agent skill register failed: {:?}",
            agent_skill_register.error
        );
        let agent_skill = applets_invoke_registered(
            context(),
            invoke(
                "session-live",
                "skills",
                "invoke",
                Some(json!({
                    "skillId": "agent-summary",
                    "input": { "message": "skill-agent" }
                })),
                live_manifest.clone(),
            ),
            Path::new("."),
        );
        assert!(
            agent_skill.ok,
            "agent skill failed: {:?}",
            agent_skill.error
        );
        assert!(agent_skill.data.unwrap().status.contains("agent-e2e-ok"));

        let agent_session = applets_invoke_registered(
            context(),
            invoke(
                "session-live",
                "agent",
                "startSession",
                Some(json!({ "purpose": "e2e" })),
                live_manifest.clone(),
            ),
            Path::new("."),
        );
        assert!(
            agent_session.ok,
            "agent session failed: {:?}",
            agent_session.error
        );

        let agent = applets_invoke_registered(
            context(),
            invoke(
                "session-live",
                "agent",
                "stream",
                Some(json!({ "message": "hello" })),
                live_manifest.clone(),
            ),
            Path::new("."),
        );
        assert!(agent.ok, "agent failed: {:?}", agent.error);
        assert!(agent.data.unwrap().status.contains("agent-e2e-ok"));

        let ai = applets_invoke_registered(
            context(),
            invoke(
                "session-live",
                "ai",
                "chat",
                Some(
                    json!({ "messages": [{ "role": "user", "content": "hello" }], "metadata": { "providerId": "applet-e2e-provider", "model": "e2e-model" }}),
                ),
                live_manifest,
            ),
            Path::new("."),
        );
        assert!(ai.ok, "ai failed: {:?}", ai.error);
        assert!(ai.data.unwrap().status.contains("provider-e2e-ok"));
    }

    #[test]
    fn live_provider_protocol_fixture_matrix() {
        let Ok(base_url) = std::env::var("PEERS_APPLET_E2E_BASE_URL") else {
            return;
        };
        let live_manifest = manifest(vec!["ai.chat"]);
        let cases = [
            (
                "applet-e2e-provider-openai",
                "openai-compatible",
                "e2e-model-openai",
                "provider-e2e-ok",
            ),
            (
                "applet-e2e-provider-anthropic",
                "anthropic",
                "e2e-model-anthropic",
                "provider-anthropic-e2e-ok",
            ),
            (
                "applet-e2e-provider-gemini",
                "gemini",
                "e2e-model-gemini",
                "provider-gemini-e2e-ok",
            ),
            (
                "applet-e2e-provider-ollama",
                "ollama",
                "e2e-model-ollama",
                "provider-ollama-e2e-ok",
            ),
        ];

        for (provider_id, protocol, model_id, expected_text) in cases {
            register_e2e_provider(provider_id, protocol, model_id, &base_url);
            let result = applets_invoke_registered(
                context(),
                invoke(
                    &format!("session-live-provider-{}", protocol),
                    "ai",
                    "chat",
                    Some(
                        json!({ "messages": [{ "role": "user", "content": "hello" }], "metadata": { "providerId": provider_id, "model": model_id }}),
                    ),
                    live_manifest.clone(),
                ),
                Path::new("."),
            );
            assert!(
                result.ok,
                "provider protocol {} failed: {:?}",
                protocol, result.error
            );
            assert!(result.data.unwrap().status.contains(expected_text));
        }
    }

    #[test]
    fn rejects_invocation_after_gateway_session_destroy() {
        let data_dir = temp_data_dir("session-destroy");
        let session_id = "session-destroy";
        let session_manifest = manifest(vec!["app.getContext", "lifecycle.destroy"]);
        remove_session_record_for_test(session_id);
        let ready = applets_invoke_registered(
            context(),
            invoke(
                session_id,
                "app",
                "getContext",
                None,
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(ready.ok);

        let destroy = applets_invoke_registered(
            context(),
            invoke(
                session_id,
                "lifecycle",
                "destroy",
                None,
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(destroy.ok);

        let after_destroy = applets_invoke_registered(
            context(),
            invoke(session_id, "app", "getContext", None, session_manifest),
            &data_dir,
        );
        assert!(!after_destroy.ok);
        assert_eq!(
            after_destroy.error.as_ref().unwrap().code,
            ErrorCode::Unauthorized
        );
        assert_eq!(
            applet_error_code(&after_destroy).as_deref(),
            Some("INVALID_SESSION")
        );
    }

    #[test]
    fn reloads_persisted_destroyed_session_state() {
        let data_dir = temp_data_dir("session-persist");
        let session_id = "session-persist-destroyed";
        let session_manifest = manifest(vec!["app.getContext", "lifecycle.destroy"]);
        remove_session_record_for_test(session_id);
        let ready = applets_invoke_registered(
            context(),
            invoke(
                session_id,
                "app",
                "getContext",
                None,
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(ready.ok);
        let destroyed = applets_invoke_registered(
            context(),
            invoke(
                session_id,
                "lifecycle",
                "destroy",
                None,
                session_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(destroyed.ok);

        remove_session_record_for_test(session_id);

        let after_restart = applets_invoke_registered(
            context(),
            invoke(session_id, "app", "getContext", None, session_manifest),
            &data_dir,
        );
        assert!(!after_restart.ok);
        assert_eq!(
            applet_error_code(&after_restart).as_deref(),
            Some("INVALID_SESSION")
        );
    }

    #[test]
    fn authorizes_atelier_projection_subscription_from_manifest_permission() {
        let data_dir = temp_data_dir("atelier-events-allow");
        let result = applets_invoke_registered(
            context(),
            invoke(
                "session-atelier-events-allow",
                "atelier",
                "events.subscribe",
                Some(json!({ "agentId": "agent-test", "afterEventSeq": 0 })),
                manifest(vec!["atelier.events.subscribe"]),
            ),
            &data_dir,
        );

        assert!(result.ok);
        let payload: Value = serde_json::from_str(&result.data.unwrap().status).unwrap();
        assert_eq!(
            payload.get("topic").and_then(Value::as_str),
            Some("atelier.projection.event")
        );
    }

    #[test]
    fn denies_atelier_projection_subscription_without_manifest_permission() {
        let data_dir = temp_data_dir("atelier-events-deny");
        let result = applets_invoke_registered(
            context(),
            invoke(
                "session-atelier-events-deny",
                "atelier",
                "events.subscribe",
                Some(json!({ "agentId": "agent-test" })),
                manifest(vec!["events.subscribe"]),
            ),
            &data_dir,
        );

        assert!(!result.ok);
        assert_eq!(
            applet_error_code(&result).as_deref(),
            Some("PERMISSION_DENIED")
        );
    }

    #[test]
    fn atelier_workspace_open_accepts_host_intent_only_canonical_uri() {
        let _guard = full_e2e_env_lock();
        let result = handle_atelier_workspace_open(
            "peers.atelier",
            "session-workspace-open",
            Some(json!({
                "taskId": "task-1",
                "workspaceUri": "pt-workspace://task/task-1?workspace=workspace-1",
                "ideHint": "vscode",
                "shell": "open .",
                "execute": true,
                "openExternalUrl": "file:///tmp/workspace"
            })),
        )
        .expect("canonical Host workspace intent should be accepted");

        assert_eq!(result["accepted"], true);
        assert_eq!(result["opened"], false);
        assert_eq!(result["taskId"], "task-1");
        assert_eq!(
            result["workspaceUri"],
            "pt-workspace://task/task-1?workspace=workspace-1"
        );
        assert_eq!(result["ideHint"], "vscode");
        assert_eq!(result["mode"], "host_intent");
        assert!(result.get("localPath").is_none());
        assert!(result.get("file").is_none());
        assert!(result.get("shell").is_none());
        assert!(result.get("execute").is_none());
        assert!(result.get("run").is_none());
        assert!(result.get("openExternalUrl").is_none());
    }

    #[test]
    fn atelier_workspace_open_rejects_non_contract_uri_shapes() {
        let _guard = full_e2e_env_lock();
        for workspace_uri in [
            "file:///tmp/workspace",
            "https://example.com/workspace",
            "pt-workspace://project/task-1?workspace=workspace-1",
            "pt-workspace://task/task-2?workspace=workspace-1",
            "pt-workspace://task/task-1/extra?workspace=workspace-1",
            "pt-workspace://task/task-1",
            "pt-workspace://task/task-1?workspace=",
            "pt-workspace://task/task-1?workspace=workspace-1&extra=1",
            "pt-workspace://task/task-1?workspace=workspace-1#fragment",
            "pt-workspace://user@task/task-1?workspace=workspace-1",
            "pt-workspace://task:443/task-1?workspace=workspace-1",
        ] {
            let result = handle_atelier_workspace_open(
                "peers.atelier",
                "session-workspace-open",
                Some(json!({
                    "taskId": "task-1",
                    "workspaceUri": workspace_uri
                })),
            );

            assert!(
                result.is_err(),
                "expected workspace URI to be rejected: {}",
                workspace_uri
            );
        }
    }

    #[test]
    fn atelier_workspace_open_writes_full_e2e_action_evidence() {
        let _guard = full_e2e_env_lock();
        let data_dir = temp_data_dir("atelier-full-e2e-workspace-open");
        let output_path = data_dir.join("atelier-full-e2e-workspace-open.json");
        std::env::set_var(ATELIER_FULL_E2E_ENV, "1");
        std::env::set_var(ATELIER_FULL_E2E_APPLET_ID_ENV, "peers.atelier");
        std::env::set_var(ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID_ENV, "launch-test-1");
        std::env::set_var(ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE_ENV, &output_path);

        let result = handle_atelier_workspace_open(
            "peers.atelier",
            "session-atl-action",
            Some(json!({
                "taskId": "task-1",
                "workspaceUri": "pt-workspace://task/task-1?workspace=workspace-1",
                "ideHint": "vscode",
            })),
        );

        std::env::remove_var(ATELIER_FULL_E2E_ENV);
        std::env::remove_var(ATELIER_FULL_E2E_APPLET_ID_ENV);
        std::env::remove_var(ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID_ENV);
        std::env::remove_var(ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE_ENV);

        assert!(result.is_ok(), "workspace open failed: {:?}", result);
        let evidence: Value = serde_json::from_slice(
            &fs::read(&output_path).expect("workspace open evidence should be written"),
        )
        .expect("workspace open evidence should be JSON");
        assert_eq!(evidence["ok"], true);
        assert_eq!(evidence["launchId"], "launch-test-1");
        assert_eq!(evidence["appletId"], "peers.atelier");
        assert_eq!(evidence["sessionId"], "session-atl-action");
        assert_eq!(evidence["action"], "atelier.workspace.open");
        assert_eq!(evidence["taskId"], "task-1");
        assert_eq!(
            evidence["workspaceUri"],
            "pt-workspace://task/task-1?workspace=workspace-1"
        );
        assert_eq!(evidence["ideHintRedacted"], true);
        assert_eq!(evidence["ideTargetHash"], atelier_full_e2e_sha256("vscode"));
        assert!(evidence.get("ideHint").is_none());
        assert_eq!(evidence["accepted"], true);
        assert_eq!(evidence["opened"], false);
        assert_eq!(evidence["mode"], "host_intent");
        assert_eq!(evidence["hostSideEffect"], "workspace_open_intent");
        assert_eq!(evidence["realIdeLaunchProven"], false);
    }

    #[test]
    fn atelier_workspace_open_writes_full_e2e_ide_launch_evidence_with_controlled_launcher() {
        let _guard = full_e2e_env_lock();
        let data_dir = temp_data_dir("atelier-full-e2e-ide-launch");
        let workspace_output_path = data_dir.join("atelier-full-e2e-workspace-open.json");
        let ide_output_path = data_dir.join("atelier-full-e2e-ide-launch.json");
        std::env::set_var(ATELIER_FULL_E2E_ENV, "1");
        std::env::set_var(ATELIER_FULL_E2E_APPLET_ID_ENV, "peers.atelier");
        std::env::set_var(ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID_ENV, "launch-test-ide-1");
        std::env::set_var(
            ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE_ENV,
            &workspace_output_path,
        );
        std::env::set_var(ATELIER_FULL_E2E_IDE_LAUNCH_EVIDENCE_ENV, &ide_output_path);
        std::env::set_var(ATELIER_FULL_E2E_IDE_LAUNCHER_ENV, "/usr/bin/true");

        let result = handle_atelier_workspace_open(
            "peers.atelier",
            "session-atl-ide-launch",
            Some(json!({
                "taskId": "task-1",
                "workspaceUri": "pt-workspace://task/task-1?workspace=workspace-1",
                "ideHint": "controlled-ide",
            })),
        );

        std::env::remove_var(ATELIER_FULL_E2E_ENV);
        std::env::remove_var(ATELIER_FULL_E2E_APPLET_ID_ENV);
        std::env::remove_var(ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID_ENV);
        std::env::remove_var(ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE_ENV);
        std::env::remove_var(ATELIER_FULL_E2E_IDE_LAUNCH_EVIDENCE_ENV);
        std::env::remove_var(ATELIER_FULL_E2E_IDE_LAUNCHER_ENV);

        assert!(result.is_ok(), "workspace open failed: {:?}", result);
        let response = result.expect("workspace open response should be present");
        assert_eq!(response["accepted"], true);
        assert_eq!(response["opened"], false);
        assert_eq!(response["mode"], "host_intent");
        assert!(response.get("shell").is_none());
        assert!(response.get("execute").is_none());
        assert!(response.get("openExternalUrl").is_none());

        let ide_evidence: Value = serde_json::from_slice(
            &fs::read(&ide_output_path).expect("IDE launch evidence should be written"),
        )
        .expect("IDE launch evidence should be JSON");
        assert_eq!(ide_evidence["ok"], true);
        assert_eq!(ide_evidence["launchId"], "launch-test-ide-1");
        assert_eq!(ide_evidence["appletId"], "peers.atelier");
        assert_eq!(ide_evidence["sessionId"], "session-atl-ide-launch");
        assert_eq!(ide_evidence["action"], "atelier.workspace.open");
        assert_eq!(ide_evidence["taskId"], "task-1");
        assert_eq!(
            ide_evidence["workspaceUri"],
            "pt-workspace://task/task-1?workspace=workspace-1"
        );
        assert_eq!(ide_evidence["ideTargetRedacted"], true);
        assert_eq!(
            ide_evidence["ideTargetHash"],
            atelier_full_e2e_sha256("controlled-ide")
        );
        assert!(ide_evidence.get("ideTarget").is_none());
        assert_eq!(ide_evidence["realIdeLaunchProven"], true);
        assert_eq!(ide_evidence["launchOwner"], "desktop_host");
        assert_eq!(ide_evidence["resolver"], "desktop_host.pt_workspace_uri");
        assert_eq!(ide_evidence["workspaceId"], "workspace-1");
        assert_eq!(
            ide_evidence["launchCommand"],
            "env:PEERS_ATELIER_FULL_E2E_IDE_LAUNCHER"
        );
        assert_eq!(ide_evidence["appletFileShellExecuteExposed"], false);
        assert_eq!(ide_evidence["appletOpenExternalUrlExposed"], false);
    }

    #[test]
    fn reuses_and_cancels_atelier_projection_subscription_registry() {
        let data_dir = temp_data_dir("atelier-registry");
        let applet_id = "atelier";
        let session_id = unique_session_id("atelier-registry");
        let first = ensure_atelier_projection_subscription(
            applet_id,
            &session_id,
            "agent-test",
            Some("task-1"),
            7,
            &data_dir,
        )
        .expect("first subscription should register");
        assert!(first.started);
        assert_eq!(first.after_event_seq, 7);

        mark_atelier_projection_event_seq(&first.key, &first.cursor_key, 11, &data_dir)
            .expect("cursor should persist");
        let second = ensure_atelier_projection_subscription(
            applet_id,
            &session_id,
            "agent-test",
            Some("task-1"),
            0,
            &data_dir,
        )
        .expect("duplicate subscription should reuse");
        assert!(!second.started);
        assert_eq!(second.after_event_seq, 11);
        assert!(is_atelier_projection_subscription_active(&first.key));

        cancel_atelier_projection_subscriptions_for_session(applet_id, &session_id);
        assert!(!is_atelier_projection_subscription_active(&first.key));

        let third = ensure_atelier_projection_subscription(
            applet_id,
            &session_id,
            "agent-test",
            Some("task-1"),
            3,
            &data_dir,
        )
        .expect("cancelled subscription should restart");
        assert!(third.started);
        assert_eq!(third.after_event_seq, 11);
    }

    #[test]
    fn reloads_atelier_projection_cursor_after_registry_restart() {
        let data_dir = temp_data_dir("atelier-cursor-persist");
        let applet_id = "atelier";
        let session_id = unique_session_id("atelier-cursor-persist");
        let first = ensure_atelier_projection_subscription(
            applet_id,
            &session_id,
            "agent-test",
            Some("task-1"),
            7,
            &data_dir,
        )
        .expect("first subscription should register");
        mark_atelier_projection_event_seq(&first.key, &first.cursor_key, 19, &data_dir)
            .expect("cursor should persist");
        if let Ok(mut guard) = atelier_projection_subscription_store().lock() {
            guard.remove(&first.key);
        }
        let restarted_session_id = unique_session_id("atelier-cursor-persist-restart");

        let restored = ensure_atelier_projection_subscription(
            applet_id,
            &restarted_session_id,
            "agent-test",
            Some("task-1"),
            0,
            &data_dir,
        )
        .expect("subscription should restore persisted cursor");

        assert!(restored.started);
        assert_eq!(restored.after_event_seq, 19);
        assert_ne!(restored.key, first.key);
        assert_eq!(restored.cursor_key, first.cursor_key);
        assert_eq!(
            load_atelier_projection_cursor(&data_dir, &first.cursor_key)
                .expect("cursor store should be readable"),
            19
        );
    }

    #[test]
    fn maps_station_artifact_event_to_atelier_projection_patch() {
        let projected = station_event_to_atelier_projection_event(json!({
            "event_id": "evt_artifact_1",
            "metadata": {
                "task_id": "collab_1",
                "event_seq": 12
            },
            "payload": {
                "block_kind": "artifact",
                "artifact_id": "art_1",
                "name": "report.md",
                "kind": "markdown",
                "markdown": "# Report",
                "preview_hint": "metadata_only",
                "body_ref": "artifact://collab_1/art_1/body",
                "body_hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "body_size": 8,
                "body_kind": "markdown",
                "preview_target": {
                    "kind": "markdown",
                    "mode": "sandbox_manifest",
                    "label": "Host sandbox preview manifest",
                    "sandbox_ref": "atelier-sandbox://collab_1/art_1/preview",
                    "body_ref": "artifact://collab_1/art_1/body"
                }
            }
        }))
        .expect("expected artifact event to project");

        assert_eq!(projected["patch"]["kind"], "artifact.upsert");
        assert_eq!(projected["patch"]["taskId"], "collab_1");
        assert_eq!(projected["patch"]["artifact"]["id"], "art_1");
        assert!(projected["patch"]["artifact"].get("markdown").is_none());
        assert_eq!(
            projected["patch"]["artifact"]["previewHint"],
            "metadata_only"
        );
        assert_eq!(
            projected["patch"]["artifact"]["bodyRef"],
            "artifact://collab_1/art_1/body"
        );
        assert_eq!(
            projected["patch"]["artifact"]["bodyHash"],
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
        assert_eq!(projected["patch"]["artifact"]["bodySize"], "8");
        assert_eq!(projected["patch"]["artifact"]["bodyKind"], "markdown");
        assert_eq!(
            projected["patch"]["artifact"]["previewTarget"]["mode"],
            "sandbox_manifest"
        );
        assert_eq!(
            projected["patch"]["artifact"]["previewTarget"]["sandboxRef"],
            "atelier-sandbox://collab_1/art_1/preview"
        );
        assert_eq!(
            projected["patch"]["artifact"]["previewTarget"]["bodyRef"],
            "artifact://collab_1/art_1/body"
        );
        assert!(projected["patch"]["artifact"]["previewTarget"]
            .get("url")
            .is_none());
    }

    #[test]
    fn maps_station_gate_event_to_atelier_projection_patch() {
        let projected = station_event_to_atelier_projection_event(json!({
            "event_id": "evt_gate_1",
            "metadata": {
                "task_id": "collab_1",
                "event_seq": 13
            },
            "payload": {
                "block_kind": "gate_result",
                "gate_id": "gate_1",
                "name": "Verification Gate",
                "status": "passed",
                "summary": "All checks passed",
                "artifactIds": ["art_1"],
                "checks": [
                    { "name": "unit", "status": "passed" }
                ]
            }
        }))
        .expect("expected gate event to project");

        assert_eq!(projected["patch"]["kind"], "gate.upsert");
        assert_eq!(projected["patch"]["taskId"], "collab_1");
        assert_eq!(projected["patch"]["gate"]["id"], "gate_1");
        assert_eq!(projected["patch"]["gate"]["status"], "passed");
        assert_eq!(projected["patch"]["gate"]["artifactIds"][0], "art_1");
    }

    #[test]
    fn captures_gateway_audit_evidence_for_security_paths() {
        let _ = drain_audit_records();
        let data_dir = temp_data_dir("audit");

        let allowed = applets_invoke_registered(
            context(),
            invoke(
                "session-audit-allow",
                "app",
                "getContext",
                None,
                manifest(vec!["app.getContext"]),
            ),
            &data_dir,
        );
        assert!(allowed.ok);

        let denied = applets_invoke_registered(
            context(),
            invoke(
                "session-audit-deny",
                "ai",
                "chat",
                None,
                manifest(vec!["app.getContext"]),
            ),
            &data_dir,
        );
        assert!(!denied.ok);

        let destroy_session_id = "session-audit-destroy";
        let destroy_manifest = manifest(vec!["app.getContext", "lifecycle.destroy"]);
        let ready = applets_invoke_registered(
            context(),
            invoke(
                destroy_session_id,
                "app",
                "getContext",
                None,
                destroy_manifest.clone(),
            ),
            &data_dir,
        );
        assert!(ready.ok);
        let destroyed = applets_invoke_registered(
            context(),
            invoke(
                destroy_session_id,
                "lifecycle",
                "destroy",
                None,
                destroy_manifest,
            ),
            &data_dir,
        );
        assert!(destroyed.ok);

        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").expect("audit fixture should bind");
        let audit_address = listener
            .local_addr()
            .expect("audit fixture should expose address");
        drop(listener);
        std::env::set_var(
            "PEERS_APPLET_SERVICE_AUDIT_API",
            format!("http://{}", audit_address),
        );
        let mut audit_manifest = manifest(vec!["network.request"]);
        audit_manifest.services[0].id = "audit-api".to_string();
        let network_allowed = applets_invoke_registered(
            context(),
            invoke(
                "session-audit-network-allow",
                "network",
                "request",
                Some(json!({ "service": "audit-api", "path": "/api/v1/e2e", "method": "GET" })),
                audit_manifest,
            ),
            &data_dir,
        );
        std::env::remove_var("PEERS_APPLET_SERVICE_AUDIT_API");
        assert!(!network_allowed.ok);

        let network_denied = applets_invoke_registered(
            context(),
            invoke(
                "session-audit-network-deny",
                "network",
                "request",
                Some(json!({ "url": "https://example.com/api" })),
                manifest(vec!["network.request"]),
            ),
            &data_dir,
        );
        assert!(!network_denied.ok);

        let mut forged_manifest = manifest(vec!["app.getContext"]);
        forged_manifest.id = "forged-applet".to_string();
        let anti_forge = applets_invoke_registered(
            context(),
            invoke(
                "session-audit-forge",
                "app",
                "getContext",
                None,
                forged_manifest,
            ),
            &data_dir,
        );
        assert!(!anti_forge.ok);

        let audit = drain_audit_records();
        assert!(audit
            .iter()
            .any(|record| record.capability == "app" && record.outcome == "ok"));
        assert!(audit
            .iter()
            .any(|record| record.capability == "ai.chat" && record.outcome == "permission_denied"));
        assert!(audit
            .iter()
            .any(|record| record.capability == "lifecycle.destroy" && record.outcome == "ok"));
        assert!(audit
            .iter()
            .any(|record| record.capability == "network" && record.outcome == "error"));
        assert!(audit
            .iter()
            .any(|record| record.capability == "applets.create_session"
                && record.outcome == "manifest_mismatch"));
    }
}
