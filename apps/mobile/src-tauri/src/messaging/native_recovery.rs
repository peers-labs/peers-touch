//! Native recovery application service. The renderer receives counters only.
use base64::{engine::general_purpose::STANDARD, Engine};
use bip39::{Language, Mnemonic};
use prost::Message;
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};
use zeroize::Zeroizing;

use super::lifecycle::MobileMessagingRuntime;
use super::recovery::{MobileRecoveryKdf, RecoveryTransport};
use crate::error::{MobileError, MobileResult};
use crate::platform::secure_input::{
    confirm_actor_backup_phrase, request_actor_identity_recovery_phrase,
};
use crate::platform::secure_storage::SecureStorage;
use crate::runtime::oauth::session::{authenticated_native_session, AuthenticatedNativeSession};
use crate::runtime::reliability_proto::peers_touch::model::mobile::v1::{
    MobileRecoveryAction, MobileRecoveryRecord, MobileRecoveryRequest, MobileRecoveryResult,
};
use crate::social::MobilePrivateSocialRuntime;
use messaging_core::proto::recovery::{
    ReadLatestRecoveryRevisionResponse, StoreRecoveryRevisionRequest,
};

fn error(detail: impl Into<String>) -> MobileError {
    MobileError::coded("MOBILE_RECOVERY_FAILED", detail)
}

fn record_key(request: &MobileRecoveryRequest) -> String {
    let hash = Sha256::digest(format!(
        "{}\u{1f}{}",
        request.station_peer_id, request.actor_ptid
    ));
    format!(
        "mobile.security.recovery.{}",
        hash.iter().map(|b| format!("{b:02x}")).collect::<String>()
    )
}

fn session(
    storage: &SecureStorage,
    request: &MobileRecoveryRequest,
) -> MobileResult<AuthenticatedNativeSession> {
    let session = authenticated_native_session(
        storage,
        &request.station_peer_id,
        &request.actor_ptid,
        &request.session_id,
    )?;
    if request.lifecycle_generation == 0
        || session.lifecycle_generation() != request.lifecycle_generation
    {
        return Err(error("mobile recovery session changed"));
    }
    Ok(session)
}

fn projection(revision: &ReadLatestRecoveryRevisionResponse) -> MobileRecoveryResult {
    MobileRecoveryResult {
        exists: true,
        revision_id: revision.revision_id.clone(),
        format_version: revision.format_version,
        created_at_unix_ms: revision
            .created_at
            .as_ref()
            .map(|t| t.seconds.saturating_mul(1_000) + i64::from(t.nanos) / 1_000_000)
            .unwrap_or_default(),
        archive_bytes: revision.encrypted_archive.len() as u64,
        ..Default::default()
    }
}

fn save_record(
    storage: &SecureStorage,
    request: &MobileRecoveryRequest,
    phrase: &str,
    epoch: u64,
) -> MobileResult<()> {
    let mut record = MobileRecoveryRecord {
        phrase: phrase.into(),
        recovery_epoch: epoch,
    };
    let bytes = Zeroizing::new(record.encode_to_vec());
    let result = storage.set(&record_key(request), &STANDARD.encode(bytes.as_slice()));
    use zeroize::Zeroize;
    record.phrase.zeroize();
    result
}

pub(crate) async fn execute<R: Runtime>(
    app: AppHandle<R>,
    request: MobileRecoveryRequest,
) -> MobileResult<MobileRecoveryResult> {
    let storage = app.state::<SecureStorage>();
    let scope = session(&storage, &request)?;
    let action = MobileRecoveryAction::try_from(request.action)
        .map_err(|_| error("invalid recovery action"))?;
    if action == MobileRecoveryAction::Status {
        return tauri::async_runtime::spawn_blocking(move || {
            let transport = RecoveryTransport::new(
                scope.station_origin(),
                scope.access_token(),
                scope.device_id(),
            )
            .map_err(error)?;
            transport
                .latest()
                .map(|revision| revision.as_ref().map(projection).unwrap_or_default())
                .map_err(error)
        })
        .await
        .map_err(|_| error("recovery status task failed"))?;
    }
    let phrase;
    let epoch;
    match action {
        MobileRecoveryAction::Create => {
            let stored = storage
                .get(&record_key(&request))?
                .map(|value| {
                    let bytes = Zeroizing::new(
                        STANDARD
                            .decode(value)
                            .map_err(|_| error("recovery record invalid"))?,
                    );
                    MobileRecoveryRecord::decode(bytes.as_slice())
                        .map_err(|_| error("recovery record invalid"))
                })
                .transpose()?;
            if let Some(mut record) = stored {
                phrase = Zeroizing::new(std::mem::take(&mut record.phrase));
                epoch = record.recovery_epoch;
            } else {
                let mut entropy = Zeroizing::new([0; 32]);
                OsRng.fill_bytes(entropy.as_mut());
                phrase = Zeroizing::new(
                    Mnemonic::from_entropy_in(Language::English, entropy.as_ref())
                        .map_err(|_| error("recovery phrase generation failed"))?
                        .to_string(),
                );
                epoch = 1;
            }
            confirm_actor_backup_phrase(&app, request.lifecycle_generation, phrase.as_str())
                .await?;
        }
        MobileRecoveryAction::Restore => {
            phrase =
                request_actor_identity_recovery_phrase(&app, request.lifecycle_generation).await?;
            epoch = 0;
        }
        _ => return Err(error("invalid recovery action")),
    }
    // Native input may outlive logout, lock or a Station change.
    let scope = session(&storage, &request)?;
    let runtime = app.state::<MobileMessagingRuntime>();
    let engine = runtime.active_engine(&request.station_peer_id, &request.actor_ptid)?;
    let data_root = app
        .path()
        .app_data_dir()
        .map_err(|_| error("recovery data directory unavailable"))?;
    if action == MobileRecoveryAction::Create {
        let archive = engine.build_recovery_archive().map_err(error)?;
        drop(engine);
        let phrase_for_task = Zeroizing::new(phrase.as_str().to_string());
        let device_id = scope.device_id().to_string();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let transport = RecoveryTransport::new(
                scope.station_origin(),
                scope.access_token(),
                scope.device_id(),
            )
            .map_err(error)?;
            let encoded = messaging_core::recovery::encode_recovery_revision(
                &MobileRecoveryKdf,
                phrase_for_task.as_str(),
                &ulid::Ulid::new().to_string(),
                &device_id,
                crate::messaging::engine::now_unix_ms(),
                epoch,
                &archive,
            )
            .map_err(error)?;
            let request = StoreRecoveryRevisionRequest {
                revision_id: encoded.revision_id,
                format_version: encoded.format_version,
                encrypted_archive: encoded.bytes,
                encrypted_archive_sha256: encoded.sha256.to_vec(),
            };
            let stored = transport.store(&request).map_err(error)?;
            Ok::<_, MobileError>(MobileRecoveryResult {
                exists: true,
                revision_id: stored.revision_id,
                format_version: request.format_version,
                created_at_unix_ms: stored
                    .created_at
                    .map(|t| t.seconds * 1_000 + i64::from(t.nanos) / 1_000_000)
                    .unwrap_or_default(),
                archive_bytes: request.encrypted_archive.len() as u64,
                conversation_count: archive.conversations.len() as u64,
                message_count: archive.messages.len() as u64,
                attachment_count: archive.attachments.len() as u64,
            })
        })
        .await
        .map_err(|_| error("recovery create task failed"))??;
        session(&storage, &request)?;
        save_record(&storage, &request, phrase.as_str(), epoch)?;
        app.state::<MobilePrivateSocialRuntime>()
            .store_recovery_master(
                &data_root,
                &storage,
                &request.station_peer_id,
                &request.actor_ptid,
                phrase.as_str(),
                epoch,
            )?;
        return Ok(result);
    }
    drop(engine);
    let actor = request.actor_ptid.clone();
    let decode_phrase = Zeroizing::new(phrase.as_str().to_string());
    let (revision, decoded, reconciliation) = tauri::async_runtime::spawn_blocking(move || {
        let transport = RecoveryTransport::new(
            scope.station_origin(),
            scope.access_token(),
            scope.device_id(),
        )
        .map_err(error)?;
        let revision = transport
            .latest()
            .map_err(error)?
            .ok_or_else(|| error("recovery backup missing"))?;
        let decoded = messaging_core::recovery::decode_recovery_revision(
            &MobileRecoveryKdf,
            decode_phrase.as_str(),
            &actor,
            &revision.revision_id,
            &revision.encrypted_archive,
            &revision.encrypted_archive_sha256,
        )
        .map_err(error)?;
        let reconciliation = transport.reconcile(&decoded.archive).map_err(error)?;
        Ok::<_, MobileError>((revision, decoded, reconciliation))
    })
    .await
    .map_err(|_| error("recovery restore task failed"))??;
    drop(runtime);
    let restore_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let storage = restore_app.state::<SecureStorage>();
        let scope = session(&storage, &request)?;
        restore_app
            .state::<MobileMessagingRuntime>()
            .recover_archive(
                restore_app.clone(),
                &data_root,
                &storage,
                scope.station_peer_id().into(),
                scope.station_origin().into(),
                scope.actor_ptid().into(),
                scope.device_id().into(),
                &decoded.archive,
                &reconciliation,
                scope.access_token().into(),
            )?;
        save_record(&storage, &request, phrase.as_str(), decoded.recovery_epoch)?;
        restore_app
            .state::<MobilePrivateSocialRuntime>()
            .store_recovery_master(
                &data_root,
                &storage,
                &request.station_peer_id,
                &request.actor_ptid,
                phrase.as_str(),
                decoded.recovery_epoch,
            )?;
        Ok(MobileRecoveryResult {
            conversation_count: decoded.archive.conversations.len() as u64,
            message_count: decoded.archive.messages.len() as u64,
            attachment_count: decoded.archive.attachments.len() as u64,
            ..projection(&revision)
        })
    })
    .await
    .map_err(|_| error("recovery lifecycle task failed"))?
}

#[tauri::command]
pub async fn mobile_recovery_execute<R: Runtime>(
    app: AppHandle<R>,
    request_bytes: Vec<u8>,
) -> MobileResult<Vec<u8>> {
    if request_bytes.len() > 4096 {
        return Err(error("recovery request too large"));
    }
    let request = MobileRecoveryRequest::decode(request_bytes.as_slice())
        .map_err(|_| error("recovery request invalid"))?;
    let result = execute(app, request).await.map_err(|failure| {
        log::warn!(
            "native recovery operation failed [{}]: {}",
            failure.code,
            failure.message
        );
        failure
    })?;
    Ok(result.encode_to_vec())
}
