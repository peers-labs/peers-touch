mod crypto;
mod private_comment;
mod private_media;
mod private_mention;
mod private_moment;
mod private_reaction;
mod projection;

use std::path::Path;
use std::sync::Arc;
#[cfg(feature = "acceptance-webdriver")]
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::{json, Value};
#[cfg(feature = "acceptance-webdriver")]
use sha2::{Digest, Sha256};
use tauri::{State, Window};

#[cfg(feature = "acceptance-webdriver")]
use crate::application::station_binding::{self, StationBindingPhase, StationBindingState};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::station_client;
use crate::model::actor::ActorProfile;
use crate::secure_content::adapter::jwt_session_id;
use crate::secure_content::station_trust::resolve_station_signing_key;
use crate::secure_content::worker::maintain_content_prekeys;
use crate::secure_content::{SecureContentLease, SecureContentSession, SecureContentSessionKey};
use crate::state::AppState;

use self::private_comment::{
    PrivateCommentFailure, PrivateCommentIntent, PrivateCommentListInput,
    PrivateCommentOrchestrator, PrivateCommentSubmitInput,
};
use self::private_media::{PrivateMediaOpenError, PrivateMediaOpenFailureKind};
use self::private_moment::{
    pending_device_recovery_projection, PrivateMomentOrchestrator, PrivateMomentPublishIntent,
    PrivateRecoveryFailureKind,
};
use self::private_reaction::{
    PrivateReactionMutationInput, PrivateReactionOrchestrator, PrivateReactionRetryInput,
};
use self::projection::PrivateReactionOperation;

#[cfg(feature = "acceptance-webdriver")]
static ACCEPTANCE_RUNTIME_BOOT_ID: OnceLock<String> = OnceLock::new();
#[cfg(feature = "acceptance-webdriver")]
static ACCEPTANCE_EXECUTABLE_SHA256: OnceLock<Result<String, String>> = OnceLock::new();

#[cfg(feature = "acceptance-webdriver")]
fn acceptance_station_binding_digests(
    station_peer_id: &str,
    station_url: &str,
    binding: &StationBindingState,
    confirmed_binding: &StationBindingState,
    registry_active_url: Option<&str>,
) -> Result<(String, String), String> {
    if binding != confirmed_binding {
        return Err("secure content Station binding changed during identity capture".to_string());
    }
    if binding.phase != StationBindingPhase::Bound {
        return Err("secure content Station binding is not complete".to_string());
    }
    if station_peer_id.is_empty() || station_peer_id != station_peer_id.trim() {
        return Err("secure content active Station peer ID is invalid".to_string());
    }
    if station_url.is_empty() || station_url != station_url.trim() {
        return Err("secure content active Station URL is invalid".to_string());
    }
    let normalized_url = station_url.trim_end_matches('/');
    if normalized_url.is_empty() {
        return Err("secure content active Station URL is invalid".to_string());
    }
    let normalized_bound_url = binding
        .bound_url
        .as_deref()
        .map(str::trim)
        .map(|url| url.trim_end_matches('/'))
        .filter(|url| !url.is_empty())
        .ok_or_else(|| "secure content bound Station URL is unavailable".to_string())?;
    let normalized_registry_url = registry_active_url
        .map(str::trim)
        .map(|url| url.trim_end_matches('/'))
        .filter(|url| !url.is_empty())
        .ok_or_else(|| "secure content registry Station URL is unavailable".to_string())?;
    if normalized_bound_url != normalized_url || normalized_registry_url != normalized_url {
        return Err("secure content Station binding identity is inconsistent".to_string());
    }
    Ok((
        hex::encode(Sha256::digest(station_peer_id.as_bytes())),
        hex::encode(Sha256::digest(normalized_url.as_bytes())),
    ))
}

#[derive(Debug, Deserialize)]
pub struct PrivateMomentsBootstrapInput {
    pub actor_ptid: String,
    pub renderer_generation: u64,
}

#[derive(Debug, Deserialize)]
pub struct PrivateMomentsReconcileInput {
    pub actor_ptid: String,
    pub renderer_generation: u64,
    #[serde(default)]
    pub post_ids: Vec<String>,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct PrivateMomentReadInput {
    pub actor_ptid: String,
    pub renderer_generation: u64,
    pub post_id: String,
}

#[derive(Debug, Deserialize)]
pub struct PrivateMomentMediaOpenInput {
    pub actor_ptid: String,
    pub renderer_generation: u64,
    pub post_id: String,
    pub object_id: String,
}

#[derive(Debug, Deserialize)]
pub struct PrivateMomentsTeardownInput {
    pub actor_ptid: String,
    pub renderer_generation: u64,
}

#[tauri::command]
pub fn social_private_react(
    input: PrivateReactionMutationInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    private_reaction_mutation(
        input,
        PrivateReactionOperation::React,
        state.inner(),
        &window,
    )
}

#[tauri::command]
pub fn social_private_unreact(
    input: PrivateReactionMutationInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    private_reaction_mutation(
        input,
        PrivateReactionOperation::Unreact,
        state.inner(),
        &window,
    )
}

#[tauri::command]
pub fn social_private_reaction_retry(
    input: PrivateReactionRetryInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let lease = match lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "REACTION_REJECTED"),
    };
    match PrivateReactionOrchestrator::new(&state.secure_content, lease)
        .and_then(|service| service.retry(&input))
    {
        Ok(result) => AppResult::success(json!(result)),
        Err(error) => native_failure(error, "REACTION_REJECTED"),
    }
}

fn private_reaction_mutation(
    input: PrivateReactionMutationInput,
    operation: PrivateReactionOperation,
    state: &AppState,
    window: &Window,
) -> AppResult<Value> {
    let lease = match lease_for_window(
        state,
        window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "REACTION_REJECTED"),
    };
    match PrivateReactionOrchestrator::new(&state.secure_content, lease)
        .and_then(|service| service.mutate(&input, operation))
    {
        Ok(result) => AppResult::success(json!(result)),
        Err(error) => native_failure(error, "REACTION_REJECTED"),
    }
}

#[tauri::command]
pub fn social_private_comments_bootstrap(
    input: PrivateMomentsBootstrapInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let lease = match lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "COMMENT_FAILED"),
    };
    match PrivateCommentOrchestrator::new(&state.secure_content, lease)
        .and_then(|service| service.snapshot())
    {
        Ok(snapshot) => AppResult::success(json!(snapshot)),
        Err(error) => native_failure(error, "COMMENT_FAILED"),
    }
}

#[tauri::command]
pub fn social_private_comment_stage(
    input: PrivateCommentIntent,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let lease = match lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "COMMENT_FAILED"),
    };
    match PrivateCommentOrchestrator::new(&state.secure_content, lease) {
        Ok(service) => match service.stage(&input) {
            Ok(draft) => AppResult::success(json!(draft)),
            Err(error) => private_comment_failure(error),
        },
        Err(error) => native_failure(error, "COMMENT_FAILED"),
    }
}

#[tauri::command]
pub fn social_private_comment_prepare(
    input: PrivateCommentIntent,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let lease = match lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "COMMENT_FAILED"),
    };
    match PrivateCommentOrchestrator::new(&state.secure_content, lease) {
        Ok(service) => match service.prepare(&input) {
            Ok(draft) => AppResult::success(json!(draft)),
            Err(error) => private_comment_failure(error),
        },
        Err(error) => native_failure(error, "COMMENT_FAILED"),
    }
}

#[tauri::command]
pub fn social_private_comment_submit(
    input: PrivateCommentSubmitInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let lease = match lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "COMMENT_FAILED"),
    };
    match PrivateCommentOrchestrator::new(&state.secure_content, lease) {
        Ok(service) => match service.submit(&input) {
            Ok(result) => AppResult::success(json!(result)),
            Err(error) => private_comment_failure(error),
        },
        Err(error) => native_failure(error, "COMMENT_FAILED"),
    }
}

#[tauri::command]
pub fn social_private_comments_list(
    input: PrivateCommentListInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let lease = match lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "COMMENT_FAILED"),
    };
    match PrivateCommentOrchestrator::new(&state.secure_content, lease) {
        Ok(service) => match service.list(&input) {
            Ok(page) => AppResult::success(json!(page)),
            Err(error) => private_comment_failure(error),
        },
        Err(error) => native_failure(error, "COMMENT_FAILED"),
    }
}

#[cfg(feature = "acceptance-webdriver")]
#[derive(Debug, Deserialize)]
pub struct PrivateMomentsAcceptanceRuntimeIdentityInput {
    pub actor_ptid: String,
    pub renderer_generation: u64,
}

#[tauri::command]
pub fn social_private_moments_bootstrap(
    input: PrivateMomentsBootstrapInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let lease = match activate(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "INTEGRITY_FAILURE"),
    };
    if let Err(error) = maintain_content_prekeys(&state.secure_content, &lease) {
        tracing::warn!(error = %error, "secure content PreKey maintenance is pending");
    }
    let authority_key = lease.session.key.clone();
    let revoke_media = |path: &Path| {
        state
            .secure_content
            .revoke_private_media_path(&authority_key, path)
    };
    match PrivateMomentOrchestrator::new(&state.secure_content, lease)
        .and_then(|service| service.reconcile(&[], &revoke_media))
    {
        Ok(snapshot) => AppResult::success(json!(snapshot)),
        Err(error) => native_failure(error, "INTEGRITY_FAILURE"),
    }
}

#[tauri::command]
pub fn social_private_moments_reconcile(
    input: PrivateMomentsReconcileInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let _reason = input.reason;
    let lease = match lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "INTEGRITY_FAILURE"),
    };
    let authority_key = lease.session.key.clone();
    let revoke_media = |path: &Path| {
        state
            .secure_content
            .revoke_private_media_path(&authority_key, path)
    };
    match PrivateMomentOrchestrator::new(&state.secure_content, lease)
        .and_then(|service| service.reconcile(&input.post_ids, &revoke_media))
    {
        Ok(snapshot) => AppResult::success(json!(snapshot)),
        Err(error) => native_failure(error, "INTEGRITY_FAILURE"),
    }
}

#[tauri::command]
pub fn social_private_moment_publish(
    input: PrivateMomentPublishIntent,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let lease = match lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "PUBLISH_FAILED"),
    };
    if let Err(error) = maintain_content_prekeys(&state.secure_content, &lease) {
        return native_failure(error, "RECIPIENT_KEY_UNAVAILABLE");
    }
    match PrivateMomentOrchestrator::new(&state.secure_content, lease)
        .and_then(|service| service.publish(&input))
    {
        Ok(result) => AppResult::success(json!(result)),
        Err(error) => {
            let failure_state = if error.contains("RECIPIENT_KEY_UNAVAILABLE") {
                "RECIPIENT_KEY_UNAVAILABLE"
            } else if error.contains("PRIVATE_UNSUPPORTED") {
                "PRIVATE_UNSUPPORTED"
            } else {
                "PUBLISH_FAILED"
            };
            native_failure(error, failure_state)
        }
    }
}

#[tauri::command]
pub fn social_private_moment_read(
    input: PrivateMomentReadInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let lease = match lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "AUTHENTICATION_REQUIRED"),
    };
    let recovery_pending = match state.messaging_engines.get(&lease.session.account_id) {
        Ok(Some(engine)) => match engine.store().pending_device_enrollment() {
            Ok(pending) => pending.is_some(),
            Err(error) => return native_failure(error, "INTEGRITY_FAILURE"),
        },
        Ok(None) => {
            return native_failure(
                "secure content requires an active messaging engine".to_string(),
                "AUTHENTICATION_REQUIRED",
            )
        }
        Err(error) => return native_failure(error, "INTEGRITY_FAILURE"),
    };
    if recovery_pending {
        return AppResult::success(json!(pending_device_recovery_projection(&input.post_id)));
    }
    let authority_key = lease.session.key.clone();
    let revoke_media = |path: &Path| {
        state
            .secure_content
            .revoke_private_media_path(&authority_key, path)
    };
    match PrivateMomentOrchestrator::new(&state.secure_content, lease)
        .and_then(|service| service.read(&input.post_id, &revoke_media))
    {
        Ok(projection) => AppResult::success(json!(projection)),
        Err(error) => native_failure(error, "NOT_FOUND_OR_NOT_AUTHORIZED"),
    }
}

#[tauri::command]
pub fn social_private_moment_media_open(
    input: PrivateMomentMediaOpenInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let lease = match lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "AUTHENTICATION_REQUIRED"),
    };
    let authority_key = lease.session.key.clone();
    let revoke_media = |path: &Path| {
        state
            .secure_content
            .revoke_private_media_path(&authority_key, path)
    };
    let result = match PrivateMomentOrchestrator::new(&state.secure_content, lease) {
        Ok(service) => service.open_media(&input.post_id, &input.object_id, &revoke_media),
        Err(error) => Err(PrivateMediaOpenError::dependency(error, None)),
    };
    match result {
        Ok(mut projection) => {
            if let Err(error) = grant_private_media_preview(
                &state.secure_content,
                &authority_key,
                &mut projection,
                &input.object_id,
            ) {
                return native_failure(error, "MEDIA_INTEGRITY_FAILURE");
            }
            AppResult::success(json!(projection))
        }
        Err(error) => private_media_failure(error),
    }
}

fn grant_private_media_preview(
    supervisor: &crate::secure_content::SecureContentSupervisor,
    authority_key: &crate::secure_content::SecureContentSessionKey,
    projection: &mut self::projection::PrivateMomentProjection,
    object_id: &str,
) -> Result<(), String> {
    let media = match projection.content.as_mut() {
        Some(self::projection::PrivateMomentContentProjection::Image { media, .. })
        | Some(self::projection::PrivateMomentContentProjection::Video { media, .. }) => {
            media.iter_mut().find(|item| item.object_id == object_id)
        }
        _ => None,
    }
    .ok_or_else(|| "private Moment media projection is unavailable".to_string())?;
    if media.state != self::projection::PrivateMediaState::MediaReady {
        return Ok(());
    }
    let local_path = media
        .local_path
        .as_deref()
        .ok_or_else(|| "private Moment media cache path is unavailable".to_string())?;
    let media_type = media
        .mime_type
        .as_deref()
        .ok_or_else(|| "private Moment media type is unavailable".to_string())?;
    media.render_url =
        Some(supervisor.grant_private_media(authority_key, Path::new(local_path), media_type)?);
    media.local_path = None;
    Ok(())
}

#[tauri::command]
pub fn social_private_moment_recover(
    input: PrivateMomentReadInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let lease = match recovery_lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "AUTHENTICATION_REQUIRED"),
    };
    let authority_key = lease.session.key.clone();
    let revoke_media = |path: &Path| {
        state
            .secure_content
            .revoke_private_media_path(&authority_key, path)
    };
    match PrivateMomentOrchestrator::new(&state.secure_content, lease) {
        Ok(service) => match service.recover(&input.post_id, &revoke_media) {
            Ok(projection) => AppResult::success(json!(projection)),
            Err(error) => match error.kind {
                PrivateRecoveryFailureKind::KeyUnavailable => {
                    native_failure(error.message, "RECOVERY_KEY_UNAVAILABLE")
                }
                PrivateRecoveryFailureKind::NotAuthorized => {
                    native_failure(error.message, "NOT_FOUND_OR_NOT_AUTHORIZED")
                }
                PrivateRecoveryFailureKind::AuthenticationRequired => {
                    native_failure(error.message, "AUTHENTICATION_REQUIRED")
                }
                PrivateRecoveryFailureKind::Retryable => {
                    native_failure(error.message, "RECOVERY_KEY_UNAVAILABLE")
                }
                PrivateRecoveryFailureKind::IntegrityFailure => {
                    native_failure(error.message, "INTEGRITY_FAILURE")
                }
            },
        },
        Err(error) => native_failure(error, "INTEGRITY_FAILURE"),
    }
}

#[tauri::command]
pub fn social_private_moment_purge(
    input: PrivateMomentReadInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let lease = match lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "AUTHENTICATION_REQUIRED"),
    };
    let authority_key = lease.session.key.clone();
    let revoke_media = |path: &Path| {
        state
            .secure_content
            .revoke_private_media_path(&authority_key, path)
    };
    match PrivateMomentOrchestrator::new(&state.secure_content, lease)
        .and_then(|service| service.purge(&input.post_id, &revoke_media))
    {
        Ok(()) => AppResult::success(json!({ "ok": true })),
        Err(error) => native_failure(error, "INTEGRITY_FAILURE"),
    }
}

#[tauri::command]
pub fn social_private_moments_teardown(
    input: PrivateMomentsTeardownInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    if let Err(error) = lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        return native_failure(error, "AUTHENTICATION_REQUIRED");
    }
    if let Err(error) = state.secure_content.teardown_actor(&input.actor_ptid) {
        return native_failure(error, "PRIVATE_UNSUPPORTED_ON_DEVICE");
    }
    AppResult::success(json!({ "ok": true }))
}

#[cfg(feature = "acceptance-webdriver")]
#[tauri::command]
pub fn social_private_moments_acceptance_runtime_identity(
    input: PrivateMomentsAcceptanceRuntimeIdentityInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let lease = match lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "AUTHENTICATION_REQUIRED"),
    };
    let boot_id = ACCEPTANCE_RUNTIME_BOOT_ID.get_or_init(|| ulid::Ulid::new().to_string());
    let boot_identity_sha256 = hex::encode(Sha256::digest(
        format!("{}:{boot_id}", std::process::id()).as_bytes(),
    ));
    let account_storage_identity_sha256 = hex::encode(Sha256::digest(
        crate::infrastructure::local_scope::user_scope_for_actor_ptid(&input.actor_ptid).as_bytes(),
    ));
    let executable_sha256 = match ACCEPTANCE_EXECUTABLE_SHA256.get_or_init(|| {
        let executable = std::env::current_exe()
            .map_err(|error| format!("resolve Desktop executable: {error}"))?;
        let bytes = std::fs::read(executable)
            .map_err(|error| format!("read Desktop executable: {error}"))?;
        Ok::<_, String>(hex::encode(Sha256::digest(bytes)))
    }) {
        Ok(digest) => digest,
        Err(error) => return native_failure(error.clone(), "INTEGRITY_FAILURE"),
    };
    let binding = station_binding::service().state();
    let station_peer_id = match station_client::active_station_peer_id() {
        Some(value) => value,
        None => {
            return native_failure(
                "secure content active Station peer ID is unavailable".to_string(),
                "INTEGRITY_FAILURE",
            )
        }
    };
    let station_url = station_client::station_base_url();
    let registry_active_url = station_client::station_registry().active_url();
    let confirmed_binding = station_binding::service().state();
    let (station_runtime_identity_sha256, station_endpoint_sha256) =
        match acceptance_station_binding_digests(
            &station_peer_id,
            &station_url,
            &binding,
            &confirmed_binding,
            registry_active_url.as_deref(),
        ) {
            Ok(value) => value,
            Err(error) => return native_failure(error, "INTEGRITY_FAILURE"),
        };
    AppResult::success(json!({
        "bootIdentitySha256": boot_identity_sha256,
        "sessionGeneration": lease.session.key.session_generation,
        "accountStorageIdentitySha256": account_storage_identity_sha256,
        "sourceCommit": env!("PT_BUILD_SOURCE_COMMIT"),
        "executableSha256": executable_sha256,
        "stationRuntimeIdentitySha256": station_runtime_identity_sha256,
        "stationEndpointSha256": station_endpoint_sha256,
    }))
}

#[cfg(feature = "acceptance-webdriver")]
#[tauri::command]
pub fn social_private_moments_acceptance_maintain_prekeys(
    input: PrivateMomentsAcceptanceRuntimeIdentityInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<Value> {
    let lease = match lease_for_window(
        state.inner(),
        &window,
        &input.actor_ptid,
        input.renderer_generation,
    ) {
        Ok(lease) => lease,
        Err(error) => return native_failure(error, "AUTHENTICATION_REQUIRED"),
    };
    let recovery_epoch = match lease.store.latest_recovery_epoch(&input.actor_ptid) {
        Ok(Some(epoch)) => epoch,
        Ok(None) => {
            return native_failure(
                "secure content recovery epoch is unavailable".to_string(),
                "RECOVERY_KEY_UNAVAILABLE",
            )
        }
        Err(error) => return native_failure(error, "INTEGRITY_FAILURE"),
    };
    match maintain_content_prekeys(&state.secure_content, &lease) {
        Ok(summary) if summary.recovery_available.unwrap_or_default() > 0 => {
            AppResult::success(json!({
                "recoveryEpoch": recovery_epoch,
                "recoveryPreKeyAvailable": summary.recovery_available,
            }))
        }
        Ok(_) => native_failure(
            "secure content recovery PreKey pool is empty".to_string(),
            "RECOVERY_KEY_UNAVAILABLE",
        ),
        Err(error) => native_failure(error, "RECOVERY_KEY_UNAVAILABLE"),
    }
}

fn activate(
    state: &AppState,
    window: &Window,
    actor_ptid: &str,
    renderer_generation: u64,
) -> Result<SecureContentLease, String> {
    let lifecycle_epoch = state.secure_content.lifecycle_epoch();
    let active = state
        .sessions
        .get(window.label())
        .ok_or_else(|| "secure content requires an authenticated window".to_string())?;
    if active.actor.ptid != actor_ptid || active.jwt.trim().is_empty() {
        return Err("secure content actor does not match the authenticated window".to_string());
    }
    let engine = state
        .messaging_engines
        .get(&active.account_id)?
        .ok_or_else(|| "secure content requires an active device identity".to_string())?;
    if engine.endpoint().ptid != actor_ptid {
        return Err("secure content device identity does not match the actor".to_string());
    }
    let enrollment = engine
        .store()
        .device_enrollment()?
        .ok_or_else(|| "secure content device enrollment is unavailable".to_string())?;
    let profile_version = enrollment.certificate.observed_profile_version;
    let (signing_key_id, signing_key) = engine
        .device_signing_identity()?
        .ok_or_else(|| "secure content device signing key is unavailable".to_string())?;
    let station_peer_id = station_client::active_station_peer_id()
        .ok_or_else(|| "secure content active Station peer ID is unavailable".to_string())?;
    let station_url = station_client::station_base_url();
    let actor_profile = station_client::request_peers_proto_no_body_for_device_at::<ActorProfile>(
        &station_url,
        reqwest::Method::GET,
        "/actor/profile",
        &active.jwt,
        None,
        &engine.endpoint().device_id,
    )
    .map_err(|error| format!("load Secure Content Station identity: {error}"))?;
    if actor_profile.home_station_peer_id != station_peer_id
        || actor_profile
            .r#ref
            .as_ref()
            .map(|actor| actor.ptid.as_str())
            != Some(actor_ptid)
        || actor_profile.federated_handle.trim().is_empty()
    {
        return Err("secure content Actor Profile identity is inconsistent".to_string());
    }
    let trusted_station_signing_key = resolve_station_signing_key(
        station_client::station_registry(),
        &station_url,
        &station_peer_id,
        &actor_profile.federated_handle,
        &active.jwt,
        &engine.endpoint().device_id,
    )?;
    let session = SecureContentSession::new(
        SecureContentSessionKey {
            station_peer_id,
            actor_ptid: actor_ptid.to_string(),
            device_id: engine.endpoint().device_id.clone(),
            jwt_session_id: jwt_session_id(&active.jwt)?,
            window_label: window.label().to_string(),
            session_generation: 0,
        },
        active.account_id,
        station_url,
        active.jwt,
        signing_key_id,
        profile_version,
        signing_key,
        trusted_station_signing_key,
    );
    let _transition = state
        .identity_transition
        .lock()
        .map_err(|_| "identity transition lock poisoned".to_string())?;
    let current = state
        .sessions
        .get(window.label())
        .ok_or_else(|| "secure content session changed during activation".to_string())?;
    if current.account_id != session.account_id
        || current.actor.ptid != session.key.actor_ptid
        || !session.matches_token(&current.jwt)?
        || station_client::active_station_peer_id().as_deref()
            != Some(session.key.station_peer_id.as_str())
        || station_client::station_base_url().trim_end_matches('/')
            != session.station_url.trim_end_matches('/')
    {
        return Err("secure content authority changed during activation".to_string());
    }
    let current_engine = state
        .messaging_engines
        .get(&session.account_id)?
        .ok_or_else(|| "secure content device identity changed during activation".to_string())?;
    if current_engine.endpoint().ptid != session.key.actor_ptid
        || current_engine.endpoint().device_id != session.key.device_id
    {
        return Err("secure content device identity changed during activation".to_string());
    }
    state
        .secure_content
        .activate_if_epoch(session, renderer_generation, lifecycle_epoch)
}

fn lease_for_window(
    state: &AppState,
    window: &Window,
    actor_ptid: &str,
    renderer_generation: u64,
) -> Result<SecureContentLease, String> {
    let active = state
        .sessions
        .get(window.label())
        .ok_or_else(|| "secure content requires an authenticated window".to_string())?;
    if active.actor.ptid != actor_ptid || active.jwt.trim().is_empty() {
        return Err("secure content actor does not match the authenticated window".to_string());
    }
    let lease = state
        .secure_content
        .lease(actor_ptid, renderer_generation, window.label())?;
    if lease.session.account_id != active.account_id
        || lease.session.key.jwt_session_id != jwt_session_id(&active.jwt)?
    {
        return Err(
            "secure content session no longer matches the authenticated window".to_string(),
        );
    }
    Ok(lease)
}

fn recovery_lease_for_window(
    state: &AppState,
    window: &Window,
    actor_ptid: &str,
    renderer_generation: u64,
) -> Result<SecureContentLease, String> {
    let lease = match lease_for_window(state, window, actor_ptid, renderer_generation) {
        Ok(lease) => lease,
        Err(_) => return activate(state, window, actor_ptid, renderer_generation),
    };
    let engine = state
        .messaging_engines
        .get(&lease.session.account_id)?
        .ok_or_else(|| "secure content recovery requires an active messaging engine".to_string())?;
    if engine.endpoint().ptid != actor_ptid {
        return Err("secure content recovery device identity does not match the actor".to_string());
    }
    if engine.endpoint().device_id == lease.session.key.device_id {
        return Ok(lease);
    }
    activate(state, window, actor_ptid, renderer_generation)
}

fn native_failure(message: String, state: &str) -> AppResult<Value> {
    let lower = message.to_ascii_lowercase();
    let (code, app_code) = if state == "RECIPIENT_KEY_UNAVAILABLE" {
        ("RECIPIENT_KEY_UNAVAILABLE", ErrorCode::InvalidArgument)
    } else if state == "PRIVATE_UNSUPPORTED" {
        ("PRIVATE_UNSUPPORTED", ErrorCode::InvalidArgument)
    } else if lower.contains("auth") || lower.contains("session") {
        ("UNAUTHORIZED", ErrorCode::Unauthorized)
    } else if lower.contains("not authorized") || lower.contains("not found") {
        ("NOT_FOUND_OR_NOT_AUTHORIZED", ErrorCode::NotFound)
    } else if lower.contains("conflict") || lower.contains("stale") {
        ("CONFLICT", ErrorCode::Conflict)
    } else {
        ("PRIVATE_NATIVE_COMMAND_FAILED", ErrorCode::InternalError)
    };
    AppResult::fail(
        app_code,
        message,
        Some(json!({
            "state": state,
            "native_error_code": code,
        })),
    )
}

fn private_media_failure(error: PrivateMediaOpenError) -> AppResult<Value> {
    let state = error.state();
    let retryable = error.retryable();
    let app_code = match error.kind {
        PrivateMediaOpenFailureKind::AccessDenied => ErrorCode::NotFound,
        PrivateMediaOpenFailureKind::Integrity => ErrorCode::Conflict,
        PrivateMediaOpenFailureKind::Dependency | PrivateMediaOpenFailureKind::Cancelled => {
            ErrorCode::InternalError
        }
    };
    AppResult::fail(
        app_code,
        error.message,
        Some(json!({
            "state": state,
            "native_error_code": error.code,
            "retryable": retryable,
            "retry_after_seconds": error.retry_after_seconds,
        })),
    )
}

fn private_comment_failure(error: PrivateCommentFailure) -> AppResult<Value> {
    let app_code = match error.state {
        crate::secure_content::store::CommentState::ParentUnavailable => ErrorCode::NotFound,
        crate::secure_content::store::CommentState::RateLimited => ErrorCode::InvalidArgument,
        _ => ErrorCode::InternalError,
    };
    AppResult::fail(
        app_code,
        error.message,
        Some(json!({
            "state": error.state.as_str(),
            "native_error_code": error.code,
            "retry_after_seconds": error.retry_after_seconds,
            "retry_not_before_unix_ms": error.retry_not_before_unix_ms,
        })),
    )
}

#[cfg(all(test, feature = "acceptance-webdriver"))]
mod tests {
    use super::acceptance_station_binding_digests;
    use crate::application::station_binding::{StationBindingPhase, StationBindingState};

    fn binding(phase: StationBindingPhase, generation: u64) -> StationBindingState {
        StationBindingState {
            phase,
            selected_url: Some("https://station.invalid".to_string()),
            bound_url: Some("https://station.invalid".to_string()),
            target_url: None,
            generation,
            error: None,
        }
    }

    #[test]
    fn acceptance_station_binding_uses_peer_id_and_canonical_endpoint() {
        let binding = binding(StationBindingPhase::Bound, 1);
        let without_slash = acceptance_station_binding_digests(
            "station-peer-four",
            "https://station.invalid",
            &binding,
            &binding,
            Some("https://station.invalid"),
        )
        .expect("station binding should hash");
        let with_slash = acceptance_station_binding_digests(
            "station-peer-four",
            "https://station.invalid/",
            &binding,
            &binding,
            Some("https://station.invalid/"),
        )
        .expect("station binding should normalize");

        assert_eq!(without_slash, with_slash);
        assert_ne!(without_slash.0, without_slash.1);
    }

    #[test]
    fn acceptance_station_binding_rejects_missing_identity() {
        let binding = binding(StationBindingPhase::Bound, 1);
        assert!(acceptance_station_binding_digests(
            "",
            "https://station.invalid",
            &binding,
            &binding,
            Some("https://station.invalid"),
        )
        .is_err());
        assert!(acceptance_station_binding_digests(
            "station-peer-four",
            "",
            &binding,
            &binding,
            Some("https://station.invalid"),
        )
        .is_err());
    }

    #[test]
    fn acceptance_station_binding_rejects_every_non_bound_phase() {
        for phase in [
            StationBindingPhase::Unbound,
            StationBindingPhase::Connecting,
            StationBindingPhase::AccessGate,
            StationBindingPhase::Switching,
            StationBindingPhase::Failed,
        ] {
            let binding = binding(phase, 1);
            assert!(acceptance_station_binding_digests(
                "station-peer-four",
                "https://station.invalid",
                &binding,
                &binding,
                Some("https://station.invalid"),
            )
            .is_err());
        }
    }

    #[test]
    fn acceptance_station_binding_rejects_divergent_urls() {
        let mut divergent_bound = binding(StationBindingPhase::Bound, 1);
        divergent_bound.bound_url = Some("https://other-station.invalid".to_string());
        assert!(acceptance_station_binding_digests(
            "station-peer-four",
            "https://station.invalid",
            &divergent_bound,
            &divergent_bound,
            Some("https://station.invalid"),
        )
        .is_err());
        let binding = binding(StationBindingPhase::Bound, 1);
        assert!(acceptance_station_binding_digests(
            "station-peer-four",
            "https://station.invalid",
            &binding,
            &binding,
            Some("https://other-station.invalid"),
        )
        .is_err());
    }

    #[test]
    fn acceptance_station_binding_rejects_generation_change_during_capture() {
        let before = binding(StationBindingPhase::Bound, 1);
        let after = binding(StationBindingPhase::Bound, 2);
        assert!(acceptance_station_binding_digests(
            "station-peer-four",
            "https://station.invalid",
            &before,
            &after,
            Some("https://station.invalid"),
        )
        .is_err());
    }
}
