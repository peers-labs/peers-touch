use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use prost::Message;
use secure_content_core::object::{
    ObjectCryptoMaterial, ObjectTransferDirection, ObjectTransferRecord, ObjectTransferState,
    ObjectTransferWorker, OBJECT_CHUNK_SIZE,
};
use secure_content_core::ports::ObjectBlob;
use secure_content_core::prekey::{
    ContentPreKeyActorRef, ContentPreKeyEndpoint, ContentPreKeyKind as CorePreKeyKind,
    ContentPreKeyPair, ContentPreKeyPrincipal, ContentPreKeySigningInput,
    CONTENT_PREKEY_SIGNING_FORMAT_VERSION,
};
use secure_content_core::recovery::{derive_recovery_prekey, RecoveryMaster};
use sha2::{Digest, Sha256};
use ulid::Ulid;

use crate::model::{actor, secure_content as wire};

use super::adapter::{
    publication_command_id, NativeErrorDisposition, SecureContentTransport, SocialObjectCodec,
    StationObjectTransferTransport,
};
use super::store::{PublicationState, StoredPublication};
use super::{SecureContentLease, SecureContentSupervisor};

const CONTENT_PREKEY_BATCH_LIMIT: u32 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MaintenanceSummary {
    pub endpoint_available: u32,
    pub recovery_available: Option<u32>,
}

pub fn maintain_content_prekeys(
    supervisor: &SecureContentSupervisor,
    lease: &SecureContentLease,
) -> Result<MaintenanceSummary, String> {
    let transport = SecureContentTransport::new(lease.session.clone())?;
    reconcile_publications(supervisor, lease, &transport)?;
    let endpoint = maintain_pool(
        supervisor,
        lease,
        &transport,
        wire::ContentPreKeyKind::ContentPrekeyKindEndpoint,
    )?;
    let recovery = if lease
        .store
        .latest_recovery_epoch(&lease.session.key.actor_ptid)?
        .is_some()
    {
        Some(maintain_pool(
            supervisor,
            lease,
            &transport,
            wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery,
        )?)
    } else {
        None
    };
    Ok(MaintenanceSummary {
        endpoint_available: endpoint,
        recovery_available: recovery,
    })
}

fn reconcile_publications(
    supervisor: &SecureContentSupervisor,
    lease: &SecureContentLease,
    transport: &SecureContentTransport,
) -> Result<(), String> {
    for command in lease.store.publications_requiring_reconciliation()? {
        publish_command(supervisor, lease, transport, &command.command_id)?;
    }
    Ok(())
}

fn maintain_pool(
    supervisor: &SecureContentSupervisor,
    lease: &SecureContentLease,
    transport: &SecureContentTransport,
    kind: wire::ContentPreKeyKind,
) -> Result<u32, String> {
    let inventory = match transport.inventory(kind) {
        Ok(inventory) => Some(inventory),
        Err(error) if error.disposition == NativeErrorDisposition::PoolNotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    let expected_epoch = inventory
        .as_ref()
        .map(|value| value.current_epoch)
        .unwrap_or(0);
    let latest_recovery_epoch = if kind == wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery {
        lease
            .store
            .latest_recovery_epoch(&lease.session.key.actor_ptid)?
    } else {
        None
    };
    let rotation_pending = latest_recovery_epoch.is_some_and(|epoch| epoch > expected_epoch);
    if let Some(inventory) = inventory.as_ref() {
        if !inventory.needs_replenishment && !rotation_pending {
            return Ok(inventory.available);
        }
    }
    let pool_epoch = match kind {
        wire::ContentPreKeyKind::ContentPrekeyKindEndpoint => lease.session.profile_version,
        wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery => {
            let latest = latest_recovery_epoch
                .ok_or_else(|| "secure content recovery master is unavailable".to_string())?;
            if expected_epoch == 0 {
                1
            } else if latest > expected_epoch {
                expected_epoch
                    .checked_add(1)
                    .ok_or_else(|| "secure content recovery epoch is exhausted".to_string())?
            } else {
                expected_epoch
            }
        }
        wire::ContentPreKeyKind::ContentPrekeyKindUnspecified => {
            return Err("secure content PreKey kind is required".to_string())
        }
    };
    let capacity = inventory
        .as_ref()
        .map(|value| value.capacity)
        .filter(|value| *value > 0)
        .unwrap_or(CONTENT_PREKEY_BATCH_LIMIT);
    let available = inventory.as_ref().map(|value| value.available).unwrap_or(0);
    let count = if pool_epoch != expected_epoch {
        capacity
    } else {
        capacity.saturating_sub(available)
    }
    .clamp(1, CONTENT_PREKEY_BATCH_LIMIT);
    let command_id = create_publication(lease, kind, pool_epoch, expected_epoch, count)?;
    publish_command(supervisor, lease, transport, &command_id)?;
    let fresh = transport
        .inventory(kind)
        .map_err(|error| error.to_string())?;
    Ok(fresh.available)
}

fn create_publication(
    lease: &SecureContentLease,
    kind: wire::ContentPreKeyKind,
    pool_epoch: u64,
    expected_pool_epoch: u64,
    count: u32,
) -> Result<String, String> {
    let publisher = prekey_publisher(&lease.session.key.actor_ptid, &lease.session.key.device_id);
    let recovery_master = if kind == wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery {
        let bytes = lease
            .store
            .recovery_master(&lease.session.key.actor_ptid, pool_epoch)?
            .ok_or_else(|| "secure content recovery master is unavailable for epoch".to_string())?;
        Some(RecoveryMaster::from_bytes(bytes))
    } else {
        None
    };
    let mut generated = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let prefix = match kind {
            wire::ContentPreKeyKind::ContentPrekeyKindEndpoint => "content-endpoint",
            wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery => "content-recovery",
            wire::ContentPreKeyKind::ContentPrekeyKindUnspecified => {
                return Err("secure content PreKey kind is required".to_string())
            }
        };
        let key_id = format!("{prefix}-{}", Ulid::new());
        let pair = match recovery_master.as_ref() {
            Some(master) => {
                derive_recovery_prekey(master, &lease.session.key.actor_ptid, pool_epoch, &key_id)?
            }
            None => ContentPreKeyPair::generate(),
        };
        generated.push((key_id, pair));
    }
    generated.sort_by(|left, right| left.0.cmp(&right.0));

    let mut prekeys = Vec::with_capacity(generated.len());
    let mut private_material = Vec::with_capacity(generated.len());
    for (key_id, pair) in generated {
        let principal = match kind {
            wire::ContentPreKeyKind::ContentPrekeyKindEndpoint => {
                ContentPreKeyPrincipal::Endpoint(ContentPreKeyEndpoint::new(
                    &lease.session.key.actor_ptid,
                    &lease.session.key.device_id,
                ))
            }
            wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery => {
                ContentPreKeyPrincipal::RecoveryActor(ContentPreKeyActorRef::new(
                    &lease.session.key.actor_ptid,
                ))
            }
            wire::ContentPreKeyKind::ContentPrekeyKindUnspecified => unreachable!(),
        };
        let signing_input = ContentPreKeySigningInput {
            format_version: CONTENT_PREKEY_SIGNING_FORMAT_VERSION,
            kind: match kind {
                wire::ContentPreKeyKind::ContentPrekeyKindEndpoint => CorePreKeyKind::Endpoint,
                wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery => {
                    CorePreKeyKind::ActorRecovery
                }
                wire::ContentPreKeyKind::ContentPrekeyKindUnspecified => unreachable!(),
            },
            key_id: key_id.clone(),
            x25519_public_key: pair.public(),
            principal,
            pool_epoch,
            expected_pool_epoch,
            publisher: ContentPreKeyEndpoint::new(
                &lease.session.key.actor_ptid,
                &lease.session.key.device_id,
            ),
            publisher_signing_key_id: lease.session.signing_key_id.clone(),
            publisher_profile_version: lease.session.profile_version,
        };
        let signature = lease.session.sign(
            &signing_input
                .signing_bytes()
                .map_err(|error| error.to_string())?,
        )?;
        let principal = match kind {
            wire::ContentPreKeyKind::ContentPrekeyKindEndpoint => {
                wire::content_one_time_pre_key::Principal::Endpoint(publisher.clone())
            }
            wire::ContentPreKeyKind::ContentPrekeyKindActorRecovery => {
                wire::content_one_time_pre_key::Principal::RecoveryActor(
                    publisher.actor.clone().unwrap_or_default(),
                )
            }
            wire::ContentPreKeyKind::ContentPrekeyKindUnspecified => unreachable!(),
        };
        prekeys.push(wire::ContentOneTimePreKey {
            kind: kind as i32,
            key_id: key_id.clone(),
            x25519_public_key: pair.public().as_bytes().to_vec(),
            principal: Some(principal),
            profile_or_recovery_epoch: pool_epoch,
            issuer_signature: signature,
        });
        private_material.push((
            key_id,
            (kind == wire::ContentPreKeyKind::ContentPrekeyKindEndpoint)
                .then(|| pair.private().to_bytes()),
            pair.public().to_owned().as_bytes().to_owned(),
        ));
    }
    let mut request = wire::PublishContentPreKeysRequest {
        publisher: Some(publisher),
        publisher_signing_key_id: lease.session.signing_key_id.clone(),
        publisher_profile_version: lease.session.profile_version,
        expected_pool_epoch,
        prekeys,
        command_id: String::new(),
        proof: None,
    };
    request.command_id = publication_command_id(&request);
    let request_bytes = request.encode_to_vec();
    let request_sha256 = Sha256::digest(&request_bytes).into();
    let command = StoredPublication {
        command_id: request.command_id.clone(),
        key_kind: kind as i32,
        pool_epoch,
        request_bytes,
        request_sha256,
        state: PublicationState::PendingPublication,
        lease_generation: 0,
        session_generation: 0,
    };
    lease.store.persist_prekey_publication(
        &command,
        &private_material
            .into_iter()
            .map(|(key_id, private_key, public_key)| (key_id, private_key, public_key))
            .collect::<Vec<_>>(),
    )?;
    Ok(command.command_id)
}

fn publish_command(
    supervisor: &SecureContentSupervisor,
    lease: &SecureContentLease,
    transport: &SecureContentTransport,
    command_id: &str,
) -> Result<(), String> {
    let acquired = lease
        .store
        .acquire_publication(command_id, lease.session.key.session_generation)?;
    let command = acquired.command;
    match transport.publish_proof_free(&command.request_bytes) {
        Ok(_) => {
            if !supervisor.is_current(&lease.session.key) {
                lease.store.mark_publication_unknown(
                    command_id,
                    command.lease_generation,
                    command.session_generation,
                )?;
                return Err(
                    "secure content publication response crossed a session fence".to_string(),
                );
            }
            if !lease.store.mark_publication_published(
                command_id,
                command.lease_generation,
                command.session_generation,
            )? {
                return Err(
                    "secure content publication completion lost its generation fence".to_string(),
                );
            }
            Ok(())
        }
        Err(error)
            if matches!(
                error.disposition,
                NativeErrorDisposition::Retryable | NativeErrorDisposition::UnknownCommit
            ) || preserves_unknown_commit_after_auth_rejection(
                acquired.reconciles_unknown_commit,
                &error,
            ) =>
        {
            lease.store.mark_publication_unknown(
                command_id,
                command.lease_generation,
                command.session_generation,
            )?;
            Err(error.to_string())
        }
        Err(error) => {
            lease.store.mark_publication_terminal(
                command_id,
                command.lease_generation,
                command.session_generation,
            )?;
            Err(error.to_string())
        }
    }
}

fn preserves_unknown_commit_after_auth_rejection(
    reconciles_unknown_commit: bool,
    error: &super::adapter::NativeTransportError,
) -> bool {
    reconciles_unknown_commit
        && error.disposition == NativeErrorDisposition::Terminal
        && matches!(error.http_status, Some(401 | 403))
}

fn prekey_publisher(actor_ptid: &str, device_id: &str) -> actor::ActorDeviceRef {
    actor::ActorDeviceRef {
        actor: Some(actor::ActorRef {
            ptid: actor_ptid.to_string(),
            ..Default::default()
        }),
        device_id: device_id.to_string(),
    }
}

pub fn new_object_worker(lease: &SecureContentLease) -> Result<ObjectTransferWorker, String> {
    Ok(ObjectTransferWorker::with_control(
        lease.store.clone(),
        Arc::new(StationObjectTransferTransport::new(
            lease.session.clone(),
            lease.store.clone(),
        )?),
        Arc::new(FilesystemObjectBlob),
        Arc::new(SocialObjectCodec::default()),
        lease.transfer_control.clone(),
        Default::default(),
    )?)
}

pub fn new_download_worker(
    lease: &SecureContentLease,
    descriptor: &wire::EncryptedObjectDescriptor,
) -> Result<ObjectTransferWorker, String> {
    Ok(ObjectTransferWorker::with_control(
        lease.store.clone(),
        Arc::new(StationObjectTransferTransport::new(
            lease.session.clone(),
            lease.store.clone(),
        )?),
        Arc::new(FilesystemObjectBlob),
        Arc::new(SocialObjectCodec::for_download(descriptor)?),
        lease.transfer_control.clone(),
        Default::default(),
    )?)
}

pub fn new_upload_record(
    content_id: &str,
    object_id: &str,
    plan_id: &str,
    source_path: &Path,
    media_type: &str,
) -> Result<(ObjectTransferRecord, ObjectCryptoMaterial), String> {
    let plaintext_size = fs::metadata(source_path)
        .map_err(|error| format!("stat private Moment media: {error}"))?
        .len();
    let material = ObjectCryptoMaterial::generate(plaintext_size)?;
    let chunk_count = material.chunk_count();
    let transfer_id = format!("social-object-{object_id}");
    let partial = source_path.with_file_name(format!(".{object_id}.partial"));
    let record = ObjectTransferRecord {
        transfer_id,
        owner_scope_id: content_id.to_string(),
        operation_id: object_id.to_string(),
        authority_id: plan_id.to_string(),
        direction: ObjectTransferDirection::Upload,
        state: ObjectTransferState::Queued,
        upload_id: String::new(),
        generation: 0,
        descriptor_sha256: vec![0; 32],
        completed_chunk_bitmap: vec![0; chunk_count.div_ceil(8) as usize],
        source_local_ref: source_path.display().to_string(),
        partial_local_ref: partial.display().to_string(),
        object_key: material.object_key().to_vec(),
        base_nonce: material.base_nonce().to_vec(),
        plaintext_size,
        chunk_size: OBJECT_CHUNK_SIZE,
        attempt_count: 0,
        next_attempt_at_unix_ms: 1,
        last_error: None,
        updated_at_unix_ms: now_unix_ms(),
    };
    if media_type.trim().is_empty() {
        return Err("private Moment media type is required".to_string());
    }
    Ok((record, material))
}

pub fn new_download_record(
    actor_ptid: &str,
    session_generation: u64,
    post_id: &str,
    resource: &wire::SecureResourceRef,
    attachment: &crate::model::social::PrivateAttachmentMetadata,
) -> Result<(ObjectTransferRecord, PathBuf), String> {
    let descriptor = attachment
        .object
        .as_ref()
        .ok_or_else(|| "private Moment attachment descriptor is unavailable".to_string())?;
    let commitment = descriptor
        .commitment
        .as_ref()
        .ok_or_else(|| "private Moment attachment commitment is unavailable".to_string())?;
    if resource.owner_domain != wire::SecureContentOwnerDomain::Social as i32
        || resource.content_id.trim().is_empty()
        || resource.generation == 0
        || descriptor.resource.as_ref() != Some(resource)
        || commitment.resource.as_ref() != Some(resource)
        || descriptor.object_id.trim().is_empty()
        || descriptor.object_id != commitment.object_id
        || attachment.object_key.len() != 32
        || attachment.base_nonce.len() != 12
        || attachment.plaintext_sha256.len() != 32
        || attachment.plaintext_size == 0
        || commitment.chunk_count == 0
    {
        return Err("private Moment attachment download metadata is invalid".to_string());
    }
    let cache_path = secure_media_cache_path(
        actor_ptid,
        session_generation,
        &descriptor.object_id,
        &attachment.mime_type,
    )?;
    let partial_path = secure_ciphertext_checkpoint_path(
        actor_ptid,
        &descriptor.object_id,
        &attachment.mime_type,
    )?;
    let transfer_id = format!(
        "social-download-{}",
        hex::encode(Sha256::digest(
            format!(
                "{}:{}:{}",
                resource.content_id, resource.generation, descriptor.object_id
            )
            .as_bytes()
        ))
    );
    let record = ObjectTransferRecord {
        transfer_id,
        owner_scope_id: resource.content_id.clone(),
        operation_id: descriptor.object_id.clone(),
        authority_id: post_id.to_string(),
        direction: ObjectTransferDirection::Download,
        state: ObjectTransferState::Queued,
        upload_id: String::new(),
        generation: resource.generation,
        descriptor_sha256: Sha256::digest(descriptor.encode_to_vec()).to_vec(),
        completed_chunk_bitmap: vec![0; commitment.chunk_count.div_ceil(8) as usize],
        source_local_ref: cache_path.display().to_string(),
        partial_local_ref: partial_path.display().to_string(),
        object_key: attachment.object_key.clone(),
        base_nonce: attachment.base_nonce.clone(),
        plaintext_size: attachment.plaintext_size,
        chunk_size: commitment.chunk_size,
        attempt_count: 0,
        next_attempt_at_unix_ms: 1,
        last_error: None,
        updated_at_unix_ms: now_unix_ms(),
    };
    secure_content_core::object::validate_object_transfer_record(&record)?;
    Ok((record, cache_path))
}

pub struct FilesystemObjectBlob;

impl ObjectBlob for FilesystemObjectBlob {
    fn exists(&self, blob_ref: &str) -> Result<bool, String> {
        Ok(Path::new(blob_ref).is_file())
    }

    fn len(&self, blob_ref: &str) -> Result<u64, String> {
        fs::metadata(blob_ref)
            .map(|metadata| metadata.len())
            .map_err(|error| error.to_string())
    }

    fn read_chunk(&self, blob_ref: &str, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        let mut file = File::open(blob_ref).map_err(|error| error.to_string())?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| error.to_string())?;
        let mut bytes = vec![0_u8; length];
        file.read_exact(&mut bytes)
            .map_err(|error| error.to_string())?;
        Ok(bytes)
    }

    fn write_chunk(&self, blob_ref: &str, offset: u64, data: &[u8]) -> Result<(), String> {
        if let Some(parent) = Path::new(blob_ref).parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut options = OpenOptions::new();
        options.create(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(blob_ref).map_err(|error| error.to_string())?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| error.to_string())?;
        file.write_all(data).map_err(|error| error.to_string())
    }

    fn truncate(&self, blob_ref: &str, length: u64) -> Result<(), String> {
        OpenOptions::new()
            .write(true)
            .open(blob_ref)
            .and_then(|file| file.set_len(length))
            .map_err(|error| error.to_string())
    }

    fn sha256(&self, blob_ref: &str) -> Result<[u8; 32], String> {
        let mut file = File::open(blob_ref).map_err(|error| error.to_string())?;
        let mut digest = Sha256::new();
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            digest.update(&buffer[..read]);
        }
        Ok(digest.finalize().into())
    }

    fn promote(&self, source_ref: &str, target_ref: &str) -> Result<(), String> {
        if let Some(parent) = Path::new(target_ref).parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::rename(source_ref, target_ref).map_err(|error| error.to_string())
    }

    fn remove(&self, blob_ref: &str) -> Result<(), String> {
        match fs::remove_file(blob_ref) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

pub fn media_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

pub fn secure_cache_path(
    actor_ptid: &str,
    session_generation: u64,
    object_id: &str,
) -> Result<PathBuf, String> {
    if session_generation == 0 {
        return Err("secure content session generation is required".to_string());
    }
    let canonical = crate::infrastructure::storage::sanitize_storage_segment(object_id);
    if object_id.trim().is_empty() || canonical != object_id {
        return Err("private Moment object ID is unsafe for local storage".to_string());
    }
    Ok(secure_cache_dir(actor_ptid, session_generation)?.join(canonical))
}

pub fn secure_media_cache_path(
    actor_ptid: &str,
    session_generation: u64,
    object_id: &str,
    media_type: &str,
) -> Result<PathBuf, String> {
    secure_cache_path(
        actor_ptid,
        session_generation,
        &format!("{object_id}.{}", media_extension(media_type)?),
    )
}

pub fn secure_ciphertext_checkpoint_path(
    actor_ptid: &str,
    object_id: &str,
    media_type: &str,
) -> Result<PathBuf, String> {
    let file_name = format!("{object_id}.{}", media_extension(media_type)?);
    let canonical = crate::infrastructure::storage::sanitize_storage_segment(&file_name);
    if canonical != file_name {
        return Err("private Moment object ID is unsafe for local storage".to_string());
    }
    Ok(secure_cache_root(actor_ptid)?
        .join("checkpoints")
        .join(format!(".{file_name}.partial")))
}

fn media_extension(media_type: &str) -> Result<&'static str, String> {
    let extension = match media_type {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => return Err("private Moment image media type is unsupported".to_string()),
    };
    Ok(extension)
}

pub fn secure_cache_dir(actor_ptid: &str, session_generation: u64) -> Result<PathBuf, String> {
    if session_generation == 0 {
        return Err("secure content session generation is required".to_string());
    }
    Ok(secure_cache_root(actor_ptid)?
        .join("generations")
        .join(session_generation.to_string()))
}

pub fn clear_stale_plaintext_generations(actor_ptid: &str) -> Result<(), String> {
    let generations = secure_cache_root(actor_ptid)?.join("generations");
    match fs::remove_dir_all(generations) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "remove stale Secure Content plaintext generations: {error}"
        )),
    }
}

pub fn secure_cache_root(actor_ptid: &str) -> Result<PathBuf, String> {
    let scope = crate::infrastructure::local_scope::user_scope_for_actor_ptid(actor_ptid);
    crate::infrastructure::storage::app_file_path(
        &std::env::var("PT_PROFILE").unwrap_or_else(|_| "desktop".to_string()),
        crate::infrastructure::storage::StorageKind::Cache,
        &["secure-content", &scope],
    )
    .map_err(|error| error.to_string())
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::error::ErrorCode;
    use crate::secure_content::adapter::NativeTransportError;
    use crate::secure_content::store::{SecureContentStore, StoredPublication};

    #[test]
    fn secure_content_media_types_are_bounded_and_do_not_trust_caller_metadata() {
        assert_eq!(media_type(Path::new("/tmp/photo.JPG")), "image/jpeg");
        assert_eq!(media_type(Path::new("/tmp/photo.png")), "image/png");
        assert_eq!(
            media_type(Path::new("/tmp/unknown.private")),
            "application/octet-stream"
        );
    }

    #[test]
    fn secure_content_download_record_binds_resource_keys_and_cache_path() {
        let resource = wire::SecureResourceRef {
            owner_domain: wire::SecureContentOwnerDomain::Social as i32,
            content_id: "content-1".to_string(),
            generation: 7,
        };
        let descriptor = wire::EncryptedObjectDescriptor {
            resource: Some(resource.clone()),
            object_id: "object-1".to_string(),
            storage_ref: "opaque/storage/ref".to_string(),
            commitment: Some(wire::EncryptedObjectUploadSpec {
                resource: Some(resource.clone()),
                object_id: "object-1".to_string(),
                ciphertext_size: 144,
                ciphertext_sha256: vec![3; 32],
                chunk_size: 128,
                chunk_count: 1,
                encryption_suite: wire::ObjectEncryptionSuite::Aes256GcmChunked as i32,
                tag_size: secure_content_core::object::OBJECT_TAG_SIZE,
                nonce_strategy: wire::ObjectNonceStrategy::Counter32Be as i32,
                chunk_ciphertext_sha256: vec![vec![4; 32]],
            }),
        };
        let attachment = crate::model::social::PrivateAttachmentMetadata {
            attachment_id: "attachment-1".to_string(),
            filename: "photo.jpg".to_string(),
            mime_type: "image/jpeg".to_string(),
            plaintext_size: 128,
            plaintext_sha256: vec![5; 32],
            object_key: vec![6; 32],
            base_nonce: vec![0; 12],
            object: Some(descriptor.clone()),
            width: 0,
            height: 0,
            duration_ms: 0,
            alt_text: String::new(),
        };

        let (record, cache_path) =
            new_download_record("ptid:alice", 7, "post-1", &resource, &attachment).unwrap();

        assert_eq!(record.direction, ObjectTransferDirection::Download);
        assert_eq!(
            record.descriptor_sha256,
            Sha256::digest(descriptor.encode_to_vec()).to_vec()
        );
        assert_eq!(record.generation, 7);
        assert_eq!(record.completed_chunk_bitmap, vec![0]);
        assert_eq!(
            cache_path.extension().and_then(|value| value.to_str()),
            Some("jpg")
        );
        assert!(cache_path.to_string_lossy().contains("/generations/7/"));
        assert!(record
            .partial_local_ref
            .contains("/checkpoints/.object-1.jpg.partial"));
    }

    #[test]
    fn secure_content_media_cache_path_rejects_unsupported_or_unsafe_inputs() {
        assert!(secure_media_cache_path("ptid:alice", 1, "../object", "image/jpeg").is_err());
        assert!(secure_media_cache_path("ptid:alice", 1, "object-1", "video/mp4").is_err());
        assert_eq!(
            secure_media_cache_path("ptid:alice", 1, "object-1", "image/webp")
                .unwrap()
                .extension()
                .and_then(|value| value.to_str()),
            Some("webp")
        );
        assert_ne!(
            secure_media_cache_path("ptid:alice", 1, "object-1", "image/webp").unwrap(),
            secure_media_cache_path("ptid:alice", 2, "object-1", "image/webp").unwrap(),
        );
        assert!(secure_cache_path("ptid:alice", 0, "object-1.webp").is_err());
    }

    #[test]
    fn unknown_publication_auth_rejection_stays_reconcilable_and_retains_private_key() {
        let store = SecureContentStore::in_memory().unwrap();
        let request_bytes = b"canonical-publication".to_vec();
        let command = StoredPublication {
            command_id: "cpk-pub-v1-unknown-auth".to_string(),
            key_kind: wire::ContentPreKeyKind::ContentPrekeyKindEndpoint as i32,
            pool_epoch: 1,
            request_sha256: Sha256::digest(&request_bytes).into(),
            request_bytes,
            state: PublicationState::PendingPublication,
            lease_generation: 0,
            session_generation: 0,
        };
        store
            .persist_prekey_publication(
                &command,
                &[("endpoint-key-1".to_string(), Some([7; 32]), [8; 32])],
            )
            .unwrap();
        let first = store.acquire_publication(&command.command_id, 1).unwrap();
        store
            .mark_publication_unknown(
                &command.command_id,
                first.command.lease_generation,
                first.command.session_generation,
            )
            .unwrap();
        let replay = store.acquire_publication(&command.command_id, 2).unwrap();
        let auth_rejection = NativeTransportError {
            http_status: Some(401),
            stable_code: ErrorCode::Unauthorized as i32,
            retry_after_seconds: None,
            disposition: NativeErrorDisposition::Terminal,
            message: "session expired".to_string(),
        };

        assert!(preserves_unknown_commit_after_auth_rejection(
            replay.reconciles_unknown_commit,
            &auth_rejection,
        ));
        store
            .mark_publication_unknown(
                &command.command_id,
                replay.command.lease_generation,
                replay.command.session_generation,
            )
            .unwrap();

        let pending = store.publications_requiring_reconciliation().unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].state, PublicationState::UnknownCommit);
        assert!(store.endpoint_prekey("endpoint-key-1").unwrap().is_some());
    }

    #[test]
    fn fresh_publication_terminal_rejection_can_discard_unadvertised_private_key() {
        let store = SecureContentStore::in_memory().unwrap();
        let request_bytes = b"invalid-fresh-publication".to_vec();
        let command = StoredPublication {
            command_id: "cpk-pub-v1-fresh-terminal".to_string(),
            key_kind: wire::ContentPreKeyKind::ContentPrekeyKindEndpoint as i32,
            pool_epoch: 1,
            request_sha256: Sha256::digest(&request_bytes).into(),
            request_bytes,
            state: PublicationState::PendingPublication,
            lease_generation: 0,
            session_generation: 0,
        };
        store
            .persist_prekey_publication(
                &command,
                &[("endpoint-key-2".to_string(), Some([9; 32]), [10; 32])],
            )
            .unwrap();
        let acquired = store.acquire_publication(&command.command_id, 1).unwrap();
        let invalid_request = NativeTransportError {
            http_status: Some(400),
            stable_code: ErrorCode::InvalidRequest as i32,
            retry_after_seconds: None,
            disposition: NativeErrorDisposition::Terminal,
            message: "invalid request".to_string(),
        };

        assert!(!preserves_unknown_commit_after_auth_rejection(
            acquired.reconciles_unknown_commit,
            &invalid_request,
        ));
        store
            .mark_publication_terminal(
                &command.command_id,
                acquired.command.lease_generation,
                acquired.command.session_generation,
            )
            .unwrap();

        assert!(store.endpoint_prekey("endpoint-key-2").unwrap().is_none());
    }
}
