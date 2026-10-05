use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    MutexGuard,
};

use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

#[cfg(test)]
use super::CallbackDisposition;
use super::{
    clean_required, ensure_identity_matches, ensure_scope_matches, now_unix_ms, oauth_error,
    persist_terminal_callback_failure, random_url_safe, read_active_attempt, validate_callback,
    GetOAuthAttemptResponse, OAuthAttemptResult, OAuthCoordinator, OAuthPublicPhase,
    OAuthPublicProjection, PersistedOAuthAttempt, SecretStore, ValidatedScope, STATUS_PATH,
};
use crate::error::{MobileError, MobileResult};

const ACCEPTANCE_GATE_ID: &str = "mobile-native-access-e2e";
static FAIL_NEXT_SECURE_STORAGE_REMOVE: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecureStorageFaultProjection {
    pub mode: String,
}

pub fn configure_secure_storage_fault(mode: &str) -> MobileResult<SecureStorageFaultProjection> {
    let armed = match mode {
        "none" => false,
        "fail-next-remove" => true,
        _ => {
            return Err(MobileError::invalid_input(
                "unsupported secure-storage Acceptance fault",
            ))
        }
    };
    FAIL_NEXT_SECURE_STORAGE_REMOVE.store(armed, Ordering::SeqCst);
    Ok(SecureStorageFaultProjection {
        mode: mode.to_string(),
    })
}

pub(super) fn fail_next_secure_storage_remove() -> MobileResult<()> {
    if FAIL_NEXT_SECURE_STORAGE_REMOVE.swap(false, Ordering::SeqCst) {
        return Err(MobileError::secure_storage(
            "Acceptance fault: secure-storage remove unavailable",
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptanceBuildBinding {
    pub build_id: String,
    pub harness_enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptanceLeaseBinding {
    pub lease_ref: String,
    pub holder_run_id: String,
    pub fence_token: u64,
    pub state: String,
    pub expires_at_unix_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptanceStationBinding {
    pub service_id: String,
    pub station_origin: String,
    pub station_peer_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptanceRuntimeContext {
    pub build: AcceptanceBuildBinding,
    pub leases: Vec<AcceptanceLeaseBinding>,
    pub services: Vec<AcceptanceStationBinding>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CallbackReplayHandleRequest {
    pub run_id: String,
    pub gate_id: String,
    pub client_id: String,
    pub context: AcceptanceRuntimeContext,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CallbackReplayHandleProjection {
    pub callback_replay_handle: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NegativeCallbackFenceTokens {
    pub physical_device: u64,
    pub provider_account: u64,
    pub browser_session: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NegativeCallbackIntent {
    pub artifact_kind: String,
    pub run_id: String,
    pub gate_id: String,
    pub variant_id: String,
    pub client_id: String,
    pub operation: String,
    pub required_lease_refs: Vec<String>,
    pub holder_run_id: String,
    pub fence_tokens: NegativeCallbackFenceTokens,
    pub callback_replay_handle: String,
    pub replay_mode: String,
    pub alternate_service_id: String,
    pub expected_failure: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NegativeCallbackRequest {
    pub context: AcceptanceRuntimeContext,
    pub intent: NegativeCallbackIntent,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NegativeCallbackProjection {
    pub operation: String,
    pub failure: String,
    pub projection: OAuthPublicProjection,
}

#[derive(Default)]
pub(super) struct CallbackReplayVault {
    pending: Option<ReplayEntry>,
}

struct ReplayEntry {
    handle: String,
    callback_url: String,
    attempt_storage_key: String,
    run_id: Option<String>,
    client_id: Option<String>,
    build_id: Option<String>,
}

impl Drop for ReplayEntry {
    fn drop(&mut self) {
        self.handle.zeroize();
        self.callback_url.zeroize();
        self.attempt_storage_key.zeroize();
        if let Some(value) = self.run_id.as_mut() {
            value.zeroize();
        }
        if let Some(value) = self.client_id.as_mut() {
            value.zeroize();
        }
        if let Some(value) = self.build_id.as_mut() {
            value.zeroize();
        }
    }
}

impl CallbackReplayVault {
    fn capture(&mut self, attempt: &PersistedOAuthAttempt, callback_url: &str) {
        self.pending = Some(ReplayEntry {
            handle: random_url_safe(),
            callback_url: callback_url.to_string(),
            attempt_storage_key: attempt.storage_key.clone(),
            run_id: None,
            client_id: None,
            build_id: None,
        });
    }

    fn clear(&mut self) {
        self.pending = None;
    }
}

impl OAuthCoordinator {
    pub(super) fn capture_callback_for_replay(
        &self,
        attempt: &PersistedOAuthAttempt,
        callback_url: &str,
    ) -> MobileResult<()> {
        self.replay_vault()?.capture(attempt, callback_url);
        Ok(())
    }

    pub(crate) fn acceptance_callback_replay_handle<S: SecretStore>(
        &self,
        storage: &S,
        request: CallbackReplayHandleRequest,
    ) -> MobileResult<CallbackReplayHandleProjection> {
        let _operation = self.begin_operation()?;
        validate_gate(&request.gate_id)?;
        let run_id = clean_required(request.run_id, "runId")?;
        let client = ClientBinding::new(&request.client_id)?;
        validate_build(&request.context.build)?;
        validate_context_leases(&request.context, &run_id, &client)?;
        let attempt =
            read_active_attempt(storage)?.ok_or_else(|| oauth_error("oauthAttemptMissing"))?;
        validate_attempt(storage, &attempt, &request.context, &client)?;
        if attempt.callback_digest.is_none() {
            return Err(oauth_error("oauthReplayHandleUnavailable"));
        }

        let mut vault = self.replay_vault()?;
        let entry = vault
            .pending
            .as_mut()
            .filter(|entry| entry.attempt_storage_key == attempt.storage_key)
            .ok_or_else(|| oauth_error("oauthReplayHandleUnavailable"))?;
        match entry.run_id.as_deref() {
            Some(bound_run_id) if bound_run_id != run_id => {
                return Err(oauth_error("oauthReplayHandleRunMismatch"));
            }
            Some(_) => {}
            None => {
                entry.run_id = Some(run_id);
                entry.client_id = Some(client.client_id.to_string());
                entry.build_id = Some(request.context.build.build_id);
            }
        }
        Ok(CallbackReplayHandleProjection {
            callback_replay_handle: entry.handle.clone(),
        })
    }

    pub(crate) async fn acceptance_negative_callback<S: SecretStore>(
        &self,
        storage: &S,
        request: NegativeCallbackRequest,
    ) -> MobileResult<NegativeCallbackProjection> {
        let _operation = self.begin_operation()?;
        let validated = ValidatedNegativeIntent::new(request)?;
        let mut attempt =
            read_active_attempt(storage)?.ok_or_else(|| oauth_error("oauthAttemptMissing"))?;
        validate_attempt(storage, &attempt, &validated.context, &validated.client)?;

        let (failure, projection) = match validated.operation {
            NegativeOperation::Replay => {
                let mut entry = self.take_replay_entry(&validated, &attempt)?;
                let mut callback = different_callback_after_claim(&entry.callback_url)?;
                let failure = validate_callback(&attempt, &callback, now_unix_ms())
                    .err()
                    .filter(|failure| failure.error_code == "OAUTH_CALLBACK_REPLAYED")
                    .ok_or_else(|| oauth_error("oauthAcceptanceCouldSynthesizeSuccess"))?;
                callback.zeroize();
                entry.callback_url.zeroize();
                (
                    "oauthReplay",
                    persist_terminal_callback_failure(storage, &mut attempt, failure)?,
                )
            }
            NegativeOperation::ProviderMismatch => {
                if attempt.callback_digest.is_some() {
                    return Err(oauth_error("oauthProviderMismatchRequiresAwaitingAttempt"));
                }
                let mut callback = provider_mismatch_callback(&attempt)?;
                let failure = validate_callback(&attempt, &callback, now_unix_ms())
                    .err()
                    .filter(|failure| failure.error_code == "OAUTH_CALLBACK_BINDING_MISMATCH")
                    .ok_or_else(|| oauth_error("oauthAcceptanceCouldSynthesizeSuccess"))?;
                callback.zeroize();
                (
                    "oauthProviderMismatch",
                    persist_terminal_callback_failure(storage, &mut attempt, failure)?,
                )
            }
            NegativeOperation::StationMismatch => {
                let alternate = validated
                    .context
                    .services
                    .iter()
                    .find(|service| service.service_id == validated.intent.alternate_service_id)
                    .ok_or_else(|| oauth_error("oauthAcceptanceAlternateStationMissing"))?;
                let alternate_scope = ValidatedScope::new(super::OAuthScopeIntent {
                    station_origin: alternate.station_origin.clone(),
                    station_peer_id: alternate.station_peer_id.clone(),
                })?;
                if attempt.station_origin == alternate_scope.station_origin
                    || attempt.station_peer_id == alternate_scope.station_peer_id
                {
                    return Err(oauth_error("oauthAcceptanceAlternateStationInvalid"));
                }
                let response: GetOAuthAttemptResponse = self
                    .transport
                    .post(
                        &alternate_scope.station_origin,
                        STATUS_PATH,
                        &attempt.status_request()?,
                    )
                    .await?;
                (
                    "oauthStationMismatch",
                    station_binding_mismatch_projection(&attempt, response)?,
                )
            }
        };

        Ok(NegativeCallbackProjection {
            operation: validated.intent.operation,
            failure: failure.to_string(),
            projection,
        })
    }

    pub(super) fn clear_callback_replay_vault(&self) -> MobileResult<()> {
        self.replay_vault()?.clear();
        Ok(())
    }

    fn replay_vault(&self) -> MobileResult<MutexGuard<'_, CallbackReplayVault>> {
        self.replay_vault
            .lock()
            .map_err(|_| oauth_error("oauthReplayVaultUnavailable"))
    }

    fn take_replay_entry(
        &self,
        validated: &ValidatedNegativeIntent,
        attempt: &PersistedOAuthAttempt,
    ) -> MobileResult<ReplayEntry> {
        let mut vault = self.replay_vault()?;
        let matches = vault.pending.as_ref().is_some_and(|entry| {
            entry.handle == validated.intent.callback_replay_handle
                && entry.attempt_storage_key == attempt.storage_key
                && entry.run_id.as_deref() == Some(validated.intent.run_id.as_str())
                && entry.client_id.as_deref() == Some(validated.client.client_id)
                && entry.build_id.as_deref() == Some(validated.context.build.build_id.as_str())
        });
        if !matches {
            return Err(oauth_error("oauthReplayHandleMismatch"));
        }
        vault
            .pending
            .take()
            .ok_or_else(|| oauth_error("oauthReplayHandleUnavailable"))
    }
}

struct ValidatedNegativeIntent {
    context: AcceptanceRuntimeContext,
    intent: NegativeCallbackIntent,
    client: ClientBinding,
    operation: NegativeOperation,
}

impl ValidatedNegativeIntent {
    fn new(request: NegativeCallbackRequest) -> MobileResult<Self> {
        let context = request.context;
        let intent = request.intent;
        if intent.artifact_kind != "mobile-oauth-negative-callback-intent" {
            return Err(oauth_error("oauthAcceptanceIntentKindInvalid"));
        }
        validate_gate(&intent.gate_id)?;
        let run_id = clean_required(intent.run_id.clone(), "runId")?;
        if intent.holder_run_id != run_id {
            return Err(oauth_error("oauthAcceptanceRunMismatch"));
        }
        let client = ClientBinding::new(&intent.client_id)?;
        let operation = NegativeOperation::new(&intent.operation)?;
        operation.validate_intent(&intent, &client)?;
        validate_build(&context.build)?;
        validate_context_leases(&context, &run_id, &client)?;
        validate_intent_leases(&context, &intent, &client)?;
        Ok(Self {
            context,
            intent,
            client,
            operation,
        })
    }
}

#[derive(Clone, Copy)]
enum NegativeOperation {
    Replay,
    ProviderMismatch,
    StationMismatch,
}

impl NegativeOperation {
    fn new(value: &str) -> MobileResult<Self> {
        match value {
            "replay" => Ok(Self::Replay),
            "provider_mismatch" => Ok(Self::ProviderMismatch),
            "station_mismatch" => Ok(Self::StationMismatch),
            _ => Err(oauth_error("oauthAcceptanceOperationUnsupported")),
        }
    }

    fn validate_intent(
        self,
        intent: &NegativeCallbackIntent,
        client: &ClientBinding,
    ) -> MobileResult<()> {
        let expected_variant = match self {
            Self::Replay => format!("replay-{}", client.platform),
            Self::ProviderMismatch => format!("provider-mismatch-{}", client.platform),
            Self::StationMismatch => format!("station-mismatch-{}", client.platform),
        };
        let expected_failure = match self {
            Self::Replay => "oauthReplay",
            Self::ProviderMismatch => "oauthProviderMismatch",
            Self::StationMismatch => "oauthStationMismatch",
        };
        if intent.variant_id != expected_variant || intent.expected_failure != expected_failure {
            return Err(oauth_error("oauthAcceptanceVariantBindingMismatch"));
        }
        match self {
            Self::Replay => {
                if intent.callback_replay_handle.is_empty()
                    || intent.replay_mode != "different_after_claim"
                    || !intent.alternate_service_id.is_empty()
                {
                    return Err(oauth_error("oauthAcceptanceReplayIntentInvalid"));
                }
            }
            Self::ProviderMismatch => {
                if !intent.callback_replay_handle.is_empty()
                    || !intent.replay_mode.is_empty()
                    || !intent.alternate_service_id.is_empty()
                {
                    return Err(oauth_error("oauthAcceptanceProviderIntentInvalid"));
                }
            }
            Self::StationMismatch => {
                if !intent.callback_replay_handle.is_empty()
                    || !intent.replay_mode.is_empty()
                    || intent.alternate_service_id.is_empty()
                    || intent.alternate_service_id == client.service_id
                {
                    return Err(oauth_error("oauthAcceptanceStationIntentInvalid"));
                }
            }
        }
        Ok(())
    }
}

struct ClientBinding {
    client_id: &'static str,
    platform: &'static str,
    provider: &'static str,
    service_id: &'static str,
}

impl ClientBinding {
    fn new(client_id: &str) -> MobileResult<Self> {
        match client_id {
            "alice-ios" => Ok(Self {
                client_id: "alice-ios",
                platform: "ios",
                provider: "github",
                service_id: "station-primary",
            }),
            "alice-android" => Ok(Self {
                client_id: "alice-android",
                platform: "android",
                provider: "google",
                service_id: "station-primary",
            }),
            _ => Err(oauth_error("oauthAcceptanceClientUnsupported")),
        }
    }

    fn required_lease_refs(&self) -> [String; 3] {
        [
            format!("physical-device-lease/{}", self.client_id),
            format!("provider-account-lease/{}", self.provider),
            format!("browser-session-lease/{}", self.client_id),
        ]
    }
}

fn validate_gate(gate_id: &str) -> MobileResult<()> {
    if gate_id != ACCEPTANCE_GATE_ID {
        return Err(oauth_error("oauthAcceptanceGateMismatch"));
    }
    Ok(())
}

fn validate_build(build: &AcceptanceBuildBinding) -> MobileResult<()> {
    let build_id = clean_required(build.build_id.clone(), "buildId")?;
    if !build.harness_enabled || compiled_build_id() != Some(build_id.as_str()) {
        return Err(oauth_error("oauthAcceptanceBuildIdentityMismatch"));
    }
    Ok(())
}

fn compiled_build_id() -> Option<&'static str> {
    #[cfg(test)]
    {
        Some("test-build")
    }
    #[cfg(not(test))]
    {
        option_env!("PT_MOBILE_BUILD_ID")
    }
}

fn validate_context_leases(
    context: &AcceptanceRuntimeContext,
    run_id: &str,
    client: &ClientBinding,
) -> MobileResult<()> {
    let required = client.required_lease_refs();
    if context.leases.len() != required.len() {
        return Err(oauth_error("oauthAcceptanceLeaseSetInvalid"));
    }
    let mut unique = HashSet::new();
    for lease in &context.leases {
        if !unique.insert(lease.lease_ref.as_str())
            || !required.contains(&lease.lease_ref)
            || lease.holder_run_id != run_id
            || lease.fence_token == 0
            || !matches!(
                lease.state.as_str(),
                "LEASED" | "BASELINE_VERIFIED" | "IN_USE"
            )
            || lease.expires_at_unix_ms <= now_unix_ms()
        {
            return Err(oauth_error("oauthAcceptanceLeaseInvalid"));
        }
    }
    Ok(())
}

fn validate_intent_leases(
    context: &AcceptanceRuntimeContext,
    intent: &NegativeCallbackIntent,
    client: &ClientBinding,
) -> MobileResult<()> {
    let required = client.required_lease_refs();
    if intent.required_lease_refs != required {
        return Err(oauth_error("oauthAcceptanceLeaseBindingMismatch"));
    }
    let expected_fences = [
        intent.fence_tokens.physical_device,
        intent.fence_tokens.provider_account,
        intent.fence_tokens.browser_session,
    ];
    for (lease_ref, fence_token) in required.iter().zip(expected_fences) {
        let lease = context
            .leases
            .iter()
            .find(|lease| lease.lease_ref == *lease_ref)
            .ok_or_else(|| oauth_error("oauthAcceptanceLeaseBindingMismatch"))?;
        if fence_token == 0 || lease.fence_token != fence_token {
            return Err(oauth_error("oauthAcceptanceLeaseFenceMismatch"));
        }
    }
    Ok(())
}

fn validate_attempt<S: SecretStore>(
    storage: &S,
    attempt: &PersistedOAuthAttempt,
    context: &AcceptanceRuntimeContext,
    client: &ClientBinding,
) -> MobileResult<()> {
    ensure_identity_matches(storage, attempt)?;
    if attempt.oauth_attempt_id.is_none() || attempt.provider != client.provider {
        return Err(oauth_error("oauthAcceptanceAttemptBindingMismatch"));
    }
    let current_service = context
        .services
        .iter()
        .find(|service| service.service_id == client.service_id)
        .ok_or_else(|| oauth_error("oauthAcceptanceStationMissing"))?;
    let current_scope = ValidatedScope::new(super::OAuthScopeIntent {
        station_origin: current_service.station_origin.clone(),
        station_peer_id: current_service.station_peer_id.clone(),
    })?;
    ensure_scope_matches(storage, attempt, &current_scope)
}

fn different_callback_after_claim(original: &str) -> MobileResult<String> {
    let url =
        tauri::Url::parse(original).map_err(|_| oauth_error("oauthReplayCallbackUnavailable"))?;
    let mut pairs = Vec::new();
    let mut replaced_code = false;
    for (name, value) in url.query_pairs() {
        if name == "code" {
            pairs.push((name.into_owned(), random_url_safe()));
            replaced_code = true;
        } else {
            pairs.push((name.into_owned(), value.into_owned()));
        }
    }
    if !replaced_code {
        return Err(oauth_error("oauthReplayCallbackUnavailable"));
    }
    let mut different = url;
    different.query_pairs_mut().clear().extend_pairs(pairs);
    Ok(different.to_string())
}

fn provider_mismatch_callback(attempt: &PersistedOAuthAttempt) -> MobileResult<String> {
    let state = attempt
        .state
        .as_deref()
        .ok_or_else(|| oauth_error("oauthAttemptNotBound"))?;
    let provider = match attempt.provider.as_str() {
        "github" => "google",
        "google" => "github",
        _ => return Err(oauth_error("oauthProviderUnsupported")),
    };
    let mut callback = tauri::Url::parse(super::CALLBACK_URI)
        .map_err(|_| oauth_error("oauthCallbackRouteInvalid"))?;
    callback.query_pairs_mut().extend_pairs([
        ("code", random_url_safe().as_str()),
        ("state", state),
        ("provider", provider),
    ]);
    Ok(callback.to_string())
}

fn station_binding_mismatch_projection(
    attempt: &PersistedOAuthAttempt,
    response: GetOAuthAttemptResponse,
) -> MobileResult<OAuthPublicProjection> {
    if OAuthAttemptResult::try_from(response.result).ok()
        != Some(OAuthAttemptResult::OauthAttemptResultBindingMismatch)
        || response.error_code != "OAUTH_BINDING_MISMATCH"
        || response.session_candidate.is_some()
        || response.access_decision.is_some()
        || response.credential_envelope.is_some()
    {
        return Err(oauth_error("oauthAcceptanceStationMismatchResultInvalid"));
    }

    let mut projection = attempt.public_projection();
    projection.phase = OAuthPublicPhase::Failed;
    projection.result = Some(
        OAuthAttemptResult::OauthAttemptResultBindingMismatch
            .as_str_name()
            .to_string(),
    );
    projection.error_code = Some(response.error_code);
    projection.candidate = None;
    projection.access_decision = None;
    projection.session = None;
    Ok(projection)
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use prost::Message;

    use super::*;
    use crate::runtime::oauth::proto::oauth::mobile::v1::GetOAuthAttemptRequest;
    use crate::runtime::oauth::tests::{bound_attempt, MemoryStore};
    use crate::runtime::oauth::{write_attempt, write_attempt_and_index};

    #[test]
    fn secure_storage_fault_is_closed_and_one_shot() {
        assert_eq!(
            configure_secure_storage_fault("fail-next-remove")
                .expect("arm fault")
                .mode,
            "fail-next-remove"
        );
        let failure = fail_next_secure_storage_remove().expect_err("first remove must fail");
        assert_eq!(failure.code, "MOBILE_SECURE_STORAGE");
        fail_next_secure_storage_remove().expect("fault must be consumed");
        assert!(configure_secure_storage_fault("unknown").is_err());
        configure_secure_storage_fault("none").expect("reset fault");
    }

    fn context(client_id: &str) -> AcceptanceRuntimeContext {
        let client = ClientBinding::new(client_id).expect("supported client");
        let refs = client.required_lease_refs();
        AcceptanceRuntimeContext {
            build: AcceptanceBuildBinding {
                build_id: "test-build".to_string(),
                harness_enabled: true,
            },
            leases: refs
                .into_iter()
                .zip([9, 42, 18])
                .map(|(lease_ref, fence_token)| AcceptanceLeaseBinding {
                    lease_ref,
                    holder_run_id: "run-1".to_string(),
                    fence_token,
                    state: "IN_USE".to_string(),
                    expires_at_unix_ms: u64::MAX,
                })
                .collect(),
            services: vec![
                AcceptanceStationBinding {
                    service_id: "station-primary".to_string(),
                    station_origin: "https://station.example".to_string(),
                    station_peer_id: "12D3KooWStation".to_string(),
                },
                AcceptanceStationBinding {
                    service_id: "station-secondary".to_string(),
                    station_origin: "https://other.example".to_string(),
                    station_peer_id: "12D3KooWOther".to_string(),
                },
            ],
        }
    }

    fn intent(operation: &str, handle: &str) -> NegativeCallbackIntent {
        let variant = match operation {
            "replay" => "replay-ios",
            "provider_mismatch" => "provider-mismatch-ios",
            "station_mismatch" => "station-mismatch-ios",
            _ => unreachable!(),
        };
        let expected_failure = match operation {
            "replay" => "oauthReplay",
            "provider_mismatch" => "oauthProviderMismatch",
            "station_mismatch" => "oauthStationMismatch",
            _ => unreachable!(),
        };
        NegativeCallbackIntent {
            artifact_kind: "mobile-oauth-negative-callback-intent".to_string(),
            run_id: "run-1".to_string(),
            gate_id: ACCEPTANCE_GATE_ID.to_string(),
            variant_id: variant.to_string(),
            client_id: "alice-ios".to_string(),
            operation: operation.to_string(),
            required_lease_refs: ClientBinding::new("alice-ios")
                .expect("client")
                .required_lease_refs()
                .to_vec(),
            holder_run_id: "run-1".to_string(),
            fence_tokens: NegativeCallbackFenceTokens {
                physical_device: 9,
                provider_account: 42,
                browser_session: 18,
            },
            callback_replay_handle: handle.to_string(),
            replay_mode: (operation == "replay")
                .then_some("different_after_claim")
                .unwrap_or_default()
                .to_string(),
            alternate_service_id: (operation == "station_mismatch")
                .then_some("station-secondary")
                .unwrap_or_default()
                .to_string(),
            expected_failure: expected_failure.to_string(),
        }
    }

    fn prepare_storage() -> MemoryStore {
        let storage = MemoryStore::default();
        storage
            .set_secret(super::super::DEVICE_ID_KEY, "device-id")
            .expect("device");
        storage
            .set_secret(super::super::AUTH_GENERATION_KEY, "7")
            .expect("generation");
        storage
    }

    fn run_negative(
        coordinator: &OAuthCoordinator,
        storage: &MemoryStore,
        request: NegativeCallbackRequest,
    ) -> MobileResult<NegativeCallbackProjection> {
        tauri::async_runtime::block_on(coordinator.acceptance_negative_callback(storage, request))
    }

    fn spawn_binding_mismatch_station() -> (String, thread::JoinHandle<GetOAuthAttemptRequest>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind alternate Station");
        let address = listener.local_addr().expect("alternate Station address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept OAuth status request");
            let mut request_bytes = Vec::new();
            let mut buffer = [0_u8; 4096];
            let body_offset = loop {
                let read = stream.read(&mut buffer).expect("read OAuth status request");
                assert_ne!(read, 0, "request ended before HTTP headers");
                request_bytes.extend_from_slice(&buffer[..read]);
                if let Some(offset) = request_bytes
                    .windows(4)
                    .position(|window| window == b"\r\n\r\n")
                    .map(|offset| offset + 4)
                {
                    break offset;
                }
            };
            let headers =
                std::str::from_utf8(&request_bytes[..body_offset]).expect("OAuth request headers");
            assert!(headers.starts_with("POST /oauth/mobile/status HTTP/1.1\r\n"));
            assert!(headers
                .to_ascii_lowercase()
                .contains("content-type: application/protobuf"));
            let content_length = headers
                .lines()
                .find_map(|line| {
                    line.split_once(':').and_then(|(name, value)| {
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().expect("content length"))
                    })
                })
                .expect("content length header");
            while request_bytes.len() - body_offset < content_length {
                let read = stream.read(&mut buffer).expect("read OAuth request body");
                assert_ne!(read, 0, "request ended before protobuf body");
                request_bytes.extend_from_slice(&buffer[..read]);
            }
            let request = GetOAuthAttemptRequest::decode(
                &request_bytes[body_offset..body_offset + content_length],
            )
            .expect("decode OAuth status request");
            let body = GetOAuthAttemptResponse {
                result: OAuthAttemptResult::OauthAttemptResultBindingMismatch as i32,
                error_code: "OAUTH_BINDING_MISMATCH".to_string(),
                ..GetOAuthAttemptResponse::default()
            }
            .encode_to_vec();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/x-protobuf\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .expect("write OAuth response headers");
            stream.write_all(&body).expect("write OAuth response body");
            request
        });
        (format!("http://{address}"), server)
    }

    #[test]
    fn provider_mismatch_uses_production_validator_and_cannot_succeed() {
        let storage = prepare_storage();
        let attempt = bound_attempt();
        write_attempt_and_index(&storage, &attempt).expect("attempt");
        let coordinator = OAuthCoordinator::new().expect("coordinator");

        let result = run_negative(
            &coordinator,
            &storage,
            NegativeCallbackRequest {
                context: context("alice-ios"),
                intent: intent("provider_mismatch", ""),
            },
        )
        .expect("typed rejection");

        assert_eq!(result.failure, "oauthProviderMismatch");
        assert_eq!(result.projection.phase, OAuthPublicPhase::Failed);
        assert!(read_active_attempt(&storage).expect("read").is_none());
    }

    #[test]
    fn replay_handle_is_run_scoped_one_use_and_changes_the_claimed_callback() {
        let storage = prepare_storage();
        let mut attempt = bound_attempt();
        let callback =
            "peers-touch://oauth/callback?code=original&state=opaque-state&provider=github";
        let CallbackDisposition::Claim {
            code,
            callback_digest,
        } = validate_callback(&attempt, callback, 1).expect("claim")
        else {
            panic!("callback must claim");
        };
        attempt.callback_code = Some(code);
        attempt.callback_digest = Some(callback_digest);
        attempt.completion_submitted = true;
        attempt.clear_callback_secrets();
        write_attempt_and_index(&storage, &attempt).expect("attempt");

        let coordinator = OAuthCoordinator::new().expect("coordinator");
        coordinator
            .capture_callback_for_replay(&attempt, callback)
            .expect("capture");
        let handle = coordinator
            .acceptance_callback_replay_handle(
                &storage,
                CallbackReplayHandleRequest {
                    run_id: "run-1".to_string(),
                    gate_id: ACCEPTANCE_GATE_ID.to_string(),
                    client_id: "alice-ios".to_string(),
                    context: context("alice-ios"),
                },
            )
            .expect("handle");
        let result = run_negative(
            &coordinator,
            &storage,
            NegativeCallbackRequest {
                context: context("alice-ios"),
                intent: intent("replay", &handle.callback_replay_handle),
            },
        )
        .expect("typed replay");

        assert_eq!(result.failure, "oauthReplay");
        assert_eq!(result.projection.phase, OAuthPublicPhase::Failed);
        let serialized = serde_json::to_string(&result).expect("serialize result");
        assert!(!serialized.contains("peers-touch://"));
        assert!(!serialized.contains("opaque-state"));
        assert!(!serialized.contains("original"));
        assert!(coordinator.replay_vault().expect("vault").pending.is_none());
        assert!(run_negative(
            &coordinator,
            &storage,
            NegativeCallbackRequest {
                context: context("alice-ios"),
                intent: intent("replay", &handle.callback_replay_handle),
            },
        )
        .is_err());
    }

    #[test]
    fn station_mismatch_uses_alternate_station_transport_without_mutating_attempt() {
        let storage = prepare_storage();
        let attempt = bound_attempt();
        write_attempt_and_index(&storage, &attempt).expect("attempt");
        let persisted_before = storage
            .get_secret(&attempt.storage_key)
            .expect("read original attempt")
            .expect("persisted original attempt");
        let (alternate_origin, station) = spawn_binding_mismatch_station();
        let mut runtime_context = context("alice-ios");
        runtime_context.services[1].station_origin = alternate_origin;
        let coordinator = OAuthCoordinator::new().expect("coordinator");

        let result = run_negative(
            &coordinator,
            &storage,
            NegativeCallbackRequest {
                context: runtime_context,
                intent: intent("station_mismatch", ""),
            },
        )
        .expect("typed mismatch");
        let transported = station.join().expect("alternate Station response");

        assert_eq!(result.failure, "oauthStationMismatch");
        assert_eq!(result.projection.phase, OAuthPublicPhase::Failed);
        assert_eq!(
            result.projection.result.as_deref(),
            Some(OAuthAttemptResult::OauthAttemptResultBindingMismatch.as_str_name())
        );
        assert_eq!(
            result.projection.error_code.as_deref(),
            Some("OAUTH_BINDING_MISMATCH")
        );
        assert_eq!(transported.oauth_attempt_id, "oauth-attempt");
        assert_eq!(transported.station_peer_id, "12D3KooWStation");
        assert_eq!(transported.access_attempt_id, "access-attempt");
        assert_eq!(transported.device_id, "device-id");
        assert_eq!(transported.lifecycle_generation, 7);
        assert_eq!(transported.attempt_secret, attempt.attempt_secret);
        assert!(read_active_attempt(&storage).expect("read").is_some());
        assert_eq!(
            storage
                .get_secret(&attempt.storage_key)
                .expect("read preserved attempt")
                .expect("preserved attempt"),
            persisted_before
        );
        let serialized = serde_json::to_string(&result).expect("serialize result");
        assert!(!serialized.contains("oauth-attempt"));
        assert!(!serialized.contains("opaque-state"));
        assert!(!serialized.contains(&URL_SAFE_NO_PAD.encode(&attempt.attempt_secret)));
    }

    #[test]
    fn invalid_build_lease_and_attempt_bindings_fail_before_injection() {
        let storage = prepare_storage();
        let attempt = bound_attempt();
        write_attempt_and_index(&storage, &attempt).expect("attempt");
        let coordinator = OAuthCoordinator::new().expect("coordinator");

        let mut invalid_build = context("alice-ios");
        invalid_build.build.build_id.clear();
        assert!(run_negative(
            &coordinator,
            &storage,
            NegativeCallbackRequest {
                context: invalid_build,
                intent: intent("provider_mismatch", ""),
            },
        )
        .is_err());

        let mut invalid_lease = context("alice-ios");
        invalid_lease.leases[0].expires_at_unix_ms = 1;
        assert!(run_negative(
            &coordinator,
            &storage,
            NegativeCallbackRequest {
                context: invalid_lease,
                intent: intent("provider_mismatch", ""),
            },
        )
        .is_err());

        let no_attempt_storage = prepare_storage();
        assert!(run_negative(
            &coordinator,
            &no_attempt_storage,
            NegativeCallbackRequest {
                context: context("alice-ios"),
                intent: intent("provider_mismatch", ""),
            },
        )
        .is_err());

        let mut wrong_attempt = bound_attempt();
        wrong_attempt.provider = "google".to_string();
        write_attempt(&storage, &wrong_attempt).expect("wrong attempt");
        assert!(run_negative(
            &coordinator,
            &storage,
            NegativeCallbackRequest {
                context: context("alice-ios"),
                intent: intent("provider_mismatch", ""),
            },
        )
        .is_err());
    }

    #[test]
    fn exact_duplicate_remains_production_recovery_not_negative_replay() {
        let mut attempt = bound_attempt();
        let callback =
            "peers-touch://oauth/callback?code=original&state=opaque-state&provider=github";
        let CallbackDisposition::Claim {
            code,
            callback_digest,
        } = validate_callback(&attempt, callback, 1).expect("claim")
        else {
            panic!("callback must claim");
        };
        attempt.callback_code = Some(code);
        attempt.callback_digest = Some(callback_digest);
        attempt.completion_submitted = true;
        attempt.clear_callback_secrets();

        assert_eq!(
            validate_callback(&attempt, callback, u64::MAX).expect("duplicate recovery"),
            CallbackDisposition::ResumeClaimed
        );
    }

    #[test]
    fn cleanup_clears_and_zeroizes_the_replay_vault() {
        let coordinator = OAuthCoordinator::new().expect("coordinator");
        let attempt = bound_attempt();
        coordinator
            .capture_callback_for_replay(
                &attempt,
                "peers-touch://oauth/callback?code=secret&state=opaque-state",
            )
            .expect("capture");

        coordinator
            .clear_callback_replay_vault()
            .expect("clear vault");

        assert!(coordinator.replay_vault().expect("vault").pending.is_none());
    }

    #[test]
    fn missing_replay_handle_rejects_without_changing_the_claimed_attempt() {
        let storage = prepare_storage();
        let mut attempt = bound_attempt();
        attempt.callback_digest = Some(vec![7; 32]);
        attempt.clear_callback_secrets();
        write_attempt_and_index(&storage, &attempt).expect("attempt");
        let coordinator = OAuthCoordinator::new().expect("coordinator");

        assert!(run_negative(
            &coordinator,
            &storage,
            NegativeCallbackRequest {
                context: context("alice-ios"),
                intent: intent("replay", "missing-handle"),
            },
        )
        .is_err());
        assert!(read_active_attempt(&storage).expect("read").is_some());
    }
}
