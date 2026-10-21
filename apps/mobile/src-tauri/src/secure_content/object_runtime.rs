use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::Arc;

use prost::Message;
use secure_content_core::object::{
    EncryptedObjectChunk, ObjectDescriptor, ObjectEncryptionSuite, ObjectNonceStrategy,
    ObjectTransferDirection, ObjectTransferErrorCode, ObjectTransferFailure, ObjectTransferRecord,
    ObjectTransferState, ObjectTransferWorker, ObjectUploadSpec, PreparedObjectUpload,
    OBJECT_CHUNK_SIZE, OBJECT_TAG_SIZE,
};
use secure_content_core::ports::{ObjectBlob, ObjectCommitmentCodec, ObjectTransferTransport};
use sha2::{Digest, Sha256};

use crate::platform::media_picker::PreparedMomentMedia;

use super::proto::secure_content::v1 as wire;
use super::store::PrivateSocialStore;
use super::transport::{NativeSocialTransport, TransportDisposition, TransportError};
use super::NativeSocialSession;

pub(crate) fn new_upload_record(
    prepared: &PreparedMomentMedia,
    resource: &wire::SecureResourceRef,
    object_id: &str,
    plan_id: &str,
) -> Result<ObjectTransferRecord, String> {
    if resource.content_id.trim().is_empty()
        || resource.generation == 0
        || object_id.trim().is_empty()
        || plan_id.trim().is_empty()
        || prepared.mime_type().trim().is_empty()
    {
        return Err("private Social object transfer identity is incomplete".to_string());
    }
    let chunk_count = prepared
        .plaintext_size()
        .div_ceil(u64::from(OBJECT_CHUNK_SIZE)) as u32;
    let partial_local_ref = prepared
        .plaintext_path()
        .with_file_name(format!(".{object_id}.object-partial"));
    let record = ObjectTransferRecord {
        transfer_id: format!("mobile-social-object-{object_id}"),
        owner_scope_id: resource.content_id.clone(),
        operation_id: object_id.to_string(),
        authority_id: plan_id.to_string(),
        direction: ObjectTransferDirection::Upload,
        state: ObjectTransferState::Queued,
        upload_id: String::new(),
        generation: 0,
        descriptor_sha256: vec![0; 32],
        completed_chunk_bitmap: vec![0; chunk_count.div_ceil(8) as usize],
        source_local_ref: prepared.plaintext_path().display().to_string(),
        partial_local_ref: partial_local_ref.display().to_string(),
        object_key: prepared.object_key().to_vec(),
        base_nonce: prepared.base_nonce().to_vec(),
        plaintext_size: prepared.plaintext_size(),
        chunk_size: OBJECT_CHUNK_SIZE,
        attempt_count: 0,
        next_attempt_at_unix_ms: 0,
        last_error: None,
        updated_at_unix_ms: now_unix_ms(),
    };
    secure_content_core::object::validate_object_transfer_record(&record)?;
    Ok(record)
}

pub(crate) fn new_object_worker(
    session: Arc<NativeSocialSession>,
    store: Arc<PrivateSocialStore>,
    resource: wire::SecureResourceRef,
) -> Result<ObjectTransferWorker, String> {
    let codec = Arc::new(MobileSocialObjectCodec::new(resource.clone())?);
    Ok(ObjectTransferWorker::new(
        store.clone(),
        Arc::new(MobileObjectTransferTransport::new(
            session, store, resource,
        )?),
        Arc::new(FilesystemObjectBlob),
        codec,
    ))
}

pub(crate) struct MobileSocialObjectCodec {
    resource: wire::SecureResourceRef,
}

impl MobileSocialObjectCodec {
    fn new(resource: wire::SecureResourceRef) -> Result<Self, String> {
        if resource.owner_domain != wire::SecureContentOwnerDomain::Social as i32
            || resource.content_id.trim().is_empty()
            || resource.generation == 0
        {
            return Err("private Social object resource is invalid".to_string());
        }
        Ok(Self { resource })
    }

    fn upload_spec(
        &self,
        transfer: &ObjectTransferRecord,
        object: &ObjectUploadSpec,
    ) -> Result<wire::EncryptedObjectUploadSpec, ObjectTransferFailure> {
        if transfer.owner_scope_id != self.resource.content_id {
            return Err(descriptor_failure(
                "private Social object owner scope changed",
            ));
        }
        Ok(wire::EncryptedObjectUploadSpec {
            resource: Some(self.resource.clone()),
            object_id: transfer.operation_id.clone(),
            ciphertext_size: object.ciphertext_size,
            ciphertext_sha256: object.ciphertext_sha256.clone(),
            chunk_size: object.chunk_size,
            chunk_count: object.chunk_count,
            encryption_suite: wire::ObjectEncryptionSuite::Aes256GcmChunked as i32,
            tag_size: object.tag_size,
            nonce_strategy: wire::ObjectNonceStrategy::Counter32Be as i32,
            chunk_ciphertext_sha256: object.chunk_ciphertext_sha256.clone(),
        })
    }

    pub(crate) fn descriptor_to_core(
        descriptor: &wire::EncryptedObjectDescriptor,
    ) -> Result<ObjectDescriptor, ObjectTransferFailure> {
        let commitment = descriptor
            .commitment
            .as_ref()
            .ok_or_else(|| descriptor_failure("private Social object commitment is missing"))?;
        if descriptor.resource.is_none()
            || descriptor.resource != commitment.resource
            || descriptor.object_id.trim().is_empty()
            || descriptor.object_id != commitment.object_id
            || descriptor.storage_ref.trim().is_empty()
            || commitment.encryption_suite != wire::ObjectEncryptionSuite::Aes256GcmChunked as i32
            || commitment.nonce_strategy != wire::ObjectNonceStrategy::Counter32Be as i32
            || commitment.tag_size != OBJECT_TAG_SIZE
        {
            return Err(descriptor_failure(
                "private Social object descriptor is inconsistent",
            ));
        }
        Ok(ObjectDescriptor {
            object_id: descriptor.object_id.clone(),
            storage_ref: descriptor.storage_ref.clone(),
            commitment: ObjectUploadSpec {
                ciphertext_size: commitment.ciphertext_size,
                ciphertext_sha256: commitment.ciphertext_sha256.clone(),
                media_type: None,
                chunk_size: commitment.chunk_size,
                chunk_count: commitment.chunk_count,
                encryption_suite: ObjectEncryptionSuite::Aes256GcmChunked,
                tag_size: commitment.tag_size,
                nonce_strategy: ObjectNonceStrategy::Counter32Be,
                chunk_ciphertext_sha256: commitment.chunk_ciphertext_sha256.clone(),
            },
        })
    }
}

impl ObjectCommitmentCodec for MobileSocialObjectCodec {
    fn upload_commitment(
        &self,
        transfer: &ObjectTransferRecord,
        object: &ObjectUploadSpec,
    ) -> Result<[u8; 32], ObjectTransferFailure> {
        let input = wire::EncryptedObjectDescriptorCommitmentInput {
            format_version: 1,
            resource: Some(self.resource.clone()),
            object_id: transfer.operation_id.clone(),
            upload_spec: Some(self.upload_spec(transfer, object)?),
        };
        Ok(Sha256::digest(input.encode_to_vec()).into())
    }

    fn descriptor_commitment(
        &self,
        _descriptor: &ObjectDescriptor,
    ) -> Result<[u8; 32], ObjectTransferFailure> {
        Err(descriptor_failure(
            "private Social upload codec cannot verify downloads",
        ))
    }
}

struct MobileObjectTransferTransport {
    transport: NativeSocialTransport,
    store: Arc<PrivateSocialStore>,
    codec: MobileSocialObjectCodec,
}

impl MobileObjectTransferTransport {
    fn new(
        session: Arc<NativeSocialSession>,
        store: Arc<PrivateSocialStore>,
        resource: wire::SecureResourceRef,
    ) -> Result<Self, String> {
        Ok(Self {
            transport: NativeSocialTransport::new(session)?,
            store,
            codec: MobileSocialObjectCodec::new(resource)?,
        })
    }

    fn map_failure(error: TransportError) -> ObjectTransferFailure {
        let code = match error.http_status {
            Some(409) => ObjectTransferErrorCode::PartConflict,
            Some(410) => ObjectTransferErrorCode::UploadExpired,
            Some(412) => ObjectTransferErrorCode::DescriptorMismatch,
            Some(416) => ObjectTransferErrorCode::RangeInvalid,
            Some(429) => ObjectTransferErrorCode::QuotaExceeded,
            _ => ObjectTransferErrorCode::RetryLater,
        };
        if matches!(
            error.disposition,
            TransportDisposition::Retryable | TransportDisposition::UnknownOutcome
        ) {
            ObjectTransferFailure::retryable(
                code,
                error
                    .retry_after_seconds
                    .and_then(|seconds| i64::try_from(seconds.checked_mul(1_000)?).ok()),
                error.to_string(),
            )
        } else {
            ObjectTransferFailure::terminal(code, error.to_string())
        }
    }
}

impl ObjectTransferTransport for MobileObjectTransferTransport {
    fn begin_upload(
        &self,
        transfer: &ObjectTransferRecord,
        prepared: &PreparedObjectUpload,
    ) -> Result<(String, u64, Vec<u8>), ObjectTransferFailure> {
        let response = self
            .transport
            .begin_private_object_upload(&wire::BeginEncryptedObjectUploadRequest {
                format_version: 1,
                plan_id: transfer.authority_id.clone(),
                resource: Some(self.codec.resource.clone()),
                object_id: transfer.operation_id.clone(),
                upload_spec: Some(self.codec.upload_spec(transfer, &prepared.object)?),
                descriptor_commitment_sha256: prepared.descriptor_sha256.to_vec(),
                command_id: format!("object-begin:{}", transfer.operation_id),
            })
            .map_err(Self::map_failure)?;
        if response.upload_id.trim().is_empty() || response.generation == 0 {
            return Err(descriptor_failure(
                "private Social object begin response is incomplete",
            ));
        }
        Ok((
            response.upload_id,
            response.generation,
            response.received_chunk_bitmap,
        ))
    }

    fn put_upload_chunk(
        &self,
        transfer: &ObjectTransferRecord,
        chunk: &EncryptedObjectChunk,
    ) -> Result<(), ObjectTransferFailure> {
        let response = self
            .transport
            .put_private_object_chunk(
                &transfer.upload_id,
                transfer.generation,
                &transfer.operation_id,
                chunk.chunk_index,
                u64::from(chunk.chunk_index)
                    .saturating_mul(u64::from(transfer.chunk_size + OBJECT_TAG_SIZE)),
                &chunk.ciphertext,
                &chunk.ciphertext_sha256,
            )
            .map_err(Self::map_failure)?;
        if response.upload_id != transfer.upload_id
            || response.generation != transfer.generation
            || response.chunk_index != chunk.chunk_index
        {
            return Err(descriptor_failure(
                "private Social object chunk response mismatched",
            ));
        }
        Ok(())
    }

    fn complete_upload(
        &self,
        transfer: &ObjectTransferRecord,
        prepared: &PreparedObjectUpload,
    ) -> Result<ObjectDescriptor, ObjectTransferFailure> {
        let response = self
            .transport
            .complete_private_object_upload(
                &transfer.upload_id,
                &wire::CompleteEncryptedObjectUploadRequest {
                    upload_id: transfer.upload_id.clone(),
                    generation: transfer.generation,
                    descriptor_commitment_sha256: prepared.descriptor_sha256.to_vec(),
                    command_id: format!("object-complete:{}", transfer.operation_id),
                },
            )
            .map_err(Self::map_failure)?;
        if response.state != wire::EncryptedObjectTransferState::CompleteUnattached as i32 {
            return Err(ObjectTransferFailure::terminal(
                ObjectTransferErrorCode::IntegrityFailed,
                "private Social object completion was not durable",
            ));
        }
        let descriptor = response.descriptor.ok_or_else(|| {
            descriptor_failure("private Social object completion omitted descriptor")
        })?;
        if descriptor.resource.as_ref() != Some(&self.codec.resource)
            || descriptor.object_id != transfer.operation_id
        {
            return Err(descriptor_failure(
                "private Social object completion changed its identity",
            ));
        }
        let core = MobileSocialObjectCodec::descriptor_to_core(&descriptor)?;
        self.store
            .persist_object_descriptor(&transfer.transfer_id, &descriptor.encode_to_vec())
            .map_err(|error| {
                ObjectTransferFailure::retryable(ObjectTransferErrorCode::RetryLater, None, error)
            })?;
        Ok(core)
    }

    fn get_download_chunk(
        &self,
        _transfer: &ObjectTransferRecord,
        _descriptor: &ObjectDescriptor,
        _chunk_index: u32,
        _start: u64,
        _end: u64,
    ) -> Result<Vec<u8>, ObjectTransferFailure> {
        Err(descriptor_failure(
            "private Social upload transport cannot download objects",
        ))
    }

    fn cancel_upload(&self, transfer: &ObjectTransferRecord) -> Result<(), ObjectTransferFailure> {
        self.transport
            .cancel_private_object_upload(
                &transfer.upload_id,
                transfer.generation,
                &format!("object-cancel:{}", transfer.operation_id),
            )
            .map(|_| ())
            .map_err(Self::map_failure)
    }
}

struct FilesystemObjectBlob;

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
        let mut bytes = vec![0; length];
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
        let mut buffer = vec![0; 64 * 1024];
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

fn descriptor_failure(detail: impl Into<String>) -> ObjectTransferFailure {
    ObjectTransferFailure::terminal(ObjectTransferErrorCode::DescriptorMismatch, detail)
}

fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}
