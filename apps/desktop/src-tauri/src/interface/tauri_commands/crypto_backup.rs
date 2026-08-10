//! Canonical Messaging Platform recovery commands.

use std::sync::Arc;

use reqwest::Method;
use serde::Deserialize;
use serde_json::json;
use tauri::{State, Window};
use ulid::Ulid;

use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::domain::crypto;
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::session_vault;
use crate::infrastructure::station_client::{self, StationClientErrorKind};
use crate::messaging::{
    decode_recovery_revision, encode_recovery_revision, INITIAL_ACTOR_IDENTITY_PROFILE_VERSION,
};
use crate::model::chat::{
    GetLatestRecoveryRevisionRequest, GetLatestRecoveryRevisionResponse,
    PutRecoveryRevisionRequest, PutRecoveryRevisionResponse,
};
use crate::state::AppState;

use super::crypto::to_stub;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CryptoBackupCreateInput {
    recovery_phrase: String,
}

struct RecoverySession {
    account_id: String,
    actor_id: String,
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
    let actor_id = session_resolver::actor_id_for_window(state.inner(), window)
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
        actor_id,
        ptid,
        token,
    })
}

fn identity_key_ref(actor_id: &str) -> String {
    crate::infrastructure::local_scope::LocalScope::from_actor(actor_id).identity_key_ref()
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

fn revision_json(revision: &GetLatestRecoveryRevisionResponse) -> serde_json::Value {
    json!({
        "backupId": revision.revision_id,
        "revision": revision.revision_id,
        "formatVersion": revision.format_version,
        "createdAtUnixMs": timestamp_ms(revision.created_at.as_ref()),
        "blobSizeBytes": revision.encrypted_archive.len(),
    })
}

fn latest_revision(
    session: &RecoverySession,
    device_id: &str,
) -> Result<
    GetLatestRecoveryRevisionResponse,
    crate::infrastructure::station_client::StationClientError,
> {
    station_client::request_proto_for_device(
        Method::GET,
        "/messaging/recovery/revision",
        &session.token,
        None,
        None::<&GetLatestRecoveryRevisionRequest>,
        device_id,
    )
}

#[tauri::command]
pub fn crypto_generate_recovery_secret(
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
                "crypto_generate_recovery_secret",
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
pub fn crypto_backup_create(
    input: CryptoBackupCreateInput,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let session = match require_session(&state, &window) {
        Ok(session) => session,
        Err(error) => return error,
    };
    if let Err(error) = crypto::validate_mnemonic(&input.recovery_phrase) {
        return AppResult::fail(
            ErrorCode::InvalidArgument,
            format!("invalid recovery phrase: {error}"),
            None,
        );
    }
    let identity = match crypto::load_identity_key(&identity_key_ref(&session.actor_id)) {
        Ok(Some(identity)) => identity,
        Ok(None) => return AppResult::fail(ErrorCode::NotFound, "crypto identity not found", None),
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to load actor identity: {error}"),
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
    let archive = match engine.build_recovery_archive(
        identity.seed_bytes(),
        INITIAL_ACTOR_IDENTITY_PROFILE_VERSION,
    ) {
        Ok(archive) => archive,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let encoded = match encode_recovery_revision(
        &input.recovery_phrase,
        &Ulid::new().to_string(),
        &engine.endpoint().device_id,
        crate::messaging::now_unix_ms(),
        &archive,
    ) {
        Ok(encoded) => encoded,
        Err(error) => return AppResult::fail(ErrorCode::InternalError, error, None),
    };
    let request = PutRecoveryRevisionRequest {
        revision_id: encoded.revision_id.clone(),
        format_version: encoded.format_version,
        encrypted_archive: encoded.bytes,
        encrypted_archive_sha256: encoded.sha256.to_vec(),
    };
    let response: PutRecoveryRevisionResponse = match station_client::request_proto_for_device(
        Method::POST,
        "/messaging/recovery/revision",
        &session.token,
        None,
        Some(&request),
        &engine.endpoint().device_id,
    ) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("failed to upload recovery revision"),
    };
    to_stub(
        "crypto_backup_create",
        json!({
            "backup": {
                "backupId": response.revision_id,
                "revision": response.revision_id,
                "formatVersion": request.format_version,
                "createdAtUnixMs": timestamp_ms(response.created_at.as_ref()),
                "blobSizeBytes": request.encrypted_archive.len(),
            },
            "messageCount": archive.messages.len(),
            "conversationCount": archive.conversations.len(),
            "attachmentCount": archive.attachments.len(),
            "verifiedFingerprintCount": archive.trust.len(),
        }),
    )
}

#[tauri::command]
pub fn crypto_backup_restore_latest(
    recovery_phrase: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
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
    let device_id = engine.endpoint().device_id.clone();
    drop(engine);
    let revision = match latest_revision(&session, &device_id) {
        Ok(revision) => revision,
        Err(error) => return error.into_app_result("failed to fetch latest recovery revision"),
    };
    let archive = match decode_recovery_revision(
        &recovery_phrase,
        &session.ptid,
        &revision.revision_id,
        &revision.encrypted_archive,
        &revision.encrypted_archive_sha256,
    ) {
        Ok(archive) => archive,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "recovery phrase or archive integrity is invalid",
                None,
            )
        }
    };

    let key_ref = identity_key_ref(&session.actor_id);
    let previous_seed = match crypto::load_identity_key(&key_ref) {
        Ok(identity) => identity.map(|value| value.seed_bytes()),
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
    let enrollment = match state
        .messaging_engines
        .restore_profile(&session.account_id, &archive)
    {
        Ok(enrollment) => enrollment,
        Err(error) => {
            if let Some(seed) = previous_seed {
                let _ = crypto::store_identity_key(&key_ref, &seed);
            }
            return AppResult::fail(ErrorCode::InternalError, error, None);
        }
    };
    let restored_device_id = enrollment.certificate.device_id.clone();
    if let Err(error) = state.messaging_engines.activate_profile(
        session.account_id.clone(),
        archive.ptid.clone(),
        archive.actor_identity_seed,
        archive.actor_profile_version,
    ) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    if let Err(error) = state.messaging_engines.activate_profile_worker(
        &session.account_id,
        session.token.clone(),
        archive.actor_identity_seed,
    ) {
        return AppResult::fail(ErrorCode::InternalError, error, None);
    }
    station_client::set_device_id(restored_device_id.clone());
    let restored_identity = crypto::IdentityKeyPair::from_seed(&archive.actor_identity_seed);
    to_stub(
        "crypto_backup_restore_latest",
        json!({
            "backup": revision_json(&revision),
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
pub fn crypto_backup_status(
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
    match latest_revision(&session, &engine.endpoint().device_id) {
        Ok(revision) => to_stub(
            "crypto_backup_status",
            json!({ "exists": true, "latest": revision_json(&revision) }),
        ),
        Err(error) if matches!(error.kind, StationClientErrorKind::HttpStatus(404)) => to_stub(
            "crypto_backup_status",
            json!({ "exists": false, "latest": serde_json::Value::Null }),
        ),
        Err(error) => error.into_app_result("failed to fetch recovery backup status"),
    }
}

#[tauri::command]
pub fn crypto_backup_list_revisions(
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
    match latest_revision(&session, &engine.endpoint().device_id) {
        Ok(revision) => to_stub(
            "crypto_backup_list_revisions",
            json!({ "backups": [revision_json(&revision)] }),
        ),
        Err(error) if matches!(error.kind, StationClientErrorKind::HttpStatus(404)) => {
            to_stub("crypto_backup_list_revisions", json!({ "backups": [] }))
        }
        Err(error) => error.into_app_result("failed to list recovery backup revisions"),
    }
}
