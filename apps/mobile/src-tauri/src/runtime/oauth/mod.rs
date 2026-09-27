use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
#[cfg(test)]
use prost::Message;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroize;

use self::credential_envelope::{decrypt_credential_envelope, NativeSessionCredential};
use self::proto::access_gate::v1::{AccessDecisionState, AccessGateState, AccessGateType};
use self::proto::auth::v1::AuthSessionCandidate;
use self::proto::oauth::mobile::v1::{
    AcknowledgeOAuthCredentialRequest, AcknowledgeOAuthCredentialResponse,
    CancelOAuthAttemptRequest, CancelOAuthAttemptResponse, CompleteOAuthAttemptRequest,
    CompleteOAuthAttemptResponse, GetOAuthAttemptRequest, GetOAuthAttemptResponse,
    OAuthAttemptResult, OAuthAttemptState, OAuthCredentialEnvelope, StartOAuthAttemptRequest,
    StartOAuthAttemptResponse,
};
#[cfg(test)]
use self::transport::PROTOBUF_CONTENT_TYPE;
use self::transport::{validate_station_origin, StationOAuthTransport};
use crate::error::{MobileError, MobileResult};
use crate::platform::secure_storage::SecureStorage;

#[cfg(feature = "acceptance-harness")]
mod acceptance;
#[cfg(feature = "acceptance-harness")]
pub use acceptance::{
    configure_secure_storage_fault, CallbackReplayHandleProjection, CallbackReplayHandleRequest,
    NegativeCallbackProjection, NegativeCallbackRequest, SecureStorageFaultProjection,
};
mod access_gate;
mod credential_envelope;
mod proto;
pub(crate) mod session;
mod transport;
pub use access_gate::{
    NativeAccessDecisionInput, NativeAccessGateInput, NativeAccessProjection,
    NativeAccessStartInput, NativeAccessSubmitInput, NativeGenericFieldValue,
};
pub use session::NativeSessionProjection;

const ACTIVE_ATTEMPT_INDEX_KEY: &str = "oauth.active.index";
const DEVICE_ID_KEY: &str = "oauth.device.id";
const AUTH_GENERATION_KEY: &str = "oauth.auth.generation";
const CURRENT_SESSION_INDEX_KEY: &str = "oauth.session.current";
const LAST_PROJECTION_KEY: &str = "oauth.projection.last";
const ATTEMPT_KEY_PREFIX: &str = "oauth.attempt.";
const SESSION_KEY_PREFIX: &str = "oauth.session.";
const CALLBACK_SCHEME: &str = "peers-touch";
const CALLBACK_HOST: &str = "oauth";
const CALLBACK_PATH: &str = "/callback";
const CALLBACK_URI: &str = "peers-touch://oauth/callback";
const START_PATH: &str = "/oauth/mobile/start";
const COMPLETE_PATH: &str = "/oauth/mobile/complete";
const STATUS_PATH: &str = "/oauth/mobile/status";
const CANCEL_PATH: &str = "/oauth/mobile/cancel";
const ACKNOWLEDGE_PATH: &str = "/oauth/mobile/acknowledge";
const RANDOM_MATERIAL_BYTES: usize = 32;
const MAX_FIELD_BYTES: usize = 2048;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStartIntent {
    pub station_origin: String,
    pub station_peer_id: String,
    pub access_attempt_id: String,
    pub gate_id: String,
    pub provider: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthScopeIntent {
    pub station_origin: String,
    pub station_peer_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OAuthPublicPhase {
    Idle,
    Starting,
    AwaitingProvider,
    CallbackReceived,
    Exchanging,
    FollowingGate,
    CredentialDelivery,
    ActiveSession,
    Cancelled,
    Expired,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthSessionProjection {
    pub session_id: String,
    pub actor_ptid: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthCandidateProjection {
    pub candidate_id: String,
    pub actor_ptid: String,
    pub access_attempt_id: String,
    pub station_peer_id: String,
    pub decision_revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issued_at_unix_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at_unix_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthGateActionProjection {
    pub action_id: String,
    pub action_type: String,
    pub submit_action: String,
    pub schema_revision: u32,
    pub schema_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthGateProjection {
    pub gate_id: String,
    pub gate_type: String,
    pub state: String,
    pub title: String,
    pub description: String,
    pub blocking_reason: String,
    pub submit_action: String,
    pub input_schema_json: String,
    pub alternative_actions: Vec<OAuthGateActionProjection>,
    pub action_id: String,
    pub schema_revision: u32,
    pub schema_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthAccessDecisionProjection {
    pub state: String,
    pub attempt_id: String,
    pub current_gate_id: String,
    pub gates: Vec<OAuthGateProjection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_ptid: Option<String>,
    pub access_grant_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at_unix_ms: Option<u64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthPublicProjection {
    pub phase: OAuthPublicPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub station_peer_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_attempt_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at_unix_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate: Option<OAuthCandidateProjection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_decision: Option<OAuthAccessDecisionProjection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<OAuthSessionProjection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OAuthStationRevocation {
    NotRequired,
    Confirmed,
    Unconfirmed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthSecureStorageAbsence {
    pub active_attempt_index_absent: bool,
    pub attempt_secret_record_absent: bool,
    pub current_session_index_absent: bool,
    pub credential_record_absent: bool,
    pub public_projection_absent: bool,
}

impl OAuthSecureStorageAbsence {
    fn all_absent(&self) -> bool {
        self.active_attempt_index_absent
            && self.attempt_secret_record_absent
            && self.current_session_index_absent
            && self.credential_record_absent
            && self.public_projection_absent
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthPurgeProjection {
    pub station_revocation: OAuthStationRevocation,
    pub secure_storage: OAuthSecureStorageAbsence,
}

impl Default for OAuthPublicProjection {
    fn default() -> Self {
        Self {
            phase: OAuthPublicPhase::Idle,
            station_peer_id: None,
            provider: None,
            access_attempt_id: None,
            gate_id: None,
            expires_at_unix_ms: None,
            result: None,
            error_code: None,
            candidate: None,
            access_decision: None,
            session: None,
        }
    }
}

pub struct OAuthCoordinator {
    transport: StationOAuthTransport,
    operation_active: AtomicBool,
    #[cfg(feature = "acceptance-harness")]
    replay_vault: std::sync::Mutex<acceptance::CallbackReplayVault>,
}

impl OAuthCoordinator {
    pub fn new() -> MobileResult<Self> {
        Ok(Self {
            transport: StationOAuthTransport::new()?,
            operation_active: AtomicBool::new(false),
            #[cfg(feature = "acceptance-harness")]
            replay_vault: std::sync::Mutex::new(acceptance::CallbackReplayVault::default()),
        })
    }

    pub async fn start(
        &self,
        storage: &SecureStorage,
        input: OAuthStartIntent,
    ) -> MobileResult<OAuthLaunch> {
        let _operation = self.begin_operation()?;
        self.start_inner(storage, input).await
    }

    pub async fn status(
        &self,
        storage: &SecureStorage,
        scope: OAuthScopeIntent,
    ) -> MobileResult<OAuthPublicProjection> {
        let _operation = self.begin_operation()?;
        self.resume_inner(storage, scope).await
    }

    pub async fn restore(
        &self,
        storage: &SecureStorage,
        scope: OAuthScopeIntent,
    ) -> MobileResult<OAuthPublicProjection> {
        let _operation = self.begin_operation()?;
        self.resume_inner(storage, scope).await
    }

    pub async fn cancel(
        &self,
        storage: &SecureStorage,
        scope: OAuthScopeIntent,
    ) -> MobileResult<OAuthPublicProjection> {
        let _operation = self.begin_operation()?;
        let scope = ValidatedScope::new(scope)?;
        let Some(mut attempt) = read_active_attempt(storage)? else {
            return read_public_projection(storage);
        };
        ensure_scope_matches(storage, &attempt, &scope)?;
        self.cancel_attempt(storage, &mut attempt).await
    }

    pub async fn logout_purge(
        &self,
        storage: &SecureStorage,
        scope: Option<OAuthScopeIntent>,
    ) -> MobileResult<OAuthPurgeProjection> {
        self.logout_purge_inner(storage, scope).await
    }

    async fn logout_purge_inner<S: SecretStore>(
        &self,
        storage: &S,
        scope: Option<OAuthScopeIntent>,
    ) -> MobileResult<OAuthPurgeProjection> {
        let _operation = self.begin_operation()?;
        let scope = scope.map(ValidatedScope::new).transpose()?;
        let identity = load_optional_identity(storage)?;
        let active_attempt = read_active_attempt(storage)?;
        let attempt_storage_key = active_attempt
            .as_ref()
            .map(|attempt| attempt.storage_key.clone())
            .or_else(|| {
                scope
                    .as_ref()
                    .zip(identity.as_ref())
                    .map(|(scope, identity)| {
                        scoped_key(
                            ATTEMPT_KEY_PREFIX,
                            &scope.station_peer_id,
                            &identity.device_id,
                            identity.generation,
                        )
                    })
            });
        if let (Some(attempt), Some(scope)) = (active_attempt.as_ref(), scope.as_ref()) {
            ensure_scope_matches(storage, attempt, scope)?;
        }
        let current_session_key = storage
            .get_secret(CURRENT_SESSION_INDEX_KEY)?
            .map(|key| clean_required(key, "currentSessionStorageKey"))
            .transpose()?
            .or_else(|| {
                scope
                    .as_ref()
                    .zip(identity.as_ref())
                    .map(|(scope, identity)| {
                        scoped_key(
                            SESSION_KEY_PREFIX,
                            &scope.station_peer_id,
                            &identity.device_id,
                            identity.generation,
                        )
                    })
            });
        let active_session = current_session_key
            .as_deref()
            .map(|key| read_json(storage, key))
            .transpose()?
            .flatten();
        if let (Some(session), Some(scope)) = (active_session.as_ref(), scope.as_ref()) {
            ensure_session_scope_matches(session, identity.as_ref(), scope)?;
        }

        let attempt_revoked = match active_attempt {
            Some(mut attempt) => Some(self.cancel_attempt(storage, &mut attempt).await.is_ok()),
            None => None,
        };
        let session_revoked = match (active_session.as_ref(), scope.as_ref()) {
            (Some(session), Some(scope))
                if !session.access_token.is_empty() && !session.session_id.is_empty() =>
            {
                Some(
                    self.transport
                        .revoke_session(
                            &scope.station_origin,
                            &session.access_token,
                            &session.session_id,
                        )
                        .await
                        .is_ok(),
                )
            }
            (Some(_), _) => Some(false),
            (None, _) => None,
        };
        let station_revocation = match (attempt_revoked, session_revoked) {
            (None, None) => OAuthStationRevocation::NotRequired,
            (attempt, session) if attempt.unwrap_or(true) && session.unwrap_or(true) => {
                OAuthStationRevocation::Confirmed
            }
            _ => OAuthStationRevocation::Unconfirmed,
        };

        let secure_storage = purge_oauth_secure_storage(
            storage,
            attempt_storage_key.as_deref(),
            current_session_key.as_deref(),
        )?;
        session::purge_legacy_web_session(storage)?;
        #[cfg(feature = "acceptance-harness")]
        self.clear_callback_replay_vault()?;

        if !secure_storage.all_absent() {
            return Err(oauth_error("oauthSecurePurgeIncomplete"));
        }
        Ok(OAuthPurgeProjection {
            station_revocation,
            secure_storage,
        })
    }

    pub fn retry_browser_url(&self, storage: &SecureStorage) -> MobileResult<String> {
        let attempt =
            read_active_attempt(storage)?.ok_or_else(|| oauth_error("oauthAttemptMissing"))?;
        if attempt.phase != OAuthPublicPhase::AwaitingProvider {
            return Err(oauth_error("oauthBrowserRetryUnavailable"));
        }
        clean_required(attempt.authorize_url.clone(), "authorizeUrl")
    }

    pub fn projection(&self, storage: &SecureStorage) -> MobileResult<OAuthPublicProjection> {
        if let Some(attempt) = read_active_attempt(storage)? {
            return Ok(attempt.public_projection());
        }
        read_public_projection(storage)
    }

    pub async fn handle_callback(
        &self,
        storage: &SecureStorage,
        callback_url: &str,
    ) -> MobileResult<OAuthPublicProjection> {
        let _operation = self.begin_operation()?;
        let mut attempt =
            read_active_attempt(storage)?.ok_or_else(|| oauth_error("oauthAttemptMissing"))?;
        ensure_identity_matches(storage, &attempt)?;
        match validate_callback(&attempt, callback_url, now_unix_ms()) {
            Ok(CallbackDisposition::Claim {
                code,
                callback_digest,
            }) => {
                #[cfg(feature = "acceptance-harness")]
                self.capture_callback_for_replay(&attempt, callback_url)?;
                attempt.callback_code = Some(code);
                attempt.callback_digest = Some(callback_digest);
                attempt.phase = OAuthPublicPhase::CallbackReceived;
                attempt.error_code = None;
                write_attempt(storage, &attempt)?;
            }
            Ok(CallbackDisposition::ResumeClaimed) => {}
            Err(failure) => {
                return persist_terminal_callback_failure(storage, &mut attempt, failure);
            }
        }

        self.complete_or_status(storage, &mut attempt).await
    }

    async fn start_inner(
        &self,
        storage: &SecureStorage,
        input: OAuthStartIntent,
    ) -> MobileResult<OAuthLaunch> {
        let input = ValidatedStart::new(input)?;
        let mut identity = load_or_create_identity(storage)?;

        if let Some(mut active) = read_active_attempt(storage)? {
            if active.station_peer_id != input.station_peer_id() {
                self.cancel_attempt(storage, &mut active).await?;
                identity.generation = next_generation(identity.generation)?;
                write_identity(storage, &identity)?;
            } else {
                if active.device_id != identity.device_id
                    || active.lifecycle_generation != identity.generation
                {
                    return Err(oauth_error("oauthGenerationMismatch"));
                }
                ensure_start_binding(&active, &input)?;
                if active.station_origin != input.station_origin() {
                    active.station_origin = input.station_origin().to_string();
                    write_attempt(storage, &active)?;
                }
                if active.oauth_attempt_id.is_none() {
                    return self.start_station_attempt(storage, &mut active).await;
                }
                let projection = if active.callback_code.is_some() {
                    self.complete_or_status(storage, &mut active).await?
                } else {
                    active.public_projection()
                };
                return Ok(OAuthLaunch {
                    projection,
                    authorize_url: (active.phase == OAuthPublicPhase::AwaitingProvider)
                        .then_some(active.authorize_url.clone()),
                });
            }
        }

        let mut attempt = PersistedOAuthAttempt::new(input, identity);
        write_attempt_and_index(storage, &attempt)?;
        self.start_station_attempt(storage, &mut attempt).await
    }

    async fn start_station_attempt<S: SecretStore>(
        &self,
        storage: &S,
        attempt: &mut PersistedOAuthAttempt,
    ) -> MobileResult<OAuthLaunch> {
        let request = attempt.start_request();
        let response: StartOAuthAttemptResponse = match self
            .transport
            .post(&attempt.station_origin, START_PATH, &request)
            .await
        {
            Ok(response) => response,
            Err(error) => {
                attempt.error_code = Some("OAUTH_START_UNCERTAIN".to_string());
                write_attempt(storage, &attempt)?;
                write_public_projection(storage, &attempt.public_projection())?;
                return Err(error);
            }
        };
        attempt.bind_start_response(response)?;
        write_attempt(storage, &attempt)?;
        let projection = attempt.public_projection();
        write_public_projection(storage, &projection)?;
        Ok(OAuthLaunch {
            projection,
            authorize_url: Some(attempt.authorize_url.clone()),
        })
    }

    async fn resume_inner(
        &self,
        storage: &SecureStorage,
        scope: OAuthScopeIntent,
    ) -> MobileResult<OAuthPublicProjection> {
        let scope = ValidatedScope::new(scope)?;
        let Some(mut attempt) = read_active_attempt(storage)? else {
            return read_public_projection(storage);
        };
        ensure_scope_matches(storage, &attempt, &scope)?;
        if attempt.callback_code.is_some() {
            return self.complete_or_status(storage, &mut attempt).await;
        }
        if attempt.oauth_attempt_id.is_none() {
            return Ok(attempt.public_projection());
        }
        self.fetch_status(storage, &mut attempt).await
    }

    async fn complete_or_status<S: SecretStore>(
        &self,
        storage: &S,
        attempt: &mut PersistedOAuthAttempt,
    ) -> MobileResult<OAuthPublicProjection> {
        if completion_request_kind(attempt) == CompletionRequestKind::Status {
            return self.fetch_status(storage, attempt).await;
        }
        let request = attempt.complete_request()?;
        attempt.completion_submitted = true;
        attempt.phase = OAuthPublicPhase::Exchanging;
        write_attempt(storage, attempt)?;

        let response: CompleteOAuthAttemptResponse = match self
            .transport
            .post(&attempt.station_origin, COMPLETE_PATH, &request)
            .await
        {
            Ok(response) => response,
            Err(error) => {
                attempt.error_code = Some("OAUTH_COMPLETE_UNCERTAIN".to_string());
                write_attempt(storage, attempt)?;
                write_public_projection(storage, &attempt.public_projection())?;
                return Err(error);
            }
        };
        if OAuthAttemptResult::try_from(response.result).ok()
            == Some(OAuthAttemptResult::OauthAttemptResultReplayed)
        {
            return self.fetch_status(storage, attempt).await;
        }
        clear_resolved_callback_material(storage, attempt)?;
        self.apply_station_outcome(storage, attempt, StationOutcome::from_complete(response))
            .await
    }

    async fn fetch_status<S: SecretStore>(
        &self,
        storage: &S,
        attempt: &mut PersistedOAuthAttempt,
    ) -> MobileResult<OAuthPublicProjection> {
        let request = attempt.status_request()?;
        let response: GetOAuthAttemptResponse = self
            .transport
            .post(&attempt.station_origin, STATUS_PATH, &request)
            .await?;
        clear_resolved_callback_material(storage, attempt)?;
        self.apply_station_outcome(storage, attempt, StationOutcome::from_status(response))
            .await
    }

    async fn apply_station_outcome<S: SecretStore>(
        &self,
        storage: &S,
        attempt: &mut PersistedOAuthAttempt,
        outcome: StationOutcome,
    ) -> MobileResult<OAuthPublicProjection> {
        let result = OAuthAttemptResult::try_from(outcome.result)
            .map_err(|_| oauth_error("oauthInvalidStationResult"))?;
        apply_public_outcome_fields(attempt, &outcome)?;
        attempt.result = Some(result.as_str_name().to_string());
        attempt.error_code = nonempty(outcome.error_code);
        attempt.phase = public_phase(outcome.state, result)?;

        if let Some(envelope) = outcome.credential_envelope {
            if result != OAuthAttemptResult::OauthAttemptResultAccessGranted {
                return Err(oauth_error("oauthUnexpectedCredentialEnvelope"));
            }
            let candidate = outcome
                .session_candidate
                .as_ref()
                .ok_or_else(|| oauth_error("oauthMissingSessionCandidate"))?;
            ensure_optional_granted_decision(outcome.access_decision.as_ref())?;
            let credential = decrypt_and_validate(attempt, candidate, &envelope)?;
            persist_credential_before_ack(storage, attempt, candidate, credential)?;
            return self.acknowledge_credential(storage, attempt).await;
        }

        if result == OAuthAttemptResult::OauthAttemptResultAccessGranted {
            if attempt.credential_storage_key.is_some() {
                return finalize_acknowledged_session(storage, attempt);
            }
            return Err(oauth_error("oauthCredentialEnvelopeMissing"));
        }

        write_attempt(storage, attempt)?;
        let projection = attempt.public_projection();
        write_public_projection(storage, &projection)?;
        if is_terminal_result(result) {
            clear_active_attempt(storage, attempt)?;
        }
        Ok(projection)
    }

    async fn acknowledge_credential<S: SecretStore>(
        &self,
        storage: &S,
        attempt: &mut PersistedOAuthAttempt,
    ) -> MobileResult<OAuthPublicProjection> {
        let request = attempt.acknowledge_request()?;
        let response: AcknowledgeOAuthCredentialResponse = self
            .transport
            .post(&attempt.station_origin, ACKNOWLEDGE_PATH, &request)
            .await?;
        let result = OAuthAttemptResult::try_from(response.result)
            .map_err(|_| oauth_error("oauthInvalidAcknowledgeResult"))?;
        if result != OAuthAttemptResult::OauthAttemptResultAccessGranted {
            return Err(oauth_error("oauthCredentialAcknowledgeRejected"));
        }
        finalize_acknowledged_session(storage, attempt)
    }

    async fn cancel_attempt<S: SecretStore>(
        &self,
        storage: &S,
        attempt: &mut PersistedOAuthAttempt,
    ) -> MobileResult<OAuthPublicProjection> {
        if attempt.oauth_attempt_id.is_none() {
            let _ = self.start_station_attempt(storage, attempt).await?;
        }
        if attempt.oauth_attempt_id.is_some() {
            let request = attempt.cancel_request()?;
            let response: CancelOAuthAttemptResponse = self
                .transport
                .post(&attempt.station_origin, CANCEL_PATH, &request)
                .await?;
            let result = OAuthAttemptResult::try_from(response.result)
                .map_err(|_| oauth_error("oauthInvalidCancelResult"))?;
            if !matches!(
                result,
                OAuthAttemptResult::OauthAttemptResultCancelled
                    | OAuthAttemptResult::OauthAttemptResultExpired
                    | OAuthAttemptResult::OauthAttemptResultAccessDenied
            ) {
                return Err(oauth_error("oauthCancelRejected"));
            }
            attempt.result = Some(result.as_str_name().to_string());
        }
        attempt.phase = OAuthPublicPhase::Cancelled;
        attempt.error_code = None;
        let projection = attempt.public_projection();
        write_public_projection(storage, &projection)?;
        clear_active_attempt(storage, attempt)?;
        #[cfg(feature = "acceptance-harness")]
        self.clear_callback_replay_vault()?;
        Ok(projection)
    }

    fn begin_operation(&self) -> MobileResult<OperationGuard<'_>> {
        if self
            .operation_active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(oauth_error("oauthOperationInProgress"));
        }
        Ok(OperationGuard {
            active: &self.operation_active,
        })
    }
}

pub struct OAuthLaunch {
    pub projection: OAuthPublicProjection,
    pub authorize_url: Option<String>,
}

struct OperationGuard<'a> {
    active: &'a AtomicBool,
}

impl Drop for OperationGuard<'_> {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
    }
}

#[derive(Debug, PartialEq, Eq)]
enum CompletionRequestKind {
    Complete,
    Status,
}

fn completion_request_kind(attempt: &PersistedOAuthAttempt) -> CompletionRequestKind {
    if attempt.completion_submitted {
        CompletionRequestKind::Status
    } else {
        CompletionRequestKind::Complete
    }
}

#[derive(Clone)]
struct ValidatedScope {
    station_origin: String,
    station_peer_id: String,
}

impl ValidatedScope {
    fn new(input: OAuthScopeIntent) -> MobileResult<Self> {
        Ok(Self {
            station_origin: validate_station_origin(&input.station_origin)?,
            station_peer_id: clean_required(input.station_peer_id, "stationPeerId")?,
        })
    }
}

struct ValidatedStart {
    scope: ValidatedScope,
    access_attempt_id: String,
    gate_id: String,
    provider: String,
    redirect_uri: String,
}

impl ValidatedStart {
    fn new(input: OAuthStartIntent) -> MobileResult<Self> {
        Ok(Self {
            scope: ValidatedScope::new(OAuthScopeIntent {
                station_origin: input.station_origin,
                station_peer_id: input.station_peer_id,
            })?,
            access_attempt_id: clean_required(input.access_attempt_id, "accessAttemptId")?,
            gate_id: clean_required(input.gate_id, "gateId")?,
            provider: clean_provider(input.provider)?,
            redirect_uri: CALLBACK_URI.to_string(),
        })
    }

    fn station_origin(&self) -> &str {
        &self.scope.station_origin
    }

    fn station_peer_id(&self) -> &str {
        &self.scope.station_peer_id
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedIdentity {
    device_id: String,
    generation: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveAttemptIndex {
    attempt_storage_key: String,
    station_peer_id: String,
    device_id: String,
    lifecycle_generation: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedOAuthAttempt {
    storage_key: String,
    station_origin: String,
    station_peer_id: String,
    access_attempt_id: String,
    gate_id: String,
    provider: String,
    redirect_uri: String,
    device_id: String,
    lifecycle_generation: u64,
    pkce_verifier: String,
    nonce: String,
    attempt_secret: Vec<u8>,
    delivery_private_key: Vec<u8>,
    oauth_attempt_id: Option<String>,
    state: Option<String>,
    authorize_url: String,
    expires_at_unix_ms: Option<u64>,
    callback_code: Option<String>,
    #[serde(default)]
    callback_digest: Option<Vec<u8>>,
    completion_submitted: bool,
    credential_storage_key: Option<String>,
    phase: OAuthPublicPhase,
    result: Option<String>,
    error_code: Option<String>,
    public_candidate: Option<OAuthCandidateProjection>,
    public_access_decision: Option<OAuthAccessDecisionProjection>,
    public_session: Option<OAuthSessionProjection>,
}

impl Drop for PersistedOAuthAttempt {
    fn drop(&mut self) {
        self.pkce_verifier.zeroize();
        self.nonce.zeroize();
        self.attempt_secret.zeroize();
        self.delivery_private_key.zeroize();
        if let Some(value) = self.state.as_mut() {
            value.zeroize();
        }
        if let Some(value) = self.callback_code.as_mut() {
            value.zeroize();
        }
        if let Some(value) = self.callback_digest.as_mut() {
            value.zeroize();
        }
    }
}

impl PersistedOAuthAttempt {
    fn new(input: ValidatedStart, identity: PersistedIdentity) -> Self {
        let mut delivery_private_key = [0_u8; RANDOM_MATERIAL_BYTES];
        OsRng.fill_bytes(&mut delivery_private_key);
        let storage_key = scoped_key(
            ATTEMPT_KEY_PREFIX,
            input.station_peer_id(),
            &identity.device_id,
            identity.generation,
        );
        Self {
            storage_key,
            station_origin: input.station_origin().to_string(),
            station_peer_id: input.station_peer_id().to_string(),
            access_attempt_id: input.access_attempt_id,
            gate_id: input.gate_id,
            provider: input.provider,
            redirect_uri: input.redirect_uri,
            device_id: identity.device_id,
            lifecycle_generation: identity.generation,
            pkce_verifier: random_url_safe(),
            nonce: random_url_safe(),
            attempt_secret: random_bytes(),
            delivery_private_key: delivery_private_key.to_vec(),
            oauth_attempt_id: None,
            state: None,
            authorize_url: String::new(),
            expires_at_unix_ms: None,
            callback_code: None,
            callback_digest: None,
            completion_submitted: false,
            credential_storage_key: None,
            phase: OAuthPublicPhase::Starting,
            result: None,
            error_code: None,
            public_candidate: None,
            public_access_decision: None,
            public_session: None,
        }
    }

    fn start_request(&self) -> StartOAuthAttemptRequest {
        let private_key: [u8; RANDOM_MATERIAL_BYTES] = self
            .delivery_private_key
            .as_slice()
            .try_into()
            .expect("validated delivery private key");
        let public_key = PublicKey::from(&StaticSecret::from(private_key));
        StartOAuthAttemptRequest {
            provider: self.provider.clone(),
            station_peer_id: self.station_peer_id.clone(),
            access_attempt_id: self.access_attempt_id.clone(),
            gate_id: self.gate_id.clone(),
            redirect_uri: self.redirect_uri.clone(),
            pkce_challenge: sha256_url_safe(&self.pkce_verifier),
            pkce_method: "S256".to_string(),
            nonce_hash: sha256_url_safe(&self.nonce),
            action_type: AccessGateType::AuthOauth as i32,
            device_id: self.device_id.clone(),
            lifecycle_generation: self.lifecycle_generation,
            attempt_secret_hash: Sha256::digest(&self.attempt_secret).to_vec(),
            credential_delivery_public_key: public_key.as_bytes().to_vec(),
        }
    }

    fn bind_start_response(&mut self, response: StartOAuthAttemptResponse) -> MobileResult<()> {
        self.oauth_attempt_id = Some(clean_required(response.oauth_attempt_id, "oauthAttemptId")?);
        self.state = Some(clean_required(response.state, "state")?);
        self.authorize_url = validate_authorize_url(&response.authorize_url)?;
        let expires_at = timestamp_to_unix_ms(response.expires_at.as_ref())?;
        if expires_at <= now_unix_ms() {
            return Err(oauth_error("oauthExpired"));
        }
        self.expires_at_unix_ms = Some(expires_at);
        self.phase = OAuthPublicPhase::AwaitingProvider;
        self.error_code = None;
        Ok(())
    }

    fn complete_request(&self) -> MobileResult<CompleteOAuthAttemptRequest> {
        Ok(CompleteOAuthAttemptRequest {
            oauth_attempt_id: self.oauth_attempt_id()?,
            state: self.state()?,
            code: self
                .callback_code
                .clone()
                .ok_or_else(|| oauth_error("oauthCallbackMissing"))?,
            pkce_verifier: self.pkce_verifier.clone(),
            nonce: self.nonce.clone(),
            provider: self.provider.clone(),
            station_peer_id: self.station_peer_id.clone(),
            access_attempt_id: self.access_attempt_id.clone(),
            gate_id: self.gate_id.clone(),
            redirect_uri: self.redirect_uri.clone(),
            attempt_secret: self.attempt_secret.clone(),
            device_id: self.device_id.clone(),
            lifecycle_generation: self.lifecycle_generation,
        })
    }

    fn status_request(&self) -> MobileResult<GetOAuthAttemptRequest> {
        Ok(GetOAuthAttemptRequest {
            oauth_attempt_id: self.oauth_attempt_id()?,
            station_peer_id: self.station_peer_id.clone(),
            access_attempt_id: self.access_attempt_id.clone(),
            attempt_secret: self.attempt_secret.clone(),
            device_id: self.device_id.clone(),
            lifecycle_generation: self.lifecycle_generation,
        })
    }

    fn cancel_request(&self) -> MobileResult<CancelOAuthAttemptRequest> {
        Ok(CancelOAuthAttemptRequest {
            oauth_attempt_id: self.oauth_attempt_id()?,
            station_peer_id: self.station_peer_id.clone(),
            access_attempt_id: self.access_attempt_id.clone(),
            attempt_secret: self.attempt_secret.clone(),
            device_id: self.device_id.clone(),
            lifecycle_generation: self.lifecycle_generation,
        })
    }

    fn acknowledge_request(&self) -> MobileResult<AcknowledgeOAuthCredentialRequest> {
        Ok(AcknowledgeOAuthCredentialRequest {
            oauth_attempt_id: self.oauth_attempt_id()?,
            station_peer_id: self.station_peer_id.clone(),
            access_attempt_id: self.access_attempt_id.clone(),
            attempt_secret: self.attempt_secret.clone(),
            device_id: self.device_id.clone(),
            lifecycle_generation: self.lifecycle_generation,
        })
    }

    fn oauth_attempt_id(&self) -> MobileResult<String> {
        self.oauth_attempt_id
            .clone()
            .ok_or_else(|| oauth_error("oauthAttemptNotBound"))
    }

    fn state(&self) -> MobileResult<String> {
        self.state
            .clone()
            .ok_or_else(|| oauth_error("oauthAttemptNotBound"))
    }

    fn public_projection(&self) -> OAuthPublicProjection {
        OAuthPublicProjection {
            phase: self.phase.clone(),
            station_peer_id: Some(self.station_peer_id.clone()),
            provider: Some(self.provider.clone()),
            access_attempt_id: Some(self.access_attempt_id.clone()),
            gate_id: Some(self.gate_id.clone()),
            expires_at_unix_ms: self.expires_at_unix_ms,
            result: self.result.clone(),
            error_code: self.error_code.clone(),
            candidate: self.public_candidate.clone(),
            access_decision: self.public_access_decision.clone(),
            session: (self.phase == OAuthPublicPhase::ActiveSession)
                .then(|| self.public_session.clone())
                .flatten(),
        }
    }

    fn clear_callback_secrets(&mut self) {
        self.pkce_verifier.zeroize();
        self.nonce.zeroize();
        if let Some(value) = self.state.as_mut() {
            value.zeroize();
        }
        self.state = None;
        if let Some(value) = self.callback_code.as_mut() {
            value.zeroize();
        }
        self.callback_code = None;
    }

    fn clear_all_secret_material(&mut self) {
        self.clear_callback_secrets();
        if let Some(value) = self.callback_digest.as_mut() {
            value.zeroize();
        }
        self.callback_digest = None;
        self.attempt_secret.zeroize();
        self.delivery_private_key.zeroize();
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedNativeSession {
    station_peer_id: String,
    station_origin: String,
    device_id: String,
    lifecycle_generation: u64,
    candidate_id: String,
    session_id: String,
    actor_ptid: String,
    legacy_token: String,
    access_token: String,
    refresh_token: String,
    token_type: String,
    expires_at: String,
    acknowledged: bool,
}

impl Drop for PersistedNativeSession {
    fn drop(&mut self) {
        self.legacy_token.zeroize();
        self.access_token.zeroize();
        self.refresh_token.zeroize();
    }
}

struct StationOutcome {
    state: Option<i32>,
    result: i32,
    session_candidate: Option<AuthSessionCandidate>,
    access_decision: Option<proto::access_gate::v1::AccessDecision>,
    error_code: String,
    credential_envelope: Option<OAuthCredentialEnvelope>,
}

impl StationOutcome {
    fn from_complete(response: CompleteOAuthAttemptResponse) -> Self {
        Self {
            state: None,
            result: response.result,
            session_candidate: response.session_candidate,
            access_decision: response.access_decision,
            error_code: response.error_code,
            credential_envelope: response.credential_envelope,
        }
    }

    fn from_status(response: GetOAuthAttemptResponse) -> Self {
        Self {
            state: Some(response.state),
            result: response.result,
            session_candidate: response.session_candidate,
            access_decision: response.access_decision,
            error_code: response.error_code,
            credential_envelope: response.credential_envelope,
        }
    }
}

pub(crate) trait SecretStore {
    fn set_secret(&self, key: &str, value: &str) -> MobileResult<()>;
    fn get_secret(&self, key: &str) -> MobileResult<Option<String>>;
    fn remove_secret(&self, key: &str) -> MobileResult<()>;
}

impl SecretStore for SecureStorage {
    fn set_secret(&self, key: &str, value: &str) -> MobileResult<()> {
        self.set(key, value).map_err(Into::into)
    }

    fn get_secret(&self, key: &str) -> MobileResult<Option<String>> {
        self.get(key).map_err(Into::into)
    }

    fn remove_secret(&self, key: &str) -> MobileResult<()> {
        #[cfg(feature = "acceptance-harness")]
        acceptance::fail_next_secure_storage_remove()?;
        self.remove(key).map_err(Into::into)
    }
}

fn load_or_create_identity<S: SecretStore>(storage: &S) -> MobileResult<PersistedIdentity> {
    let device_id = match storage.get_secret(DEVICE_ID_KEY)? {
        Some(value) => clean_required(value, "deviceId")?,
        None => {
            let value = random_url_safe();
            storage.set_secret(DEVICE_ID_KEY, &value)?;
            value
        }
    };
    let generation = match storage.get_secret(AUTH_GENERATION_KEY)? {
        Some(value) => value
            .parse::<u64>()
            .ok()
            .filter(|generation| *generation != 0)
            .ok_or_else(|| oauth_error("oauthGenerationCorrupt"))?,
        None => {
            storage.set_secret(AUTH_GENERATION_KEY, "1")?;
            1
        }
    };
    Ok(PersistedIdentity {
        device_id,
        generation,
    })
}

fn load_existing_identity<S: SecretStore>(storage: &S) -> MobileResult<PersistedIdentity> {
    let device_id = storage
        .get_secret(DEVICE_ID_KEY)?
        .ok_or_else(|| oauth_error("oauthDeviceIdentityMissing"))
        .and_then(|value| clean_required(value, "deviceId"))?;
    let generation = storage
        .get_secret(AUTH_GENERATION_KEY)?
        .ok_or_else(|| oauth_error("oauthGenerationMissing"))?
        .parse::<u64>()
        .ok()
        .filter(|generation| *generation != 0)
        .ok_or_else(|| oauth_error("oauthGenerationCorrupt"))?;
    Ok(PersistedIdentity {
        device_id,
        generation,
    })
}

fn load_optional_identity<S: SecretStore>(storage: &S) -> MobileResult<Option<PersistedIdentity>> {
    let device_id_present = storage.get_secret(DEVICE_ID_KEY)?.is_some();
    let generation_present = storage.get_secret(AUTH_GENERATION_KEY)?.is_some();
    match (device_id_present, generation_present) {
        (false, false) => Ok(None),
        (true, true) => load_existing_identity(storage).map(Some),
        _ => Err(oauth_error("oauthIdentityIncomplete")),
    }
}

fn write_identity<S: SecretStore>(storage: &S, identity: &PersistedIdentity) -> MobileResult<()> {
    storage.set_secret(DEVICE_ID_KEY, &identity.device_id)?;
    storage.set_secret(AUTH_GENERATION_KEY, &identity.generation.to_string())
}

fn next_generation(current: u64) -> MobileResult<u64> {
    current
        .checked_add(1)
        .filter(|generation| *generation != 0)
        .ok_or_else(|| oauth_error("oauthGenerationExhausted"))
}

fn write_attempt_and_index<S: SecretStore>(
    storage: &S,
    attempt: &PersistedOAuthAttempt,
) -> MobileResult<()> {
    write_attempt(storage, attempt)?;
    let index = ActiveAttemptIndex {
        attempt_storage_key: attempt.storage_key.clone(),
        station_peer_id: attempt.station_peer_id.clone(),
        device_id: attempt.device_id.clone(),
        lifecycle_generation: attempt.lifecycle_generation,
    };
    write_json(storage, ACTIVE_ATTEMPT_INDEX_KEY, &index)
}

fn write_attempt<S: SecretStore>(storage: &S, attempt: &PersistedOAuthAttempt) -> MobileResult<()> {
    write_json(storage, &attempt.storage_key, attempt)
}

fn read_active_attempt<S: SecretStore>(storage: &S) -> MobileResult<Option<PersistedOAuthAttempt>> {
    let Some(index) = read_json::<_, ActiveAttemptIndex>(storage, ACTIVE_ATTEMPT_INDEX_KEY)? else {
        return Ok(None);
    };
    let attempt = read_json::<_, PersistedOAuthAttempt>(storage, &index.attempt_storage_key)?
        .ok_or_else(|| oauth_error("oauthAttemptIndexCorrupt"))?;
    if attempt.storage_key != index.attempt_storage_key
        || attempt.station_peer_id != index.station_peer_id
        || attempt.device_id != index.device_id
        || attempt.lifecycle_generation != index.lifecycle_generation
    {
        return Err(oauth_error("oauthAttemptIndexMismatch"));
    }
    Ok(Some(attempt))
}

fn clear_active_attempt<S: SecretStore>(
    storage: &S,
    attempt: &PersistedOAuthAttempt,
) -> MobileResult<()> {
    storage.remove_secret(&attempt.storage_key)?;
    storage.remove_secret(ACTIVE_ATTEMPT_INDEX_KEY)
}

fn purge_oauth_secure_storage<S: SecretStore>(
    storage: &S,
    attempt_storage_key: Option<&str>,
    credential_storage_key: Option<&str>,
) -> MobileResult<OAuthSecureStorageAbsence> {
    if let Some(key) = attempt_storage_key {
        storage.remove_secret(key)?;
    }
    storage.remove_secret(ACTIVE_ATTEMPT_INDEX_KEY)?;
    if let Some(key) = credential_storage_key {
        storage.remove_secret(key)?;
    }
    storage.remove_secret(CURRENT_SESSION_INDEX_KEY)?;
    storage.remove_secret(LAST_PROJECTION_KEY)?;

    Ok(OAuthSecureStorageAbsence {
        active_attempt_index_absent: storage.get_secret(ACTIVE_ATTEMPT_INDEX_KEY)?.is_none(),
        attempt_secret_record_absent: attempt_storage_key
            .map(|key| storage.get_secret(key))
            .transpose()?
            .flatten()
            .is_none(),
        current_session_index_absent: storage.get_secret(CURRENT_SESSION_INDEX_KEY)?.is_none(),
        credential_record_absent: credential_storage_key
            .map(|key| storage.get_secret(key))
            .transpose()?
            .flatten()
            .is_none(),
        public_projection_absent: storage.get_secret(LAST_PROJECTION_KEY)?.is_none(),
    })
}

fn clear_resolved_callback_material<S: SecretStore>(
    storage: &S,
    attempt: &mut PersistedOAuthAttempt,
) -> MobileResult<()> {
    attempt.clear_callback_secrets();
    write_attempt(storage, attempt)
}

fn persist_terminal_callback_failure<S: SecretStore>(
    storage: &S,
    attempt: &mut PersistedOAuthAttempt,
    failure: CallbackValidationFailure,
) -> MobileResult<OAuthPublicProjection> {
    attempt.phase = failure.phase;
    attempt.result = Some(failure.result.as_str_name().to_string());
    attempt.error_code = Some(failure.error_code.to_string());
    attempt.public_candidate = None;
    attempt.public_access_decision = None;
    attempt.public_session = None;
    let projection = attempt.public_projection();
    write_public_projection(storage, &projection)?;
    clear_active_attempt(storage, attempt)?;
    attempt.clear_all_secret_material();
    Ok(projection)
}

fn persist_credential_before_ack<S: SecretStore>(
    storage: &S,
    attempt: &mut PersistedOAuthAttempt,
    candidate: &AuthSessionCandidate,
    credential: NativeSessionCredential,
) -> MobileResult<()> {
    let key = scoped_key(
        SESSION_KEY_PREFIX,
        &attempt.station_peer_id,
        &attempt.device_id,
        attempt.lifecycle_generation,
    );
    let session = PersistedNativeSession {
        station_peer_id: attempt.station_peer_id.clone(),
        station_origin: attempt.station_origin.clone(),
        device_id: attempt.device_id.clone(),
        lifecycle_generation: attempt.lifecycle_generation,
        candidate_id: candidate.candidate_id.clone(),
        session_id: credential.session_id,
        actor_ptid: credential.actor_ptid,
        legacy_token: credential.legacy_token,
        access_token: credential.access_token,
        refresh_token: credential.refresh_token,
        token_type: credential.token_type,
        expires_at: credential.expires_at,
        acknowledged: false,
    };
    write_json(storage, &key, &session)?;
    attempt.credential_storage_key = Some(key);
    attempt.public_session = Some(OAuthSessionProjection {
        session_id: session.session_id.clone(),
        actor_ptid: session.actor_ptid.clone(),
        expires_at: session.expires_at.clone(),
    });
    attempt.phase = OAuthPublicPhase::CredentialDelivery;
    write_attempt(storage, attempt)
}

fn finalize_acknowledged_session<S: SecretStore>(
    storage: &S,
    attempt: &mut PersistedOAuthAttempt,
) -> MobileResult<OAuthPublicProjection> {
    let key = attempt
        .credential_storage_key
        .clone()
        .ok_or_else(|| oauth_error("oauthCredentialStorageMissing"))?;
    let mut session = read_json::<_, PersistedNativeSession>(storage, &key)?
        .ok_or_else(|| oauth_error("oauthCredentialStorageMissing"))?;
    ensure_session_binding(attempt, &session)?;
    session.acknowledged = true;
    write_json(storage, &key, &session)?;
    storage.set_secret(CURRENT_SESSION_INDEX_KEY, &key)?;

    attempt.phase = OAuthPublicPhase::ActiveSession;
    attempt.result = Some(
        OAuthAttemptResult::OauthAttemptResultAccessGranted
            .as_str_name()
            .to_string(),
    );
    attempt.error_code = None;
    let projection = attempt.public_projection();
    write_public_projection(storage, &projection)?;
    clear_active_attempt(storage, attempt)?;
    Ok(projection)
}

fn read_public_projection<S: SecretStore>(storage: &S) -> MobileResult<OAuthPublicProjection> {
    if let Some(key) = storage.get_secret(CURRENT_SESSION_INDEX_KEY)? {
        if let Some(session) = read_json::<_, PersistedNativeSession>(storage, &key)? {
            if session.acknowledged {
                return Ok(OAuthPublicProjection {
                    phase: OAuthPublicPhase::ActiveSession,
                    station_peer_id: Some(session.station_peer_id.clone()),
                    provider: None,
                    access_attempt_id: None,
                    gate_id: None,
                    expires_at_unix_ms: None,
                    result: Some(
                        OAuthAttemptResult::OauthAttemptResultAccessGranted
                            .as_str_name()
                            .to_string(),
                    ),
                    error_code: None,
                    candidate: None,
                    access_decision: None,
                    session: Some(OAuthSessionProjection {
                        session_id: session.session_id.clone(),
                        actor_ptid: session.actor_ptid.clone(),
                        expires_at: session.expires_at.clone(),
                    }),
                });
            }
        }
    }
    Ok(read_json(storage, LAST_PROJECTION_KEY)?.unwrap_or_default())
}

fn write_public_projection<S: SecretStore>(
    storage: &S,
    projection: &OAuthPublicProjection,
) -> MobileResult<()> {
    write_json(storage, LAST_PROJECTION_KEY, projection)
}

fn write_json<S: SecretStore, T: Serialize + ?Sized>(
    storage: &S,
    key: &str,
    value: &T,
) -> MobileResult<()> {
    let mut payload =
        serde_json::to_string(value).map_err(|_| oauth_error("oauthSecureRecordEncodeFailed"))?;
    let result = storage.set_secret(key, &payload);
    payload.zeroize();
    result
}

fn read_json<S: SecretStore, T: for<'de> Deserialize<'de>>(
    storage: &S,
    key: &str,
) -> MobileResult<Option<T>> {
    let Some(mut payload) = storage.get_secret(key)? else {
        return Ok(None);
    };
    let decoded =
        serde_json::from_str(&payload).map_err(|_| oauth_error("oauthSecureRecordCorrupt"));
    payload.zeroize();
    decoded.map(Some)
}

fn ensure_scope_matches<S: SecretStore>(
    storage: &S,
    attempt: &PersistedOAuthAttempt,
    scope: &ValidatedScope,
) -> MobileResult<()> {
    if attempt.station_peer_id != scope.station_peer_id
        || attempt.station_origin != scope.station_origin
    {
        return Err(oauth_error("oauthStationMismatch"));
    }
    ensure_identity_matches(storage, attempt)
}

fn ensure_session_scope_matches(
    session: &PersistedNativeSession,
    identity: Option<&PersistedIdentity>,
    scope: &ValidatedScope,
) -> MobileResult<()> {
    if session.station_peer_id != scope.station_peer_id
        || session.station_origin != scope.station_origin
        || identity.is_some_and(|identity| {
            session.device_id != identity.device_id
                || session.lifecycle_generation != identity.generation
        })
    {
        return Err(oauth_error("oauthSessionScopeMismatch"));
    }
    Ok(())
}

fn ensure_identity_matches<S: SecretStore>(
    storage: &S,
    attempt: &PersistedOAuthAttempt,
) -> MobileResult<()> {
    let identity = load_existing_identity(storage)?;
    if identity.device_id != attempt.device_id
        || identity.generation != attempt.lifecycle_generation
    {
        return Err(oauth_error("oauthGenerationMismatch"));
    }
    Ok(())
}

fn ensure_start_binding(
    attempt: &PersistedOAuthAttempt,
    input: &ValidatedStart,
) -> MobileResult<()> {
    if attempt.provider != input.provider
        || attempt.access_attempt_id != input.access_attempt_id
        || attempt.gate_id != input.gate_id
        || attempt.redirect_uri != input.redirect_uri
    {
        return Err(oauth_error("oauthActiveAttemptBindingMismatch"));
    }
    Ok(())
}

fn ensure_session_binding(
    attempt: &PersistedOAuthAttempt,
    session: &PersistedNativeSession,
) -> MobileResult<()> {
    if session.station_peer_id != attempt.station_peer_id
        || session.device_id != attempt.device_id
        || session.lifecycle_generation != attempt.lifecycle_generation
        || attempt
            .public_session
            .as_ref()
            .is_none_or(|public| public.session_id != session.session_id)
    {
        return Err(oauth_error("oauthCredentialBindingMismatch"));
    }
    Ok(())
}

fn decrypt_and_validate(
    attempt: &PersistedOAuthAttempt,
    candidate: &AuthSessionCandidate,
    envelope: &OAuthCredentialEnvelope,
) -> MobileResult<NativeSessionCredential> {
    if candidate.candidate_id.is_empty()
        || candidate.oauth_attempt_id != attempt.oauth_attempt_id()?
        || candidate.access_attempt_id != attempt.access_attempt_id
        || candidate.station_peer_id != attempt.station_peer_id
        || candidate.device_id != attempt.device_id
        || candidate.lifecycle_generation != attempt.lifecycle_generation
        || envelope.candidate_id != candidate.candidate_id
        || envelope.station_peer_id != attempt.station_peer_id
        || envelope.device_id != attempt.device_id
        || envelope.lifecycle_generation != attempt.lifecycle_generation
    {
        return Err(oauth_error("oauthCredentialBindingMismatch"));
    }
    let private_key: [u8; RANDOM_MATERIAL_BYTES] = attempt
        .delivery_private_key
        .as_slice()
        .try_into()
        .map_err(|_| oauth_error("oauthDeliveryKeyCorrupt"))?;
    decrypt_credential_envelope(
        envelope,
        &attempt.access_attempt_id,
        candidate.decision_revision,
        &private_key,
    )
}

fn ensure_optional_granted_decision(
    decision: Option<&proto::access_gate::v1::AccessDecision>,
) -> MobileResult<()> {
    if let Some(decision) = decision {
        if AccessDecisionState::try_from(decision.state).ok() != Some(AccessDecisionState::Granted)
        {
            return Err(oauth_error("oauthAccessNotGranted"));
        }
    }
    Ok(())
}

fn apply_public_outcome_fields(
    attempt: &mut PersistedOAuthAttempt,
    outcome: &StationOutcome,
) -> MobileResult<()> {
    if let Some(candidate) = outcome.session_candidate.as_ref() {
        attempt.public_candidate = Some(candidate_projection(candidate)?);
    }
    if let Some(decision) = outcome.access_decision.as_ref() {
        attempt.public_access_decision = Some(access_decision_projection(decision)?);
    }
    Ok(())
}

fn candidate_projection(
    candidate: &AuthSessionCandidate,
) -> MobileResult<OAuthCandidateProjection> {
    let actor_ptid = candidate
        .actor_ref
        .as_ref()
        .map(|actor| actor.ptid.trim())
        .filter(|ptid| !ptid.is_empty())
        .ok_or_else(|| oauth_error("oauthCandidateActorMissing"))?
        .to_string();
    Ok(OAuthCandidateProjection {
        candidate_id: clean_required(candidate.candidate_id.clone(), "candidateId")?,
        actor_ptid,
        access_attempt_id: clean_required(candidate.access_attempt_id.clone(), "accessAttemptId")?,
        station_peer_id: clean_required(candidate.station_peer_id.clone(), "stationPeerId")?,
        decision_revision: candidate.decision_revision,
        issued_at_unix_ms: optional_timestamp_to_unix_ms(candidate.issued_at.as_ref())?,
        expires_at_unix_ms: optional_timestamp_to_unix_ms(candidate.expires_at.as_ref())?,
    })
}

pub(super) fn access_decision_projection(
    decision: &proto::access_gate::v1::AccessDecision,
) -> MobileResult<OAuthAccessDecisionProjection> {
    let state = AccessDecisionState::try_from(decision.state)
        .map_err(|_| oauth_error("oauthInvalidAccessDecision"))?;
    let gates = decision
        .gates
        .iter()
        .map(|gate| {
            let gate_type = AccessGateType::try_from(gate.r#type)
                .map_err(|_| oauth_error("oauthInvalidAccessGateType"))?;
            let gate_state = AccessGateState::try_from(gate.state)
                .map_err(|_| oauth_error("oauthInvalidAccessGateState"))?;
            let alternative_actions = gate
                .alternative_actions
                .iter()
                .map(|action| {
                    let action_type = AccessGateType::try_from(action.r#type)
                        .map_err(|_| oauth_error("oauthInvalidAccessGateActionType"))?;
                    Ok(OAuthGateActionProjection {
                        action_id: action.action_id.clone(),
                        action_type: action_type.as_str_name().to_string(),
                        submit_action: action.submit_action.clone(),
                        schema_revision: action.schema_revision,
                        schema_digest: action.schema_digest.clone(),
                    })
                })
                .collect::<MobileResult<Vec<_>>>()?;
            Ok(OAuthGateProjection {
                gate_id: gate.gate_id.clone(),
                gate_type: gate_type.as_str_name().to_string(),
                state: gate_state.as_str_name().to_string(),
                title: gate.title.clone(),
                description: gate.description.clone(),
                blocking_reason: gate.blocking_reason.clone(),
                submit_action: gate.submit_action.clone(),
                input_schema_json: gate.input_schema_json.clone(),
                alternative_actions,
                action_id: gate.action_id.clone(),
                schema_revision: gate.schema_revision,
                schema_digest: gate.schema_digest.clone(),
            })
        })
        .collect::<MobileResult<Vec<_>>>()?;
    Ok(OAuthAccessDecisionProjection {
        state: state.as_str_name().to_string(),
        attempt_id: decision.attempt_id.clone(),
        current_gate_id: decision.current_gate_id.clone(),
        gates,
        actor_ptid: decision
            .actor
            .as_ref()
            .map(|actor| actor.ptid.clone())
            .filter(|ptid| !ptid.is_empty()),
        access_grant_id: decision.access_grant_id.clone(),
        expires_at_unix_ms: optional_timestamp_to_unix_ms(decision.expires_at.as_ref())?,
        message: decision.message.clone(),
    })
}

fn public_phase(state: Option<i32>, result: OAuthAttemptResult) -> MobileResult<OAuthPublicPhase> {
    match result {
        OAuthAttemptResult::OauthAttemptResultPending => {
            match state.and_then(|value| OAuthAttemptState::try_from(value).ok()) {
                Some(OAuthAttemptState::OauthAttemptStateAwaitingProvider) => {
                    Ok(OAuthPublicPhase::AwaitingProvider)
                }
                Some(OAuthAttemptState::OauthAttemptStateCallbackClaimed) => {
                    Ok(OAuthPublicPhase::Exchanging)
                }
                Some(OAuthAttemptState::OauthAttemptStateFollowingGate) => {
                    Ok(OAuthPublicPhase::FollowingGate)
                }
                _ => Ok(OAuthPublicPhase::Starting),
            }
        }
        OAuthAttemptResult::OauthAttemptResultSessionCandidateIssued => {
            Ok(OAuthPublicPhase::FollowingGate)
        }
        OAuthAttemptResult::OauthAttemptResultAccessGranted => {
            Ok(OAuthPublicPhase::CredentialDelivery)
        }
        OAuthAttemptResult::OauthAttemptResultCancelled => Ok(OAuthPublicPhase::Cancelled),
        OAuthAttemptResult::OauthAttemptResultExpired => Ok(OAuthPublicPhase::Expired),
        OAuthAttemptResult::OauthAttemptResultReplayed
        | OAuthAttemptResult::OauthAttemptResultBindingMismatch
        | OAuthAttemptResult::OauthAttemptResultProviderError
        | OAuthAttemptResult::OauthAttemptResultAccessDenied => Ok(OAuthPublicPhase::Failed),
        OAuthAttemptResult::OauthAttemptResultUnspecified => {
            Err(oauth_error("oauthInvalidStationResult"))
        }
    }
}

fn is_terminal_result(result: OAuthAttemptResult) -> bool {
    matches!(
        result,
        OAuthAttemptResult::OauthAttemptResultCancelled
            | OAuthAttemptResult::OauthAttemptResultExpired
            | OAuthAttemptResult::OauthAttemptResultReplayed
            | OAuthAttemptResult::OauthAttemptResultBindingMismatch
            | OAuthAttemptResult::OauthAttemptResultProviderError
            | OAuthAttemptResult::OauthAttemptResultAccessDenied
    )
}

#[derive(Debug, PartialEq, Eq)]
enum CallbackDisposition {
    Claim {
        code: String,
        callback_digest: Vec<u8>,
    },
    ResumeClaimed,
}

#[derive(Debug)]
struct CallbackValidationFailure {
    phase: OAuthPublicPhase,
    result: OAuthAttemptResult,
    error_code: &'static str,
}

impl CallbackValidationFailure {
    fn binding_mismatch() -> Self {
        Self {
            phase: OAuthPublicPhase::Failed,
            result: OAuthAttemptResult::OauthAttemptResultBindingMismatch,
            error_code: "OAUTH_CALLBACK_BINDING_MISMATCH",
        }
    }

    fn provider_error() -> Self {
        Self {
            phase: OAuthPublicPhase::Failed,
            result: OAuthAttemptResult::OauthAttemptResultProviderError,
            error_code: "OAUTH_PROVIDER_ERROR",
        }
    }

    fn expired() -> Self {
        Self {
            phase: OAuthPublicPhase::Expired,
            result: OAuthAttemptResult::OauthAttemptResultExpired,
            error_code: "OAUTH_CALLBACK_EXPIRED",
        }
    }

    fn replayed() -> Self {
        Self {
            phase: OAuthPublicPhase::Failed,
            result: OAuthAttemptResult::OauthAttemptResultReplayed,
            error_code: "OAUTH_CALLBACK_REPLAYED",
        }
    }
}

fn validate_callback(
    attempt: &PersistedOAuthAttempt,
    callback_url: &str,
    now_ms: u64,
) -> Result<CallbackDisposition, CallbackValidationFailure> {
    if attempt.callback_digest.is_some() {
        let callback_digest = Sha256::digest(callback_url.as_bytes());
        return if attempt.callback_digest.as_deref() == Some(callback_digest.as_slice()) {
            Ok(CallbackDisposition::ResumeClaimed)
        } else {
            Err(CallbackValidationFailure::replayed())
        };
    }
    if attempt.phase != OAuthPublicPhase::AwaitingProvider {
        return Err(CallbackValidationFailure::binding_mismatch());
    }
    if attempt
        .expires_at_unix_ms
        .is_none_or(|expiry| expiry <= now_ms)
    {
        return Err(CallbackValidationFailure::expired());
    }
    let callback = tauri::Url::parse(callback_url)
        .map_err(|_| CallbackValidationFailure::binding_mismatch())?;
    if callback.scheme() != CALLBACK_SCHEME
        || callback.host_str() != Some(CALLBACK_HOST)
        || callback.path() != CALLBACK_PATH
        || callback.fragment().is_some()
        || !callback.username().is_empty()
        || callback.password().is_some()
    {
        return Err(CallbackValidationFailure::binding_mismatch());
    }

    let state = unique_query_value(&callback, "state")?
        .ok_or_else(CallbackValidationFailure::binding_mismatch)?;
    if attempt.state.as_deref() != Some(state.as_str()) {
        return Err(CallbackValidationFailure::binding_mismatch());
    }
    if let Some(provider) = unique_query_value(&callback, "provider")? {
        if provider.to_ascii_lowercase() != attempt.provider {
            return Err(CallbackValidationFailure::binding_mismatch());
        }
    }
    if unique_query_value(&callback, "error")?.is_some() {
        return Err(CallbackValidationFailure::provider_error());
    }
    let code = unique_query_value(&callback, "code")?
        .filter(|code| !code.is_empty())
        .ok_or_else(CallbackValidationFailure::binding_mismatch)?;
    Ok(CallbackDisposition::Claim {
        code,
        callback_digest: Sha256::digest(callback_url.as_bytes()).to_vec(),
    })
}

fn unique_query_value(
    url: &tauri::Url,
    key: &str,
) -> Result<Option<String>, CallbackValidationFailure> {
    let mut values = url
        .query_pairs()
        .filter_map(|(name, value)| (name == key).then(|| value.into_owned()));
    let value = values.next();
    if values.next().is_some() {
        return Err(CallbackValidationFailure::binding_mismatch());
    }
    Ok(value)
}

fn validate_authorize_url(value: &str) -> MobileResult<String> {
    let url =
        tauri::Url::parse(value.trim()).map_err(|_| oauth_error("oauthInvalidAuthorizeUrl"))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(oauth_error("oauthInvalidAuthorizeUrl"));
    }
    Ok(url.to_string())
}

fn timestamp_to_unix_ms(timestamp: Option<&prost_types::Timestamp>) -> MobileResult<u64> {
    let timestamp = timestamp.ok_or_else(|| oauth_error("oauthExpiryMissing"))?;
    if timestamp.seconds < 0 || !(0..1_000_000_000).contains(&timestamp.nanos) {
        return Err(oauth_error("oauthExpiryInvalid"));
    }
    let seconds =
        u64::try_from(timestamp.seconds).map_err(|_| oauth_error("oauthExpiryInvalid"))?;
    seconds
        .checked_mul(1000)
        .and_then(|value| value.checked_add(timestamp.nanos as u64 / 1_000_000))
        .ok_or_else(|| oauth_error("oauthExpiryInvalid"))
}

fn optional_timestamp_to_unix_ms(
    timestamp: Option<&prost_types::Timestamp>,
) -> MobileResult<Option<u64>> {
    timestamp
        .map(|value| timestamp_to_unix_ms(Some(value)))
        .transpose()
}

fn scoped_key(prefix: &str, station_peer_id: &str, device_id: &str, generation: u64) -> String {
    let scope = format!("{station_peer_id}\0{device_id}\0{generation}");
    format!("{prefix}{}", URL_SAFE_NO_PAD.encode(Sha256::digest(scope)))
}

fn random_bytes() -> Vec<u8> {
    let mut bytes = vec![0_u8; RANDOM_MATERIAL_BYTES];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

fn random_url_safe() -> String {
    let mut bytes = random_bytes();
    let encoded = URL_SAFE_NO_PAD.encode(&bytes);
    bytes.zeroize();
    encoded
}

fn sha256_url_safe(value: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value.as_bytes()))
}

fn clean_provider(value: String) -> MobileResult<String> {
    let provider = clean_required(value, "provider")?.to_ascii_lowercase();
    if !matches!(provider.as_str(), "github" | "google") {
        return Err(oauth_error("oauthProviderUnsupported"));
    }
    Ok(provider)
}

fn clean_required(value: String, field: &str) -> MobileResult<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_FIELD_BYTES || value.contains('\0') {
        Err(MobileError::invalid_input(format!("{field} is invalid")))
    } else {
        Ok(value.to_string())
    }
}

fn nonempty(value: String) -> Option<String> {
    (!value.trim().is_empty()).then_some(value)
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn oauth_error(reason: &str) -> MobileError {
    MobileError::oauth(format!("mobile.auth.{reason}"))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::*;
    use crate::runtime::oauth::proto::access_gate::v1::AccessDecision;

    #[derive(Default)]
    pub(super) struct MemoryStore {
        values: Mutex<HashMap<String, String>>,
    }

    impl SecretStore for MemoryStore {
        fn set_secret(&self, key: &str, value: &str) -> MobileResult<()> {
            self.values
                .lock()
                .expect("memory store lock")
                .insert(key.to_string(), value.to_string());
            Ok(())
        }

        fn get_secret(&self, key: &str) -> MobileResult<Option<String>> {
            Ok(self
                .values
                .lock()
                .expect("memory store lock")
                .get(key)
                .cloned())
        }

        fn remove_secret(&self, key: &str) -> MobileResult<()> {
            self.values.lock().expect("memory store lock").remove(key);
            Ok(())
        }
    }

    fn validated_start() -> ValidatedStart {
        ValidatedStart::new(OAuthStartIntent {
            station_origin: "https://station.example".to_string(),
            station_peer_id: "12D3KooWStation".to_string(),
            access_attempt_id: "access-attempt".to_string(),
            gate_id: "auth-login".to_string(),
            provider: "github".to_string(),
        })
        .expect("valid start")
    }

    pub(super) fn bound_attempt() -> PersistedOAuthAttempt {
        let mut attempt = PersistedOAuthAttempt::new(
            validated_start(),
            PersistedIdentity {
                device_id: "device-id".to_string(),
                generation: 7,
            },
        );
        attempt.oauth_attempt_id = Some("oauth-attempt".to_string());
        attempt.state = Some("opaque-state".to_string());
        attempt.authorize_url = "https://github.com/login/oauth/authorize".to_string();
        attempt.expires_at_unix_ms = Some(u64::MAX);
        attempt.phase = OAuthPublicPhase::AwaitingProvider;
        attempt
    }

    #[test]
    fn protobuf_transport_request_round_trips_without_json() {
        let attempt = bound_attempt();
        let request = attempt.start_request();
        let encoded = request.encode_to_vec();
        let decoded =
            StartOAuthAttemptRequest::decode(encoded.as_slice()).expect("protobuf request decode");

        assert_eq!(decoded.station_peer_id, "12D3KooWStation");
        assert_eq!(decoded.device_id, "device-id");
        assert_eq!(decoded.lifecycle_generation, 7);
        assert_eq!(decoded.action_type, AccessGateType::AuthOauth as i32);
        assert_eq!(decoded.attempt_secret_hash.len(), 32);
        assert_eq!(decoded.credential_delivery_public_key.len(), 32);
        assert_eq!(PROTOBUF_CONTENT_TYPE, "application/x-protobuf");
    }

    #[test]
    fn exact_duplicate_callback_resumes_claim_via_status_without_second_complete() {
        let mut attempt = bound_attempt();
        let callback =
            "peers-touch://oauth/callback?code=provider-code&state=opaque-state&provider=github";
        let CallbackDisposition::Claim {
            code,
            callback_digest,
        } = validate_callback(&attempt, callback, 1).expect("valid callback")
        else {
            panic!("first callback must claim the attempt");
        };
        attempt.callback_code = Some(code);
        attempt.callback_digest = Some(callback_digest);
        attempt.completion_submitted = true;
        attempt.clear_callback_secrets();

        assert_eq!(
            validate_callback(&attempt, callback, u64::MAX)
                .expect("exact duplicate resumes claimed callback"),
            CallbackDisposition::ResumeClaimed
        );
        assert!(attempt.callback_code.is_none());
        assert!(attempt.state.is_none());
        assert!(attempt.pkce_verifier.is_empty());
        assert!(attempt.nonce.is_empty());
        assert_eq!(
            completion_request_kind(&attempt),
            CompletionRequestKind::Status
        );
    }

    #[test]
    fn different_callback_after_claim_is_rejected_as_replay() {
        let mut attempt = bound_attempt();
        let original =
            "peers-touch://oauth/callback?code=provider-code&state=opaque-state&provider=github";
        let CallbackDisposition::Claim {
            code,
            callback_digest,
        } = validate_callback(&attempt, original, 1).expect("valid callback")
        else {
            panic!("first callback must claim the attempt");
        };
        attempt.callback_code = Some(code);
        attempt.callback_digest = Some(callback_digest);

        let failure = validate_callback(
            &attempt,
            "peers-touch://oauth/callback?code=different&state=opaque-state&provider=github",
            1,
        )
        .expect_err("different callback must fail closed");
        assert_eq!(
            failure.result,
            OAuthAttemptResult::OauthAttemptResultReplayed
        );
        assert_eq!(failure.error_code, "OAUTH_CALLBACK_REPLAYED");
    }

    #[test]
    fn canonical_callback_failures_map_to_terminal_public_outcomes() {
        let cases = [
            (
                "peers-touch://oauth/callback?code=code&state=wrong",
                1,
                OAuthPublicPhase::Failed,
                OAuthAttemptResult::OauthAttemptResultBindingMismatch,
                "OAUTH_CALLBACK_BINDING_MISMATCH",
            ),
            (
                "peers-touch://oauth/callback?code=code&state=opaque-state&provider=google",
                1,
                OAuthPublicPhase::Failed,
                OAuthAttemptResult::OauthAttemptResultBindingMismatch,
                "OAUTH_CALLBACK_BINDING_MISMATCH",
            ),
            (
                "peers-touch://oauth/callback?error=access_denied&state=opaque-state",
                1,
                OAuthPublicPhase::Failed,
                OAuthAttemptResult::OauthAttemptResultProviderError,
                "OAUTH_PROVIDER_ERROR",
            ),
            (
                "peers-touch://oauth/callback?code=code&state=opaque-state",
                u64::MAX,
                OAuthPublicPhase::Expired,
                OAuthAttemptResult::OauthAttemptResultExpired,
                "OAUTH_CALLBACK_EXPIRED",
            ),
            (
                "peers-touch://oauth/callback?code=one&code=two&state=opaque-state",
                1,
                OAuthPublicPhase::Failed,
                OAuthAttemptResult::OauthAttemptResultBindingMismatch,
                "OAUTH_CALLBACK_BINDING_MISMATCH",
            ),
        ];

        for (callback, now_ms, phase, result, error_code) in cases {
            let failure = validate_callback(&bound_attempt(), callback, now_ms)
                .expect_err("canonical callback failure must fail closed");
            assert_eq!(failure.phase, phase);
            assert_eq!(failure.result, result);
            assert_eq!(failure.error_code, error_code);
        }
    }

    #[test]
    fn terminal_callback_failure_persists_sanitized_projection_and_removes_secrets() {
        let storage = MemoryStore::default();
        let mut attempt = bound_attempt();
        let attempt_key = attempt.storage_key.clone();
        let secret_values = [
            attempt.pkce_verifier.clone(),
            attempt.nonce.clone(),
            attempt.state.clone().expect("callback state"),
            URL_SAFE_NO_PAD.encode(&attempt.attempt_secret),
            URL_SAFE_NO_PAD.encode(&attempt.delivery_private_key),
        ];
        write_attempt_and_index(&storage, &attempt).expect("persist attempt");

        let failure = validate_callback(
            &attempt,
            "peers-touch://oauth/callback?code=one&code=two&state=opaque-state",
            1,
        )
        .expect_err("duplicate query must fail");
        let projection = persist_terminal_callback_failure(&storage, &mut attempt, failure)
            .expect("persist terminal projection");

        assert_eq!(projection.phase, OAuthPublicPhase::Failed);
        assert_eq!(
            projection.result.as_deref(),
            Some(OAuthAttemptResult::OauthAttemptResultBindingMismatch.as_str_name())
        );
        assert_eq!(
            projection.error_code.as_deref(),
            Some("OAUTH_CALLBACK_BINDING_MISMATCH")
        );
        assert!(
            read_active_attempt(&storage)
                .expect("read active attempt")
                .is_none(),
            "terminal callback failure must remove the active index"
        );
        assert!(
            storage
                .get_secret(&attempt_key)
                .expect("read attempt record")
                .is_none(),
            "terminal callback failure must remove the secret record"
        );

        let serialized = serde_json::to_string(&projection).expect("serialize projection");
        assert!(!serialized.contains("peers-touch://"));
        assert!(!serialized.contains("opaque-state"));
        assert!(!serialized.contains("\"code\""));
        for secret in secret_values {
            assert!(!serialized.contains(&secret));
        }
        assert!(attempt.pkce_verifier.is_empty());
        assert!(attempt.nonce.is_empty());
        assert!(attempt.attempt_secret.iter().all(|byte| *byte == 0));
        assert!(attempt.delivery_private_key.iter().all(|byte| *byte == 0));
    }

    #[test]
    fn active_attempt_recovers_from_persisted_index() {
        let storage = MemoryStore::default();
        let attempt = bound_attempt();
        write_attempt_and_index(&storage, &attempt).expect("persist attempt");

        let recovered = read_active_attempt(&storage)
            .expect("read active attempt")
            .expect("active attempt");
        assert_eq!(recovered.station_peer_id, attempt.station_peer_id);
        assert_eq!(recovered.oauth_attempt_id, attempt.oauth_attempt_id);
        assert_eq!(recovered.state, attempt.state);
        assert_eq!(recovered.attempt_secret.len(), RANDOM_MATERIAL_BYTES);
        assert_eq!(recovered.delivery_private_key.len(), RANDOM_MATERIAL_BYTES);
    }

    #[test]
    fn credential_is_persisted_unacknowledged_before_ack_request_exists() {
        let storage = MemoryStore::default();
        let mut attempt = bound_attempt();
        write_attempt_and_index(&storage, &attempt).expect("persist attempt");
        let candidate = AuthSessionCandidate {
            candidate_id: "candidate".to_string(),
            actor_ref: None,
            oauth_attempt_id: "oauth-attempt".to_string(),
            access_attempt_id: "access-attempt".to_string(),
            station_peer_id: "12D3KooWStation".to_string(),
            issued_at: None,
            expires_at: None,
            device_id: "device-id".to_string(),
            lifecycle_generation: 7,
            decision_revision: 9,
        };
        persist_credential_before_ack(
            &storage,
            &mut attempt,
            &candidate,
            NativeSessionCredential {
                session_id: "session".to_string(),
                actor_ptid: "did:peers:actor".to_string(),
                legacy_token: "legacy".to_string(),
                access_token: "access".to_string(),
                refresh_token: "refresh".to_string(),
                token_type: "Bearer".to_string(),
                expires_at: "2030-01-02T03:04:05Z".to_string(),
            },
        )
        .expect("persist credential");

        let key = attempt
            .credential_storage_key
            .as_deref()
            .expect("credential key");
        let stored: PersistedNativeSession = read_json(&storage, key)
            .expect("read credential")
            .expect("stored credential");
        assert!(!stored.acknowledged);
        assert_eq!(stored.access_token, "access");
        assert!(attempt.acknowledge_request().is_ok());
        assert!(read_public_projection(&storage)
            .expect("public projection")
            .session
            .is_none());
    }

    #[test]
    fn stable_device_id_and_nonzero_generation_survive_restart() {
        let storage = MemoryStore::default();
        let first = load_or_create_identity(&storage).expect("first identity");
        let restored = load_or_create_identity(&storage).expect("restored identity");
        assert_eq!(first.device_id, restored.device_id);
        assert_eq!(first.generation, 1);
        assert_eq!(restored.generation, 1);
    }

    #[test]
    fn active_attempt_reuse_requires_exact_oauth_binding() {
        let attempt = bound_attempt();
        let matching = validated_start();
        assert!(ensure_start_binding(&attempt, &matching).is_ok());

        let mut different = validated_start();
        different.provider = "google".to_string();
        assert!(ensure_start_binding(&attempt, &different).is_err());
        different.provider = "github".to_string();
        different.access_attempt_id = "other-access-attempt".to_string();
        assert!(ensure_start_binding(&attempt, &different).is_err());
    }

    #[test]
    fn scope_validation_uses_current_persisted_identity() {
        let storage = MemoryStore::default();
        storage
            .set_secret(DEVICE_ID_KEY, "device-id")
            .expect("persist device");
        storage
            .set_secret(AUTH_GENERATION_KEY, "7")
            .expect("persist generation");
        let attempt = bound_attempt();
        let scope = ValidatedScope::new(OAuthScopeIntent {
            station_origin: "https://station.example".to_string(),
            station_peer_id: "12D3KooWStation".to_string(),
        })
        .expect("valid scope");
        assert!(ensure_scope_matches(&storage, &attempt, &scope).is_ok());

        storage
            .set_secret(AUTH_GENERATION_KEY, "8")
            .expect("advance generation");
        assert!(ensure_scope_matches(&storage, &attempt, &scope).is_err());
    }

    #[test]
    fn persisted_envelope_recovery_allows_omitted_access_decision() {
        assert!(ensure_optional_granted_decision(None).is_ok());
        assert!(ensure_optional_granted_decision(Some(&AccessDecision {
            state: AccessDecisionState::Pending as i32,
            ..AccessDecision::default()
        }))
        .is_err());
        assert!(ensure_optional_granted_decision(Some(&AccessDecision {
            state: AccessDecisionState::Granted as i32,
            ..AccessDecision::default()
        }))
        .is_ok());
    }

    #[test]
    fn status_omission_preserves_the_last_access_decision_projection() {
        let mut attempt = bound_attempt();
        let expected = OAuthAccessDecisionProjection {
            state: AccessDecisionState::ActionRequired
                .as_str_name()
                .to_string(),
            attempt_id: "access-attempt".to_string(),
            current_gate_id: "profile-gate".to_string(),
            gates: Vec::new(),
            actor_ptid: None,
            access_grant_id: String::new(),
            expires_at_unix_ms: None,
            message: "public recovery state".to_string(),
        };
        attempt.public_access_decision = Some(expected.clone());
        let status_without_decision = StationOutcome {
            state: Some(OAuthAttemptState::OauthAttemptStateFollowingGate as i32),
            result: OAuthAttemptResult::OauthAttemptResultPending as i32,
            session_candidate: None,
            access_decision: None,
            error_code: String::new(),
            credential_envelope: None,
        };

        apply_public_outcome_fields(&mut attempt, &status_without_decision)
            .expect("apply status projection");

        assert_eq!(attempt.public_access_decision, Some(expected));
    }

    #[test]
    fn logout_purge_removes_native_oauth_records_and_returns_only_absence() {
        let storage = MemoryStore::default();
        storage
            .set_secret(DEVICE_ID_KEY, "device-id")
            .expect("persist device");
        storage
            .set_secret(AUTH_GENERATION_KEY, "7")
            .expect("persist generation");
        let session_key = scoped_key(SESSION_KEY_PREFIX, "12D3KooWStation", "device-id", 7);
        write_json(
            &storage,
            &session_key,
            &PersistedNativeSession {
                station_peer_id: "12D3KooWStation".to_string(),
                station_origin: "https://station.example:443".to_string(),
                device_id: "device-id".to_string(),
                lifecycle_generation: 7,
                candidate_id: "candidate".to_string(),
                session_id: "session".to_string(),
                actor_ptid: "did:peers:actor".to_string(),
                legacy_token: "legacy-secret".to_string(),
                access_token: "access-secret".to_string(),
                refresh_token: "refresh-secret".to_string(),
                token_type: "Bearer".to_string(),
                expires_at: "2030-01-02T03:04:05Z".to_string(),
                acknowledged: true,
            },
        )
        .expect("persist session");
        storage
            .set_secret(CURRENT_SESSION_INDEX_KEY, &session_key)
            .expect("persist session index");
        write_public_projection(
            &storage,
            &OAuthPublicProjection {
                phase: OAuthPublicPhase::ActiveSession,
                ..OAuthPublicProjection::default()
            },
        )
        .expect("persist projection");

        let coordinator = OAuthCoordinator::new().expect("coordinator");
        let result = tauri::async_runtime::block_on(coordinator.logout_purge_inner(&storage, None))
            .expect("purge");

        assert_eq!(
            result.station_revocation,
            OAuthStationRevocation::Unconfirmed
        );
        assert!(result.secure_storage.all_absent());
        assert!(storage
            .get_secret(&session_key)
            .expect("read session")
            .is_none());
        let serialized = serde_json::to_string(&result).expect("serialize purge projection");
        assert!(!serialized.contains("legacy-secret"));
        assert!(!serialized.contains("access-secret"));
        assert!(!serialized.contains("refresh-secret"));
        assert!(!serialized.contains("session"));
        assert!(!serialized.contains("did:peers:actor"));
    }

    #[test]
    fn logout_purge_proves_empty_native_state_without_a_station_scope() {
        let storage = MemoryStore::default();
        let coordinator = OAuthCoordinator::new().expect("coordinator");

        let result = tauri::async_runtime::block_on(coordinator.logout_purge_inner(&storage, None))
            .expect("scope-free purge");

        assert_eq!(
            result.station_revocation,
            OAuthStationRevocation::NotRequired
        );
        assert!(result.secure_storage.all_absent());
    }
}
