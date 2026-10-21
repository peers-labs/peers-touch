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
use sha2::{Digest, Sha256};

use crate::model::secure_content as wire;

use super::adapter::{SocialObjectCodec, StationObjectTransferTransport};
use super::SecureContentLease;

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
        "mp4" => "video/mp4",
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
        "video/mp4" => "mp4",
        _ => return Err("private Moment media type is unsupported".to_string()),
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

    #[test]
    fn secure_content_media_types_are_bounded_and_do_not_trust_caller_metadata() {
        assert_eq!(media_type(Path::new("/tmp/photo.JPG")), "image/jpeg");
        assert_eq!(media_type(Path::new("/tmp/photo.png")), "image/png");
        assert_eq!(media_type(Path::new("/tmp/video.MP4")), "video/mp4");
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
        assert_eq!(
            secure_media_cache_path("ptid:alice", 1, "object-1", "video/mp4")
                .unwrap()
                .extension()
                .and_then(|value| value.to_str()),
            Some("mp4")
        );
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
}
