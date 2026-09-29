use crate::application::capability_authority;
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
use crate::model::agent::{
    ConnectorResourceManifest, ConnectorResourceProjection, ConnectorResourceStatus,
    SyncConnectorResourceManifestsRequest, SyncConnectorResourceManifestsResponse,
};
use crate::model::oauth::{OAuthBridgeRequest, OAuthBridgeResponse};
use prost::Message;
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
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

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
    #[serde(default)]
    connection_id: String,
    #[serde(default)]
    revision: u64,
    #[serde(default)]
    projected_revision: u64,
    #[serde(default)]
    owner_ptid: String,
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
    #[serde(default)]
    projected_capabilities: Vec<ProjectedConnectorCapability>,
    #[serde(default)]
    revision_history: Vec<OAuthConnectionRevisionSnapshot>,
    #[serde(default)]
    revocation_idempotency_key: String,
    #[serde(default)]
    revocation_error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ProjectedConnectorCapability {
    capability_id: String,
    capability_version: String,
    tool_name: String,
    resource_id: String,
    resource_version: String,
    status: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct OAuthConnectionRevisionSnapshot {
    connection_id: String,
    revision: u64,
    owner_ptid: String,
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
    projected_capabilities: Vec<ProjectedConnectorCapability>,
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
static CONNECTION_MUTATIONS: OnceLock<Mutex<()>> = OnceLock::new();
static LOOPBACK_COUNTER: AtomicU64 = AtomicU64::new(1);
static CONNECTOR_PROJECTION_EPOCH: AtomicU64 = AtomicU64::new(1);

pub fn connector_projection_epoch() -> u64 {
    CONNECTOR_PROJECTION_EPOCH.load(Ordering::SeqCst)
}

fn advance_connector_projection_epoch() {
    CONNECTOR_PROJECTION_EPOCH.fetch_add(1, Ordering::SeqCst);
}

fn loopback_sessions() -> &'static Mutex<HashMap<String, LoopbackSessionState>> {
    LOOPBACK_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_connection_mutations() -> std::sync::MutexGuard<'static, ()> {
    CONNECTION_MUTATIONS
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
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
    let decode_component = |component: &str| {
        let form_value = component.replace('+', " ");
        urlencoding::decode(&form_value)
            .map(|value| value.into_owned())
            .unwrap_or(form_value)
    };
    query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            (decode_component(key), decode_component(value))
        })
        .collect()
}

fn resolve_loopback_connector_owner(actor_ptid: Option<&str>) -> CmdResult<Option<String>> {
    let Some(actor_ptid) = actor_ptid else {
        return Ok(None);
    };
    let actor_ptid = actor_ptid.trim();
    if !actor_ptid.starts_with("ptid:") {
        return Err(AppResult::fail(
            ErrorCode::Unauthorized,
            "authentication required",
            None,
        ));
    }
    Ok(Some(actor_ptid.to_string()))
}

fn save_oauth_callback(
    input: OAuthCallbackInput,
    ts: Option<String>,
    sig: Option<String>,
    connector_owner_ptid: Option<&str>,
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
    let _mutation_guard = lock_connection_mutations();
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
    let previous = map.get(provider_id).cloned();
    let mut revision_history = previous
        .as_ref()
        .map(|connection| connection.revision_history.clone())
        .unwrap_or_default();
    if let Some(snapshot) = previous.as_ref().and_then(executable_connection_revision) {
        archive_connection_revision(&mut revision_history, snapshot);
    }
    let connection_id = previous
        .as_ref()
        .map(|connection| connection.connection_id.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("oauth_connection_{}", ulid::Ulid::new()));
    let revision = previous
        .as_ref()
        .map(|connection| connection.revision)
        .unwrap_or_default()
        .saturating_add(1)
        .max(1);
    let projected_revision = previous
        .as_ref()
        .map(|connection| connection.projected_revision)
        .unwrap_or_default();
    let owner_ptid = connector_owner_ptid
        .map(str::trim)
        .filter(|value| value.starts_with("ptid:"))
        .map(str::to_string)
        .or_else(|| {
            previous
                .as_ref()
                .map(|connection| connection.owner_ptid.clone())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_default();
    map.insert(
        provider_id.to_string(),
        OAuthConnectionState {
            connection_id,
            revision,
            projected_revision,
            owner_ptid,
            provider_id: provider_id.to_string(),
            provider_name,
            user_id: provider_user_id.clone(),
            user_name: user_name.clone(),
            email: email.clone(),
            avatar_url: avatar_url.clone(),
            profile_url: profile_url.clone(),
            connected_at: now,
            expires_at,
            scopes: normalized_scopes(input.scopes),
            status: "active".to_string(),
            projected_capabilities: Vec::new(),
            revision_history,
            revocation_idempotency_key: String::new(),
            revocation_error: String::new(),
        },
    );
    write_connections(&map)?;
    // Bridge the OAuth identity to Station via oauth-bridge API.
    // On success, persist the returned JWT so the app can load it later
    // via `ensure_station_session`.
    let bridge_req = OAuthBridgeRequest {
        provider: provider_id.to_string(),
        provider_user_id: input.provider_user_id.clone(),
        email: email.clone(),
        username: user_name.clone(),
        display_name: display_name_value,
        avatar_url: avatar_url.clone(),
        ts: ts.clone().unwrap_or_default(),
        sig: sig.clone().unwrap_or_default(),
    };
    if connector_owner_ptid.is_none() {
        match station_client::post_peers_proto_no_auth::<OAuthBridgeRequest, OAuthBridgeResponse>(
            "/actor/oauth-bridge",
            &bridge_req,
        ) {
            Ok(bridge) => {
                if !bridge.access_token.is_empty() {
                    let actor_ptid = bridge
                        .actor_ref
                        .as_ref()
                        .map(|actor| actor.ptid.trim())
                        .filter(|ptid| ptid.starts_with("ptid:"))
                        .ok_or_else(|| {
                            internal_error("OAuth bridge response missing canonical actor PTID")
                        })?;
                    let account_id = auth_identity::upsert_oauth(
                        actor_ptid,
                        provider_id,
                        provider_user_id.as_str(),
                        user_name.as_str(),
                        input.created_at.as_deref(),
                        Some(email.as_str()),
                        Some(avatar_url.as_str()),
                        Some(profile_url.as_str()),
                    )
                    .map_err(internal_error)?;
                    session_vault::persist_raw_session_for_account(
                        &account_id,
                        actor_ptid,
                        &bridge.access_token,
                        SessionSource::OauthBridge,
                    )
                    .map_err(|error| internal_error(&error.to_string()))?;
                    let mut connections = read_connections()?;
                    if let Some(connection) = connections.get_mut(provider_id) {
                        connection.owner_ptid = actor_ptid.to_string();
                    }
                    write_connections(&connections)?;
                }
            }
            Err(e) => {
                tracing::warn!(error = %e, "station oauth-bridge call failed, continuing without station session");
            }
        }
    }

    advance_connector_projection_epoch();
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
/// Returns `Some((actor_ptid, token))` on success, `None` on any failure.
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

    let actor_ptid = bridge
        .actor_ref
        .as_ref()
        .map(|actor| actor.ptid.trim())
        .filter(|ptid| ptid.starts_with("ptid:"))?
        .to_string();
    let account_id = auth_identity::upsert_oauth(
        &actor_ptid,
        &conn.provider_id,
        &conn.user_id,
        &conn.user_name,
        None,
        Some(&conn.email),
        Some(&conn.avatar_url),
        Some(&conn.profile_url),
    )
    .ok()?;
    session_vault::persist_raw_session_for_account(
        &account_id,
        &actor_ptid,
        &bridge.access_token,
        SessionSource::OauthBridge,
    )
    .ok()?;
    Some((actor_ptid, bridge.access_token))
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
    let mut connections: HashMap<String, OAuthConnectionState> = serde_json::from_str(&content)
        .map_err(|err| internal_error(format!("failed to parse connections file: {err}")))?;
    let mut migrated = false;
    for connection in connections.values_mut() {
        if connection.connection_id.trim().is_empty() {
            connection.connection_id = format!("oauth_connection_{}", ulid::Ulid::new());
            migrated = true;
        }
        if connection.revision == 0 {
            connection.revision = 1;
            migrated = true;
        }
        let existing_scopes = std::mem::take(&mut connection.scopes);
        let scopes = normalized_scopes(existing_scopes.clone());
        if scopes != existing_scopes {
            migrated = true;
        }
        connection.scopes = scopes;
        for revision in &mut connection.revision_history {
            let existing_scopes = std::mem::take(&mut revision.scopes);
            let scopes = normalized_scopes(existing_scopes.clone());
            if scopes != existing_scopes {
                migrated = true;
            }
            revision.scopes = scopes;
        }
    }
    if migrated {
        write_connections(&connections)?;
    }
    Ok(connections)
}

fn write_connections(connections: &HashMap<String, OAuthConnectionState>) -> CmdResult<()> {
    let path = connections_path()?;
    let content = serde_json::to_string_pretty(connections)
        .map_err(|err| internal_error(format!("failed to encode connections: {err}")))?;
    storage::write_string_atomic(&path, &content)
        .map_err(|err| internal_error(format!("failed to write connections file: {err:?}")))?;
    Ok(())
}

fn normalized_scopes(scopes: Vec<String>) -> Vec<String> {
    let mut scopes = scopes
        .into_iter()
        .map(|scope| scope.trim().to_string())
        .filter(|scope| !scope.is_empty())
        .collect::<Vec<_>>();
    scopes.sort();
    scopes.dedup();
    scopes
}

fn executable_connection_revision(
    connection: &OAuthConnectionState,
) -> Option<OAuthConnectionRevisionSnapshot> {
    if connection.revision == 0
        || connection.revision != connection.projected_revision
        || connection.status != "active"
    {
        return None;
    }
    Some(connection_revision_snapshot(connection))
}

fn connection_revision_snapshot(
    connection: &OAuthConnectionState,
) -> OAuthConnectionRevisionSnapshot {
    OAuthConnectionRevisionSnapshot {
        connection_id: connection.connection_id.clone(),
        revision: connection.revision,
        owner_ptid: connection.owner_ptid.clone(),
        provider_id: connection.provider_id.clone(),
        provider_name: connection.provider_name.clone(),
        user_id: connection.user_id.clone(),
        user_name: connection.user_name.clone(),
        email: connection.email.clone(),
        avatar_url: connection.avatar_url.clone(),
        profile_url: connection.profile_url.clone(),
        connected_at: connection.connected_at.clone(),
        expires_at: connection.expires_at.clone(),
        scopes: connection.scopes.clone(),
        status: connection.status.clone(),
        projected_capabilities: connection.projected_capabilities.clone(),
    }
}

fn archive_connection_revision(
    history: &mut Vec<OAuthConnectionRevisionSnapshot>,
    snapshot: OAuthConnectionRevisionSnapshot,
) {
    history.retain(|candidate| {
        candidate.connection_id != snapshot.connection_id || candidate.revision != snapshot.revision
    });
    history.push(snapshot);
    history.sort_by(|left, right| {
        left.connection_id
            .cmp(&right.connection_id)
            .then_with(|| left.revision.cmp(&right.revision))
    });
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
        "connection_id": conn.connection_id,
        "revision": conn.revision,
        "projected_revision": conn.projected_revision,
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

fn safe_connection_revision_json(conn: &OAuthConnectionRevisionSnapshot) -> Value {
    json!({
        "connection_id": conn.connection_id,
        "revision": conn.revision,
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

fn safe_connection_revision_status_json(conn: &OAuthConnectionRevisionSnapshot) -> Value {
    json!({
        "connection_id": conn.connection_id,
        "revision": conn.revision,
        "provider_id": conn.provider_id,
        "provider_name": conn.provider_name,
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

fn required_arg_u64(arguments: &Value, key: &str) -> Result<u64, String> {
    arguments
        .get(key)
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .ok_or_else(|| format!("{key} is required"))
}

pub fn execute_oauth_connector_tool(
    actor_ptid: &str,
    capability_id: &str,
    capability_version: &str,
    arguments: &Value,
    call_id: Option<&str>,
) -> Result<Value, String> {
    let connector_id = required_arg_string(arguments, "connector_id")?;
    let oauth_connection_id = required_arg_string(arguments, "oauth_connection_id")?;
    let connection_revision = required_arg_u64(arguments, "connection_revision")?;
    let resource_id = required_arg_string(arguments, "resource_id")?;
    let resource_version = required_arg_string(arguments, "resource_version")?;
    if required_arg_string(arguments, "capability_id")? != capability_id
        || required_arg_string(arguments, "capability_version")? != capability_version
    {
        return Err("CONNECTOR_MANIFEST_STALE".to_string());
    }
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
    let connection = connections
        .get(&connector_id)
        .ok_or_else(|| "CONNECTOR_RESOURCE_REMOVED".to_string())?;
    let revision = resolve_connector_execution_revision(
        connection,
        actor_ptid,
        &oauth_connection_id,
        connection_revision,
    )?;
    if connection_revision_expired(&revision)? {
        return Err("CONNECTOR_OAUTH_EXPIRED".to_string());
    }
    let projected = revision
        .projected_capabilities
        .iter()
        .find(|projected| {
            projected.capability_id == capability_id
                && projected.capability_version == capability_version
                && projected.resource_id == resource_id
                && projected.resource_version == resource_version
        })
        .ok_or_else(|| "CONNECTOR_MANIFEST_STALE".to_string())?;
    if projected.status != ConnectorResourceStatus::Ready as i32 {
        return Err(connector_status_error(projected.status).to_string());
    }
    let output = execute_connection_resource(&revision, &resource_id, params.clone())?;

    Ok(json!({
        "ok": true,
        "toolName": projected.tool_name,
        "callId": call_id.unwrap_or_default(),
        "arguments": redact_json_value(arguments),
        "output": output,
        "params": params,
        "audit": {
            "source": "connector",
            "toolName": projected.tool_name,
            "executionOwner": "desktop-rust",
            "approvalRequired": true,
            "secrets": "redacted",
            "executedAt": unix_to_rfc3339(chrono_like_now_unix())
        }
    }))
}

fn resolve_connector_execution_revision(
    connection: &OAuthConnectionState,
    actor_ptid: &str,
    oauth_connection_id: &str,
    connection_revision: u64,
) -> Result<OAuthConnectionRevisionSnapshot, String> {
    if connection.owner_ptid != actor_ptid {
        return Err("CONNECTOR_ACTOR_MISMATCH".to_string());
    }
    if connection.connection_id == oauth_connection_id && connection.revision == connection_revision
    {
        if connection.status != "active" {
            return Err(connector_execution_error(&connection.status).to_string());
        }
        if connection.projected_revision != connection.revision {
            return Err("CONNECTOR_MANIFEST_STALE".to_string());
        }
        return Ok(connection_revision_snapshot(connection));
    }
    connection
        .revision_history
        .iter()
        .find(|candidate| {
            candidate.owner_ptid == actor_ptid
                && candidate.connection_id == oauth_connection_id
                && candidate.revision == connection_revision
                && candidate.status == "active"
        })
        .cloned()
        .ok_or_else(|| "CONNECTOR_MANIFEST_STALE".to_string())
}

fn execute_connection_resource(
    connection: &OAuthConnectionRevisionSnapshot,
    resource_id: &str,
    params: Value,
) -> Result<Value, String> {
    match resource_id {
        "connection.status" => Ok(json!({
            "resource": resource_id,
            "connection": safe_connection_revision_status_json(connection),
            "params": params,
        })),
        "connection.profile" => Ok(json!({
            "resource": resource_id,
            "connection": safe_connection_revision_json(connection),
            "params": params,
        })),
        _ => Err("CONNECTOR_RESOURCE_REMOVED".to_string()),
    }
}

fn connector_execution_error(status: &str) -> &'static str {
    match status {
        "expired" => "CONNECTOR_OAUTH_EXPIRED",
        "disconnected" => "CONNECTOR_DISCONNECTED",
        "revoked" => "CONNECTOR_PROVIDER_REVOKED",
        "revocation_unconfirmed" => "CONNECTOR_REVOCATION_UNCONFIRMED",
        _ => "CONNECTOR_MANIFEST_STALE",
    }
}

fn connector_status_error(status: i32) -> &'static str {
    match ConnectorResourceStatus::try_from(status) {
        Ok(ConnectorResourceStatus::Expired) => "CONNECTOR_OAUTH_EXPIRED",
        Ok(ConnectorResourceStatus::ScopeDenied) => "CONNECTOR_SCOPE_DENIED",
        Ok(ConnectorResourceStatus::Removed) => "CONNECTOR_RESOURCE_REMOVED",
        Ok(ConnectorResourceStatus::Disconnected) => "CONNECTOR_DISCONNECTED",
        Ok(ConnectorResourceStatus::Revoked) => "CONNECTOR_PROVIDER_REVOKED",
        Ok(ConnectorResourceStatus::RevocationUnconfirmed) => "CONNECTOR_REVOCATION_UNCONFIRMED",
        _ => "CONNECTOR_MANIFEST_STALE",
    }
}

fn connection_expired(connection: &OAuthConnectionState) -> Result<bool, String> {
    connection_revision_expired(&connection_revision_snapshot(connection))
}

fn connection_revision_expired(
    connection: &OAuthConnectionRevisionSnapshot,
) -> Result<bool, String> {
    let Some(expires_at) = connection
        .expires_at
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(false);
    };
    let expires_at = OffsetDateTime::parse(expires_at, &Rfc3339)
        .map_err(|_| "CONNECTOR_EXPIRY_INVALID".to_string())?;
    Ok(expires_at.unix_timestamp() <= chrono_like_now_unix())
}

fn connector_expiry_timestamp(
    connection: &OAuthConnectionState,
) -> Result<Option<prost_types::Timestamp>, String> {
    let Some(expires_at) = connection
        .expires_at
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let expires_at = OffsetDateTime::parse(expires_at, &Rfc3339)
        .map_err(|_| "CONNECTOR_EXPIRY_INVALID".to_string())?;
    Ok(Some(prost_types::Timestamp {
        seconds: expires_at.unix_timestamp(),
        nanos: expires_at.nanosecond() as i32,
    }))
}

fn connector_connection_status(connection: &OAuthConnectionState) -> ConnectorResourceStatus {
    match connection.status.as_str() {
        "active" => ConnectorResourceStatus::Ready,
        "expired" => ConnectorResourceStatus::Expired,
        "disconnected" => ConnectorResourceStatus::Disconnected,
        "revoked" => ConnectorResourceStatus::Revoked,
        "revocation_unconfirmed" => ConnectorResourceStatus::RevocationUnconfirmed,
        _ => ConnectorResourceStatus::ManifestStale,
    }
}

fn connector_resource_projections(
    connection: &OAuthConnectionState,
) -> Vec<ConnectorResourceProjection> {
    let profile_scopes = get_provider(&connection.provider_id)
        .map(|provider| normalized_scopes(provider.scopes))
        .unwrap_or_default();
    vec![
        ConnectorResourceProjection {
            resource_id: "connection.status".to_string(),
            resource_version: "connection-status".to_string(),
            required_scopes: Vec::new(),
            status: ConnectorResourceStatus::Ready as i32,
        },
        ConnectorResourceProjection {
            resource_id: "connection.profile".to_string(),
            resource_version: "connection-profile".to_string(),
            required_scopes: profile_scopes,
            status: ConnectorResourceStatus::Ready as i32,
        },
    ]
}

fn connector_sync_request(
    connection: &OAuthConnectionState,
) -> Result<SyncConnectorResourceManifestsRequest, String> {
    Ok(SyncConnectorResourceManifestsRequest {
        connector_id: connection.provider_id.clone(),
        oauth_connection_id: connection.connection_id.clone(),
        expected_connection_revision: connection.projected_revision,
        connection_revision: connection.revision,
        granted_scopes: connection.scopes.clone(),
        connection_status: connector_connection_status(connection) as i32,
        expires_at: connector_expiry_timestamp(connection)?,
        resources: connector_resource_projections(connection),
        idempotency_key: format!(
            "connector-sync:{}:{}",
            connection.connection_id, connection.revision
        ),
    })
}

fn apply_connector_sync_response(
    connection: &mut OAuthConnectionState,
    response: &SyncConnectorResourceManifestsResponse,
) {
    connection.projected_revision = connection.revision;
    connection.projected_capabilities = projected_connector_capabilities(response);
}

fn reconcile_connector_station_head(
    connection: &mut OAuthConnectionState,
    current: &[ConnectorResourceManifest],
) -> Result<(), String> {
    let Some(first) = current.first() else {
        return Ok(());
    };
    let current_revision = first.connection_revision;
    let current_connection_id = first.oauth_connection_id.as_str();
    if current.iter().any(|resource| {
        resource.connection_revision != current_revision
            || resource.oauth_connection_id != current_connection_id
    }) {
        return Err("CONNECTOR_STATION_HEAD_INCONSISTENT".to_string());
    }
    if current_revision >= connection.revision
        && (current_connection_id != connection.connection_id
            || connection.projected_revision != current_revision)
    {
        connection.projected_revision = current_revision;
        connection.revision = current_revision
            .checked_add(1)
            .ok_or_else(|| "CONNECTOR_REVISION_EXHAUSTED".to_string())?;
    }
    Ok(())
}

fn connector_projection_matches_station_head(
    connection: &OAuthConnectionState,
    current: &[ConnectorResourceManifest],
) -> bool {
    connection.revision == connection.projected_revision
        && !current.is_empty()
        && current.iter().all(|resource| {
            resource.oauth_connection_id == connection.connection_id
                && resource.connection_revision == connection.revision
        })
}

fn connector_revocation_is_projected(connection: &OAuthConnectionState) -> bool {
    connection.status == "revocation_unconfirmed"
        && connection.revision > 0
        && connection.projected_revision == connection.revision
}

pub fn sync_connector_manifests(actor_ptid: &str, token: &str) -> AppResult<Vec<u8>> {
    if !actor_ptid.starts_with("ptid:") || token.trim().is_empty() {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "agent.connectorManifestSyncUnauthorized",
            None,
        );
    }
    let _mutation_guard = lock_connection_mutations();
    let mut connections = match read_connections() {
        Ok(connections) => connections,
        Err(error) => return connector_sync_error(error),
    };
    let previous_contracts = projected_connector_contracts(&connections, actor_ptid);
    let mut connector_ids = connections
        .iter()
        .filter(|(_, connection)| connection.owner_ptid == actor_ptid)
        .map(|(connector_id, _)| connector_id.clone())
        .collect::<Vec<_>>();
    connector_ids.sort();

    let mut merged = SyncConnectorResourceManifestsResponse::default();
    for connector_id in connector_ids {
        let connection = match connections.get_mut(&connector_id) {
            Some(connection) => connection,
            None => continue,
        };
        let station_resources =
            match capability_authority::list_connector_manifest_records(&connector_id, token) {
                Ok(resources) => resources,
                Err(error) => {
                    return error.into_app_result("agent.connectorManifestListFailed");
                }
            };
        if let Err(error) = reconcile_connector_station_head(connection, &station_resources) {
            return AppResult::fail(
                ErrorCode::Conflict,
                "agent.connectorManifestSyncFailed",
                Some(json!({ "cause": error })),
            );
        }
        if connector_projection_matches_station_head(connection, &station_resources) {
            merged.manifests.extend(station_resources);
            continue;
        }
        if connection.status == "active" {
            match connection_expired(connection) {
                Ok(true) => {
                    if let Some(snapshot) = executable_connection_revision(connection) {
                        archive_connection_revision(&mut connection.revision_history, snapshot);
                    }
                    connection.status = "expired".to_string();
                    connection.revision = connection.revision.saturating_add(1);
                }
                Ok(false) => {}
                Err(error) => {
                    return AppResult::fail(
                        ErrorCode::InvalidArgument,
                        "agent.connectorExpiryInvalid",
                        Some(json!({ "cause": error })),
                    );
                }
            }
        }
        let request = match connector_sync_request(connection) {
            Ok(request) => request,
            Err(error) => {
                return AppResult::fail(
                    ErrorCode::InvalidArgument,
                    "agent.connectorExpiryInvalid",
                    Some(json!({ "cause": error })),
                );
            }
        };
        let response = match capability_authority::sync_connector_manifest_records(&request, token)
        {
            Ok(response) => response,
            Err(error) => {
                return error.into_app_result("agent.connectorManifestSyncFailed");
            }
        };
        apply_connector_sync_response(connection, &response);
        merged.manifests.extend(response.manifests);
        merged
            .capability_manifests
            .extend(response.capability_manifests);
    }
    if let Err(error) = write_connections(&connections) {
        return connector_sync_error(error);
    }
    if previous_contracts != projected_connector_contracts(&connections, actor_ptid) {
        advance_connector_projection_epoch();
    }
    AppResult::success(merged.encode_to_vec())
}

fn connector_sync_error(error: AppResult<StubPayload>) -> AppResult<Vec<u8>> {
    match error.error {
        Some(error) => AppResult::fail(error.code, error.message, error.details),
        None => AppResult::fail(
            ErrorCode::InternalError,
            "agent.connectorManifestSyncFailed",
            None,
        ),
    }
}

fn projected_connector_capabilities(
    response: &SyncConnectorResourceManifestsResponse,
) -> Vec<ProjectedConnectorCapability> {
    let manifests = response
        .capability_manifests
        .iter()
        .map(|manifest| {
            (
                (manifest.capability_id.as_str(), manifest.version.as_str()),
                manifest,
            )
        })
        .collect::<HashMap<_, _>>();
    response
        .manifests
        .iter()
        .flat_map(|resource| {
            resource.tool_manifests.iter().filter_map(|reference| {
                let manifest = manifests.get(&(
                    reference.capability_id.as_str(),
                    reference.capability_version.as_str(),
                ))?;
                Some(ProjectedConnectorCapability {
                    capability_id: reference.capability_id.clone(),
                    capability_version: reference.capability_version.clone(),
                    tool_name: manifest.source_instance_id.clone(),
                    resource_id: resource.resource_id.clone(),
                    resource_version: resource.resource_version.clone(),
                    status: resource.status,
                })
            })
        })
        .collect()
}

pub fn connector_capability_contracts(actor_ptid: &str) -> Result<Vec<(String, String)>, String> {
    let connections = read_connections().map_err(|error| {
        error
            .error
            .map(|error| error.message)
            .unwrap_or_else(|| "CONNECTOR_STATE_UNAVAILABLE".to_string())
    })?;
    Ok(projected_connector_contracts(&connections, actor_ptid))
}

fn projected_connector_contracts(
    connections: &HashMap<String, OAuthConnectionState>,
    actor_ptid: &str,
) -> Vec<(String, String)> {
    let mut contracts = connections
        .values()
        .filter(|connection| {
            connection.owner_ptid == actor_ptid
                && connection.status == "active"
                && connection.projected_revision == connection.revision
                && !connection_expired(connection).unwrap_or(true)
        })
        .flat_map(|connection| connection.projected_capabilities.iter())
        .filter(|capability| capability.status == ConnectorResourceStatus::Ready as i32)
        .map(|capability| {
            (
                capability.capability_id.clone(),
                capability.capability_version.clone(),
            )
        })
        .collect::<Vec<_>>();
    contracts.sort();
    contracts.dedup();
    contracts
}

pub fn oauth2_list_providers() -> AppResult<StubPayload> {
    let mut out = Vec::new();
    for p in provider_catalog() {
        let (client_id, _, has_yaml) = try_cmd!(read_credentials(&p.id));
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
            "connected": false,
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
    actor_ptid: Option<&str>,
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
    let connector_owner_ptid = match resolve_loopback_connector_owner(actor_ptid) {
        Ok(value) => value,
        Err(error) => return error,
    };

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
                        scopes: params
                            .get("scope")
                            .or_else(|| params.get("scopes"))
                            .map(|value| {
                                value
                                    .split(|character| character == ' ' || character == ',')
                                    .map(str::to_string)
                                    .collect()
                            })
                            .unwrap_or_default(),
                    },
                    params.get("ts").cloned(),
                    params.get("sig").cloned(),
                    connector_owner_ptid.as_deref(),
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
    try_cmd!(save_oauth_callback(input, None, None, None));
    success_payload("oauth2_handle_callback", json!({ "status":"ok" }))
}

pub fn oauth2_list_connections(actor_ptid: &str) -> AppResult<StubPayload> {
    let map = try_cmd!(read_connections());
    let mut out = Vec::new();
    for conn in map
        .into_values()
        .filter(|connection| connection.owner_ptid == actor_ptid)
    {
        out.push(json!({
            "connection_id": conn.connection_id,
            "revision": conn.revision,
            "projected_revision": conn.projected_revision,
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

pub fn oauth2_get_connection(actor_ptid: &str, input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let map = try_cmd!(read_connections());
    let id = input.id.trim();
    let Some(conn) = map.get(id) else {
        return AppResult::fail(ErrorCode::NotFound, "error.oauth2.connectionNotFound", None);
    };
    if conn.owner_ptid != actor_ptid {
        return AppResult::fail(ErrorCode::Forbidden, "agent.errors.forbiddenActor", None);
    }
    success_payload(
        "oauth2_get_connection",
        json!({
            "connection_id": conn.connection_id,
            "revision": conn.revision,
            "projected_revision": conn.projected_revision,
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

pub fn oauth2_disconnect(
    actor_ptid: &str,
    token: &str,
    input: OAuthIdInput,
) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let _mutation_guard = lock_connection_mutations();
    let mut map = try_cmd!(read_connections());
    let Some(current) = map.get(input.id.trim()) else {
        return AppResult::fail(ErrorCode::NotFound, "error.oauth2.connectionNotFound", None);
    };
    if current.owner_ptid != actor_ptid {
        return AppResult::fail(ErrorCode::Forbidden, "agent.errors.forbiddenActor", None);
    }
    if connector_revocation_is_projected(current) {
        return success_payload(
            "oauth2_disconnect",
            json!({
                "status": "revocation_unconfirmed",
                "provider_revoke": {
                    "status": "unconfirmed",
                    "error_code": current.revocation_error,
                    "idempotency_key": current.revocation_idempotency_key,
                }
            }),
        );
    }
    let mut disconnected = current.clone();
    if disconnected.status != "revocation_unconfirmed" {
        if let Some(snapshot) = executable_connection_revision(&disconnected) {
            archive_connection_revision(&mut disconnected.revision_history, snapshot);
        }
        disconnected.revocation_idempotency_key = format!(
            "connector-revoke:{}:{}",
            disconnected.connection_id, disconnected.revision,
        );
        disconnected.revocation_error = "CONNECTOR_PROVIDER_REVOKE_UNCONFIRMED".to_string();
        disconnected.status = "revocation_unconfirmed".to_string();
        disconnected.revision = disconnected.revision.saturating_add(1);
    }
    let request = match connector_sync_request(&disconnected) {
        Ok(request) => request,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "agent.connectorExpiryInvalid",
                Some(json!({ "cause": error })),
            );
        }
    };
    let response = match capability_authority::sync_connector_manifest_records(&request, token) {
        Ok(response) => response,
        Err(error) => {
            return error.into_app_result("agent.connectorManifestSyncFailed");
        }
    };
    apply_connector_sync_response(&mut disconnected, &response);
    let revocation_error = disconnected.revocation_error.clone();
    let revocation_idempotency_key = disconnected.revocation_idempotency_key.clone();
    map.insert(input.id.trim().to_string(), disconnected);
    if let Err(error) = write_connections(&map) {
        return match connector_sync_error(error).error {
            Some(error) => AppResult::fail(error.code, error.message, error.details),
            None => internal_error("agent.connectorManifestSyncFailed"),
        };
    }
    advance_connector_projection_epoch();
    success_payload(
        "oauth2_disconnect",
        json!({
            "status": "revocation_unconfirmed",
            "provider_revoke": {
                "status": "unconfirmed",
                "error_code": revocation_error,
                "idempotency_key": revocation_idempotency_key,
            }
        }),
    )
}

pub fn oauth2_refresh_token(actor_ptid: &str, input: OAuthIdInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let _mutation_guard = lock_connection_mutations();
    let id = input.id.trim();
    let mut map = try_cmd!(read_connections());
    let Some(conn) = map.get_mut(id) else {
        return AppResult::fail(ErrorCode::NotFound, "error.oauth2.connectionNotFound", None);
    };
    if conn.owner_ptid != actor_ptid {
        return AppResult::fail(ErrorCode::Forbidden, "agent.errors.forbiddenActor", None);
    }
    if matches!(
        conn.status.as_str(),
        "disconnected" | "revoked" | "revocation_unconfirmed"
    ) {
        return AppResult::fail(
            ErrorCode::Conflict,
            "agent.errors.connectorRevocationUnconfirmed",
            None,
        );
    }
    if let Some(snapshot) = executable_connection_revision(conn) {
        archive_connection_revision(&mut conn.revision_history, snapshot);
    }
    let now = chrono_like_now_unix();
    let new_expires = unix_to_rfc3339(now + 3600);
    conn.expires_at = Some(new_expires);
    conn.status = "active".to_string();
    conn.revision = conn.revision.saturating_add(1);
    conn.projected_capabilities.clear();
    conn.revocation_idempotency_key.clear();
    conn.revocation_error.clear();
    try_cmd!(write_connections(&map));
    advance_connector_projection_epoch();
    success_payload("oauth2_refresh_token", json!({ "status":"ok" }))
}

pub fn oauth2_call_resource(actor_ptid: &str, input: OAuthResourceInput) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    if input.resource.trim().is_empty() {
        return invalid_argument("resource is required");
    }
    let connections = try_cmd!(read_connections());
    let Some(connection) = connections.get(input.id.trim()) else {
        return AppResult::fail(ErrorCode::NotFound, "error.oauth2.connectionNotFound", None);
    };
    if connection.owner_ptid != actor_ptid {
        return AppResult::fail(ErrorCode::Forbidden, "agent.errors.forbiddenActor", None);
    }
    if connection.status != "active" {
        return AppResult::fail(
            ErrorCode::Conflict,
            connector_execution_error(&connection.status),
            None,
        );
    }
    let result = match execute_connection_resource(
        &connection_revision_snapshot(connection),
        input.resource.trim(),
        input.params.unwrap_or_else(|| json!({})),
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
    fn loopback_query_parser_decodes_form_encoded_spaces_bits_ut() {
        let params = parse_query_params(
            "/callback?scope=read%3Auser+user%3Aemail&display_name=Connector+Fixture",
        );

        assert_eq!(
            params.get("scope").map(String::as_str),
            Some("read:user user:email"),
        );
        assert_eq!(
            params.get("display_name").map(String::as_str),
            Some("Connector Fixture"),
        );
    }

    #[test]
    fn loopback_owner_mode_distinguishes_login_from_connector_bits_ut() {
        assert_eq!(
            resolve_loopback_connector_owner(None)
                .expect("pre-authentication OAuth must select login mode"),
            None,
        );
        assert_eq!(
            resolve_loopback_connector_owner(Some("  ptid:person:owner  "))
                .expect("authenticated OAuth must preserve connector ownership"),
            Some("ptid:person:owner".to_string()),
        );
        assert!(
            resolve_loopback_connector_owner(Some("not-a-ptid")).is_err(),
            "an invalid authenticated owner must fail closed",
        );
    }

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
            ..Default::default()
        };

        let serialized = safe_connection_json(&conn).to_string();

        assert!(serialized.contains("github"));
        assert!(!serialized.contains("access_token"));
        assert!(!serialized.contains("refresh_token"));
        assert!(!serialized.contains("client_secret"));
    }

    #[test]
    fn connector_dispatch_first_uses_pinned_archived_revision_bits_ut() {
        let capability = ProjectedConnectorCapability {
            capability_id: format!("connector.resource.{}", "a".repeat(64)),
            capability_version: "version-1".to_string(),
            tool_name: "connector_resource_aaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            resource_id: "connection.profile".to_string(),
            resource_version: "connection-profile".to_string(),
            status: ConnectorResourceStatus::Ready as i32,
        };
        let mut connection = OAuthConnectionState {
            connection_id: "oauth-connection-1".to_string(),
            revision: 1,
            projected_revision: 1,
            owner_ptid: "ptid:person:owner".to_string(),
            provider_id: "github".to_string(),
            provider_name: "GitHub".to_string(),
            user_id: "u1".to_string(),
            user_name: "octo".to_string(),
            email: "octo@example.test".to_string(),
            avatar_url: String::new(),
            profile_url: "https://example.test/octo".to_string(),
            connected_at: "2026-06-17T00:00:00Z".to_string(),
            expires_at: Some("2099-06-17T01:00:00Z".to_string()),
            scopes: vec!["read:user".to_string()],
            status: "active".to_string(),
            projected_capabilities: vec![capability.clone()],
            ..Default::default()
        };
        let pinned = executable_connection_revision(&connection)
            .expect("active projected revision must be executable");
        archive_connection_revision(&mut connection.revision_history, pinned);
        connection.revision = 2;
        connection.projected_revision = 2;
        connection.status = "revocation_unconfirmed".to_string();
        connection.projected_capabilities = vec![ProjectedConnectorCapability {
            status: ConnectorResourceStatus::RevocationUnconfirmed as i32,
            ..capability.clone()
        }];

        let archived = resolve_connector_execution_revision(
            &connection,
            "ptid:person:owner",
            "oauth-connection-1",
            1,
        )
        .expect("dispatch committed before disconnect must keep its pinned revision");
        let output = execute_connection_resource(&archived, "connection.status", json!({}))
            .expect("archived status resource must execute");
        let serialized = output.to_string();
        assert!(serialized.contains("\"revision\":1"));
        assert!(!serialized.contains("octo@example.test"));
        assert_eq!(
            resolve_connector_execution_revision(
                &connection,
                "ptid:person:owner",
                "oauth-connection-1",
                2,
            )
            .expect_err("current disconnected revision must reject"),
            "CONNECTOR_REVOCATION_UNCONFIRMED",
        );
        assert_eq!(
            resolve_connector_execution_revision(
                &connection,
                "ptid:person:other",
                "oauth-connection-1",
                1,
            )
            .expect_err("cross-actor archived revision must reject"),
            "CONNECTOR_ACTOR_MISMATCH",
        );
    }

    #[test]
    fn connector_new_local_connection_advances_station_head_bits_ut() {
        let mut connection = OAuthConnectionState {
            connection_id: "oauth-connection-new".to_string(),
            revision: 1,
            provider_id: "github".to_string(),
            ..Default::default()
        };
        let current = vec![ConnectorResourceManifest {
            oauth_connection_id: "oauth-connection-old".to_string(),
            connection_revision: 7,
            ..Default::default()
        }];

        reconcile_connector_station_head(&mut connection, &current)
            .expect("new local connection must advance the Station head");

        assert_eq!(connection.projected_revision, 7);
        assert_eq!(connection.revision, 8);
    }

    #[test]
    fn connector_same_connection_advances_external_station_head_bits_ut() {
        let mut connection = OAuthConnectionState {
            connection_id: "oauth-connection-1".to_string(),
            revision: 3,
            projected_revision: 3,
            provider_id: "github".to_string(),
            ..Default::default()
        };
        let current = vec![ConnectorResourceManifest {
            oauth_connection_id: "oauth-connection-1".to_string(),
            connection_revision: 4,
            ..Default::default()
        }];

        reconcile_connector_station_head(&mut connection, &current)
            .expect("external Station revision must advance local projection");

        assert_eq!(connection.projected_revision, 4);
        assert_eq!(connection.revision, 5);
    }

    #[test]
    fn connector_already_projected_station_head_is_a_sync_noop_bits_ut() {
        let connection = OAuthConnectionState {
            connection_id: "oauth-connection-1".to_string(),
            revision: 5,
            projected_revision: 5,
            provider_id: "github".to_string(),
            ..Default::default()
        };
        let current = vec![ConnectorResourceManifest {
            oauth_connection_id: "oauth-connection-1".to_string(),
            connection_revision: 5,
            ..Default::default()
        }];

        assert!(connector_projection_matches_station_head(
            &connection,
            &current,
        ));

        let mut unprojected = connection.clone();
        unprojected.revision = 6;
        assert!(!connector_projection_matches_station_head(
            &unprojected,
            &current,
        ));
    }

    #[test]
    fn connector_projected_revocation_is_idempotent_bits_ut() {
        let projected = OAuthConnectionState {
            revision: 6,
            projected_revision: 6,
            status: "revocation_unconfirmed".to_string(),
            ..Default::default()
        };
        assert!(connector_revocation_is_projected(&projected));

        let mut pending = projected.clone();
        pending.projected_revision = 5;
        assert!(!connector_revocation_is_projected(&pending));
    }

    #[test]
    fn connector_unprojected_revision_is_not_advertised_bits_ut() {
        let mut connections = HashMap::from([(
            "github".to_string(),
            OAuthConnectionState {
                connection_id: "oauth-connection-1".to_string(),
                revision: 2,
                projected_revision: 1,
                owner_ptid: "ptid:person:owner".to_string(),
                provider_id: "github".to_string(),
                status: "active".to_string(),
                projected_capabilities: vec![ProjectedConnectorCapability {
                    capability_id: format!("connector.resource.{}", "a".repeat(64),),
                    capability_version: "version-1".to_string(),
                    status: ConnectorResourceStatus::Ready as i32,
                    ..Default::default()
                }],
                ..Default::default()
            },
        )]);

        assert!(projected_connector_contracts(&connections, "ptid:person:owner",).is_empty());
        connections.get_mut("github").unwrap().projected_revision = 2;
        assert_eq!(
            projected_connector_contracts(&connections, "ptid:person:owner",).len(),
            1,
        );
        assert!(projected_connector_contracts(&connections, "ptid:person:other",).is_empty());
    }
}
