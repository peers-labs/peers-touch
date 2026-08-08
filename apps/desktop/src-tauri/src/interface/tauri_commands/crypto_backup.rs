//! Station-backed recovery backup commands.

use std::sync::Arc;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{State, Window};

use crate::application::key_exchange::device_install;
use crate::application::session_resolver;
use crate::contracts::StubPayload;
use crate::domain::crypto::{
    self, AttachmentDecryptionMetadata, BackupKdfParameters, EncryptedBackup, RecoveryConversation,
    VerifiedFingerprint,
};
use crate::error::{AppResult, ErrorCode};
use crate::infrastructure::local_chat_store::{self, RecoveryMetadata};
use crate::infrastructure::station_client::{self, StationClientErrorKind};
use crate::model::chat;
use crate::state::AppState;

use super::crypto::to_stub;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupConversationInput {
    scope: String,
    conversation_id: String,
    metadata: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupAttachmentInput {
    message_id: String,
    attachment_id: String,
    metadata: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedFingerprintInput {
    peer_ptid: String,
    fingerprint: String,
    verified_at_unix_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CryptoBackupCreateInput {
    recovery_phrase: String,
    #[serde(default)]
    conversations: Vec<BackupConversationInput>,
    #[serde(default)]
    attachments: Vec<BackupAttachmentInput>,
    #[serde(default)]
    verified_fingerprints: Vec<VerifiedFingerprintInput>,
}

fn require_session(
    state: &State<'_, Arc<AppState>>,
    window: &Window,
) -> Result<(String, String), AppResult<StubPayload>> {
    let ptid = session_resolver::actor_id_for_window(state.inner(), window)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppResult::fail(ErrorCode::Unauthorized, "authentication required", None))?;
    let token = session_resolver::token_for_window(state.inner(), window)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppResult::fail(ErrorCode::Unauthorized, "authentication required", None))?;
    Ok((ptid, token))
}

fn identity_key_ref(ptid: &str) -> String {
    crate::infrastructure::local_scope::LocalScope::from_actor(ptid).identity_key_ref()
}

fn user_scope(ptid: &str) -> String {
    crate::infrastructure::local_scope::user_scope_for_actor(Some(ptid))
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

fn revision_json(revision: &chat::CryptoBackupRevision) -> Value {
    json!({
        "backupId": revision.backup_id,
        "revision": revision.revision,
        "createdAtUnixMs": timestamp_ms(revision.created_at.as_ref()),
        "blobSizeBytes": revision.encrypted_blob.len(),
    })
}

fn encrypted_from_revision(
    revision: &chat::CryptoBackupRevision,
) -> Result<EncryptedBackup, AppResult<StubPayload>> {
    let kdf = revision.kdf.as_ref().ok_or_else(|| {
        AppResult::fail(
            ErrorCode::InternalError,
            "backup revision has no KDF parameters",
            None,
        )
    })?;
    let nonce: [u8; crypto::backup::BACKUP_NONCE_BYTES] =
        revision.nonce.clone().try_into().map_err(|_| {
            AppResult::fail(ErrorCode::InternalError, "backup nonce is invalid", None)
        })?;
    let integrity_tag: [u8; crypto::backup::BACKUP_TAG_BYTES] =
        revision.integrity_tag.clone().try_into().map_err(|_| {
            AppResult::fail(
                ErrorCode::InternalError,
                "backup integrity tag is invalid",
                None,
            )
        })?;
    Ok(EncryptedBackup {
        encrypted_blob: revision.encrypted_blob.clone(),
        nonce,
        integrity_tag,
        kdf: BackupKdfParameters {
            salt: kdf.salt.clone(),
            memory_cost_kib: kdf.memory_cost_kib,
            time_cost: kdf.time_cost,
            parallelism: kdf.parallelism,
            output_length: kdf.output_length,
        },
    })
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
    let (ptid, token) = match require_session(&state, &window) {
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
    let identity = match crypto::load_identity_key(&identity_key_ref(&ptid)) {
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

    let metadata = RecoveryMetadata {
        conversations: input
            .conversations
            .into_iter()
            .map(|value| RecoveryConversation {
                scope: value.scope,
                conversation_id: value.conversation_id,
                metadata: value.metadata,
            })
            .collect(),
        attachments: input
            .attachments
            .into_iter()
            .map(|value| AttachmentDecryptionMetadata {
                message_id: value.message_id,
                attachment_id: value.attachment_id,
                metadata: value.metadata,
            })
            .collect(),
        verified_fingerprints: input
            .verified_fingerprints
            .into_iter()
            .map(|value| VerifiedFingerprint {
                peer_ptid: value.peer_ptid,
                fingerprint: value.fingerprint,
                verified_at_unix_ms: value.verified_at_unix_ms,
            })
            .collect(),
    };
    let scope = user_scope(&ptid);
    if let Err(error) = local_chat_store::replace_recovery_metadata(&scope, &metadata) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("failed to persist recovery metadata: {error}"),
            None,
        );
    }
    let snapshot =
        match local_chat_store::build_recovery_snapshot(&scope, &ptid, identity.seed_bytes()) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                return AppResult::fail(
                    ErrorCode::InternalError,
                    format!("failed to build recovery snapshot: {error}"),
                    None,
                )
            }
        };
    let encrypted = match crypto::encrypt_snapshot(&input.recovery_phrase, &snapshot) {
        Ok(encrypted) => encrypted,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to encrypt recovery snapshot: {error}"),
                None,
            )
        }
    };
    let request = chat::PutCryptoBackupRequest {
        encrypted_blob: encrypted.encrypted_blob,
        nonce: encrypted.nonce.to_vec(),
        integrity_tag: encrypted.integrity_tag.to_vec(),
        kdf: Some(chat::BackupKdfParameters {
            salt: encrypted.kdf.salt,
            memory_cost_kib: encrypted.kdf.memory_cost_kib,
            time_cost: encrypted.kdf.time_cost,
            parallelism: encrypted.kdf.parallelism,
            output_length: encrypted.kdf.output_length,
        }),
    };
    match station_client::put_crypto_backup(&token, &request) {
        Ok(response) => match response.backup {
            Some(revision) => to_stub(
                "crypto_backup_create",
                json!({
                    "backup": revision_json(&revision),
                    "messageCount": snapshot.messages.len(),
                    "conversationCount": snapshot.conversations.len(),
                    "attachmentCount": snapshot.attachments.len(),
                    "verifiedFingerprintCount": snapshot.verified_fingerprints.len(),
                }),
            ),
            None => AppResult::fail(
                ErrorCode::InternalError,
                "Station returned no backup revision",
                None,
            ),
        },
        Err(error) => error.into_app_result("failed to upload recovery backup"),
    }
}

#[tauri::command]
pub fn crypto_backup_restore_latest(
    recovery_phrase: String,
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (ptid, token) = match require_session(&state, &window) {
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
    let response = match station_client::get_latest_crypto_backup(&token) {
        Ok(response) => response,
        Err(error) => return error.into_app_result("failed to fetch latest recovery backup"),
    };
    let revision = match response.backup {
        Some(revision) if revision.ptid == ptid => revision,
        Some(_) => {
            return AppResult::fail(
                ErrorCode::Forbidden,
                "backup revision belongs to another actor",
                None,
            )
        }
        None => return AppResult::fail(ErrorCode::NotFound, "backup not found", None),
    };
    let encrypted = match encrypted_from_revision(&revision) {
        Ok(encrypted) => encrypted,
        Err(error) => return error,
    };
    let snapshot = match crypto::decrypt_snapshot(&recovery_phrase, &ptid, &encrypted) {
        Ok(snapshot) => snapshot,
        Err(_) => {
            return AppResult::fail(
                ErrorCode::InvalidArgument,
                "recovery phrase or backup integrity is invalid",
                None,
            )
        }
    };

    let key_ref = identity_key_ref(&ptid);
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
    if let Err(error) = crypto::store_identity_key(&key_ref, &snapshot.actor_identity_seed) {
        return AppResult::fail(
            ErrorCode::InternalError,
            format!("failed to restore actor identity: {error}"),
            None,
        );
    }
    let counts = match local_chat_store::restore_recovery_snapshot(&user_scope(&ptid), &snapshot) {
        Ok(counts) => counts,
        Err(error) => {
            if let Some(previous_seed) = previous_seed {
                let _ = crypto::store_identity_key(&key_ref, &previous_seed);
            }
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("failed to restore SQLCipher history: {error}"),
                None,
            );
        }
    };
    let device_id = match device_install::rotate_device_id(&ptid) {
        Ok(device_id) => device_id,
        Err(error) => {
            return AppResult::fail(
                ErrorCode::InternalError,
                format!("history restored but fresh device enrollment failed: {error}"),
                None,
            )
        }
    };
    station_client::set_device_id(device_id.clone());
    let restored_identity = crypto::IdentityKeyPair::from_seed(&snapshot.actor_identity_seed);
    to_stub(
        "crypto_backup_restore_latest",
        json!({
            "backup": revision_json(&revision),
            "deviceId": device_id,
            "fingerprint": crypto::fingerprint_hex(restored_identity.verifying_key()),
            "messageCount": counts.messages,
            "conversationCount": counts.conversations,
            "attachmentCount": counts.attachments,
            "verifiedFingerprintCount": counts.verified_fingerprints,
            "conversations": snapshot.conversations,
            "attachments": snapshot.attachments,
            "verifiedFingerprints": snapshot.verified_fingerprints,
        }),
    )
}

#[tauri::command]
pub fn crypto_backup_status(
    state: State<'_, Arc<AppState>>,
    window: Window,
) -> AppResult<StubPayload> {
    let (_, token) = match require_session(&state, &window) {
        Ok(session) => session,
        Err(error) => return error,
    };
    match station_client::get_latest_crypto_backup(&token) {
        Ok(response) => to_stub(
            "crypto_backup_status",
            json!({
                "exists": response.backup.is_some(),
                "latest": response.backup.as_ref().map(revision_json),
            }),
        ),
        Err(error) if matches!(error.kind, StationClientErrorKind::HttpStatus(404)) => to_stub(
            "crypto_backup_status",
            json!({ "exists": false, "latest": Value::Null }),
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
    let (_, token) = match require_session(&state, &window) {
        Ok(session) => session,
        Err(error) => return error,
    };
    match station_client::list_crypto_backup_revisions(&token, limit.unwrap_or(5).clamp(1, 5)) {
        Ok(response) => to_stub(
            "crypto_backup_list_revisions",
            json!({
                "backups": response.backups.iter().map(revision_json).collect::<Vec<_>>(),
            }),
        ),
        Err(error) => error.into_app_result("failed to list recovery backup revisions"),
    }
}
