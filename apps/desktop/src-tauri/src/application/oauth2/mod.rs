use crate::application::capability_authority;
use crate::application::security::redact_json_value;
use crate::contracts::{
    OAuthAuthorizeInput, OAuthCallbackInput, OAuthIdInput, OAuthLoopbackPollInput,
    OAuthLoopbackStartInput, OAuthResourceInput, OAuthSetCredentialsInput, StubPayload,
};
use crate::domain::crypto::{aes_gcm_decrypt, aes_gcm_encrypt, hkdf_sha256};
use crate::domain::storage::key_management::KeyProvider;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::auth_identity;
use crate::infrastructure::i18n::I18nService;
use crate::infrastructure::session_store::{self, PersistedSession, SessionSource};
use crate::infrastructure::session_vault;
use crate::infrastructure::station_client;
use crate::infrastructure::storage::key_provider::PlatformKeyProvider;
use crate::infrastructure::storage::{self, StorageKind};
use crate::model::access_gate::{AccessDecision, AccessDecisionState};
use crate::model::agent::{
    ConnectorResourceManifest, ConnectorResourceProjection, ConnectorResourceStatus,
    SyncConnectorResourceManifestsRequest, SyncConnectorResourceManifestsResponse,
};
use crate::model::auth::LoginResponse;
use crate::model::oauth::bridge::{
    BrokerOAuthBridgeRequest, BrokerOAuthBridgeResponse, BrokerOAuthConnectorLinkResponse,
};
use crate::model::oauth::mobile::{
    AcknowledgeOAuthCredentialRequest, AcknowledgeOAuthCredentialResponse,
    CancelOAuthAttemptRequest, CancelOAuthAttemptResponse, CompleteOAuthAttemptResponse,
    GetOAuthAttemptRequest, GetOAuthAttemptResponse, OAuthAttemptResult, OAuthAttemptState,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use prost::Message;
use rand::{rngs::OsRng, RngCore};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroize;

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
    access_decision: Option<Value>,
    created_at: i64,
    completed_at: Option<i64>,
}

static LOOPBACK_SESSIONS: OnceLock<Mutex<HashMap<String, LoopbackSessionState>>> = OnceLock::new();
static PENDING_BROKER_LOGINS: OnceLock<Mutex<HashMap<String, PendingBrokerLogin>>> =
    OnceLock::new();
static CONNECTION_MUTATIONS: OnceLock<Mutex<()>> = OnceLock::new();
static CONNECTOR_PROJECTION_EPOCH: AtomicU64 = AtomicU64::new(1);
const LOOPBACK_SESSION_TTL_SECONDS: i64 = 600;
const LOOPBACK_TERMINAL_RETENTION_SECONDS: i64 = 60;
const BROKER_ACK_MAX_ATTEMPTS: usize = 3;
const BROKER_ACK_RETRY_DELAY: Duration = Duration::from_millis(100);
const BROKER_ACK_RECOVERY_RETRY_SECONDS: i64 = 2;
const BROKER_ACK_RECOVERY_SCHEMA_VERSION: u32 = 1;
const BROKER_ACK_RECOVERY_KEY_PREFIX: &str = "oauth-acknowledgement-recovery";
const BROKER_ACK_RECOVERY_AAD_DOMAIN: &str = "peers-touch/oauth-acknowledgement-recovery";

#[derive(Debug, Clone)]
pub struct OAuthConnectorAuthorization {
    pub actor_ptid: String,
    pub token: String,
}

#[derive(Debug, Clone)]
struct BrokerAccessBinding {
    station_peer_id: String,
    access_attempt_id: String,
    gate_id: String,
    device_id: String,
    lifecycle_generation: u64,
    attempt_secret: Vec<u8>,
    delivery_private_key: [u8; 32],
    delivery_public_key: Vec<u8>,
}

#[derive(Debug, Clone)]
struct PendingBrokerLogin {
    input: OAuthCallbackInput,
    binding: BrokerAccessBinding,
    oauth_attempt_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedBrokerReceiverBinding {
    station_peer_id: String,
    access_attempt_id: String,
    device_id: String,
    lifecycle_generation: u64,
    attempt_secret: String,
}

impl PersistedBrokerReceiverBinding {
    fn from_runtime(binding: &BrokerAccessBinding) -> Self {
        Self {
            station_peer_id: binding.station_peer_id.clone(),
            access_attempt_id: binding.access_attempt_id.clone(),
            device_id: binding.device_id.clone(),
            lifecycle_generation: binding.lifecycle_generation,
            attempt_secret: URL_SAFE_NO_PAD.encode(&binding.attempt_secret),
        }
    }

    fn receiver_secret(&self) -> Result<Vec<u8>, String> {
        URL_SAFE_NO_PAD
            .decode(self.attempt_secret.as_bytes())
            .map_err(|error| format!("decode OAuth acknowledgement receiver secret: {error}"))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum BrokerAcknowledgementRecoveryPhase {
    Prepared,
    LocalPersisted,
    CancellationRequested,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingBrokerAcknowledgement {
    loopback_session_id: String,
    account_id: String,
    actor_ptid: String,
    oauth_attempt_id: String,
    binding: PersistedBrokerReceiverBinding,
    phase: BrokerAcknowledgementRecoveryPhase,
    next_retry_at: i64,
    previous_connections: HashMap<String, OAuthConnectionState>,
    previous_identity_state: auth_identity::AccountIdentityState,
    previous_session: Option<PersistedSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BrokerAcknowledgementRecoveryStore {
    schema_version: u32,
    records: HashMap<String, PendingBrokerAcknowledgement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BrokerAcknowledgementRecoveryEnvelope {
    schema_version: u32,
    key_id: String,
    key_version: i32,
    nonce: String,
    ciphertext: String,
}

impl Default for BrokerAcknowledgementRecoveryStore {
    fn default() -> Self {
        Self {
            schema_version: BROKER_ACK_RECOVERY_SCHEMA_VERSION,
            records: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BrokerAcknowledgementFailureDisposition {
    Retryable,
    CancelSafe,
    Terminal,
}

#[derive(Debug)]
struct BrokerAcknowledgementFailure {
    message: String,
    disposition: BrokerAcknowledgementFailureDisposition,
}

enum OAuthCallbackOutcome {
    Completed,
    AcknowledgementPending,
    FollowingGate {
        decision: AccessDecision,
        pending: PendingBrokerLogin,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum BrokerAcknowledgementRecovery {
    Ready,
    Pending,
    Rejected(String),
}

pub fn connector_projection_epoch() -> u64 {
    CONNECTOR_PROJECTION_EPOCH.load(Ordering::SeqCst)
}

fn advance_connector_projection_epoch() {
    CONNECTOR_PROJECTION_EPOCH.fetch_add(1, Ordering::SeqCst);
}

fn loopback_sessions() -> &'static Mutex<HashMap<String, LoopbackSessionState>> {
    LOOPBACK_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn pending_broker_logins() -> &'static Mutex<HashMap<String, PendingBrokerLogin>> {
    PENDING_BROKER_LOGINS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_connection_mutations() -> std::sync::MutexGuard<'static, ()> {
    CONNECTION_MUTATIONS
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn next_loopback_session_id() -> Result<String, String> {
    let mut random = [0_u8; 24];
    OsRng
        .try_fill_bytes(&mut random)
        .map_err(|error| format!("generate OAuth loopback session ID: {error}"))?;
    Ok(format!("lp-{}", hex::encode(random)))
}

fn next_loopback_receiver_proof() -> Result<(String, String), String> {
    let mut random = [0_u8; 32];
    OsRng
        .try_fill_bytes(&mut random)
        .map_err(|error| format!("generate OAuth receiver verifier: {error}"))?;
    let verifier = URL_SAFE_NO_PAD.encode(random);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    Ok((verifier, challenge))
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
                item.access_decision = None;
                item.completed_at = Some(chrono_like_now_unix());
            }
        }
    }
}

fn loopback_session_allows_activation(session_id: &str) -> bool {
    loopback_sessions()
        .lock()
        .ok()
        .and_then(|sessions| {
            sessions
                .get(session_id)
                .map(|item| item.status.as_str().to_string())
        })
        .map(|status| {
            status != "cancelling"
                && status != "failed"
                && status != "expired"
                && status != "completed"
        })
        .unwrap_or(false)
}

fn request_loopback_cancellation(session_id: &str) -> Result<bool, String> {
    let mut sessions = loopback_sessions()
        .lock()
        .map_err(|_| "OAuth loopback registry is unavailable".to_string())?;
    let Some(item) = sessions.get_mut(session_id) else {
        return Ok(false);
    };
    if item.status == "completed" {
        return Ok(true);
    }
    item.status = "cancelling".to_string();
    item.error = Some("cancelled".to_string());
    Ok(false)
}

fn update_loopback_following_gate(
    session_id: &str,
    callback_url: String,
    decision: &AccessDecision,
    pending: PendingBrokerLogin,
) -> Result<(), String> {
    let projection = crate::application::auth::service::project_access_decision(decision)?;
    let mut logins = pending_broker_logins()
        .lock()
        .map_err(|_| "OAuth pending-login registry is unavailable".to_string())?;
    let mut sessions = loopback_sessions()
        .lock()
        .map_err(|_| "OAuth loopback registry is unavailable".to_string())?;
    let item = sessions
        .get_mut(session_id)
        .ok_or_else(|| "OAuth loopback session is unavailable".to_string())?;
    item.status = "action_required".to_string();
    item.callback_url = Some(callback_url);
    item.error = None;
    item.access_decision =
        Some(serde_json::to_value(projection).map_err(|error| error.to_string())?);
    item.completed_at = Some(chrono_like_now_unix());
    let created_at = item.created_at;
    logins.insert(session_id.to_string(), pending);
    drop(sessions);
    drop(logins);
    schedule_pending_broker_cleanup(session_id.to_string(), created_at);
    Ok(())
}

fn cleanup_expired_loopback_sessions(now: i64) {
    let pending = {
        let Ok(mut logins) = pending_broker_logins().lock() else {
            return;
        };
        let Ok(mut sessions) = loopback_sessions().lock() else {
            return;
        };
        let expired_ids = expire_loopback_sessions(&mut sessions, now);
        let pending = expired_ids
            .iter()
            .filter_map(|session_id| logins.remove(session_id))
            .collect::<Vec<_>>();
        pending
    };
    for login in pending {
        if let Err(error) = cancel_broker_login(&login.binding, &login.oauth_attempt_id) {
            tracing::warn!(
                oauth_attempt_id = %login.oauth_attempt_id,
                error = ?error.error,
                "failed to cancel expired broker OAuth candidate"
            );
        }
    }
}

fn expire_loopback_sessions(
    sessions: &mut HashMap<String, LoopbackSessionState>,
    now: i64,
) -> Vec<String> {
    let expired_ids = sessions
        .iter_mut()
        .filter_map(|(session_id, session)| {
            if now - session.created_at < LOOPBACK_SESSION_TTL_SECONDS
                || (session.status != "pending"
                    && session.status != "action_required"
                    && session.status != "acknowledgement_pending"
                    && session.status != "cancelling")
            {
                return None;
            }
            session.status = "expired".to_string();
            session.error = Some("authorization timeout".to_string());
            session.access_decision = None;
            session.completed_at = Some(now);
            Some(session_id.clone())
        })
        .collect::<Vec<_>>();
    sessions.retain(|_, session| {
        if session.status == "pending"
            || session.status == "action_required"
            || session.status == "acknowledgement_pending"
            || session.status == "cancelling"
        {
            return now - session.created_at < LOOPBACK_SESSION_TTL_SECONDS;
        }
        let done_at = session.completed_at.unwrap_or(session.created_at);
        now - done_at <= LOOPBACK_TERMINAL_RETENTION_SECONDS
    });
    expired_ids
}

fn schedule_pending_broker_cleanup(session_id: String, created_at: i64) {
    thread::spawn(move || {
        let expires_at = created_at.saturating_add(LOOPBACK_SESSION_TTL_SECONDS);
        let delay = expires_at.saturating_sub(chrono_like_now_unix());
        if delay > 0 {
            thread::sleep(Duration::from_secs(delay as u64));
        }
        let should_cleanup = loopback_sessions()
            .lock()
            .ok()
            .and_then(|sessions| sessions.get(&session_id).cloned())
            .is_some_and(|session| session.status == "action_required");
        if should_cleanup {
            cleanup_expired_loopback_sessions(chrono_like_now_unix());
        }
    });
}

fn parse_query_params(raw_path: &str) -> HashMap<String, String> {
    let query = raw_path.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut params: HashMap<String, String> = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let key = decode_query_component(k);
        let val = decode_query_component(v);
        params.insert(key, val);
    }
    params
}

fn decode_query_component(raw: &str) -> String {
    let form_value = raw.replace('+', " ");
    urlencoding::decode(&form_value)
        .map(|value| value.to_string())
        .unwrap_or(form_value)
}

fn oauth_bridge_request(
    input: &OAuthCallbackInput,
    binding: Option<&BrokerAccessBinding>,
) -> BrokerOAuthBridgeRequest {
    BrokerOAuthBridgeRequest {
        bridge_version: input.bridge_version.clone(),
        site_id: input.site_id.clone(),
        purpose: input.purpose.clone(),
        assertion_id: input.assertion_id.clone(),
        receiver_id: input.receiver_id.clone(),
        receiver_challenge: input.receiver_challenge.clone(),
        receiver_verifier: input.receiver_verifier.clone(),
        provider: input.provider.clone(),
        provider_user_id: input.provider_user_id.clone(),
        union_id: input.union_id.clone().unwrap_or_default(),
        email: input.email.clone().unwrap_or_default(),
        email_verified: input.email_verified,
        username: input.username.clone().unwrap_or_default(),
        display_name: input.display_name.clone().unwrap_or_default(),
        avatar_url: input.avatar_url.clone().unwrap_or_default(),
        ts: input.ts.clone(),
        sig: input.sig.clone(),
        station_peer_id: binding
            .map(|value| value.station_peer_id.clone())
            .unwrap_or_default(),
        access_attempt_id: binding
            .map(|value| value.access_attempt_id.clone())
            .unwrap_or_default(),
        gate_id: binding
            .map(|value| value.gate_id.clone())
            .unwrap_or_default(),
        device_id: binding
            .map(|value| value.device_id.clone())
            .unwrap_or_default(),
        lifecycle_generation: binding
            .map(|value| value.lifecycle_generation)
            .unwrap_or_default(),
        credential_delivery_public_key: binding
            .map(|value| value.delivery_public_key.clone())
            .unwrap_or_default(),
    }
}

fn save_oauth_callback(
    input: OAuthCallbackInput,
    purpose: &str,
    connector_authorization: Option<&OAuthConnectorAuthorization>,
    broker_binding: Option<&BrokerAccessBinding>,
    broker_completion: Option<CompleteOAuthAttemptResponse>,
) -> CmdResult<OAuthCallbackOutcome> {
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
    let provider_user_id = input.provider_user_id.clone();
    let user_name = input
        .username
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or(input.display_name.clone())
        .unwrap_or_else(|| provider_user_id.clone());
    let email = input.email.clone().unwrap_or_default();
    let avatar_url = input.avatar_url.clone().unwrap_or_default();
    let profile_url = String::new();

    let (owner_ptid, station_access_token, acknowledgement) = match purpose {
        "account_login" => {
            let binding = broker_binding
                .ok_or_else(|| internal_error("OAuth access binding is unavailable"))?;
            let completion = match broker_completion {
                Some(value) => value,
                None => {
                    let bridge_req = oauth_bridge_request(&input, Some(binding));
                    station_client::post_peers_proto_no_auth::<
                        BrokerOAuthBridgeRequest,
                        BrokerOAuthBridgeResponse,
                    >("/actor/oauth-bridge", &bridge_req)
                    .map_err(|error| {
                        internal_error(format!("Station OAuth bridge failed: {error}"))
                    })?
                    .completion
                    .ok_or_else(|| internal_error("OAuth bridge response missing completion"))?
                }
            };
            let result = OAuthAttemptResult::try_from(completion.result)
                .map_err(|_| internal_error("OAuth bridge returned an unknown result"))?;
            if result == OAuthAttemptResult::OauthAttemptResultSessionCandidateIssued {
                let decision = completion.access_decision.ok_or_else(|| {
                    internal_error("OAuth bridge response missing Access Decision")
                })?;
                if decision.state != AccessDecisionState::ActionRequired as i32 {
                    return Err(internal_error(
                        "OAuth bridge candidate has no actionable Access Gate",
                    ));
                }
                let oauth_attempt_id = completion
                    .session_candidate
                    .as_ref()
                    .map(|candidate| candidate.oauth_attempt_id.trim())
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        internal_error("OAuth bridge response missing OAuth attempt binding")
                    })?
                    .to_string();
                return Ok(OAuthCallbackOutcome::FollowingGate {
                    decision,
                    pending: PendingBrokerLogin {
                        input,
                        binding: binding.clone(),
                        oauth_attempt_id,
                    },
                });
            }
            if result != OAuthAttemptResult::OauthAttemptResultAccessGranted {
                let code = completion.error_code.trim();
                return Err(AppResult::fail(
                    ErrorCode::Forbidden,
                    if code.is_empty() {
                        "Station denied OAuth access"
                    } else {
                        code
                    },
                    None,
                ));
            }
            let (actor_ptid, credential, oauth_attempt_id) =
                decrypt_broker_credential(binding, &completion)?;
            let access_token = credential
                .tokens
                .as_ref()
                .map(|tokens| tokens.access_token.clone())
                .unwrap_or_default();
            (
                actor_ptid,
                Some(access_token),
                Some((binding.clone(), oauth_attempt_id)),
            )
        }
        "connector_link" => {
            let authorization = connector_authorization
                .ok_or_else(|| invalid_argument("connector_link requires authentication"))?;
            if !authorization.actor_ptid.starts_with("ptid:")
                || authorization.token.trim().is_empty()
            {
                return Err(invalid_argument("connector_link requires authentication"));
            }
            let bridge_req = oauth_bridge_request(&input, None);
            let response = station_client::request_peers_proto::<
                BrokerOAuthBridgeRequest,
                BrokerOAuthConnectorLinkResponse,
            >(
                Method::POST,
                "/actor/oauth-connector-link",
                &authorization.token,
                None,
                Some(&bridge_req),
            )
            .map_err(|error| {
                internal_error(format!(
                    "Station OAuth connector verification failed: {error}"
                ))
            })?;
            let response_ptid = response
                .actor_ref
                .as_ref()
                .map(|actor| actor.ptid.trim())
                .unwrap_or_default();
            if response_ptid != authorization.actor_ptid {
                return Err(internal_error(
                    "OAuth connector response actor does not match authenticated actor",
                ));
            }
            (authorization.actor_ptid.clone(), None, None)
        }
        _ => return Err(invalid_argument("invalid OAuth loopback purpose")),
    };

    let _mutation_guard = lock_connection_mutations();
    let mut map = read_connections()?;
    let previous_connections = map.clone();
    let previous_identity_state = if station_access_token.is_some() {
        Some(auth_identity::read_state().map_err(internal_error)?)
    } else {
        None
    };
    let account_id = station_access_token
        .as_ref()
        .map(|_| auth_identity::oauth_account_id(provider_id, provider_user_id.as_str()));
    if let (Some(identity_state), Some(account_id)) =
        (previous_identity_state.as_ref(), account_id.as_ref())
    {
        if identity_state
            .accounts
            .iter()
            .any(|account| account.id == *account_id && account.pin_protection.is_some())
        {
            if let Some((binding, attempt_id)) = acknowledgement.as_ref() {
                let _ = cancel_broker_login(binding, attempt_id);
            }
            return Err(AppResult::fail(
                ErrorCode::Unauthorized,
                "PIN is required before replacing this account session",
                None,
            ));
        }
    }
    let previous_session = station_access_token
        .as_ref()
        .and_then(|_| session_store::load(&owner_ptid));
    let acknowledgement_recovery =
        if let Some((binding, oauth_attempt_id)) = acknowledgement.as_ref() {
            let account_id = account_id
                .as_ref()
                .ok_or_else(|| internal_error("OAuth account identifier is unavailable"))?;
            let previous_identity_state = previous_identity_state
                .as_ref()
                .ok_or_else(|| internal_error("OAuth identity snapshot is unavailable"))?;
            let record = PendingBrokerAcknowledgement {
                loopback_session_id: input.receiver_id.clone(),
                account_id: account_id.clone(),
                actor_ptid: owner_ptid.clone(),
                oauth_attempt_id: oauth_attempt_id.clone(),
                binding: PersistedBrokerReceiverBinding::from_runtime(binding),
                phase: BrokerAcknowledgementRecoveryPhase::Prepared,
                next_retry_at: chrono_like_now_unix(),
                previous_connections: previous_connections.clone(),
                previous_identity_state: previous_identity_state.clone(),
                previous_session: previous_session.clone(),
            };
            if let Err(error) = persist_broker_acknowledgement_recovery(record.clone()) {
                let _ = cancel_broker_login(binding, oauth_attempt_id);
                return Err(internal_error(error));
            }
            Some(record)
        } else {
            None
        };
    if let (Some(access_token), Some(account_id)) =
        (station_access_token.as_ref(), account_id.as_ref())
    {
        if let Err(error) = session_vault::persist_raw_session_for_account(
            account_id,
            &owner_ptid,
            access_token,
            SessionSource::OauthBridge,
        ) {
            rollback_oauth_local_state(
                &previous_connections,
                previous_identity_state.as_ref(),
                previous_session.as_ref(),
                &owner_ptid,
            )?;
            if let Some(record) = acknowledgement_recovery.as_ref() {
                remove_broker_acknowledgement_recovery(&record.loopback_session_id)
                    .map_err(internal_error)?;
            }
            if let Some((binding, attempt_id)) = acknowledgement.as_ref() {
                let _ = cancel_broker_login(binding, attempt_id);
            }
            return Err(internal_error(error.to_string()));
        }
    }
    let now = unix_to_rfc3339(chrono_like_now_unix());
    let expires_at = Some(unix_to_rfc3339(chrono_like_now_unix() + 3600));
    let provider_name = get_provider(provider_id)
        .map(|provider| provider.name)
        .unwrap_or_else(|| provider_id.to_string());
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
    map.insert(
        provider_id.to_string(),
        OAuthConnectionState {
            connection_id,
            revision,
            projected_revision,
            owner_ptid: owner_ptid.clone(),
            provider_id: provider_id.to_string(),
            provider_name,
            user_id: provider_user_id.clone(),
            user_name: user_name.clone(),
            email: email.clone(),
            avatar_url: avatar_url.clone(),
            profile_url: profile_url.clone(),
            connected_at: now,
            expires_at,
            scopes: Vec::new(),
            status: "active".to_string(),
            projected_capabilities: Vec::new(),
            revision_history,
            revocation_idempotency_key: String::new(),
            revocation_error: String::new(),
        },
    );
    if let Err(error) = write_connections(&map) {
        if station_access_token.is_some() {
            rollback_oauth_local_state(
                &previous_connections,
                previous_identity_state.as_ref(),
                previous_session.as_ref(),
                &owner_ptid,
            )?;
            if let Some(record) = acknowledgement_recovery.as_ref() {
                remove_broker_acknowledgement_recovery(&record.loopback_session_id)
                    .map_err(internal_error)?;
            }
            if let Some((binding, attempt_id)) = acknowledgement.as_ref() {
                let _ = cancel_broker_login(binding, attempt_id);
            }
        }
        return Err(error);
    }
    if station_access_token.is_some() {
        if account_id.is_none() {
            rollback_oauth_local_state(
                &previous_connections,
                previous_identity_state.as_ref(),
                previous_session.as_ref(),
                &owner_ptid,
            )?;
            if let Some(record) = acknowledgement_recovery.as_ref() {
                remove_broker_acknowledgement_recovery(&record.loopback_session_id)
                    .map_err(internal_error)?;
            }
            if let Some((binding, attempt_id)) = acknowledgement.as_ref() {
                let _ = cancel_broker_login(binding, attempt_id);
            }
            return Err(internal_error("OAuth account identifier is unavailable"));
        }
        if let Err(error) = auth_identity::upsert_oauth_with_session(
            &owner_ptid,
            provider_id,
            provider_user_id.as_str(),
            user_name.as_str(),
            None,
            Some(email.as_str()),
            Some(avatar_url.as_str()),
            Some(profile_url.as_str()),
        ) {
            rollback_oauth_local_state(
                &previous_connections,
                previous_identity_state.as_ref(),
                previous_session.as_ref(),
                &owner_ptid,
            )?;
            if let Some(record) = acknowledgement_recovery.as_ref() {
                remove_broker_acknowledgement_recovery(&record.loopback_session_id)
                    .map_err(internal_error)?;
            }
            if let Some((binding, attempt_id)) = acknowledgement.as_ref() {
                let _ = cancel_broker_login(binding, attempt_id);
            }
            return Err(internal_error(error));
        }
    }
    if let Some(record) = acknowledgement_recovery.as_ref() {
        if let Err(error) =
            update_broker_acknowledgement_recovery(&record.loopback_session_id, |stored| {
                stored.phase = BrokerAcknowledgementRecoveryPhase::LocalPersisted;
            })
        {
            rollback_and_remove_broker_acknowledgement_recovery(record)?;
            if let Some((binding, attempt_id)) = acknowledgement.as_ref() {
                let _ = cancel_broker_login(binding, attempt_id);
            }
            return Err(internal_error(error));
        }
    }
    if let Some((binding, attempt_id)) = acknowledgement.as_ref() {
        if !loopback_session_allows_activation(&input.receiver_id) {
            if let Some(record) = acknowledgement_recovery.as_ref() {
                rollback_and_remove_broker_acknowledgement_recovery(record)?;
            }
            let _ = cancel_broker_login(binding, attempt_id);
            return Err(internal_error("OAuth loopback session was cancelled"));
        }
        match acknowledge_broker_login(binding, attempt_id) {
            Ok(()) => {
                if let Some(record) = acknowledgement_recovery.as_ref() {
                    remove_broker_acknowledgement_recovery(&record.loopback_session_id)
                        .map_err(internal_error)?;
                }
                update_loopback_session(&input.receiver_id, "completed", None, None);
            }
            Err(failure)
                if failure.disposition == BrokerAcknowledgementFailureDisposition::Retryable =>
            {
                if let Some(record) = acknowledgement_recovery.as_ref() {
                    defer_broker_acknowledgement_recovery(
                        &record.loopback_session_id,
                        chrono_like_now_unix(),
                    )
                    .map_err(internal_error)?;
                }
                update_loopback_session(&input.receiver_id, "acknowledgement_pending", None, None);
                return Ok(OAuthCallbackOutcome::AcknowledgementPending);
            }
            Err(failure) => {
                if failure.disposition == BrokerAcknowledgementFailureDisposition::CancelSafe {
                    if let Some(record) = acknowledgement_recovery.as_ref() {
                        if let Err(error) =
                            persist_broker_cancellation_request(&record.loopback_session_id)
                        {
                            tracing::warn!(
                                acknowledgement_error = %failure.message,
                                cancellation_error = %error,
                                "OAuth cancellation intent could not be persisted"
                            );
                            update_loopback_session(
                                &input.receiver_id,
                                "acknowledgement_pending",
                                None,
                                None,
                            );
                            return Ok(OAuthCallbackOutcome::AcknowledgementPending);
                        }
                    }
                    match cancel_broker_login(binding, attempt_id) {
                        Ok(OAuthAttemptResult::OauthAttemptResultAccessGranted) => {
                            if let Some(record) = acknowledgement_recovery.as_ref() {
                                remove_broker_acknowledgement_recovery(&record.loopback_session_id)
                                    .map_err(internal_error)?;
                            }
                            update_loopback_session(&input.receiver_id, "completed", None, None);
                            advance_connector_projection_epoch();
                            return Ok(OAuthCallbackOutcome::Completed);
                        }
                        Ok(_) => {}
                        Err(cancel_error) => {
                            if let Some(record) = acknowledgement_recovery.as_ref() {
                                defer_broker_acknowledgement_recovery(
                                    &record.loopback_session_id,
                                    chrono_like_now_unix(),
                                )
                                .map_err(internal_error)?;
                            }
                            update_loopback_session(&input.receiver_id, "cancelling", None, None);
                            let cancellation_message = cancel_error
                                .error
                                .map(|value| value.message)
                                .unwrap_or_else(|| {
                                    "OAuth candidate cancellation outcome is unavailable"
                                        .to_string()
                                });
                            tracing::warn!(
                                acknowledgement_error = %failure.message,
                                cancellation_error = %cancellation_message,
                                "OAuth acknowledgement and cancellation remain unresolved"
                            );
                            return Ok(OAuthCallbackOutcome::AcknowledgementPending);
                        }
                    }
                }
                if let Some(record) = acknowledgement_recovery.as_ref() {
                    rollback_and_remove_broker_acknowledgement_recovery(record)?;
                }
                return Err(internal_error(failure.message));
            }
        }
    }

    advance_connector_projection_epoch();
    Ok(OAuthCallbackOutcome::Completed)
}

fn decrypt_broker_credential(
    binding: &BrokerAccessBinding,
    completion: &CompleteOAuthAttemptResponse,
) -> CmdResult<(String, LoginResponse, String)> {
    let candidate = completion
        .session_candidate
        .as_ref()
        .ok_or_else(|| internal_error("OAuth bridge response missing session candidate"))?;
    let envelope = completion
        .credential_envelope
        .as_ref()
        .ok_or_else(|| internal_error("OAuth bridge response missing credential envelope"))?;
    if candidate.candidate_id != envelope.candidate_id
        || candidate.access_attempt_id != binding.access_attempt_id
        || candidate.station_peer_id != binding.station_peer_id
        || candidate.device_id != binding.device_id
        || candidate.lifecycle_generation != binding.lifecycle_generation
        || envelope.station_peer_id != binding.station_peer_id
        || envelope.device_id != binding.device_id
        || envelope.lifecycle_generation != binding.lifecycle_generation
    {
        return Err(internal_error("OAuth credential envelope binding mismatch"));
    }
    let actor_ptid = candidate
        .actor_ref
        .as_ref()
        .map(|actor| actor.ptid.trim())
        .filter(|value| value.starts_with("ptid:"))
        .ok_or_else(|| internal_error("OAuth candidate missing canonical actor PTID"))?
        .to_string();
    let server_public_bytes: [u8; 32] = envelope
        .server_ephemeral_public_key
        .as_slice()
        .try_into()
        .map_err(|_| internal_error("OAuth credential envelope public key is invalid"))?;
    let server_public = PublicKey::from(server_public_bytes);
    let private = StaticSecret::from(binding.delivery_private_key);
    let shared_secret = private.diffie_hellman(&server_public);
    let associated_data = credential_envelope_associated_data(
        &envelope.candidate_id,
        &envelope.session_id,
        &envelope.station_peer_id,
        &envelope.device_id,
        envelope.lifecycle_generation,
        &candidate.access_attempt_id,
        candidate.decision_revision,
    );
    let key = hkdf_sha256(shared_secret.as_bytes(), &[], &associated_data, 32);
    let key: [u8; 32] = key
        .try_into()
        .map_err(|_| internal_error("OAuth credential envelope key is invalid"))?;
    let nonce: [u8; 12] = envelope
        .nonce
        .as_slice()
        .try_into()
        .map_err(|_| internal_error("OAuth credential envelope nonce is invalid"))?;
    let plaintext = aes_gcm_decrypt(&key, &nonce, &envelope.ciphertext, &associated_data)
        .map_err(|_| internal_error("OAuth credential envelope decryption failed"))?;
    let credential = LoginResponse::decode(plaintext.as_slice())
        .map_err(|_| internal_error("OAuth credential envelope payload is invalid"))?;
    let credential_ptid = credential
        .actor_ref
        .as_ref()
        .map(|actor| actor.ptid.as_str())
        .unwrap_or_default();
    let _ = credential
        .tokens
        .as_ref()
        .map(|tokens| tokens.access_token.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| internal_error("OAuth credential envelope missing access token"))?;
    if credential.session_id != envelope.session_id || credential_ptid != actor_ptid {
        return Err(internal_error("OAuth credential payload binding mismatch"));
    }
    if candidate.oauth_attempt_id.trim().is_empty() {
        return Err(internal_error("OAuth candidate missing attempt ID"));
    }
    Ok((actor_ptid, credential, candidate.oauth_attempt_id.clone()))
}

fn credential_envelope_associated_data(
    candidate_id: &str,
    session_id: &str,
    station_peer_id: &str,
    device_id: &str,
    lifecycle_generation: u64,
    access_attempt_id: &str,
    decision_revision: u64,
) -> Vec<u8> {
    let values = [
        "peers-touch/oauth-credential-envelope",
        candidate_id,
        session_id,
        station_peer_id,
        device_id,
        access_attempt_id,
    ];
    let mut encoded = Vec::new();
    for value in values {
        encoded.extend_from_slice(&(value.len() as u32).to_be_bytes());
        encoded.extend_from_slice(value.as_bytes());
    }
    encoded.extend_from_slice(&lifecycle_generation.to_be_bytes());
    encoded.extend_from_slice(&decision_revision.to_be_bytes());
    encoded
}

fn broker_scope_request(
    binding: &BrokerAccessBinding,
    oauth_attempt_id: &str,
) -> GetOAuthAttemptRequest {
    GetOAuthAttemptRequest {
        oauth_attempt_id: oauth_attempt_id.to_string(),
        station_peer_id: binding.station_peer_id.clone(),
        access_attempt_id: binding.access_attempt_id.clone(),
        attempt_secret: binding_receiver_secret(binding),
        device_id: binding.device_id.clone(),
        lifecycle_generation: binding.lifecycle_generation,
    }
}

fn binding_receiver_secret(binding: &BrokerAccessBinding) -> Vec<u8> {
    binding.attempt_secret.clone()
}

fn acknowledge_broker_login(
    binding: &BrokerAccessBinding,
    oauth_attempt_id: &str,
) -> Result<(), BrokerAcknowledgementFailure> {
    acknowledge_persisted_broker_login(
        &PersistedBrokerReceiverBinding::from_runtime(binding),
        oauth_attempt_id,
    )
}

fn acknowledge_persisted_broker_login(
    binding: &PersistedBrokerReceiverBinding,
    oauth_attempt_id: &str,
) -> Result<(), BrokerAcknowledgementFailure> {
    let attempt_secret =
        binding
            .receiver_secret()
            .map_err(|message| BrokerAcknowledgementFailure {
                message,
                disposition: BrokerAcknowledgementFailureDisposition::Terminal,
            })?;
    let acknowledgement = AcknowledgeOAuthCredentialRequest {
        oauth_attempt_id: oauth_attempt_id.to_string(),
        station_peer_id: binding.station_peer_id.clone(),
        access_attempt_id: binding.access_attempt_id.clone(),
        attempt_secret: attempt_secret.clone(),
        device_id: binding.device_id.clone(),
        lifecycle_generation: binding.lifecycle_generation,
    };
    let status = GetOAuthAttemptRequest {
        oauth_attempt_id: oauth_attempt_id.to_string(),
        station_peer_id: binding.station_peer_id.clone(),
        access_attempt_id: binding.access_attempt_id.clone(),
        attempt_secret,
        device_id: binding.device_id.clone(),
        lifecycle_generation: binding.lifecycle_generation,
    };
    reconcile_broker_acknowledgement(
        || {
            station_client::post_peers_proto_no_auth::<
                AcknowledgeOAuthCredentialRequest,
                AcknowledgeOAuthCredentialResponse,
            >("/oauth/mobile/acknowledge", &acknowledgement)
            .map_err(|error| error.to_string())
        },
        || {
            station_client::post_peers_proto_no_auth::<
                GetOAuthAttemptRequest,
                GetOAuthAttemptResponse,
            >("/oauth/mobile/status", &status)
            .map_err(|error| error.to_string())
        },
        BROKER_ACK_RETRY_DELAY,
    )
}

fn reconcile_broker_acknowledgement<Acknowledge, Status>(
    mut acknowledge: Acknowledge,
    mut status: Status,
    retry_delay: Duration,
) -> Result<(), BrokerAcknowledgementFailure>
where
    Acknowledge: FnMut() -> Result<AcknowledgeOAuthCredentialResponse, String>,
    Status: FnMut() -> Result<GetOAuthAttemptResponse, String>,
{
    let mut last_error = "Station acknowledgement outcome is unavailable".to_string();
    let mut cancellation_safe = false;
    for attempt in 0..BROKER_ACK_MAX_ATTEMPTS {
        match acknowledge() {
            Ok(response)
                if response.result
                    == OAuthAttemptResult::OauthAttemptResultAccessGranted as i32 =>
            {
                return Ok(());
            }
            Ok(response) => {
                return Err(BrokerAcknowledgementFailure {
                    message: format!(
                        "Station did not activate OAuth candidate: result={}",
                        response.result
                    ),
                    disposition: BrokerAcknowledgementFailureDisposition::Terminal,
                });
            }
            Err(error) => {
                last_error = format!("OAuth acknowledgement failed: {error}");
            }
        }

        match status() {
            Ok(response) => {
                let state = OAuthAttemptState::try_from(response.state).map_err(|_| {
                    BrokerAcknowledgementFailure {
                        message: "OAuth acknowledgement status returned an unknown state"
                            .to_string(),
                        disposition: BrokerAcknowledgementFailureDisposition::Terminal,
                    }
                })?;
                match state {
                    OAuthAttemptState::OauthAttemptStateActivated => return Ok(()),
                    OAuthAttemptState::OauthAttemptStateSessionCandidateIssued
                    | OAuthAttemptState::OauthAttemptStateFollowingGate => {
                        cancellation_safe = true;
                        last_error =
                            "Station retained an inactive OAuth candidate after acknowledgement"
                                .to_string();
                    }
                    OAuthAttemptState::OauthAttemptStateCancelled
                    | OAuthAttemptState::OauthAttemptStateExpired
                    | OAuthAttemptState::OauthAttemptStateFailed => {
                        return Err(BrokerAcknowledgementFailure {
                            message: format!(
                                "Station rejected OAuth acknowledgement: state={state:?}"
                            ),
                            disposition: BrokerAcknowledgementFailureDisposition::Terminal,
                        });
                    }
                    _ => {
                        cancellation_safe = false;
                        last_error = format!(
                            "OAuth acknowledgement status is inconclusive: state={state:?}"
                        );
                    }
                }
            }
            Err(error) => {
                cancellation_safe = false;
                last_error = format!("{last_error}; status readback failed: {error}");
            }
        }

        if attempt + 1 < BROKER_ACK_MAX_ATTEMPTS && !retry_delay.is_zero() {
            thread::sleep(retry_delay);
        }
    }
    Err(BrokerAcknowledgementFailure {
        message: last_error,
        disposition: if cancellation_safe {
            BrokerAcknowledgementFailureDisposition::CancelSafe
        } else {
            BrokerAcknowledgementFailureDisposition::Retryable
        },
    })
}

fn cancel_broker_login(
    binding: &BrokerAccessBinding,
    oauth_attempt_id: &str,
) -> CmdResult<OAuthAttemptResult> {
    cancel_persisted_broker_login(
        &PersistedBrokerReceiverBinding::from_runtime(binding),
        oauth_attempt_id,
    )
}

fn cancel_persisted_broker_login(
    binding: &PersistedBrokerReceiverBinding,
    oauth_attempt_id: &str,
) -> CmdResult<OAuthAttemptResult> {
    let attempt_secret = binding.receiver_secret().map_err(internal_error)?;
    let response = station_client::post_peers_proto_no_auth::<
        CancelOAuthAttemptRequest,
        CancelOAuthAttemptResponse,
    >(
        "/oauth/mobile/cancel",
        &CancelOAuthAttemptRequest {
            oauth_attempt_id: oauth_attempt_id.to_string(),
            station_peer_id: binding.station_peer_id.clone(),
            access_attempt_id: binding.access_attempt_id.clone(),
            attempt_secret,
            device_id: binding.device_id.clone(),
            lifecycle_generation: binding.lifecycle_generation,
        },
    )
    .map_err(|error| internal_error(format!("OAuth cancellation failed: {error}")))?;
    let result = OAuthAttemptResult::try_from(response.result)
        .map_err(|_| internal_error("Station returned an unknown OAuth cancellation result"))?;
    if result != OAuthAttemptResult::OauthAttemptResultCancelled
        && result != OAuthAttemptResult::OauthAttemptResultAccessGranted
        && result != OAuthAttemptResult::OauthAttemptResultExpired
    {
        return Err(internal_error("Station did not cancel OAuth candidate"));
    }
    Ok(result)
}

fn broker_acknowledgement_recovery_path() -> Result<PathBuf, String> {
    storage::app_file_path(
        "desktop",
        StorageKind::Data,
        &["oauth2", "acknowledgement-recovery.json"],
    )
    .map_err(|error| format!("resolve OAuth acknowledgement recovery path: {error}"))
}

fn broker_acknowledgement_recovery_key_ref(path: &Path) -> String {
    format!(
        "{BROKER_ACK_RECOVERY_KEY_PREFIX}:{}",
        hex::encode(Sha256::digest(path.to_string_lossy().as_bytes())),
    )
}

fn broker_acknowledgement_recovery_aad(key_id: &str, key_version: i32, path: &Path) -> Vec<u8> {
    format!(
        "{BROKER_ACK_RECOVERY_AAD_DOMAIN}\0{}\0{key_id}\0{key_version}",
        hex::encode(Sha256::digest(path.to_string_lossy().as_bytes())),
    )
    .into_bytes()
}

fn read_broker_acknowledgement_recoveries() -> Result<BrokerAcknowledgementRecoveryStore, String> {
    let path = broker_acknowledgement_recovery_path()?;
    if !path.exists() {
        return Ok(BrokerAcknowledgementRecoveryStore::default());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("read OAuth acknowledgement recovery state: {error}"))?;
    let envelope: BrokerAcknowledgementRecoveryEnvelope = serde_json::from_str(&raw)
        .map_err(|error| format!("decode OAuth acknowledgement recovery envelope: {error}"))?;
    if envelope.schema_version != BROKER_ACK_RECOVERY_SCHEMA_VERSION {
        return Err("OAuth acknowledgement recovery envelope is unsupported".to_string());
    }
    let key_ref = broker_acknowledgement_recovery_key_ref(&path);
    let key_material = PlatformKeyProvider::shared()
        .get_or_create_key(&key_ref)
        .map_err(|error| format!("load OAuth acknowledgement recovery key: {error}"))?;
    if envelope.key_id != key_material.key_id || envelope.key_version != key_material.key_version {
        return Err("OAuth acknowledgement recovery key binding is invalid".to_string());
    }
    let key: [u8; 32] = key_material
        .key_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "OAuth acknowledgement recovery key is invalid".to_string())?;
    let nonce: [u8; 12] = URL_SAFE_NO_PAD
        .decode(envelope.nonce.as_bytes())
        .map_err(|_| "OAuth acknowledgement recovery nonce is invalid".to_string())?
        .try_into()
        .map_err(|_| "OAuth acknowledgement recovery nonce is invalid".to_string())?;
    let ciphertext = URL_SAFE_NO_PAD
        .decode(envelope.ciphertext.as_bytes())
        .map_err(|_| "OAuth acknowledgement recovery ciphertext is invalid".to_string())?;
    let aad = broker_acknowledgement_recovery_aad(&envelope.key_id, envelope.key_version, &path);
    let mut plaintext = aes_gcm_decrypt(&key, &nonce, &ciphertext, &aad)
        .map_err(|_| "decrypt OAuth acknowledgement recovery state".to_string())?;
    let decoded = serde_json::from_slice::<BrokerAcknowledgementRecoveryStore>(&plaintext)
        .map_err(|error| format!("decode OAuth acknowledgement recovery state: {error}"));
    plaintext.zeroize();
    let store = decoded?;
    if store.schema_version != BROKER_ACK_RECOVERY_SCHEMA_VERSION {
        return Err("OAuth acknowledgement recovery schema is unsupported".to_string());
    }
    for (session_id, record) in &store.records {
        if session_id != &record.loopback_session_id
            || session_id.trim().is_empty()
            || record.account_id.trim().is_empty()
            || !record.actor_ptid.starts_with("ptid:")
            || record.oauth_attempt_id.trim().is_empty()
            || record.binding.station_peer_id.trim().is_empty()
            || record.binding.access_attempt_id.trim().is_empty()
            || record.binding.device_id.trim().is_empty()
            || record.binding.receiver_secret()?.is_empty()
        {
            return Err("OAuth acknowledgement recovery record is invalid".to_string());
        }
    }
    Ok(store)
}

fn write_broker_acknowledgement_recoveries(
    store: &BrokerAcknowledgementRecoveryStore,
) -> Result<(), String> {
    let path = broker_acknowledgement_recovery_path()?;
    let key_ref = broker_acknowledgement_recovery_key_ref(&path);
    let key_material = PlatformKeyProvider::shared()
        .get_or_create_key(&key_ref)
        .map_err(|error| format!("load OAuth acknowledgement recovery key: {error}"))?;
    let key: [u8; 32] = key_material
        .key_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "OAuth acknowledgement recovery key is invalid".to_string())?;
    let mut nonce = [0_u8; 12];
    OsRng
        .try_fill_bytes(&mut nonce)
        .map_err(|error| format!("generate OAuth acknowledgement recovery nonce: {error}"))?;
    let aad =
        broker_acknowledgement_recovery_aad(&key_material.key_id, key_material.key_version, &path);
    let mut plaintext = serde_json::to_vec(store)
        .map_err(|error| format!("encode OAuth acknowledgement recovery state: {error}"))?;
    let encrypted = aes_gcm_encrypt(&key, &nonce, &plaintext, &aad)
        .map_err(|_| "encrypt OAuth acknowledgement recovery state".to_string());
    plaintext.zeroize();
    let envelope = BrokerAcknowledgementRecoveryEnvelope {
        schema_version: BROKER_ACK_RECOVERY_SCHEMA_VERSION,
        key_id: key_material.key_id.clone(),
        key_version: key_material.key_version,
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(encrypted?),
    };
    let payload = serde_json::to_string_pretty(&envelope)
        .map_err(|error| format!("encode OAuth acknowledgement recovery envelope: {error}"))?;
    storage::write_string_atomic(&path, &payload)
        .map_err(|error| format!("persist OAuth acknowledgement recovery state: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("protect OAuth acknowledgement recovery state: {error}"))?;
    }
    Ok(())
}

fn persist_broker_acknowledgement_recovery(
    record: PendingBrokerAcknowledgement,
) -> Result<(), String> {
    let mut store = read_broker_acknowledgement_recoveries()?;
    store
        .records
        .insert(record.loopback_session_id.clone(), record);
    write_broker_acknowledgement_recoveries(&store)
}

fn update_broker_acknowledgement_recovery(
    session_id: &str,
    update: impl FnOnce(&mut PendingBrokerAcknowledgement),
) -> Result<(), String> {
    let mut store = read_broker_acknowledgement_recoveries()?;
    let record = store
        .records
        .get_mut(session_id)
        .ok_or_else(|| "OAuth acknowledgement recovery record is unavailable".to_string())?;
    update(record);
    write_broker_acknowledgement_recoveries(&store)
}

fn remove_broker_acknowledgement_recovery(session_id: &str) -> Result<(), String> {
    let mut store = read_broker_acknowledgement_recoveries()?;
    if store.records.remove(session_id).is_some() {
        write_broker_acknowledgement_recoveries(&store)?;
    }
    Ok(())
}

fn rollback_broker_acknowledgement_recovery(
    record: &PendingBrokerAcknowledgement,
) -> Result<(), String> {
    rollback_oauth_local_state(
        &record.previous_connections,
        Some(&record.previous_identity_state),
        record.previous_session.as_ref(),
        &record.actor_ptid,
    )
    .map_err(|error| {
        error
            .error
            .map(|value| value.message)
            .unwrap_or_else(|| "roll back OAuth acknowledgement recovery state".to_string())
    })
}

fn rollback_and_remove_broker_acknowledgement_recovery(
    record: &PendingBrokerAcknowledgement,
) -> CmdResult<()> {
    rollback_broker_acknowledgement_recovery(record).map_err(internal_error)?;
    remove_broker_acknowledgement_recovery(&record.loopback_session_id).map_err(internal_error)?;
    Ok(())
}

fn find_broker_acknowledgement_recovery(
    selector: impl Fn(&PendingBrokerAcknowledgement) -> bool,
) -> Result<Option<PendingBrokerAcknowledgement>, String> {
    let store = read_broker_acknowledgement_recoveries()?;
    Ok(store.records.into_values().find(selector))
}

fn defer_broker_acknowledgement_recovery(session_id: &str, now: i64) -> Result<(), String> {
    update_broker_acknowledgement_recovery(session_id, |record| {
        record.next_retry_at = now.saturating_add(BROKER_ACK_RECOVERY_RETRY_SECONDS);
    })
}

fn persist_broker_cancellation_request(session_id: &str) -> Result<(), String> {
    update_broker_acknowledgement_recovery(session_id, |record| {
        record.phase = BrokerAcknowledgementRecoveryPhase::CancellationRequested;
        record.next_retry_at = chrono_like_now_unix();
    })
}

fn reconcile_broker_acknowledgement_recovery(
    record: PendingBrokerAcknowledgement,
    force: bool,
) -> Result<BrokerAcknowledgementRecovery, String> {
    reconcile_broker_acknowledgement_recovery_with(
        record,
        force,
        cancel_persisted_broker_login,
        acknowledge_persisted_broker_login,
    )
}

fn reconcile_broker_acknowledgement_recovery_with<Cancel, Acknowledge>(
    record: PendingBrokerAcknowledgement,
    force: bool,
    mut cancel: Cancel,
    mut acknowledge: Acknowledge,
) -> Result<BrokerAcknowledgementRecovery, String>
where
    Cancel: FnMut(&PersistedBrokerReceiverBinding, &str) -> CmdResult<OAuthAttemptResult>,
    Acknowledge:
        FnMut(&PersistedBrokerReceiverBinding, &str) -> Result<(), BrokerAcknowledgementFailure>,
{
    if record.phase == BrokerAcknowledgementRecoveryPhase::Prepared
        || record.phase == BrokerAcknowledgementRecoveryPhase::CancellationRequested
    {
        let cancellation = cancel(&record.binding, &record.oauth_attempt_id);
        match cancellation {
            Ok(OAuthAttemptResult::OauthAttemptResultAccessGranted) => {
                remove_broker_acknowledgement_recovery(&record.loopback_session_id)?;
                return Ok(BrokerAcknowledgementRecovery::Ready);
            }
            Ok(_) => {
                rollback_broker_acknowledgement_recovery(&record)?;
                remove_broker_acknowledgement_recovery(&record.loopback_session_id)?;
                return Ok(BrokerAcknowledgementRecovery::Rejected(
                    "OAuth login was cancelled before activation".to_string(),
                ));
            }
            Err(_) => {
                defer_broker_acknowledgement_recovery(
                    &record.loopback_session_id,
                    chrono_like_now_unix(),
                )?;
                return Ok(BrokerAcknowledgementRecovery::Pending);
            }
        }
    }

    let now = chrono_like_now_unix();
    if !force && record.next_retry_at > now {
        return Ok(BrokerAcknowledgementRecovery::Pending);
    }
    match acknowledge(&record.binding, &record.oauth_attempt_id) {
        Ok(()) => {
            remove_broker_acknowledgement_recovery(&record.loopback_session_id)?;
            Ok(BrokerAcknowledgementRecovery::Ready)
        }
        Err(failure)
            if failure.disposition == BrokerAcknowledgementFailureDisposition::Retryable
                || failure.disposition == BrokerAcknowledgementFailureDisposition::CancelSafe =>
        {
            defer_broker_acknowledgement_recovery(&record.loopback_session_id, now)?;
            Ok(BrokerAcknowledgementRecovery::Pending)
        }
        Err(failure) => {
            rollback_broker_acknowledgement_recovery(&record)?;
            remove_broker_acknowledgement_recovery(&record.loopback_session_id)?;
            Ok(BrokerAcknowledgementRecovery::Rejected(failure.message))
        }
    }
}

fn reconcile_broker_acknowledgement_for_session(
    session_id: &str,
    force: bool,
) -> Result<Option<BrokerAcknowledgementRecovery>, String> {
    let _mutation_guard = lock_connection_mutations();
    let Some(record) =
        find_broker_acknowledgement_recovery(|record| record.loopback_session_id == session_id)?
    else {
        return Ok(None);
    };
    if record.phase != BrokerAcknowledgementRecoveryPhase::CancellationRequested
        && !loopback_session_allows_activation(session_id)
    {
        return Ok(None);
    }
    let recovery = reconcile_broker_acknowledgement_recovery(record, force)?;
    match &recovery {
        BrokerAcknowledgementRecovery::Ready => {
            update_loopback_session(session_id, "completed", None, None);
        }
        BrokerAcknowledgementRecovery::Pending => {
            update_loopback_session(session_id, "acknowledgement_pending", None, None);
        }
        BrokerAcknowledgementRecovery::Rejected(message) => {
            update_loopback_session(session_id, "failed", None, Some(message.clone()));
        }
    }
    Ok(Some(recovery))
}

pub(crate) fn reconcile_broker_acknowledgement_for_account(
    account_id: &str,
) -> Result<BrokerAcknowledgementRecovery, String> {
    let _mutation_guard = lock_connection_mutations();
    let Some(record) =
        find_broker_acknowledgement_recovery(|record| record.account_id == account_id)?
    else {
        return Ok(BrokerAcknowledgementRecovery::Ready);
    };
    reconcile_broker_acknowledgement_recovery(record, true)
}

pub(crate) fn reconcile_broker_cancellations_after_restart() -> Result<(), String> {
    reconcile_broker_cancellations_after_restart_with(cancel_persisted_broker_login)
}

fn reconcile_broker_cancellations_after_restart_with<Cancel>(
    mut cancel: Cancel,
) -> Result<(), String>
where
    Cancel: FnMut(&PersistedBrokerReceiverBinding, &str) -> CmdResult<OAuthAttemptResult>,
{
    let _mutation_guard = lock_connection_mutations();
    let mut records = read_broker_acknowledgement_recoveries()?
        .records
        .into_values()
        .filter(|record| {
            record.phase == BrokerAcknowledgementRecoveryPhase::Prepared
                || record.phase == BrokerAcknowledgementRecoveryPhase::CancellationRequested
        })
        .collect::<Vec<_>>();
    records.sort_by(|left, right| left.loopback_session_id.cmp(&right.loopback_session_id));
    for record in records {
        let _ =
            reconcile_broker_acknowledgement_recovery_with(record, true, &mut cancel, |_, _| {
                unreachable!("startup cancellation recovery must not acknowledge")
            })?;
    }
    Ok(())
}

fn rollback_oauth_local_state(
    previous_connections: &HashMap<String, OAuthConnectionState>,
    previous_identity_state: Option<&auth_identity::AccountIdentityState>,
    previous_session: Option<&PersistedSession>,
    actor_ptid: &str,
) -> CmdResult<()> {
    let mut rollback_failed = false;
    if let Some(identity_state) = previous_identity_state {
        rollback_failed |= auth_identity::write_state(identity_state).is_err();
    }
    rollback_failed |= match previous_session {
        Some(session) => {
            session_store::save(&session.actor_ptid, &session.token, session.source).is_err()
        }
        None => session_store::delete(actor_ptid).is_err(),
    };
    rollback_failed |= write_connections(previous_connections).is_err();
    if rollback_failed {
        return Err(internal_error("failed to roll back local OAuth state"));
    }
    Ok(())
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
    if current_connection_id != connection.connection_id && current_revision >= connection.revision
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
    connector_authorization: Option<OAuthConnectorAuthorization>,
) -> AppResult<StubPayload> {
    if input.id.trim().is_empty() {
        return invalid_argument("id is required");
    }
    let purpose = input.purpose.trim();
    if purpose != "account_login" && purpose != "connector_link" {
        return invalid_argument("purpose must be account_login or connector_link");
    }
    if purpose == "connector_link" && connector_authorization.is_none() {
        return AppResult::fail(
            ErrorCode::Unauthorized,
            "connector_link requires authentication",
            None,
        );
    }
    let provider_id = input.id.trim();
    let Some(provider) = get_provider(provider_id) else {
        return AppResult::fail(ErrorCode::NotFound, "error.oauth2.providerNotFound", None);
    };
    if provider.status == "coming_soon" {
        return AppResult::fail(ErrorCode::Conflict, "error.oauth2.providerDeveloping", None);
    }
    cleanup_expired_loopback_sessions(chrono_like_now_unix());

    let listener = match TcpListener::bind("127.0.0.1:0") {
        Ok(v) => v,
        Err(err) => return internal_error(format!("failed to bind loopback listener: {err}")),
    };
    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(err) => return internal_error(format!("failed to read loopback listener addr: {err}")),
    };
    if let Err(error) = listener.set_nonblocking(true) {
        return internal_error(format!("failed to configure loopback listener: {error}"));
    }

    let session_id = match next_loopback_session_id() {
        Ok(value) => value,
        Err(error) => return internal_error(error),
    };
    let (receiver_verifier, receiver_challenge) = match next_loopback_receiver_proof() {
        Ok(value) => value,
        Err(error) => return internal_error(error),
    };
    let broker_binding = if purpose == "account_login" {
        let access =
            match crate::application::auth::service::start_oauth_access_attempt::<StubPayload>() {
                Ok(value) => value,
                Err(error) => return error,
            };
        let delivery_private = StaticSecret::random_from_rng(OsRng);
        let delivery_public = PublicKey::from(&delivery_private);
        Some(BrokerAccessBinding {
            station_peer_id: access.station_peer_id,
            access_attempt_id: access.access_attempt_id,
            gate_id: access.gate_id,
            device_id: access.device_id,
            lifecycle_generation: access.lifecycle_generation,
            attempt_secret: receiver_verifier.as_bytes().to_vec(),
            delivery_private_key: delivery_private.to_bytes(),
            delivery_public_key: delivery_public.as_bytes().to_vec(),
        })
    } else {
        None
    };
    let mut sessions = match loopback_sessions().lock() {
        Ok(value) => value,
        Err(_) => return internal_error("OAuth loopback registry is unavailable"),
    };
    sessions.insert(
        session_id.clone(),
        LoopbackSessionState {
            status: "pending".to_string(),
            callback_url: None,
            error: None,
            access_decision: None,
            created_at: chrono_like_now_unix(),
            completed_at: None,
        },
    );
    drop(sessions);

    let session_id_for_thread = session_id.clone();
    let provider_id_for_thread = provider_id.to_string();
    let purpose_for_thread = purpose.to_string();
    let receiver_challenge_for_thread = receiver_challenge.clone();
    let broker_binding_for_thread = broker_binding.clone();
    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(LOOPBACK_SESSION_TTL_SECONDS as u64);
        let accepted = loop {
            match listener.accept() {
                Ok(connection) => break Some(connection),
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        update_loopback_session(
                            &session_id_for_thread,
                            "expired",
                            None,
                            Some("authorization timeout".to_string()),
                        );
                        break None;
                    }
                    thread::sleep(Duration::from_millis(50));
                }
                Err(error) => {
                    update_loopback_session(
                        &session_id_for_thread,
                        "failed",
                        None,
                        Some(format!("loopback listener failed: {error}")),
                    );
                    break None;
                }
            }
        };
        if let Some((mut stream, _)) = accepted {
            let mut buffer = [0_u8; 8192];
            let read_size = stream.read(&mut buffer).unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..read_size]).to_string();
            let request_line = request.lines().next().unwrap_or("");
            let path = request_line
                .split_whitespace()
                .nth(1)
                .unwrap_or("/callback")
                .to_string();
            let callback_path = path
                .split_once('?')
                .map(|(value, _)| value)
                .unwrap_or(&path);
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
            let provider_error = params.get("error").cloned().unwrap_or_default();
            let assertion_purpose = params.get("purpose").cloned().unwrap_or_default();
            let receiver_id = params.get("receiver_id").cloned().unwrap_or_default();
            let signed_receiver_challenge = params
                .get("receiver_challenge")
                .cloned()
                .unwrap_or_default();
            let mut ok = false;
            let message: String;
            if callback_path != "/callback" {
                update_loopback_session(
                    &session_id_for_thread,
                    "failed",
                    Some(callback_url.clone()),
                    Some("invalid callback path".to_string()),
                );
                message = i18n.resolve_key(&lang, "oauth", "oauth.callback.missingFields");
            } else if request_session_id != session_id_for_thread {
                update_loopback_session(
                    &session_id_for_thread,
                    "failed",
                    Some(callback_url.clone()),
                    Some("session id mismatch".to_string()),
                );
                message = i18n.resolve_key(&lang, "oauth", "oauth.callback.sessionMismatch");
            } else if !provider_error.is_empty() {
                update_loopback_session(
                    &session_id_for_thread,
                    "failed",
                    Some(callback_url.clone()),
                    Some(provider_error),
                );
                message = i18n.resolve_key(&lang, "oauth", "oauth.callback.saveFailed");
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
            } else if assertion_purpose != purpose_for_thread {
                update_loopback_session(
                    &session_id_for_thread,
                    "failed",
                    Some(callback_url.clone()),
                    Some("OAuth callback purpose mismatch".to_string()),
                );
                message = i18n.resolve_key(&lang, "oauth", "oauth.callback.saveFailed");
            } else if receiver_id != session_id_for_thread {
                update_loopback_session(
                    &session_id_for_thread,
                    "failed",
                    Some(callback_url.clone()),
                    Some("OAuth callback receiver mismatch".to_string()),
                );
                message = i18n.resolve_key(&lang, "oauth", "oauth.callback.saveFailed");
            } else if signed_receiver_challenge != receiver_challenge_for_thread {
                update_loopback_session(
                    &session_id_for_thread,
                    "failed",
                    Some(callback_url.clone()),
                    Some("OAuth callback receiver proof mismatch".to_string()),
                );
                message = i18n.resolve_key(&lang, "oauth", "oauth.callback.saveFailed");
            } else if !loopback_session_allows_activation(&session_id_for_thread) {
                message = i18n.resolve_key(&lang, "oauth", "oauth.callback.saveFailed");
            } else {
                match save_oauth_callback(
                    OAuthCallbackInput {
                        bridge_version: params.get("bridge_version").cloned().unwrap_or_default(),
                        site_id: params.get("site_id").cloned().unwrap_or_default(),
                        purpose: params.get("purpose").cloned().unwrap_or_default(),
                        assertion_id: params.get("assertion_id").cloned().unwrap_or_default(),
                        receiver_id,
                        receiver_challenge: signed_receiver_challenge,
                        receiver_verifier: receiver_verifier.clone(),
                        provider,
                        provider_user_id,
                        union_id: params.get("union_id").cloned(),
                        username: params.get("username").cloned(),
                        display_name: params.get("display_name").cloned(),
                        email: params.get("email").cloned(),
                        email_verified: params
                            .get("email_verified")
                            .map(|value| value.eq_ignore_ascii_case("true"))
                            .unwrap_or(false),
                        avatar_url: params.get("avatar_url").cloned(),
                        ts: params.get("ts").cloned().unwrap_or_default(),
                        sig: params.get("sig").cloned().unwrap_or_default(),
                    },
                    &purpose_for_thread,
                    connector_authorization.as_ref(),
                    broker_binding_for_thread.as_ref(),
                    None,
                ) {
                    Ok(OAuthCallbackOutcome::Completed) => {
                        update_loopback_session(
                            &session_id_for_thread,
                            "completed",
                            Some(callback_url.clone()),
                            None,
                        );
                        ok = true;
                        message = i18n.resolve_key(&lang, "oauth", "oauth.callback.loginComplete");
                    }
                    Ok(OAuthCallbackOutcome::AcknowledgementPending) => {
                        update_loopback_session(
                            &session_id_for_thread,
                            "acknowledgement_pending",
                            Some(callback_url.clone()),
                            None,
                        );
                        ok = true;
                        message = i18n.resolve_key(&lang, "oauth", "oauth.callback.loginComplete");
                    }
                    Ok(OAuthCallbackOutcome::FollowingGate { decision, pending }) => {
                        match update_loopback_following_gate(
                            &session_id_for_thread,
                            callback_url.clone(),
                            &decision,
                            pending,
                        ) {
                            Ok(()) => {
                                ok = true;
                                message = i18n.resolve_key(
                                    &lang,
                                    "oauth",
                                    "oauth.callback.loginComplete",
                                );
                            }
                            Err(error) => {
                                update_loopback_session(
                                    &session_id_for_thread,
                                    "failed",
                                    Some(callback_url.clone()),
                                    Some(error),
                                );
                                message =
                                    i18n.resolve_key(&lang, "oauth", "oauth.callback.saveFailed");
                            }
                        }
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
        "http://127.0.0.1:{port}/callback?session_id={}&purpose={}&receiver_challenge={}",
        urlencoding::encode(&session_id),
        urlencoding::encode(purpose),
        urlencoding::encode(&receiver_challenge),
    );
    let start_url = provider.callback_url.replace("/callback", "/start");
    let auth_url = format!(
        "{}?site_id=default&return_to={}",
        start_url,
        urlencoding::encode(&return_to),
    );
    success_payload(
        "oauth2_start_loopback",
        json!({
            "auth_url": auth_url,
            "session_id": session_id,
            "environment": env,
            "expires_in_ms": LOOPBACK_SESSION_TTL_SECONDS * 1000,
        }),
    )
}

pub fn oauth2_poll_loopback(input: OAuthLoopbackPollInput) -> AppResult<StubPayload> {
    let session_id = input.session_id.trim();
    if session_id.is_empty() {
        return invalid_argument("session_id is required");
    }
    let now = chrono_like_now_unix();
    let recovery = match reconcile_broker_acknowledgement_for_session(session_id, false) {
        Ok(value) => value,
        Err(error) => return internal_error(error),
    };
    match recovery.as_ref() {
        Some(BrokerAcknowledgementRecovery::Ready) => {
            update_loopback_session(session_id, "completed", None, None);
            advance_connector_projection_epoch();
        }
        Some(BrokerAcknowledgementRecovery::Pending) => {
            update_loopback_session(session_id, "acknowledgement_pending", None, None);
        }
        Some(BrokerAcknowledgementRecovery::Rejected(message)) => {
            update_loopback_session(session_id, "failed", None, Some(message.clone()));
        }
        None => {}
    }
    cleanup_expired_loopback_sessions(now);
    let mut completed = false;
    let mut callback_url: Option<String> = None;
    let mut status = "pending".to_string();
    let mut error: Option<String> = None;
    let mut access_decision: Option<Value> = None;
    if let Ok(mut sessions) = loopback_sessions().lock() {
        if let Some(item) = sessions.get(session_id) {
            status = item.status.clone();
            callback_url = item.callback_url.clone();
            error = item.error.clone();
            access_decision = item.access_decision.clone();
            if item.status == "completed"
                || item.status == "action_required"
                || item.status == "failed"
                || item.status == "expired"
            {
                completed = true;
            }
        }
        sessions.retain(|_, v| {
            if v.status == "pending"
                || v.status == "action_required"
                || v.status == "acknowledgement_pending"
                || v.status == "cancelling"
            {
                return now - v.created_at < LOOPBACK_SESSION_TTL_SECONDS;
            }
            let done_at = v.completed_at.unwrap_or(v.created_at);
            now - done_at <= LOOPBACK_TERMINAL_RETENTION_SECONDS
        });
    }
    success_payload(
        "oauth2_poll_loopback",
        json!({
            "completed": completed,
            "status": status,
            "callback_url": callback_url,
            "error": error,
            "access_decision": access_decision,
        }),
    )
}

pub fn oauth2_resume_loopback(input: OAuthLoopbackPollInput) -> AppResult<StubPayload> {
    let session_id = input.session_id.trim();
    if session_id.is_empty() {
        return invalid_argument("session_id is required");
    }
    let pending = match pending_broker_logins().lock() {
        Ok(logins) => logins.get(session_id).cloned(),
        Err(_) => return internal_error("OAuth pending-login registry is unavailable"),
    };
    let Some(pending) = pending else {
        return AppResult::fail(
            ErrorCode::NotFound,
            "OAuth pending login is unavailable",
            None,
        );
    };
    let status = match station_client::post_peers_proto_no_auth::<
        GetOAuthAttemptRequest,
        GetOAuthAttemptResponse,
    >(
        "/oauth/mobile/status",
        &broker_scope_request(&pending.binding, &pending.oauth_attempt_id),
    ) {
        Ok(value) => value,
        Err(error) => {
            return internal_error(format!("OAuth candidate status failed: {error}"));
        }
    };
    let completion = CompleteOAuthAttemptResponse {
        result: status.result,
        session_candidate: status.session_candidate,
        access_decision: status.access_decision,
        error_code: status.error_code,
        credential_envelope: status.credential_envelope,
    };
    let PendingBrokerLogin {
        input,
        binding,
        oauth_attempt_id: _,
    } = pending;
    match save_oauth_callback(
        input,
        "account_login",
        None,
        Some(&binding),
        Some(completion),
    ) {
        Ok(OAuthCallbackOutcome::Completed) => {
            if let Ok(mut logins) = pending_broker_logins().lock() {
                logins.remove(session_id);
            }
            update_loopback_session(session_id, "completed", None, None);
            success_payload("oauth2_resume_loopback", json!({ "status": "completed" }))
        }
        Ok(OAuthCallbackOutcome::AcknowledgementPending) => {
            update_loopback_session(session_id, "acknowledgement_pending", None, None);
            success_payload(
                "oauth2_resume_loopback",
                json!({ "status": "acknowledgement_pending" }),
            )
        }
        Ok(OAuthCallbackOutcome::FollowingGate { decision, pending }) => {
            let projection =
                match crate::application::auth::service::project_access_decision(&decision) {
                    Ok(value) => value,
                    Err(error) => return internal_error(error),
                };
            if let Err(error) =
                update_loopback_following_gate(session_id, String::new(), &decision, pending)
            {
                return internal_error(error);
            }
            success_payload(
                "oauth2_resume_loopback",
                json!({
                    "status": "action_required",
                    "access_decision": projection,
                }),
            )
        }
        Err(error) => error,
    }
}

pub fn oauth2_cancel_loopback(input: OAuthLoopbackPollInput) -> AppResult<StubPayload> {
    let session_id = input.session_id.trim();
    if session_id.is_empty() {
        return invalid_argument("session_id is required");
    }
    match request_loopback_cancellation(session_id) {
        Ok(true) => {
            return success_payload("oauth2_cancel_loopback", json!({ "status": "completed" }))
        }
        Ok(false) => {}
        Err(error) => return internal_error(error),
    }
    let _mutation_guard = lock_connection_mutations();
    if loopback_sessions()
        .lock()
        .ok()
        .and_then(|sessions| {
            sessions
                .get(session_id)
                .map(|item| item.status == "completed")
        })
        .unwrap_or(false)
    {
        return success_payload("oauth2_cancel_loopback", json!({ "status": "completed" }));
    }
    let acknowledgement = match find_broker_acknowledgement_recovery(|record| {
        record.loopback_session_id == session_id
    }) {
        Ok(value) => value,
        Err(error) => return internal_error(error),
    };
    if let Some(record) = acknowledgement {
        if let Err(error) = persist_broker_cancellation_request(&record.loopback_session_id) {
            return internal_error(error);
        }
        match cancel_persisted_broker_login(&record.binding, &record.oauth_attempt_id) {
            Ok(OAuthAttemptResult::OauthAttemptResultAccessGranted) => {
                if let Err(error) =
                    remove_broker_acknowledgement_recovery(&record.loopback_session_id)
                {
                    return internal_error(error);
                }
                update_loopback_session(session_id, "completed", None, None);
                return success_payload("oauth2_cancel_loopback", json!({ "status": "completed" }));
            }
            Ok(_) => {
                if let Err(error) = rollback_broker_acknowledgement_recovery(&record) {
                    return internal_error(error);
                }
                if let Err(error) =
                    remove_broker_acknowledgement_recovery(&record.loopback_session_id)
                {
                    return internal_error(error);
                }
            }
            Err(error) => return error,
        }
    }
    let pending = match pending_broker_logins().lock() {
        Ok(logins) => logins.get(session_id).cloned(),
        Err(_) => return internal_error("OAuth pending-login registry is unavailable"),
    };
    if let Some(pending) = pending {
        if let Err(error) = cancel_broker_login(&pending.binding, &pending.oauth_attempt_id) {
            return error;
        }
        if let Ok(mut logins) = pending_broker_logins().lock() {
            logins.remove(session_id);
        }
    }
    update_loopback_session(session_id, "failed", None, Some("cancelled".to_string()));
    success_payload("oauth2_cancel_loopback", json!({ "status": "cancelled" }))
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
    use std::cell::Cell;

    static OAUTH_STORAGE_ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn oauth_local_rollback_restores_account_session_and_connection_bits_ut() {
        let _guard = OAUTH_STORAGE_ENV_LOCK.lock().expect("lock storage env");
        let root = std::env::temp_dir().join(format!(
            "peers-oauth-rollback-{}-{}",
            std::process::id(),
            ulid::Ulid::new(),
        ));
        fs::create_dir_all(&root).expect("create test storage root");
        let previous_root = std::env::var_os("PEERS_STORAGE_ROOT");
        std::env::set_var("PEERS_STORAGE_ROOT", &root);

        let actor_ptid = "ptid:test:oauth-rollback";
        let previous_identity = auth_identity::AccountIdentityState::default();
        auth_identity::write_state(&previous_identity).expect("write prior identity");
        let mut previous_connections = HashMap::new();
        previous_connections.insert(
            "github".to_string(),
            OAuthConnectionState {
                connection_id: "oauth-connection-old".to_string(),
                revision: 1,
                owner_ptid: actor_ptid.to_string(),
                provider_id: "github".to_string(),
                status: "disconnected".to_string(),
                ..Default::default()
            },
        );
        write_connections(&previous_connections).expect("write prior connections");
        session_store::save(actor_ptid, "old-token", SessionSource::OauthBridge)
            .expect("write prior session");
        let previous_session = session_store::load(actor_ptid).expect("load prior session");

        auth_identity::write_state(&auth_identity::AccountIdentityState {
            active_account_id: Some("partial-account".to_string()),
            accounts: Vec::new(),
        })
        .expect("write partial identity");
        write_connections(&HashMap::new()).expect("write partial connections");
        session_store::save(actor_ptid, "new-token", SessionSource::OauthBridge)
            .expect("write partial session");

        rollback_oauth_local_state(
            &previous_connections,
            Some(&previous_identity),
            Some(&previous_session),
            actor_ptid,
        )
        .expect("rollback local OAuth state");

        assert_eq!(
            serde_json::to_value(auth_identity::read_state().expect("read identity")).unwrap(),
            serde_json::to_value(previous_identity).unwrap(),
        );
        assert_eq!(
            serde_json::to_value(read_connections().expect("read connections")).unwrap(),
            serde_json::to_value(previous_connections).unwrap(),
        );
        assert_eq!(
            session_store::load(actor_ptid)
                .expect("read restored session")
                .token,
            "old-token",
        );
        let account_id = auth_identity::upsert_oauth_with_session(
            actor_ptid,
            "github",
            "42",
            "alice",
            None,
            Some("alice@example.test"),
            None,
            None,
        )
        .expect("publish completed OAuth account");
        let state = auth_identity::read_state().expect("read completed identity");
        let account = state
            .accounts
            .iter()
            .find(|account| account.id == account_id)
            .expect("completed account");
        assert!(account.has_session);
        assert_eq!(
            state.active_account_id.as_deref(),
            Some(account_id.as_str())
        );

        match previous_root {
            Some(value) => std::env::set_var("PEERS_STORAGE_ROOT", value),
            None => std::env::remove_var("PEERS_STORAGE_ROOT"),
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn loopback_session_ids_are_unpredictable_and_unique_bits_ut() {
        let first = next_loopback_session_id().expect("first session ID");
        let second = next_loopback_session_id().expect("second session ID");

        assert_ne!(first, second);
        assert!(first.starts_with("lp-"));
        assert_eq!(first.len(), 3 + 48);
    }

    #[test]
    fn loopback_receiver_proof_is_verifiable_and_unique_bits_ut() {
        let (first_verifier, first_challenge) =
            next_loopback_receiver_proof().expect("first receiver proof");
        let (second_verifier, second_challenge) =
            next_loopback_receiver_proof().expect("second receiver proof");

        assert_ne!(first_verifier, second_verifier);
        assert_ne!(first_challenge, second_challenge);
        assert_eq!(
            first_challenge,
            URL_SAFE_NO_PAD.encode(Sha256::digest(first_verifier.as_bytes())),
        );
    }

    #[test]
    fn broker_acknowledgement_lost_response_converges_from_status_bits_ut() {
        let acknowledge_calls = Cell::new(0);
        let status_calls = Cell::new(0);

        reconcile_broker_acknowledgement(
            || {
                acknowledge_calls.set(acknowledge_calls.get() + 1);
                Err("response lost".to_string())
            },
            || {
                status_calls.set(status_calls.get() + 1);
                Ok(GetOAuthAttemptResponse {
                    state: OAuthAttemptState::OauthAttemptStateActivated as i32,
                    result: OAuthAttemptResult::OauthAttemptResultAccessGranted as i32,
                    ..Default::default()
                })
            },
            Duration::ZERO,
        )
        .expect("activated status must settle a lost acknowledgement response");

        assert_eq!(acknowledge_calls.get(), 1);
        assert_eq!(status_calls.get(), 1);
    }

    #[test]
    fn broker_acknowledgement_retries_inactive_candidate_bits_ut() {
        let acknowledge_calls = Cell::new(0);
        let status_calls = Cell::new(0);

        reconcile_broker_acknowledgement(
            || {
                let call = acknowledge_calls.get() + 1;
                acknowledge_calls.set(call);
                if call == 1 {
                    return Err("response lost".to_string());
                }
                Ok(AcknowledgeOAuthCredentialResponse {
                    result: OAuthAttemptResult::OauthAttemptResultAccessGranted as i32,
                })
            },
            || {
                status_calls.set(status_calls.get() + 1);
                Ok(GetOAuthAttemptResponse {
                    state: OAuthAttemptState::OauthAttemptStateSessionCandidateIssued as i32,
                    result: OAuthAttemptResult::OauthAttemptResultAccessGranted as i32,
                    ..Default::default()
                })
            },
            Duration::ZERO,
        )
        .expect("inactive candidate must retry acknowledgement");

        assert_eq!(acknowledge_calls.get(), 2);
        assert_eq!(status_calls.get(), 1);
    }

    #[test]
    fn broker_acknowledgement_unknown_outcome_is_not_cancel_safe_bits_ut() {
        let failure = reconcile_broker_acknowledgement(
            || Err("station unavailable".to_string()),
            || Err("status unavailable".to_string()),
            Duration::ZERO,
        )
        .expect_err("unobservable acknowledgement must remain uncertain");

        assert_eq!(
            failure.disposition,
            BrokerAcknowledgementFailureDisposition::Retryable,
        );
        assert!(failure.message.contains("status readback failed"));
    }

    #[test]
    fn broker_acknowledgement_recovery_is_durable_before_local_commit_bits_ut() {
        let _guard = OAUTH_STORAGE_ENV_LOCK.lock().expect("lock storage env");
        let root = std::env::temp_dir().join(format!(
            "peers-oauth-ack-recovery-{}-{}",
            std::process::id(),
            ulid::Ulid::new(),
        ));
        fs::create_dir_all(&root).expect("create test storage root");
        let previous_root = std::env::var_os("PEERS_STORAGE_ROOT");
        std::env::set_var("PEERS_STORAGE_ROOT", &root);

        let session_id = "lp-recovery";
        let record = PendingBrokerAcknowledgement {
            loopback_session_id: session_id.to_string(),
            account_id: "oauth:github:42".to_string(),
            actor_ptid: "ptid:test:oauth-recovery".to_string(),
            oauth_attempt_id: "oauth-attempt-recovery".to_string(),
            binding: PersistedBrokerReceiverBinding {
                station_peer_id: "station-recovery".to_string(),
                access_attempt_id: "access-recovery".to_string(),
                device_id: "device-recovery".to_string(),
                lifecycle_generation: 7,
                attempt_secret: URL_SAFE_NO_PAD.encode(b"receiver-secret"),
            },
            phase: BrokerAcknowledgementRecoveryPhase::Prepared,
            next_retry_at: 0,
            previous_connections: HashMap::new(),
            previous_identity_state: auth_identity::AccountIdentityState::default(),
            previous_session: Some(PersistedSession {
                actor_ptid: "ptid:test:oauth-recovery".to_string(),
                token: "previous-session-secret".to_string(),
                saved_at: 1,
                source: SessionSource::OauthBridge,
            }),
        };
        persist_broker_acknowledgement_recovery(record).expect("persist recovery");
        let recovery_path = broker_acknowledgement_recovery_path().expect("resolve recovery path");
        let encrypted = fs::read_to_string(&recovery_path).expect("read encrypted recovery");
        assert!(!encrypted.contains("receiver-secret"));
        assert!(!encrypted.contains("previous-session-secret"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&recovery_path)
                    .expect("read recovery metadata")
                    .permissions()
                    .mode()
                    & 0o077,
                0,
            );
        }
        update_broker_acknowledgement_recovery(session_id, |stored| {
            stored.phase = BrokerAcknowledgementRecoveryPhase::LocalPersisted;
        })
        .expect("advance recovery phase");

        let loaded = find_broker_acknowledgement_recovery(|candidate| {
            candidate.loopback_session_id == session_id
        })
        .expect("read recovery")
        .expect("recovery record");
        assert_eq!(
            loaded.phase,
            BrokerAcknowledgementRecoveryPhase::LocalPersisted,
        );
        assert_eq!(
            loaded.binding.receiver_secret().expect("receiver secret"),
            b"receiver-secret",
        );
        assert_eq!(
            loaded
                .previous_session
                .as_ref()
                .map(|session| session.token.as_str()),
            Some("previous-session-secret"),
        );

        remove_broker_acknowledgement_recovery(session_id).expect("remove recovery");
        assert!(find_broker_acknowledgement_recovery(|candidate| {
            candidate.loopback_session_id == session_id
        })
        .expect("read removed recovery")
        .is_none());

        match previous_root {
            Some(value) => std::env::set_var("PEERS_STORAGE_ROOT", value),
            None => std::env::remove_var("PEERS_STORAGE_ROOT"),
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cancelled_broker_acknowledgement_recovery_never_acknowledges_after_restart_bits_ut() {
        let _guard = OAUTH_STORAGE_ENV_LOCK.lock().expect("lock storage env");
        let root = std::env::temp_dir().join(format!(
            "peers-oauth-cancel-recovery-{}-{}",
            std::process::id(),
            ulid::Ulid::new(),
        ));
        fs::create_dir_all(&root).expect("create test storage root");
        let previous_root = std::env::var_os("PEERS_STORAGE_ROOT");
        std::env::set_var("PEERS_STORAGE_ROOT", &root);

        let session_id = "lp-cancel-recovery";
        let record = PendingBrokerAcknowledgement {
            loopback_session_id: session_id.to_string(),
            account_id: "oauth:github:42".to_string(),
            actor_ptid: "ptid:test:oauth-cancel-recovery".to_string(),
            oauth_attempt_id: "oauth-attempt-cancel-recovery".to_string(),
            binding: PersistedBrokerReceiverBinding {
                station_peer_id: "station-cancel-recovery".to_string(),
                access_attempt_id: "access-cancel-recovery".to_string(),
                device_id: "device-cancel-recovery".to_string(),
                lifecycle_generation: 8,
                attempt_secret: URL_SAFE_NO_PAD.encode(b"receiver-secret"),
            },
            phase: BrokerAcknowledgementRecoveryPhase::LocalPersisted,
            next_retry_at: 0,
            previous_connections: HashMap::new(),
            previous_identity_state: auth_identity::AccountIdentityState::default(),
            previous_session: None,
        };
        persist_broker_acknowledgement_recovery(record).expect("persist recovery");
        persist_broker_cancellation_request(session_id).expect("persist cancellation intent");

        let cancellation_calls = Cell::new(0);
        reconcile_broker_cancellations_after_restart_with(|_, _| {
            cancellation_calls.set(cancellation_calls.get() + 1);
            Ok(OAuthAttemptResult::OauthAttemptResultCancelled)
        })
        .expect("recover cancellation");

        assert_eq!(cancellation_calls.get(), 1);
        assert!(find_broker_acknowledgement_recovery(|candidate| {
            candidate.loopback_session_id == session_id
        })
        .expect("read removed recovery")
        .is_none());

        match previous_root {
            Some(value) => std::env::set_var("PEERS_STORAGE_ROOT", value),
            None => std::env::remove_var("PEERS_STORAGE_ROOT"),
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn expired_action_required_loopback_is_terminal_and_pruned_bits_ut() {
        let now = 10_000;
        let mut sessions = HashMap::from([
            (
                "expired".to_string(),
                LoopbackSessionState {
                    status: "action_required".to_string(),
                    access_decision: Some(json!({ "state": "action_required" })),
                    created_at: now - LOOPBACK_SESSION_TTL_SECONDS,
                    ..Default::default()
                },
            ),
            (
                "live".to_string(),
                LoopbackSessionState {
                    status: "acknowledgement_pending".to_string(),
                    created_at: now - LOOPBACK_SESSION_TTL_SECONDS + 1,
                    ..Default::default()
                },
            ),
        ]);

        let expired = expire_loopback_sessions(&mut sessions, now);

        assert_eq!(expired, vec!["expired".to_string()]);
        let expired_session = sessions.get("expired").expect("terminal session retained");
        assert_eq!(expired_session.status, "expired");
        assert!(expired_session.access_decision.is_none());
        assert_eq!(expired_session.completed_at, Some(now));
        assert_eq!(
            sessions.get("live").map(|session| session.status.as_str()),
            Some("acknowledgement_pending")
        );
    }

    #[derive(Deserialize)]
    struct CredentialEnvelopeFixture {
        candidate_id: String,
        session_id: String,
        actor_ptid: String,
        station_peer_id: String,
        device_id: String,
        lifecycle_generation: u64,
        access_attempt_id: String,
        decision_revision: u64,
        client_private_key: String,
        server_ephemeral_public_key: String,
        nonce: String,
        ciphertext: String,
        expected_access_token: String,
        expected_refresh_token: String,
    }

    #[test]
    fn broker_credential_envelope_matches_go_fixture_bits_ut() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../mobile/src-tauri/src/runtime/oauth/fixtures/credential_envelope_go.json");
        let fixture: CredentialEnvelopeFixture =
            serde_json::from_slice(&fs::read(path).expect("read Go credential envelope fixture"))
                .expect("decode Go credential envelope fixture");
        let private_key: [u8; 32] = base64::engine::general_purpose::STANDARD
            .decode(&fixture.client_private_key)
            .expect("decode client private key")
            .try_into()
            .expect("client private key length");
        let delivery_public_key = PublicKey::from(&StaticSecret::from(private_key))
            .as_bytes()
            .to_vec();
        let binding = BrokerAccessBinding {
            station_peer_id: fixture.station_peer_id.clone(),
            access_attempt_id: fixture.access_attempt_id.clone(),
            gate_id: "auth.login".to_string(),
            device_id: fixture.device_id.clone(),
            lifecycle_generation: fixture.lifecycle_generation,
            attempt_secret: b"fixture-attempt-secret".to_vec(),
            delivery_private_key: private_key,
            delivery_public_key,
        };
        let completion = CompleteOAuthAttemptResponse {
            result: OAuthAttemptResult::OauthAttemptResultAccessGranted as i32,
            session_candidate: Some(crate::model::auth::AuthSessionCandidate {
                candidate_id: fixture.candidate_id.clone(),
                actor_ref: Some(crate::model::actor::ActorRef {
                    ptid: fixture.actor_ptid.clone(),
                    ..Default::default()
                }),
                oauth_attempt_id: "oauth-fixture".to_string(),
                access_attempt_id: fixture.access_attempt_id,
                station_peer_id: fixture.station_peer_id.clone(),
                device_id: fixture.device_id.clone(),
                lifecycle_generation: fixture.lifecycle_generation,
                decision_revision: fixture.decision_revision,
                ..Default::default()
            }),
            credential_envelope: Some(crate::model::oauth::mobile::OAuthCredentialEnvelope {
                candidate_id: fixture.candidate_id,
                session_id: fixture.session_id,
                actor_ref: Some(crate::model::actor::ActorRef {
                    ptid: fixture.actor_ptid,
                    ..Default::default()
                }),
                station_peer_id: fixture.station_peer_id,
                device_id: fixture.device_id,
                lifecycle_generation: fixture.lifecycle_generation,
                server_ephemeral_public_key: base64::engine::general_purpose::STANDARD
                    .decode(fixture.server_ephemeral_public_key)
                    .expect("decode server public key"),
                nonce: base64::engine::general_purpose::STANDARD
                    .decode(fixture.nonce)
                    .expect("decode nonce"),
                ciphertext: base64::engine::general_purpose::STANDARD
                    .decode(fixture.ciphertext)
                    .expect("decode ciphertext"),
                expires_at: None,
            }),
            ..Default::default()
        };

        let (_, credential, _) =
            decrypt_broker_credential(&binding, &completion).expect("decrypt Go fixture");
        let tokens = credential.tokens.expect("credential tokens");
        assert_eq!(tokens.access_token, fixture.expected_access_token);
        assert_eq!(tokens.refresh_token, fixture.expected_refresh_token,);
    }

    #[test]
    fn callback_query_uses_form_url_decoding_bits_ut() {
        let params = parse_query_params(
            "/callback?display_name=Alice+Example&username=alice%2Bdev&email_verified=true",
        );

        assert_eq!(
            params.get("display_name").map(String::as_str),
            Some("Alice Example")
        );
        assert_eq!(
            params.get("username").map(String::as_str),
            Some("alice+dev")
        );
        assert_eq!(
            params.get("email_verified").map(String::as_str),
            Some("true")
        );
    }

    #[test]
    fn oauth_bridge_request_preserves_signed_optional_fields_bits_ut() {
        let request = oauth_bridge_request(
            &OAuthCallbackInput {
                bridge_version: "v1".to_string(),
                site_id: "default".to_string(),
                purpose: "account_login".to_string(),
                assertion_id: "a".repeat(64),
                receiver_id: "lp-test".to_string(),
                receiver_challenge: "challenge".to_string(),
                receiver_verifier: "verifier".to_string(),
                provider: "github".to_string(),
                provider_user_id: "42".to_string(),
                union_id: None,
                username: None,
                display_name: None,
                email: None,
                email_verified: false,
                avatar_url: None,
                ts: "2026-10-01T00:00:00Z".to_string(),
                sig: "signature".to_string(),
            },
            None,
        );

        assert_eq!(request.username, "");
        assert_eq!(request.display_name, "");
        assert_eq!(request.email, "");
        assert!(!request.email_verified);
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
