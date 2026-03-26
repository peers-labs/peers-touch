use crate::error::{AppResult, ErrorCode};
use crate::interface::contracts::{
    OAuthAuthorizeInput, OAuthCallbackInput, OAuthIdInput, OAuthResourceInput, OAuthSetCredentialsInput, StubPayload,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
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

fn success_payload(command: &str, data: serde_json::Value) -> AppResult<StubPayload> {
    AppResult::success(StubPayload {
        command: command.to_string(),
        status: data.to_string(),
    })
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
    let home = std::env::var("HOME").map_err(|_| internal_error("HOME is not set"))?;
    let dir = PathBuf::from(home).join(".peers-touch").join("oauth2");
    if let Err(err) = fs::create_dir_all(&dir) {
        return Err(internal_error(format!("failed to create oauth2 dir: {err}")));
    }
    Ok(dir)
}

fn connections_path() -> CmdResult<PathBuf> {
    Ok(config_dir()?.join("connections.json"))
}

fn credential_path(provider_id: &str) -> CmdResult<PathBuf> {
    Ok(config_dir()?.join(format!("{provider_id}.yml")))
}

fn chrono_like_now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs() as i64
}

fn unix_to_rfc3339(ts: i64) -> String {
    let dt = time::OffsetDateTime::from_unix_timestamp(ts)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
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
            scopes: vec!["openid".to_string(), "profile".to_string(), "email".to_string()],
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
            token_url: "https://open.larksuite.com/open-apis/authen/v1/oidc/access_token".to_string(),
            userinfo_url: Some("https://open.larksuite.com/open-apis/authen/v1/user_info".to_string()),
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
    fs::write(file, content)
        .map_err(|err| internal_error(format!("failed to write credential file: {err}")))?;
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
    fs::write(path, content)
        .map_err(|err| internal_error(format!("failed to write connections file: {err}")))?;
    Ok(())
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
        return AppResult::fail(ErrorCode::NotFound, "provider not found", None);
    };
    success_payload("oauth2_get_provider", json!({
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
    }))
}

pub fn oauth2_get_credential_info(input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let (client_id, client_secret, yaml_has_conf) = try_cmd!(read_credentials(input.id.trim()));
    success_payload("oauth2_get_credential_info", json!({
        "client_id": client_id,
        "secret_masked": mask_secret(&client_secret),
        "source":"yaml",
        "yaml_has_conf": yaml_has_conf
    }))
}

pub fn oauth2_set_credentials(input: OAuthSetCredentialsInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    if input.client_id.trim().is_empty() {
        return invalid_argument("client_id is required");
    }
    if get_provider(input.id.trim()).is_none() {
        return AppResult::fail(ErrorCode::NotFound, "provider not found", None);
    }
    try_cmd!(write_credentials(input.id.trim(), input.client_id.trim(), input.client_secret.trim()));
    success_payload("oauth2_set_credentials", json!({ "status":"ok" }))
}

pub fn oauth2_authorize(input: OAuthAuthorizeInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let provider_id = input.id.trim();
    let Some(provider) = get_provider(provider_id) else {
        return AppResult::fail(ErrorCode::NotFound, "provider not found", None);
    };
    if provider.status == "coming_soon" {
        return AppResult::fail(ErrorCode::Conflict, "provider developing", None);
    }
    let env = input.environment.unwrap_or_else(|| "prod".to_string());
    let return_to = input
        .return_to
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "peers-touch://oauth/callback".to_string());
    let start_url = provider
        .callback_url
        .replace("/callback", "/start");
    let auth_url = format!(
        "{}?site_id=default&return_to={}",
        start_url,
        urlencoding::encode(&return_to),
    );
    success_payload("oauth2_authorize", json!({ "auth_url": auth_url, "environment": env }))
}

pub fn oauth2_handle_callback(input: OAuthCallbackInput) -> AppResult<StubPayload> {
    let provider_id = input.provider.trim();
    if provider_id.is_empty() {
        return invalid_argument("provider is required");
    }
    if get_provider(provider_id).is_none() {
        return AppResult::fail(ErrorCode::NotFound, "provider not found", None);
    }
    if input.provider_user_id.trim().is_empty() {
        return invalid_argument("provider_user_id is required");
    }
    let mut map = try_cmd!(read_connections());
    let now = unix_to_rfc3339(chrono_like_now_unix());
    let expires_at = input
        .expires_at
        .filter(|v| !v.trim().is_empty())
        .or_else(|| Some(unix_to_rfc3339(chrono_like_now_unix() + 3600)));
    let provider_name = get_provider(provider_id)
        .map(|p| p.name)
        .unwrap_or_else(|| provider_id.to_string());
    let user_name = input
        .username
        .filter(|v| !v.trim().is_empty())
        .or(input.display_name)
        .unwrap_or_else(|| input.provider_user_id.clone());
    map.insert(
        provider_id.to_string(),
        OAuthConnectionState {
            provider_id: provider_id.to_string(),
            provider_name,
            user_id: input.provider_user_id,
            user_name,
            email: input.email.unwrap_or_default(),
            avatar_url: input.avatar_url.unwrap_or_default(),
            profile_url: input.profile_url.unwrap_or_default(),
            connected_at: now,
            expires_at,
            scopes: vec![],
            status: "active".to_string(),
        },
    );
    try_cmd!(write_connections(&map));
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
        return AppResult::fail(ErrorCode::NotFound, "connection not found", None);
    };
    success_payload("oauth2_get_connection", json!({
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
    }))
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
        return AppResult::fail(ErrorCode::NotFound, "connection not found", None);
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
    success_payload(
        "oauth2_call_resource",
        json!({
            "ok":true,
            "resource":input.resource,
            "data":input.params.unwrap_or_else(|| json!({}))
        }),
    )
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
        return AppResult::fail(ErrorCode::NotFound, "provider not found", None);
    };
    let (client_id, _, yaml_has_conf) = try_cmd!(read_credentials(provider_id));
    success_payload("oauth2_get_page", json!({
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
    }))
}
