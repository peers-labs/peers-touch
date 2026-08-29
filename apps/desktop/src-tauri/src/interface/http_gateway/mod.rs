// HTTP Gateway for dev-mode frontend invocations.
//
// Replaces tauri-plugin-dev-invoke with a multi-threaded HTTP server
// powered by tiny_http + threadpool, listening on 127.0.0.1:3030.
//
// Protocol: POST JSON { "cmd": "<command_name>", "args": { ... } }
// Response: JSON serialization of the command's return value.
//
// 2026-04-09: Initial creation. Full 1:1 mapping of all 237 tauri commands.

use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::Signer;
use rand::rngs::OsRng;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use x25519_dalek::{PublicKey, StaticSecret};

use crate::contracts::*;
use crate::domain::crypto::{self};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::local_chat_store;
use crate::state::AppState;

// -------------------------------------------------------------------------
// Application layer imports (mirrors tauri_commands structure)
// -------------------------------------------------------------------------
use crate::application::account as app_account;
use crate::application::admin as app_admin;
use crate::application::agent_orchestration as app_agent_orchestration;
use crate::application::agent_turn as app_agent_turn;
use crate::application::agents as app_agents;
use crate::application::applet_store as app_applet_store;
use crate::application::applets as app_applets;
use crate::application::auth::service as app_auth;
use crate::application::channels as app_channels;
use crate::application::chat as app_chat;
use crate::application::chat_storage;
use crate::application::cron as app_cron;
use crate::application::federation as app_federation;
use crate::application::key_exchange::{device_install, wire};
use crate::application::mcp as app_mcp;
use crate::application::memory as app_memory;
use crate::application::model_config as app_model_config;
// FIXME: removed during merge — module deleted
// use crate::application::models as app_models;
use crate::application::notebook as app_notebook;
use crate::application::oauth2 as app_oauth2;
use crate::application::oss as app_oss;
use crate::application::profile as app_profile;
use crate::application::provider as app_provider;
use crate::application::search as app_search;
use crate::application::settings as app_settings;
use crate::application::skills as app_skills;
use crate::application::skills_market as app_skills_market;
use crate::application::system as app_system;
use crate::application::tools as app_tools;
use crate::application::tts as app_tts;

// Actor & chat modules use station_client + proto directly
use crate::infrastructure::station_client;
use crate::interface::tauri_commands::oss::{
    safe_temp_filename, validate_oss_upload_scope, OssUploadAttachmentBytesInput,
};
use crate::model;
use prost::Message;
use reqwest::Method;
use ulid::Ulid;

const DEFAULT_PORT: u16 = 3030;
const POOL_SIZE: usize = 8;
const MAX_FRONTEND_TELEMETRY_BATCH_EVENTS: usize = 500;

#[derive(Clone)]
enum GatewayRuntime {
    Tauri { app_handle: AppHandle },
    Headless,
}

impl GatewayRuntime {
    fn tauri(app_handle: AppHandle) -> Self {
        Self::Tauri { app_handle }
    }

    #[cfg(test)]
    fn headless() -> Self {
        Self::Headless
    }

    fn app_handle(&self, command: &'static str) -> Result<AppHandle, Value> {
        match self {
            Self::Tauri { app_handle } => Ok(app_handle.clone()),
            Self::Headless => Err(to_json(AppResult::<StubPayload>::fail(
                ErrorCode::InvalidArgument,
                format!("{command} requires a Tauri AppHandle"),
                None,
            ))),
        }
    }
}

fn group_chat_federated_actor_input_to_proto(
    input: GroupChatFederatedActorInput,
) -> model::chat::FederatedActorRef {
    model::chat::FederatedActorRef {
        ptid: input.actor_did,
        home_station_peer_id: input.home_station_peer_id,
        home_station_domain: input.home_station_domain.unwrap_or_default(),
        federated_handle: input.federated_handle.unwrap_or_default(),
        actor_identity_public_key: input.actor_identity_public_key.unwrap_or_default(),
        profile_version: input.profile_version.unwrap_or_default(),
        federation_id: input.federation_id.unwrap_or_default(),
    }
}

fn resolve_bind_addr() -> String {
    let port = std::env::var("PT_GATEWAY_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    format!("127.0.0.1:{}", port)
}

/// Spawn a background thread that runs the HTTP gateway server.
///
/// The server listens on the port specified by PT_GATEWAY_PORT env var
/// (default 3030) and dispatches incoming POST requests to the same
/// application-layer functions used by tauri_commands.
pub fn start(state: Arc<AppState>, app_handle: AppHandle) {
    start_with_runtime(state, GatewayRuntime::tauri(app_handle));
}

fn start_with_runtime(state: Arc<AppState>, runtime: GatewayRuntime) {
    std::thread::Builder::new()
        .name("http-gateway".into())
        .spawn(move || {
            let bind_addr = resolve_bind_addr();
            let server = match tiny_http::Server::http(&bind_addr) {
                Ok(s) => {
                    tracing::info!(addr = %bind_addr, "HTTP gateway started");
                    s
                }
                Err(e) => {
                    tracing::error!(error = %e, "Failed to start HTTP gateway");
                    return;
                }
            };

            let pool = threadpool::ThreadPool::new(POOL_SIZE);
            let server = Arc::new(server);

            loop {
                let request = match server.recv() {
                    Ok(req) => req,
                    Err(e) => {
                        tracing::warn!(error = %e, "HTTP gateway recv error");
                        continue;
                    }
                };

                let state = Arc::clone(&state);
                let runtime = runtime.clone();
                pool.execute(move || {
                    handle_request(request, &state, &runtime);
                });
            }
        })
        .expect("[http_gateway] Failed to spawn server thread");
}

// -------------------------------------------------------------------------
// Request handling
// -------------------------------------------------------------------------

fn handle_request(mut request: tiny_http::Request, state: &AppState, runtime: &GatewayRuntime) {
    // CORS preflight
    if *request.method() == tiny_http::Method::Options {
        let response = tiny_http::Response::empty(200)
            .with_header(cors_origin())
            .with_header(cors_methods())
            .with_header(cors_headers());
        let _ = request.respond(response);
        return;
    }

    // GET /avatar?url=<remote-url>: serve a cached avatar image as bytes.
    //
    // This route exists because the dev-mode browser window cannot use
    // Tauri's `convertFileSrc` to render local filesystem paths (the
    // polyfill in `main.tsx` is a no-op). Without this route, an `<img>`
    // pointed at `/Users/.../files/avatars/xxx` would fail to load and
    // every avatar in the browser instance falls back to initials —
    // making "two friends, one window shows the avatar, one doesn't"
    // a visible bug under `make dev-dual`.
    //
    // We deliberately do NOT require auth on this endpoint. The gateway
    // already binds to 127.0.0.1 only, so it is local-only by design;
    // and the avatar cache only ever holds files we already chose to
    // download from Station.
    if request.method() == &tiny_http::Method::Get {
        let url = request.url().to_string();
        if url.starts_with("/avatar") || url.starts_with("/avatar?") {
            handle_avatar_get(request, &url);
            return;
        }
        // Unknown GET path → 404, but respond with proper CORS so the
        // browser can read the body for diagnostics.
        let body = json!({"ok": false, "error": "not found"}).to_string();
        let response = tiny_http::Response::from_string(body)
            .with_status_code(404)
            .with_header(content_type_json())
            .with_header(cors_origin());
        let _ = request.respond(response);
        return;
    }

    // Only accept POST for command dispatch
    if request.method() != &tiny_http::Method::Post {
        let body = json!({"ok": false, "error": "method not allowed"}).to_string();
        let response = tiny_http::Response::from_string(body)
            .with_status_code(405)
            .with_header(content_type_json())
            .with_header(cors_origin());
        let _ = request.respond(response);
        return;
    }

    // Read body
    let mut body = String::new();
    if let Err(e) = request.as_reader().read_to_string(&mut body) {
        let err = json!({"ok": false, "error": format!("read body failed: {e}")}).to_string();
        let response = tiny_http::Response::from_string(err)
            .with_status_code(400)
            .with_header(content_type_json())
            .with_header(cors_origin());
        let _ = request.respond(response);
        return;
    }

    // Parse { cmd, args }
    let parsed: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            let err = json!({"ok": false, "error": format!("invalid json: {e}")}).to_string();
            let response = tiny_http::Response::from_string(err)
                .with_status_code(400)
                .with_header(content_type_json())
                .with_header(cors_origin());
            let _ = request.respond(response);
            return;
        }
    };

    let cmd = parsed.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
    let raw_args = parsed.get("args").cloned().unwrap_or(json!({}));

    // Tauri invoke wraps command params as { "input": <actual_data> }.
    // Frontend's invokeRustCommand calls invoke(cmd, { input }) so the
    // gateway always receives { "input": ... }. Unwrap that envelope
    // so dispatch functions receive the inner payload directly.
    let args = match raw_args.get("input") {
        Some(inner) => inner.clone(),
        None => raw_args,
    };

    let result = dispatch(cmd, args, state, runtime);

    let response_body = result.to_string();
    let response = tiny_http::Response::from_string(response_body)
        .with_status_code(200)
        .with_header(content_type_json())
        .with_header(cors_origin());
    let _ = request.respond(response);
}

// -------------------------------------------------------------------------
// /avatar route
// -------------------------------------------------------------------------

fn handle_avatar_get(request: tiny_http::Request, url: &str) {
    let remote_url = match parse_avatar_query(url) {
        Some(u) if !u.is_empty() => u,
        _ => {
            let body = json!({"ok": false, "error": "missing or empty 'url' query"}).to_string();
            let response = tiny_http::Response::from_string(body)
                .with_status_code(400)
                .with_header(content_type_json())
                .with_header(cors_origin());
            let _ = request.respond(response);
            return;
        }
    };

    // Resolve via the same cache the Tauri webview uses. Both paths share
    // one on-disk cache, so a hit in the native window guarantees a hit
    // here too — no duplicate downloads.
    let path = match crate::infrastructure::avatar_cache::ensure_local(&remote_url) {
        Ok(p) => p,
        Err(err) => {
            tracing::debug!(error = %err, url = %remote_url, "avatar gateway: ensure_local failed");
            // 404 instead of 5xx so the browser's <img onerror> path runs
            // cleanly and falls back to the initials placeholder.
            let body = json!({"ok": false, "error": format!("{}", err)}).to_string();
            let response = tiny_http::Response::from_string(body)
                .with_status_code(404)
                .with_header(content_type_json())
                .with_header(cors_origin());
            let _ = request.respond(response);
            return;
        }
    };

    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(err) => {
            tracing::warn!(error = %err, path = %path.display(), "avatar gateway: read failed");
            let body = json!({"ok": false, "error": format!("read failed: {}", err)}).to_string();
            let response = tiny_http::Response::from_string(body)
                .with_status_code(500)
                .with_header(content_type_json())
                .with_header(cors_origin());
            let _ = request.respond(response);
            return;
        }
    };

    let mime = guess_image_mime(&path).unwrap_or("application/octet-stream");
    let len = bytes.len();
    // 5-minute browser cache: avatars rarely change and the URL hash
    // already invalidates on content change (cache filename is derived
    // from the remote URL).
    let cache_header: tiny_http::Header = "Cache-Control: private, max-age=300".parse().unwrap();
    let mime_header: tiny_http::Header = format!("Content-Type: {}", mime).parse().unwrap();
    let response = tiny_http::Response::from_data(bytes)
        .with_header(mime_header)
        .with_header(cache_header)
        .with_header(cors_origin());
    let _ = request.respond(response);
    tracing::debug!(url = %remote_url, bytes = len, mime, "avatar gateway: served");
}

fn parse_avatar_query(url: &str) -> Option<String> {
    let qpos = url.find('?')?;
    let qs = &url[qpos + 1..];
    for pair in qs.split('&') {
        let mut it = pair.splitn(2, '=');
        let key = it.next().unwrap_or("");
        let value = it.next().unwrap_or("");
        if key == "url" {
            return Some(percent_decode(value));
        }
    }
    None
}

// Tiny percent-decoder. We only need this for the `url=` query parameter
// (frontend passes `encodeURIComponent(remoteUrl)`). Avoiding a full
// `urlencoding` crate dep keeps the gateway lean.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'+' {
            out.push(b' ');
            i += 1;
        } else if b == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push(((h << 4) | l) as u8);
                i += 3;
            } else {
                out.push(b);
                i += 1;
            }
        } else {
            out.push(b);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn guess_image_mime(path: &std::path::Path) -> Option<&'static str> {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some("png") => Some("image/png"),
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        Some("svg") => Some("image/svg+xml"),
        Some("bmp") => Some("image/bmp"),
        Some("ico") => Some("image/x-icon"),
        // Default for cache files (filename-hash, no extension): jpeg is
        // the most common avatar format from the OSS server.
        _ => Some("image/jpeg"),
    }
}

// -------------------------------------------------------------------------
// CORS & Content-Type helpers
// -------------------------------------------------------------------------

fn cors_origin() -> tiny_http::Header {
    "Access-Control-Allow-Origin: *".parse().unwrap()
}

fn cors_methods() -> tiny_http::Header {
    "Access-Control-Allow-Methods: GET, POST, OPTIONS"
        .parse()
        .unwrap()
}

fn cors_headers() -> tiny_http::Header {
    "Access-Control-Allow-Headers: Content-Type"
        .parse()
        .unwrap()
}

fn content_type_json() -> tiny_http::Header {
    "Content-Type: application/json; charset=utf-8"
        .parse()
        .unwrap()
}

// -------------------------------------------------------------------------
// State extraction helpers (equivalent to tauri_commands helpers)
// -------------------------------------------------------------------------

fn token_from_state(state: &AppState) -> Result<String, Value> {
    let guard = state.session.lock().map_err(|_| {
        serde_json::to_value(AppResult::<StubPayload>::fail(
            ErrorCode::InternalError,
            "failed to access session state",
            None,
        ))
        .unwrap_or(json!({"ok": false}))
    })?;
    let token = guard.token.clone().unwrap_or_default();
    if token.trim().is_empty() {
        return Err(serde_json::to_value(AppResult::<StubPayload>::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ))
        .unwrap_or(json!({"ok": false})));
    }
    Ok(token)
}

fn proxy_authenticated_station_json(
    state: &AppState,
    method: reqwest::Method,
    path: &str,
    query: Option<Vec<(&'static str, String)>>,
    body: Option<Value>,
    operation: &str,
) -> Value {
    let token = match token_from_state(state) {
        Ok(token) => token,
        Err(error) => return error,
    };
    match crate::infrastructure::station_client::request_json_auth(
        method,
        path,
        &token,
        query.as_deref(),
        body.as_ref(),
    ) {
        Ok(response) => to_json(AppResult::success(response)),
        Err(error) => to_json(AppResult::<Value>::fail(
            ErrorCode::InternalError,
            format!("{operation}: {error}"),
            None,
        )),
    }
}

fn actor_id_from_state(state: &AppState) -> Option<String> {
    state.session.lock().ok().and_then(|g| g.actor_id.clone())
}

fn user_scope_from_state(state: &AppState) -> String {
    let actor_id = actor_id_from_state(state);
    crate::infrastructure::local_scope::user_scope_for_actor(actor_id.as_deref())
}

fn now_unix_seconds_i32() -> i32 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().min(i32::MAX as u64) as i32)
        .unwrap_or(0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignalingEnvelopeSealInput {
    #[serde(alias = "peer_ik_pub")]
    peer_ik_pub: String,
    #[serde(alias = "session_ulid")]
    session_ulid: String,
    kind: String,
    plaintext: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignalingEnvelopeOpenInput {
    #[serde(alias = "sender_ik_pub")]
    sender_ik_pub: String,
    #[serde(alias = "session_ulid")]
    session_ulid: String,
    kind: String,
    #[serde(alias = "payload_b64")]
    payload_b64: String,
}

fn local_identity_x25519_from_state(
    state: &AppState,
) -> Result<(StaticSecret, PublicKey), AppResult<StubPayload>> {
    let actor_id = match actor_id_from_state(state) {
        Some(id) if !id.trim().is_empty() => id,
        _ => {
            return Err(AppResult::fail(
                ErrorCode::Unauthorized,
                "Authentication required — please log in",
                None,
            ));
        }
    };
    let identity_key_ref =
        crate::infrastructure::local_scope::LocalScope::from_actor(actor_id.as_str())
            .identity_key_ref();
    let ik = match crypto::get_or_create_identity(identity_key_ref.as_str()) {
        Ok(k) => k,
        Err(reason) => {
            return Err(AppResult::fail(
                ErrorCode::InternalError,
                format!("Identity operation failed: {}", reason),
                None,
            ));
        }
    };
    let kp = crypto::ed25519_to_x25519(&ik.signing_key);
    Ok((kp.private, kp.public))
}

fn peer_x25519_pub_from_ed25519(
    label: &str,
    ed_pub_b64: &str,
) -> Result<PublicKey, AppResult<StubPayload>> {
    let raw = match B64.decode(ed_pub_b64.trim()) {
        Ok(b) => b,
        Err(e) => {
            return Err(AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("Invalid base64 for {}: {}", label, e),
                None,
            ));
        }
    };
    if raw.len() != 32 {
        return Err(AppResult::fail(
            ErrorCode::InvalidArgument,
            format!("{} must decode to 32 bytes, got {}", label, raw.len()),
            None,
        ));
    }
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&raw);
    let verifying = match ed25519_dalek::VerifyingKey::from_bytes(&bytes) {
        Ok(v) => v,
        Err(e) => {
            return Err(AppResult::fail(
                ErrorCode::InvalidArgument,
                format!("{} is not a valid Ed25519 public key: {}", label, e),
                None,
            ));
        }
    };
    crypto::ed25519_verifying_to_x25519_public(&verifying).map_err(|reason| {
        AppResult::fail(
            ErrorCode::InvalidArgument,
            format!("{}: Ed25519 -> X25519 conversion failed: {}", label, reason),
            None,
        )
    })
}

fn resolve_scope(state: &AppState) -> Result<Option<String>, Value> {
    let guard = state.session.lock().map_err(|_| {
        serde_json::to_value(AppResult::<StubPayload>::fail(
            ErrorCode::InternalError,
            "failed to access session state",
            None,
        ))
        .unwrap_or(json!({"ok": false}))
    })?;
    let scope = guard.actor_id.clone().unwrap_or_default();
    let scope = scope.trim();
    if scope.is_empty() {
        return Ok(None);
    }
    Ok(Some(scope.to_string()))
}

/// Convenience: serialize any AppResult<T: Serialize> to Value.
fn to_json<T: serde::Serialize>(r: AppResult<T>) -> Value {
    serde_json::to_value(r).unwrap_or(json!({"ok": false, "error": {"code": "INTERNAL_ERROR", "message": "serialization failed"}}))
}

/// Deserialize args into T, returning a JSON error Value on failure.
fn parse_args<T: serde::de::DeserializeOwned>(args: Value) -> Result<T, Value> {
    serde_json::from_value(args).map_err(|e| {
        to_json(AppResult::<StubPayload>::fail(
            ErrorCode::InvalidArgument,
            format!("invalid args: {e}"),
            None,
        ))
    })
}

fn string_arg(args: &Value, snake_case: &str, camel_case: &str) -> String {
    args.get(snake_case)
        .or_else(|| args.get(camel_case))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn optional_string_arg(args: &Value, snake_case: &str, camel_case: &str) -> Option<String> {
    let value = string_arg(args, snake_case, camel_case);
    (!value.trim().is_empty()).then_some(value)
}

fn u32_arg(args: &Value, snake_case: &str, camel_case: &str) -> u32 {
    args.get(snake_case)
        .or_else(|| args.get(camel_case))
        .and_then(Value::as_u64)
        .unwrap_or_default() as u32
}

fn authenticated_crypto_context(state: &AppState) -> Result<(String, String), Value> {
    let actor_id = actor_id_from_state(state)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            to_json(AppResult::<StubPayload>::fail(
                ErrorCode::Unauthorized,
                "Authentication required — please log in",
                None,
            ))
        })?;
    Ok((actor_id, user_scope_from_state(state)))
}

fn dispatch_oss_upload_agent_attachment_bytes(args: Value, state: &AppState) -> Value {
    let input = match parse_args::<OssUploadAttachmentBytesInput>(args) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let token = match token_from_state(state) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.bytes.is_empty() {
        return to_json(AppResult::<StubPayload>::fail(
            ErrorCode::InvalidArgument,
            "bytes is required",
            None,
        ));
    }

    let vis = input.visibility.trim().to_ascii_lowercase();
    let (bucket, visibility, chat_sid) = match validate_oss_upload_scope(
        input.bucket.as_str(),
        vis.as_str(),
        &input.chat_session_id,
    ) {
        Ok(scope) => scope,
        Err(error) => return to_json(error),
    };
    let bucket = bucket.to_string();
    let visibility = visibility.to_string();
    let chat_sid = chat_sid.map(str::to_string);
    let filename = safe_temp_filename(input.filename.as_str());
    let mime_override = input.mime_type.trim().to_string();
    let temp_path = std::env::temp_dir().join(format!("peers-agent-{}-{}", Ulid::new(), filename));

    if let Err(error) = std::fs::write(&temp_path, input.bytes) {
        return to_json(AppResult::<StubPayload>::fail(
            ErrorCode::InternalError,
            format!("write temp Agent attachment: {error}"),
            None,
        ));
    }
    let cleanup = app_oss::TempFileCleanup::new(temp_path.clone(), "HTTP Agent attachment");

    let result = app_oss::upload_attachment_with_mime(
        temp_path.to_string_lossy().as_ref(),
        &token,
        "agent",
        bucket.as_str(),
        visibility.as_str(),
        chat_sid.as_deref(),
        if mime_override.is_empty() {
            None
        } else {
            Some(mime_override.as_str())
        },
    );
    cleanup.remove_now();
    to_json(result)
}

/// Debug HTTP gateway: resolve session token from the legacy global session lock.
fn http_gateway_bearer_token(state: &AppState) -> Option<String> {
    state
        .session
        .lock()
        .ok()
        .and_then(|g| g.token.clone())
        .filter(|t| !t.trim().is_empty())
}

fn unauthorized_error() -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::Unauthorized, "authentication required", None)
}

fn http_gateway_admin_context(state: &AppState) -> Option<crate::domain::admin::AccessContext> {
    let g = state.session.lock().ok()?;
    let token = g.token.clone().filter(|t| !t.trim().is_empty())?;
    Some(crate::domain::admin::AccessContext {
        actor_id: g.actor_id.clone(),
        token: Some(token),
    })
}

fn http_gateway_applet_context(state: &AppState) -> Option<crate::domain::applets::AccessContext> {
    let g = state.session.lock().ok()?;
    g.token.as_ref().filter(|t| !t.trim().is_empty())?;
    Some(crate::domain::applets::AccessContext {
        actor_id: g.actor_id.clone(),
        token: g.token.clone().unwrap_or_default(),
    })
}

/// Resolve the application data directory for applet-store cache/materialize
/// operations, falling back to the current directory when unconfigured.
fn http_gateway_data_dir(state: &AppState) -> std::path::PathBuf {
    state
        .storage
        .dirs
        .get(&crate::infrastructure::storage::StorageKind::Data)
        .cloned()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

// -------------------------------------------------------------------------
// Station HTTP helpers — delegates to station_client infrastructure
// -------------------------------------------------------------------------

fn station_request_json(
    method: Method,
    path: &str,
    token: &str,
    query: Option<&[(&str, String)]>,
    body: Option<Value>,
) -> Result<Value, Value> {
    station_client::request_json(method, path, token, query, body).map_err(|e| {
        to_json(e.into_app_result::<StubPayload>(format!("station request to {} failed", path)))
    })
}

fn frontend_telemetry_upload_with_token(token: &str, args: Value) -> Value {
    let events = args.get("events").and_then(|value| value.as_array());
    let event_count = match events {
        Some(items) if !items.is_empty() => items.len(),
        _ => {
            return to_json(AppResult::<StubPayload>::fail(
                ErrorCode::InvalidArgument,
                "events must not be empty",
                None,
            ));
        }
    };
    if event_count > MAX_FRONTEND_TELEMETRY_BATCH_EVENTS {
        return to_json(AppResult::<StubPayload>::fail(
            ErrorCode::InvalidArgument,
            "events batch exceeds 500",
            None,
        ));
    }
    match station_request_json(
        Method::POST,
        "/telemetry/frontend/events/batch",
        token,
        None,
        Some(args),
    ) {
        Ok(data) => to_json(to_stub("frontend_telemetry_upload", data)),
        Err(e) => e,
    }
}

fn to_stub(command: &str, data: Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

fn extract_latest_ulid(payload: &Value) -> Option<String> {
    payload
        .get("messages")?
        .as_array()?
        .iter()
        .find_map(|item| {
            item.get("ulid")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        })
}

fn filter_incremental_messages(
    payload: &Value,
    cursor: Option<&str>,
) -> (Value, usize, Option<String>) {
    let mut filtered = payload.clone();
    let mut count = 0usize;
    let mut latest: Option<String> = None;
    if let Some(messages) = payload.get("messages").and_then(|v| v.as_array()) {
        let mut out = Vec::new();
        for item in messages {
            let ulid = item
                .get("ulid")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if ulid.is_empty() {
                continue;
            }
            let keep = match cursor {
                Some(c) if !c.trim().is_empty() => ulid.as_str() > c,
                _ => true,
            };
            if keep {
                count += 1;
                if latest
                    .as_ref()
                    .map(|v| ulid.as_str() > v.as_str())
                    .unwrap_or(true)
                {
                    latest = Some(ulid.clone());
                }
                out.push(item.clone());
            }
        }
        if let Some(obj) = filtered.as_object_mut() {
            obj.insert("messages".to_string(), Value::Array(out));
        }
    }
    (filtered, count, latest)
}

// -------------------------------------------------------------------------
// Command dispatch - maps cmd string to application-layer calls
// -------------------------------------------------------------------------

/// Dispatch a command by name, returning the result as a JSON Value.
///
/// This function mirrors the full invoke_handler list from main.rs,
/// calling the same application-layer functions that tauri_commands use.
fn dispatch(cmd: &str, args: Value, state: &AppState, runtime: &GatewayRuntime) -> Value {
    match cmd {
        // =================================================================
        // Meta
        // =================================================================
        "meta_contract_version" => to_json(AppResult::success(StubPayload {
            command: "meta_contract_version".to_string(),
            status: json!({"version": CONTRACT_VERSION}).to_string(),
        })),

        "crypto_ratchet_telemetry_snapshot" => {
            let snap = crate::domain::crypto::telemetry::snapshot();
            to_json(to_stub(
                "crypto_ratchet_telemetry_snapshot",
                json!({
                    "dr_decrypts": snap.dr_decrypts,
                    "since_unix_ms": snap.since_unix_ms,
                }),
            ))
        }
        "crypto_generate_identity" => {
            let actor_id = match actor_id_from_state(state) {
                Some(id) if !id.trim().is_empty() => id,
                _ => {
                    return to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::Unauthorized,
                        "Authentication required — please log in",
                        None,
                    ));
                }
            };
            let identity_key_ref =
                crate::infrastructure::local_scope::LocalScope::from_actor(actor_id.as_str())
                    .identity_key_ref();
            let kp = match crypto::get_or_create_identity(identity_key_ref.as_str()) {
                Ok(k) => k,
                Err(reason) => {
                    return to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::InternalError,
                        format!("Identity operation failed: {}", reason),
                        None,
                    ));
                }
            };
            to_json(to_stub(
                "crypto_generate_identity",
                json!({
                    "fingerprint": crypto::identity_fingerprint_hex(&kp.verifying_key),
                    "public_key": hex::encode(kp.verifying_key.to_bytes()),
                }),
            ))
        }
        "crypto_generate_key_bundle" => {
            let actor_id = match actor_id_from_state(state) {
                Some(id) if !id.trim().is_empty() => id,
                _ => {
                    return to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::Unauthorized,
                        "Authentication required — please log in",
                        None,
                    ));
                }
            };
            let user_scope = user_scope_from_state(state);
            let identity_key_ref =
                crate::infrastructure::local_scope::LocalScope::from_actor(actor_id.as_str())
                    .identity_key_ref();
            let ik = match crypto::get_or_create_identity(identity_key_ref.as_str()) {
                Ok(k) => k,
                Err(reason) => {
                    return to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::InternalError,
                        format!("Identity operation failed: {}", reason),
                        None,
                    ));
                }
            };

            let spk_sk = StaticSecret::random_from_rng(OsRng);
            let spk_pub = PublicKey::from(&spk_sk);
            let spk_pub_bytes = spk_pub.to_bytes();
            let spk_sig = ik.signing_key.sign(spk_pub_bytes.as_slice());
            let spk_id = now_unix_seconds_i32();

            if let Err(reason) = local_chat_store::crypto_store_signed_prekey(
                user_scope.as_str(),
                i64::from(spk_id),
                spk_sk.to_bytes().as_slice(),
            ) {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InternalError,
                    format!("Failed to store signed pre-key: {}", reason),
                    None,
                ));
            }

            let mut opk_privs: Vec<Vec<u8>> = Vec::new();
            let mut opk_pubs: Vec<[u8; 32]> = Vec::new();
            for _ in 0..20 {
                let opk_sk = StaticSecret::random_from_rng(OsRng);
                let pk = PublicKey::from(&opk_sk);
                opk_pubs.push(pk.to_bytes());
                opk_privs.push(opk_sk.to_bytes().to_vec());
            }
            let opk_ids =
                match local_chat_store::crypto_insert_opks(user_scope.as_str(), &opk_privs) {
                    Ok(ids) => ids,
                    Err(reason) => {
                        return to_json(AppResult::<StubPayload>::fail(
                            ErrorCode::InternalError,
                            format!("Failed to store one-time pre-keys: {}", reason),
                            None,
                        ));
                    }
                };

            to_json(to_stub(
                "crypto_generate_key_bundle",
                json!({
                    "identityPublicKey": B64.encode(ik.verifying_key.to_bytes()),
                    "signedPreKey": {
                        "keyId": spk_id.to_string(),
                        "publicKey": B64.encode(spk_pub_bytes),
                        "signature": B64.encode(spk_sig.to_bytes()),
                        "createdAtUnixMs": i64::from(spk_id) * 1000,
                    },
                    "oneTimePreKeys": opk_ids.iter().zip(opk_pubs.iter()).map(|(id, key)| json!({
                        "keyId": id.to_string(),
                        "publicKey": B64.encode(key),
                    })).collect::<Vec<Value>>(),
                    "supportedVersions": [1],
                }),
            ))
        }
        "crypto_init_session" => {
            let (actor_id, user_scope) = match authenticated_crypto_context(state) {
                Ok(context) => context,
                Err(error) => return error,
            };
            let supported_versions = args
                .get("supported_versions")
                .or_else(|| args.get("supportedVersions"))
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_u64)
                        .filter_map(|value| u32::try_from(value).ok())
                        .collect()
                })
                .unwrap_or_default();
            to_json(
                crate::interface::tauri_commands::crypto::crypto_init_session_for_context(
                    string_arg(&args, "session_id", "sessionId"),
                    string_arg(&args, "conversation_id", "conversationId"),
                    args.get("session_generation")
                        .or_else(|| args.get("sessionGeneration"))
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                    string_arg(&args, "peer_ptid", "peerPtid"),
                    string_arg(&args, "peer_device_id", "peerDeviceId"),
                    string_arg(&args, "peer_identity_public_key", "peerIdentityPublicKey"),
                    string_arg(&args, "peer_signed_pre_key_id", "peerSignedPreKeyId"),
                    string_arg(&args, "peer_signed_pre_key", "peerSignedPreKey"),
                    string_arg(&args, "peer_signed_pre_key_sig", "peerSignedPreKeySig"),
                    optional_string_arg(&args, "peer_one_time_pre_key_id", "peerOneTimePreKeyId"),
                    optional_string_arg(&args, "peer_one_time_pre_key", "peerOneTimePreKey"),
                    supported_versions,
                    actor_id,
                    user_scope,
                ),
            )
        }
        "crypto_accept_session" => {
            let (actor_id, user_scope) = match authenticated_crypto_context(state) {
                Ok(context) => context,
                Err(error) => return error,
            };
            to_json(
                crate::interface::tauri_commands::crypto::crypto_accept_session_for_context(
                    string_arg(&args, "session_id", "sessionId"),
                    string_arg(&args, "conversation_id", "conversationId"),
                    args.get("session_generation")
                        .or_else(|| args.get("sessionGeneration"))
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                    string_arg(&args, "peer_ptid", "peerPtid"),
                    string_arg(&args, "peer_device_id", "peerDeviceId"),
                    string_arg(&args, "sender_identity_key", "senderIdentityKey"),
                    string_arg(&args, "sender_ephemeral_key", "senderEphemeralKey"),
                    string_arg(
                        &args,
                        "recipient_signed_pre_key_id",
                        "recipientSignedPreKeyId",
                    ),
                    optional_string_arg(
                        &args,
                        "recipient_one_time_pre_key_id",
                        "recipientOneTimePreKeyId",
                    ),
                    u32_arg(&args, "negotiated_version", "negotiatedVersion"),
                    actor_id,
                    user_scope,
                ),
            )
        }
        "crypto_session_status" => {
            let (_, user_scope) = match authenticated_crypto_context(state) {
                Ok(context) => context,
                Err(error) => return error,
            };
            to_json(
                crate::interface::tauri_commands::crypto::crypto_session_status_for_scope(
                    string_arg(&args, "session_id", "sessionId"),
                    user_scope,
                ),
            )
        }
        "crypto_list_sessions" => to_json(AppResult::<StubPayload>::fail(
            ErrorCode::InvalidArgument,
            "crypto_list_sessions is available through the native Tauri boundary",
            None,
        )),
        "crypto_list_sessions_for_peer" => to_json(AppResult::<StubPayload>::fail(
            ErrorCode::InvalidArgument,
            format!(
                "crypto_list_sessions_for_peer requires native endpoint context for {}",
                string_arg(&args, "peer_ptid", "peerPtid")
            ),
            None,
        )),
        "crypto_encrypt" => {
            let (_, user_scope) = match authenticated_crypto_context(state) {
                Ok(context) => context,
                Err(error) => return error,
            };
            let session_ids = args
                .get("session_ids")
                .or_else(|| args.get("sessionIds"))
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            to_json(
                crate::interface::tauri_commands::crypto::crypto_encrypt_for_scope(
                    session_ids,
                    string_arg(&args, "plaintext", "plaintext"),
                    string_arg(&args, "command_id", "commandId"),
                    args.get("content_type")
                        .or_else(|| args.get("contentType"))
                        .and_then(Value::as_i64)
                        .and_then(|value| i32::try_from(value).ok())
                        .unwrap_or(0),
                    optional_string_arg(&args, "reply_to_message_id", "replyToMessageId"),
                    optional_string_arg(&args, "thread_root_message_id", "threadRootMessageId"),
                    user_scope,
                ),
            )
        }
        "crypto_mark_session_ready" => {
            let (_, user_scope) = match authenticated_crypto_context(state) {
                Ok(context) => context,
                Err(error) => return error,
            };
            to_json(
                crate::interface::tauri_commands::crypto::crypto_mark_session_ready_for_scope(
                    string_arg(&args, "session_id", "sessionId"),
                    user_scope,
                ),
            )
        }
        "dr_encrypt" => {
            let (_, user_scope) = match authenticated_crypto_context(state) {
                Ok(context) => context,
                Err(error) => return error,
            };
            to_json(
                crate::interface::tauri_commands::crypto::dr_encrypt_for_scope(
                    string_arg(&args, "session_id", "sessionId"),
                    string_arg(&args, "plaintext", "plaintext"),
                    user_scope,
                ),
            )
        }
        "dr_decrypt" => {
            let (_, user_scope) = match authenticated_crypto_context(state) {
                Ok(context) => context,
                Err(error) => return error,
            };
            to_json(
                crate::interface::tauri_commands::crypto::dr_decrypt_for_scope(
                    string_arg(&args, "session_id", "sessionId"),
                    string_arg(&args, "ciphertext", "ciphertext"),
                    string_arg(&args, "ratchet_pub", "ratchetPub"),
                    u32_arg(&args, "counter", "counter"),
                    u32_arg(&args, "prev_counter", "prevCounter"),
                    string_arg(&args, "nonce", "nonce"),
                    u32_arg(&args, "version", "version"),
                    user_scope,
                ),
            )
        }
        "key_exchange_upload_bundle" => {
            let input = match parse_args::<KeyExchangeUploadInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let actor_id = match actor_id_from_state(state) {
                Some(id) if !id.trim().is_empty() => id,
                Some(_) | None => {
                    return to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::Unauthorized,
                        "authentication required",
                        None,
                    ));
                }
            };
            let device_id = match device_install::get_or_create_device_id(actor_id.as_str()) {
                Ok(id) => id,
                Err(e) => {
                    return to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::InternalError,
                        format!("device_id: {e}"),
                        None,
                    ));
                }
            };
            let req = model::key_exchange::UploadKeyBundleRequest {
                ik_pub: input.ik_pub,
                spk_id: input.spk_id,
                spk_pub: input.spk_pub,
                spk_sig: input.spk_sig,
                opk_ids: input.opk_ids,
                opk_pubs: input.opk_pubs,
                device_id,
                supported_versions: vec![1],
            };
            match station_client::request_proto::<
                model::key_exchange::UploadKeyBundleRequest,
                model::key_exchange::UploadKeyBundleResponse,
            >(
                Method::POST,
                "/key-exchange/keys/bundle",
                &token,
                None,
                Some(&req),
            ) {
                Ok(_r) => to_json(to_stub("key_exchange_upload_bundle", json!({}))),
                Err(e) => to_json(e.into_app_result::<StubPayload>("Station request failed")),
            }
        }
        "key_exchange_fetch_bundle" => {
            let input = match parse_args::<KeyExchangeFetchInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            if input.did.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "did is required",
                    None,
                ));
            }
            let req = model::key_exchange::FetchKeyBundleRequest {
                did: input.did,
                device_id: input.device_id.unwrap_or_default(),
                home_station_peer_id: input.home_station_peer_id.unwrap_or_default(),
            };
            match station_client::request_proto::<
                model::key_exchange::FetchKeyBundleRequest,
                model::key_exchange::FetchKeyBundleResponse,
            >(
                Method::POST,
                "/key-exchange/keys/bundle/fetch",
                &token,
                None,
                Some(&req),
            ) {
                Ok(r) => {
                    let bundles_json: Vec<Value> = r
                        .bundles
                        .iter()
                        .map(|b| {
                            json!({
                                "did": b.did,
                                "device_id": b.device_id,
                                "ik_pub": b.ik_pub,
                                "fingerprint": wire::identity_fingerprint_hex(&b.ik_pub),
                                "spk_pub": b.spk_pub,
                                "spk_sig": b.spk_sig,
                                "opks": b.opks,
                                "published_at_unix_ms": b.published_at_unix_ms,
                                "supported_versions": b.supported_versions,
                            })
                        })
                        .collect();
                    to_json(to_stub(
                        "key_exchange_fetch_bundle",
                        json!({ "bundles": bundles_json }),
                    ))
                }
                Err(e) => to_json(e.into_app_result::<StubPayload>("Station request failed")),
            }
        }
        "signaling_envelope_seal" => {
            let input = match parse_args::<SignalingEnvelopeSealInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.session_ulid.trim().is_empty() || input.kind.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "session_ulid and kind are required",
                    None,
                ));
            }
            let (self_priv, self_pub) = match local_identity_x25519_from_state(state) {
                Ok(v) => v,
                Err(e) => return to_json(e),
            };
            let peer_pub = match peer_x25519_pub_from_ed25519("peer_ik_pub", &input.peer_ik_pub) {
                Ok(v) => v,
                Err(e) => return to_json(e),
            };
            let sealed = match crypto::signaling_envelope::seal(
                &self_priv,
                &self_pub,
                &peer_pub,
                input.session_ulid.as_str(),
                input.kind.as_str(),
                input.plaintext.as_bytes(),
            ) {
                Ok(b) => b,
                Err(reason) => {
                    return to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::InternalError,
                        format!("Signaling envelope seal failed: {}", reason),
                        None,
                    ));
                }
            };
            to_json(to_stub(
                "signaling_envelope_seal",
                json!({ "payload_b64": B64.encode(&sealed) }),
            ))
        }
        "signaling_envelope_open" => {
            let input = match parse_args::<SignalingEnvelopeOpenInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.session_ulid.trim().is_empty() || input.kind.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "session_ulid and kind are required",
                    None,
                ));
            }
            let (self_priv, _self_pub) = match local_identity_x25519_from_state(state) {
                Ok(v) => v,
                Err(e) => return to_json(e),
            };
            let sender_pub =
                match peer_x25519_pub_from_ed25519("sender_ik_pub", &input.sender_ik_pub) {
                    Ok(v) => v,
                    Err(e) => return to_json(e),
                };
            let sealed = match B64.decode(input.payload_b64.trim()) {
                Ok(b) => b,
                Err(e) => {
                    return to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::InvalidArgument,
                        format!("Invalid base64 for payload_b64: {}", e),
                        None,
                    ));
                }
            };
            let plaintext = match crypto::signaling_envelope::open(
                &self_priv,
                &sender_pub,
                input.session_ulid.as_str(),
                input.kind.as_str(),
                &sealed,
            ) {
                Ok(b) => b,
                Err(reason) => {
                    tracing::warn!(reason = %reason, "signaling_envelope_open: AEAD failed");
                    return to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::InternalError,
                        "Signaling envelope failed to authenticate",
                        None,
                    ));
                }
            };
            let text = match String::from_utf8(plaintext) {
                Ok(s) => s,
                Err(e) => {
                    return to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::InternalError,
                        format!("Decrypted signaling plaintext is not valid UTF-8: {}", e),
                        None,
                    ));
                }
            };
            to_json(to_stub(
                "signaling_envelope_open",
                json!({ "plaintext": text }),
            ))
        }
        // =================================================================
        // Frontend log (fire-and-forget, always succeeds)
        // =================================================================
        "frontend_log" => {
            if let Ok(input) = parse_args::<FrontendLogInput>(args) {
                let data_str = input.data.as_deref().unwrap_or("");
                match input.level.as_str() {
                    "error" => {
                        tracing::error!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message)
                    }
                    "warn" => {
                        tracing::warn!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message)
                    }
                    "debug" => {
                        tracing::debug!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message)
                    }
                    _ => {
                        tracing::info!(tag = %input.tag, data = %data_str, "[frontend] {}", input.message)
                    }
                }
            }
            json!(null)
        }

        // =================================================================
        // I18n (returns AppResult<I18nResources>, not StubPayload)
        // =================================================================
        "i18n_load_resources" => match state.i18n.load_resources() {
            Ok(resources) => to_json(AppResult::success(resources)),
            Err(e) => {
                tracing::error!(error = %e, "Failed to load i18n resources");
                to_json(
                    AppResult::<crate::infrastructure::i18n::I18nResources>::fail(
                        ErrorCode::InternalError,
                        format!("Failed to load i18n resources: {}", e),
                        None,
                    ),
                )
            }
        },

        // =================================================================
        // Moments / Human social (proto-based)
        // =================================================================
        "social_create_moment" => {
            let input = match parse_args::<SocialCreateMomentInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.payload.is_empty() {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument,
                    "payload (CreatePostRequest bytes) is required",
                    None,
                ));
            }
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let req = match model::social::CreatePostRequest::decode(input.payload.as_slice()) {
                Ok(r) => r,
                Err(e) => {
                    return to_json(AppResult::<Vec<u8>>::fail(
                        ErrorCode::InvalidArgument,
                        format!("decode CreatePostRequest: {}", e),
                        None,
                    ));
                }
            };
            let resp = match station_client::request_proto::<
                model::social::CreatePostRequest,
                model::social::CreatePostResponse,
            >(
                Method::POST,
                "/api/v1/social/moments",
                &token,
                None,
                Some(&req),
            ) {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("create moment failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_get_moment" => {
            let input = match parse_args::<SocialGetMomentInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.id.trim().is_empty() {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument,
                    "id is required",
                    None,
                ));
            }
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let path = format!("/api/v1/social/moments/{}", input.id);
            let resp = match station_client::request_proto::<(), model::social::GetPostResponse>(
                Method::GET,
                &path,
                &token,
                None,
                None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("get moment failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_delete_moment" => {
            let input = match parse_args::<SocialDeleteMomentInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.id.trim().is_empty() {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument,
                    "id is required",
                    None,
                ));
            }
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let path = format!("/api/v1/social/moments/{}", input.id);
            let resp = match station_client::request_proto::<(), model::social::DeletePostResponse>(
                Method::DELETE,
                &path,
                &token,
                None,
                None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("delete moment failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_get_timeline" => {
            let input = match parse_args::<SocialGetTimelineInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let mut query: Vec<(&str, String)> = vec![("type", input.r#type)];
            if let Some(cursor) = input.cursor.filter(|v| !v.is_empty()) {
                query.push(("cursor", cursor));
            }
            if let Some(limit) = input.limit {
                query.push(("limit", limit.to_string()));
            }
            if let Some(sort) = input.sort.filter(|v| !v.is_empty()) {
                query.push(("sort", sort));
            }
            let resp = match station_client::request_proto::<(), model::social::GetTimelineResponse>(
                Method::GET,
                "/api/v1/social/timeline",
                &token,
                Some(&query),
                None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("get timeline failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_sync_moments_projection" => {
            let input = match parse_args::<SocialSyncMomentsProjectionInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let req = model::social::SyncMomentsProjectionRequest {
                home_cursor: input.home_cursor.unwrap_or_default(),
                public_cursor: input.public_cursor.unwrap_or_default(),
                limit: input.limit.unwrap_or(20),
                public_sort: input.public_sort.unwrap_or(0),
                reason: input.reason.unwrap_or_default(),
            };
            let resp = match station_client::request_proto::<
                model::social::SyncMomentsProjectionRequest,
                model::social::SyncMomentsProjectionResponse,
            >(
                Method::POST,
                "/api/v1/social/moments/sync",
                &token,
                None,
                Some(&req),
            ) {
                Ok(r) => r,
                Err(e) => {
                    return to_json(e.into_app_result::<Vec<u8>>("sync moments projection failed"));
                }
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_list_by_author" => {
            let input = match parse_args::<SocialListByAuthorInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.user_id.trim().is_empty() {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument,
                    "user_id is required",
                    None,
                ));
            }
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let mut query: Vec<(&str, String)> = Vec::new();
            if let Some(cursor) = input.cursor.filter(|v| !v.is_empty()) {
                query.push(("cursor", cursor));
            }
            if let Some(limit) = input.limit {
                query.push(("limit", limit.to_string()));
            }
            let path = format!("/api/v1/social/users/{}/posts", input.user_id);
            let resp = match station_client::request_proto::<(), model::social::ListPostsResponse>(
                Method::GET,
                &path,
                &token,
                Some(&query),
                None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("list by author failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_circle_list_mine" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let resp = match station_client::request_proto::<(), model::social::ListMyCirclesResponse>(
                Method::GET,
                "/api/v1/social/circles",
                &token,
                None,
                None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("list circles failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_get_my_stats" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let resp = match station_client::request_proto::<
                (),
                model::social::GetMyMomentsStatsResponse,
            >(
                Method::GET,
                "/api/v1/social/me/stats",
                &token,
                None,
                None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("get my stats failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_react" => {
            let input = match parse_args::<SocialReactInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.post_id.trim().is_empty() {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument,
                    "post_id is required",
                    None,
                ));
            }
            if input.kind == 0 {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument,
                    "reaction kind is required (REACTION_UNSPECIFIED rejected)",
                    None,
                ));
            }
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let req = model::social::ReactToPostRequest {
                post_id: input.post_id.clone(),
                kind: input.kind,
            };
            let path = format!("/api/v1/social/posts/{}/react", input.post_id);
            let resp = match station_client::request_proto::<
                model::social::ReactToPostRequest,
                model::social::ReactToPostResponse,
            >(Method::POST, &path, &token, None, Some(&req))
            {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("react failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_unreact" => {
            let input = match parse_args::<SocialUnreactInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.post_id.trim().is_empty() {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument,
                    "post_id is required",
                    None,
                ));
            }
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let req = model::social::UnreactToPostRequest {
                post_id: input.post_id.clone(),
                kind: input.kind,
            };
            let path = format!("/api/v1/social/posts/{}/unreact", input.post_id);
            let resp = match station_client::request_proto::<
                model::social::UnreactToPostRequest,
                model::social::UnreactToPostResponse,
            >(Method::POST, &path, &token, None, Some(&req))
            {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("unreact failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_get_comments" => {
            let input = match parse_args::<SocialGetCommentsInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.post_id.trim().is_empty() {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument,
                    "post_id is required",
                    None,
                ));
            }
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let mut query: Vec<(&str, String)> = Vec::new();
            if let Some(cursor) = input.cursor.filter(|v| !v.is_empty()) {
                query.push(("cursor", cursor));
            }
            if let Some(limit) = input.limit {
                query.push(("limit", limit.to_string()));
            }
            let path = format!("/api/v1/social/moments/{}/comments", input.post_id);
            let resp = match station_client::request_proto::<(), model::social::GetCommentsResponse>(
                Method::GET,
                &path,
                &token,
                Some(&query),
                None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("get comments failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_create_comment" => {
            let input = match parse_args::<SocialCreateCommentInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.post_id.trim().is_empty() {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument,
                    "post_id is required",
                    None,
                ));
            }
            if input.content.trim().is_empty() {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument,
                    "content is required",
                    None,
                ));
            }
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let req = model::social::CreateCommentRequest {
                post_id: input.post_id.clone(),
                content: input.content,
                reply_to_comment_id: input.reply_to_comment_id.unwrap_or_default(),
            };
            let path = format!("/api/v1/social/moments/{}/comments", input.post_id);
            let resp = match station_client::request_proto::<
                model::social::CreateCommentRequest,
                model::social::CreateCommentResponse,
            >(Method::POST, &path, &token, None, Some(&req))
            {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("create comment failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_delete_comment" => {
            let input = match parse_args::<SocialDeleteCommentInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.comment_id.trim().is_empty() {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument,
                    "comment_id is required",
                    None,
                ));
            }
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let path = format!("/api/v1/social/comments/{}", input.comment_id);
            let resp = match station_client::request_proto::<(), model::social::DeleteCommentResponse>(
                Method::DELETE,
                &path,
                &token,
                None,
                None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => {
                    return to_json(e.into_app_result::<Vec<u8>>("delete comment failed"));
                }
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_station_moderation_upsert" => {
            let input = match parse_args::<SocialStationModerationUpsertInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.station_domain.trim().is_empty()
                && input
                    .station_peer_id
                    .as_deref()
                    .unwrap_or_default()
                    .trim()
                    .is_empty()
            {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument,
                    "station_domain or station_peer_id is required",
                    None,
                ));
            }
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let req = model::social::UpsertStationModerationPolicyRequest {
                policy: Some(model::social::StationModerationPolicy {
                    station_domain: input.station_domain,
                    station_peer_id: input.station_peer_id.unwrap_or_default(),
                    kind: input.kind.unwrap_or(1),
                    reason: input.reason.unwrap_or_default(),
                    ..Default::default()
                }),
            };
            let resp = match station_client::request_proto::<
                model::social::UpsertStationModerationPolicyRequest,
                model::social::UpsertStationModerationPolicyResponse,
            >(
                Method::POST,
                "/api/v1/social/moderation/stations",
                &token,
                None,
                Some(&req),
            ) {
                Ok(r) => r,
                Err(e) => {
                    return to_json(
                        e.into_app_result::<Vec<u8>>("upsert station moderation failed"),
                    );
                }
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_station_moderation_list" => {
            let input = match parse_args::<SocialStationModerationListInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let mut query: Vec<(&str, String)> = Vec::new();
            if let Some(kind) = input.kind {
                query.push(("kind", kind.to_string()));
            }
            if let Some(cursor) = input.cursor.filter(|v| !v.is_empty()) {
                query.push(("cursor", cursor));
            }
            if let Some(limit) = input.limit {
                query.push(("limit", limit.to_string()));
            }
            let resp = match station_client::request_proto::<
                (),
                model::social::ListStationModerationPoliciesResponse,
            >(
                Method::GET,
                "/api/v1/social/moderation/stations",
                &token,
                Some(&query),
                None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => {
                    return to_json(
                        e.into_app_result::<Vec<u8>>("list station moderation policies failed"),
                    );
                }
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_station_moderation_delete" => {
            let input = match parse_args::<SocialStationModerationDeleteInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let station_domain = input.station_domain.unwrap_or_default();
            let station_peer_id = input.station_peer_id.unwrap_or_default();
            if station_domain.trim().is_empty() && station_peer_id.trim().is_empty() {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument,
                    "station_domain or station_peer_id is required",
                    None,
                ));
            }
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let query = vec![
                ("station_domain", station_domain),
                ("station_peer_id", station_peer_id),
                ("kind", input.kind.unwrap_or(1).to_string()),
            ];
            let resp = match station_client::request_proto::<
                (),
                model::social::DeleteStationModerationPolicyResponse,
            >(
                Method::DELETE,
                "/api/v1/social/moderation/stations",
                &token,
                Some(&query),
                None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => {
                    return to_json(
                        e.into_app_result::<Vec<u8>>("delete station moderation failed"),
                    );
                }
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }

        // =================================================================
        // OSS (state-dependent)
        // =================================================================
        "oss_upload_agent_attachment_bytes" => {
            dispatch_oss_upload_agent_attachment_bytes(args, state)
        }

        // =================================================================
        // Actor (state-dependent, proto-based)
        // =================================================================
        "actor_search_actors" => {
            let input = match parse_args::<ActorSearchUsersInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let resp = match station_client::request_proto::<(), model::actor::ActorList>(
                Method::GET,
                "/api/v1/social/users/search",
                &token,
                Some(&[("q", input.q.clone())]),
                None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => {
                    return to_json(e.into_app_result::<StubPayload>("Station request failed"));
                }
            };
            let items: Vec<Value> = resp
                .items
                .iter()
                .map(|a| {
                    json!({
                        "id": a.id, "username": a.username, "displayName": a.display_name,
                        "email": a.email, "actorId": a.actor_id.to_string(), "avatar": a.avatar,
                    })
                })
                .collect();
            to_json(to_stub(
                "actor_search_actors",
                json!({"items": items, "total": resp.total}),
            ))
        }

        "actor_get_my_profile" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let resp = match station_client::request_proto::<(), model::actor::ActorProfile>(
                Method::GET,
                "/api/v1/social/users/me",
                &token,
                None,
                None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => {
                    return to_json(e.into_app_result::<StubPayload>("Station request failed"));
                }
            };
            to_json(to_stub(
                "actor_get_my_profile",
                json!({
                    "id": resp.id, "displayName": resp.display_name,
                    "username": resp.username, "avatar": resp.avatar,
                }),
            ))
        }

        // =================================================================
        // Auth (state-dependent)
        // =================================================================
        "auth_login" => {
            let input = match parse_args::<AuthLoginInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_auth::auth_login(input, state))
        }
        // Interactive access-gate login chain (Email Login path). These mirror
        // the one-shot `auth_login` but drive the Station's pre-login gate
        // chain (invite-code, etc.) before landing a session.
        "access_start" => to_json(app_auth::access_start()),
        "access_submit_invite_code" => {
            let input = match parse_args::<AccessSubmitInviteInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_auth::access_submit_invite_code(input))
        }
        "access_submit_login" => {
            let input = match parse_args::<AccessSubmitLoginInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_auth::access_submit_login(input, state))
        }
        "auth_logout" => to_json(app_auth::auth_logout(state)),
        "auth_restore_session" => to_json(app_auth::auth_restore_session(state)),
        "auth_validate_token" => {
            let input = match parse_args::<AuthValidateTokenInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_auth::auth_validate_token(input, state))
        }
        "acceptance_current_session" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let actor_id = match actor_id_from_state(state) {
                Some(id) if !id.trim().is_empty() => id,
                Some(_) | None => {
                    return to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::Unauthorized,
                        "authentication required",
                        None,
                    ));
                }
            };
            to_json(to_stub(
                "acceptance_current_session",
                json!({
                    "actor_id": actor_id,
                    "token": token,
                }),
            ))
        }
        "ensure_station_session" => to_json(app_auth::ensure_station_session(state)),

        // =================================================================
        // Settings (state-dependent)
        // =================================================================
        "settings_get" => {
            let input = match parse_args::<SettingsGetInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_settings::settings_get(state, input))
        }
        "settings_set" => {
            let input = match parse_args::<SettingsSetInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_settings::settings_set(state, input))
        }
        "settings_reset" => to_json(app_settings::settings_reset(state)),

        // =================================================================
        // Chat (no state)
        // =================================================================
        "chat_list_conversations" => to_json(app_chat::chat_list_conversations("")),
        "chat_list_messages" => {
            let input = match parse_args::<ChatListMessagesInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_chat::chat_list_messages("", input))
        }
        "chat_send_message" => {
            let input = match parse_args::<ChatSendMessageInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_chat::chat_send_message("", input))
        }
        "chat_mark_read" => {
            let input = match parse_args::<ChatMarkReadInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_chat::chat_mark_read("", input))
        }
        "chat_delete_conversation" => {
            let input = match parse_args::<ChatConversationInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_chat::chat_delete_conversation("", input))
        }
        "chat_rename_conversation" => {
            let input = match parse_args::<ChatRenameConversationInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_chat::chat_rename_conversation("", input))
        }
        "chat_duplicate_conversation" => {
            let input = match parse_args::<ChatConversationInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_chat::chat_duplicate_conversation("", input))
        }
        "chat_smart_rename_conversation" => {
            let input = match parse_args::<ChatConversationInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_chat::chat_smart_rename_conversation("", input))
        }
        "chat_set_conversation_model" => {
            let input = match parse_args::<ChatSetConversationModelInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_chat::chat_set_conversation_model("", input))
        }
        "chat_delete_message" => {
            let input = match parse_args::<ChatMessageInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_chat::chat_delete_message("", input))
        }
        "chat_update_message" => {
            let input = match parse_args::<ChatUpdateMessageInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_chat::chat_update_message("", input))
        }
        "chat_stop" => {
            let input = match parse_args::<ChatConversationInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_chat::chat_stop("", input))
        }
        // chat_completion_once: blocking call (originally async in tauri, runs sync here)
        "chat_completion_once" => {
            let input = match parse_args::<ChatCompletionInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_chat::chat_completion_once("", "", input))
        }

        // Note: legacy `timeline_*` dev-HTTP routes were removed in P2. The
        // new `social_*` Tauri commands target proto-typed responses and
        // are not exposed via the dev HTTP gateway (which only speaks
        // JSON / StubPayload). If you need to exercise them from a
        // browser harness, use the Tauri devtools `invoke()` panel
        // instead.

        // =================================================================
        // Profile (session token via global lock — dev HTTP gateway)
        // =================================================================
        "profile_get" => match http_gateway_bearer_token(state) {
            Some(t) => to_json(app_profile::profile_get(&t)),
            None => to_json(AppResult::<StubPayload>::fail(
                ErrorCode::Unauthorized,
                "authentication required",
                None,
            )),
        },
        "peer_profile_get" => {
            let input = match parse_args::<PeerProfileGetInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(t) => to_json(app_profile::peer_profile_get(&t, &input.did)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "profile_update" => {
            let input = match parse_args::<ProfileUpdateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(t) => to_json(app_profile::profile_update(input, &t)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "profile_upload_avatar" => {
            let input = match parse_args::<FileUploadInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(t) => to_json(app_profile::profile_upload_avatar("", input, &t)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "profile_upload_header" => {
            let input = match parse_args::<FileUploadInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(t) => to_json(app_profile::profile_upload_header("", input, &t)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "profile_update_privacy" => {
            let input = match parse_args::<ProfilePrivacyInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(t) => to_json(app_profile::profile_update_privacy("", &t, input)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "profile_upload_avatar_oss" => {
            let input = match parse_args::<FileUploadInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(t) => to_json(app_profile::profile_upload_avatar_oss(input, &t)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "profile_upload_header_oss" => {
            let input = match parse_args::<FileUploadInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(t) => to_json(app_profile::profile_upload_header_oss(input, &t)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "pick_image_file" => {
            let dialog = rfd::FileDialog::new()
                .set_title("Select Image")
                .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp"]);
            match dialog.pick_file() {
                Some(path) => to_json(AppResult::success(StubPayload {
                    command: "pick_image_file".to_string(),
                    status: path.to_string_lossy().to_string(),
                })),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "no file selected",
                    None,
                )),
            }
        }
        "account_sync_avatar" => {
            let input = match parse_args::<crate::contracts::AccountSyncAvatarInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.avatar_url.is_empty() {
                to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "avatar_url is required",
                    None,
                ))
            } else {
                match http_gateway_bearer_token(state) {
                    Some(t) => to_json(app_profile::account_sync_avatar(&input, &t)),
                    None => to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::Unauthorized,
                        "authentication required",
                        None,
                    )),
                }
            }
        }
        "sync_user_profile" => {
            let session = state
                .session
                .lock()
                .ok()
                .and_then(|guard| {
                    let token = guard.token.clone().filter(|value| !value.trim().is_empty())?;
                    let actor_id = guard
                        .actor_id
                        .clone()
                        .filter(|value| !value.trim().is_empty())?;
                    let account_id = guard.account_id.clone().or_else(|| {
                        crate::infrastructure::auth_identity::find_account_id_by_actor_id(
                            &actor_id,
                        )
                    })?;
                    Some((token, account_id))
                });
            match session {
                Some((token, account_id)) => {
                    let actor_ptid = app_auth::canonical_ptid_for_token(&token);
                    match actor_ptid {
                        Some(ptid) => to_json(app_profile::sync_user_profile(
                            &token,
                            &account_id,
                            &ptid,
                        )),
                        None => to_json(AppResult::<StubPayload>::fail(
                            ErrorCode::Unauthorized,
                            "canonical actor identity unavailable",
                            None,
                        )),
                    }
                }
                _ => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }

        // =================================================================
        // Admin (state-dependent)
        // =================================================================
        "admin_health" => match http_gateway_admin_context(state) {
            Some(ctx) => to_json(app_admin::admin_health(ctx)),
            None => to_json(AppResult::<StubPayload>::fail(
                ErrorCode::Unauthorized,
                "authentication required",
                None,
            )),
        },
        "admin_network_probe" => {
            let input = match parse_args::<AdminNetworkProbeInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_admin_context(state) {
                Some(ctx) => to_json(app_admin::admin_network_probe(ctx, input)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "admin_execute_action" => {
            let input = match parse_args::<AdminExecuteActionInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_admin_context(state) {
                Some(ctx) => to_json(app_admin::admin_execute_action(ctx, input)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }

        // =================================================================
        // Provider (state-dependent via scope)
        // =================================================================
        "provider_list" => {
            let scope = match resolve_scope(state) {
                Ok(s) => s,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_provider::provider_list(
                scope.as_deref().unwrap_or(""),
                &token,
            ))
        }
        "provider_get" => {
            let input = match parse_args::<ProviderIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let scope = match resolve_scope(state) {
                Ok(s) => s,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_provider::provider_get(
                scope.as_deref().unwrap_or(""),
                &token,
                input,
            ))
        }
        "provider_update" => {
            let input = match parse_args::<ProviderUpdateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let scope = match resolve_scope(state) {
                Ok(s) => s,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_provider::provider_update(
                scope.as_deref().unwrap_or(""),
                &token,
                input,
            ))
        }
        "provider_check" => {
            let input = match parse_args::<ProviderCheckInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let scope = match resolve_scope(state) {
                Ok(s) => s,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_provider::provider_check(
                scope.as_deref().unwrap_or(""),
                &token,
                input,
            ))
        }
        "provider_create" => {
            let input = match parse_args::<ProviderCreateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let scope = match resolve_scope(state) {
                Ok(s) => s,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_provider::provider_create(
                scope.as_deref().unwrap_or(""),
                &token,
                input,
            ))
        }
        "provider_delete" => {
            let input = match parse_args::<ProviderIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let scope = match resolve_scope(state) {
                Ok(s) => s,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_provider::provider_delete(
                scope.as_deref().unwrap_or(""),
                &token,
                input,
            ))
        }
        "provider_apply_preset" => {
            let input = match parse_args::<ProviderIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let _scope = match resolve_scope(state) {
                Ok(s) => s,
                Err(e) => return e,
            };
            to_json(AppResult::<StubPayload>::fail(
                ErrorCode::NotFound,
                "provider_apply_preset: not yet migrated",
                None,
            ))
        }
        "provider_list_available_models" => {
            let scope = match resolve_scope(state) {
                Ok(s) => s,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_provider::provider_list_available_models(
                scope.as_deref().unwrap_or(""),
                &token,
            ))
        }

        // =================================================================
        // Models (state-dependent via scope)
        // =================================================================
        "model_add" => {
            let input = match parse_args::<ProviderModelAddInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let provider_id = input.provider_id.trim();
            let model_id = input
                .data
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let display_name = input
                .data
                .get("display_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let context_window = input
                .data
                .get("context_window")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32;
            if model_id.is_empty() {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "model id is required",
                    None,
                ));
            }
            match app_provider::station_api::create_model(
                &token,
                provider_id,
                model_id,
                display_name,
                true,
                context_window,
            ) {
                Ok(resp) => to_json(to_stub("model_add", resp)),
                Err(e) => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InternalError,
                    &format!("{:?}", e),
                    None,
                )),
            }
        }
        "model_update" => {
            let input = match parse_args::<ProviderModelUpdateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let scope = match resolve_scope(state) {
                Ok(s) => s,
                Err(e) => return e,
            };
            to_json(AppResult::<StubPayload>::fail(
                ErrorCode::NotFound,
                "models module removed",
                None,
            ))
        }
        "model_delete" => {
            let input = match parse_args::<ProviderModelDeleteInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let scope = match resolve_scope(state) {
                Ok(s) => s,
                Err(e) => return e,
            };
            to_json(AppResult::<StubPayload>::fail(
                ErrorCode::NotFound,
                "models module removed",
                None,
            ))
        }
        "model_fetch_remote" => {
            let input = match parse_args::<ProviderModelFetchInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let scope = match resolve_scope(state) {
                Ok(s) => s,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_provider::model_fetch_remote(
                scope.as_deref().unwrap_or(""),
                &token,
                &input.provider_id,
            ))
        }
        "model_toggle" => {
            let input = match parse_args::<ProviderModelToggleInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let scope = match resolve_scope(state) {
                Ok(s) => s,
                Err(e) => return e,
            };
            to_json(AppResult::<StubPayload>::fail(
                ErrorCode::NotFound,
                "models module removed",
                None,
            ))
        }
        "model_toggle_all" => {
            let input = match parse_args::<ProviderModelToggleAllInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let scope = match resolve_scope(state) {
                Ok(s) => s,
                Err(e) => return e,
            };
            to_json(AppResult::<StubPayload>::fail(
                ErrorCode::NotFound,
                "models module removed",
                None,
            ))
        }

        // =================================================================
        // Agents (no state)
        // =================================================================
        "agents_list" => to_json(app_agents::agents_list("")),
        "agents_get_selected" => to_json(app_agents::agents_get_selected("")),
        "agents_set_selected" => {
            let input = match parse_args::<AgentSelectInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_agents::agents_set_selected("", input))
        }
        "agents_get_default" => to_json(app_agents::agents_get_default("")),
        "agents_set_default" => {
            let input = match parse_args::<AgentIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_agents::agents_set_default("", input))
        }
        "agents_get" => {
            let input = match parse_args::<AgentIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_agents::agents_get("", input))
        }
        "agents_create" => {
            let input = match parse_args::<AgentCreateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_agents::agents_create("", input))
        }
        "agents_update" => {
            let input = match parse_args::<AgentUpdateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_agents::agents_update("", input))
        }
        "agents_delete" => {
            let input = match parse_args::<AgentIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_agents::agents_delete("", input))
        }
        "agents_duplicate" => {
            let input = match parse_args::<AgentDuplicateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_agents::agents_duplicate("", input))
        }
        "agents_export_package" => {
            let input = match parse_args::<AgentPackageExportInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_agents::agents_export_package("", input))
        }
        "agents_import_package" => {
            let input = match parse_args::<AgentPackageImportInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_agents::agents_import_package("", input))
        }
        "agents_search" => {
            let input = match parse_args::<AgentSearchInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_agents::agents_search("", input))
        }
        "agents_list_sessions" => {
            let input = match parse_args::<AgentIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_agents::agents_list_sessions("", input))
        }
        "agent_conversation_list" => {
            let input = match parse_args::<AgentConversationListInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_turn::agent_conversation_list(input, &token))
        }
        "agent_conversation_get" => {
            let input = match parse_args::<AgentConversationGetInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_turn::agent_conversation_get(input, &token))
        }
        "agent_conversation_create" => {
            let input = match parse_args::<AgentConversationCreateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_turn::agent_conversation_create(input, &token))
        }
        "agent_conversation_messages" => {
            let input = match parse_args::<AgentConversationMessagesInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_turn::agent_conversation_messages(input, &token))
        }
        "agent_conversation_archive" => {
            let input = match parse_args::<AgentConversationArchiveInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_turn::agent_conversation_archive(input, &token))
        }
        "agent_execute_turn" => {
            let input = match parse_args::<AgentExecuteTurnInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_turn::agent_execute_turn(input, &token, ""))
        }
        "agent_execute_turn_stream" => {
            let input = match parse_args::<AgentExecuteTurnInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            let stream_id = input
                .stream_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("agent-turn-{}", Ulid::new()));
            let cancel_flag = app_agent_turn::register_agent_turn_stream(&stream_id);
            let stream_id_for_task = stream_id.clone();
            let app_for_task = match runtime.app_handle("agent_execute_turn_stream") {
                Ok(app_handle) => app_handle,
                Err(error) => return error,
            };
            tauri::async_runtime::spawn_blocking(move || {
                app_agent_turn::agent_execute_turn_stream(
                    app_for_task,
                    stream_id_for_task.clone(),
                    input,
                    token,
                    "".to_string(),
                    cancel_flag,
                );
                app_agent_turn::unregister_agent_turn_stream(&stream_id_for_task);
            });
            to_json(AppResult::success(StubPayload {
                command: "agent_execute_turn_stream".to_string(),
                status: json!({ "stream_id": stream_id }).to_string(),
            }))
        }
        "agent_cancel_turn_stream" => {
            let input = match parse_args::<AgentTurnStreamCancelInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_agent_turn::cancel_agent_turn_stream(&input.stream_id))
        }
        "agent_turn_trace_list" => {
            let input = match parse_args::<AgentTurnTraceListInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_turn::agent_turn_trace_list(input, &token))
        }
        "agent_turn_trace_get" => {
            let input = match parse_args::<AgentTurnTraceGetInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_turn::agent_turn_trace_get(input, &token))
        }
        "agent_resolve_local_tool_request" => {
            let input = match parse_args::<AgentLocalToolRequestInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_agent_turn::agent_resolve_local_tool_request(input))
        }
        "agent_collaboration_create" => {
            let input = match parse_args::<AgentCollaborationCreateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_orchestration::agent_collaboration_create(
                input, &token, "",
            ))
        }
        "agent_collaboration_get" => {
            let input = match parse_args::<AgentCollaborationGetInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_orchestration::agent_collaboration_get(
                input, &token,
            ))
        }
        "agent_collaboration_list" => {
            let input = match parse_args::<AgentCollaborationListInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_orchestration::agent_collaboration_list(
                input, &token,
            ))
        }
        "agent_collaboration_list_events" => {
            let input = match parse_args::<AgentCollaborationListEventsInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_orchestration::agent_collaboration_list_events(
                input, &token,
            ))
        }
        "agent_collaboration_cancel_task" => {
            let input = match parse_args::<AgentCollaborationCancelTaskInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_orchestration::agent_collaboration_cancel_task(
                input, &token,
            ))
        }
        "agent_collaboration_resume_task" => {
            let input = match parse_args::<AgentCollaborationCancelTaskInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_orchestration::agent_collaboration_cancel_task(
                input, &token,
            ))
        }
        "agent_collaboration_submit_node_result" => {
            let input = match parse_args::<AgentCollaborationSubmitNodeResultInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_orchestration::agent_collaboration_submit_node_result(input, &token))
        }
        "agent_collaboration_claim_executor_task" => {
            let input = match parse_args::<AgentCollaborationClaimExecutorInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(app_agent_orchestration::agent_collaboration_claim_executor_task(input, &token))
        }
        "agent_collaboration_heartbeat_executor_lease" => {
            let input = match parse_args::<AgentCollaborationHeartbeatLeaseInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(
                app_agent_orchestration::agent_collaboration_heartbeat_executor_lease(
                    input, &token,
                ),
            )
        }
        "agent_collaboration_release_executor_lease" => {
            let input = match parse_args::<AgentCollaborationReleaseLeaseInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match http_gateway_bearer_token(state) {
                Some(t) => t,
                None => return to_json(unauthorized_error()),
            };
            to_json(
                app_agent_orchestration::agent_collaboration_release_executor_lease(input, &token),
            )
        }

        // =================================================================
        // Tools (no state)
        // =================================================================
        "tools_list" => to_json(app_tools::tools_list()),
        "tools_search_providers" => to_json(app_tools::tools_search_providers()),
        "tools_set_search_primary" => {
            let input = match parse_args::<SearchPrimaryInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_tools::tools_set_search_primary(input))
        }

        // =================================================================
        // Search (no state)
        // =================================================================
        "help_get" => to_json(app_search::help_get()),
        "search_sources" => to_json(app_search::search_sources()),
        "search_query" => {
            let input = match parse_args::<SearchQueryInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_search::search_query(input))
        }
        "search_ai" => {
            let input = match parse_args::<AiSearchInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_search::search_ai(input))
        }

        // =================================================================
        // System (no state)
        // =================================================================
        "system_health" => to_json(app_system::system_health()),
        "open_external_url" => {
            let input = match parse_args::<ExternalUrlInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_system::open_external_url(input))
        }
        "onboarding_reset" => to_json(app_system::onboarding_reset()),
        "statistics_get" => to_json(app_system::statistics_get()),
        "preferences_get" => to_json(app_system::preferences_get()),
        "preferences_set" => {
            let input = match parse_args::<PreferencesSetInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_system::preferences_set(input))
        }
        "share_create" => {
            let input = match parse_args::<ShareSessionInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_system::share_create(input))
        }
        "share_delete" => {
            let input = match parse_args::<ShareSessionInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_system::share_delete(input))
        }
        "share_get" => {
            let input = match parse_args::<ShareIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_system::share_get(input))
        }
        "logs_tail" => {
            let input = match parse_args::<LogsTailInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_system::logs_tail(input))
        }
        "oauth_simulate_lark_start" => {
            let input = match parse_args::<OAuthSimulateStartInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_system::oauth_simulate_lark_start(input))
        }
        "oauth_simulate_lark_poll" => {
            let input = match parse_args::<OAuthSessionInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_system::oauth_simulate_lark_poll(input))
        }
        "oauth_simulate_lark_create_bot_session" => {
            let input = match parse_args::<OAuthCreateBotSessionInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_system::oauth_simulate_lark_create_bot_session(input))
        }
        "config_section_get" => {
            let input = match parse_args::<ConfigSectionInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_system::config_section_get(input))
        }
        "config_section_set" => {
            let input = match parse_args::<ConfigSectionSetInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_system::config_section_set(input))
        }
        "config_field_reset" => {
            let input = match parse_args::<ConfigFieldResetInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_system::config_field_reset(input))
        }
        "config_test_postgres" => {
            let input = match parse_args::<ConfigPostgresTestInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_system::config_test_postgres(input))
        }
        "embedding_models_list" => to_json(app_system::embedding_models_list()),
        "visitor_heartbeat" => to_json(app_system::visitor_heartbeat()),
        "visitor_online" => to_json(app_system::visitor_online()),
        "context_snapshot_get" => {
            let input: Option<ContextSnapshotGetInput> = serde_json::from_value(args).ok();
            to_json(app_system::context_snapshot_get(input))
        }
        "context_action_dispatch" => {
            let input = match parse_args::<ContextActionDispatchInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_system::context_action_dispatch(input))
        }
        "context_capabilities" => to_json(app_system::context_capabilities()),
        "context_health" => to_json(app_system::context_health()),

        // =================================================================
        // Skills (no state)
        // =================================================================
        "skills_list" => {
            let input = match parse_args::<SkillsListInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(token) => to_json(app_skills::skills_list(input, &token)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "skills_search" => {
            let input = match parse_args::<SkillsSearchInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(token) => to_json(app_skills::skills_search(input, &token)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "skills_get" => {
            let input = match parse_args::<SkillIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(token) => to_json(app_skills::skills_get(input, &token)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "skills_get_builtin" => {
            let input = match parse_args::<BuiltinSkillIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_skills::skills_get_builtin(input))
        }
        "skills_create" => {
            let input = match parse_args::<SkillCreateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(token) => to_json(app_skills::skills_create(input, &token)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "skills_update" => {
            let input = match parse_args::<SkillUpdateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(token) => to_json(app_skills::skills_update(input, &token)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "skills_delete" => {
            let input = match parse_args::<SkillIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(token) => to_json(app_skills::skills_delete(input, &token)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "skills_toggle" => {
            let input = match parse_args::<SkillToggleInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(token) => to_json(app_skills::skills_toggle(input, &token)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "skills_versions" => {
            let input = match parse_args::<SkillVersionsInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(token) => to_json(app_skills::skills_versions(input, &token)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "skills_rollback" => {
            let input = match parse_args::<SkillRollbackInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(token) => to_json(app_skills::skills_rollback(input, &token)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }

        // =================================================================
        // Skills Market (no state)
        // =================================================================
        "skills_import_url" => {
            let input = match parse_args::<SkillImportAddressInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(token) => to_json(app_skills_market::skills_import_url(input, &token)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "skills_import_github" => {
            let input = match parse_args::<SkillImportGitHubInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(token) => to_json(app_skills_market::skills_import_github(input, &token)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "skills_import_zip" => {
            let input = match parse_args::<SkillImportZipInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(token) => to_json(app_skills_market::skills_import_zip(input, &token)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "skills_validate_zip" => {
            let input = match parse_args::<SkillImportZipInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_skills_market::skills_validate_zip(input))
        }
        "skills_market_dir" => to_json(app_skills_market::skills_market_dir()),
        "skills_market_open_dir" => to_json(app_skills_market::skills_market_open_dir()),
        "skills_market_list" => to_json(app_skills_market::skills_market_list()),
        "skills_market_add" => {
            let input = match parse_args::<SkillMarketAddInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_skills_market::skills_market_add(input))
        }
        "skills_market_remove" => {
            let input = match parse_args::<SkillMarketIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_skills_market::skills_market_remove(input))
        }
        "skills_market_sync" => {
            let input = match parse_args::<SkillMarketSyncInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_skills_market::skills_market_sync(input))
        }
        "skills_market_list_skills" => {
            let input = match parse_args::<SkillMarketListInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_skills_market::skills_market_list_skills(input))
        }
        "skills_market_detail" => {
            let input = match parse_args::<SkillMarketDetailInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_skills_market::skills_market_detail(input))
        }
        "skills_market_install" => {
            let input = match parse_args::<SkillMarketDetailInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(token) => {
                    let actor_id = actor_id_from_state(state).unwrap_or_default();
                    to_json(app_skills_market::skills_market_install(
                        &actor_id, input, &token,
                    ))
                }
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "skills_market_uninstall" => {
            let input = match parse_args::<SkillMarketDetailInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_bearer_token(state) {
                Some(token) => {
                    let actor_id = actor_id_from_state(state).unwrap_or_default();
                    to_json(app_skills_market::skills_market_uninstall(
                        &actor_id, input, &token,
                    ))
                }
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }

        // =================================================================
        // Notebook (no state)
        // =================================================================
        "notebook_list_documents" => {
            let input = match parse_args::<TopicIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_notebook::notebook_list_documents(input))
        }
        "notebook_get_document" => {
            let input = match parse_args::<NotebookIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_notebook::notebook_get_document(input))
        }
        "notebook_create_document" => {
            let input = match parse_args::<NotebookCreateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_notebook::notebook_create_document(input))
        }
        "notebook_update_document" => {
            let input = match parse_args::<NotebookUpdateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_notebook::notebook_update_document(input))
        }
        "notebook_delete_document" => {
            let input = match parse_args::<NotebookIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_notebook::notebook_delete_document(input))
        }
        "notebook_list_all_documents" => to_json(app_notebook::notebook_list_all_documents()),

        // =================================================================
        // Applets (state-dependent)
        // =================================================================
        "applets_list" => match http_gateway_applet_context(state) {
            Some(ctx) => to_json(app_applets::applets_list(ctx)),
            None => to_json(AppResult::<StubPayload>::fail(
                ErrorCode::Unauthorized,
                "authentication required",
                None,
            )),
        },
        "applets_get" => {
            let input = match parse_args::<AppletIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => to_json(app_applets::applets_get(ctx, input)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "applets_activate" => {
            let input = match parse_args::<AppletIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => to_json(app_applets::applets_activate(ctx, input)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "applets_deactivate" => {
            let input = match parse_args::<AppletIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => to_json(app_applets::applets_deactivate(ctx, input)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "applets_get_config" => {
            let input = match parse_args::<AppletIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => to_json(app_applets::applets_get_config(ctx, input)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "applets_set_config" => {
            let input = match parse_args::<AppletConfigSetInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => to_json(app_applets::applets_set_config(ctx, input)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "applets_action" => {
            let input = match parse_args::<AppletActionInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => to_json(app_applets::applets_action(ctx, input)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "applets_create_session" => {
            let input = match parse_args::<AppletCreateSessionInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => {
                    let data_dir = state
                        .storage
                        .dirs
                        .get(&crate::infrastructure::storage::StorageKind::Data)
                        .cloned()
                        .unwrap_or_else(|| std::path::PathBuf::from("."));
                    to_json(app_applets::applets_create_session(ctx, input, &data_dir))
                }
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "applets_invoke" => {
            let input = match parse_args::<AppletInvokeInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => {
                    let data_dir = state
                        .storage
                        .dirs
                        .get(&crate::infrastructure::storage::StorageKind::Data)
                        .cloned()
                        .unwrap_or_else(|| std::path::PathBuf::from("."));
                    to_json(app_applets::applets_invoke(ctx, input, &data_dir))
                }
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }

        // =================================================================
        // Federation
        // =================================================================
        "federation_health" => match app_federation::health() {
            Ok(view) => to_json(AppResult::success(app_federation::encode_health(&view))),
            Err(e) => to_json(e.into_app_result::<Vec<u8>>("federation_health failed")),
        },
        "federation_get_self" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match app_federation::get_self(&token) {
                Ok(view) => to_json(AppResult::success(app_federation::encode_self(&view))),
                Err(e) => to_json(e.into_app_result::<Vec<u8>>("federation_get_self failed")),
            }
        }
        "federation_update_visibility" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let input = match parse_args::<FederationVisibilityInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match app_federation::set_visibility(&token, &input.visibility) {
                Ok(view) => to_json(AppResult::success(app_federation::encode_self(&view))),
                Err(e) => to_json(e.into_app_result_proto("federation_update_visibility failed")),
            }
        }
        "federation_resolve" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let input = match parse_args::<FederationResolveInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match app_federation::resolve(&token, &input.handle) {
                Ok(view) => to_json(AppResult::success(app_federation::encode_resolve(&view))),
                Err(e) => to_json(e.into_app_result_proto("federation_resolve failed")),
            }
        }
        "federation_catalog_search" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let input = match parse_args::<FederationCatalogSearchInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match app_federation::catalog_search(
                &token,
                &input.federation_id,
                &input.prefix,
                input.station_id.as_deref(),
                input.page_size,
            ) {
                Ok(view) => to_json(AppResult::success(app_federation::encode_catalog_search(
                    &view,
                ))),
                Err(e) => to_json(e.into_app_result_proto("federation_catalog_search failed")),
            }
        }
        "federation_list_federations" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match app_federation::list_federations(&token) {
                Ok(view) => to_json(AppResult::success(app_federation::encode_list_federations(
                    &view,
                ))),
                Err(e) => {
                    to_json(e.into_app_result::<Vec<u8>>("federation_list_federations failed"))
                }
            }
        }

        // =================================================================
        // Applet store (catalog/install — state-dependent)
        // =================================================================
        "applets_store_list_catalog" => {
            let input = match parse_args::<AppletStoreListCatalogInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => {
                    let data_dir = http_gateway_data_dir(state);
                    to_json(app_applet_store::list_catalog(ctx, input, &data_dir))
                }
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "applets_store_list_installed" => {
            let input = match parse_args::<AppletStoreListInstalledInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => {
                    let data_dir = http_gateway_data_dir(state);
                    to_json(app_applet_store::list_installed(ctx, input, &data_dir))
                }
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "applets_store_install" => {
            let input = match parse_args::<AppletStoreInstallInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => to_json(app_applet_store::install(ctx, input)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "applets_store_uninstall" => {
            let input = match parse_args::<AppletStoreUninstallInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => to_json(app_applet_store::uninstall(ctx, input)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "applets_store_get_version" => {
            let input = match parse_args::<AppletStoreGetVersionInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => {
                    let data_dir = http_gateway_data_dir(state);
                    to_json(app_applet_store::get_version(ctx, input, &data_dir))
                }
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "applets_store_materialize_bundle" => {
            let input = match parse_args::<AppletStoreMaterializeBundleInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => {
                    let data_dir = http_gateway_data_dir(state);
                    to_json(app_applet_store::materialize_bundle(ctx, input, &data_dir))
                }
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }
        "applets_store_upload_audit" => {
            let input = match parse_args::<AppletStoreUploadAuditInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match http_gateway_applet_context(state) {
                Some(ctx) => to_json(app_applet_store::upload_audit(ctx, input.device_id)),
                None => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                )),
            }
        }

        // =================================================================
        // MCP (no state)
        // =================================================================
        "mcp_list_servers" => to_json(app_mcp::mcp_list_servers()),
        "mcp_get_server" => {
            let input = match parse_args::<McpNameInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_mcp::mcp_get_server(input))
        }
        "mcp_create_server" => {
            let input = match parse_args::<McpCreateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_mcp::mcp_create_server(input))
        }
        "mcp_update_server" => {
            let input = match parse_args::<McpUpdateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_mcp::mcp_update_server(input))
        }
        "mcp_delete_server" => {
            let input = match parse_args::<McpNameInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_mcp::mcp_delete_server(input))
        }
        "mcp_toggle_server" => {
            let input = match parse_args::<McpToggleInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_mcp::mcp_toggle_server(input))
        }
        "mcp_test_server" => {
            let input = match parse_args::<McpNameInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_mcp::mcp_test_server(input))
        }
        "mcp_execute_tool" => {
            let input = match parse_args::<McpExecuteToolInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_mcp::mcp_execute_tool(input))
        }

        // =================================================================
        // Cron (no state)
        // =================================================================
        "cron_status" => to_json(app_cron::cron_status()),
        "cron_list_jobs" => to_json(app_cron::cron_list_jobs()),
        "cron_create_job" => {
            let input = match parse_args::<CronCreateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_cron::cron_create_job(input))
        }
        "cron_update_job" => {
            let input = match parse_args::<CronUpdateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_cron::cron_update_job(input))
        }
        "cron_delete_job" => {
            let input = match parse_args::<CronIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_cron::cron_delete_job(input))
        }
        "cron_toggle_job" => {
            let input = match parse_args::<CronToggleInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_cron::cron_toggle_job(input))
        }
        "cron_run_job" => {
            let input = match parse_args::<CronIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_cron::cron_run_job(input))
        }
        "cron_list_runs" => {
            let input = match parse_args::<CronRunsInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_cron::cron_list_runs(input))
        }
        "cron_parse_schedule" => {
            let input = match parse_args::<CronParseScheduleInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_cron::cron_parse_schedule(input))
        }

        // =================================================================
        // Model Config (no state)
        // =================================================================
        "model_config_list" => to_json(app_model_config::model_config_list()),
        "model_config_get" => {
            let input = match parse_args::<ModelConfigKeyInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_model_config::model_config_get(input))
        }
        "model_config_set" => {
            let input = match parse_args::<ModelConfigSetInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_model_config::model_config_set(input))
        }
        "model_config_delete" => {
            let input = match parse_args::<ModelConfigKeyInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_model_config::model_config_delete(input))
        }
        "model_config_provider_references" => {
            let input = match parse_args::<ProviderIdInputV2>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_model_config::model_config_provider_references(input))
        }

        // =================================================================
        // Channels (no state)
        // =================================================================
        "channels_list" => to_json(app_channels::channels_list()),
        "channels_get" => {
            let input = match parse_args::<ChannelIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_channels::channels_get(input))
        }
        "channels_create" => {
            let input = match parse_args::<ChannelCreateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_channels::channels_create(input))
        }
        "channels_update" => {
            let input = match parse_args::<ChannelUpdateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_channels::channels_update(input))
        }
        "channels_delete" => {
            let input = match parse_args::<ChannelIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_channels::channels_delete(input))
        }
        "channels_test" => {
            let input = match parse_args::<ChannelIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_channels::channels_test(input))
        }
        "channels_send" => {
            let input = match parse_args::<ChannelSendMessageInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_channels::channels_send(input))
        }
        "channels_list_chats" => {
            let input = match parse_args::<ChannelIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_channels::channels_list_chats(input))
        }
        "channels_start_bot" => {
            let input = match parse_args::<ChannelIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_channels::channels_start_bot(input))
        }
        "channels_stop_bot" => {
            let input = match parse_args::<ChannelIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_channels::channels_stop_bot(input))
        }
        "channels_bot_status" => {
            let input = match parse_args::<ChannelIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_channels::channels_bot_status(input))
        }
        "channels_list_events" => {
            let input = match parse_args::<ChannelEventsInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_channels::channels_list_events(input))
        }
        "channels_stats" => {
            let input = match parse_args::<ChannelIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_channels::channels_stats(input))
        }

        // =================================================================
        // OAuth2 (no state)
        // =================================================================
        "oauth2_list_providers" => to_json(app_oauth2::oauth2_list_providers()),
        "oauth2_get_provider" => {
            let input = match parse_args::<OAuthIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_oauth2::oauth2_get_provider(input))
        }
        "oauth2_get_credential_info" => {
            let input = match parse_args::<OAuthIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_oauth2::oauth2_get_credential_info(input))
        }
        "oauth2_set_credentials" => {
            let input = match parse_args::<OAuthSetCredentialsInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_oauth2::oauth2_set_credentials(input))
        }
        "oauth2_authorize" => {
            let input = match parse_args::<OAuthAuthorizeInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_oauth2::oauth2_authorize(input))
        }
        "oauth2_handle_callback" => {
            let input = match parse_args::<OAuthCallbackInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_oauth2::oauth2_handle_callback(input))
        }
        "oauth2_list_connections" => to_json(app_oauth2::oauth2_list_connections()),
        "oauth2_get_connection" => {
            let input = match parse_args::<OAuthIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_oauth2::oauth2_get_connection(input))
        }
        "oauth2_disconnect" => {
            let input = match parse_args::<OAuthIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_oauth2::oauth2_disconnect(input))
        }
        "oauth2_refresh_token" => {
            let input = match parse_args::<OAuthIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_oauth2::oauth2_refresh_token(input))
        }
        "oauth2_call_resource" => {
            let input = match parse_args::<OAuthResourceInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_oauth2::oauth2_call_resource(input))
        }
        "oauth2_reload" => to_json(app_oauth2::oauth2_reload()),
        "oauth2_get_page" => {
            let input = match parse_args::<OAuthIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_oauth2::oauth2_get_page(input))
        }
        "oauth2_start_loopback" => {
            let input = match parse_args::<OAuthLoopbackStartInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_oauth2::oauth2_start_loopback(input, state.i18n.clone()))
        }
        "oauth2_poll_loopback" => {
            let input = match parse_args::<OAuthLoopbackPollInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_oauth2::oauth2_poll_loopback(input))
        }

        // =================================================================
        // Account (no state)
        // =================================================================
        "account_list" => to_json(app_account::account_list()),
        "account_get_active" => to_json(app_account::account_get_active()),
        "account_get_device_id" => {
            let actor_id = match actor_id_from_state(state) {
                Some(id) if !id.trim().is_empty() => id,
                Some(_) | None => {
                    return to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::Unauthorized,
                        "authentication required",
                        None,
                    ));
                }
            };
            match device_install::get_or_create_device_id(actor_id.as_str()) {
                Ok(device_id) => {
                    crate::infrastructure::station_client::set_device_id(device_id.clone());
                    to_json(AppResult::success(StubPayload {
                        command: "account_get_device_id".to_string(),
                        status: json!({ "device_id": device_id }).to_string(),
                    }))
                }
                Err(e) => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InternalError,
                    format!("device_id: {e}"),
                    None,
                )),
            }
        }
        "account_switch" => {
            let input = match parse_args::<AccountIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_account::account_switch(input))
        }
        "account_upsert_oauth" => {
            let input = match parse_args::<AccountUpsertOAuthInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_account::account_upsert_oauth(input))
        }
        "account_set_pin" => {
            let input = match parse_args::<AccountSetPinInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = state.session.lock().ok().and_then(|g| g.token.clone());
            let account_id = input.account_id.clone();
            let result = app_account::account_set_pin(input, token.as_deref());
            if result.ok {
                crate::infrastructure::session_vault::purge_raw_session_for_account(&account_id);
            }
            to_json(result)
        }
        "account_unlock" => {
            let input = match parse_args::<AccountUnlockInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let result = app_account::account_unlock(input.clone());
            if !result.ok {
                return serde_json::to_value(&result).unwrap_or(json!({"ok": false}));
            }
            // Parse token from the stub payload and write to AppState
            let token = result
                .data
                .as_ref()
                .and_then(|d| serde_json::from_str::<serde_json::Value>(&d.status).ok())
                .and_then(|v| {
                    v.get("token")
                        .and_then(|t| t.as_str())
                        .map(|s| s.to_string())
                });
            if let Some(t) = token {
                let token = match app_auth::takeover_station_session_token(&t) {
                    Ok(token) => token,
                    Err(err) => {
                        let _ = crate::infrastructure::auth_identity::clear_account_session(
                            &input.account_id,
                        );
                        return to_json(app_auth::session_takeover_failed::<
                            crate::contracts::AuthSessionPayload,
                        >(
                            err, Some(&input.account_id), None
                        ));
                    }
                };
                let actor_id = input
                    .account_id
                    .split_once(':')
                    .map(|(_, id)| id.to_string())
                    .unwrap_or_else(|| input.account_id.clone());
                let session =
                    crate::domain::auth::session::from_station_response(actor_id, token.clone());
                if let Ok(mut guard) = state.session.lock() {
                    guard.actor_id = Some(session.actor_id.clone());
                    guard.token = Some(session.token.clone());
                    guard.account_id = Some(input.account_id.clone());
                }
                let _ = crate::infrastructure::session_vault::save_encrypted_session_and_purge_raw(
                    &input.account_id,
                    &input.pin,
                    &token,
                );
                let _ = app_account::account_switch(AccountIdInput {
                    id: input.account_id.clone(),
                });
                let profile = crate::infrastructure::auth_identity::find_profile_by_actor_id(
                    &session.actor_id,
                );
                let (p_name, p_email, p_avatar, p_local_avatar, p_method) = match &profile {
                    Some(p) => (
                        Some(p.name.clone()).filter(|v| !v.is_empty()),
                        Some(p.email.clone()).filter(|v| !v.is_empty()),
                        Some(p.avatar_url.clone()).filter(|v| !v.is_empty()),
                        p.avatar_local_path.clone().filter(|v| !v.is_empty()),
                        Some(p.provider.clone()),
                    ),
                    None => (None, None, None, None, None),
                };
                return to_json(AppResult::success(crate::contracts::AuthSessionPayload {
                    command: "account_unlock".to_string(),
                    status: "authenticated".to_string(),
                    actor_id: Some(session.actor_id),
                    ptid: crate::application::auth::service::canonical_ptid_for_token(&token),
                    name: p_name,
                    email: p_email,
                    avatar_url: p_avatar,
                    avatar_local_path: p_local_avatar,
                    login_method: p_method,
                }));
            }
            serde_json::to_value(&result).unwrap_or(json!({"ok": false}))
        }
        "account_relink_pin" => {
            let input = match parse_args::<AccountUnlockInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = state.session.lock().ok().and_then(|g| g.token.clone());
            let account_id = input.account_id.clone();
            let result = app_account::account_relink_pin(input, token.as_deref());
            if result.ok {
                crate::infrastructure::session_vault::purge_raw_session_for_account(&account_id);
            }
            to_json(result)
        }
        "account_list_restorable" => to_json(app_account::account_list_restorable()),
        "account_clear_session" => {
            let input = match parse_args::<AccountIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            match crate::infrastructure::auth_identity::clear_account_session(&input.id) {
                Ok(()) => to_json(AppResult::success(StubPayload {
                    command: "account_clear_session".to_string(),
                    status: "ok".to_string(),
                })),
                Err(e) => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InternalError,
                    format!("clear_account_session: {e}"),
                    None,
                )),
            }
        }
        "account_remove_pin" => {
            let input = match parse_args::<AccountRemovePinInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_account::account_remove_pin(input))
        }

        // =================================================================
        // Memory (state-dependent Station API)
        // =================================================================
        "memory_list" => {
            let input = match parse_args::<MemoryListInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_memory::memory_list(input, &token))
        }
        "memory_get" => {
            let input = match parse_args::<MemoryIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_memory::memory_get(input, &token))
        }
        "memory_delete" => {
            let input = match parse_args::<MemoryIdInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_memory::memory_delete(input, &token))
        }
        "memory_search" => {
            let input = match parse_args::<MemorySearchInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_memory::memory_search(input, &token))
        }
        "memory_persona" => {
            let input = match parse_args::<MemoryPersonaInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_memory::memory_persona(input, &token))
        }
        "memory_stats" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_memory::memory_stats(&token))
        }
        "memory_events" => {
            let input = match parse_args::<MemoryEventsInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_memory::memory_events(input, &token))
        }
        "memory_export" => {
            let input = match parse_args::<MemoryExportInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_memory::memory_export(input, &token))
        }
        "memory_import" => {
            let input = match parse_args::<MemoryImportInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_memory::memory_import(input, &token))
        }
        "memory_embedding_status" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_memory::memory_embedding_status(&token))
        }
        "memory_reembed" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            to_json(app_memory::memory_reembed(&token))
        }

        // =================================================================
        // TTS (no state)
        // =================================================================
        "tts_synthesize" => {
            let input = match parse_args::<TtsInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            to_json(app_tts::tts_synthesize(input))
        }
        "tts_voices" => to_json(app_tts::tts_voices()),


        // =================================================================
        // Social Friend Requests (state-dependent, station proto API)
        // =================================================================
        "social_friend_request_send" => {
            let input = match parse_args::<SocialFriendRequestSendInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            if input.receiver_did.trim().is_empty() {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument,
                    "receiver_did is required",
                    None,
                ));
            }
            let req = model::chat::SendFriendRequestRequest {
                receiver_did: input.receiver_did,
                message: input.message.unwrap_or_default(),
            };
            let resp = match station_client::request_proto::<
                model::chat::SendFriendRequestRequest,
                model::chat::SendFriendRequestResponse,
            >(
                Method::POST, "/api/v1/social/friend-request/send", &token, None, Some(&req),
            ) {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("Station request failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_friend_request_accept" => {
            let input = match parse_args::<SocialFriendRequestAcceptInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            if input.request_id.trim().is_empty() {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument, "request_id is required", None,
                ));
            }
            let req = model::chat::AcceptFriendRequestRequest { request_id: input.request_id };
            let resp = match station_client::request_proto::<
                model::chat::AcceptFriendRequestRequest,
                model::chat::AcceptFriendRequestResponse,
            >(
                Method::POST, "/api/v1/social/friend-request/accept", &token, None, Some(&req),
            ) {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("Station request failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_friend_request_reject" => {
            let input = match parse_args::<SocialFriendRequestRejectInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            if input.request_id.trim().is_empty() {
                return to_json(AppResult::<Vec<u8>>::fail(
                    ErrorCode::InvalidArgument, "request_id is required", None,
                ));
            }
            let req = model::chat::RejectFriendRequestRequest { request_id: input.request_id };
            let resp = match station_client::request_proto::<
                model::chat::RejectFriendRequestRequest,
                model::chat::RejectFriendRequestResponse,
            >(
                Method::POST, "/api/v1/social/friend-request/reject", &token, None, Some(&req),
            ) {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("Station request failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "social_friend_request_list" => {
            let input = match parse_args::<SocialFriendRequestListInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let mut query = Vec::new();
            if let Some(status) = input.status {
                query.push(("status", status.to_string()));
            }
            query.push(("limit", input.limit.unwrap_or(50).clamp(1, 200).to_string()));
            query.push(("offset", input.offset.unwrap_or(0).to_string()));
            let resp = match station_client::request_proto::<
                (), model::chat::ListFriendRequestsResponse,
            >(
                Method::GET, "/api/v1/social/friend-requests", &token, Some(&query), None::<&()>,
            ) {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("Station request failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        // =================================================================
        // Group Chat (state-dependent, station JSON API + proto)
        // =================================================================
        "group_chat_list_groups" => {
            let input = match parse_args::<GroupChatListInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let query = vec![
                ("limit", input.limit.unwrap_or(50).to_string()),
                ("offset", input.offset.unwrap_or(0).to_string()),
            ];
            match station_request_json(Method::GET, "/group-chat/list", &token, Some(&query), None)
            {
                Ok(data) => to_json(to_stub("group_chat_list_groups", data)),
                Err(e) => e,
            }
        }
        "group_chat_list_messages" => {
            let input = match parse_args::<GroupChatListMessagesInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            if input.group_ulid.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "group_ulid is required",
                    None,
                ));
            }
            let mut query = vec![
                ("group_ulid", input.group_ulid),
                ("limit", input.limit.unwrap_or(50).to_string()),
            ];
            if let Some(before) = input.before_ulid {
                query.push(("before_ulid", before));
            }
            let data = match station_request_json(
                Method::GET,
                "/group-chat/messages",
                &token,
                Some(&query),
                None,
            ) {
                Ok(d) => d,
                Err(e) => return e,
            };
            let user_scope = user_scope_from_state(state);
            let _ = chat_storage::ingest_group_messages(&user_scope, &data);
            to_json(to_stub("group_chat_list_messages", data))
        }
        "group_chat_list_thread_messages" => {
            let input = match parse_args::<GroupChatThreadInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            if input.group_ulid.trim().is_empty() || input.root_ulid.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "group_ulid and root_ulid are required",
                    None,
                ));
            }
            match chat_storage::list_group_thread_messages(
                &token,
                input.group_ulid.as_str(),
                input.root_ulid.as_str(),
                input.limit.unwrap_or(100),
                input.after_ulid.as_deref(),
                input.max_pages.unwrap_or(50),
            ) {
                Ok(data) => to_json(to_stub("group_chat_list_thread_messages", data)),
                Err(e) => to_json(e.into_app_result::<StubPayload>("station request failed")),
            }
        }
        "group_chat_thread_counts" => {
            let input = match parse_args::<GroupChatThreadCountsInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            if input.group_ulid.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "group_ulid is required",
                    None,
                ));
            }
            match chat_storage::group_thread_counts(
                &token,
                input.group_ulid.as_str(),
                input.root_ulids.as_slice(),
            ) {
                Ok(data) => to_json(to_stub("group_chat_thread_counts", data)),
                Err(e) => to_json(e.into_app_result::<StubPayload>("station request failed")),
            }
        }
        "group_chat_unread_count" => {
            let input = match parse_args::<GroupChatUnreadInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let mut query = Vec::new();
            if let Some(g) = input.group_ulid {
                query.push(("group_ulid", g));
            }
            match station_request_json(
                Method::GET,
                "/group-chat/unread-count",
                &token,
                Some(&query),
                None,
            ) {
                Ok(data) => to_json(to_stub("group_chat_unread_count", data)),
                Err(e) => e,
            }
        }
        "group_chat_mark_read" => {
            let input = match parse_args::<GroupChatMarkReadInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::POST,
                "/group-chat/mark-read",
                &token,
                None,
                Some(json!({"group_ulid": input.group_ulid})),
            ) {
                Ok(data) => to_json(to_stub("group_chat_mark_read", data)),
                Err(e) => e,
            }
        }
        "group_chat_create_group" => {
            let input = match parse_args::<GroupChatCreateGroupInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let req = model::chat::CreateGroupRequest {
                name: input.name,
                description: input.description.unwrap_or_default(),
                initial_member_dids: input.member_dids.unwrap_or_default(),
                initial_federated_members: input
                    .initial_federated_members
                    .unwrap_or_default()
                    .into_iter()
                    .map(group_chat_federated_actor_input_to_proto)
                    .collect(),
                ..Default::default()
            };
            let resp = match station_client::request_proto::<
                model::chat::CreateGroupRequest,
                model::chat::CreateGroupResponse,
            >(
                Method::POST, "/group-chat/create", &token, None, Some(&req)
            ) {
                Ok(r) => r,
                Err(e) => {
                    return to_json(e.into_app_result::<StubPayload>("Station request failed"));
                }
            };
            let group_json = match resp.group {
                Some(g) => {
                    json!({"ulid": g.ulid, "name": g.name, "description": g.description, "owner_did": g.owner_did, "type": g.r#type})
                }
                None => json!(null),
            };
            to_json(to_stub(
                "group_chat_create_group",
                json!({"group": group_json}),
            ))
        }
        "group_chat_get_group" => {
            let input = match parse_args::<GroupUlidInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::GET,
                "/group-chat/info",
                &token,
                None,
                Some(json!({ "group_ulid": input.group_ulid })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_get_group", data)),
                Err(e) => e,
            }
        }
        "group_chat_update_group" => {
            let input = match parse_args::<GroupUpdateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::PUT,
                "/group-chat/update",
                &token,
                None,
                Some(json!({
                    "group_ulid": input.group_ulid,
                    "name": input.name,
                    "description": input.description.unwrap_or_default(),
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_update_group", data)),
                Err(e) => e,
            }
        }
        "group_chat_invite_to_group" => {
            let input = match parse_args::<GroupInviteInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::POST,
                "/group-chat/invite",
                &token,
                None,
                Some(json!({
                    "group_ulid": input.group_ulid,
                    "invitee_dids": input.member_dids,
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_invite_to_group", data)),
                Err(e) => e,
            }
        }
        "group_chat_add_federated_member" => {
            let input = match parse_args::<GroupAddFederatedMemberInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let member = group_chat_federated_actor_input_to_proto(input.member);
            match station_request_json(
                Method::POST,
                "/group-chat/member/federated-add",
                &token,
                None,
                Some(json!({
                    "group_ulid": input.group_ulid,
                    "member": {
                        "ptid": member.ptid,
                        "home_station_peer_id": member.home_station_peer_id,
                        "home_station_domain": member.home_station_domain,
                        "federated_handle": member.federated_handle,
                        "actor_identity_public_key": member.actor_identity_public_key,
                        "profile_version": member.profile_version,
                        "federation_id": member.federation_id,
                    },
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_add_federated_member", data)),
                Err(e) => e,
            }
        }
        "group_chat_join_group" => {
            let input = match parse_args::<GroupJoinInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::POST,
                "/group-chat/join",
                &token,
                None,
                Some(json!({
                    "group_ulid": input.group_ulid,
                    "invitation_ulid": input.invitation_ulid.unwrap_or_default(),
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_join_group", data)),
                Err(e) => e,
            }
        }
        "group_chat_leave_group" => {
            let input = match parse_args::<GroupChatLeaveGroupInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let req = model::chat::LeaveGroupRequest {
                group_ulid: input.group_ulid,
            };
            let resp = match station_client::request_proto::<
                model::chat::LeaveGroupRequest,
                model::chat::LeaveGroupResponse,
            >(
                Method::POST, "/group-chat/leave", &token, None, Some(&req)
            ) {
                Ok(r) => r,
                Err(e) => {
                    return to_json(e.into_app_result::<StubPayload>("Station request failed"));
                }
            };
            to_json(to_stub(
                "group_chat_leave_group",
                json!({"success": resp.success}),
            ))
        }
        "group_chat_get_members" => {
            let input = match parse_args::<GroupMembersInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::GET,
                "/group-chat/members",
                &token,
                None,
                Some(json!({
                    "group_ulid": input.group_ulid,
                    "limit": input.limit.unwrap_or(100) as i32,
                    "offset": input.offset.unwrap_or(0) as i32,
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_get_members", data)),
                Err(e) => e,
            }
        }
        "group_chat_remove_member" => {
            let input = match parse_args::<GroupRemoveMemberInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::POST,
                "/group-chat/member/remove",
                &token,
                None,
                Some(json!({
                    "group_ulid": input.group_ulid,
                    "ptid": input.member_did,
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_remove_member", data)),
                Err(e) => e,
            }
        }
        "group_chat_update_member" => {
            let input = match parse_args::<GroupUpdateMemberInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let muted_until = input
                .muted_until_unix_ms
                .map(|millis| prost_types::Timestamp {
                    seconds: millis / 1000,
                    nanos: ((millis % 1000) * 1_000_000) as i32,
                });
            let req = model::chat::UpdateMemberRequest {
                group_ulid: input.group_ulid,
                ptid: input.member_did,
                role: input.role,
                muted: input.muted,
                muted_until,
            };
            let resp = match station_client::request_proto::<
                model::chat::UpdateMemberRequest,
                model::chat::UpdateMemberResponse,
            >(
                Method::PUT,
                "/group-chat/member/update",
                &token,
                None,
                Some(&req),
            ) {
                Ok(r) => r,
                Err(e) => return to_json(e.into_app_result::<Vec<u8>>("Station request failed")),
            };
            to_json(AppResult::success(resp.encode_to_vec()))
        }
        "group_chat_recall_message" => {
            let input = match parse_args::<GroupMessageActionInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::POST,
                "/group-chat/message/recall",
                &token,
                None,
                Some(json!({
                    "group_ulid": input.group_ulid, "message_ulid": input.message_ulid,
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_recall_message", data)),
                Err(e) => e,
            }
        }
        "group_chat_delete_message" => {
            let input = match parse_args::<GroupMessageActionInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::POST,
                "/group-chat/message/delete",
                &token,
                None,
                Some(json!({
                    "group_ulid": input.group_ulid, "message_ulid": input.message_ulid,
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_delete_message", data)),
                Err(e) => e,
            }
        }
        // Admin / debug HTTP bridge for the new edit endpoint —
        // the production data-plane is the Tauri proto command
        // (group_chat_edit_message); this gateway entry exists so
        // operators can drive edits from the dashboard / curl.
        "group_chat_edit_message" => {
            let input = match parse_args::<GroupChatEditInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let mut body = json!({
                "group_ulid": input.group_ulid,
                "message_ulid": input.message_ulid,
            });
            if let Some(content) = input.new_content.filter(|c| !c.trim().is_empty()) {
                body["new_content"] = json!(content);
            }
            if let Some(ct) = input.new_encrypted_payload.filter(|c| !c.is_empty()) {
                // base64 the payload for the JSON wire — the
                // proto path is byte-clean, but JSON has no
                // canonical bytes representation.
                use base64::{engine::general_purpose::STANDARD, Engine as _};
                body["new_encrypted_payload_b64"] = json!(STANDARD.encode(&ct));
            }
            match station_request_json(
                Method::POST,
                "/group-chat/message/edit",
                &token,
                None,
                Some(body),
            ) {
                Ok(data) => to_json(to_stub("group_chat_edit_message", data)),
                Err(e) => e,
            }
        }
        "group_chat_search_messages" => {
            let input = match parse_args::<GroupSearchMessagesInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::GET,
                "/group-chat/messages/search",
                &token,
                None,
                Some(json!({
                    "group_ulid": input.group_ulid,
                    "query": input.query,
                    "limit": input.limit.unwrap_or(50) as i32,
                    "before_ulid": "",
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_search_messages", data)),
                Err(e) => e,
            }
        }
        "group_chat_update_nickname" => {
            let input = match parse_args::<GroupUpdateNicknameInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::PUT,
                "/group-chat/member/nickname",
                &token,
                None,
                Some(json!({
                    "group_ulid": input.group_ulid,
                    "nickname": input.nickname,
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_update_nickname", data)),
                Err(e) => e,
            }
        }
        "group_chat_get_settings" => {
            let input = match parse_args::<GroupUlidInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::GET,
                "/group-chat/my-settings",
                &token,
                None,
                Some(json!({ "group_ulid": input.group_ulid })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_get_settings", data)),
                Err(e) => e,
            }
        }
        "group_chat_update_settings" => {
            let input = match parse_args::<GroupUpdateMySettingsInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let mut body = json!({"group_ulid": input.group_ulid});
            if let Some(v) = input.is_muted {
                body["is_muted"] = json!(v);
            }
            if let Some(v) = input.is_pinned {
                body["is_pinned"] = json!(v);
            }
            if let Some(v) = input.show_member_nickname {
                body["show_member_nickname"] = json!(v);
            }
            if let Some(v) = input.alert_enabled {
                body["alert_enabled"] = json!(v);
            }
            if let Some(v) = input.background {
                body["background"] = json!(v);
            }
            if let Some(v) = input.cleared_at_unix_ms {
                body["cleared_at_unix_ms"] = json!(v);
            }
            match station_request_json(
                Method::PUT,
                "/group-chat/my-settings",
                &token,
                None,
                Some(body),
            ) {
                Ok(data) => to_json(to_stub("group_chat_update_settings", data)),
                Err(e) => e,
            }
        }
        "group_chat_get_offline_messages" => {
            let input = match parse_args::<GroupOfflineMessagesInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::GET,
                "/group-chat/offline-messages",
                &token,
                None,
                Some(json!({ "limit": input.limit.unwrap_or(100) as i32 })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_get_offline_messages", data)),
                Err(e) => e,
            }
        }
        "group_chat_ack_offline_messages" => {
            let input = match parse_args::<GroupAckOfflineInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::POST,
                "/group-chat/offline-messages/ack",
                &token,
                None,
                Some(json!({
                    "ulids": input.message_ulids,
                })),
            ) {
                Ok(data) => to_json(to_stub("group_chat_ack_offline_messages", data)),
                Err(e) => e,
            }
        }
        "group_chat_get_stats" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(Method::GET, "/group-chat/stats", &token, None, None) {
                Ok(data) => to_json(to_stub("group_chat_get_stats", data)),
                Err(e) => e,
            }
        }
        "group_chat_local_search" => {
            let input = match parse_args::<ChatLocalSearchInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.query.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "query is required",
                    None,
                ));
            }
            let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
            match chat_storage::search_group_messages("__default__", &input.query, limit) {
                Ok(items) => to_json(to_stub(
                    "group_chat_local_search",
                    json!({"messages": items}),
                )),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InternalError,
                    "local search failed",
                    Some(json!({"reason": reason})),
                )),
            }
        }
        "group_chat_local_search_scoped" => {
            let input = match parse_args::<ChatLocalSearchInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.query.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "query is required",
                    None,
                ));
            }
            let user_scope = user_scope_from_state(state);
            let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
            match chat_storage::search_group_messages(&user_scope, &input.query, limit) {
                Ok(items) => to_json(to_stub(
                    "group_chat_local_search_scoped",
                    json!({"messages": items}),
                )),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InternalError,
                    "local search failed",
                    Some(json!({"reason": reason})),
                )),
            }
        }
        "group_chat_set_cursor_scoped" => {
            let input = match parse_args::<ChatScopeCursorSetInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let user_scope = user_scope_from_state(state);
            if input.scope.trim().is_empty() || input.cursor.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "scope and cursor are required",
                    None,
                ));
            }
            if let Err(reason) =
                chat_storage::set_scope_cursor(&user_scope, &input.scope, &input.cursor)
            {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InternalError,
                    "set cursor failed",
                    Some(json!({"reason": reason})),
                ));
            }
            to_json(to_stub("group_chat_set_cursor_scoped", json!({"ok": true})))
        }
        "group_chat_get_cursor_scoped" => {
            let input = match parse_args::<ChatScopeCursorGetInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let user_scope = user_scope_from_state(state);
            if input.scope.trim().is_empty() {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "scope is required",
                    None,
                ));
            }
            match chat_storage::get_scope_cursor(&user_scope, &input.scope) {
                Ok(cursor) => to_json(to_stub(
                    "group_chat_get_cursor_scoped",
                    json!({"cursor": cursor}),
                )),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InternalError,
                    "get cursor failed",
                    Some(json!({"reason": reason})),
                )),
            }
        }
        "group_chat_get_key_version_scoped" => {
            let user_scope = user_scope_from_state(state);
            match chat_storage::get_chat_key_version(&user_scope) {
                Ok(v) => to_json(to_stub(
                    "group_chat_get_key_version_scoped",
                    json!({"key_version": v}),
                )),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InternalError,
                    "get key version failed",
                    Some(json!({"reason": reason})),
                )),
            }
        }
        "group_chat_rotate_key_scoped" => {
            let input = match parse_args::<ChatKeyRotateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            if input.next_version <= 0 {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "next_version must be positive",
                    None,
                ));
            }
            let user_scope = user_scope_from_state(state);
            match chat_storage::rotate_chat_key(&user_scope, input.next_version) {
                Ok(v) => to_json(to_stub(
                    "group_chat_rotate_key_scoped",
                    json!({"key_version": v}),
                )),
                Err(reason) => to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InternalError,
                    "rotate key failed",
                    Some(json!({"reason": reason})),
                )),
            }
        }
        "group_chat_sync_from_station_scoped" => dispatch_group_sync_from_station(args, state),

        // =================================================================
        // Notifications (state-dependent, station JSON API)
        // =================================================================
        "notification_list" => {
            let input = match parse_args::<NotificationListInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let mut query: Vec<(&str, String)> = Vec::new();
            if let Some(cat) = input.category {
                query.push(("category", cat.to_string()));
            }
            if let Some(st) = input.status {
                query.push(("status", st.to_string()));
            }
            if let Some(ref c) = input.cursor {
                query.push(("cursor", c.clone()));
            }
            let limit = input.limit.unwrap_or(20);
            query.push(("limit", limit.to_string()));
            match station_request_json(
                Method::GET,
                "/notification/list",
                &token,
                Some(&query),
                None,
            ) {
                Ok(data) => to_json(to_stub("notification_list", data)),
                Err(e) => e,
            }
        }
        "notification_unread_counts" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::GET,
                "/notification/unread-counts",
                &token,
                None,
                None,
            ) {
                Ok(data) => to_json(to_stub("notification_unread_counts", data)),
                Err(e) => e,
            }
        }
        "notification_mark_read" => {
            let input = match parse_args::<NotificationMarkReadInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::POST,
                "/notification/mark-read",
                &token,
                None,
                Some(json!({"notification_ids": input.notification_ids})),
            ) {
                Ok(data) => to_json(to_stub("notification_mark_read", data)),
                Err(e) => e,
            }
        }
        "notification_mark_all_read" => {
            let input = match parse_args::<NotificationMarkAllReadInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::POST,
                "/notification/mark-all-read",
                &token,
                None,
                Some(json!({"category": input.category.unwrap_or(0)})),
            ) {
                Ok(data) => to_json(to_stub("notification_mark_all_read", data)),
                Err(e) => e,
            }
        }
        "notification_delete" => {
            let input = match parse_args::<NotificationDeleteInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::POST,
                "/notification/delete",
                &token,
                None,
                Some(json!({"notification_ids": input.notification_ids})),
            ) {
                Ok(data) => to_json(to_stub("notification_delete", data)),
                Err(e) => e,
            }
        }
        "notification_preferences" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(Method::GET, "/notification/preferences", &token, None, None)
            {
                Ok(data) => to_json(to_stub("notification_preferences", data)),
                Err(e) => e,
            }
        }
        "notification_preferences_update" => {
            let input = match parse_args::<NotificationPreferenceUpdateInput>(args) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match station_request_json(
                Method::POST,
                "/notification/preferences/update",
                &token,
                None,
                Some(json!({
                    "category": input.category,
                    "enabled": input.enabled,
                    "push_enabled": input.push_enabled,
                    "sound_enabled": input.sound_enabled,
                })),
            ) {
                Ok(data) => to_json(to_stub("notification_preferences_update", data)),
                Err(e) => e,
            }
        }
        "frontend_telemetry_upload" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            frontend_telemetry_upload_with_token(&token, args)
        }

        // =================================================================
        // Station registry (dynamic URL picker)
        // =================================================================
        "station_list" => {
            let reg = crate::infrastructure::station_client::station_registry();
            let entries = reg.list();
            let active = reg.active_url();
            let payload = json!({
                "entries": entries,
                "active_url": active,
            });
            to_json(AppResult::success(StubPayload {
                command: "station_list".into(),
                status: serde_json::to_string(&payload).unwrap_or_default(),
            }))
        }
        "station_set_active" => {
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
            if url.is_empty() {
                to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "url is required",
                    None,
                ))
            } else {
                let reg = crate::infrastructure::station_client::station_registry();
                reg.set_active(url);
                let payload = json!({ "active_url": url });
                to_json(AppResult::success(StubPayload {
                    command: "station_set_active".into(),
                    status: serde_json::to_string(&payload).unwrap_or_default(),
                }))
            }
        }
        "station_add" => {
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
            if url.is_empty() {
                to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "url is required",
                    None,
                ))
            } else {
                let (online, label, peer_id, peers_count) =
                    crate::infrastructure::station_client::probe_station(url);
                let now = time::OffsetDateTime::now_utc()
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_else(|_| "unknown".to_string());
                let entry = crate::infrastructure::station_registry::StationEntry {
                    url: url.trim_end_matches('/').to_string(),
                    label: label.clone(),
                    peer_id: peer_id.clone(),
                    peers_count,
                    last_probe: Some(now),
                    online,
                };
                let reg = crate::infrastructure::station_client::station_registry();
                reg.add(entry.clone());
                to_json(AppResult::success(StubPayload {
                    command: "station_add".into(),
                    status: serde_json::to_string(&entry).unwrap_or_default(),
                }))
            }
        }
        "station_remove" => {
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
            if url.is_empty() {
                to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "url is required",
                    None,
                ))
            } else {
                let reg = crate::infrastructure::station_client::station_registry();
                reg.remove(url);
                let payload = json!({ "removed": url });
                to_json(AppResult::success(StubPayload {
                    command: "station_remove".into(),
                    status: serde_json::to_string(&payload).unwrap_or_default(),
                }))
            }
        }
        "station_probe" => {
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
            if url.is_empty() {
                to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::InvalidArgument,
                    "url is required",
                    None,
                ))
            } else {
                let (online, label, peer_id, peers_count) =
                    crate::infrastructure::station_client::probe_station(url);
                let reg = crate::infrastructure::station_client::station_registry();
                reg.update_probe(url, label.clone(), peer_id.clone(), peers_count, online);
                let payload = json!({
                    "url": url,
                    "online": online,
                    "label": label,
                    "peer_id": peer_id,
                    "peers_count": peers_count,
                });
                to_json(AppResult::success(StubPayload {
                    command: "station_probe".into(),
                    status: serde_json::to_string(&payload).unwrap_or_default(),
                }))
            }
        }

        // =================================================================
        // MLS Group (E2E encryption — requires Tauri AppHandle for state)
        // =================================================================
        "mls_init_identity" => {
            let actor_id = match actor_id_from_state(state) {
                Some(id) if !id.trim().is_empty() => id,
                _ => {
                    return to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::Unauthorized,
                        "auth required",
                        None,
                    ))
                }
            };
            let token = match token_from_state(state) {
                Ok(token) => token,
                Err(error) => return error,
            };
            let identity = match station_client::request_proto::<
                (),
                model::chat::GetConversationIdentityResponse,
            >(
                Method::GET,
                "/conversation/identity",
                &token,
                None,
                None::<&()>,
            ) {
                Ok(identity) => identity,
                Err(error) => {
                    return to_json(
                        error.into_app_result::<StubPayload>("resolve authenticated actor PTID"),
                    )
                }
            };
            let app = match runtime.app_handle("mls_init_identity") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let actor_identity =
                app.state::<Arc<crate::domain::actor_device_identity::ActorDeviceIdentity>>();
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            if !identity.ptid.starts_with("ptid:") {
                return to_json(AppResult::<StubPayload>::fail(
                    ErrorCode::Conflict,
                    "authenticated actor has no canonical PTID",
                    None,
                ));
            }
            let scope =
                crate::infrastructure::local_scope::user_scope_for_actor(Some(actor_id.as_str()));
            let device_id = match device_install::get_or_create_device_id(actor_id.as_str()) {
                Ok(device_id) => device_id,
                Err(error) => {
                    return to_json(AppResult::<StubPayload>::fail(
                        ErrorCode::InternalError,
                        format!("device_id: {error}"),
                        None,
                    ))
                }
            };
            crate::infrastructure::station_client::set_device_id(device_id.clone());
            to_json(
                crate::interface::tauri_commands::mls::mls_init_identity_for_scope(
                    crate::interface::tauri_commands::mls::MlsInitIdentityInput {
                        ptid: identity.ptid,
                        device_id,
                    },
                    actor_identity.inner(),
                    mls.inner(),
                    &scope,
                ),
            )
        }
        "mls_submit_leave_intent" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::mls::MlsSubmitLeaveIntentInput,
            >(args)
            {
                Ok(input) => input,
                Err(error) => return error,
            };
            let token = match token_from_state(state) {
                Ok(token) => token,
                Err(error) => return error,
            };
            let app = match runtime.app_handle("mls_submit_leave_intent") {
                Ok(app) => app,
                Err(error) => return error,
            };
            let identity =
                app.state::<Arc<crate::domain::actor_device_identity::ActorDeviceIdentity>>();
            to_json(
                crate::interface::tauri_commands::mls::mls_submit_leave_intent_with_token(
                    input,
                    identity.inner(),
                    &token,
                ),
            )
        }
        "conversation_submit_command_proposal" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::conversation::ConversationSubmitCommandProposalInput,
            >(args)
            {
                Ok(input) => input,
                Err(error) => return error,
            };
            let token = match token_from_state(state) {
                Ok(token) => token,
                Err(error) => return error,
            };
            let app = match runtime.app_handle("conversation_submit_command_proposal") {
                Ok(app) => app,
                Err(error) => return error,
            };
            let identity =
                app.state::<Arc<crate::domain::actor_device_identity::ActorDeviceIdentity>>();
            to_json(
                crate::interface::tauri_commands::conversation::conversation_submit_command_proposal_with_token(
                    input,
                    identity.inner(),
                    &token,
                ),
            )
        }
        "conversation_get_command_proposal_result" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::conversation::ConversationGetCommandProposalResultInput,
            >(args)
            {
                Ok(input) => input,
                Err(error) => return error,
            };
            let token = match token_from_state(state) {
                Ok(token) => token,
                Err(error) => return error,
            };
            to_json(
                crate::interface::tauri_commands::conversation::conversation_get_command_proposal_result_with_token(
                    input,
                    &token,
                ),
            )
        }
        "mls_list_leave_intents" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::mls::MlsListLeaveIntentsInput,
            >(args)
            {
                Ok(input) => input,
                Err(error) => return error,
            };
            let token = match token_from_state(state) {
                Ok(token) => token,
                Err(error) => return error,
            };
            to_json(
                crate::interface::tauri_commands::mls::mls_list_leave_intents_with_token(
                    input, &token,
                ),
            )
        }
        "mls_generate_key_package" => {
            let app = match runtime.app_handle("mls_generate_key_package") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            let actor = match resolve_scope(state) {
                Ok(actor) => actor,
                Err(e) => return e,
            };
            let scope = crate::infrastructure::local_scope::user_scope_for_actor(actor.as_deref());
            to_json(
                crate::interface::tauri_commands::mls::mls_generate_key_package_for_scope(
                    mls.inner(),
                    &scope,
                ),
            )
        }
        "mls_group_create" => {
            let input = match parse_args::<crate::interface::tauri_commands::mls::MlsGroupCreateInput>(
                args,
            ) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_group_create") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            match mls.create_group(&input.conversation_id, &input.members) {
                Ok(result) => {
                    let actor = match resolve_scope(state) {
                        Ok(actor) => actor,
                        Err(e) => return e,
                    };
                    let scope =
                        crate::infrastructure::local_scope::user_scope_for_actor(actor.as_deref());
                    let blob = match mls.export_pending_transition(&input.conversation_id) {
                        Ok(blob) => blob,
                        Err(e) => {
                            return to_json(AppResult::<Value>::fail(
                                ErrorCode::InternalError,
                                &e,
                                None,
                            ))
                        }
                    };
                    match crate::infrastructure::local_chat_store::crypto_save_mls_pending_transition(
                        &scope,
                        &input.conversation_id,
                        &result.transition_id,
                        &blob,
                    ) {
                        Ok(()) => to_json(AppResult::success(json!(result))),
                        Err(e) => {
                            mls.discard_pending_transition(&input.conversation_id);
                            to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None))
                        }
                    }
                }
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "mls_group_join" => {
            let input = match parse_args::<crate::interface::tauri_commands::mls::MlsGroupJoinInput>(
                args,
            ) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_group_join") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            let actor = match resolve_scope(state) {
                Ok(actor) => actor,
                Err(e) => return e,
            };
            let scope = crate::infrastructure::local_scope::user_scope_for_actor(actor.as_deref());
            to_json(
                crate::interface::tauri_commands::mls::mls_group_join_for_scope(
                    input,
                    mls.inner(),
                    &scope,
                ),
            )
        }
        "mls_group_encrypt" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::mls::MlsGroupEncryptInput,
            >(args)
            {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_group_encrypt") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            let actor = match resolve_scope(state) {
                Ok(actor) => actor,
                Err(e) => return e,
            };
            let scope = crate::infrastructure::local_scope::user_scope_for_actor(actor.as_deref());
            to_json(
                crate::interface::tauri_commands::mls::mls_group_encrypt_for_scope(
                    input,
                    mls.inner(),
                    &scope,
                ),
            )
        }
        "mls_group_decrypt" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::mls::MlsGroupDecryptInput,
            >(args)
            {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_group_decrypt") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            match mls.decrypt(&input.conversation_id, &input.ciphertext) {
                Ok(plaintext) => to_json(AppResult::success(json!({ "plaintext": plaintext }))),
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "mls_group_process_commit" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::mls::MlsGroupProcessCommitInput,
            >(args)
            {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_group_process_commit") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            match mls.process_commit(&input.conversation_id, &input.commit_bytes) {
                Ok(()) => to_json(AppResult::success(json!({}))),
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "mls_group_add_member" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::mls::MlsGroupAddMemberInput,
            >(args)
            {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_group_add_member") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            match mls.add_member(&input.conversation_id, &input.member) {
                Ok(prepared) => {
                    let actor = match resolve_scope(state) {
                        Ok(actor) => actor,
                        Err(e) => return e,
                    };
                    let scope =
                        crate::infrastructure::local_scope::user_scope_for_actor(actor.as_deref());
                    let blob = match mls.export_pending_transition(&input.conversation_id) {
                        Ok(blob) => blob,
                        Err(e) => {
                            return to_json(AppResult::<Value>::fail(
                                ErrorCode::InternalError,
                                &e,
                                None,
                            ))
                        }
                    };
                    match crate::infrastructure::local_chat_store::crypto_save_mls_pending_transition(
                        &scope, &input.conversation_id, &prepared.transition_id, &blob,
                    ) {
                        Ok(()) => to_json(AppResult::success(json!(prepared))),
                        Err(e) => {
                            mls.discard_pending_transition(&input.conversation_id);
                            to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None))
                        }
                    }
                }
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "mls_group_remove_member" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::mls::MlsGroupRemoveMemberInput,
            >(args)
            {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_group_remove_member") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            match mls.remove_member(&input.conversation_id, &input.member_ptid) {
                Ok(prepared) => {
                    let actor = match resolve_scope(state) {
                        Ok(actor) => actor,
                        Err(e) => return e,
                    };
                    let scope =
                        crate::infrastructure::local_scope::user_scope_for_actor(actor.as_deref());
                    let blob = match mls.export_pending_transition(&input.conversation_id) {
                        Ok(blob) => blob,
                        Err(e) => {
                            return to_json(AppResult::<Value>::fail(
                                ErrorCode::InternalError,
                                &e,
                                None,
                            ))
                        }
                    };
                    match crate::infrastructure::local_chat_store::crypto_save_mls_pending_transition(
                        &scope, &input.conversation_id, &prepared.transition_id, &blob,
                    ) {
                        Ok(()) => to_json(AppResult::success(json!(prepared))),
                        Err(e) => {
                            mls.discard_pending_transition(&input.conversation_id);
                            to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None))
                        }
                    }
                }
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "mls_group_remove_device" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::mls::MlsGroupRemoveDeviceInput,
            >(args)
            {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_group_remove_device") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            match mls.remove_device(&input.conversation_id, &input.member_ptid, &input.device_id) {
                Ok(prepared) => {
                    let actor = match resolve_scope(state) {
                        Ok(actor) => actor,
                        Err(e) => return e,
                    };
                    let scope =
                        crate::infrastructure::local_scope::user_scope_for_actor(actor.as_deref());
                    let blob = match mls.export_pending_transition(&input.conversation_id) {
                        Ok(blob) => blob,
                        Err(e) => {
                            return to_json(AppResult::<Value>::fail(
                                ErrorCode::InternalError,
                                &e,
                                None,
                            ))
                        }
                    };
                    match crate::infrastructure::local_chat_store::crypto_save_mls_pending_transition(
                        &scope, &input.conversation_id, &prepared.transition_id, &blob,
                    ) {
                        Ok(()) => to_json(AppResult::success(json!(prepared))),
                        Err(e) => {
                            mls.discard_pending_transition(&input.conversation_id);
                            to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None))
                        }
                    }
                }
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "mls_group_accept_pending" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::mls::MlsPendingTransitionInput,
            >(args)
            {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_group_accept_pending") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            let actor = match resolve_scope(state) {
                Ok(actor) => actor,
                Err(e) => return e,
            };
            let scope = crate::infrastructure::local_scope::user_scope_for_actor(actor.as_deref());
            to_json(
                crate::interface::tauri_commands::mls::mls_group_accept_pending_for_scope(
                    input,
                    mls.inner(),
                    &scope,
                ),
            )
        }
        "mls_group_discard_pending" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::mls::MlsPendingTransitionInput,
            >(args)
            {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_group_discard_pending") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            let actor = match resolve_scope(state) {
                Ok(actor) => actor,
                Err(e) => return e,
            };
            let scope = crate::infrastructure::local_scope::user_scope_for_actor(actor.as_deref());
            if let Err(e) =
                crate::infrastructure::local_chat_store::crypto_delete_mls_pending_transition(
                    &scope,
                    &input.conversation_id,
                )
            {
                return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None));
            }
            to_json(AppResult::success(json!({
                "discarded": mls.discard_pending_transition(&input.conversation_id),
            })))
        }
        "mls_group_pending_status" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::mls::MlsPendingTransitionInput,
            >(args)
            {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_group_pending_status") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            to_json(AppResult::success(json!({
                "pending": mls.has_pending_transition(&input.conversation_id),
            })))
        }
        "mls_recipient_record_authority_event" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::mls::MlsRecipientAuthorityEventInput,
            >(args)
            {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_recipient_record_authority_event") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            let actor = match resolve_scope(state) {
                Ok(actor) => actor,
                Err(e) => return e,
            };
            let Some(actor_id) = actor.filter(|value| !value.trim().is_empty()) else {
                return to_json(AppResult::<Value>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                ));
            };
            let scope =
                crate::infrastructure::local_scope::user_scope_for_actor(Some(actor_id.as_str()));
            let recipient_ptid =
                match crate::interface::tauri_commands::mls::canonical_mls_identity_ptid(&scope) {
                    Ok(ptid) => ptid,
                    Err(error) => {
                        return to_json(AppResult::<Value>::fail(ErrorCode::Conflict, &error, None))
                    }
                };
            to_json(
                crate::interface::tauri_commands::mls::mls_recipient_record_authority_event_for_scope(
                    input,
                    mls.inner(),
                    &scope,
                    &recipient_ptid,
                ),
            )
        }
        "mls_recipient_apply_delivery" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::mls::MlsRecipientDeliveryInput,
            >(args)
            {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_recipient_apply_delivery") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            let actor = match resolve_scope(state) {
                Ok(actor) => actor,
                Err(e) => return e,
            };
            let Some(actor_id) = actor.filter(|value| !value.trim().is_empty()) else {
                return to_json(AppResult::<Value>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                ));
            };
            let scope =
                crate::infrastructure::local_scope::user_scope_for_actor(Some(actor_id.as_str()));
            let recipient_ptid =
                match crate::interface::tauri_commands::mls::canonical_mls_identity_ptid(&scope) {
                    Ok(ptid) => ptid,
                    Err(error) => {
                        return to_json(AppResult::<Value>::fail(ErrorCode::Conflict, &error, None))
                    }
                };
            to_json(
                crate::interface::tauri_commands::mls::mls_recipient_apply_delivery_for_scope(
                    input,
                    mls.inner(),
                    &scope,
                    &recipient_ptid,
                ),
            )
        }
        "mls_recipient_status" => {
            let input = match parse_args::<
                crate::interface::tauri_commands::mls::MlsRecipientStatusInput,
            >(args)
            {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_recipient_status") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            let actor = match resolve_scope(state) {
                Ok(actor) => actor,
                Err(e) => return e,
            };
            let Some(recipient_ptid) = actor.filter(|value| !value.trim().is_empty()) else {
                return to_json(AppResult::<Value>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                ));
            };
            let scope = crate::infrastructure::local_scope::user_scope_for_actor(Some(
                recipient_ptid.as_str(),
            ));
            to_json(
                crate::interface::tauri_commands::mls::mls_recipient_status_for_scope(
                    input,
                    mls.inner(),
                    &scope,
                ),
            )
        }
        "mls_group_public_head" => {
            let input = match parse_args::<crate::interface::tauri_commands::mls::MlsGroupStatusInput>(
                args,
            ) {
                Ok(input) => input,
                Err(error) => return error,
            };
            let app = match runtime.app_handle("mls_group_public_head") {
                Ok(app) => app,
                Err(error) => return error,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            match mls.public_head(&input.conversation_id) {
                Ok(head) => to_json(AppResult::success(json!(head))),
                Err(error) => to_json(AppResult::<Value>::fail(ErrorCode::NotFound, error, None)),
            }
        }
        "mls_group_save" => {
            let input = match parse_args::<crate::interface::tauri_commands::mls::MlsGroupSaveInput>(
                args,
            ) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_group_save") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            let user_scope = user_scope_from_state(state);
            to_json(
                crate::interface::tauri_commands::mls::mls_group_save_for_scope(
                    input,
                    mls.inner(),
                    &user_scope,
                ),
            )
        }
        "mls_group_load" => {
            let input = match parse_args::<crate::interface::tauri_commands::mls::MlsGroupLoadInput>(
                args,
            ) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let app = match runtime.app_handle("mls_group_load") {
                Ok(a) => a,
                Err(e) => return e,
            };
            let mls = app.state::<Arc<crate::domain::mls_group::MlsGroupManager>>();
            let user_scope = user_scope_from_state(state);
            to_json(
                crate::interface::tauri_commands::mls::mls_group_load_for_scope(
                    input,
                    mls.inner(),
                    &user_scope,
                ),
            )
        }

        // =================================================================
        // Envelope submit (send encrypted payload to Station)
        // =================================================================
        "envelope_submit" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let envelope = args.get("envelope").cloned().unwrap_or(json!({}));
            let env_obj = envelope.as_object();
            let body = json!({
                "envelope": {
                    "conversation_id": env_obj.and_then(|o| o.get("conversation_id")).and_then(|v| v.as_str()).unwrap_or(""),
                    "sender_ptid": env_obj.and_then(|o| o.get("sender_ptid")).and_then(|v| v.as_str()).unwrap_or(""),
                    "sender_device_id": env_obj.and_then(|o| o.get("sender_device_id")).and_then(|v| v.as_str()).unwrap_or(""),
                    "recipient_ptid": env_obj.and_then(|o| o.get("recipient_ptid")).and_then(|v| v.as_str()).unwrap_or(""),
                    "payload_type": env_obj.and_then(|o| o.get("payload_type")).and_then(|v| v.as_i64()).unwrap_or(1),
                    "payload_bytes": env_obj.and_then(|o| o.get("payload_bytes")),
                    "idempotency_key": env_obj.and_then(|o| o.get("idempotency_key")).and_then(|v| v.as_str()).unwrap_or(""),
                }
            });
            match crate::infrastructure::station_client::request_json_auth(
                reqwest::Method::POST,
                "/envelope/submit",
                &token,
                None,
                Some(&body),
            ) {
                Ok(resp) => to_json(AppResult::success(resp)),
                Err(e) => to_json(AppResult::<Value>::fail(
                    ErrorCode::InternalError,
                    &format!("envelope submit: {e}"),
                    None,
                )),
            }
        }
        "envelope_ack" => proxy_authenticated_station_json(
            state,
            reqwest::Method::POST,
            "/envelope/ack",
            None,
            Some(json!({
                "device_id": args.get("device_id").and_then(|v| v.as_str()).unwrap_or(""),
                "inbox_item_id": args.get("inbox_item_id").and_then(|v| v.as_str()).unwrap_or(""),
            })),
            "envelope ack",
        ),
        "envelope_resume" => proxy_authenticated_station_json(
            state,
            reqwest::Method::GET,
            "/envelope/resume",
            Some(vec![
                (
                    "device_id",
                    args.get("device_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                ),
                (
                    "after_cursor",
                    args.get("after_cursor")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                ),
            ]),
            None,
            "envelope resume",
        ),
        "keypackage_upload" => proxy_authenticated_station_json(
            state,
            reqwest::Method::POST,
            "/keypackage/upload",
            None,
            Some(json!({
                "device_id": args.get("device_id").and_then(|v| v.as_str()).unwrap_or(""),
                "data": args.get("data").and_then(|v| v.as_str()).unwrap_or(""),
            })),
            "key package upload",
        ),
        "keypackage_fetch" => proxy_authenticated_station_json(
            state,
            reqwest::Method::POST,
            "/keypackage/fetch",
            None,
            Some(json!({
                "ptid": args.get("ptid").and_then(|v| v.as_str()).unwrap_or(""),
                "home_station_peer_id": args.get("home_station_peer_id").and_then(|v| v.as_str()).unwrap_or(""),
            })),
            "key package fetch",
        ),
        "keypackage_count" => proxy_authenticated_station_json(
            state,
            reqwest::Method::GET,
            "/keypackage/count",
            None,
            None,
            "key package count",
        ),
        "device_register" => proxy_authenticated_station_json(
            state,
            reqwest::Method::POST,
            "/device/register",
            None,
            Some(json!({
                "device_id": args.get("device_id").and_then(|v| v.as_str()).unwrap_or(""),
                "label": args.get("label").and_then(|v| v.as_str()).unwrap_or(""),
                "public_key": args.get("public_key").and_then(|v| v.as_str()).unwrap_or(""),
                "signing_key_id": args.get("signing_key_id").and_then(|v| v.as_str()).unwrap_or(""),
                "profile_version": 1,
            })),
            "device register",
        ),
        "device_list" => proxy_authenticated_station_json(
            state,
            reqwest::Method::GET,
            "/device/list",
            None,
            None,
            "device list",
        ),
        "device_revoke" => proxy_authenticated_station_json(
            state,
            reqwest::Method::POST,
            "/device/revoke",
            None,
            Some(json!({
                "device_id": args.get("device_id").and_then(|v| v.as_str()).unwrap_or(""),
            })),
            "device revoke",
        ),
        "dkx_send" => proxy_authenticated_station_json(
            state,
            reqwest::Method::POST,
            "/dkx/send",
            None,
            Some(json!({
                "recipient_ptid": args.get("recipient_ptid").and_then(|v| v.as_str()).unwrap_or(""),
                "recipient_station_peer_id": args.get("recipient_station_peer_id").and_then(|v| v.as_str()).unwrap_or(""),
                "session_id": args.get("session_id").and_then(|v| v.as_str()).unwrap_or(""),
                "kind": args.get("kind").and_then(|v| v.as_i64()).unwrap_or(0),
                "opaque_key_material": args.get("opaque_key_material").and_then(|v| v.as_str()).unwrap_or(""),
            })),
            "direct key exchange send",
        ),

        // =================================================================
        // Conversation (unified IM layer — station proxy)
        // =================================================================
        "conversation_create_direct" => proxy_authenticated_station_json(
            state,
            reqwest::Method::POST,
            "/conversation/direct",
            None,
            Some(json!({
                "peer_ptid": args.get("peer_ptid").and_then(|v| v.as_str()).unwrap_or(""),
                "peer_station_peer_id": args.get("peer_station_peer_id").and_then(|v| v.as_str()).unwrap_or(""),
            })),
            "conversation create direct",
        ),
        "conversation_create_group" => proxy_authenticated_station_json(
            state,
            reqwest::Method::POST,
            "/conversation/group",
            None,
            Some(json!({
                "name": args.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                "genesis_transition": args.get("genesis_transition").cloned().unwrap_or_else(|| json!({})),
                "federation_id": args.get("federation_id").and_then(|v| v.as_str()).unwrap_or(""),
                "conversation_id": args.get("conversation_id").and_then(|v| v.as_str()).unwrap_or(""),
            })),
            "conversation create group",
        ),
        "conversation_list" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            match crate::infrastructure::station_client::request_json_auth(
                reqwest::Method::GET,
                "/conversation/list",
                &token,
                None,
                None,
            ) {
                Ok(resp) => to_json(AppResult::success(resp)),
                Err(e) => to_json(AppResult::<Value>::fail(
                    ErrorCode::InternalError,
                    &format!("conversation list: {e}"),
                    None,
                )),
            }
        }
        "conversation_submit_receipt" => proxy_authenticated_station_json(
            state,
            reqwest::Method::POST,
            "/conversation/receipt",
            None,
            Some(json!({
                "conversation_id": args.get("conversation_id").and_then(|v| v.as_str()).unwrap_or(""),
                "message_id": args.get("message_id").and_then(|v| v.as_str()).unwrap_or(""),
                "device_id": args.get("device_id").and_then(|v| v.as_str()).unwrap_or(""),
                "receipt_type": args.get("receipt_type").and_then(|v| v.as_i64()).unwrap_or(0),
            })),
            "conversation submit receipt",
        ),
        "conversation_list_events" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let conv_id = args
                .get("conversation_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let after_seq = args
                .get("after_seq")
                .and_then(|v| v.as_i64())
                .unwrap_or(0)
                .to_string();
            let limit = args
                .get("limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(50)
                .to_string();
            let query = vec![
                ("conversation_id", conv_id.to_string()),
                ("after_seq", after_seq),
                ("limit", limit),
            ];
            match crate::infrastructure::station_client::request_json_auth(
                reqwest::Method::GET,
                "/conversation/events",
                &token,
                Some(&query),
                None,
            ) {
                Ok(resp) => to_json(AppResult::success(resp)),
                Err(e) => to_json(AppResult::<Value>::fail(
                    ErrorCode::InternalError,
                    &format!("conversation events: {e}"),
                    None,
                )),
            }
        }
        "conversation_list_messages" | "conversation_sync_from_station" => {
            let conversation_id = args
                .get("conversation_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let after_seq = if cmd == "conversation_sync_from_station" {
                0
            } else {
                args.get("after_seq").and_then(|v| v.as_i64()).unwrap_or(0)
            };
            let default_limit = if cmd == "conversation_sync_from_station" {
                200
            } else {
                50
            };
            let limit = args
                .get("limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(default_limit);
            proxy_authenticated_station_json(
                state,
                reqwest::Method::GET,
                "/conversation/messages",
                Some(vec![
                    ("conversation_id", conversation_id),
                    ("after_seq", after_seq.to_string()),
                    ("limit", limit.to_string()),
                ]),
                None,
                "conversation list messages",
            )
        }
        "conversation_list_thread_messages" => proxy_authenticated_station_json(
            state,
            reqwest::Method::GET,
            "/conversation/thread/messages",
            Some(vec![
                (
                    "conversation_id",
                    args.get("conversation_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                ),
                (
                    "root_id",
                    args.get("root_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                ),
                (
                    "after_seq",
                    args.get("after_seq")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0)
                        .to_string(),
                ),
                (
                    "limit",
                    args.get("limit")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(50)
                        .to_string(),
                ),
            ]),
            None,
            "conversation list thread messages",
        ),
        "conversation_thread_counts" => proxy_authenticated_station_json(
            state,
            reqwest::Method::POST,
            "/conversation/thread/counts",
            None,
            Some(json!({
                "conversation_id": args.get("conversation_id").and_then(|v| v.as_str()).unwrap_or(""),
                "root_ids": args.get("root_ids").cloned().unwrap_or_else(|| json!([])),
            })),
            "conversation thread counts",
        ),
        "conversation_get_member_settings" => proxy_authenticated_station_json(
            state,
            reqwest::Method::GET,
            "/conversation/member/settings",
            Some(vec![(
                "conversation_id",
                args.get("conversation_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            )]),
            None,
            "conversation get member settings",
        ),
        "conversation_update_member_settings" => proxy_authenticated_station_json(
            state,
            reqwest::Method::PUT,
            "/conversation/member/settings",
            None,
            Some(json!({
                "conversation_id": args.get("conversation_id").and_then(|v| v.as_str()).unwrap_or(""),
                "nickname": args.get("nickname").cloned().unwrap_or(Value::Null),
                "muted": args.get("muted").cloned().unwrap_or(Value::Null),
                "alertEnabled": args.get("alert_enabled").cloned().unwrap_or(Value::Null),
                "pinned": args.get("pinned").cloned().unwrap_or(Value::Null),
                "background": args.get("background").cloned().unwrap_or(Value::Null),
                "backgroundImage": args.get("background_image").cloned().unwrap_or(Value::Null),
                "clearedAtUnixMs": args.get("cleared_at_unix_ms").cloned().unwrap_or(Value::Null),
            })),
            "conversation update member settings",
        ),
        "conversation_get_members" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let conv_id = args
                .get("conversation_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let query = vec![("conversation_id", conv_id.to_string())];
            match crate::infrastructure::station_client::request_json_auth(
                reqwest::Method::GET,
                "/conversation/members",
                &token,
                Some(&query),
                None,
            ) {
                Ok(resp) => to_json(AppResult::success(resp)),
                Err(e) => to_json(AppResult::<Value>::fail(
                    ErrorCode::InternalError,
                    &format!("conversation members: {e}"),
                    None,
                )),
            }
        }
        "conversation_submit_command" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let command = args.get("command").cloned().unwrap_or(json!({}));
            let body = json!({ "command": command });
            match crate::infrastructure::station_client::request_json_auth(
                reqwest::Method::POST,
                "/conversation/command",
                &token,
                None,
                Some(&body),
            ) {
                Ok(resp) => to_json(AppResult::success(resp)),
                Err(e) => to_json(AppResult::<Value>::fail(
                    ErrorCode::InternalError,
                    &format!("conversation command: {e}"),
                    None,
                )),
            }
        }
        "messaging_send_message" => {
            let guard = state.session.lock().map_err(|_| ()).ok();
            let actor_id = guard.as_ref().and_then(|g| g.actor_id.clone()).unwrap_or_default();
            let token = guard.as_ref().and_then(|g| g.token.clone()).unwrap_or_default();
            let account_id = guard.as_ref().and_then(|g| g.account_id.clone())
                .unwrap_or_else(|| crate::infrastructure::local_scope::account_id_for_password_actor(&actor_id));
            drop(guard);
            if actor_id.is_empty() || token.is_empty() {
                return to_json(AppResult::<Value>::fail(ErrorCode::Unauthorized, "authentication required", None));
            }
            let engine = match state.messaging_engines.get(&account_id) {
                Ok(Some(e)) => e,
                _ => return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, "messaging engine not active", None)),
            };
            let conversation_id = args.get("conversation_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let conversation_kind_str = args.get("conversation_kind").and_then(|v| v.as_str()).unwrap_or("direct");
            let conversation_kind = match conversation_kind_str {
                "group" => crate::model::chat::ConversationKind::Group,
                _ => crate::model::chat::ConversationKind::Direct,
            };
            let plaintext = args.get("plaintext").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let reply_to_message_id = args.get("reply_to_message_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let thread_root_message_id = args.get("thread_root_message_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if conversation_id.is_empty() || plaintext.is_empty() {
                return to_json(AppResult::<Value>::fail(ErrorCode::InvalidArgument, "conversation_id and plaintext required", None));
            }
            match engine.submit_message(
                &token,
                &conversation_id,
                conversation_kind,
                &plaintext,
                &reply_to_message_id,
                &thread_root_message_id,
                &[],
            ) {
                Ok(outcome) => {
                    let _ = state.messaging_engines.wake_profile(&account_id);
                    to_json(AppResult::success(json!({
                        "command_id": outcome.command_id.unwrap_or_default(),
                        "message_id": outcome.message_id,
                        "attachment_ids": outcome.attachment_ids,
                        "state": outcome.state,
                    })))
                }
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "messaging_list_messages" => {
            let guard = state.session.lock().map_err(|_| ()).ok();
            let actor_id = guard.as_ref().and_then(|g| g.actor_id.clone()).unwrap_or_default();
            let account_id = guard.as_ref().and_then(|g| g.account_id.clone())
                .unwrap_or_else(|| crate::infrastructure::local_scope::account_id_for_password_actor(&actor_id));
            drop(guard);
            if actor_id.is_empty() {
                return to_json(AppResult::<Value>::fail(ErrorCode::Unauthorized, "authentication required", None));
            }
            let engine = match state.messaging_engines.get(&account_id) {
                Ok(Some(e)) => e,
                _ => return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, "messaging engine not active", None)),
            };
            let conversation_id = args.get("conversation_id").and_then(|v| v.as_str()).unwrap_or("");
            match engine.conversation_messages(conversation_id) {
                Ok(messages) => {
                    let items: Vec<Value> = messages.iter().map(|m| json!({
                        "event_id": m.event_id,
                        "event_sequence": m.event_sequence,
                        "message_id": m.message_id,
                        "sender_ptid": m.sender_ptid,
                        "sender_device_id": m.sender_device_id,
                        "plaintext": m.plaintext,
                        "attachments": m
                            .attachments
                            .iter()
                            .map(|attachment| {
                                let object = attachment.object.as_ref();
                                json!({
                                    "attachment_id": attachment.attachment_id,
                                    "filename": attachment.filename,
                                    "mime_type": attachment.mime_type,
                                    "plaintext_size": attachment.plaintext_size,
                                    "object_id": object
                                        .map(|value| value.object_id.as_str())
                                        .unwrap_or_default(),
                                    "storage_ref": object
                                        .map(|value| value.storage_ref.as_str())
                                        .unwrap_or_default(),
                                    "ciphertext_size": object
                                        .map(|value| value.ciphertext_size)
                                        .unwrap_or_default(),
                                    "availability_state": if object.is_some() {
                                        "remote"
                                    } else {
                                        "uploading"
                                    },
                                })
                            })
                            .collect::<Vec<_>>(),
                        "state": m.state,
                        "timestamp_unix_ms": m.timestamp_unix_ms,
                        "reply_to_message_id": m.reply_to_message_id,
                        "thread_root_message_id": m.thread_root_message_id,
                        "edited_text": m.edited_text,
                        "edited_at_unix_ms": m.edited_at_unix_ms,
                        "retracted": m.retracted,
                        "reactions": m
                            .reactions
                            .iter()
                            .map(|(actor_ptid, reaction, created_at_unix_ms)| {
                                json!({
                                    "actor_ptid": actor_ptid,
                                    "reaction": reaction,
                                    "created_at_unix_ms": created_at_unix_ms,
                                })
                            })
                            .collect::<Vec<_>>(),
                        "pinned_by_ptid": m.pinned_by_ptid,
                        "pinned_at_unix_ms": m.pinned_at_unix_ms,
                        "read_by_ptids": m.read_by_ptids,
                    })).collect();
                    let mut payload = json!({ "messages": items });
                    // #region debug-point B,F:http-gateway-messaging-runtime-context
                    #[cfg(feature = "acceptance-webdriver")]
                    if let Some(object) = payload.as_object_mut() {
                        object.insert(
                            "debug_context".to_string(),
                            json!({
                                "account_id": account_id,
                                "engine_profile_id": engine.profile_id(),
                                "session_kind": "legacy-process-global",
                            }),
                        );
                    }
                    // #endregion
                    to_json(AppResult::success(payload))
                }
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "messaging_open_attachment" => {
            let guard = state.session.lock().map_err(|_| ()).ok();
            let actor_id = guard
                .as_ref()
                .and_then(|g| g.actor_id.clone())
                .unwrap_or_default();
            let token = guard
                .as_ref()
                .and_then(|g| g.token.clone())
                .unwrap_or_default();
            let account_id = guard
                .as_ref()
                .and_then(|g| g.account_id.clone())
                .unwrap_or_else(|| {
                    crate::infrastructure::local_scope::account_id_for_password_actor(&actor_id)
                });
            drop(guard);
            if actor_id.is_empty() || token.is_empty() {
                return to_json(AppResult::<Value>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                ));
            }
            let engine = match state.messaging_engines.get(&account_id) {
                Ok(Some(e)) => e,
                _ => {
                    return to_json(AppResult::<Value>::fail(
                        ErrorCode::InternalError,
                        "messaging engine not active",
                        None,
                    ))
                }
            };
            let attachment_id = args
                .get("attachment_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if attachment_id.is_empty() {
                return to_json(AppResult::<Value>::fail(
                    ErrorCode::InvalidArgument,
                    "attachment_id required",
                    None,
                ));
            }
            match engine.open_attachment(&token, attachment_id) {
                Ok(local_path) => to_json(AppResult::success(json!({ "local_path": local_path }))),
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "messaging_drain" => {
            let guard = state.session.lock().map_err(|_| ()).ok();
            let actor_id = guard.as_ref().and_then(|g| g.actor_id.clone()).unwrap_or_default();
            let token = guard.as_ref().and_then(|g| g.token.clone()).unwrap_or_default();
            let account_id = guard.as_ref().and_then(|g| g.account_id.clone())
                .unwrap_or_else(|| crate::infrastructure::local_scope::account_id_for_password_actor(&actor_id));
            drop(guard);
            if actor_id.is_empty() || token.is_empty() {
                return to_json(AppResult::<Value>::fail(ErrorCode::Unauthorized, "authentication required", None));
            }
            let engine = match state.messaging_engines.get(&account_id) {
                Ok(Some(e)) => e,
                _ => return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, "messaging engine not active", None)),
            };
            let batch_limit = args.get("batch_limit").and_then(|v| v.as_u64()).unwrap_or(100) as u32;
            match engine.drain_once(&token, batch_limit) {
                Ok(progress) => to_json(AppResult::success(json!({
                    "processed": progress.processed,
                    "cursor": progress.cursor,
                    "lane_head": progress.lane_head,
                }))),
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "messaging_dispatch" => {
            let guard = state.session.lock().map_err(|_| ()).ok();
            let actor_id = guard.as_ref().and_then(|g| g.actor_id.clone()).unwrap_or_default();
            let token = guard.as_ref().and_then(|g| g.token.clone()).unwrap_or_default();
            let account_id = guard.as_ref().and_then(|g| g.account_id.clone())
                .unwrap_or_else(|| crate::infrastructure::local_scope::account_id_for_password_actor(&actor_id));
            drop(guard);
            if actor_id.is_empty() || token.is_empty() {
                return to_json(AppResult::<Value>::fail(ErrorCode::Unauthorized, "authentication required", None));
            }
            let engine = match state.messaging_engines.get(&account_id) {
                Ok(Some(e)) => e,
                _ => return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, "messaging engine not active", None)),
            };
            let now_unix_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            let retry_policy = crate::messaging::CommandRetryPolicy {
                initial_delay_ms: 1000,
                maximum_delay_ms: 30000,
            };
            match engine.dispatch_command_once(&token, now_unix_ms, retry_policy) {
                Ok(progress) => to_json(AppResult::success(json!({
                    "progress": format!("{:?}", progress),
                }))),
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        #[cfg(feature = "acceptance-webdriver")]
        "messaging_acceptance_interaction_snapshot" => {
            let guard = state.session.lock().map_err(|_| ()).ok();
            let actor_id = guard
                .as_ref()
                .and_then(|session| session.actor_id.clone())
                .unwrap_or_default();
            let account_id = guard
                .as_ref()
                .and_then(|session| session.account_id.clone())
                .unwrap_or_else(|| {
                    crate::infrastructure::local_scope::account_id_for_password_actor(&actor_id)
                });
            drop(guard);
            if actor_id.is_empty() {
                return to_json(AppResult::<Value>::fail(
                    ErrorCode::Unauthorized,
                    "authentication required",
                    None,
                ));
            }
            let engine = match state.messaging_engines.get(&account_id) {
                Ok(Some(engine)) => engine,
                _ => {
                    return to_json(AppResult::<Value>::fail(
                        ErrorCode::InternalError,
                        "messaging engine not active",
                        None,
                    ))
                }
            };
            let conversation_id = args
                .get("conversation_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let message_id = args
                .get("message_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let command_id = args
                .get("command_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            match engine.acceptance_interaction_snapshot(
                conversation_id,
                message_id,
                command_id,
            ) {
                Ok(snapshot) => to_json(AppResult::success(snapshot)),
                Err(error) => to_json(AppResult::<Value>::fail(
                    ErrorCode::InternalError,
                    error,
                    None,
                )),
            }
        }
        "messaging_debug" => {
            let guard = state.session.lock().map_err(|_| ()).ok();
            let actor_id = guard.as_ref().and_then(|g| g.actor_id.clone()).unwrap_or_default();
            let token = guard.as_ref().and_then(|g| g.token.clone()).unwrap_or_default();
            let account_id = guard.as_ref().and_then(|g| g.account_id.clone())
                .unwrap_or_else(|| crate::infrastructure::local_scope::account_id_for_password_actor(&actor_id));
            drop(guard);
            if actor_id.is_empty() || token.is_empty() {
                return to_json(AppResult::<Value>::fail(ErrorCode::Unauthorized, "authentication required", None));
            }
            let engine = match state.messaging_engines.get(&account_id) {
                Ok(Some(e)) => e,
                _ => return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, "messaging engine not active", None)),
            };
            let conversation_id = args.get("conversation_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let mut results = serde_json::Map::new();
            results.insert("endpoint_ptid".into(), json!(engine.endpoint().ptid));
            results.insert("endpoint_device_id".into(), json!(engine.endpoint().device_id));
            results.insert("profile_id".into(), json!(engine.profile_id()));
            let enroll_result = engine.enroll_pending_device(&token, "Desktop".to_string());
            results.insert("enroll_pending_device".into(), json!(format!("{:?}", enroll_result)));
            let prekey_result = engine.publish_prekeys(&token);
            results.insert("publish_prekeys".into(), json!(format!("{:?}", prekey_result)));
            let mls_key_package_result = engine.publish_mls_key_packages(&token);
            results.insert(
                "publish_mls_key_packages".into(),
                json!(format!("{:?}", mls_key_package_result)),
            );
            if !conversation_id.is_empty() {
                let plan_result = engine.prepare_send_plan(&token, &conversation_id);
                results.insert("prepare_send_plan".into(), json!(format!("{:?}", plan_result)));
            }
            to_json(AppResult::success(json!(results)))
        }
        "messaging_create_direct" => {
            let guard = state.session.lock().map_err(|_| ()).ok();
            let actor_id = guard.as_ref().and_then(|g| g.actor_id.clone()).unwrap_or_default();
            let token = guard.as_ref().and_then(|g| g.token.clone()).unwrap_or_default();
            let account_id = guard.as_ref().and_then(|g| g.account_id.clone())
                .unwrap_or_else(|| crate::infrastructure::local_scope::account_id_for_password_actor(&actor_id));
            drop(guard);
            if actor_id.is_empty() || token.is_empty() {
                return to_json(AppResult::<Value>::fail(ErrorCode::Unauthorized, "authentication required", None));
            }
            let engine = match state.messaging_engines.get(&account_id) {
                Ok(Some(e)) => e,
                _ => return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, "messaging engine not active", None)),
            };
            let peer_ptid = args.get("peer_ptid").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if peer_ptid.is_empty() {
                return to_json(AppResult::<Value>::fail(ErrorCode::InvalidArgument, "peer_ptid required", None));
            }
            let conversation_id = match engine.create_direct_conversation(&token, &peer_ptid) {
                Ok(id) => id,
                Err(e) => return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            };
            if let Err(e) = engine.drain_once(&token, 100) {
                return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None));
            }
            if let Err(e) = state.messaging_engines.wake_profile(&account_id) {
                return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None));
            }
            to_json(AppResult::success(json!({
                "conversation_id": conversation_id,
                "state": "projected",
            })))
        }
        "messaging_create_group" => {
            let guard = state.session.lock().map_err(|_| ()).ok();
            let actor_id = guard.as_ref().and_then(|g| g.actor_id.clone()).unwrap_or_default();
            let token = guard.as_ref().and_then(|g| g.token.clone()).unwrap_or_default();
            let account_id = guard.as_ref().and_then(|g| g.account_id.clone())
                .unwrap_or_else(|| crate::infrastructure::local_scope::account_id_for_password_actor(&actor_id));
            drop(guard);
            if actor_id.is_empty() || token.is_empty() {
                return to_json(AppResult::<Value>::fail(ErrorCode::Unauthorized, "authentication required", None));
            }
            let engine = match state.messaging_engines.get(&account_id) {
                Ok(Some(e)) => e,
                _ => return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, "messaging engine not active", None)),
            };
            let conversation_id = args
                .get("conversation_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let member_ptids: Vec<String> = args.get("member_ptids")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            if conversation_id.is_empty() || member_ptids.is_empty() {
                return to_json(AppResult::<Value>::fail(
                    ErrorCode::InvalidArgument,
                    "conversation_id and member_ptids required",
                    None,
                ));
            }
            match engine.create_group_conversation(&token, &conversation_id, &name, &member_ptids) {
                Ok(prepared) => {
                    let now_unix_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64;
                    let retry_policy = crate::messaging::CommandRetryPolicy {
                        initial_delay_ms: 1000,
                        maximum_delay_ms: 30000,
                    };
                    let progress = match engine.dispatch_command_once(&token, now_unix_ms, retry_policy) {
                        Ok(progress) => progress,
                        Err(error) => {
                            tracing::warn!(
                                command_id = %prepared.command_id,
                                conversation_id = %prepared.conversation_id,
                                error = %error,
                                "browser messaging group dispatch assist failed after durable preparation"
                            );
                            crate::messaging::CommandDispatchProgress::Idle
                        }
                    };
                    if let Err(error) = engine.drain_once(&token, 100) {
                        tracing::warn!(
                            command_id = %prepared.command_id,
                            conversation_id = %prepared.conversation_id,
                            error = %error,
                            "browser messaging group drain assist failed after durable preparation"
                        );
                    }
                    if let Err(error) = state.messaging_engines.wake_profile(&account_id) {
                        tracing::warn!(
                            command_id = %prepared.command_id,
                            conversation_id = %prepared.conversation_id,
                            error = %error,
                            "browser messaging group lifecycle wake failed after durable preparation"
                        );
                    }
                    let projection_ready = match engine.conversations() {
                        Ok(conversations) => conversations.iter().any(
                            |conversation| conversation.conversation_id == prepared.conversation_id,
                        ),
                        Err(error) => {
                            tracing::warn!(
                                command_id = %prepared.command_id,
                                conversation_id = %prepared.conversation_id,
                                error = %error,
                                "browser messaging group projection read failed after durable preparation"
                            );
                            false
                        }
                    };
                    let creation_state = crate::interface::tauri_commands::messaging::
                        group_creation_state(
                            &progress,
                            &prepared.command_id,
                            projection_ready,
                        );
                    to_json(AppResult::success(json!({
                        "conversation_id": prepared.conversation_id,
                        "command_id": prepared.command_id,
                        "state": creation_state,
                    })))
                }
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "messaging_membership_transition" => {
            let guard = state.session.lock().map_err(|_| ()).ok();
            let actor_id = guard.as_ref().and_then(|g| g.actor_id.clone()).unwrap_or_default();
            let token = guard.as_ref().and_then(|g| g.token.clone()).unwrap_or_default();
            let account_id = guard.as_ref().and_then(|g| g.account_id.clone())
                .unwrap_or_else(|| crate::infrastructure::local_scope::account_id_for_password_actor(&actor_id));
            drop(guard);
            if actor_id.is_empty() || token.is_empty() {
                return to_json(AppResult::<Value>::fail(ErrorCode::Unauthorized, "authentication required", None));
            }
            let engine = match state.messaging_engines.get(&account_id) {
                Ok(Some(e)) => e,
                _ => return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, "messaging engine not active", None)),
            };
            let conversation_id = args.get("conversation_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let action_str = args.get("action").and_then(|v| v.as_str()).unwrap_or("");
            let target_ptid = args.get("target_ptid").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let target_device_id = args.get("target_device_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let role = args.get("role").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if conversation_id.is_empty() || target_ptid.is_empty() {
                return to_json(AppResult::<Value>::fail(ErrorCode::InvalidArgument, "conversation_id and target_ptid required", None));
            }
            let action = match action_str {
                "add_actor" => crate::model::chat::MessagingMembershipAction::AddActor,
                "remove_actor" => crate::model::chat::MessagingMembershipAction::RemoveActor,
                "add_device" => crate::model::chat::MessagingMembershipAction::AddDevice,
                "remove_device" => crate::model::chat::MessagingMembershipAction::RemoveDevice,
                _ => return to_json(AppResult::<Value>::fail(ErrorCode::InvalidArgument, "unsupported action", None)),
            };
            match engine.prepare_membership_transition(
                &token,
                &crate::messaging::MembershipTransitionIntentInput {
                    conversation_id,
                    action,
                    target_ptid,
                    target_device_id,
                    role,
                },
            ) {
                Ok(command) => {
                    let command_id = command.command_id.clone();
                    let now_unix_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64;
                    let retry_policy = crate::messaging::CommandRetryPolicy {
                        initial_delay_ms: 1000,
                        maximum_delay_ms: 30000,
                    };
                    let _ = engine.dispatch_command_once(&token, now_unix_ms, retry_policy);
                    let _ = engine.drain_once(&token, 100);
                    let _ = state.messaging_engines.wake_profile(&account_id);
                    to_json(AppResult::success(json!({
                        "command_id": command_id,
                        "state": "pending",
                    })))
                }
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "messaging_list_conversations" => {
            let guard = state.session.lock().map_err(|_| ()).ok();
            let actor_id = guard.as_ref().and_then(|g| g.actor_id.clone()).unwrap_or_default();
            let account_id = guard.as_ref().and_then(|g| g.account_id.clone())
                .unwrap_or_else(|| crate::infrastructure::local_scope::account_id_for_password_actor(&actor_id));
            drop(guard);
            if actor_id.is_empty() {
                return to_json(AppResult::<Value>::fail(ErrorCode::Unauthorized, "authentication required", None));
            }
            let engine = match state.messaging_engines.get(&account_id) {
                Ok(Some(e)) => e,
                _ => return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, "messaging engine not active", None)),
            };
            match engine.conversations() {
                Ok(conversations) => {
                    let items = conversations
                        .iter()
                        .map(|conversation| {
                            crate::interface::tauri_commands::messaging::
                                conversation_projection_json(&engine, conversation)
                        })
                        .collect::<Result<Vec<_>, _>>();
                    match items {
                        Ok(items) => {
                            to_json(AppResult::success(json!({ "conversations": items })))
                        }
                        Err(error) => to_json(AppResult::<Value>::fail(
                            ErrorCode::InternalError,
                            &error,
                            None,
                        )),
                    }
                }
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "messaging_command_status" => {
            let guard = state.session.lock().map_err(|_| ()).ok();
            let actor_id = guard.as_ref().and_then(|g| g.actor_id.clone()).unwrap_or_default();
            let account_id = guard.as_ref().and_then(|g| g.account_id.clone())
                .unwrap_or_else(|| crate::infrastructure::local_scope::account_id_for_password_actor(&actor_id));
            drop(guard);
            if actor_id.is_empty() {
                return to_json(AppResult::<Value>::fail(ErrorCode::Unauthorized, "authentication required", None));
            }
            let engine = match state.messaging_engines.get(&account_id) {
                Ok(Some(engine)) => engine,
                _ => return to_json(AppResult::<Value>::fail(
                    ErrorCode::InternalError,
                    "messaging engine not active",
                    None,
                )),
            };
            let command_id = args
                .get("command_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            to_json(
                crate::interface::tauri_commands::messaging::command_status_json(
                    &engine,
                    command_id,
                ),
            )
        }
        "messaging_hydrate" => {
            let guard = state.session.lock().map_err(|_| ()).ok();
            let actor_id = guard.as_ref().and_then(|g| g.actor_id.clone()).unwrap_or_default();
            let token = guard.as_ref().and_then(|g| g.token.clone()).unwrap_or_default();
            let account_id = guard.as_ref().and_then(|g| g.account_id.clone())
                .unwrap_or_else(|| crate::infrastructure::local_scope::account_id_for_password_actor(&actor_id));
            drop(guard);
            if actor_id.is_empty() || token.is_empty() {
                return to_json(AppResult::<Value>::fail(ErrorCode::Unauthorized, "authentication required", None));
            }
            let engine = match state.messaging_engines.get(&account_id) {
                Ok(Some(e)) => e,
                _ => return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, "messaging engine not active", None)),
            };
            let station_resp = match crate::infrastructure::station_client::request_json_auth(
                reqwest::Method::GET,
                "/conversation/list",
                &token,
                None,
                None::<&serde_json::Value>,
            ) {
                Ok(v) => v,
                Err(e) => return to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &format!("station fetch: {}", e.message), None)),
            };
            let conversations_raw = station_resp
                .get("conversations")
                .and_then(|c| c.as_array())
                .cloned()
                .unwrap_or_default();
            let mut projections: Vec<crate::messaging::ConversationProjection> = Vec::new();
            for conv in &conversations_raw {
                let conv_id = conv.get("conversation_id").and_then(|v| v.as_str()).unwrap_or_default();
                let kind_str = conv.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                let kind_i32: i32 = if kind_str.contains("GROUP") { 2 } else { 1 };
                let authority = conv.get("authority_station_peer_id").and_then(|v| v.as_str()).unwrap_or_default();
                if conv_id.is_empty() || authority.is_empty() {
                    continue;
                }
                projections.push(crate::messaging::ConversationProjection {
                    conversation_id: conv_id.to_string(),
                    authority_station_id: authority.to_string(),
                    kind: kind_i32,
                    name: conv.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    owner_ptid: conv.get("owner_ptid").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    members: Vec::new(),
                    membership_epoch: conv.get("membership_epoch").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()).unwrap_or(0),
                    mls_epoch: conv.get("mls_epoch").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()).unwrap_or(0),
                    active: true,
                    updated_at_unix_ms: 0,
                });
            }
            match engine.hydrate_conversation_projections(&projections) {
                Ok(count) => to_json(AppResult::success(json!({
                    "hydrated": count,
                    "total_station_conversations": conversations_raw.len(),
                }))),
                Err(e) => to_json(AppResult::<Value>::fail(ErrorCode::InternalError, &e, None)),
            }
        }
        "conversation_react" => {
            let token = match token_from_state(state) {
                Ok(t) => t,
                Err(e) => return e,
            };
            let body = json!({
                "command": {
                    "conversation_id": args.get("conversation_id").and_then(|v| v.as_str()).unwrap_or(""),
                    "react": {
                        "message_id": args.get("message_id").and_then(|v| v.as_str()).unwrap_or(""),
                        "emoji": args.get("emoji").and_then(|v| v.as_str()).unwrap_or(""),
                        "remove": args.get("remove").and_then(|v| v.as_bool()).unwrap_or(false),
                    }
                }
            });
            match crate::infrastructure::station_client::request_json_auth(
                reqwest::Method::POST,
                "/conversation/command",
                &token,
                None,
                Some(&body),
            ) {
                Ok(resp) => to_json(AppResult::success(resp)),
                Err(e) => to_json(AppResult::<Value>::fail(
                    ErrorCode::InternalError,
                    &format!("conversation react: {e}"),
                    None,
                )),
            }
        }

        // =================================================================
        // Unknown command
        // =================================================================
        _ => to_json(AppResult::<StubPayload>::fail(
            ErrorCode::NotFound,
            format!("unknown command: {cmd}"),
            Some(json!({"command": cmd})),
        )),
    }
}

// -------------------------------------------------------------------------
// Complex multi-page sync dispatchers (extracted for readability)
// -------------------------------------------------------------------------

fn dispatch_group_sync_from_station(args: Value, state: &AppState) -> Value {
    let input = match parse_args::<GroupChatSyncInput>(args) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let token = match token_from_state(state) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if input.group_ulid.trim().is_empty() {
        return to_json(AppResult::<StubPayload>::fail(
            ErrorCode::InvalidArgument,
            "group_ulid is required",
            None,
        ));
    }
    let user_scope = user_scope_from_state(state);
    let scope_key = format!("group:{}", input.group_ulid);
    let cursor = match chat_storage::get_scope_cursor(&user_scope, &scope_key) {
        Ok(c) => c,
        Err(reason) => {
            return to_json(AppResult::<StubPayload>::fail(
                ErrorCode::InternalError,
                "get cursor failed",
                Some(json!({"reason": reason})),
            ));
        }
    };
    let page_limit = input.limit.unwrap_or(100);
    let max_pages = input.max_pages.unwrap_or(10);
    let mut current_cursor = cursor.clone();
    let mut total_synced = 0usize;
    let mut pages_fetched = 0u32;
    for _ in 0..max_pages {
        let mut query = vec![
            ("group_ulid", input.group_ulid.clone()),
            ("limit", page_limit.to_string()),
        ];
        if let Some(ref existing) = current_cursor {
            if !existing.trim().is_empty() {
                query.push(("before_ulid", format!("since:{existing}")));
            }
        }

        let data = match station_request_json(
            Method::GET,
            "/group-chat/messages",
            &token,
            Some(&query),
            None,
        ) {
            Ok(d) => d,
            Err(e) => return e,
        };
        pages_fetched += 1;
        let (incremental, synced_count, latest) =
            filter_incremental_messages(&data, current_cursor.as_deref());
        let _ = chat_storage::ingest_group_messages(&user_scope, &incremental);
        total_synced += synced_count;
        let server_cursor = data
            .get("next_cursor")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let fallback = extract_latest_ulid(&data);
        let next = server_cursor.or(latest).or(fallback);
        if let Some(ref new_cursor) = next {
            let _ = chat_storage::set_scope_cursor(&user_scope, &scope_key, new_cursor);
            current_cursor = Some(new_cursor.clone());
        }
        if !data
            .get("has_more")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            break;
        }
    }
    to_json(to_stub(
        "group_chat_sync_from_station_scoped",
        json!({
            "synced_count": total_synced, "pages_fetched": pages_fetched,
            "cursor_before": cursor, "cursor_after": current_cursor,
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::i18n::I18nService;
    use crate::infrastructure::storage::{StorageKind, StorageLayout};
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_layout(name: &str) -> StorageLayout {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("peers-http-gateway-{}-{}", name, stamp));
        let mut dirs = HashMap::new();
        for kind in [
            StorageKind::Config,
            StorageKind::Data,
            StorageKind::Cache,
            StorageKind::Logs,
            StorageKind::Runtime,
            StorageKind::Temp,
        ] {
            let path = root.join(kind.as_str());
            std::fs::create_dir_all(&path).expect("test storage dir should be created");
            dirs.insert(kind, path);
        }
        StorageLayout {
            app_name: format!("http-gateway-test-{}", name),
            root_source: "test".to_string(),
            root,
            dirs,
        }
    }

    fn test_state(name: &str) -> AppState {
        let layout = temp_layout(name);
        let config_dir = layout
            .dirs
            .get(&StorageKind::Config)
            .cloned()
            .unwrap_or_else(PathBuf::new);
        let state = AppState::new(layout, I18nService::new(&config_dir));
        {
            let mut session = state.session.lock().expect("test session should lock");
            session.actor_id = Some("actor-http-gateway-test".to_string());
            session.token = Some("token-http-gateway-test".to_string());
        }
        state
    }

    fn manifest() -> Value {
        json!({
            "id": "http-gateway-applet",
            "permissions": ["app.getContext", "lifecycle.destroy"],
            "services": [],
            "skills": []
        })
    }

    fn app_result_ok(value: &Value) -> bool {
        value.get("ok").and_then(Value::as_bool).unwrap_or(false)
    }

    fn status_json(value: &Value) -> Value {
        let status = value
            .get("data")
            .and_then(|data| data.get("status"))
            .and_then(Value::as_str)
            .expect("stub payload status should exist");
        serde_json::from_str(status).expect("stub payload status should be JSON")
    }

    fn register_product_host_gate_provider(_base_url: &str) {
        // Provider registration now requires Station. Tests for product-host-gate
        // must run against a real Station with providers configured.
    }

    #[test]
    fn acceptance_current_session_returns_debug_gateway_session() {
        let state = test_state("acceptance-session");
        let runtime = GatewayRuntime::headless();

        let result = dispatch("acceptance_current_session", json!({}), &state, &runtime);

        assert!(app_result_ok(&result), "current session failed: {}", result);
        let status = status_json(&result);
        assert_eq!(
            status.get("actor_id").and_then(Value::as_str),
            Some("actor-http-gateway-test")
        );
        assert_eq!(
            status.get("token").and_then(Value::as_str),
            Some("token-http-gateway-test")
        );
    }

    #[test]
    fn acceptance_current_session_requires_authentication() {
        let layout = temp_layout("acceptance-session-auth");
        let config_dir = layout
            .dirs
            .get(&StorageKind::Config)
            .cloned()
            .unwrap_or_else(PathBuf::new);
        let state = AppState::new(layout, I18nService::new(&config_dir));
        let runtime = GatewayRuntime::headless();

        let result = dispatch("acceptance_current_session", json!({}), &state, &runtime);

        assert_eq!(result.get("ok").and_then(Value::as_bool), Some(false));
        assert_eq!(
            result
                .get("error")
                .and_then(|error| error.get("code"))
                .and_then(Value::as_str),
            Some("UNAUTHORIZED")
        );
    }

    #[test]
    fn applet_commands_route_through_http_gateway_dispatch() {
        let state = test_state("applet-route");
        let runtime = GatewayRuntime::headless();
        let create = dispatch(
            "applets_create_session",
            json!({
                "id": "http-gateway-applet",
                "sessionId": "http-gateway-session",
                "manifest": manifest()
            }),
            &state,
            &runtime,
        );
        assert!(app_result_ok(&create), "create session failed: {}", create);

        let invoke = dispatch(
            "applets_invoke",
            json!({
                "id": "http-gateway-applet",
                "sessionId": "http-gateway-session",
                "capability": "app",
                "action": "getContext",
                "params": {},
                "manifest": manifest()
            }),
            &state,
            &runtime,
        );
        assert!(app_result_ok(&invoke), "invoke failed: {}", invoke);
        let status = status_json(&invoke);
        assert_eq!(
            status.get("sessionId").and_then(Value::as_str),
            Some("http-gateway-session")
        );
        assert_eq!(
            status.get("bridgeProtocol").and_then(Value::as_str),
            Some("peers-touch.applet.bridge")
        );
    }

    #[test]
    fn applet_http_gateway_requires_authenticated_context() {
        let layout = temp_layout("applet-auth");
        let config_dir = layout
            .dirs
            .get(&StorageKind::Config)
            .cloned()
            .unwrap_or_else(PathBuf::new);
        let state = AppState::new(layout, I18nService::new(&config_dir));
        let runtime = GatewayRuntime::headless();

        let result = dispatch(
            "applets_create_session",
            json!({
                "id": "http-gateway-applet",
                "sessionId": "http-gateway-session",
                "manifest": manifest()
            }),
            &state,
            &runtime,
        );

        assert_eq!(result.get("ok").and_then(Value::as_bool), Some(false));
        assert_eq!(
            result
                .get("error")
                .and_then(|error| error.get("code"))
                .and_then(Value::as_str),
            Some("UNAUTHORIZED")
        );
    }

    #[test]
    #[ignore]
    fn applet_http_gateway_server_for_product_host_gate() {
        let state = test_state("applet-product-host-server");
        if let Ok(base_url) = std::env::var("PEERS_APPLET_E2E_BASE_URL") {
            register_product_host_gate_provider(&base_url);
        }
        let hold_ms = std::env::var("PEERS_APPLET_HTTP_GATEWAY_HOLD_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(60_000);
        let _ = (state, hold_ms);
        panic!("manual HTTP gateway server test requires a live Tauri AppHandle");
    }
}
