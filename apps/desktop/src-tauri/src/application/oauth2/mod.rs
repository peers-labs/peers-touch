use crate::application::security::redact_json_value;
use crate::contracts::{
    OAuthAuthorizeInput, OAuthCallbackInput, OAuthIdInput, OAuthLoopbackPollInput,
    OAuthLoopbackStartInput, OAuthResourceInput, OAuthSetCredentialsInput, StubPayload,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::auth_identity;
use crate::infrastructure::i18n::I18nService;
use crate::infrastructure::session_store::SessionSource;
use crate::infrastructure::session_vault;
use crate::infrastructure::station_client;
use crate::infrastructure::storage::{self, StorageKind};
use crate::model::oauth::{OAuthBridgeRequest, OAuthBridgeResponse};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProviderCatalogItem {
    id: String,
    name: String,
    description: String,
    icon: String,
    color: String,
    category: String,
    enabled: bool,
    status: String,
    callback_url: String,
    authorize_url: String,
    token_url: String,
    userinfo_url: Option<String>,
    revoke_url: Option<String>,
    scopes: Vec<String>,
    pkce: bool,
    environments: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct OAuthConnectionState {
    provider_id: String,
    provider_name: String,
    user_id: String,
    user_name: String,
    email: String,
    avatar_url: String,
    profile_url: String,
    connected_at: String,
    expires_at: Option<String>,
    scopes: Vec<String>,
    status: String,
}

#[derive(Debug, Clone, Default)]
struct LoopbackSessionState {
    status: String,
    callback_url: Option<String>,
    error: Option<String>,
    created_at: i64,
    completed_at: Option<i64>,
}

static LOOPBACK_SESSIONS: OnceLock<Mutex<HashMap<String, LoopbackSessionState>>> = OnceLock::new();
static LOOPBACK_COUNTER: AtomicU64 = AtomicU64::new(1);

fn loopback_sessions() -> &'static Mutex<HashMap<String, LoopbackSessionState>> {
    LOOPBACK_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_loopback_session_id() -> String {
    let now = chrono_like_now_unix();
    let n = LOOPBACK_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("lp-{now}-{n}")
}

fn update_loopback_session(
    session_id: &str,
    status: &str,
    callback_url: Option<String>,
    error: Option<String>,
) {
    if let Ok(mut sessions) = loopback_sessions().lock() {
        if let Some(item) = sessions.get_mut(session_id) {
            item.status = status.to_string();
            item.callback_url = callback_url;
            item.error = error;
            if status == "completed" || status == "failed" || status == "expired" {
                item.completed_at = Some(chrono_like_now_unix());
            }
        }
    }
}

fn parse_query_params(raw_path: &str) -> HashMap<String, String> {
    let query = raw_path.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut params: HashMap<String, String> = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let key = urlencoding::decode(k)
            .map(|s| s.to_string())
            .unwrap_or_else(|_| k.to_string());
        let val = urlencoding::decode(v)
            .map(|s| s.to_string())
            .unwrap_or_else(|_| v.to_string());
        params.insert(key, val);
    }
    params
}

fn save_oauth_callback(
    input: OAuthCallbackInput,
    ts: Option<String>,
    sig: Option<String>,
) -> CmdResult<()> {
    let provider_id = input.provider.trim();
    if provider_id.is_empty() {
        return Err(invalid_argument("provider is required"));
    }
    if get_provider(provider_id).is_none() {
        return Err(AppResult::fail(
            ErrorCode::NotFound,
            "error.oauth2.providerNotFound",
            None,
        ));
    }
    if input.provider_user_id.trim().is_empty() {
        return Err(invalid_argument("provider_user_id is required"));
    }
    let mut map = read_connections()?;
    let now = unix_to_rfc3339(chrono_like_now_unix());
    let expires_at = input
        .expires_at
        .filter(|v| !v.trim().is_empty())
        .or_else(|| Some(unix_to_rfc3339(chrono_like_now_unix() + 3600)));
    let provider_name = get_provider(provider_id)
        .map(|p| p.name)
        .unwrap_or_else(|| provider_id.to_string());
    let provider_user_id = input.provider_user_id.clone();
    let display_name_value = input
        .display_name
        .clone()
        .unwrap_or_else(|| provider_user_id.clone());
    let user_name = input
        .username
        .filter(|v| !v.trim().is_empty())
        .or(input.display_name)
        .unwrap_or_else(|| provider_user_id.clone());
    let email = input.email.unwrap_or_default();
    let avatar_url = input.avatar_url.unwrap_or_default();
    let profile_url = input.profile_url.unwrap_or_default();
    map.insert(
        provider_id.to_string(),
        OAuthConnectionState {
            provider_id: provider_id.to_string(),
            provider_name,
            user_id: provider_user_id.clone(),
            user_name: user_name.clone(),
            email: email.clone(),
            avatar_url: avatar_url.clone(),
            profile_url: profile_url.clone(),
            connected_at: now,
            expires_at,
            scopes: vec![],
            status: "active".to_string(),
        },
    );
    write_connections(&map)?;
    let account_id = auth_identity::upsert_oauth(
        provider_id,
        provider_user_id.as_str(),
        user_name.as_str(),
        input.created_at.as_deref(),
        Some(email.as_str()),
        Some(avatar_url.as_str()),
        Some(profile_url.as_str()),
    )
    .map_err(internal_error)?;

    // Bridge the OAuth identity to Station via oauth-bridge API.
    // On success, persist the returned JWT so the app can load it later
    // via `ensure_station_session`.
    let bridge_req = OAuthBridgeRequest {
        provider: provider_id.to_string(),
        provider_user_id: input.provider_user_id.clone(),
        email,
        username: user_name,
        display_name: display_name_value,
        avatar_url,
        ts: ts.clone().unwrap_or_default(),
        sig: sig.clone().unwrap_or_default(),
    };
    match station_client::post_peers_proto_no_auth::<OAuthBridgeRequest, OAuthBridgeResponse>(
        "/actor/oauth-bridge",
        &bridge_req,
    ) {
        Ok(bridge) => {
            if !bridge.access_token.is_empty() {
                let _ = session_vault::persist_raw_session_for_account(
                    &account_id,
                    &bridge.actor_id,
                    &bridge.access_token,
                    SessionSource::OauthBridge,
                );
            }
        }
        Err(e) => {
            tracing::warn!(error = %e, "station oauth-bridge call failed, continuing without station session");
        }
    }

    Ok(())
}

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
}

/// Attempt to obtain a Station JWT by calling the oauth-bridge endpoint
/// with the first active OAuth connection found locally.
/// Returns `Some((actor_id, token))` on success, `None` on any failure.
pub fn try_bridge_from_connections() -> Option<(String, String)> {
    let map = read_connections().ok()?;
    let conn = map.values().find(|c| c.status == "active")?;

    let bridge_req = OAuthBridgeRequest {
        provider: conn.provider_id.clone(),
        provider_user_id: conn.user_id.clone(),
        email: conn.email.clone(),
        username: conn.user_name.clone(),
        display_name: conn.user_name.clone(),
        avatar_url: conn.avatar_url.clone(),
        ts: String::new(),
        sig: String::new(),
    };

    let bridge =
        station_client::post_peers_proto_no_auth::<OAuthBridgeRequest, OAuthBridgeResponse>(
            "/actor/oauth-bridge",
            &bridge_req,
        )
        .ok()?;
    if bridge.access_token.is_empty() {
        return None;
    }

    let account_id = format!("{}:{}", conn.provider_id, conn.user_id);
    let _ = session_vault::persist_raw_session_for_account(
        &account_id,
        &bridge.actor_id,
        &bridge.access_token,
        SessionSource::OauthBridge,
    );
    Some((bridge.actor_id, bridge.access_token))
}

fn invalid_argument(message: &str) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InvalidArgument, message, None)
}

type CmdResult<T> = Result<T, AppResult<StubPayload>>;

macro_rules! try_cmd {
    ($expr:expr) => {
        match $expr {
            Ok(value) => value,
            Err(err) => return err,
        }
    };
}

fn internal_error(message: impl Into<String>) -> AppResult<StubPayload> {
    AppResult::fail(ErrorCode::InternalError, message, None)
}

fn config_dir() -> CmdResult<PathBuf> {
    let dir = storage::app_file_path("desktop", StorageKind::Data, &["oauth2"])
        .map_err(|err| internal_error(format!("failed to resolve oauth2 dir: {err:?}")))?;
    if let Err(err) = fs::create_dir_all(&dir) {
        return Err(internal_error(format!(
            "failed to create oauth2 dir: {err}"
        )));
    }
    Ok(dir)
}

fn connections_path() -> CmdResult<PathBuf> {
    Ok(config_dir()?.join("connections.json"))
}

fn credential_path(provider_id: &str) -> CmdResult<PathBuf> {
    let safe_provider_id = sanitize_provider_id(provider_id);
    Ok(config_dir()?.join(format!("{safe_provider_id}.yml")))
}

fn chrono_like_now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs() as i64
}

fn unix_to_rfc3339(ts: i64) -> String {
    let dt =
        time::OffsetDateTime::from_unix_timestamp(ts).unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    dt.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn provider_catalog() -> Vec<ProviderCatalogItem> {
    vec![
        ProviderCatalogItem {
            id: "github".to_string(),
            name: "GitHub".to_string(),
            description: "GitHub OAuth2 provider".to_string(),
            icon: "github".to_string(),
            color: "#24292F".to_string(),
            category: "Developer Tools".to_string(),
            enabled: true,
            status: "active".to_string(),
            callback_url: "https://peers-touch.vercel.app/api/oauth/github/callback".to_string(),
            authorize_url: "https://github.com/login/oauth/authorize".to_string(),
            token_url: "https://github.com/login/oauth/access_token".to_string(),
            userinfo_url: Some("https://api.github.com/user".to_string()),
            revoke_url: None,
            scopes: vec!["read:user".to_string(), "user:email".to_string()],
            pkce: false,
            environments: vec![json!({
                "id":"prod","name":"Production","authorize_url":"https://github.com/login/oauth/authorize","token_url":"https://github.com/login/oauth/access_token","userinfo_url":"https://api.github.com/user","default":true
            })],
        },
        ProviderCatalogItem {
            id: "google".to_string(),
            name: "Google".to_string(),
            description: "Google OAuth2 provider".to_string(),
            icon: "google".to_string(),
            color: "#4285F4".to_string(),
            category: "Office".to_string(),
            enabled: true,
            status: "active".to_string(),
            callback_url: "https://peers-touch.vercel.app/api/oauth/google/callback".to_string(),
            authorize_url: "https://accounts.google.com/o/oauth2/v2/auth".to_string(),
            token_url: "https://oauth2.googleapis.com/token".to_string(),
            userinfo_url: Some("https://openidconnect.googleapis.com/v1/userinfo".to_string()),
            revoke_url: Some("https://oauth2.googleapis.com/revoke".to_string()),
            scopes: vec![
                "openid".to_string(),
                "profile".to_string(),
                "email".to_string(),
            ],
            pkce: true,
            environments: vec![json!({
                "id":"prod","name":"Production","authorize_url":"https://accounts.google.com/o/oauth2/v2/auth","token_url":"https://oauth2.googleapis.com/token","userinfo_url":"https://openidconnect.googleapis.com/v1/userinfo","default":true
            })],
        },
        ProviderCatalogItem {
            id: "weixin".to_string(),
            name: "Weixin".to_string(),
            description: "Weixin OAuth2 provider".to_string(),
            icon: "message-circle".to_string(),
            color: "#07C160".to_string(),
            category: "Collaboration".to_string(),
            enabled: true,
            status: "coming_soon".to_string(),
            callback_url: "https://peers-touch.vercel.app/api/oauth/weixin/callback".to_string(),
            authorize_url: "https://open.weixin.qq.com/connect/qrconnect".to_string(),
            token_url: "https://api.weixin.qq.com/sns/oauth2/access_token".to_string(),
            userinfo_url: Some("https://api.weixin.qq.com/sns/userinfo".to_string()),
            revoke_url: None,
            scopes: vec!["snsapi_login".to_string()],
            pkce: false,
            environments: vec![json!({
                "id":"prod","name":"Production","authorize_url":"https://open.weixin.qq.com/connect/qrconnect","token_url":"https://api.weixin.qq.com/sns/oauth2/access_token","userinfo_url":"https://api.weixin.qq.com/sns/userinfo","default":true
            })],
        },
        ProviderCatalogItem {
            id: "lark".to_string(),
            name: "Lark".to_string(),
            description: "Lark OAuth2 provider".to_string(),
            icon: "bird".to_string(),
            color: "#3370FF".to_string(),
            category: "Collaboration".to_string(),
            enabled: true,
            status: "active".to_string(),
            callback_url: "https://peers-touch.vercel.app/api/oauth/lark/callback".to_string(),
            authorize_url: "https://open.larksuite.com/open-apis/authen/v1/authorize".to_string(),
            token_url: "https://open.larksuite.com/open-apis/authen/v1/oidc/access_token"
                .to_string(),
            userinfo_url: Some(
                "https://open.larksuite.com/open-apis/authen/v1/user_info".to_string(),
            ),
            revoke_url: None,
            scopes: vec!["contact:contact".to_string()],
            pkce: false,
            environments: vec![json!({
                "id":"prod","name":"Production","authorize_url":"https://open.larksuite.com/open-apis/authen/v1/authorize","token_url":"https://open.larksuite.com/open-apis/authen/v1/oidc/access_token","userinfo_url":"https://open.larksuite.com/open-apis/authen/v1/user_info","default":true
            })],
        },
    ]
}

fn get_provider(id: &str) -> Option<ProviderCatalogItem> {
    provider_catalog().into_iter().find(|p| p.id == id)
}

fn read_credentials(provider_id: &str) -> CmdResult<(String, String, bool)> {
    let file = credential_path(provider_id)?;
    if !file.exists() {
        return Ok((String::new(), String::new(), false));
    }
    let content = fs::read_to_string(&file)
        .map_err(|err| internal_error(format!("failed to read credential file: {err}")))?;
    let mut client_id = String::new();
    let mut client_secret = String::new();
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with('#') || t.is_empty() {
            continue;
        }
        if let Some((k, v)) = t.split_once(':') {
            let key = k.trim();
            let value = v.trim().trim_matches('"').trim_matches('\'').to_string();
            if key == "client_id" {
                client_id = value;
            } else if key == "client_secret" {
                client_secret = value;
            }
        }
    }
    Ok((client_id, client_secret, true))
}

fn write_credentials(provider_id: &str, client_id: &str, client_secret: &str) -> CmdResult<()> {
    let file = credential_path(provider_id)?;
    let content = format!(
        "client_id: \"{}\"\nclient_secret: \"{}\"\n",
        client_id.replace('"', "\\\""),
        client_secret.replace('"', "\\\"")
    );
    storage::write_string_atomic(&file, &content)
        .map_err(|err| internal_error(format!("failed to write credential file: {err:?}")))?;
    Ok(())
}

fn read_connections() -> CmdResult<HashMap<String, OAuthConnectionState>> {
    let path = connections_path()?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = fs::read_to_string(path)
        .map_err(|err| internal_error(format!("failed to read connections file: {err}")))?;
    if content.trim().is_empty() {
        return Ok(HashMap::new());
    }
    serde_json::from_str(&content)
        .map_err(|err| internal_error(format!("failed to parse connections file: {err}")))
}

fn write_connections(connections: &HashMap<String, OAuthConnectionState>) -> CmdResult<()> {
    let path = connections_path()?;
    let content = serde_json::to_string_pretty(connections)
        .map_err(|err| internal_error(format!("failed to encode connections: {err}")))?;
    storage::write_string_atomic(&path, &content)
        .map_err(|err| internal_error(format!("failed to write connections file: {err:?}")))?;
    Ok(())
}

fn sanitize_provider_id(provider_id: &str) -> String {
    let mut out = String::with_capacity(provider_id.len());
    for ch in provider_id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "unknown".to_string()
    } else {
        out
    }
}

fn mask_secret(secret: &str) -> String {
    if secret.is_empty() {
        return "****".to_string();
    }
    if secret.len() <= 6 {
        return "*".repeat(secret.len());
    }
    let (head, tail) = secret.split_at(3);
    format!("{head}***{}", &tail[tail.len().saturating_sub(3)..])
}

fn safe_connection_json(conn: &OAuthConnectionState) -> Value {
    json!({
        "provider_id": conn.provider_id,
        "provider_name": conn.provider_name,
        "user_id": conn.user_id,
        "user_name": conn.user_name,
        "email": conn.email,
        "avatar_url": conn.avatar_url,
        "profile_url": conn.profile_url,
        "connected_at": conn.connected_at,
        "expires_at": conn.expires_at,
        "scopes": conn.scopes,
        "status": conn.status,
    })
}

fn required_arg_string(arguments: &Value, key: &str) -> Result<String, String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{key} is required"))
}

pub fn execute_oauth_connector_tool(
    arguments: &Value,
    call_id: Option<&str>,
) -> Result<Value, String> {
    let resource = required_arg_string(arguments, "resource")?;
    let params = arguments
        .get("params")
        .map(redact_json_value)
        .unwrap_or_else(|| json!({}));
    let connections = read_connections().map_err(|error| {
        error
            .error
            .map(|err| err.message)
            .unwrap_or_else(|| "failed to read OAuth connections".to_string())
    })?;

    let output = match resource.as_str() {
        "connections.list" => {
            let items = connections
                .values()
                .filter(|conn| conn.status == "active")
                .map(safe_connection_json)
                .collect::<Vec<_>>();
            json!({
                "resource": resource,
                "connections": items,
            })
        }
        "connection.status" | "connection.profile" => {
            let provider_id = required_arg_string(arguments, "provider_id")?;
            let conn = connections
                .get(&provider_id)
                .ok_or_else(|| format!("OAuth connection not found for provider: {provider_id}"))?;
            if conn.status != "active" {
                return Err(format!(
                    "OAuth connection is not active for provider: {provider_id}"
                ));
            }
            json!({
                "resource": resource,
                "connection": safe_connection_json(conn),
            })
        }
        other => {
            return Err(format!(
                "unsupported OAuth connector resource: {other}; supported resources are connections.list, connection.status, connection.profile"
            ));
        }
    };

    Ok(json!({
        "ok": true,
        "toolName": "oauth_connector_call",
        "callId": call_id.unwrap_or_default(),
        "arguments": redact_json_value(arguments),
        "output": output,
        "params": params,
        "audit": {
            "source": "builtin",
            "toolName": "oauth_connector_call",
            "executionOwner": "desktop-rust",
            "approvalRequired": true,
            "secrets": "redacted",
            "executedAt": unix_to_rfc3339(chrono_like_now_unix())
        }
    }))
}

pub fn oauth2_list_providers() -> AppResult<StubPayload> {
    let connections = try_cmd!(read_connections());
    let mut out = Vec::new();
    for p in provider_catalog() {
        let (client_id, _, has_yaml) = try_cmd!(read_credentials(&p.id));
        let connected = connections
            .get(&p.id)
            .map(|c| c.status == "active")
            .unwrap_or(false);
        out.push(json!({
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "icon": p.icon,
            "color": p.color,
            "category": p.category,
            "builtin": true,
            "enabled": p.enabled,
            "status": p.status,
            "has_credentials": has_yaml && !client_id.is_empty(),
            "connected": connected,
            "callback_url": p.callback_url,
            "auth_hosts": [],
            "environments": p.environments,
        }));
    }
    success_payload("oauth2_list_providers", json!(out))
}

pub fn oauth2_get_provider(input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let Some(p) = get_provider(input.id.trim()) else {
        return AppResult::fail(ErrorCode::NotFound, "error.oauth2.providerNotFound", None);
    };
    success_payload(
        "oauth2_get_provider",
        json!({
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "icon": p.icon,
            "color": p.color,
            "category": p.category,
            "builtin": true,
            "enabled": p.enabled,
            "oauth2": {
                "authorize_url": p.authorize_url,
                "token_url": p.token_url,
                "revoke_url": p.revoke_url,
                "userinfo_url": p.userinfo_url,
                "scopes": p.scopes,
                "pkce": p.pkce
            },
            "resources": {},
            "page_template": {
                "title": format!("{} OAuth2", p.name),
                "subtitle": "Authorize and manage your sign-in connection",
                "disclaimer": "This view is configuration-driven and can be extended with custom providers."
            }
        }),
    )
}

pub fn oauth2_get_credential_info(input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let (client_id, client_secret, yaml_has_conf) = try_cmd!(read_credentials(input.id.trim()));
    success_payload(
        "oauth2_get_credential_info",
        json!({
            "client_id": client_id,
            "secret_masked": mask_secret(&client_secret),
            "source":"yaml",
            "yaml_has_conf": yaml_has_conf
        }),
    )
}

pub fn oauth2_set_credentials(input: OAuthSetCredentialsInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    if input.client_id.trim().is_empty() {
        return invalid_argument("client_id is required");
    }
    if get_provider(input.id.trim()).is_none() {
        return AppResult::fail(ErrorCode::NotFound, "error.oauth2.providerNotFound", None);
    }
    try_cmd!(write_credentials(
        input.id.trim(),
        input.client_id.trim(),
        input.client_secret.trim()
    ));
    success_payload("oauth2_set_credentials", json!({ "status":"ok" }))
}

pub fn oauth2_authorize(input: OAuthAuthorizeInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let provider_id = input.id.trim();
    let Some(provider) = get_provider(provider_id) else {
        return AppResult::fail(ErrorCode::NotFound, "error.oauth2.providerNotFound", None);
    };
    if provider.status == "coming_soon" {
        return AppResult::fail(ErrorCode::Conflict, "error.oauth2.providerDeveloping", None);
    }
    let env = input.environment.unwrap_or_else(|| "prod".to_string());
    let return_to = input
        .return_to
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "peers-touch://oauth/callback".to_string());
    let start_url = provider.callback_url.replace("/callback", "/start");
    let auth_url = format!(
        "{}?site_id=default&return_to={}",
        start_url,
        urlencoding::encode(&return_to),
    );
    success_payload(
        "oauth2_authorize",
        json!({ "auth_url": auth_url, "environment": env }),
    )
}

pub fn oauth2_start_loopback(
    input: OAuthLoopbackStartInput,
    i18n: I18nService,
) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let provider_id = input.id.trim();
    let Some(provider) = get_provider(provider_id) else {
        return AppResult::fail(ErrorCode::NotFound, "error.oauth2.providerNotFound", None);
    };
    if provider.status == "coming_soon" {
        return AppResult::fail(ErrorCode::Conflict, "error.oauth2.providerDeveloping", None);
    }

    let listener = match TcpListener::bind("127.0.0.1:0") {
        Ok(v) => v,
        Err(err) => return internal_error(format!("failed to bind loopback listener: {err}")),
    };
    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(err) => return internal_error(format!("failed to read loopback listener addr: {err}")),
    };

    let session_id = next_loopback_session_id();
    if let Ok(mut sessions) = loopback_sessions().lock() {
        sessions.insert(
            session_id.clone(),
            LoopbackSessionState {
                status: "pending".to_string(),
                callback_url: None,
                error: None,
                created_at: chrono_like_now_unix(),
                completed_at: None,
            },
        );
    }

    let session_id_for_thread = session_id.clone();
    let provider_id_for_thread = provider_id.to_string();
    thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buffer = [0_u8; 8192];
            let read_size = stream.read(&mut buffer).unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..read_size]).to_string();
            let request_line = request.lines().next().unwrap_or("");
            let path = request_line
                .split_whitespace()
                .nth(1)
                .unwrap_or("/callback")
                .to_string();
            let callback_url = format!("http://127.0.0.1:{port}{path}");
            let params = parse_query_params(&path);
            let lang = params
                .get("lang")
                .or_else(|| params.get("locale"))
                .cloned()
                .unwrap_or_else(|| "en".to_string());
            let request_session_id = params.get("session_id").cloned().unwrap_or_default();
            let provider = params.get("provider").cloned().unwrap_or_default();
            let provider_user_id = params.get("provider_user_id").cloned().unwrap_or_default();
            let mut ok = false;
            let message: String;
            if request_session_id != session_id_for_thread {
                update_loopback_session(
                    &session_id_for_thread,
                    "failed",
                    Some(callback_url.clone()),
                    Some("session id mismatch".to_string()),
                );
                message = i18n.resolve_key(&lang, "oauth", "oauth.callback.sessionMismatch");
            } else if provider.is_empty() || provider_user_id.is_empty() {
                update_loopback_session(
                    &session_id_for_thread,
                    "failed",
                    Some(callback_url.clone()),
                    Some("missing provider callback fields".to_string()),
                );
                message = i18n.resolve_key(&lang, "oauth", "oauth.callback.missingFields");
            } else if provider != provider_id_for_thread {
                update_loopback_session(
                    &session_id_for_thread,
                    "failed",
                    Some(callback_url.clone()),
                    Some("provider mismatch".to_string()),
                );
                message = i18n.resolve_key(&lang, "oauth", "oauth.callback.providerMismatch");
            } else {
                match save_oauth_callback(
                    OAuthCallbackInput {
                        provider,
                        provider_user_id,
                        username: params.get("username").cloned(),
                        display_name: params.get("display_name").cloned(),
                        created_at: params
                            .get("created_at")
                            .cloned()
                            .or_else(|| params.get("createdAt").cloned())
                            .or_else(|| params.get("register_time").cloned()),
                        email: params.get("email").cloned(),
                        avatar_url: params.get("avatar_url").cloned(),
                        profile_url: params.get("profile_url").cloned(),
                        expires_at: params.get("expires_at").cloned(),
                    },
                    params.get("ts").cloned(),
                    params.get("sig").cloned(),
                ) {
                    Ok(_) => {
                        update_loopback_session(
                            &session_id_for_thread,
                            "completed",
                            Some(callback_url.clone()),
                            None,
                        );
                        ok = true;
                        message = i18n.resolve_key(&lang, "oauth", "oauth.callback.loginComplete");
                    }
                    Err(err) => {
                        let err_message = err
                            .error
                            .as_ref()
                            .map(|e| e.message.clone())
                            .unwrap_or_else(|| "save oauth callback failed".to_string());
                        update_loopback_session(
                            &session_id_for_thread,
                            "failed",
                            Some(callback_url.clone()),
                            Some(err_message),
                        );
                        message = i18n.resolve_key(&lang, "oauth", "oauth.callback.saveFailed");
                    }
                }
            }
            let title = if ok {
                i18n.resolve_key(&lang, "oauth", "oauth.callback.titleSuccess")
            } else {
                i18n.resolve_key(&lang, "oauth", "oauth.callback.titleFailed")
            };
            let auto_close_hint = i18n.resolve_key(&lang, "oauth", "oauth.callback.autoCloseHint");
            let body = format!(
                "<!doctype html><html><head><meta charset=\"utf-8\"><title>Peers Touch</title></head><body style=\"font-family:system-ui,-apple-system,sans-serif;padding:24px\"><h3>{}</h3><p>{}</p><p style=\"color:#666\">{}</p><script>setTimeout(function(){{window.close();}},1200);</script></body></html>",
                title, message, auto_close_hint
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });

    let env = input.environment.unwrap_or_else(|| "prod".to_string());
    let return_to = format!(
        "http://127.0.0.1:{port}/callback?session_id={}",
        urlencoding::encode(&session_id)
    );
    let start_url = provider.callback_url.replace("/callback", "/start");
    let auth_url = format!(
        "{}?site_id=default&return_to={}",
        start_url,
        urlencoding::encode(&return_to),
    );
    success_payload(
        "oauth2_start_loopback",
        json!({ "auth_url": auth_url, "session_id": session_id, "environment": env }),
    )
}

pub fn oauth2_poll_loopback(input: OAuthLoopbackPollInput) -> AppResult<StubPayload> {
    let session_id = input.session_id.trim();
    if session_id.is_empty() {
        return invalid_argument("session_id is required");
    }
    let now = chrono_like_now_unix();
    let mut completed = false;
    let mut callback_url: Option<String> = None;
    let mut status = "pending".to_string();
    let mut error: Option<String> = None;
    if let Ok(mut sessions) = loopback_sessions().lock() {
        for session in sessions.values_mut() {
            if now - session.created_at > 600 && session.status == "pending" {
                session.status = "expired".to_string();
                session.error = Some("authorization timeout".to_string());
                session.completed_at = Some(now);
            }
        }
        if let Some(item) = sessions.get(session_id) {
            status = item.status.clone();
            callback_url = item.callback_url.clone();
            error = item.error.clone();
            if item.status == "completed" || item.status == "failed" || item.status == "expired" {
                completed = true;
            }
        }
        sessions.retain(|_, v| {
            if v.status == "pending" {
                return now - v.created_at <= 600;
            }
            let done_at = v.completed_at.unwrap_or(v.created_at);
            now - done_at <= 60
        });
    }
    success_payload(
        "oauth2_poll_loopback",
        json!({ "completed": completed, "status": status, "callback_url": callback_url, "error": error }),
    )
}

pub fn oauth2_handle_callback(input: OAuthCallbackInput) -> AppResult<StubPayload> {
    try_cmd!(save_oauth_callback(input, None, None));
    success_payload("oauth2_handle_callback", json!({ "status":"ok" }))
}

pub fn oauth2_list_connections() -> AppResult<StubPayload> {
    let map = try_cmd!(read_connections());
    let mut out = Vec::new();
    for conn in map.into_values() {
        out.push(json!({
            "provider_id": conn.provider_id,
            "provider_name": conn.provider_name,
            "user_id": conn.user_id,
            "user_name": conn.user_name,
            "email": conn.email,
            "avatar_url": conn.avatar_url,
            "profile_url": conn.profile_url,
            "connected_at": conn.connected_at,
            "expires_at": conn.expires_at,
            "scopes": conn.scopes,
            "status": conn.status,
        }));
    }
    success_payload("oauth2_list_connections", json!(out))
}

pub fn oauth2_get_connection(input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let map = try_cmd!(read_connections());
    let id = input.id.trim();
    let Some(conn) = map.get(id) else {
        return AppResult::fail(ErrorCode::NotFound, "error.oauth2.connectionNotFound", None);
    };
    success_payload(
        "oauth2_get_connection",
        json!({
            "provider_id": conn.provider_id,
            "provider_name": conn.provider_name,
            "user_id": conn.user_id,
            "user_name": conn.user_name,
            "email": conn.email,
            "avatar_url": conn.avatar_url,
            "profile_url": conn.profile_url,
            "connected_at": conn.connected_at,
            "expires_at": conn.expires_at,
            "scopes": conn.scopes,
            "status": conn.status,
        }),
    )
}

pub fn oauth2_disconnect(input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let mut map = try_cmd!(read_connections());
    map.remove(input.id.trim());
    try_cmd!(write_connections(&map));
    success_payload("oauth2_disconnect", json!({ "status":"ok" }))
}

pub fn oauth2_refresh_token(input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let id = input.id.trim();
    let mut map = try_cmd!(read_connections());
    let Some(conn) = map.get_mut(id) else {
        return AppResult::fail(ErrorCode::NotFound, "error.oauth2.connectionNotFound", None);
    };
    let now = chrono_like_now_unix();
    let new_expires = unix_to_rfc3339(now + 3600);
    conn.expires_at = Some(new_expires);
    conn.status = "active".to_string();
    try_cmd!(write_connections(&map));
    success_payload("oauth2_refresh_token", json!({ "status":"ok" }))
}

pub fn oauth2_call_resource(input: OAuthResourceInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    if input.resource.trim().is_empty() {
        return invalid_argument("resource is required");
    }
    let result = match execute_oauth_connector_tool(
        &json!({
            "provider_id": input.id.trim(),
            "resource": input.resource.trim(),
            "params": input.params.unwrap_or_else(|| json!({}))
        }),
        None,
    ) {
        Ok(result) => result,
        Err(error) => return internal_error(error),
    };
    success_payload("oauth2_call_resource", result)
}

pub fn oauth2_reload() -> AppResult<StubPayload> {
    success_payload("oauth2_reload", json!({ "status":"ok" }))
}

pub fn oauth2_get_page(input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let provider_id = input.id.trim();
    let Some(p) = get_provider(provider_id) else {
        return AppResult::fail(ErrorCode::NotFound, "error.oauth2.providerNotFound", None);
    };
    let (client_id, _, yaml_has_conf) = try_cmd!(read_credentials(provider_id));
    success_payload(
        "oauth2_get_page",
        json!({
            "provider":{
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "icon": p.icon,
                "color": p.color,
                "category": p.category,
                "builtin": true,
                "enabled": p.enabled,
                "oauth2": {
                    "authorize_url": p.authorize_url,
                    "token_url": p.token_url,
                    "revoke_url": p.revoke_url,
                    "userinfo_url": p.userinfo_url,
                    "scopes": p.scopes,
                    "pkce": p.pkce
                }
            },
            "has_credentials": yaml_has_conf && !client_id.is_empty()
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oauth_connector_redacts_secret_like_arguments_bits_ut() {
        let redacted = redact_json_value(&json!({
            "provider_id": "github",
            "resource": "connection.profile",
            "params": {
                "access_token": "gho_raw_token",
                "nested": {
                    "client_secret": "raw-secret",
                    "query": "safe"
                }
            }
        }));

        assert_eq!(
            redacted
                .get("params")
                .and_then(|params| params.get("access_token"))
                .and_then(Value::as_str),
            Some("[redacted]")
        );
        assert_eq!(
            redacted
                .get("params")
                .and_then(|params| params.get("nested"))
                .and_then(|nested| nested.get("client_secret"))
                .and_then(Value::as_str),
            Some("[redacted]")
        );
        assert_eq!(
            redacted
                .get("params")
                .and_then(|params| params.get("nested"))
                .and_then(|nested| nested.get("query"))
                .and_then(Value::as_str),
            Some("safe")
        );
    }

    #[test]
    fn oauth_connector_safe_connection_has_no_token_fields_bits_ut() {
        let conn = OAuthConnectionState {
            provider_id: "github".to_string(),
            provider_name: "GitHub".to_string(),
            user_id: "u1".to_string(),
            user_name: "octo".to_string(),
            email: "octo@example.test".to_string(),
            avatar_url: String::new(),
            profile_url: "https://example.test/octo".to_string(),
            connected_at: "2026-06-17T00:00:00Z".to_string(),
            expires_at: Some("2026-06-17T01:00:00Z".to_string()),
            scopes: vec!["read:user".to_string()],
            status: "active".to_string(),
        };

        let serialized = safe_connection_json(&conn).to_string();

        assert!(serialized.contains("github"));
        assert!(!serialized.contains("access_token"));
        assert!(!serialized.contains("refresh_token"));
        assert!(!serialized.contains("client_secret"));
    }
}
