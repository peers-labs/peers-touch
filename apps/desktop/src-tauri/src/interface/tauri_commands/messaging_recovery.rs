//! Canonical Messaging Platform recovery commands.

use std::sync::Arc;

use reqwest::Method;
use serde::Deserialize;
use serde_json::json;
use tauri::{State, Window};
use ulid::Ulid;
use zeroize::Zeroizing;

use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::domain::crypto;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::session_vault;
use crate::infrastructure::station_client::{self, StationClientErrorKind};
use crate::messaging::{
    decode_recovery_revision, encode_recovery_revision, MessagingEngine,
    INITIAL_ACTOR_IDENTITY_PROFILE_VERSION,
};
use crate::model::recovery::{
    ReadLatestRecoveryRevisionRequest, ReadLatestRecoveryRevisionResponse,
    StoreRecoveryRevisionRequest, StoreRecoveryRevisionResponse,
};
use crate::secure_content::recovery::{
    store_recovery_phrase, INITIAL_SECURE_CONTENT_RECOVERY_EPOCH,
};
use crate::secure_content::store::SecureContentStore;
use crate::state::AppState;
use messaging_core::proto::actor_device_ptid;

use super::crypto::to_stub;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingRecoveryCreateInput {
    recovery_phrase: String,
}

struct RecoverySession {
    account_id: String,
    actor_ptid: String,
    ptid: String,
    token: String,
}

fn require_session(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<RecoverySession, AppResult<StubPayload>> {
    let account_id = session_vault::active_account_id()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppResult::fail(ErrorCode::Unauthorized, "authentication required", None))?;
    let actor_ptid = session_resolver::ptid_for_window(state.inner(), window)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppResult::fail(ErrorCode::Unauthorized, "authentication required", None))?;
    let ptid = session_resolver::ptid_for_window(state.inner(), window).ok_or_else(|| {
        AppResult::fail(
            ErrorCode::Unauthorized,
            "authenticated session has no canonical PTID",
            None,
        )
    })?;
    let token = session_resolver::token_for_window(state.inner(), window)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppResult::fail(ErrorCode::Unauthorized, "authentication required", None))?;
    Ok(RecoverySession {
        account_id,
        actor_ptid,
        ptid,
        token,
    })
}

fn identity_key_ref(actor_ptid: &str) -> String {
    crate::infrastructure::local_scope::LocalScope::from_actor_ptid(actor_ptid).identity_key_ref()
}

fn store_secure_content_recovery_master(
    actor_ptid: &str,
    recovery_epoch: u64,
    recovery_phrase: &str,
) -> Result<(), String> {
    let store = SecureContentStore::open(actor_ptid)?;
    store_recovery_phrase(&store, actor_ptid, recovery_epoch, recovery_phrase)
}

fn next_secure_content_recovery_epoch(actor_ptid: &str) -> Result<u64, String> {
    let store = SecureContentStore::open(actor_ptid)?;
    store
        .latest_recovery_epoch(actor_ptid)?
        .unwrap_or(INITIAL_SECURE_CONTENT_RECOVERY_EPOCH - 1)
        .checked_add(1)
        .filter(|epoch| *epoch <= i64::MAX as u64)
        .ok_or_else(|| "Secure Content recovery epoch is exhausted".to_string())
}

fn timestamp_ms(timestamp: Option<&prost_types::Timestamp>) -> i64 {
    timestamp
        .map(|value| {
            value
                .seconds
                .saturating_mul(1_000)
                .saturating_add(i64::from(value.nanos) / 1_000_000)
        })
        .unwrap_or_default()
}

fn revision_json(revision: &ReadLatestRecoveryRevisionResponse) -> serde_json::Value {
    json!({
        "backupId": revision.revision_id,
        "revision": revision.revision_id,
        "formatVersion": revision.format_version,
        "createdAtUnixMs": timestamp_ms(revision.created_at.as_ref()),
        "blobSizeBytes": revision.encrypted_archive.len(),
    })
}

fn identity_json(engine: &MessagingEngine) -> Result<serde_json::Value, String> {
    let enrollment = engine
        .store()
        .device_enrollment()?
        .ok_or_else(|| "messaging recovery identity is unavailable".to_string())?;
    let certificate = enrollment.certificate;
    let device = certificate
        .device
        .as_ref()
        .ok_or_else(|| "messaging recovery identity has no endpoint".to_string())?;
    let ptid = actor_device_ptid(device)?;
    if ptid != engine.endpoint().ptid
        || device.device_id != engine.endpoint().device_id
        || certificate.actor_identity_key_fingerprint.len() != 32
    {
        return Err("messaging recovery identity binding is invalid".to_string());
    }
    Ok(json!({
        "ready": true,
        "ptid": ptid,
        "deviceId": device.device_id,
        "fingerprint": hex::encode(certificate.actor_identity_key_fingerprint),
    }))
}

fn latest_revision(session: &RecoverySession) -> Result<
    ReadLatestRecoveryRevisionResponse,
    crate::infrastructure::station_client::StationClientError,
> {
    let revision: ReadLatestRecoveryRevisionResponse = station_client::request_proto_for_actor(
        Method::GET,
        "/recovery/latest",
        &session.token,
        None,
        None::<&ReadLatestRecoveryRevisionRequest>,
    )?;
    #[cfg(feature = "acceptance-webdriver")]
    {
        let mut revision = revision;
        if std::env::var_os("PT_MESSAGING_RECOVERY_CORRUPT_LATEST_FILE")
            .map(std::path::PathBuf::from)
            .is_some_and(|path| path.is_file())
        {
            if let Some(first) = revision.encrypted_archive.first_mut() {
                *first ^= 1;
            }
        }
        return Ok(revision);
    }
    #[cfg(not(feature = "acceptance-webdriver"))]
    Ok(revision)
}

#[tauri::command]
pub fn messaging_recovery_generate_phrase(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    if let Err(error) = require_session(&state, &window) {
        return error;
    }
    match crypto::generate_recovery_mnemonic() {
        Ok(phrase) => {
            let words = phrase.split_whitespace().collect::<Vec<_>>();
            to_stub(
                "messaging_recovery_generate_phrase",
                json!({ "words": words, "wordCount": words.len() }),
            )
        }
        Err(error) => AppResult::fail(
            ErrorCode::InternalError,
            format!("failed to generate recovery phrase: {error}"),
            None,
        ),
    }
}

#[tauri::command]
pub fn messaging_recovery_create_revision(
    input: MessagingRecoveryCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let recovery_phrase = Zeroizing::new(input.recovery_phrase);
    let session = match require_session(&state, &window) {
        Ok(session) => session,
        Err(error) => return error,
    };
    if let Err(error) = crypto::validate_mnemonic(&recovery_phrase) {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            format!("invalid recovery phrase: {error}"),
            None,
        );
    }
    let recovery_epoch = match next_secure_content_recovery_epoch(&session.actor_ptid) {
        Ok(epoch) => epoch,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to allocate Secure Content recovery epoch: {error}"),
                None,
            )
        }
    };
    let engine = match state.messaging_engines.get(&session.account_id) {
        Ok(Some(engine)) => engine,
        Ok(None) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "messaging recovery requires an active profile engine",
                None,
            )
        }
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let archive = match engine.build_recovery_archive(INITIAL_ACTOR_IDENTITY_PROFILE_VERSION) {
        Ok(archive) => archive,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let encoded = match encode_recovery_revision(
        &recovery_phrase,
        &Ulid::new().to_string(),
        &engine.endpoint().device_id,
        crate::messaging::now_unix_ms(),
        recovery_epoch,
        &archive,
    ) {
        Ok(encoded) => encoded,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let request = StoreRecoveryRevisionRequest {
        revision_id: encoded.revision_id.clone(),
        format_version: encoded.format_version,
        encrypted_archive: encoded.bytes,
        encrypted_archive_sha256: encoded.sha256.to_vec(),
    };
    let response: StoreRecoveryRevisionResponse = match station_client::request_proto_for_device(
        Method::POST,
        "/recovery/revision",
        &session.token,
        None,
        Some(&request),
        &engine.endpoint().device_id,
    ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("failed to upload recovery revision"),
    };
    if let Err(error) = store_secure_content_recovery_master(
        &session.actor_ptid,
        encoded.recovery_epoch,
        &recovery_phrase,
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("failed to store Secure Content recovery master: {error}"),
            None,
        );
    }
    to_stub(
        "messaging_recovery_create_revision",
        json!({
            "backup": {
                "backupId": response.revision_id,
                "revision": response.revision_id,
                "formatVersion": request.format_version,
                "createdAtUnixMs": timestamp_ms(response.created_at.as_ref()),
                "blobSizeBytes": request.encrypted_archive.len(),
            },
            "recoveryEpoch": encoded.recovery_epoch,
            "messageCount": archive.messages.len(),
            "conversationCount": archive.conversations.len(),
            "attachmentCount": archive.attachments.len(),
            "verifiedFingerprintCount": archive.trust.len(),
        }),
    )
}

#[cfg(feature = "acceptance-webdriver")]
#[tauri::command]
pub fn messaging_recovery_acceptance_create_revision(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let recovery_phrase = match crypto::generate_recovery_mnemonic() {
        Ok(phrase) => phrase,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to generate acceptance recovery phrase: {error}"),
                None,
            )
        }
    };
    messaging_recovery_create_revision(
        MessagingRecoveryCreateInput { recovery_phrase },
        state,
        window,
    )
}

#[tauri::command]
pub fn messaging_recovery_restore_latest(
    recovery_phrase: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let recovery_phrase = Zeroizing::new(recovery_phrase);
    let session = match require_session(&state, &window) {
        Ok(session) => session,
        Err(error) => return error,
    };
    if let Err(error) = crypto::validate_mnemonic(&recovery_phrase) {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            format!("invalid recovery phrase: {error}"),
            None,
        );
    }
    let engine = match state.messaging_engines.get(&session.account_id) {
        Ok(Some(engine)) => engine,
        Ok(None) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "messaging recovery requires an active profile engine",
                None,
            )
        }
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let revision = match latest_revision(&session) {
        Ok(revision) => revision,
        Err(error) => return error.into_app_result("failed to fetch latest recovery revision"),
    };
    let decoded = match decode_recovery_revision(
        &recovery_phrase,
        &session.ptid,
        &revision.revision_id,
        &revision.encrypted_archive,
        &revision.encrypted_archive_sha256,
    ) {
        Ok(decoded) => decoded,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "recovery phrase or archive integrity is invalid",
                None,
            )
        }
    };
    if let Err(error) = store_secure_content_recovery_master(
        &session.actor_ptid,
        decoded.recovery_epoch,
        &recovery_phrase,
    ) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("failed to store Secure Content recovery master: {error}"),
            None,
        );
    }
    let archive = decoded.archive;
    let reconciliation =
        match engine.reconcile_recovery_archive_redactions(&session.token, &archive) {
            Ok(reconciliation) => reconciliation,
            Err(error) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("failed to reconcile recovery redactions: {error}"),
                    None,
                )
            }
        };
    drop(engine);
    if let Err(error) = state.secure_content.teardown_actor(&session.actor_ptid) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("failed to fence Secure Content before identity recovery: {error}"),
            None,
        );
    }

    let key_ref = identity_key_ref(&session.ptid);
    let previous_seed = match crypto::load_identity_key(&key_ref) {
        Ok(identity) => identity.map(|value| Zeroizing::new(value.seed_bytes())),
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to read current actor identity: {error}"),
                None,
            )
        }
    };
    if let Err(error) = crypto::store_identity_key(&key_ref, &archive.actor_identity_seed) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("failed to restore actor identity: {error}"),
            None,
        );
    }
    let enrollment = match state.messaging_engines.restore_profile(
        &session.account_id,
        &archive,
        &reconciliation,
    ) {
        Ok(enrollment) => enrollment,
        Err(error) => {
            let rollback_result = match previous_seed {
                Some(seed) => crypto::store_identity_key(&key_ref, &seed),
                None => crypto::identity::delete_identity_key(&key_ref),
            };
            if let Err(rollback_error) = rollback_result {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("{error}; failed to roll back actor identity: {rollback_error}"),
                    None,
                );
            }
            return AppResult::fail(ErrorCode::InternalError, error, None);
        }
    };
    let restored_device_id = match enrollment.certificate.device.as_ref() {
        Some(device) => device.device_id.clone(),
        None => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "restored messaging identity has no endpoint",
                None,
            );
        }
    };
    station_client::set_device_id(restored_device_id.clone());
    let restored_identity = crypto::IdentityKeyPair::from_seed(&archive.actor_identity_seed);
    to_stub(
        "messaging_recovery_restore_latest",
        json!({
            "backup": revision_json(&revision),
            "recoveryEpoch": decoded.recovery_epoch,
            "deviceId": restored_device_id,
            "fingerprint": crypto::fingerprint_hex(restored_identity.verifying_key()),
            "messageCount": archive.messages.len(),
            "conversationCount": archive.conversations.len(),
            "attachmentCount": archive.attachments.len(),
            "verifiedFingerprintCount": archive.trust.len(),
            "conversations": archive.conversations,
            "attachments": archive.attachments,
            "verifiedFingerprints": archive.trust,
        }),
    )
}

#[tauri::command]
pub fn messaging_recovery_status(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let session = match require_session(&state, &window) {
        Ok(session) => session,
        Err(error) => return error,
    };
    let engine = match state.messaging_engines.get(&session.account_id) {
        Ok(Some(engine)) => engine,
        Ok(None) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "messaging recovery requires an active profile engine",
                None,
            )
        }
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let identity = match identity_json(engine.as_ref()) {
        Ok(identity) => identity,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    match latest_revision(&session) {
        Ok(revision) => to_stub(
            "messaging_recovery_status",
            json!({ "identity": identity, "exists": true, "latest": revision_json(&revision) }),
        ),
        Err(error) if matches!(error.kind, StationClientErrorKind::HttpStatus(404)) => to_stub(
            "messaging_recovery_status",
            json!({ "identity": identity, "exists": false, "latest": serde_json::Value::Null }),
        ),
        Err(error) => error.into_app_result("failed to fetch recovery backup status"),
    }
}

#[tauri::command]
pub fn messaging_recovery_list_revisions(
    limit: Option<u32>,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let _ = limit;
    let session = match require_session(&state, &window) {
        Ok(session) => session,
        Err(error) => return error,
    };
    let engine = match state.messaging_engines.get(&session.account_id) {
        Ok(Some(engine)) => engine,
        Ok(None) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                "messaging recovery requires an active profile engine",
                None,
            )
        }
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    match latest_revision(&session) {
        Ok(revision) => to_stub(
            "messaging_recovery_list_revisions",
            json!({ "backups": [revision_json(&revision)] }),
        ),
        Err(error) if matches!(error.kind, StationClientErrorKind::HttpStatus(404)) => to_stub(
            "messaging_recovery_list_revisions",
            json!({ "backups": [] }),
        ),
        Err(error) => error.into_app_result("failed to list recovery backup revisions"),
    }
}
